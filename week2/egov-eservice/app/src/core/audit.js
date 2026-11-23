'use strict';
// Audit Trail (BR-27) · เพิ่มได้อย่างเดียว · เวลาจากนาฬิกากลาง
// บันทึกเฉพาะเหตุการณ์ที่ "สำเร็จจริง" (A-36) — เรียก log() หลังเปลี่ยนข้อมูลสำเร็จแล้วเท่านั้น

const db = require('./db');
const clock = require('./clock');

const EVENTS = ['STAFF_LOGIN', 'CLAIM', 'RETURN', 'FORWARD', 'APPROVE', 'REJECT', 'ISSUE', 'UNMASK', 'EXPORT', 'ADMIN_CHANGE'];

/**
 * log({ user, event, caseNo, fromStatus, toStatus, detail })  — user = req.user (ใช้ username/role)
 * หรือ log({ username, role, event, ... })
 * คืน id ของแถว
 */
function log(e) {
  if (!EVENTS.includes(e.event)) throw new Error(`unknown audit event ${e.event}`);
  const username = e.username || (e.user && e.user.username);
  const role = e.role || (e.user && e.user.role);
  if (!username || !role) throw new Error('audit.log requires username and role');
  const ms = clock.now();
  const r = db.run(
    `INSERT INTO audit_log(time, time_ms, username, role, event, case_no, from_status, to_status, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    clock.toIso(ms), ms, username, role, e.event, e.caseNo || null, e.fromStatus || null, e.toStatus || null,
    e.detail == null ? '' : String(e.detail),
  );
  return Number(r.lastInsertRowid);
}

/** แถว DB → รูปแบบ API §6.4 */
function toItem(r) {
  return {
    id: r.id, time: r.time, username: r.username, role: r.role, event: r.event,
    caseNo: r.case_no, fromStatus: r.from_status, toStatus: r.to_status, detail: r.detail,
  };
}

/**
 * ค้น Audit ตามตัวกรอง (ทุกตัวไม่บังคับ): { actor, event, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * ช่วงวันที่รวมวันเริ่มและวันจบตามเวลาไทย · เรียงใหม่ → เก่า (เวลาเท่ากันใช้ id มากก่อน)
 * คืน { count, items: [...toItem] }
 */
function query(f = {}) {
  const where = []; const params = [];
  if (f.actor) { where.push('username = ?'); params.push(String(f.actor).trim()); }
  if (f.event) { where.push('event = ?'); params.push(String(f.event)); }
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) { where.push('time_ms >= ?'); params.push(clock.bkkMs(f.from, '00:00:00')); }
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) { where.push('time_ms < ?'); params.push(clock.bkkMs(clock.addDays(f.to, 1), '00:00:00')); }
  const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY time_ms DESC, id DESC`;
  const items = db.all(sql, ...params).map(toItem);
  return { count: items.length, items };
}

module.exports = { EVENTS, log, query, toItem };
