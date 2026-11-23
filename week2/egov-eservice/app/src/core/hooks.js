'use strict';
// จุดเกี่ยวระหว่างโมดูล (registry) — โมดูลลงทะเบียนตอน register(app, ctx)
//
// beforeRequest(fn)  fn(req) [sync หรือ async] รันก่อนทุก request ยกเว้น /api/test/* และ /static/*
//                    (CONTRACT §0 ข้อ 7: workflow ใส่การประเมินแจ้งเตือน SLA + ยกเลิกอัตโนมัติ 168 ชม.)
// onReset(fn)        fn() รันหลัง POST /api/test/reset ล้าง + seed เสร็จ (ล้าง cache ในหน่วยความจำของโมดูล)
// testPay(fn)        handler (req, res) ของ POST /api/test/payments/:ref/pay (citizen) · ลงได้ตัวเดียว
// testTamper(fn)     handler (req, res) ของ POST /api/test/documents/:docNo/tamper (mgmt) · ลงได้ตัวเดียว

const state = { before: [], reset: [], pay: null, tamper: null };

function beforeRequest(fn) { state.before.push(fn); }
function onReset(fn) { state.reset.push(fn); }
function testPay(fn) {
  if (state.pay) throw new Error('testPay handler already registered');
  state.pay = fn;
}
function testTamper(fn) {
  if (state.tamper) throw new Error('testTamper handler already registered');
  state.tamper = fn;
}

/** รัน beforeRequest ทุกตัวตามลำดับที่ลงทะเบียน (error ถูก log แต่ไม่ทำให้ request ล้ม) */
async function runBefore(req) {
  for (const fn of state.before) {
    try { await fn(req); } catch (e) { console.error('[hooks.beforeRequest]', e); }
  }
}
function runReset() {
  for (const fn of state.reset) {
    try { fn(); } catch (e) { console.error('[hooks.onReset]', e); }
  }
}

module.exports = {
  beforeRequest, onReset, testPay, testTamper, runBefore, runReset,
  get payHandler() { return state.pay; },
  get tamperHandler() { return state.tamper; },
};
