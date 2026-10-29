'use strict';
const express = require('express');
const auth = require('../lib/auth');
const finance = require('../services/finance');

const router = express.Router();

router.get('/month/:period', auth.requirePerm('finance.read'), (req, res) => {
  res.json(finance.monthOverview(req.params.period));
});

router.get('/detail/:period', auth.requirePerm('finance.read'), (req, res) => {
  res.json(finance.detail(req.params.period));
});

router.get('/year/:year', auth.requirePerm('finance.read'), (req, res) => {
  res.json(finance.yearOverview(req.params.year));
});

router.get('/year', auth.requirePerm('finance.read'), (req, res) => {
  res.json(finance.yearOverview(req.query.year));
});

module.exports = router;
