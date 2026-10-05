'use strict';
const express = require('express');
const { isAdmin } = require('../memory-core/principal');
const { listResidents, saveResident, residentConnection, updateResidentProfile } = require('../memory-core/residents');

module.exports = function memoryResidents(memoryDB) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    try {
      const canManage = isAdmin(req.residentPrincipal);
      const items = (await listResidents(memoryDB)).filter(row => canManage || row.id === req.residentPrincipal.residentId);
      res.json({ items, canManage });
    }
    catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
  });
  router.use((req, res, next) => isAdmin(req.residentPrincipal) ? next() : res.status(403).json({ error: '请用管理登录添加身份或复制连接' }));
  router.post('/', async (req, res) => {
    try { res.status(201).json(await saveResident(memoryDB, req.body || {})); }
    catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
  });
  router.patch('/:id/profile', async (req, res) => {
    try { res.json(await updateResidentProfile(memoryDB, req.params.id, req.body || {})); }
    catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
  });
  router.post('/:id/connection', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await residentConnection(memoryDB, req.params.id)); }
    catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
  });
  return router;
};
