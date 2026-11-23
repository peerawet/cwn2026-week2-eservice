'use strict';
// ข้อมูล seed หลัง reset — ตรงตาม TEST-DATA.md ทุกแถว (ห้ามปรับตัวเลข)
// กำหนดเสร็จ (due_at) ของ seed เก็บค่าตายตัวตามตาราง ไม่คำนวณใหม่ (A-35) · seed ไม่สร้างแจ้งเตือน/Audit
// เรียกผ่าน seedAll() ภายใน transaction ของ reset เท่านั้น (ดู core/testhooks.js)

const db = require('./core/db');
const crypto = require('./core/crypto');
const catalog = require('./core/catalog');

const T = (s) => `${s.replace(' ', 'T')}:00+07:00`; // '2026-11-30 16:29' → '2026-11-30T16:29:00+07:00'
const SEED_CREATED = '2026-10-01T09:00:00+07:00';
const PASSWORD = 'Test@1234';

// ---------- 1.2 เจ้าหน้าที่ ----------
const USERS = [
  { username: 'off.reg1', display_name: 'เจ้าหน้าที่ทะเบียน 1', role: 'officer', dept: 'registry' },
  { username: 'off.reg2', display_name: 'เจ้าหน้าที่ทะเบียน 2', role: 'officer', dept: 'registry' },
  { username: 'off.works1', display_name: 'เจ้าหน้าที่โยธา 1', role: 'officer', dept: 'works' },
  { username: 'head1', display_name: 'หัวหน้าฝ่าย', role: 'head', dept: null },
  { username: 'exec1', display_name: 'ผู้บริหาร', role: 'executive', dept: null },
  { username: 'audit1', display_name: 'ผู้ตรวจสอบภายใน', role: 'auditor', dept: null },
  { username: 'admin1', display_name: 'ผู้ดูแลระบบ', role: 'admin', dept: null },
];
// salt คงที่ต่อผู้ใช้ → hash เหมือนเดิมทุก reset (ผลซ้ำได้) และ cache ได้
const userSalt = (u) => crypto.blindIndex('salt|' + u).slice(0, 32);

// ---------- 1.1 ประชาชน (id ตามลำดับ: 1 สมชาย · 2 สมหญิง · 3 มานะ · 4 ปิติ) ----------
const CITIZENS = [
  { key: 'somchai', idNo: '1101700123456', name: 'สมชาย ใจดี', mobile: '0812345678', registered: 1 },
  { key: 'somying', idNo: '3100600987659', name: 'สมหญิง รักไทย', mobile: '0823456789', registered: 1 },
  { key: 'mana', idNo: '5500400111221', name: 'มานะ ตั้งใจ', mobile: null, registered: 0 },
  { key: 'piti', idNo: '1909900555015', name: 'ปิติ มีสุข', mobile: '0834567890', registered: 1 },
];

// ---------- 2 บริการ ----------
const SERVICES = [
  { id: 'SV-01', fee: 20, fee_per_sqm: null, sla_days: 3, sort: 1 },
  { id: 'SV-02', fee: 500, fee_per_sqm: null, sla_days: 10, sort: 2 },
  { id: 'SV-03', fee: 1000, fee_per_sqm: 10, sla_days: 15, sort: 3 },
];

// ---------- 3 วันหยุด ----------
const HOLIDAYS = [
  ['2026-12-07', 'ชดเชยวันหยุดทดสอบ (สมมติ)'],
  ['2026-12-10', 'วันรัฐธรรมนูญทดสอบ (สมมติ)'],
  ['2026-12-31', 'วันสิ้นปีทดสอบ (สมมติ)'],
  ['2027-01-01', 'วันขึ้นปีใหม่ทดสอบ (สมมติ)'],
];

// ---------- 4.1 คำขอ 30 ใบ ----------
// n = ลำดับเลขคำขอ · who = ผู้ยื่น · st = สถานะ · paid / due / closed = เวลาไทย
// step/dept/owner/reg/works ตามคอลัมน์ "ผู้ถือเรื่อง / อยู่ที่" + ตาราง 4.3
const CASES = [
  { n: 1, tag: 'H01', sv: 'SV-01', qty: 1, fee: 20, who: 'somying', st: 'COMPLETED', paid: '2026-10-14 10:00', due: '2026-10-19 16:30', closed: '2026-10-16 14:00' },
  { n: 2, tag: 'H05', sv: 'SV-03', area: 120, fee: 1200, who: 'piti', st: 'COMPLETED', paid: '2026-11-02 09:00', due: '2026-11-23 16:30', closed: '2026-11-20 11:00' },
  { n: 3, tag: 'H02', sv: 'SV-01', qty: 2, fee: 40, who: 'piti', st: 'COMPLETED', paid: '2026-11-02 09:30', due: '2026-11-05 16:30', closed: '2026-11-04 15:00' },
  { n: 4, tag: 'H06', sv: 'SV-02', fee: 500, who: 'somchai', st: 'COMPLETED', paid: '2026-11-02 14:00', due: '2026-11-16 16:30', closed: '2026-11-13 15:00' },
  { n: 5, tag: 'H03', sv: 'SV-01', qty: 1, fee: 20, who: 'somchai', st: 'COMPLETED', paid: '2026-11-03 11:00', due: '2026-11-06 16:30', closed: '2026-11-05 10:00', reg: 'off.reg1', approvedBy: 'off.reg1', doc: 'DOC-2569-000001' },
  { n: 6, tag: 'H08', sv: 'SV-02', fee: 500, who: 'piti', st: 'COMPLETED', paid: '2026-11-03 15:00', due: '2026-11-17 16:30', closed: '2026-11-19 10:00' },
  { n: 7, tag: 'H07', sv: 'SV-02', fee: 500, who: 'somying', st: 'COMPLETED', paid: '2026-11-04 10:00', due: '2026-11-18 16:30', closed: '2026-11-18 16:00' },
  { n: 8, tag: 'H04', sv: 'SV-01', qty: 1, fee: 20, who: 'somying', st: 'REJECTED', paid: '2026-11-09 10:00', due: '2026-11-12 16:30', closed: '2026-11-11 09:00' },
  { n: 9, tag: 'X01', sv: 'SV-01', qty: 1, fee: 20, who: 'somchai', st: 'CANCELLED', paid: '2026-11-09 14:30', due: '2026-11-12 16:30', cancelled: '2026-11-09 15:00' },
  { n: 10, tag: 'W01', sv: 'SV-03', area: 80, fee: 1000, who: 'somying', st: 'IN_REVIEW', paid: '2026-11-12 10:00', due: '2026-12-03 16:30', step: 2, dept: 'works', owner: null, reg: 'off.reg1' },
  { n: 11, tag: 'P02', sv: 'SV-03', area: 150, fee: 1500, who: 'somchai', st: 'PENDING_APPROVAL', paid: '2026-11-16 10:00', due: '2026-12-08 16:30', step: 3, dept: 'head', owner: null, reg: 'off.reg1', works: 'off.works1' },
  { n: 12, tag: 'R09', sv: 'SV-03', area: 101, fee: 1010, who: 'piti', st: 'IN_REVIEW', paid: '2026-11-18 10:00', due: '2026-12-11 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 13, tag: 'R01', sv: 'SV-02', fee: 500, who: 'somchai', st: 'IN_REVIEW', paid: '2026-11-20 10:00', due: '2026-12-04 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 14, tag: 'P01', sv: 'SV-02', fee: 500, who: 'piti', st: 'PENDING_APPROVAL', paid: '2026-11-20 11:00', due: '2026-12-04 16:30', step: 2, dept: 'head', owner: null, reg: 'off.reg1' },
  { n: 15, tag: 'R02', sv: 'SV-02', fee: 500, who: 'somying', st: 'IN_REVIEW', paid: '2026-11-20 15:00', due: '2026-12-04 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 16, tag: 'R03', sv: 'SV-02', fee: 500, who: 'piti', st: 'IN_REVIEW', paid: '2026-11-23 09:00', due: '2026-12-08 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 17, tag: 'F01', sv: 'SV-01', qty: 1, fee: 20, who: 'somchai', st: 'NEED_FIX', paid: '2026-11-23 10:00', due: '2026-11-27 16:30', step: 1, dept: 'registry', owner: 'off.reg1',
    returns: [
      { at: '2026-11-24 11:00', fixed: '2026-11-25 10:00', reason: 'ภาพบัตรประชาชนไม่ชัด กรุณาถ่ายใหม่' },
      { at: '2026-11-27 14:00', fixed: null, reason: 'ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข' },
    ] },
  { n: 18, tag: 'R04', sv: 'SV-02', fee: 500, who: 'somchai', st: 'IN_REVIEW', paid: '2026-11-24 10:00', due: '2026-12-09 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 19, tag: 'A01', sv: 'SV-02', fee: 500, who: 'somying', st: 'APPROVED', paid: '2026-11-24 14:00', due: '2026-12-09 16:30', step: 2, dept: 'registry', owner: null, reg: 'off.reg1', approvedBy: 'head1', approvedAt: '2026-11-30 15:00' },
  { n: 20, tag: 'O01', sv: 'SV-01', qty: 1, fee: 20, who: 'somchai', st: 'IN_REVIEW', paid: '2026-11-25 10:00', due: '2026-11-30 16:30', step: 1, dept: 'registry', owner: 'off.reg1' },
  { n: 21, tag: 'R08', sv: 'SV-02', fee: 500, who: 'somying', st: 'IN_REVIEW', paid: '2026-11-25 12:00', due: '2026-12-11 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 22, tag: 'N02', sv: 'SV-01', qty: 2, fee: 40, who: 'somying', st: 'IN_REVIEW', paid: '2026-11-26 10:00', due: '2026-12-01 16:30', step: 1, dept: 'registry', owner: 'off.reg1' },
  { n: 23, tag: 'F02', sv: 'SV-01', qty: 1, fee: 20, who: 'somying', st: 'IN_REVIEW', paid: '2026-11-26 10:30', due: '2026-12-03 16:30', step: 1, dept: 'registry', owner: 'off.reg1',
    returns: [
      { at: '2026-11-27 10:00', fixed: '2026-11-30 10:00', reason: 'ภาพเอกสารเบลอ อ่านเลขไม่ได้' },
      { at: '2026-11-30 14:00', fixed: '2026-12-01 08:30', reason: 'ข้อมูลในแบบฟอร์มไม่ครบถ้วน' },
    ] },
  { n: 24, tag: 'N01', sv: 'SV-01', qty: 1, fee: 20, who: 'piti', st: 'SUBMITTED', paid: '2026-11-27 11:00', due: '2026-12-02 16:30', step: 1, dept: 'registry', owner: null },
  { n: 25, tag: 'R05', sv: 'SV-01', qty: 3, fee: 60, who: 'somying', st: 'IN_REVIEW', paid: '2026-11-30 10:00', due: '2026-12-03 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 26, tag: 'R07', sv: 'SV-01', qty: 5, fee: 100, who: 'somchai', st: 'IN_REVIEW', paid: '2026-11-30 16:29', due: '2026-12-03 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 27, tag: 'R06', sv: 'SV-01', qty: 1, fee: 20, who: 'piti', st: 'IN_REVIEW', paid: '2026-11-30 16:30', due: '2026-12-04 16:30', step: 1, dept: 'registry', owner: 'off.reg2' },
  { n: 28, tag: 'S01', sv: 'SV-01', qty: 1, fee: 20, who: 'somying', st: 'SUBMITTED', paid: '2026-12-01 08:10', due: '2026-12-04 16:30', step: 1, dept: 'registry', owner: null },
  { n: 29, tag: 'S02', sv: 'SV-01', qty: 1, fee: 20, who: 'piti', st: 'SUBMITTED', paid: '2026-12-01 08:20', due: '2026-12-04 16:30', step: 1, dept: 'registry', owner: null },
  { n: 30, tag: 'S03', sv: 'SV-01', qty: 1, fee: 20, who: 'somchai', st: 'SUBMITTED', paid: '2026-12-01 08:30', due: '2026-12-04 16:30', step: 1, dept: 'registry', owner: null },
];

// ---------- 4.2 ร่างของสมชาย ----------
const DRAFTS = [
  { draftId: 'DR-0001', sv: 'SV-01', qty: 2, fee: 40, st: 'DRAFT', created: '2026-11-30 15:00', files: [] },
  { draftId: 'DR-0002', sv: 'SV-02', fee: 500, st: 'PENDING_PAYMENT', created: '2026-12-01 08:50', files: ['id-card', 'map'],
    payment: { ref: 'PP-0001', amount: 500, created: '2026-12-01T08:55:00+07:00', expires: '2026-12-01T09:10:00+07:00' } },
];

// ---------- 5 เอกสารที่ออกแล้ว ----------
const DOCUMENT = {
  doc_no: 'DOC-2569-000001', case_no: 'EG-2569-000005', verify_code: 'K7M2Q9XA', applicant: 'สมชาย ใจดี',
  service_id: 'SV-01', issued_at: '2026-11-05T10:00:00+07:00', valid_until: '2027-02-02',
  signer: 'เจ้าหน้าที่ทะเบียน 1', issued_by: 'off.reg1',
};

/** PDF จริงขนาดเล็ก (ขึ้นต้น %PDF) สำหรับไฟล์แนบของ seed */
function samplePdf(label) {
  return Buffer.from(
    '%PDF-1.4\n%seed ' + label + '\n'
    + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 120]>>endobj\n'
    + 'trailer<</Root 1 0 R>>\n%%EOF\n', 'latin1',
  );
}

const finalStep = (sv) => catalog.ROUTES[sv].length;
const caseNo = (n) => `EG-2569-${String(n).padStart(6, '0')}`;
const receiptNo = (n) => `RC-2569-${String(n).padStart(6, '0')}`;

/** ใส่ข้อมูลทั้งหมด (ตารางต้องว่างอยู่แล้ว) */
function seedAll() {
  // บัญชี
  for (const u of USERS) {
    db.run('INSERT INTO users(username, password_hash, display_name, role, dept, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
      u.username, crypto.hashPassword(PASSWORD, userSalt(u.username)), u.display_name, u.role, u.dept, SEED_CREATED);
  }
  const citizenId = {};
  for (const c of CITIZENS) {
    const r = db.run(`INSERT INTO citizens(id_hash, id_enc, name, mobile_enc, email, registered, consent_at, registered_at, created_at)
      VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`,
    crypto.blindIndex(c.idNo), crypto.encrypt(c.idNo), c.name, crypto.encrypt(c.mobile), c.registered,
    c.registered ? SEED_CREATED : null, c.registered ? SEED_CREATED : null, SEED_CREATED);
    citizenId[c.key] = Number(r.lastInsertRowid);
  }

  // บริการ / วันหยุด
  for (const s of SERVICES) {
    db.run('INSERT INTO services(id, name, fee, fee_per_sqm, sla_days, sort) VALUES (?, ?, ?, ?, ?, ?)',
      s.id, catalog.SERVICE_NAMES[s.id], s.fee, s.fee_per_sqm, s.sla_days, s.sort);
  }
  for (const [date, name] of HOLIDAYS) db.run('INSERT INTO holidays(date, name) VALUES (?, ?)', date, name);

  let fileSeq = 0;
  const addFile = (caseId, docKey, uploadedAt, label) => {
    fileSeq += 1;
    const content = samplePdf(label);
    db.run(`INSERT INTO case_files(file_id, case_id, doc_key, name, mime, size, content, phase, uploaded_at)
            VALUES (?, ?, ?, ?, 'application/pdf', ?, ?, 'initial', ?)`,
    `F-${String(fileSeq).padStart(6, '0')}`, caseId, docKey, `${docKey}.pdf`, content.length, content, uploadedAt);
  };
  const ev = (caseId, time, type, actor, actorRole, from, to, note) => db.run(
    'INSERT INTO case_events(case_id, time, type, actor, actor_role, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    caseId, time, type, actor, actorRole, from, to, note || null,
  );

  // คำขอ 30 ใบ
  for (const c of CASES) {
    const paid = T(c.paid);
    const closed = c.closed ? T(c.closed) : null;
    const cancelled = c.cancelled ? T(c.cancelled) : null;
    const isOpen = !closed && !cancelled;
    const lastReturn = c.returns ? c.returns[c.returns.length - 1] : null;
    const step = c.step || finalStep(c.sv);
    const regOfficer = c.reg || (isOpen && step === 1 ? c.owner : null) || null;
    const updated = closed || cancelled || (c.approvedAt && T(c.approvedAt)) || (lastReturn && T(lastReturn.fixed || lastReturn.at)) || paid;
    const r = db.run(`INSERT INTO cases(draft_id, case_no, service_id, citizen_id, status, qty, area_sqm, fee, created_at, updated_at,
        paid_at, receipt_no, due_at, step, dept, owner, reg_officer, works_officer, return_count, returned_at, return_reason, fix_deadline,
        approved_by, approved_at, rejected_by, reject_reason, closed_at, cancelled_at, cancel_kind, doc_no)
      VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    caseNo(c.n), c.sv, citizenId[c.who], c.st, c.qty ?? null, c.area ?? null, c.fee, paid, updated,
    paid, receiptNo(c.n), T(c.due), step, isOpen ? c.dept : null, isOpen ? (c.owner ?? null) : null,
    regOfficer, c.works || null, c.returns ? c.returns.length : 0,
    lastReturn ? T(lastReturn.at) : null, lastReturn ? lastReturn.reason : null,
    c.st === 'NEED_FIX' && lastReturn ? isoPlusHours(T(lastReturn.at), 168) : null,
    c.approvedBy || null, c.approvedAt ? T(c.approvedAt) : (c.approvedBy && closed ? closed : null),
    closed, cancelled, cancelled ? 'CITIZEN' : null, c.doc || null);
    const id = Number(r.lastInsertRowid);

    // ไฟล์แนบตามเอกสารบังคับ (TEST-DATA 4.1 ท้ายตาราง)
    for (const d of catalog.DOCS[c.sv].filter((x) => x.required)) addFile(id, d.key, paid, `${caseNo(c.n)} ${d.key}`);

    // ไทม์ไลน์ (เฉพาะเหตุการณ์ที่ TEST-DATA ระบุเวลา)
    ev(id, paid, 'PAID', 'citizen', 'citizen', 'PENDING_PAYMENT', 'SUBMITTED', `ใบเสร็จ ${receiptNo(c.n)}`);
    for (const rt of c.returns || []) {
      ev(id, T(rt.at), 'RETURN', c.owner, 'officer', 'IN_REVIEW', 'NEED_FIX', rt.reason);
      if (rt.fixed) ev(id, T(rt.fixed), 'RESUBMIT', 'citizen', 'citizen', 'NEED_FIX', 'IN_REVIEW', null);
    }
    if (c.approvedAt) ev(id, T(c.approvedAt), 'APPROVE', c.approvedBy, 'head', 'PENDING_APPROVAL', 'APPROVED', null);
    if (c.st === 'COMPLETED') ev(id, closed, 'ISSUE', c.doc ? 'off.reg1' : null, c.doc ? 'officer' : null, 'APPROVED', 'COMPLETED', c.doc || 'ออกเอกสารจากระบบเดิม');
    if (c.st === 'REJECTED') ev(id, closed, 'REJECT', null, null, 'IN_REVIEW', 'REJECTED', null);
    if (cancelled) ev(id, cancelled, 'CANCEL', 'citizen', 'citizen', 'SUBMITTED', 'CANCELLED', null);
  }

  // ร่าง
  const somchai = citizenId.somchai;
  for (const d of DRAFTS) {
    const created = T(d.created);
    const r = db.run(`INSERT INTO cases(draft_id, service_id, citizen_id, status, qty, area_sqm, fee, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`, d.draftId, d.sv, somchai, d.st, d.qty ?? null, d.fee, created, d.payment ? d.payment.created : created);
    const id = Number(r.lastInsertRowid);
    ev(id, created, 'CREATED', 'citizen', 'citizen', null, 'DRAFT', null);
    for (const k of d.files) addFile(id, k, created, `${d.draftId} ${k}`);
    if (d.payment) {
      db.run(`INSERT INTO payments(ref, case_id, amount, status, qr_created_at, qr_expires_at) VALUES (?, ?, ?, 'PENDING', ?, ?)`,
        d.payment.ref, id, d.payment.amount, d.payment.created, d.payment.expires);
      ev(id, d.payment.created, 'QR_CREATED', 'citizen', 'citizen', 'DRAFT', 'PENDING_PAYMENT', d.payment.ref);
    }
  }

  // เอกสาร DOC-2569-000001 (ลายเซ็นคำนวณจริงด้วยคีย์ทดสอบ)
  const doc = { ...DOCUMENT };
  doc.signature = crypto.sign(crypto.docSignFields(doc));
  const caseId5 = db.get('SELECT id FROM cases WHERE case_no = ?', DOCUMENT.case_no).id;
  db.run(`INSERT INTO documents(doc_no, case_id, case_no, verify_code, applicant, service_id, issued_at, valid_until, signer, signature, issued_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  doc.doc_no, caseId5, doc.case_no, doc.verify_code, doc.applicant, doc.service_id, doc.issued_at, doc.valid_until, doc.signer, doc.signature, doc.issued_by);

  // ตัวนับ (TEST-DATA 12: ถัดไป EG-2569-000031 · RC-2569-000031 · DOC-2569-000002 · DR-0003 · PP-0002)
  db.setCounter('case:2569', 30);
  db.setCounter('doc:2569', 1);
  db.setCounter('draft', 2);
  db.setCounter('payref', 1);
  db.setCounter('file', fileSeq);
}

function isoPlusHours(iso, h) {
  const clock = require('./core/clock');
  return clock.toIso(clock.parseIso(iso) + h * 3600 * 1000);
}

module.exports = { seedAll, USERS, CITIZENS, SERVICES, HOLIDAYS, CASES, DRAFTS, DOCUMENT, PASSWORD, samplePdf };
