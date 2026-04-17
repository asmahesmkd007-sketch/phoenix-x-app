const { supabase } = require('../config/supabase');

/**
 * Sends a notification to a user and ensures they only keep the last 10 messages.
 * @param {Object} params - { user_id, type, title, message }
 */
const sendNotification = async ({ user_id, type, title, message }) => {
  try {
    // 1. Insert the new notification
    const { data: newNotif, error } = await supabase.from('notifications').insert({
      user_id,
      type,
      title,
      message,
      read: false
    }).select().single();

    if (error) throw error;

    // 2. Limit to last 5 (Delete oldest ones for this user)
    const { data: allNotifs } = await supabase
      .from('notifications')
      .order('created_at', { ascending: false })
      .eq('user_id', user_id);

    if (allNotifs && allNotifs.length > 5) {
      const idsToDelete = allNotifs.slice(5).map(n => n.id);
      await supabase.from('notifications').delete().in('id', idsToDelete);
    }

    return newNotif;
  } catch (err) {
    console.error('sendNotification Error:', err);
    return null;
  }
};

module.exports = { sendNotification };
