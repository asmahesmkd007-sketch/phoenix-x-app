const express = require('express');
const auth = require('../middleware/auth.middleware');
const fc = require('../controllers/friend.controller');

const friendRouter = express.Router();
friendRouter.get('/', auth, fc.getFriends);
friendRouter.delete('/:id', auth, fc.removeFriend);
friendRouter.post('/request', auth, fc.sendRequest);
friendRouter.get('/requests', auth, fc.getRequests);
friendRouter.put('/requests', auth, fc.respondRequest);
friendRouter.get('/challenges', auth, fc.getChallenges);
friendRouter.put('/challenges', auth, fc.respondChallenge);

module.exports = friendRouter;
