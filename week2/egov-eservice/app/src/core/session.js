'use strict';
// session ในหน่วยความจำ (cookie HttpOnly 'egov_sid') · reset ล้างทุก session (CONTRACT §0 ข้อ 9)
// req.user  = ผู้ใช้ที่ล็อกอินครบแล้ว { kind:'staff'|'citizen', username, name, role, dept, citizenId }
// req.pending = ประชาชนที่ยืนยัน OTP แล้วแต่ยังไม่ลงทะเบียน { citizenId, name } (ใช้ได้เฉพาะ /register)
// บทบาท/แผนกถูก "snapshot" ตอนล็อกอิน → admin เปลี่ยนบทบาทแล้วมีผลกับการล็อกอินครั้งถัดไป

const nodeCrypto = require('node:crypto');
const errors = require('./errors');

const COOKIE = 'egov_sid';
const sessions = new Map();

const LANDING = {
  citizen: '/citizen', officer: '/officer/queue', head: '/head/approvals',
  executive: '/dashboard', auditor: '/audit', admin: '/admin/services',
};
/** หน้าตั้งต้นตามบทบาท (CONTRACT §1) */
function landingFor(user) { return (user && LANDING[user.role]) || '/login'; }

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) {
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
    }
  }
  return out;
}

function setCookie(res, sid) {
  res.append('Set-Cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
}
function clearCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** middleware: อ่าน cookie → req.sid, req.session, req.user, req.pending */
function load(req, res, next) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  const s = sid ? sessions.get(sid) : null;
  req.sid = s ? sid : null;
  req.session = s || null;
  req.user = s && s.kind !== 'pending' ? s.user : null;
  req.pending = s && s.kind === 'pending' ? s.pending : null;
  next();
}

function create(res, data) {
  const sid = nodeCrypto.randomBytes(32).toString('hex');
  sessions.set(sid, data);
  setCookie(res, sid);
  return sid;
}

/** ล็อกอินเจ้าหน้าที่จากแถว users → user object */
function loginStaff(req, res, row) {
  if (req && req.sid) sessions.delete(req.sid);
  const user = { kind: 'staff', username: row.username, name: row.display_name, role: row.role, dept: row.dept || null, citizenId: null };
  create(res, { kind: 'staff', user });
  return user;
}

/**
 * ล็อกอินประชาชนจากแถว citizens
 * registered = 1 → session เต็ม (role citizen) · ยังไม่ลงทะเบียน → session "pending" ใช้ได้เฉพาะ /register
 */
function loginCitizen(req, res, row) {
  if (req && req.sid) sessions.delete(req.sid);
  if (!row.registered) {
    const pending = { citizenId: row.id, name: row.name };
    create(res, { kind: 'pending', pending });
    return null;
  }
  const user = { kind: 'citizen', username: null, name: row.name, role: 'citizen', dept: null, citizenId: row.id };
  create(res, { kind: 'citizen', user });
  return user;
}

/** เลื่อน session pending → citizen เต็ม หลังลงทะเบียนสำเร็จ (ใช้ sid เดิม) */
function promotePending(req, row) {
  if (!req.sid) return null;
  const user = { kind: 'citizen', username: null, name: row.name, role: 'citizen', dept: null, citizenId: row.id };
  sessions.set(req.sid, { kind: 'citizen', user });
  req.user = user; req.pending = null;
  return user;
}

function logout(req, res) {
  if (req.sid) sessions.delete(req.sid);
  req.sid = null; req.session = null; req.user = null; req.pending = null;
  clearCookie(res);
}

/** ล้าง session ทุกคน (reset) */
function clearAll() { sessions.clear(); }
function count() { return sessions.size; }

const isApi = (req) => (req.originalUrl || req.url).startsWith('/api/');

/**
 * requireRole('officer','head') → middleware
 * หน้าเว็บ: ไม่ล็อกอิน → 302 /login (ประชาชนค้างลงทะเบียน → /register) · บทบาทไม่ตรง → 403 + forbidden-msg
 * API (/api/*): ไม่ล็อกอิน → 401 UNAUTHENTICATED · บทบาทไม่ตรง → 403 FORBIDDEN
 * ไม่ส่ง role → แค่ต้องล็อกอิน
 */
function requireRole(...roles) {
  const allow = new Set(roles.flat());
  return function roleGuard(req, res, next) {
    const api = isApi(req);
    if (!req.user) {
      if (api) return errors.sendError(res, 'UNAUTHENTICATED');
      return res.redirect(302, req.pending ? '/register' : '/login');
    }
    if (allow.size && !allow.has(req.user.role)) {
      if (api) return errors.sendError(res, 'FORBIDDEN');
      return require('./layout').sendForbidden(req, res);
    }
    next();
  };
}
const requireLogin = () => requireRole();

module.exports = {
  COOKIE, LANDING, landingFor, parseCookies, load,
  loginStaff, loginCitizen, promotePending, logout, clearAll, count,
  requireRole, requireLogin, isApi,
};
