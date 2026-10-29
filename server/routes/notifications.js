'use strict';
const express = require('express');
const auth = require('../lib/auth');
const notifications = require('../services/notifications');
const { idField } = require('../lib/validate');

const router = express.Router();

router.get('/', auth.requirePerm('notifications.read'), (req, res) => {
  res.json(notifications.list(req.query));
});

router.get('/count', auth.requireAuth, (req, res) => {
  res.json({ unread: notifications.unreadCount() });
});

router.post('/refresh', auth.requireAuth, (req, res) => {
  const result = notifications.generate();
  const payload = notifications.list({ pageSize: 20 });
  res.json({ ...payload, generated: result.created });
});

router.post('/:id/read', auth.requireAuth, (req, res) => {
  res.json(notifications.markRead(idField(req.params.id), req.body && req.body.read !== false));
});

router.post('/read-all', auth.requireAuth, (req, res) => {
  res.json(notifications.markAllRead());
});

router.delete('/read', auth.requireAuth, (req, res) => {
  res.json(notifications.clearRead());
});

router.delete('/:id', auth.requireAuth, (req, res) => {
  res.json(notifications.remove(idField(req.params.id)));
});

module.exports = router;
