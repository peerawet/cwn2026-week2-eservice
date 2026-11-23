'use strict';
// ตัวช่วยกลางของ "คำขอ" ที่หลายโมดูลใช้ร่วม: อ่านคำขอ · JSON ตาม CONTRACT §6.7 · ไทม์ไลน์ · ไฟล์แนบ · สิทธิ์ไฟล์ (BR-29)
// ตรรกะการเปลี่ยนสถานะ (claim/return/approve/...) อยู่ในโมดูล workflow · การสร้างร่าง/ชำระอยู่ใน citizen

const db = require('./db');
const clock = require('./clock');
const crypto = require('./crypto');
const sla = require('./sla');
const catalog = require('./catalog');
const { html, timeEl, EVENT_TH, ROLE_TH } = require('./format');

const BASE_SQL = `SELECT c.*, z.name AS applicant_name, z.id_enc AS applicant_id_enc
  FROM cases c JOIN citizens z ON z.id = c.citizen_id`;

/** คำขอตามเลข EG-… (รวม applicant_name) หรือ undefined */
function getByCaseNo(caseNo) { return db.get(`${BASE_SQL} WHERE c.case_no = ?`, caseNo); }
/** คำขอ/ร่างตาม id ภายใน */
function getById(id) { return db.get(`${BASE_SQL} WHERE c.id = ?`, id); }
/** ร่างตามรหัส DR-… (ทุกสถานะ — ตรวจสถานะเอง) */
function getByDraftId(draftId) { return db.get(`${BASE_SQL} WHERE c.draft_id = ?`, draftId); }

/** เลขบัตรเต็มของผู้ยื่น (ถอดรหัส) — ใช้เฉพาะเมื่อมีสิทธิ์ (เจ้าของ/unmask) */
function applicantIdNo(row) { return crypto.decrypt(row.applicant_id_enc); }
/** เลขบัตรปิดบังของผู้ยื่น 'X-XXXX-XXXXX-65-9' */
function applicantIdMasked(row) { return crypto.maskThaiId(applicantIdNo(row)); }

/** ระดับเตือน ณ นาฬิกาปัจจุบัน (normal|near|overdue|paused|closed|null) */
function levelOf(row, nowMs = clock.now()) { return sla.levelOf(row, nowMs); }

/** รหัสตรวจสอบเอกสารของคำขอ (ถ้าออกแล้ว) */
function verifyCodeOf(row) {
  if (!row.doc_no) return null;
  const d = db.get('SELECT verify_code FROM documents WHERE doc_no = ?', row.doc_no);
  return d ? d.verify_code : null;
}

/**
 * JSON ของคำขอตาม CONTRACT §6.7
 * viewer = req.user · ประชาชนเจ้าของได้ idNo (เต็ม) แทน idMasked · เจ้าหน้าที่/หัวหน้าได้ idMasked เท่านั้น (ห้ามมี idNo)
 */
function toJson(row, viewer) {
  const out = {
    caseNo: row.case_no,
    serviceId: row.service_id,
    status: row.status,
    step: row.service_id === 'SV-03' ? (row.step || null) : null,
    fee: row.fee,
    paidAt: row.paid_at || null,
    dueAt: row.due_at || null,
    slaLevel: levelOf(row),
    owner: row.owner || null,
    returnCount: row.return_count || 0,
    closedAt: row.closed_at || null,
    applicantName: row.applicant_name,
  };
  const isOwnerCitizen = viewer && viewer.role === 'citizen' && viewer.citizenId === row.citizen_id;
  if (isOwnerCitizen) out.idNo = applicantIdNo(row);
  else out.idMasked = applicantIdMasked(row);
  out.fixDeadline = row.status === 'NEED_FIX' ? (row.fix_deadline || null) : null;
  out.docNo = row.doc_no || null;
  out.verifyCode = verifyCodeOf(row);
  return out;
}

// ---------- ไทม์ไลน์ ----------
/** เพิ่มเหตุการณ์ในไทม์ไลน์ · time ไม่ส่ง = นาฬิกาปัจจุบัน */
function addEvent(caseId, e) {
  db.run(`INSERT INTO case_events(case_id, time, type, actor, actor_role, from_status, to_status, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  caseId, e.time || clock.nowIso(), e.type, e.actor || null, e.actorRole || null, e.fromStatus || null, e.toStatus || null, e.note || null);
}
/** เหตุการณ์ของคำขอ เรียงเก่า → ใหม่ */
function events(caseId) { return db.all('SELECT * FROM case_events WHERE case_id = ? ORDER BY time, id', caseId); }

/**
 * HTML ไทม์ไลน์: <ol data-testid="case-timeline"><li data-testid="timeline-item" data-iso="…">…</li></ol>
 * opts.showActor (default true) แสดงชื่อผู้ทำ (username เจ้าหน้าที่) · ประชาชนแสดงเป็น 'ผู้ยื่น'
 */
function timelineHtml(caseId, opts = {}) {
  const showActor = opts.showActor !== false;
  const items = events(caseId);
  if (!items.length) return html`<ol class="timeline" data-testid="case-timeline"></ol>`;
  return html`<ol class="timeline" data-testid="case-timeline">${items.map((ev) => {
    const who = !showActor || !ev.actor ? '' : ev.actor === 'citizen' ? 'ผู้ยื่น' : ev.actor === 'system' ? 'ระบบ' : `${ev.actor}${ev.actor_role ? ' (' + (ROLE_TH[ev.actor_role] || ev.actor_role) + ')' : ''}`;
    return html`<li data-testid="timeline-item" data-iso="${ev.time}" data-type="${ev.type}">
      ${timeEl(ev.time)} · <strong>${EVENT_TH[ev.type] || ev.type}</strong>${who ? html` · ${who}` : ''}${ev.note ? html`<br><span class="muted">${ev.note}</span>` : ''}
    </li>`;
  })}</ol>`;
}

// ---------- ไฟล์แนบ ----------
/** ไฟล์แนบของคำขอ (ไม่รวมเนื้อไฟล์) → [{ fileId, name, docKey, size, mime, phase, uploadedAt }] */
function files(caseId) {
  return db.all('SELECT file_id, name, doc_key, size, mime, phase, uploaded_at FROM case_files WHERE case_id = ? ORDER BY uploaded_at, file_id', caseId)
    .map((f) => ({ fileId: f.file_id, name: f.name, docKey: f.doc_key, size: f.size, mime: f.mime, phase: f.phase, uploadedAt: f.uploaded_at }));
}
/** ไฟล์เดียวรวมเนื้อ → { ...meta, caseId, content: Buffer } หรือ undefined */
function fileWithContent(fileId) {
  const f = db.get('SELECT * FROM case_files WHERE file_id = ?', fileId);
  if (!f) return undefined;
  return { fileId: f.file_id, caseId: f.case_id, name: f.name, docKey: f.doc_key, size: f.size, mime: f.mime, content: Buffer.from(f.content) };
}

/**
 * สิทธิ์ดู/ดาวน์โหลดไฟล์แนบ (BR-29 · A-59) → 'ok' | 'unauthenticated'(401) | 'not_found'(404) | 'forbidden'(403)
 * citizen = เจ้าของเท่านั้น (คนอื่น 404) · head = ทุกคำขอที่ชำระแล้ว
 * officer registry = ทุกคำขอที่ชำระแล้ว (ทุกใบผ่านขั้นทะเบียน) · officer works = SV-03 ที่ step ≥ 2 (ขั้นปัจจุบันหรือเคยผ่าน)
 * executive / auditor / admin = 403
 */
function fileAccess(user, row) {
  if (!user) return 'unauthenticated';
  if (!row) return 'not_found';
  if (user.role === 'citizen') return row.citizen_id === user.citizenId ? 'ok' : 'not_found';
  if (!row.case_no) return 'not_found';
  if (user.role === 'head') return 'ok';
  if (user.role === 'officer') {
    if (user.dept === 'registry') return 'ok';
    if (user.dept === 'works') return row.service_id === 'SV-03' && (row.step || 0) >= 2 ? 'ok' : 'forbidden';
    return 'forbidden';
  }
  return 'forbidden';
}

// ---------- ไฟล์: ชนิดจาก magic bytes + บันทึก ----------
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5,242,880 (รวมค่านี้ · BR-07)
const MAX_FILES_PER_CASE = 5;
/** ชนิดไฟล์จากเนื้อไฟล์เท่านั้น (A-49): 'application/pdf' | 'image/jpeg' | 'image/png' | null */
function detectMime(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf'; // %PDF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}
/** บันทึกไฟล์ (ตรวจสิทธิ์/ชนิด/ขนาด/จำนวนก่อนเรียก) → { fileId, name, docKey, size } */
function addFile(caseId, { docKey, name, mime, content, phase = 'initial' }) {
  const fileId = ids.fileId();
  db.run(`INSERT INTO case_files(file_id, case_id, doc_key, name, mime, size, content, phase, uploaded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, fileId, caseId, docKey, name, mime, content.length, content, phase, clock.nowIso());
  return { fileId, name, docKey, size: content.length };
}
function countFiles(caseId) { return Number(db.get('SELECT COUNT(*) AS n FROM case_files WHERE case_id = ?', caseId).n); }

// ---------- ออกเลข (ตัวนับใน counters · ทุกรูปแบบอยู่ที่นี่ที่เดียว) ----------
const pad = (n, w) => String(n).padStart(w, '0');
const beYear = (ms) => clock.parts(ms).year + 543;
const ids = {
  /** 'DR-0003' (ต่อเนื่อง ไม่รีเซ็ตรายปี · A-47) */
  draftId: () => `DR-${pad(db.nextCounter('draft'), 4)}`,
  /** 'PP-0002' (A-47) */
  payRef: () => `PP-${pad(db.nextCounter('payref'), 4)}`,
  /** เลขคำขอ + ใบเสร็จ ตามปี พ.ศ. ของเวลาชำระ → { caseNo:'EG-2569-000031', receiptNo:'RC-2569-000031' } (BR-09 A-48) */
  caseNo: (paidMs = clock.now()) => {
    const y = beYear(paidMs); const n = pad(db.nextCounter(`case:${y}`), 6);
    return { caseNo: `EG-${y}-${n}`, receiptNo: `RC-${y}-${n}` };
  },
  /** 'DOC-2569-000002' ตามปี พ.ศ. ของเวลาออก (A-48) */
  docNo: (issuedMs = clock.now()) => { const y = beYear(issuedMs); return `DOC-${y}-${pad(db.nextCounter(`doc:${y}`), 6)}`; },
  /** 'F-000051' */
  fileId: () => `F-${pad(db.nextCounter('file'), 6)}`,
};

/** HTML รายการไฟล์: doc-item (data-name, data-file-id) + doc-download-link → /api/files/<fileId> */
function docItemsHtml(caseId) {
  const list = files(caseId);
  if (!list.length) return html`<p class="muted">ไม่มีไฟล์แนบ</p>`;
  return html`<ul class="doc-list">${list.map((f) => html`<li data-testid="doc-item" data-name="${f.name}" data-file-id="${f.fileId}" data-doc-key="${f.docKey}">
    ${catalog.DOC_LABELS[f.docKey] || f.docKey}: <a data-testid="doc-download-link" href="/api/files/${encodeURIComponent(f.fileId)}" download="${f.name}">${f.name}</a> <span class="muted">(${(f.size / 1024).toFixed(1)} KB)</span>
  </li>`)}</ul>`;
}

module.exports = {
  getByCaseNo, getById, getByDraftId, applicantIdNo, applicantIdMasked, levelOf, verifyCodeOf, toJson,
  addEvent, events, timelineHtml, files, fileWithContent, fileAccess, docItemsHtml,
  MAX_FILE_BYTES, MAX_FILES_PER_CASE, detectMime, addFile, countFiles, ids,
};
