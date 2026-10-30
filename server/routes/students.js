'use strict';
const express = require('express');
const crypto = require('crypto');
const { store } = require('../db/connection');
const auth = require('../lib/auth');
const students = require('../services/students');
const { badRequest, notFound } = require('../lib/errors');
const { idField, periodField } = require('../lib/validate');
const time = require('../lib/time');
const { getSettings } = require('../services/settings');

const router = express.Router();

router.get('/', auth.requirePerm('students.read'), (req, res) => {
  res.json(students.list(req.query));
});

router.get('/summary', auth.requirePerm('students.read'), (req, res) => {
  const settings = getSettings();
  const today = time.todayISO(settings.timezone);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month || '') ? req.query.month : today.slice(0, 7);
  res.json(students.summaryFor(Number(req.query.year) || Number(today.slice(0, 4)), period));
});

router.get('/:id', auth.requirePerm('students.read'), (req, res) => {
  res.json(students.getById(idField(req.params.id), { year: req.query.year }));
});

router.post('/', auth.requirePerm('students.write'), (req, res) => {
  const created = students.create(req.body, req.user);
  auth.audit(req.user, 'create', 'student', created.id, { name: created.fullName });
  res.status(201).json(created);
});

router.put('/:id', auth.requirePerm('students.write'), (req, res) => {
  const id = idField(req.params.id);
  const updated = students.update(id, req.body);
  auth.audit(req.user, 'update', 'student', id, { name: updated.fullName });
  res.json(updated);
});

router.delete('/:id', auth.requirePerm('students.delete'), (req, res) => {
  const id = idField(req.params.id);
  students.remove(id);
  auth.audit(req.user, 'delete', 'student', id);
  res.json({ ok: true, id });
});

/* ---------- monthly subscription ---------- */
router.get('/:id/payments', auth.requirePerm('students.read'), (req, res) => {
  const id = idField(req.params.id);
  const student = students.getById(id, { year: req.query.year });
  res.json({ payments: student.payments, history: student.paymentHistory });
});

router.put('/:id/payments/:period', auth.requirePerm('students.write'), (req, res) => {
  const id = idField(req.params.id);
  const period = periodField(req.params.period);
  const result = students.setPayment(id, period, req.body, req.user);
  auth.audit(req.user, 'payment', 'student', id, result);
  res.json(result);
});

/* ---------- photos & attachments ---------- */
const PHOTO_MAX = 6 * 1024 * 1024;
const DOC_MAX = 18 * 1024 * 1024;
const PHOTO_TYPES = /^image\/(png|jpe?g|webp|gif|bmp)$/i;
const DOC_TYPES = /^(image\/(png|jpe?g|webp|gif|bmp)|application\/pdf|text\/plain|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/vnd\.ms-excel|application\/vnd\.ms-powerpoint|application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation)$/i;

function decodeFileName(req, fallback) {
  const raw = req.get('x-file-name');
  if (!raw) return fallback;
  try { return decodeURIComponent(raw).slice(0, 200); } catch { return fallback; }
}

function readBody(req) {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw badRequest('لم يتم إرسال أي ملف');
  }
  return req.body;
}

const rawParser = express.raw({ type: '*/*', limit: DOC_MAX + 1024 });

router.post('/:id/photo', auth.requirePerm('attachments.write'), rawParser, (req, res) => {
  const id = idField(req.params.id);
  const student = store.get('SELECT id, photo_id FROM students WHERE id = ?', [id]);
  if (!student) throw notFound('الطالب غير موجود');
  const data = readBody(req);
  if (data.length > PHOTO_MAX) throw badRequest('حجم الصورة يجب أن يكون أقل من 6 ميجابايت');
  const mime = String(req.get('content-type') || 'image/jpeg').split(';')[0];
  if (!PHOTO_TYPES.test(mime)) throw badRequest('صيغة الصورة غير مدعومة (png, jpg, webp, gif)');
  const now = new Date().toISOString();
  let photoId;
  store.transaction(() => {
    if (student.photo_id) store.run('DELETE FROM attachments WHERE id = ?', [student.photo_id]);
    const res2 = store.run(
      `INSERT INTO attachments (owner_type, owner_id, kind, file_name, mime, size, sha256, data, created_at, created_by)
       VALUES ('student', ?, 'photo', ?, ?, ?, ?, ?, ?, ?)`,
      [id, decodeFileName(req, 'photo'), mime, data.length, crypto.createHash('sha256').update(data).digest('hex'), data, now, req.user.id]
    );
    photoId = res2.lastInsertRowid;
    store.run('UPDATE students SET photo_id = ?, updated_at = ? WHERE id = ?', [photoId, now, id]);
  });
  auth.audit(req.user, 'upload-photo', 'student', id, { size: data.length });
  res.status(201).json({ photoId, photoUrl: `/api/attachments/${photoId}/raw` });
});

router.post('/:id/attachments', auth.requirePerm('attachments.write'), rawParser, (req, res) => {
  const id = idField(req.params.id);
  const student = store.get('SELECT id FROM students WHERE id = ?', [id]);
  if (!student) throw notFound('الطالب غير موجود');
  const data = readBody(req);
  if (data.length > DOC_MAX) throw badRequest('حجم الملف يجب أن يكون أقل من 18 ميجابايت');
  const mime = String(req.get('content-type') || 'application/octet-stream').split(';')[0];
  if (!DOC_TYPES.test(mime)) throw badRequest('صيغة الملف غير مدعومة (PDF, صور, Word, Excel, PowerPoint, نص)');
  const now = new Date().toISOString();
  const result = store.run(
    `INSERT INTO attachments (owner_type, owner_id, kind, file_name, mime, size, sha256, data, created_at, created_by)
     VALUES ('student', ?, 'document', ?, ?, ?, ?, ?, ?, ?)`,
    [id, decodeFileName(req, 'attachment'), mime, data.length, crypto.createHash('sha256').update(data).digest('hex'), data, now, req.user.id]
  );
  auth.audit(req.user, 'upload-attachment', 'student', id, { attachmentId: result.lastInsertRowid });
  res.status(201).json({
    id: result.lastInsertRowid,
    fileName: decodeFileName(req, 'attachment'),
    size: data.length,
    mime,
    url: `/api/attachments/${result.lastInsertRowid}/raw`,
  });
});

router.delete('/:id/photo', auth.requirePerm('attachments.write'), (req, res) => {
  const id = idField(req.params.id);
  const student = store.get('SELECT id, photo_id FROM students WHERE id = ?', [id]);
  if (!student) throw notFound('الطالب غير موجود');
  if (student.photo_id) {
    store.transaction(() => {
      store.run('DELETE FROM attachments WHERE id = ?', [student.photo_id]);
      store.run('UPDATE students SET photo_id = NULL, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    });
  }
  res.json({ ok: true });
});

module.exports = router;
