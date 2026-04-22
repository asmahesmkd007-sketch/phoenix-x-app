const { supabase } = require('../config/supabase');
const { Chess } = require('chess.js');
const { processMatchResult } = require('../controllers/game.controller');

const activeTourneys = new Map();
const activeTournamentMatches = new Map();

class TournamentManager {
    static init(io) {
        console.log('🚀 TournamentManager.init starting...');
        this.io = io;
        setInterval(() => this.tick(), 1000);
        setInterval(() => this.pollLiveTournaments(), 5000);
        
        // FAIL-SAFE: Check for replenishment every 3 minutes
        setInterval(() => {
            const { autoCreatePaidTournaments } = require('../controllers/tournament.controller');
            autoCreatePaidTournaments().catch(()=>{});
        }, 3 * 60 * 1000);

        // RECOVERY: Recover any stuck tournaments from previous session
        this.recoverStuckTournaments()
            .then(() => console.log('✅ TournamentManager recovery complete.'))
            .catch(err => console.error('❌ Recovery Error:', err));
    }

    static async pollLiveTournaments() {
        try {
            // SELF-HEALING: Detect and fix stuck 'upcoming' tournaments that are actually full
            const { data: upcomingPaid } = await supabase.from('tournaments')
                .select('id, tr_id, status, max_players').eq('type', 'paid').eq('status', 'upcoming');
            
            if (upcomingPaid) {
                for (const ut of upcomingPaid) {
                    const { count } = await supabase.from('tournament_players').select('*', { count: 'exact', head: true }).eq('tournament_id', ut.id);
                    if (count >= (ut.max_players || 16)) {
                        console.log(`🔧 Self-healing TR-${ut.tr_id}: Forcing LOCKED (Actual count: ${count})`);
                        await supabase.from('tournaments').update({ 
                            status: 'full', 
                            current_players: ut.max_players || 16,
                            start_time: new Date(Date.now() + 120000).toISOString() 
                        }).eq('id', ut.id);
                        this.pickupTournament(ut.id).catch(()=>{});
                    }
                }
            }

            const { data: tourneys } = await supabase.from('tournaments')
                .select('*').eq('type', 'paid')
                .in('status', ['full', 'starting', 'live']);
            if (!tourneys) return;

            for (const t of tourneys) {
                if (activeTourneys.has(t.id)) continue;
                await this.pickupTournament(t.id);
            }
        } catch(e) { console.error('pollLiveTournaments err:', e); }
    }

    static async pickupTournament(tournamentId) {
        if (activeTourneys.has(tournamentId)) return;
        
        const { data: t, error } = await supabase.from('tournaments').select('*').eq('id', tournamentId).single();
        if (error || !t) return;

        if (!['full', 'starting', 'live'].includes(t.status)) return;

        let { data: players, error: pError } = await supabase.from('tournament_players')
            .select('*, profiles(username, rank)').eq('tournament_id', tournamentId)
            .order('joined_at', { ascending: true })
            .limit(100); // Safety cap of 100 players
        
        if (pError || !players || players.length === 0) return;

        const playersData = players.map((p, i) => ({
            user_id: p.user_id, username: p.profiles?.username || 'Unknown',
            rank: p.profiles?.rank || 'Bronze', score: 0, status: 'alive', slot: i + 1
        }));

        console.log(`📦 TournamentManager: Loaded ${playersData.length} players for TR-${t.tr_id}`);
        this.startTournament(tournamentId, playersData, t);
    }

    static startTournament(tournamentId, playersData, tData) {
        let countdown = 60; // 1 minute lobby before Round 1 starts
        
        if (tData.status === 'live' && tData.live_lobby_ends_at) {
            const endsAt = new Date(tData.live_lobby_ends_at);
            countdown = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
        } else if (tData.start_time) {
            countdown = Math.max(0, Math.floor((new Date(tData.start_time) - Date.now()) / 1000));
        }
        
        // Cap lobby countdown at 60s for paid knockout tournaments
        if (tData.type === 'paid') {
            countdown = Math.min(60, countdown);
        }

        const tState = {
            id: tournamentId, tr_id: tData.tr_id,
            type: tData.type,
            players: [...playersData], allPlayers: [...playersData],
            max: tData.max_players, timer: tData.timer_type,
            status: tData.status || 'full', 
            phase: tData.phase || (tData.status === 'live' ? 'lobby' : 'upcoming'),
            countdown,
            round: tData.round || 0, matches: [],
            nextRoundPending: false, 
            prize_pool: tData.prize_pool || 0
        };

        activeTourneys.set(tournamentId, tState);
    }

    static async tick() {
        for (const [tId, tState] of activeTourneys.entries()) {
            // FULL → Transitions to LIVE
            if (tState.status === 'full') {
                tState.countdown--;
                this.io.to(`tournament_${tId}`).emit('tr_timer', { countdown: tState.countdown });

                if (tState.countdown <= 0) {
                    // Check if full before transitioning
                    const { count } = await supabase.from('tournament_players').select('*', { count: 'exact', head: true }).eq('tournament_id', tId);
                    if (count >= (tState.max_players || 32)) {
                        this.transitionToLive(tId).catch(err => console.error('Transition Error:', err));
                    } else {
                        // Wait for more players, don't transition yet
                        console.log(`⏳ TR-${tState.tr_id} at 0:00 but not full. Waiting for players... (${count}/${tState.max_players})`);
                        tState.countdown = 30; // Reset to 30s
                    }
                } else if (tState.countdown % 10 === 0) {
                    this.broadcastState(tId);
                }
            }
            // LIVE → Handle Lobby or Matches
            else if (tState.status === 'live') {
                if (tState.phase === 'lobby') {
                    tState.countdown--;
                    this.io.to(`tournament_${tId}`).emit('tr_timer', { countdown: tState.countdown });
                    
                    if (tState.countdown <= 0 && !tState.nextRoundPending) {
                        tState.nextRoundPending = true;
                        
                        // STRICT PLAYER COUNT CHECK FOR 32-PLAYER TRs
                        const { count: currentJoined } = await supabase.from('tournament_players').select('*', { count: 'exact', head: true }).eq('tournament_id', tId);
                        
                        if (currentJoined >= (tState.max_players || 32)) {
                            tState.phase = 'round_1';
                            tState.round = 1;
                            tState.countdown = 600; 
                            console.log(`🔥 TR-${tState.tr_id} starting with ${currentJoined} players.`);
                            this.nextRound(tState).finally(() => tState.nextRoundPending = false);
                        } else {
                            console.log(`⏳ TR-${tState.tr_id} waiting for more players... (${currentJoined}/${tState.max_players})`);
                            tState.countdown = 60; // Reset to 60s and wait
                            tState.nextRoundPending = false;
                        }
                    }
                    if (tState.countdown % 10 === 0) this.broadcastState(tId);
                } 
                else {
                    tState.countdown--;
                    this.io.to(`tournament_${tId}`).emit('tr_timer', { countdown: tState.countdown });
                    if (tState.countdown <= 0) {
                         // Fail-safe: Tournament took too long (10 mins)
                    }
                    if (tState.matches.length > 0) {
                        const allDone = tState.matches.every(m => m.status === 'finished' || m.status === 'cancelled');
                        if (allDone && !tState.nextRoundPending) {
                            tState.status = 'rest';
                            tState.countdown = 15;
                            this.processRoundResults(tState);
                            this.broadcastState(tId);
                        } else if (tState.countdown <= -30) { 
                            // FAIL-SAFE: Round has been "over" for 30s but matches are stuck
                            console.log(`⚠️ Force-resolving stuck round in TR-${tState.tr_id}`);
                            tState.matches.forEach(m => {
                                if (m.status !== 'finished') this.resolveMatch(m.id, 'draw', null, 'force_close');
                            });
                        }
                    }
                }
            }
            // REST → Countdown to next round
            else if (tState.status === 'rest') {
                tState.countdown--;
                this.io.to(`tournament_${tId}`).emit('tr_timer', { countdown: tState.countdown });
                if (tState.countdown <= 0 && !tState.nextRoundPending) {
                    tState.nextRoundPending = true;
                    this.nextRound(tState).finally(() => tState.nextRoundPending = false);
                }
            }
        }

        // Global Match Timer Tick
        activeTournamentMatches.forEach((match, matchId) => {
            if (match.status !== 'live') return; // Note: 'live' matches are playing
            if (match.turn === 'w') match.player1.time--;
            else match.player2.time--;
            this.io.to(match.roomId).emit('timer_update', { white_time: match.player1.time, black_time: match.player2.time });
            if (match.player1.time <= 0 || match.player2.time <= 0) {
                const result = match.player1.time <= 0 ? 'player2_win' : 'player1_win';
                const winnerId = match.player1.time <= 0 ? match.player2.userId : match.player1.userId;
                this.resolveMatch(matchId, result, winnerId, 'timeout');
            }
            if (match.disconnectGrace !== null) {
                match.disconnectGrace--;
                if (match.disconnectGrace <= 0) {
                    const result = match.disconnectedPlayer === 'p1' ? 'player2_win' : 'player1_win';
                    const winnerId = match.disconnectedPlayer === 'p1' ? match.player2.userId : match.player1.userId;
                    this.resolveMatch(matchId, result, winnerId, 'disconnect_timeout');
                }
            }
        });
    }

    static async nextRound(tState) {
        // RE-FETCH FRESH PLAYER LIST FOR ROUND 1
        if (tState.round <= 1) {
            const { data: freshPlayers } = await supabase.from('tournament_players')
                .select('*, profiles(username, rank)').eq('tournament_id', tState.id)
                .order('joined_at', { ascending: true });
            
            if (freshPlayers && freshPlayers.length > 0) {
                const freshPlayersData = freshPlayers.map((p, i) => {
                    const existing = tState.allPlayers.find(ep => ep.user_id === p.user_id);
                    return {
                        user_id: p.user_id,
                        username: p.profiles?.username || 'Unknown',
                        rank: p.profiles?.rank || 'Bronze',
                        score: existing ? existing.score : 0,
                        status: existing ? existing.status : 'alive',
                        slot: i + 1
                    };
                });
                tState.players = [...freshPlayersData];
                tState.allPlayers = [...freshPlayersData];
                console.log(`🔄 Refreshed player list for TR-${tState.tr_id}: ${tState.players.length} total players.`);
            }
        }

        if (tState.players.filter(p => p.status === 'alive').length <= 1) return this.finishTournament(tState.id, tState);

        tState.matches = []; // Clear previous round matches

        // Advance round only if we are coming from REST or Lobby
        if (tState.status === 'rest') {
            tState.round++;
        }
        
        tState.status = 'live';
        const aliveCount = tState.players.filter(p => p.status === 'alive').length;
        const phaseName = aliveCount === 2 ? 'final' : (aliveCount === 4 ? 'semifinal' : `round_${tState.round}`);
        tState.phase = phaseName;

        await supabase.from('tournaments').update({ phase: phaseName, status: 'live', round: tState.round }).eq('id', tState.id);

        const rawPool = tState.players.filter(p => p.status === 'alive').sort(() => Math.random() - 0.5);
        
        // DE-DUPLICATION: Ensure no player is matched twice
        const uniquePlayers = new Map();
        rawPool.forEach(p => { if (!uniquePlayers.has(p.user_id)) uniquePlayers.set(p.user_id, p); });
        const pool = Array.from(uniquePlayers.values());

        if (pool.length <= 1) {
            console.log(`⚠️ Pool too small (${pool.length}) for TR-${tState.tr_id}. Finishing.`);
            return this.finishTournament(tState.id, tState);
        }

        console.log(`🚀 Starting ${phaseName} for TR-${tState.tr_id} | Raw Pool: ${rawPool.length} | Unique Pool: ${pool.length}`);

        // BULK MATCH CREATION
        const matchPairs = [];
        const matchInserts = [];
        const pairingPool = [...pool];

        while (pairingPool.length >= 2) {
            const p1 = pairingPool.shift(); 
            const p2 = pairingPool.shift();
            matchPairs.push({ p1, p2 });
            matchInserts.push({
                player1_id: p1.user_id, player2_id: p2.user_id,
                match_type: 'tournament', timer_type: tState.timer,
                tournament_id: tState.id, status: 'active',
                round: tState.round
            });
        }

        console.log(`📦 Attempting bulk insert of ${matchInserts.length} matches for TR-${tState.tr_id}`);

        if (matchInserts.length > 0) {
            const { data: createdMatches, error } = await supabase.from('matches').insert(matchInserts).select();
            if (error || !createdMatches) {
                console.error(`❌ BULK MATCH ERROR for TR-${tState.tr_id}:`, error);
                return;
            }
            console.log(`✅ Created ${createdMatches.length} matches for TR-${tState.tr_id}`);

            // Initialize each match in memory
            createdMatches.forEach((dbMatch, idx) => {
                const pair = matchPairs[idx];
                this.initializeMatch(dbMatch, pair.p1, pair.p2, tState);
            });
        }

        if (pairingPool.length === 1) {
            const pBye = pairingPool[0];
            const { userSockets } = require('../socket/socket');
            const s = userSockets.get(pBye.user_id) || new Set();
            s.forEach(sid => this.io.to(sid).emit('tournament_msg', { message: 'You got a BYE! Advancing.' }));
        }

        console.log(`⚔️ ${phaseName} Matches Setup: ${tState.matches.length} matches created.`);
        this.broadcastState(tState.id);
    }

    static initializeMatch(dbMatch, p1, p2, tState) {
        const { userSockets } = require('../socket/socket');
        const s1 = userSockets.get(p1.user_id) || new Set();
        const s2 = userSockets.get(p2.user_id) || new Set();

        const p1Online = s1.size > 0;
        const p2Online = s2.size > 0;

        const match = {
            id: dbMatch.id,
            tournamentId: tState.id,
            roomId: dbMatch.room_id || `tr_${dbMatch.id}`,
            status: 'waiting_connect',
            connectTimeout: 60,
            chess: new Chess(),
            turn: 'w',
            player1: { userId: p1.user_id, time: tState.timer * 60, socketId: [...s1][0], score: 0, connected: p1Online },
            player2: { userId: p2.user_id, time: tState.timer * 60, socketId: [...s2][0], score: 0, connected: p2Online },
            winnerId: null,
            fen: 'start',
            disconnectGrace: null,
            disconnectedPlayer: null
        };

        if (p1Online && p2Online) match.status = 'live';

        activeTournamentMatches.set(dbMatch.id, match);
        tState.matches.push(match);

        // Ensure sockets join the match room
        [s1, s2].forEach(s => s.forEach(sid => {
            const sock = this.io.sockets.sockets.get(sid);
            if (sock) {
                sock.join(match.roomId);
                sock.join(`tournament_${tState.id}`);
            }
        }));

        const eventData = { matchId: dbMatch.id, tournamentId: tState.id, timer: tState.timer, roomId: match.roomId };
        s1.forEach(sid => this.io.to(sid).emit('match_found_tr', { ...eventData, color: 'white', opponent: p2 }));
        s2.forEach(sid => this.io.to(sid).emit('match_found_tr', { ...eventData, color: 'black', opponent: p1 }));
    }

    static processRoundResults(tState) {
        const { userSockets } = require('../socket/socket');
        const roundWinners = new Set();

        tState.matches.forEach(m => {
            if (m.winnerId) {
                roundWinners.add(m.winnerId);
            } else {
                // If draw or other, decide a winner for progression
                const winnerId = (m.player1.score > m.player2.score) ? m.player1.userId : 
                               (m.player2.score > m.player1.score) ? m.player2.userId : 
                               (Math.random() > 0.5 ? m.player1.userId : m.player2.userId);
                roundWinners.add(winnerId);
            }
        });

        // Update status for all participants in this round
        tState.players.forEach(p => {
            if (p.status === 'alive' && !roundWinners.has(p.user_id)) {
                p.status = 'eliminated';
                // Notify eliminated player
                const sockets = userSockets.get(p.user_id);
                if (sockets) {
                    sockets.forEach(sid => {
                        this.io.to(sid).emit('tournament_msg', { message: 'You have been eliminated.' });
                        this.io.to(sid).emit('tournament_eliminated');
                    });
                }
            }
        });
    }

    static calculateMaterialScore(fen, color) {
        const pieces = fen.split(' ')[0];
        const values = { 
            'p': 1, 'r': 2, 'n': 2, 'b': 2, 'q': 5,
            'P': 1, 'R': 2, 'N': 2, 'B': 2, 'Q': 5
        };
        let score = 0;
        for (const char of pieces) {
            if (values[char]) {
                const isWhite = char === char.toUpperCase();
                if ((color === 'w' && isWhite) || (color === 'b' && !isWhite)) {
                    score += values[char];
                }
            }
        }
        return score;
    }

    static async resolveMatch(matchId, result, winnerId, reason) {
        console.log(`🏁 Resolving Match ${matchId} | Reason: ${reason} | Result: ${result}`);
        const match = activeTournamentMatches.get(matchId);
        if (!match || match.status === 'finished') return;

        match.status = 'finished';
        match.fen = match.chess.fen();

        // CALCULATE FINAL SCORES
        const p1Material = this.calculateMaterialScore(match.fen, 'w');
        const p2Material = this.calculateMaterialScore(match.fen, 'b');

        // Result Points: Win=10, Draw=5, Loss=0
        let p1Result = 0, p2Result = 0;
        if (result === 'player1_win') { p1Result = 10; p2Result = 0; }
        else if (result === 'player2_win') { p1Result = 0; p2Result = 10; }
        else { p1Result = 5; p2Result = 5; }

        match.player1.score = p1Material + p1Result;
        match.player2.score = p2Material + p2Result;

        // Determine actual winner for bracket progression
        let actualWinnerId = winnerId;
        if (!actualWinnerId) {
            actualWinnerId = (match.player1.score > match.player2.score) ? match.player1.userId :
                           (match.player2.score > match.player1.score) ? match.player2.userId :
                           (Math.random() > 0.5 ? match.player1.userId : match.player2.userId);
        }

        match.winnerId = actualWinnerId;
        const actualResult = (actualWinnerId === match.player1.userId) ? 'player1_win' : 'player2_win';
        const tState = activeTourneys.get(match.tournamentId);

        // Find and mark the loser as eliminated in tState
        if (tState) {
            const actualLoserId = (actualWinnerId === match.player1.userId) ? match.player2.userId : match.player1.userId;
            
            if (actualLoserId) {
                const pIdx = tState.players.findIndex(p => p.user_id === actualLoserId);
                if (pIdx !== -1) {
                    tState.players[pIdx].status = 'eliminated';
                    // Update player score in tState for leaderboard
                    tState.players[pIdx].score += (actualLoserId === match.player1.userId ? match.player1.score : match.player2.score);

                    // Notify eliminated player
                    const sockets = userSockets.get(actualLoserId);
                    if (sockets) {
                        sockets.forEach(sid => {
                            this.io.to(sid).emit('tournament_msg', { message: 'You have been eliminated.' });
                            this.io.to(sid).emit('tournament_eliminated');
                        });
                    }
                }
                
                // Update winner score in tState too
                const wIdx = tState.players.findIndex(p => p.user_id === actualWinnerId);
                if (wIdx !== -1) {
                    tState.players[wIdx].score += (actualWinnerId === match.player1.userId ? match.player1.score : match.player2.score);
                }
            }
            this.broadcastState(tState.id);
        }

        supabase.from('matches').update({ 
            result: actualResult, 
            winner_id: actualWinnerId, 
            status: 'finished', 
            end_time: new Date().toISOString(),
            player1_score: match.player1.score,
            player2_score: match.player2.score
        }).eq('id', matchId).then(()=>{});

        supabase.from('tournament_players').update({ score: match.player1.score }).eq('tournament_id', match.tournamentId).eq('user_id', match.player1.userId).then(()=>{});
        supabase.from('tournament_players').update({ score: match.player2.score }).eq('tournament_id', match.tournamentId).eq('user_id', match.player2.userId).then(()=>{});

        this.broadcastState(match.tournamentId);
        this.io.to(match.roomId).emit('game_over', {
            result: actualResult, winnerId: actualWinnerId, reason, fen: match.fen,
            p1_score: match.player1.score, p2_score: match.player2.score
        });
        processMatchResult(matchId, result, winnerId, match.fen).catch(() => {});
        activeTournamentMatches.delete(matchId);
    }

    static handleMove(userId, matchId, moveSan) {
        const match = activeTournamentMatches.get(matchId);
        if (!match || match.status === 'finished') return;

        // If a move is made, the match is definitely live
        if (match.status === 'waiting_connect') {
            console.log(`✅ Match ${matchId} activated by move from ${userId}`);
            match.status = 'live';
        }

        try {
            const moveData = match.chess.move(moveSan);
            if (!moveData) return false;
            match.turn = match.chess.turn(); match.fen = match.chess.fen();
            this.io.to(match.roomId).emit('move_made', { 
                move: moveData, 
                fen: match.fen, 
                turn: match.turn,
                white_time: match.player1.time,
                black_time: match.player2.time
            });
            if (match.chess.isGameOver()) {
                const r = match.chess.isCheckmate() ? (match.chess.turn() === 'w' ? 'player2_win' : 'player1_win') : 'draw';
                const w = match.chess.isCheckmate() ? (match.chess.turn() === 'w' ? match.player2.userId : match.player1.userId) : null;
                this.resolveMatch(matchId, r, w, 'board');
            }
            return true;
        } catch(e) { return false; }
    }

    static async finishTournament(tId, tState) {
        tState.status = 'completed';
        this.broadcastState(tId);
        await supabase.from('tournaments').update({ status: 'completed', phase: 'completed' }).eq('id', tId);
        const { distributeTournamentPrizes, autoCreatePaidTournaments } = require('../controllers/tournament.controller');
        const { data: tData } = await supabase.from('tournaments').select('*').eq('id', tId).single();
        if (tData) await distributeTournamentPrizes(tData);
        activeTourneys.delete(tId);
        autoCreatePaidTournaments().catch(() => {});
    }

    static broadcastState(tournamentId) {
        const tState = activeTourneys.get(tournamentId);
        if (!tState || !this.io) return;
        const cleanState = {
            id: tState.id, tr_id: tState.tr_id, status: tState.status, phase: tState.phase,
            countdown: tState.countdown, round: tState.round,
            players: tState.players.map(p => ({ user_id: p.user_id, username: p.username, rank: p.rank, score: p.score, status: p.status, slot: p.slot })),
            matches: tState.matches.map(m => ({
                id: m.id, roomId: m.roomId, status: m.status,
                player1: { userId: m.player1.userId, time: m.player1.time, score: m.player1.score, connected: m.player1.connected },
                player2: { userId: m.player2.userId, time: m.player2.time, score: m.player2.score, connected: m.player2.connected },
                fen: m.fen
            }))
        };
        this.io.to(`tournament_${tournamentId}`).emit(`tournament_sync_${tournamentId}`, cleanState);
    }

    static onPlayerConnected(userId, socket) {
        activeTourneys.forEach((tState, tId) => {
            if (tState.allPlayers.some(p => p.user_id === userId)) {
                socket.join(`tournament_${tId}`);
                this.broadcastState(tId);
            }
        });
        activeTournamentMatches.forEach((match, matchId) => {
            if (match.player1.userId === userId || match.player2.userId === userId) {
                this.rejoinMatch(socket, matchId, userId);
            }
        });
    }

    static rejoinMatch(socket, matchId, userId) {
        const match = activeTournamentMatches.get(matchId);
        if (!match) return false;
        if (match.player1.userId === userId) { match.player1.socketId = socket.id; match.player1.connected = true; }
        else if (match.player2.userId === userId) { match.player2.socketId = socket.id; match.player2.connected = true; }
        else return false;

        if (match.status === 'waiting_connect' && match.player1.connected && match.player2.connected) match.status = 'live';
        socket.join(match.roomId);
        socket.emit('match_rejoined', {
            roomId: match.roomId, fen: match.chess.fen(), turn: match.turn,
            white_time: match.player1.time, black_time: match.player2.time,
            color: match.player1.userId === userId ? 'white' : 'black',
            opponent: match.player1.userId === userId ? match.player2 : match.player1
        });
        return true;
    }

    static handleDisconnect(userId) {
        activeTournamentMatches.forEach((match) => {
            if (match.player1.userId === userId) { match.player1.connected = false; match.disconnectGrace = 10; }
            else if (match.player2.userId === userId) { match.player2.connected = false; match.disconnectGrace = 10; }
        });
    }

    static async transitionToLive(tournamentId) {
        const tState = activeTourneys.get(tournamentId);
        if (!tState || tState.status === 'live') return;

        // FINAL CAPACITY CHECK BEFORE GOING LIVE
        const { count } = await supabase.from('tournament_players').select('*', { count: 'exact', head: true }).eq('tournament_id', tournamentId);
        if (count < (tState.max_players || 32)) {
            console.log(`🚫 Refusing to transition TR-${tState.tr_id} to live: Not full (${count}/${tState.max_players})`);
            tState.status = 'upcoming'; // Revert or stay in upcoming
            tState.countdown = 60; // Reset countdown
            return;
        }

        // Update memory immediately to prevent re-entry
        tState.status = 'live';
        tState.phase = 'lobby';
        tState.countdown = 120;

        const liveLobbyEndsAt = new Date(Date.now() + 120000).toISOString();
        const { data: t, error } = await supabase.from('tournaments')
            .update({ status: 'live', phase: 'lobby', live_lobby_ends_at: liveLobbyEndsAt })
            .eq('id', tournamentId).select().single();

        if (error) return console.error('Transition Error:', error);

        if (t && !t.next_created) {
            await supabase.from('tournaments').update({ next_created: true }).eq('id', tournamentId);
            const { autoCreatePaidTournaments } = require('../controllers/tournament.controller');
            autoCreatePaidTournaments().catch(()=>{});
        }
        this.broadcastState(tournamentId);
    }

    static async recoverStuckTournaments() {
        const { data: stuck } = await supabase.from('tournaments').select('*').in('status', ['full', 'starting']).eq('type', 'paid');
        if (!stuck) return;
        for (const t of stuck) {
            if (new Date() >= new Date(t.start_time)) {
                await this.pickupTournament(t.id);
                await this.transitionToLive(t.id);
            }
        }
    }
}

module.exports = TournamentManager;
