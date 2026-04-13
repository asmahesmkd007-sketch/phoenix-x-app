let _socket = null;

const initSocket = () => {
  if (_socket && _socket.connected) return _socket;

  _socket = io(window.location.origin, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: Infinity, // Never give up reconnecting
    reconnectionDelay: 1000,        // Reconnect faster
    reconnectionDelayMax: 5000,     // Cap the delay
    timeout: 10000                  // Detect drop faster
  });

  _socket.on('connect', () => {
    const user = getUser();
    if (user) {
      _socket.emit('authenticate', { userId: user.id, username: user.username });
    }
  });

  _socket.on('live_info', (data) => {
    if (!data) return; // Keep last known values if data is missing
    const { online_users, active_matches } = data;
    
    // Only update if we actually got numbers (ignore temporary 0s if they feel like flickering)
    document.querySelectorAll('[data-live="online"]').forEach(el => {
       if (online_users !== undefined) el.textContent = online_users.toLocaleString();
    });
    document.querySelectorAll('[data-live="matches"]').forEach(el => {
       if (active_matches !== undefined) el.textContent = active_matches.toLocaleString();
    });
  });

  _socket.on('disconnect', () => console.log('<i class="fa-solid fa-plug"></i> Socket disconnected'));
  _socket.on('connect_error', (e) => console.warn('Socket error:', e.message));

  _socket.on('auth_error', async (data) => {
      alert(data.message || 'Authentication Error. Security strictly enforces a single device.');
      // Force logout from the blocked device
      try { await AuthAPI.logout(); } catch (e) {}
      localStorage.clear();
      window.location.href = '/pages/login.html';
  });

  return _socket;
};

const getSocket = () => _socket;

// ─── SOCKET ACTION HELPERS ───────────────────────────────
const SocketActions = {
  findMatch    : (timer, userId, username) => _socket?.emit('find_match',    { timer, userId, username }),
  cancelSearch : (timer, userId)           => _socket?.emit('cancel_search', { timer, userId }),
  makeMove     : (matchId, move, userId)   => _socket?.emit('make_move',     { matchId, move, userId }),
  resign       : (matchId, userId)         => _socket?.emit('resign',        { matchId, userId }),
  offerDraw    : (matchId, userId)         => _socket?.emit('offer_draw',    { matchId, userId }),
  acceptDraw   : (matchId)                 => _socket?.emit('accept_draw',   { matchId }),
  inviteFriend : (targetUserId, fromUserId, fromUsername, timer) =>
    _socket?.emit('invite_friend', { targetUserId, fromUserId, fromUsername, timer }),
  acceptInvite : (fromUserId, toUserId, fromUsername, toUsername, timer) =>
    _socket?.emit('accept_invite', { fromUserId, toUserId, fromUsername, toUsername, timer }),
  rejectInvite : (fromUserId)              => _socket?.emit('reject_invite', { fromUserId }),
  createRoom   : (roomId, userId, username) => _socket?.emit('create_room',  { roomId, userId, username }),
  joinRoom     : (roomId, userId, username, timer) =>
    _socket?.emit('join_room', { roomId, userId, username, timer }),
  findTournamentMatch : (tournamentId, timer, userId, username) => 
    _socket?.emit('find_tournament_match', { tournamentId, timer, userId, username }),
  cancelTournamentSearch : (tournamentId, userId) => 
    _socket?.emit('cancel_tournament_search', { tournamentId, userId }),
};
