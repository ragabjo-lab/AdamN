'use strict';
const express = require('express');
const auth = require('../lib/auth');
const staffService = require('../services/staff');
const { idField } = require('../lib/validate');

const router = express.Router();

router.get('/', auth.requirePerm('staff.read'), (req, res) => {
  res.json(staffService.list(req.query));
});

router.get('/salary-history', auth.requirePerm('payroll.read'), (req, res) => {
  res.json({ items: staffService.salaryHistory(req.query) });
});

router.get('/:id', auth.requirePerm('staff.read'), (req, res) => {
  res.json(staffService.getById(idField(req.params.id)));
});

router.post('/', auth.requirePerm('staff.write'), (req, res) => {
  const created = staffService.create(req.body);
  auth.audit(req.user, 'create', 'staff', created.id, { name: created.fullName });
  res.status(201).json(created);
});

router.put('/:id', auth.requirePerm('staff.write'), (req, res) => {
  const id = idField(req.params.id);
  const updated = staffService.update(id, req.body);
  auth.audit(req.user, 'update', 'staff', id, { name: updated.fullName, salary: updated.baseSalary });
  res.json(updated);
});

router.delete('/:id', auth.requirePerm('staff.delete'), (req, res) => {
  const id = idField(req.params.id);
  staffService.remove(id);
  auth.audit(req.user, 'delete', 'staff', id);
  res.json({ ok: true, id });
});

/* ---------- payroll (monthly snapshots) ---------- */
router.get('/payroll/:period', auth.requirePerm('payroll.read'), (req, res) => {
  res.json(staffService.payroll(req.params.period));
});

router.put('/payroll/:period', auth.requirePerm('payroll.write'), (req, res) => {
  const result = staffService.savePayroll(req.params.period, req.body.entries, req.user);
  auth.audit(req.user, 'payroll-save', 'payroll', null, { period: req.params.period, entries: (req.body.entries || []).length });
  res.json(result);
});

router.delete('/payroll/row/:id', auth.requirePerm('payroll.write'), (req, res) => {
  const id = idField(req.params.id);
  res.json(staffService.removePayrollRow(id));
});

module.exports = router;
