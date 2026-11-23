'use strict';
// จุดเริ่มเว็บ: Express + core + โมดูล citizen / workflow / mgmt (แต่ละตัว export register(app, ctx))
// env: PORT (3000) · DB_PATH (./data/egov.db) · TEST_MODE=1 · BUG_MODE=B03,B07 · EG_MODULES=citizen,workflow,mgmt

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const clock = require('./core/clock');
const db = require('./core/db');
const bugs = require('./core/bugs');
const session = require('./core/session');
const audit = require('./core/audit');
const crypto = require('./core/crypto');
const format = require('./core/format');
const layout = require('./core/layout');
const errors = require('./core/errors');
const hooks = require('./core/hooks');
const sla = require('./core/sla');
const catalog = require('./core/catalog');
const cases = require('./core/cases');
const people = require('./core/people');
const testhooks = require('./core/testhooks');
const seed = require('./seed');

const PORT = Number(process.env.PORT || 3000);
const TEST_MODE = process.env.TEST_MODE === '1';
const MODULES = (process.env.EG_MODULES || 'citizen,workflow,mgmt').split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.set('etag', false);

// body ≥ 6 MB (CONTRACT §0 ข้อ 10) — multipart ใช้ ctx.upload (multer) ซึ่งตั้งเพดานไว้ 8 MB ต่อไฟล์
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use('/static', express.static(path.join(__dirname, 'core', 'static'), { maxAge: 0 }));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.use(session.load);

// ทุก request ยกเว้น /api/test/* (และไฟล์ static) → hook ก่อนประมวลผล (CONTRACT §0 ข้อ 7)
app.use((req, res, next) => {
  if (/^\/api\/test(\/|$)/.test(req.path) || req.path.startsWith('/static/')) return next();
  hooks.runBefore(req).then(() => next(), next);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 10, fields: 50 } });

/** <BASE_URL> สำหรับลิงก์ภายนอก เช่น doc-qr data-url = `${ctx.baseUrl(req)}/verify/<code>` */
function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

const ctx = {
  config: { TEST_MODE, PORT, DB_PATH: db.DB_PATH, ROOT: path.resolve(__dirname, '..') },
  express, upload, baseUrl,
  db, clock, bugs, session, audit, crypto, format, layout, errors, hooks, sla, catalog, cases, people,
  seed, resetAll: testhooks.resetAll,
};

// ---------- route ของ core ----------
testhooks.register(app);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/', (req, res) => {
  if (req.user) return res.redirect(302, session.landingFor(req.user));
  return res.redirect(302, req.pending ? '/register' : '/login');
});

const doLogout = (req, res) => { session.logout(req, res); res.redirect(302, '/login'); };
app.get('/logout', doLogout);
app.post('/logout', doLogout);

app.post('/api/auth/logout', (req, res) => { session.logout(req, res); res.status(204).end(); });

app.get('/api/me', session.requireRole(), (req, res) => {
  const u = req.user;
  res.json({ username: u.username, name: u.name, role: u.role, dept: u.dept || null });
});

// ---------- โมดูล ----------
const loaded = [];
for (const name of MODULES) {
  const file = path.join(__dirname, 'modules', name, 'index.js');
  if (!fs.existsSync(file)) { console.log(`[modules] ${name}: ยังไม่มี ${path.relative(process.cwd(), file)} → ข้าม`); continue; }
  try {
    const mod = require(file);
    if (typeof mod.register !== 'function') throw new Error('ไม่ได้ export register(app, ctx)');
    mod.register(app, ctx);
    loaded.push(name);
  } catch (e) {
    console.error(`[modules] ${name}: โหลดไม่สำเร็จ`, e);
  }
}

// ---------- 404 / error ----------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return errors.sendError(res, 'NOT_FOUND');
  return layout.sendNotFound(req, res);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const api = req.path.startsWith('/api/');
  let code = 'INTERNAL'; let extra = {}; let msg;
  if (err instanceof errors.AppError) { code = err.code; extra = err.extra || {}; msg = err.message; }
  else if (err && err.name === 'MulterError') code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : (err.code === 'LIMIT_FILE_COUNT' ? 'FILE_COUNT' : 'BAD_REQUEST');
  else if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.status === 400)) code = 'BAD_REQUEST';
  else console.error('[error]', req.method, req.path, err);
  if (res.headersSent) return;
  if (api) return errors.sendError(res, code, extra, msg);
  layout.send(res, { req, title: 'เกิดข้อผิดพลาด', error: msg || errors.message(code), body: '' }, errors.status(code));
});

// ---------- เริ่ม ----------
if (TEST_MODE) {
  testhooks.resetAll();
} else if (!db.get('SELECT 1 AS x FROM users LIMIT 1')) {
  db.tx(() => seed.seedAll());
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[egov] http://localhost:${PORT} · TEST_MODE=${TEST_MODE ? '1' : '(ไม่ตั้ง)'} · ${bugs.describe()}`);
  console.log(`[egov] DB_PATH=${db.DB_PATH} · นาฬิกา=${clock.nowIso()}${clock.isFrozen() ? ' (แช่แข็ง)' : ''} · โมดูล=[${loaded.join(', ') || '-'}]`);
});

module.exports = { app, ctx };
