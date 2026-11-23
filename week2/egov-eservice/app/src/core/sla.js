'use strict';
// ฟังก์ชันวันทำการ "ตัวเดียว" ของทั้งระบบ (BR-12 BR-13 BR-14) — DECISIONS ข้อ 18: ใช้ทั้งกำหนดเสร็จและวันคงเหลือ
// วันทำการ = จันทร์–ศุกร์ ที่ไม่อยู่ในตาราง holidays (อ่านตาราง ณ เวลาที่เรียก)
// BUG B03: ไม่ข้ามวันหยุดในตาราง (ข้ามแค่เสาร์-อาทิตย์) → มีผลทุกจุดที่ใช้ไฟล์นี้ (ตามที่ BUGS.md ระบุ)

const clock = require('./clock');
const db = require('./db');
const bugs = require('./bugs');

const CUTOFF = '16:30:00';

function holidaySet() {
  if (bugs.isOn('B03')) return new Set();
  return new Set(db.all('SELECT date FROM holidays').map((r) => r.date));
}

/** 'YYYY-MM-DD' เป็นวันทำการหรือไม่ (hs = ชุดวันหยุด ส่งมาเพื่อลดการอ่าน DB) */
function isWorkday(dk, hs = holidaySet()) {
  const d = clock.dowOf(dk);
  return d !== 0 && d !== 6 && !hs.has(dk);
}
/** วันทำการถัดไป "หลัง" dk */
function nextWorkday(dk, hs = holidaySet()) {
  let d = clock.addDays(dk, 1);
  while (!isWorkday(d, hs)) d = clock.addDays(d, 1);
  return d;
}
/** วันทำการที่ n หลัง dk (n ≥ 0 · n = 0 → dk) */
function addWorkdays(dk, n, hs = holidaySet()) {
  let d = dk;
  for (let i = 0; i < n; i++) d = nextWorkday(d, hs);
  return d;
}
/** จำนวนวันทำการในช่วง (fromDk, toDk] (ไม่นับวันแรก นับวันสุดท้าย) · toDk ≤ fromDk → 0 */
function countWorkdays(fromDk, toDk, hs = holidaySet()) {
  let n = 0;
  for (let d = clock.addDays(fromDk, 1); d <= toDk; d = clock.addDays(d, 1)) if (isWorkday(d, hs)) n++;
  return n;
}

/**
 * BR-12 กำหนดเสร็จ: D0 = วันที่ชำระถ้าเป็นวันทำการและก่อน 16:30:00 ไม่เช่นนั้นวันทำการถัดไป
 * กำหนดเสร็จ = วันทำการที่ N หลัง D0 เวลา 16:30 → ISO '2026-12-04T16:30:00+07:00'
 */
function computeDueAt(paidAt, slaDays) {
  const ms = typeof paidAt === 'number' ? paidAt : clock.parseIso(paidAt);
  const hs = holidaySet();
  const dk = clock.dateKey(ms);
  const beforeCutoff = ms < clock.bkkMs(dk, CUTOFF);
  const d0 = isWorkday(dk, hs) && beforeCutoff ? dk : nextWorkday(dk, hs);
  return clock.toIso(clock.bkkMs(addWorkdays(d0, slaDays, hs), CUTOFF));
}

/**
 * BR-13 หยุดนับ: กำหนดใหม่ = กำหนดเดิม + จำนวนวันทำการใน (วันที่ตีกลับ, วันที่ส่งแก้] (นับตามวันที่)
 * ใช้ตารางวันหยุด ณ เวลาที่เรียก (= เวลาส่งแก้) · (BUG B04 = ไม่เรียกฟังก์ชันนี้ อยู่ที่โมดูล workflow)
 */
function extendDueAt(dueAt, returnedAt, resubmittedAt) {
  const hs = holidaySet();
  const paused = countWorkdays(clock.dateKey(clock.parseIso(returnedAt)), clock.dateKey(clock.parseIso(resubmittedAt)), hs);
  const dueDk = clock.dateKey(clock.parseIso(dueAt));
  return { dueAt: clock.toIso(clock.bkkMs(addWorkdays(dueDk, paused, hs), CUTOFF)), pausedDays: paused };
}

/** วันคงเหลือ = จำนวนวันทำการหลังวันนี้ถึงวันกำหนด (รวมวันกำหนด) */
function remainingWorkdays(dueAt, nowMs = clock.now()) {
  return countWorkdays(clock.dateKey(nowMs), clock.dateKey(clock.parseIso(dueAt)));
}

const CLOSED = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);
/**
 * BR-14 + A-33 ระดับเตือนของคำขอ ณ nowMs:
 * closed (COMPLETED/REJECTED/CANCELLED) · paused (NEED_FIX) · overdue (now > due) · near (เหลือ ≤ 1) · normal (≥ 2)
 * DRAFT/PENDING_PAYMENT หรือไม่มี due_at → null
 * c = แถว cases (ใช้ c.status, c.due_at)
 */
function levelOf(c, nowMs = clock.now()) {
  if (!c) return null;
  if (CLOSED.has(c.status)) return 'closed';
  if (c.status === 'NEED_FIX') return 'paused';
  if (!c.due_at || c.status === 'DRAFT' || c.status === 'PENDING_PAYMENT') return null;
  const due = clock.parseIso(c.due_at);
  if (nowMs > due) return 'overdue';
  return remainingWorkdays(c.due_at, nowMs) <= 1 ? 'near' : 'normal';
}

module.exports = {
  CUTOFF, holidaySet, isWorkday, nextWorkday, addWorkdays, countWorkdays,
  computeDueAt, extendDueAt, remainingWorkdays, levelOf,
};
