'use strict';
// นาฬิกากลางของระบบ (Asia/Bangkok +07:00 ไม่มี DST)
// กฎธุรกิจทุกข้อต้องอ่านเวลาจากที่นี่เท่านั้น ห้ามเรียก Date.now() / new Date() เอง
//
// TEST_MODE=1 → นาฬิกา "แช่แข็ง" (A-37) เริ่มที่ DEFAULT_NOW เปลี่ยนได้ด้วย set() / PUT /api/test/clock
// ไม่ตั้ง TEST_MODE → ใช้เวลาจริงของเครื่อง (โหมดใช้งานจริง) เว้นแต่ตั้ง env FROZEN_NOW=<ISO+offset>

const DEFAULT_NOW = '2026-12-01T09:00:00+07:00';
const OFFSET_MS = 7 * 3600 * 1000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

let frozenMs = null; // null = เวลาจริง

/** แปลงสตริง ISO ที่ "ต้องมี offset" เป็น epoch ms · ไม่ถูกต้อง → null */
function parseIso(str) {
  if (typeof str !== 'string') return null;
  const m = ISO_RE.exec(str.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', frac = '0', off] = m;
  const Y = +y, M = +mo, D = +d, H = +h, MI = +mi, S = +s;
  if (M < 1 || M > 12 || D < 1 || D > 31 || H > 23 || MI > 59 || S > 59) return null;
  let ms = Date.UTC(Y, M - 1, D, H, MI, S, Math.floor(+('0.' + frac) * 1000));
  // ตรวจว่าวันมีจริง (เช่น 2026-02-30 ไม่ผ่าน)
  const chk = new Date(Date.UTC(Y, M - 1, D));
  if (chk.getUTCFullYear() !== Y || chk.getUTCMonth() !== M - 1 || chk.getUTCDate() !== D) return null;
  if (off !== 'Z') {
    const sign = off[0] === '-' ? -1 : 1;
    const oh = +off.slice(1, 3), om = +off.slice(4, 6);
    if (oh > 14 || om > 59) return null;
    ms -= sign * (oh * 3600 + om * 60) * 1000;
  }
  return ms;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** ส่วนประกอบวันเวลาแบบเวลาไทยของ epoch ms */
function parts(ms) {
  const t = new Date(ms + OFFSET_MS);
  return {
    year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(),
    hour: t.getUTCHours(), minute: t.getUTCMinutes(), second: t.getUTCSeconds(),
    dow: t.getUTCDay(), // 0 = อาทิตย์ ... 6 = เสาร์
  };
}

/** epoch ms → '2026-12-04T16:30:00+07:00' (รูปแบบเดียวที่ใช้เก็บใน DB และส่งใน API) */
function toIso(ms) {
  const p = parts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+07:00`;
}

/** epoch ms → 'YYYY-MM-DD' (วันที่ตามเวลาไทย) */
function dateKey(ms) {
  const p = parts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 'YYYY-MM-DD' + 'HH:MM[:SS]' (เวลาไทย) → epoch ms */
function bkkMs(dateKeyStr, time = '00:00:00') {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, ss) - OFFSET_MS;
}

/** 'YYYY-MM-DD' บวก n วันปฏิทิน */
function addDays(dateKeyStr, n) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** วันในสัปดาห์ของ 'YYYY-MM-DD' (0 = อาทิตย์) */
function dowOf(dateKeyStr) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ISO (มี offset) → ISO +07:00 ที่ normalize แล้ว · ไม่ถูกต้อง → null */
function normalizeIso(str) {
  const ms = parseIso(str);
  return ms == null ? null : toIso(ms);
}

// ---------- นาฬิกา ----------
function now() { return frozenMs != null ? frozenMs : Date.now(); }
function nowIso() { return toIso(now()); }
function nowDateKey() { return dateKey(now()); }
function isFrozen() { return frozenMs != null; }

/** ตั้งนาฬิกา (แช่แข็ง) · คืน ISO ที่ตั้ง หรือ null ถ้ารูปแบบผิด/ไม่มี offset */
function set(iso) {
  const ms = parseIso(iso);
  if (ms == null) return null;
  frozenMs = ms;
  return toIso(ms);
}

/** กลับค่าเริ่มต้น: TEST_MODE → แช่แข็งที่ DEFAULT_NOW · ไม่ใช่ → FROZEN_NOW หรือเวลาจริง */
function reset() {
  if (process.env.TEST_MODE === '1') frozenMs = parseIso(DEFAULT_NOW);
  else if (process.env.FROZEN_NOW) frozenMs = parseIso(process.env.FROZEN_NOW);
  else frozenMs = null;
  return nowIso();
}

reset();

module.exports = {
  DEFAULT_NOW, OFFSET_MS,
  now, nowIso, nowDateKey, isFrozen, set, reset,
  parseIso, toIso, normalizeIso, dateKey, bkkMs, addDays, dowOf, parts,
};
