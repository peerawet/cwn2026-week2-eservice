'use strict';
// ตรรกะธุรกิจของ workflow (B03): รับเรื่อง · ตีกลับ · ส่งต่อ · อนุมัติ/ไม่อนุมัติ · ส่งแก้ไข · ยกเลิกอัตโนมัติ · แจ้งเตือน SLA
// ทุกฟังก์ชัน "ตรวจแล้วเขียน" ทำจบแบบ synchronous ไม่มี await คั่น (INTERFACES §0 ข้อ 8)
// BUG_MODE ที่อยู่ในไฟล์นี้: B04 (resubmit ไม่หยุดนับ) · B07 (officer อนุมัติ SV-02/03) · B08 (claim ข้ามการตรวจผู้ถือ) · B12 (ตีกลับครั้งที่ 3)

const FIX_WINDOW_MS = 168 * 3600 * 1000; // BR-20
const MAX_RETURNS = 2; // BR-19
const MAX_WORKLOAD = 10; // BR-18
const MIN_REASON = 10; // BR-19

module.exports = function createLogic(ctx) {
  const { db, clock, sla, bugs, audit, cases, errors, catalog, people } = ctx;
  const { AppError } = errors;

  // ---------- ตัวช่วย ----------
  /** คำขอที่มีเลขแล้วเท่านั้น (ร่างไม่ใช่คำขอ) */
  function findCase(caseNo) {
    const row = cases.getByCaseNo(String(caseNo || ''));
    return row && row.case_no ? row : null;
  }
  function mustFind(caseNo) {
    const row = findCase(caseNo);
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }
  /** เหตุผล: ตัดช่องว่างหัวท้ายแล้วต้อง ≥ 10 ตัวอักษร (A-44) */
  function reasonOf(v) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (Array.from(s).length < MIN_REASON) throw new AppError('REASON_TOO_SHORT');
    return s;
  }
  function noteOf(v) { return typeof v === 'string' ? v.trim().slice(0, 500) : ''; }
  /** งานในมือ = IN_REVIEW ที่ตัวเองถือ (BR-18) */
  function workloadOf(username) {
    return Number(db.get("SELECT COUNT(*) AS n FROM cases WHERE status = 'IN_REVIEW' AND owner = ?", username).n);
  }
  const isHolder = (user, row) => user.role === 'officer' && !!row.owner && row.owner === user.username;
  /** claim ได้ไหม (ไม่รวมเพดานงาน) — ใช้ตัดสินว่าจะแสดงปุ่ม */
  function canClaim(user, row) {
    return user.role === 'officer' && row.dept === user.dept && !row.owner
      && (row.status === 'SUBMITTED' || row.status === 'IN_REVIEW');
  }
  /** ขั้นถัดไปของเส้นทาง (null = ไม่มี) · step เริ่ม 1 */
  function nextStage(row) {
    const route = catalog.ROUTES[row.service_id] || [];
    const step = row.step || 1;
    return step < route.length ? { step: step + 1, dept: route[step] } : null;
  }
  const touch = (id, sets, params) => db.run(`UPDATE cases SET ${sets}, updated_at = ? WHERE id = ?`, ...params, clock.nowIso(), id);

  // ---------- รับเรื่อง (BR-17 BR-18) ----------
  function claim(user, caseNo) {
    if (user.role !== 'officer') throw new AppError('FORBIDDEN');
    const row = mustFind(caseNo);
    if (row.dept && row.dept !== user.dept) throw new AppError('FORBIDDEN'); // ข้ามแผนก
    if (row.status !== 'SUBMITTED' && row.status !== 'IN_REVIEW') throw new AppError('INVALID_STATE');
    // B08: ข้ามการตรวจว่ามีผู้ถือแล้ว → คนที่ 2 ได้ 200 และกลายเป็นผู้ถือแทน
    if (row.owner && !bugs.isOn('B08')) throw new AppError('ALREADY_CLAIMED');
    if (workloadOf(user.username) >= MAX_WORKLOAD) throw new AppError('WORKLOAD_LIMIT');
    db.tx(() => {
      const extra = row.dept === 'registry' ? ', reg_officer = ?' : row.dept === 'works' ? ', works_officer = ?' : '';
      touch(row.id, `status = 'IN_REVIEW', owner = ?${extra}`, extra ? [user.username, user.username] : [user.username]);
      cases.addEvent(row.id, { type: 'CLAIM', actor: user.username, actorRole: user.role, fromStatus: row.status, toStatus: 'IN_REVIEW' });
      audit.log({ user, event: 'CLAIM', caseNo: row.case_no, fromStatus: row.status, toStatus: 'IN_REVIEW', detail: '' });
    });
    return { owner: user.username, status: 'IN_REVIEW' };
  }

  // ---------- ตีกลับ (BR-19) ----------
  function returnCase(user, caseNo, body) {
    if (user.role !== 'officer') throw new AppError('FORBIDDEN');
    const row = mustFind(caseNo);
    if (!isHolder(user, row)) throw new AppError('FORBIDDEN');
    if (row.status !== 'IN_REVIEW') throw new AppError('INVALID_STATE');
    // B12: ไม่ตรวจเพดานตีกลับ 2 ครั้ง
    if ((row.return_count || 0) >= MAX_RETURNS && !bugs.isOn('B12')) throw new AppError('RETURN_LIMIT');
    const reason = reasonOf(body && body.reason);
    const nowMs = clock.now();
    const now = clock.toIso(nowMs);
    const deadline = clock.toIso(nowMs + FIX_WINDOW_MS);
    const count = (row.return_count || 0) + 1;
    db.tx(() => {
      touch(row.id, 'status = ?, return_count = ?, returned_at = ?, return_reason = ?, fix_deadline = ?', ['NEED_FIX', count, now, reason, deadline]);
      cases.addEvent(row.id, { type: 'RETURN', actor: user.username, actorRole: user.role, fromStatus: 'IN_REVIEW', toStatus: 'NEED_FIX', note: reason, time: now });
      audit.log({ user, event: 'RETURN', caseNo: row.case_no, fromStatus: 'IN_REVIEW', toStatus: 'NEED_FIX', detail: reason });
    });
    return { status: 'NEED_FIX', returnCount: count };
  }

  // ---------- ส่งต่อ (FR-15: ปลายทางระบบเลือกเอง) ----------
  function forward(user, caseNo, body) {
    if (user.role !== 'officer') throw new AppError('FORBIDDEN');
    const row = mustFind(caseNo);
    if (!isHolder(user, row)) throw new AppError('FORBIDDEN');
    if (row.status !== 'IN_REVIEW') throw new AppError('INVALID_STATE');
    const next = nextStage(row);
    if (!next) throw new AppError('INVALID_STATE'); // SV-01 ไม่มีขั้นถัดไป (เจ้าหน้าที่อนุมัติเอง)
    const note = noteOf(body && body.note);
    const toStatus = next.dept === 'head' ? 'PENDING_APPROVAL' : 'IN_REVIEW';
    db.tx(() => {
      touch(row.id, 'status = ?, step = ?, dept = ?, owner = NULL', [toStatus, next.step, next.dept]);
      cases.addEvent(row.id, { type: 'FORWARD', actor: user.username, actorRole: user.role, fromStatus: 'IN_REVIEW', toStatus, note });
      audit.log({ user, event: 'FORWARD', caseNo: row.case_no, fromStatus: 'IN_REVIEW', toStatus, detail: note });
    });
    const out = { status: toStatus };
    if (row.service_id === 'SV-03') out.step = next.step;
    return out;
  }

  // ---------- อนุมัติ / ไม่อนุมัติ (BR-21: ตรวจที่ API) ----------
  /**
   * ตรวจอำนาจ: SV-01 = เจ้าหน้าที่ผู้ถือเรื่อง (IN_REVIEW) · SV-02/03 = head (PENDING_APPROVAL)
   * allowOfficerB07 = true เฉพาะ approve: B07 เปิดอยู่ → เจ้าหน้าที่อนุมัติ SV-02/03 ได้เอง (ไม่ผ่านหัวหน้า)
   */
  function authorize(user, row, allowOfficerB07) {
    if (row.service_id === 'SV-01') {
      if (!isHolder(user, row)) throw new AppError('FORBIDDEN'); // head / ผู้ไม่ใช่ผู้ถือ → 403
      if (row.status !== 'IN_REVIEW') throw new AppError('INVALID_STATE');
      return;
    }
    if (user.role === 'head') {
      if (row.status !== 'PENDING_APPROVAL') throw new AppError('INVALID_STATE');
      return;
    }
    if (allowOfficerB07 && bugs.isOn('B07') && user.role === 'officer') {
      if (row.status !== 'IN_REVIEW' && row.status !== 'PENDING_APPROVAL') throw new AppError('INVALID_STATE');
      return;
    }
    throw new AppError('FORBIDDEN');
  }

  function approve(user, caseNo) {
    if (user.role !== 'officer' && user.role !== 'head') throw new AppError('FORBIDDEN');
    const row = mustFind(caseNo);
    authorize(user, row, true);
    const now = clock.nowIso();
    const from = row.status;
    db.tx(() => {
      // APPROVED = dept registry รอผู้ออกเอกสาร (reg_officer) · owner ว่าง
      touch(row.id, "status = 'APPROVED', dept = 'registry', owner = NULL, approved_by = ?, approved_at = ?, reg_officer = ?",
        [user.username, now, row.reg_officer || (row.dept === 'registry' ? row.owner : null) || null]);
      cases.addEvent(row.id, { type: 'APPROVE', actor: user.username, actorRole: user.role, fromStatus: from, toStatus: 'APPROVED', time: now });
      audit.log({ user, event: 'APPROVE', caseNo: row.case_no, fromStatus: from, toStatus: 'APPROVED', detail: '' });
    });
    return { status: 'APPROVED' };
  }

  function reject(user, caseNo, body) {
    if (user.role !== 'officer' && user.role !== 'head') throw new AppError('FORBIDDEN');
    const row = mustFind(caseNo);
    authorize(user, row, false); // เจ้าหน้าที่ SV-02/03 ไม่เคยมีอำนาจไม่อนุมัติ (แม้ครบตีกลับ 2 ครั้ง)
    const reason = reasonOf(body && body.reason);
    const now = clock.nowIso();
    const from = row.status;
    db.tx(() => {
      touch(row.id, "status = 'REJECTED', dept = NULL, owner = NULL, rejected_by = ?, reject_reason = ?, closed_at = ?", [user.username, reason, now, ]);
      cases.addEvent(row.id, { type: 'REJECT', actor: user.username, actorRole: user.role, fromStatus: from, toStatus: 'REJECTED', note: reason, time: now });
      audit.log({ user, event: 'REJECT', caseNo: row.case_no, fromStatus: from, toStatus: 'REJECTED', detail: reason });
    });
    return { status: 'REJECTED', closedAt: now };
  }

  // ---------- ส่งแก้ไข (BR-13 BR-20 A-29) ----------
  /** files = [{ originalname, buffer, size, docKey }] จาก multer (ไม่บังคับ) */
  function resubmit(user, caseNo, files = []) {
    const row = findCase(caseNo);
    if (!row || row.citizen_id !== user.citizenId) throw new AppError('NOT_FOUND'); // ของคนอื่น = ไม่พบ (BR-22)
    if (row.status !== 'NEED_FIX') {
      throw new AppError(row.cancel_kind === 'FIX_TIMEOUT' ? 'FIX_WINDOW_EXPIRED' : 'INVALID_STATE');
    }
    const nowMs = clock.now();
    if (row.fix_deadline && nowMs >= clock.parseIso(row.fix_deadline)) { // 168:00 พอดี = หมดเวลา
      autoCancelCase(row);
      throw new AppError('FIX_WINDOW_EXPIRED');
    }
    // ตรวจไฟล์ทั้งหมดก่อนเขียนอะไร
    let have = cases.countFiles(row.id);
    const accepted = [];
    for (const f of files) {
      const size = f.size != null ? f.size : f.buffer.length;
      if (size > cases.MAX_FILE_BYTES) throw new AppError('FILE_TOO_LARGE'); // ≤ 5,242,880 ผ่าน (BR-07)
      const mime = cases.detectMime(f.buffer);
      if (!mime) throw new AppError('FILE_TYPE');
      const docKey = catalog.DOC_LABELS[f.docKey] ? f.docKey : 'extra';
      if (docKey === 'plan' && mime !== 'application/pdf') throw new AppError('PLAN_NOT_PDF');
      if (have + 1 > cases.MAX_FILES_PER_CASE) throw new AppError('FILE_COUNT');
      have += 1;
      accepted.push({ docKey, name: f.originalname || 'file', mime, content: f.buffer });
    }
    const now = clock.toIso(nowMs);
    // BR-13: กำหนดใหม่ = กำหนดเดิม + วันทำการใน (วันตีกลับ, วันส่งแก้] · B04: ไม่หยุดนับ (คงกำหนดเดิม)
    const dueAt = bugs.isOn('B04') ? row.due_at : sla.extendDueAt(row.due_at, row.returned_at, now).dueAt;
    db.tx(() => {
      for (const a of accepted) cases.addFile(row.id, { ...a, phase: 'fix' });
      // กลับ IN_REVIEW กับผู้ถือเดิมในขั้นเดิม ไม่ตรวจเพดาน 10 งาน (A-19 A-29)
      touch(row.id, "status = 'IN_REVIEW', due_at = ?, fix_deadline = NULL", [dueAt]);
      cases.addEvent(row.id, { type: 'RESUBMIT', actor: 'citizen', actorRole: 'citizen', fromStatus: 'NEED_FIX', toStatus: 'IN_REVIEW', time: now });
    });
    return { status: 'IN_REVIEW', dueAt };
  }

  // ---------- ยกเลิกอัตโนมัติเมื่อเลย 168 ชม. (A-46) ----------
  function autoCancelCase(row) {
    const at = row.fix_deadline; // เวลาที่ลงไทม์ไลน์/ยกเลิก = ตีกลับ + 168 ชม.
    db.tx(() => {
      db.run(`UPDATE cases SET status = 'CANCELLED', dept = NULL, owner = NULL, cancelled_at = ?, cancel_kind = 'FIX_TIMEOUT', updated_at = ? WHERE id = ? AND status = 'NEED_FIX'`,
        at, clock.nowIso(), row.id);
      cases.addEvent(row.id, { type: 'AUTO_CANCEL', actor: 'system', actorRole: null, fromStatus: 'NEED_FIX', toStatus: 'CANCELLED', time: at });
    });
  }
  function autoCancelExpired() {
    const rows = db.all("SELECT id, fix_deadline FROM cases WHERE status = 'NEED_FIX' AND fix_deadline IS NOT NULL");
    const now = clock.now();
    for (const r of rows) {
      const dl = clock.parseIso(r.fix_deadline);
      if (dl != null && now >= dl) autoCancelCase(r);
    }
  }

  // ---------- แจ้งเตือน SLA (BR-15 A-30 A-31) ----------
  /** ผู้รับตามสถานะ/ระดับ */
  function recipientsOf(row, level) {
    const set = new Set();
    if (row.status === 'PENDING_APPROVAL') people.heads().forEach((h) => set.add(h.username));
    else if (row.status === 'APPROVED') { if (row.reg_officer) set.add(row.reg_officer); } // ผู้ออกเอกสาร
    else if (row.owner) set.add(row.owner);
    else if (row.dept) people.officersOfDept(row.dept).forEach((o) => set.add(o.username));
    if (level === 'overdue') people.heads().forEach((h) => set.add(h.username)); // เกินกำหนดแจ้ง head เพิ่มเสมอ
    return set;
  }
  const NOTI_TEXT = { near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด' };
  /** ประเมิน "ระดับปัจจุบัน" ของทุกคำขอที่ยังเดินอยู่ → INSERT OR IGNORE (1 ครั้งต่อ ระดับ/คำขอ/คน) */
  function evaluateNotifications() {
    const nowMs = clock.now();
    const nowIso = clock.toIso(nowMs);
    const rows = db.all(`SELECT * FROM cases WHERE case_no IS NOT NULL AND due_at IS NOT NULL
      AND status IN ('SUBMITTED','IN_REVIEW','PENDING_APPROVAL','APPROVED')`);
    for (const row of rows) {
      const level = sla.levelOf(row, nowMs);
      if (level !== 'near' && level !== 'overdue') continue;
      for (const username of recipientsOf(row, level)) {
        db.run('INSERT OR IGNORE INTO notifications(username, case_no, level, text, created_at) VALUES (?, ?, ?, ?, ?)',
          username, row.case_no, level, `คำขอ ${row.case_no} ${NOTI_TEXT[level]}`, nowIso);
      }
    }
  }

  /** hook ก่อนทุก request (CONTRACT §0 ข้อ 7): ยกเลิกอัตโนมัติ + ประเมินแจ้งเตือน */
  function tick() {
    db.tx(() => { autoCancelExpired(); evaluateNotifications(); });
  }

  // ---------- คิว ----------
  /** แถวคิวของผู้ใช้ (officer = แผนกตัวเอง · head = ทุกแผนกอ่านอย่างเดียว) เรียงตาม BR-16 (A-34) */
  function queueRows(user, filter = 'all') {
    const params = [];
    let deptSql = '';
    if (user.role === 'officer') { deptSql = 'AND c.dept = ?'; params.push(user.dept); } else deptSql = "AND c.dept IN ('registry','works')";
    const rows = db.all(`${'SELECT c.*, z.name AS applicant_name, z.id_enc AS applicant_id_enc FROM cases c JOIN citizens z ON z.id = c.citizen_id'}
      WHERE c.case_no IS NOT NULL AND c.status IN ('SUBMITTED','IN_REVIEW','APPROVED') ${deptSql}
      ORDER BY c.due_at, c.case_no`, ...params);
    if (filter === 'unclaimed') return rows.filter((r) => !r.owner && (r.status === 'SUBMITTED' || r.status === 'IN_REVIEW'));
    if (filter === 'mine') return rows.filter((r) => r.status === 'IN_REVIEW' && r.owner === user.username);
    return rows;
  }
  function approvalRows() {
    return db.all(`SELECT c.*, z.name AS applicant_name, z.id_enc AS applicant_id_enc FROM cases c JOIN citizens z ON z.id = c.citizen_id
      WHERE c.case_no IS NOT NULL AND c.status = 'PENDING_APPROVAL' ORDER BY c.due_at, c.case_no`);
  }
  function notificationsOf(username) {
    return db.all('SELECT * FROM notifications WHERE username = ? ORDER BY created_at DESC, id DESC', username);
  }

  return {
    MAX_RETURNS, MAX_WORKLOAD, findCase, canClaim, isHolder, nextStage, workloadOf,
    claim, returnCase, forward, approve, reject, resubmit, tick, autoCancelExpired, evaluateNotifications,
    queueRows, approvalRows, notificationsOf,
  };
};
