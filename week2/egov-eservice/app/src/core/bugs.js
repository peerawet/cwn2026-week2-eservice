'use strict';
// BUG_MODE=B03,B07 → เปิดบั๊กตาม BUGS.md (คั่นด้วย , · ช่องว่าง/ตัวพิมพ์เล็กไม่มีผล)
// มีผลเฉพาะเมื่อ TEST_MODE=1 (BUGS.md อนุญาต) เพื่อไม่ให้โหมดใช้งานจริงเปิดบั๊กโดยไม่ตั้งใจ

const raw = process.env.BUG_MODE || '';
const parsed = raw.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^B\d{2}$/.test(s));
const active = new Set(process.env.TEST_MODE === '1' ? parsed : []);

/** isOn('B03') → true ถ้าเปิดบั๊กนั้นอยู่ */
function isOn(code) { return active.has(String(code).toUpperCase()); }
function list() { return [...active].sort(); }
function describe() {
  if (!raw.trim()) return 'BUG_MODE=(ไม่ตั้ง) → เว็บถูกต้อง 100%';
  if (process.env.TEST_MODE !== '1') return `BUG_MODE=${raw} ถูกละเลย (ใช้ได้เฉพาะ TEST_MODE=1)`;
  return `BUG_MODE=${raw} → เปิด [${list().join(', ')}]`;
}

module.exports = { isOn, list, describe };
