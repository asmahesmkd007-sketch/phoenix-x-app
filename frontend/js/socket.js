let _socket = null;

const initSocket = () => {
  if (_socket && _socket.connected) return _socket;

  const socketUrl = (window.location.port === '5500' || window.location.port === '3000')
    ? 'http://localhost:5000'
    : window.location.origin;

  _socket = io(socketUrl, {
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

  // ─── REAL-TIME NOTIFICATIONS ───────────────────────────
  _socket.on('silent_notification', () => {
      if (typeof Toast !== 'undefined') Toast.info('New notification received! <i class="fa-solid fa-bell"></i>');
      // Update notification counts globally if they exist on page
      const countEl = document.getElementById('notif-count');
      if (countEl) {
          let count = parseInt(countEl.textContent) || 0;
          countEl.textContent = count + 1;
          countEl.style.display = 'flex';
      }
      // If we're on dashboard, reload it
      if (typeof loadDashboard === 'function') loadDashboard();
      // If we're on friends page, reload it
      if (typeof loadRequests === 'function') loadRequests();
  });

  _socket.on('friend_invite', (data) => {
      if (typeof Toast !== 'undefined') Toast.info(`${data.fromUsername} challenged you!`);
      
      // If user is actively playing on the game board, skip the modal
      if (window.location.pathname.includes('/game.html')) {
          return;
      }

      // Update social page list instantly if open
      if (typeof loadRequests === 'function') loadRequests();
      if (typeof loadFriends === 'function') loadFriends();

      // Global challenge modal inject
      if (!document.getElementById('global-invite-modal')) {
          const div = document.createElement('div');
          div.id = 'global-invite-modal';
          div.className = 'modal-overlay active';
          div.innerHTML = `
              <div class="modal">
                  <div class="modal-title"><i class="fa-solid fa-chess-pawn"></i> Challenge Received!</div>
                  <div id="global-invite-desc" class="modal-desc"></div>
                  <div class="modal-actions">
                      <button class="btn btn-secondary" id="global-invite-decline">Decline</button>
                      <button class="btn btn-primary" id="global-invite-accept">Accept</button>
                  </div>
              </div>
          `;
          document.body.appendChild(div);
          
          document.getElementById('global-invite-decline').onclick = () => {
              _socket.emit('reject_invite', { fromUserId: data.fromUserId });
              div.classList.remove('active');
          };
          document.getElementById('global-invite-accept').onclick = () => {
              _socket.emit('accept_invite', { 
                  fromUserId: data.fromUserId, 
                  toUserId: getUser().id, 
                  fromUsername: data.fromUsername, 
                  toUsername: getUser().username, 
                  timer: data.timer 
              });
              div.classList.remove('active');
              if (typeof Toast !== 'undefined') Toast.success('Joining match...');
          };
      }
      
      document.getElementById('global-invite-desc').textContent = `${data.fromUsername} challenges you to a ${data.timer}-minute game!`;
      document.getElementById('global-invite-modal').classList.add('active');
  });

  _socket.on('match_found', (data) => {
      // Global match detection: redirect to game page from anywhere
      localStorage.setItem('px_match', JSON.stringify(data));
      window.location.href = '/pages/game.html?matchId=' + data.matchId;
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
