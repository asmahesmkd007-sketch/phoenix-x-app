const { supabase } = require('../config/supabase');

// Helper to normalize username
const normalizeUsername = (raw) => {
  if (!raw) return '';
  let u = raw.trim().replace(/\s+/g, '');
  u = u.replace(/^@+/, '');
  return '@' + u.toLowerCase();
};

const sendRequest = async (req, res) => {
  try {
    const { targetUsername } = req.body;
    if (!targetUsername) return res.status(400).json({ success: false, message: 'Username is required.' });

    const normalized = normalizeUsername(targetUsername);
    const rawName = targetUsername.replace(/^@+/, '').toLowerCase();

    if (normalized === req.user.username) {
      return res.status(400).json({ success: false, message: 'You cannot send a friend request to yourself.' });
    }

    // Find user - more flexible search
    const { data: targetUser } = await supabase.from('profiles')
      .select('id')
      .or(`username.eq.${normalized},username.eq.${rawName}`)
      .maybeSingle();
    
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found.' });

    // Check if already friends
    const { data: existingFriend } = await supabase.from('friends')
      .select('id')
      .or(`and(user1_id.eq.${req.user.id},user2_id.eq.${targetUser.id}),and(user1_id.eq.${targetUser.id},user2_id.eq.${req.user.id})`)
      .single();
    if (existingFriend) return res.status(400).json({ success: false, message: 'Already friends.' });

    // Check existing request
    const { data: existingReq } = await supabase.from('friend_requests')
      .select('id, status')
      .or(`and(sender_id.eq.${req.user.id},receiver_id.eq.${targetUser.id}),and(sender_id.eq.${targetUser.id},receiver_id.eq.${req.user.id})`)
      .single();

    if (existingReq) {
      if (existingReq.status === 'pending') return res.status(400).json({ success: false, message: 'Friend request already pending.' });
      if (existingReq.status === 'accepted') return res.status(400).json({ success: false, message: 'Already friends.' });
      return res.status(400).json({ success: false, message: 'Friend request exists.' });
    }

    const { error } = await supabase.from('friend_requests').insert({
      sender_id: req.user.id,
      receiver_id: targetUser.id,
      status: 'pending'
    });

    if (error) return res.status(400).json({ success: false, message: error.message });

    // Notify receiver
    const { sendNotification } = require('../services/notification.service');
    await sendNotification({
      user_id: targetUser.id,
      type: 'friend_request',
      title: 'New Friend Request',
      message: `${req.user.username} sent you a friend request.`,
    });

    // Real-time emit
    const io = req.app.get('io');
    if (io) {
      const { userToSocket } = require('../socket/socket.js'); 
      const targetSocket = userToSocket.get(targetUser.id);
      if (targetSocket) io.to(targetSocket).emit('silent_notification');
    }

    res.json({ success: true, message: 'Friend request sent!' });
  } catch (err) {
    console.error('sendRequest error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getRequests = async (req, res) => {
  try {
    const [incoming, outgoing] = await Promise.all([
      supabase.from('friend_requests')
        .select('id, sender_id, status, created_at, sender:sender_id(username)')
        .eq('receiver_id', req.user.id)
        .eq('status', 'pending'),
      supabase.from('friend_requests')
        .select('id, receiver_id, status, created_at, receiver:receiver_id(username)')
        .eq('sender_id', req.user.id)
        .eq('status', 'pending')
    ]);

    res.json({ 
      success: true, 
      incoming: incoming.data || [], 
      outgoing: outgoing.data || [] 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const respondRequest = async (req, res) => {
  try {
    const { id, action } = req.body; // action: 'accept' or 'reject'
    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    const { data: reqData, error: fetchErr } = await supabase.from('friend_requests')
      .select('*')
      .eq('id', id)
      .eq('receiver_id', req.user.id)
      .single();

    if (fetchErr || !reqData) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (reqData.status !== 'pending') return res.status(400).json({ success: false, message: 'Request already processed.' });

    // Update status
    await supabase.from('friend_requests').update({ status: newStatus }).eq('id', id);

    if (action === 'accept') {
      await supabase.from('friends').insert({
        user1_id: reqData.sender_id,
        user2_id: reqData.receiver_id
      });
      // Notify sender
      const { sendNotification } = require('../services/notification.service');
      await sendNotification({
        user_id: reqData.sender_id,
        type: 'friend_request',
        title: 'Friend Request Accepted',
        message: `${req.user.username} accepted your friend request!`,
      });
    }

    res.json({ success: true, message: `Request ${newStatus}.` });
  } catch (err) {
    console.error('respondRequest error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getFriends = async (req, res) => {
  try {
    const { data: friendsData } = await supabase.from('friends')
      .select('id, user1:user1_id(id, username, is_online, last_seen), user2:user2_id(id, username, is_online, last_seen)')
      .or(`user1_id.eq.${req.user.id},user2_id.eq.${req.user.id}`);

    const friendsList = (friendsData || []).map(f => {
      // Map out the actual friend
      const isUser1 = f.user1?.id === req.user.id;
      const friendObj = isUser1 ? f.user2 : f.user1;
      return {
        friendship_id: f.id,
        friend_id: friendObj.id,
        username: friendObj.username,
        is_online: friendObj.is_online,
        last_seen: friendObj.last_seen
      };
    });

    res.json({ success: true, friends: friendsList });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const removeFriend = async (req, res) => {
  try {
    const { id } = req.params; 
    
    // Check if the friendship row actually belongs to the user
    // The query is safe because we mandate user1 or user2 must equal req.user.id
    const { error } = await supabase.from('friends')
      .delete()
      .eq('id', id)
      .or(`user1_id.eq.${req.user.id},user2_id.eq.${req.user.id}`);

    if (error) return res.status(400).json({ success: false, message: error.message });
    res.json({ success: true, message: 'Friend removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getChallenges = async (req, res) => {
  try {
    const { data: incoming } = await supabase.from('game_challenges')
      .select('*, from_user:from_user_id(username)')
      .eq('to_user_id', req.user.id)
      .eq('status', 'pending');

    const { data: outgoing } = await supabase.from('game_challenges')
      .select('*, to_user:to_user_id(username)')
      .eq('from_user_id', req.user.id)
      .eq('status', 'pending');

    res.json({ 
      success: true, 
      challenges: incoming || [],
      outgoingChallenges: outgoing || []
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const respondChallenge = async (req, res) => {
  try {
    const { id, action } = req.body; // action: 'accepted' or 'declined'
    
    const { error } = await supabase.from('game_challenges')
      .update({ status: action })
      .eq('id', id)
      .eq('to_user_id', req.user.id);

    if (error) return res.status(400).json({ success: false, message: error.message });
    
    res.json({ success: true, message: `Challenge ${action}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { 
  sendRequest, 
  getRequests, 
  respondRequest, 
  getFriends, 
  removeFriend,
  getChallenges,
  respondChallenge
};
