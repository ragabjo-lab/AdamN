'use strict';
const express = require('express');
const auth = require('../lib/auth');
const ledger = require('../services/ledger');
const { idField } = require('../lib/validate');

function kindRouter(kind) {
  const router = express.Router();
  const readPerm = `${kind}.read`;
  const writePerm = `${kind}.write`;
  const deletePerm = `${kind}.delete`;

  router.get('/', auth.requirePerm(readPerm), (req, res) => {
    res.json(ledger.list(kind, req.query));
  });
  router.post('/', auth.requirePerm(writePerm), (req, res) => {
    const created = ledger.create(kind, req.body, req.user);
    auth.audit(req.user, 'create', kind, created.id, { amount: created.amount, description: created.description });
    res.status(201).json(created);
  });
  router.put('/:id', auth.requirePerm(writePerm), (req, res) => {
    const id = idField(req.params.id);
    const updated = ledger.update(kind, id, req.body);
    auth.audit(req.user, 'update', kind, id, { amount: updated.amount });
    res.json(updated);
  });
  router.delete('/:id', auth.requirePerm(deletePerm), (req, res) => {
    const id = idField(req.params.id);
    ledger.remove(kind, id);
    auth.audit(req.user, 'delete', kind, id);
    res.json({ ok: true, id });
  });
  return router;
}

module.exports = { revenue: kindRouter('revenue'), expense: kindRouter('expense') };
