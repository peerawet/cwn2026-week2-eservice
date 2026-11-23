'use strict';
// การเข้ารหัสข้อมูลส่วนบุคคล (NFR-04) · เลขบัตร · ลายเซ็นจำลอง (HMAC-SHA256 คีย์ทดสอบ · A-22) · รหัสผ่าน
// คีย์ทดสอบคงที่ (ตั้งเองได้ด้วย env DATA_KEY / SIGN_KEY) — ตัวจำลอง ไม่ใช่ระบบจริง

const nodeCrypto = require('node:crypto');

const DATA_KEY = nodeCrypto.createHash('sha256').update(process.env.DATA_KEY || 'egov-demo-data-key-v1').digest(); // AES-256
const INDEX_KEY = nodeCrypto.createHash('sha256').update('blind-index|' + (process.env.DATA_KEY || 'egov-demo-data-key-v1')).digest();
const SIGN_KEY = process.env.SIGN_KEY || 'egov-demo-sign-key-v1';

// ---------- AES-256-GCM ----------
/** เข้ารหัสสตริง → 'v1.<iv>.<tag>.<ciphertext>' (base64url) · null/'' → null */
function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = nodeCrypto.randomBytes(12);
  const c = nodeCrypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
/** ถอดรหัสค่าจาก encrypt() · null → null */
function decrypt(token) {
  if (token == null || token === '') return null;
  const [v, iv, tag, ct] = String(token).split('.');
  if (v !== 'v1') throw new Error('unknown ciphertext version');
  const d = nodeCrypto.createDecipheriv('aes-256-gcm', DATA_KEY, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
/** ค่าค้นหาแบบกำหนดได้ (HMAC) ของเลขบัตร ใช้เป็น key ใน DB แทนเลขจริง */
function blindIndex(value) {
  return nodeCrypto.createHmac('sha256', INDEX_KEY).update(String(value)).digest('hex');
}

// ---------- เลขบัตรประชาชน ----------
/** BR-01: ตัวเลข 13 หลักพอดี + checksum */
function isValidThaiId(s) {
  if (typeof s !== 'string' || !/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(s[12]);
}
/** '3100600987659' → '3-1006-00987-65-9' (ประชาชนเห็นของตัวเอง) */
function formatThaiId(s) {
  if (!s || s.length !== 13) return s || '';
  return `${s[0]}-${s.slice(1, 5)}-${s.slice(5, 10)}-${s.slice(10, 12)}-${s[12]}`;
}
/** '3100600987659' → 'X-XXXX-XXXXX-65-9' (จอเจ้าหน้าที่ทุกบทบาท · เห็น 3 หลักท้าย) */
function maskThaiId(s) {
  if (!s || s.length !== 13) return 'X-XXXX-XXXXX-XX-X';
  return `X-XXXX-XXXXX-${s.slice(10, 12)}-${s[12]}`;
}

// ---------- ลายเซ็นจำลอง ----------
/** HMAC-SHA256 ของฟิลด์ตามลำดับที่ส่งมา (ต่อกันด้วย '|') → hex */
function sign(fields) {
  return nodeCrypto.createHmac('sha256', SIGN_KEY).update(fields.map((f) => String(f ?? '')).join('|')).digest('hex');
}
/** ตรวจลายเซ็น (timing-safe) */
function verifySignature(fields, signature) {
  const a = Buffer.from(sign(fields), 'hex');
  let b;
  try { b = Buffer.from(String(signature || ''), 'hex'); } catch { return false; }
  return a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
}
/** ฟิลด์เอกสารตามลำดับ CONTRACT §3: docNo, caseNo, applicant, serviceId, issuedAt, validUntil, signer */
function docSignFields(d) {
  return [d.doc_no, d.case_no, d.applicant, d.service_id, d.issued_at, d.valid_until, d.signer];
}

// ---------- รหัสผ่าน ----------
const pwCache = new Map();
/** scrypt (ผล cache ต่อ password+salt เพื่อให้ reset เร็ว) */
function hashPassword(password, salt = nodeCrypto.randomBytes(16).toString('hex')) {
  const k = salt + '|' + password;
  if (!pwCache.has(k)) pwCache.set(k, nodeCrypto.scryptSync(password, salt, 32).toString('hex'));
  return `scrypt$${salt}$${pwCache.get(k)}`;
}
function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const again = hashPassword(password, salt).split('$')[2];
  const a = Buffer.from(again, 'hex'); const b = Buffer.from(hash, 'hex');
  return a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
}

// ---------- สุ่ม ----------
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** รหัส [A-Z0-9]{n} (รหัสตรวจสอบเอกสาร 8 ตัว) */
function randomCode(n = 8) {
  const bytes = nodeCrypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALNUM[bytes[i] % ALNUM.length];
  return s;
}
function randomToken(bytes = 32) { return nodeCrypto.randomBytes(bytes).toString('hex'); }

module.exports = {
  encrypt, decrypt, blindIndex,
  isValidThaiId, formatThaiId, maskThaiId,
  sign, verifySignature, docSignFields,
  hashPassword, verifyPassword,
  randomCode, randomToken,
};
