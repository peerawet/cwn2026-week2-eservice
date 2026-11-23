'use strict';
// ตัวช่วยอ่าน/เขียนผู้ใช้ (users) และประชาชน (citizens) · ถอด/เข้ารหัสข้อมูลส่วนบุคคลให้อัตโนมัติ

const db = require('./db');
const clock = require('./clock');
const crypto = require('./crypto');

// ---------- เจ้าหน้าที่ ----------
/** แถว users ตาม username (รวม password_hash) หรือ undefined */
function getUser(username) { return db.get('SELECT * FROM users WHERE username = ?', username); }
/** ชื่อแสดงของ username (ไม่มี → คืน username เดิม) */
function displayName(username) {
  if (!username) return '';
  const r = db.get('SELECT display_name FROM users WHERE username = ?', username);
  return r ? r.display_name : username;
}
/** เจ้าหน้าที่ (officer) ที่ active ของแผนก เรียง username */
function officersOfDept(dept) {
  return db.all("SELECT * FROM users WHERE role = 'officer' AND dept = ? AND active = 1 ORDER BY username", dept);
}
/** หัวหน้าฝ่ายทั้งหมด (seed มี head1 คนเดียว · A-60) */
function heads() { return db.all("SELECT * FROM users WHERE role = 'head' AND active = 1 ORDER BY username"); }
/** รายชื่อผู้ใช้ทั้งหมด (ไม่มี password_hash) */
function listUsers() {
  return db.all('SELECT username, display_name, role, dept, active FROM users ORDER BY rowid');
}

// ---------- ประชาชน ----------
function decode(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    idNo: crypto.decrypt(row.id_enc),
    name: row.name,
    mobile: crypto.decrypt(row.mobile_enc),
    email: row.email || '',
    registered: !!row.registered,
    consentAt: row.consent_at,
    registeredAt: row.registered_at,
    _row: row,
  };
}
/** ค้นประชาชนจากเลขบัตร 13 หลัก (ผ่าน blind index) → object ถอดรหัสแล้ว หรือ undefined */
function findCitizenByIdNo(idNo) {
  return decode(db.get('SELECT * FROM citizens WHERE id_hash = ?', crypto.blindIndex(idNo)));
}
/** ประชาชนตาม id → { id, idNo, name, mobile, email, registered, ... } */
function getCitizen(id) { return decode(db.get('SELECT * FROM citizens WHERE id = ?', id)); }
/** แถวดิบ (มี registered) สำหรับส่งให้ session.loginCitizen */
function getCitizenRow(id) { return db.get('SELECT * FROM citizens WHERE id = ?', id); }

/** สร้างประชาชนใหม่ (ยังไม่ลงทะเบียน) → id */
function createCitizen({ idNo, name }) {
  const r = db.run(
    'INSERT INTO citizens(id_hash, id_enc, name, mobile_enc, email, registered, created_at) VALUES (?, ?, ?, NULL, \'\', 0, ?)',
    crypto.blindIndex(idNo), crypto.encrypt(idNo), name, clock.nowIso(),
  );
  return Number(r.lastInsertRowid);
}
/** ลงทะเบียน: เก็บเบอร์ (เข้ารหัส) อีเมล ความยินยอม */
function registerCitizen(id, { mobile, email = '' }) {
  const now = clock.nowIso();
  db.run('UPDATE citizens SET mobile_enc = ?, email = ?, registered = 1, consent_at = ?, registered_at = ? WHERE id = ?',
    crypto.encrypt(mobile), email || '', now, now, id);
}

module.exports = {
  getUser, displayName, officersOfDept, heads, listUsers,
  findCitizenByIdNo, getCitizen, getCitizenRow, createCitizen, registerCitizen,
};
