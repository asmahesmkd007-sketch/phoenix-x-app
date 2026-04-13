const io = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// We need two sockets to simulate two players connecting
const socket1 = io('http://localhost:3000', { transports: ['websocket'] });
const socket2 = io('http://localhost:3000', { transports: ['websocket'] });

socket1.on('connect', () => {
    console.log('Socket 1 connected');
    socket1.emit('find_match', { timer: 1, userId: '369a0f11-87c1-4804-977f-43db5ecb94f3', username: '@mobiletest' });
});

socket1.on('searching', () => console.log('Socket 1 searching'));
socket1.on('match_found', (data) => console.log('Socket 1 MATCH FOUND', data));

socket2.on('connect', () => {
    console.log('Socket 2 connected');
    // Delay slightly to ensure Socket 1 is queued
    setTimeout(() => {
        socket2.emit('find_match', { timer: 1, userId: 'b3713980-e52f-47d7-a4b7-c234d64bd184', username: '@yasvand' });
    }, 1000);
});

socket2.on('searching', () => console.log('Socket 2 searching'));
socket2.on('match_found', (data) => console.log('Socket 2 MATCH FOUND', data));

setTimeout(() => {
    console.log('Done test');
    process.exit(0);
}, 3000);
