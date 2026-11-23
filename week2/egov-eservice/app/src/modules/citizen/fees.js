'use strict';
// ค่าธรรมเนียม (BR-04 BR-05) · อ่านอัตราจากตาราง services (ผู้ดูแลแก้ได้)
// B01: SV-03 พื้นที่ 101 คิด ฿1,000 (ใช้ `> 101` แทน `>= 101`)

const { AppError } = require('../../core/errors');

/** แปลงค่าที่รับมา (number หรือ string จำนวนเต็มล้วน) → จำนวนเต็ม หรือ null */
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}

module.exports = function makeFees(ctx) {
  const rate = (serviceId) => ctx.db.get('SELECT * FROM services WHERE id = ?', serviceId);

  /**
   * คำนวณค่าธรรมเนียม → { fee, qty, areaSqm } หรือ throw AppError (INVALID_QTY / INVALID_AREA / AREA_TOO_LARGE)
   */
  function calc(serviceId, input = {}) {
    const svc = rate(serviceId);
    if (!svc) throw new AppError('BAD_REQUEST');
    if (serviceId === 'SV-01') {
      const qty = toInt(input.qty);
      if (qty === null || qty < 1 || qty > 5) throw new AppError('INVALID_QTY');
      return { fee: svc.fee * qty, qty, areaSqm: null };
    }
    if (serviceId === 'SV-02') return { fee: svc.fee, qty: null, areaSqm: null };
    if (serviceId === 'SV-03') {
      const area = toInt(input.areaSqm);
      if (area === null || area < 1) throw new AppError('INVALID_AREA');
      if (area > 500) throw new AppError('AREA_TOO_LARGE');
      const over = ctx.bugs.isOn('B01') ? area > 101 : area >= 101; // B01: ขอบ 101 ผิด
      const fee = over ? svc.fee + (svc.fee_per_sqm || 0) * (area - 100) : svc.fee;
      return { fee, qty: null, areaSqm: area };
    }
    throw new AppError('BAD_REQUEST');
  }

  return { calc, toInt };
};
