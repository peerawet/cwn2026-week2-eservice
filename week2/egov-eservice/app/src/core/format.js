'use strict';
// รูปแบบแสดงผล: เงิน ฿1,010 · วันที่ไทย '4 ธ.ค. 2569 16:30' · data-iso · ป้ายสถานะ/ระดับ (CONTRACT §0 §4)
// + HTML escape และ tagged template html`` ที่ escape ค่าให้อัตโนมัติ

const clock = require('./clock');

// ---------- HTML ----------
class SafeHtml {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}
/** escape ข้อความสำหรับใส่ใน HTML (ทั้งเนื้อหาและค่าแอตทริบิวต์) */
function esc(v) {
  if (v == null) return '';
  if (v instanceof SafeHtml) return v.s;
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** ทำเครื่องหมายว่าเป็น HTML ที่ปลอดภัยแล้ว (ไม่ escape ซ้ำ) */
function raw(s) { return s instanceof SafeHtml ? s : new SafeHtml(s == null ? '' : s); }
function interp(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(interp).join('');
  if (v instanceof SafeHtml) return v.s;
  return esc(v);
}
/**
 * html`<p data-testid="x">${userText}</p>` → SafeHtml
 * ค่า string/number ถูก escape · SafeHtml (ผลของ html``/raw()/helper ในไฟล์นี้) ไม่ถูก escape
 * array ถูกต่อกัน (เช่น rows.map(r => html`<tr>..</tr>`)) · null/undefined/false → ''
 */
function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += interp(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

// ---------- เงิน ----------
/** 1010 → '฿1,010' · null/NaN → '–' */
function money(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '–';
  const v = Math.round(Number(n));
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-' : '') + '฿' + s;
}

// ---------- วันที่ ----------
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const p2 = (n) => String(n).padStart(2, '0');
const toMs = (v) => (typeof v === 'number' ? v : clock.parseIso(v));

/** ISO/ms → '4 ธ.ค. 2569 16:30' */
function thaiDateTime(v) {
  const ms = toMs(v);
  if (ms == null) return '–';
  const p = clock.parts(ms);
  return `${p.day} ${TH_MONTHS[p.month - 1]} ${p.year + 543} ${p2(p.hour)}:${p2(p.minute)}`;
}
/** 'YYYY-MM-DD' หรือ ISO/ms → '2 ก.พ. 2570' */
function thaiDate(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
  }
  const ms = toMs(v);
  if (ms == null) return '–';
  const p = clock.parts(ms);
  return `${p.day} ${TH_MONTHS[p.month - 1]} ${p.year + 543}`;
}
/** ปี พ.ศ. ของเวลา (ไทย) เช่น 2569 */
function buddhistYear(v) { const ms = toMs(v); return clock.parts(ms).year + 543; }

/**
 * องค์ประกอบวันเวลา: <time data-testid=".." data-iso="2026-12-04T16:30:00+07:00" datetime="..">4 ธ.ค. 2569 16:30</time>
 * opts: { testid, text (ข้อความแทน), prefix (ข้อความนำหน้า เช่น 'หมดอายุ '), attrs (SafeHtml/str เพิ่ม), cls }
 */
function timeEl(iso, opts = {}) {
  if (!iso) return html`<span${opts.testid ? raw(` data-testid="${esc(opts.testid)}"`) : ''}>–</span>`;
  const norm = clock.normalizeIso(iso) || iso;
  const text = opts.text != null ? opts.text : (opts.prefix || '') + thaiDateTime(norm);
  return html`<time${opts.testid ? raw(` data-testid="${esc(opts.testid)}"`) : ''}${opts.cls ? raw(` class="${esc(opts.cls)}"`) : ''} data-iso="${norm}" datetime="${norm}"${opts.attrs ? raw(' ' + opts.attrs) : ''}>${text}</time>`;
}
/** องค์ประกอบวันที่ล้วน: data-iso="2027-02-02" ข้อความ '2 ก.พ. 2570' (verify-expires) */
function dateEl(dateKeyStr, opts = {}) {
  return html`<time${opts.testid ? raw(` data-testid="${esc(opts.testid)}"`) : ''} data-iso="${dateKeyStr}" datetime="${dateKeyStr}">${opts.text != null ? opts.text : thaiDate(dateKeyStr)}</time>`;
}

// ---------- สถานะ / ระดับ / บทบาท ----------
const STATUS_TH = {
  DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว', IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติ', COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก',
};
const LEVEL_TH = { normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด', paused: 'หยุดนับ', closed: 'ปิดแล้ว' };
const ROLE_TH = { citizen: 'ประชาชน', officer: 'เจ้าหน้าที่', head: 'หัวหน้าฝ่าย', executive: 'ผู้บริหาร', auditor: 'ผู้ตรวจสอบภายใน', admin: 'ผู้ดูแลระบบ' };
const DEPT_TH = { registry: 'ฝ่ายทะเบียน', works: 'ฝ่ายโยธา' };
const PAYMENT_TH = { PENDING: 'รอชำระ', PAID: 'ชำระแล้ว', EXPIRED: 'QR หมดอายุ' };
const EVENT_TH = {
  CREATED: 'สร้างร่างคำขอ', QR_CREATED: 'สร้าง QR ชำระเงิน', PAID: 'ชำระเงินสำเร็จ ส่งคำขอแล้ว',
  CANCEL: 'ประชาชนยกเลิกคำขอ', CLAIM: 'เจ้าหน้าที่รับเรื่อง', RETURN: 'ตีกลับให้แก้ไขเอกสาร',
  RESUBMIT: 'ประชาชนส่งแก้ไขเอกสาร', FORWARD: 'ผ่าน/ส่งต่อขั้นถัดไป', APPROVE: 'อนุมัติ', REJECT: 'ไม่อนุมัติ',
  ISSUE: 'ออกเอกสารดิจิทัล', AUTO_CANCEL: 'ระบบยกเลิกอัตโนมัติ (เลยเวลาแก้ไข 168 ชม.)',
};

/** <span data-testid="case-status" data-status="IN_REVIEW" class="badge st-IN_REVIEW">กำลังตรวจสอบ</span> */
function statusBadge(status, testid = 'case-status') {
  return html`<span data-testid="${testid}" data-status="${status}" class="badge st-${status}">${STATUS_TH[status] || status}</span>`;
}
/** <span data-testid="sla-level" data-level="near" class="badge lv-near">ใกล้ครบกำหนด</span> · level null → '–' */
function levelBadge(level, testid = 'sla-level') {
  if (!level) return html`<span data-testid="${testid}" class="badge">–</span>`;
  return html`<span data-testid="${testid}" data-level="${level}" class="badge lv-${level}">${LEVEL_TH[level] || level}</span>`;
}
/** ป้ายสถานะชำระ (payment-status) */
function paymentBadge(status, testid = 'payment-status') {
  return html`<span data-testid="${testid}" data-status="${status}" class="badge pay-${status}">${PAYMENT_TH[status] || status}</span>`;
}

// ---------- ชื่อ ----------
/** 'สมชาย ใจดี' → 'สมชาย ใ***' · ไม่มีนามสกุล → 'มานะ ***' (A-54 A-58) */
function maskName(full) {
  const s = String(full || '').trim();
  const i = s.indexOf(' ');
  if (i < 0) return `${s} ***`;
  const first = s.slice(0, i);
  const last = s.slice(i + 1).trim();
  const ch = Array.from(last)[0] || '';
  return `${first} ${ch}***`;
}

/** ทันกำหนด %: 6,7 → '85.7%' · ปิดงาน 0 → '–' (ปัดครึ่งขึ้น 1 ตำแหน่ง) */
function percent(num, den) {
  if (!den) return '–';
  const v = Math.round((num / den) * 1000 + 1e-9) / 10;
  return v.toFixed(1) + '%';
}

module.exports = {
  SafeHtml, esc, raw, html,
  money, thaiDateTime, thaiDate, buddhistYear, timeEl, dateEl, TH_MONTHS, TH_DAYS,
  STATUS_TH, LEVEL_TH, ROLE_TH, DEPT_TH, PAYMENT_TH, EVENT_TH,
  statusBadge, levelBadge, paymentBadge, maskName, percent,
};
