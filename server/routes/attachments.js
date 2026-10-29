'use strict';
const express = require('express');
const { store } = require('../db/connection');
const auth = require('../lib/auth');
const { notFound } = require('../lib/errors');
const { idField } = require('../lib/validate');

const router = express.Router();

router.get('/:id/raw', auth.requireAuth, (req, res) => {
  const id = idField(req.params.id);
  const row = store.get('SELECT * FROM attachments WHERE id = ?', [id]);
  if (!row) throw notFound('المرفق غير موجود');
  const buffer = Buffer.from(row.data);
  res.setHeader('Content-Type', row.mime || 'application/octet-stream');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const disposition = req.query.download ? 'attachment' : 'inline';
  const safeName = encodeURIComponent(row.file_name || 'file');
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${safeName}`);
  res.end(buffer);
});

router.get('/', auth.requireAuth, (req, res) => {
  const ownerType = String(req.query.ownerType || 'student');
  const ownerId = idField(req.query.ownerId);
  const rows = store.all(
    `SELECT id, file_name, mime, size, kind, created_at FROM attachments
      WHERE owner_type = ? AND owner_id = ? ORDER BY created_at DESC`,
    [ownerType, ownerId]
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id, fileName: r.file_name, mime: r.mime, size: r.size, kind: r.kind,
      createdAt: r.created_at, url: `/api/attachments/${r.id}/raw`,
      downloadUrl: `/api/attachments/${r.id}/raw?download=1`,
    })),
  });
});

router.delete('/:id', auth.requirePerm('attachments.write'), (req, res) => {
  const id = idField(req.params.id);
  const row = store.get('SELECT * FROM attachments WHERE id = ?', [id]);
  if (!row) throw notFound('المرفق غير موجود');
  store.transaction(() => {
    store.run('UPDATE students SET photo_id = NULL WHERE photo_id = ?', [id]);
    store.run('DELETE FROM attachments WHERE id = ?', [id]);
  });
  auth.audit(req.user, 'delete-attachment', row.owner_type, row.owner_id, { id });
  res.json({ ok: true, id });
});

module.exports = router;
