'use strict';
// Test hook (CONTRACT §8) — เปิดเฉพาะ TEST_MODE=1 · ไม่ตั้ง → /api/test/* ตอบ 404 ทั้งหมด
// POST /api/test/reset                     ล้างทุกตาราง + seed + นาฬิกาค่าเริ่มต้น + ล้าง session ทุกคน
// GET|PUT /api/test/clock                  อ่าน/ตั้งนาฬิกา (ต้องมี offset ไม่งั้น 400 INVALID_TIME)
// POST /api/test/payments/:ref/pay         → hooks.testPay handler (citizen) · ยังไม่มี → 501
// POST /api/test/documents/:docNo/tamper   → hooks.testTamper handler (mgmt) · ยังไม่มี → 501

const clock = require('./clock');
const db = require('./db');
const session = require('./session');
const hooks = require('./hooks');
const errors = require('./errors');

const TEST_MODE = process.env.TEST_MODE === '1';

/** ล้างทุกอย่างแล้ว seed ใหม่ → คืน now (ISO) */
function resetAll() {
  const { seedAll } = require('../seed');
  clock.reset();
  session.clearAll();
  db.tx(() => { db.wipeAll(); seedAll(); });
  db.compactIfNeeded();
  hooks.runReset();
  return clock.nowIso();
}

function register(app) {
  const notFound = (req, res) => errors.sendError(res, 'NOT_FOUND', {}, 'Not Found');
  if (!TEST_MODE) {
    app.all(/^\/api\/test(\/.*)?$/, notFound);
    return;
  }

  app.post('/api/test/reset', (req, res) => {
    const now = resetAll();
    res.json({ ok: true, now });
  });

  app.get('/api/test/clock', (req, res) => res.json({ now: clock.nowIso() }));

  app.put('/api/test/clock', (req, res) => {
    const now = req.body && typeof req.body.now === 'string' ? clock.set(req.body.now) : null;
    if (!now) return errors.sendError(res, 'INVALID_TIME');
    res.json({ now });
  });

  app.post('/api/test/payments/:ref/pay', errors.wrap((req, res, next) => {
    const h = hooks.payHandler;
    if (!h) return errors.sendError(res, 'NOT_IMPLEMENTED');
    return h(req, res, next);
  }));

  app.post('/api/test/documents/:docNo/tamper', errors.wrap((req, res, next) => {
    const h = hooks.tamperHandler;
    if (!h) return errors.sendError(res, 'NOT_IMPLEMENTED');
    return h(req, res, next);
  }));

  app.all(/^\/api\/test(\/.*)?$/, notFound);
}

module.exports = { TEST_MODE, resetAll, register };
