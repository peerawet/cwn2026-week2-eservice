'use strict';
// API คำขอของประชาชน/เจ้าหน้าที่ที่เปิดอ่าน: รายการ · รายละเอียด (PDPA) · ยกเลิก · ไฟล์แนบ  — CONTRACT §6.2 §6.7
// B06: ประชาชนเปิดคำขอของคนอื่นได้ (ไม่ตรวจเจ้าของ) ทั้งหน้าและ API

module.exports = function registerCaseApi(app, ctx) {
  const { errors, db, clock, cases, session } = ctx;
  const { sendError } = errors;

  /**
   * คำขอที่ผู้ใช้ "เปิดดูได้" ตามบทบาท → row หรือ null (= 404 เหมือนกันทุกกรณี)
   * citizen: เจ้าของเท่านั้น · officer/head: ทุกคำขอที่มีเลขแล้ว
   */
  function viewableCase(req, caseNo) {
    const row = cases.getByCaseNo(String(caseNo));
    if (!row) return null;
    if (req.user.role === 'citizen') {
      if (ctx.bugs.isOn('B06')) return row; // B06: IDOR
      return row.citizen_id === req.user.citizenId ? row : null;
    }
    return row;
  }

  app.get('/api/cases', session.requireRole('citizen'), (req, res) => {
    const rows = db.all('SELECT * FROM cases WHERE citizen_id = ? AND case_no IS NOT NULL ORDER BY case_no DESC', req.user.citizenId);
    res.json({ items: rows.map((r) => ({ caseNo: r.case_no, serviceId: r.service_id, status: r.status, dueAt: r.due_at || null, slaLevel: cases.levelOf(r) })) });
  });

  app.get('/api/cases/:caseNo', session.requireRole('citizen', 'officer', 'head'), (req, res) => {
    const row = viewableCase(req, req.params.caseNo);
    if (!row) return sendError(res, 'NOT_FOUND');
    res.json(cases.toJson(row, req.user));
  });

  // ยกเลิกคำขอ: เฉพาะ SUBMITTED ที่ยังไม่มีผู้รับ (BR-22) · ทำจบแบบ synchronous ไม่มี await (atomic กับ claim)
  app.post('/api/cases/:caseNo/cancel', session.requireRole('citizen'), (req, res) => {
    const row = cases.getByCaseNo(String(req.params.caseNo));
    if (!row || row.citizen_id !== req.user.citizenId) return sendError(res, 'NOT_FOUND');
    if (row.status !== 'SUBMITTED' || row.owner) return sendError(res, 'CANNOT_CANCEL');
    const now = clock.nowIso();
    db.tx(() => {
      db.run(`UPDATE cases SET status = 'CANCELLED', cancelled_at = ?, cancel_kind = 'CITIZEN', dept = NULL, owner = NULL, updated_at = ? WHERE id = ?`, now, now, row.id);
      cases.addEvent(row.id, { type: 'CANCEL', actor: 'citizen', actorRole: 'citizen', fromStatus: 'SUBMITTED', toStatus: 'CANCELLED', time: now });
    });
    res.json({ status: 'CANCELLED' });
  });

  // ---------- ไฟล์แนบ (BR-29) ----------
  app.get('/api/cases/:caseNo/files', (req, res) => {
    const row = cases.getByCaseNo(String(req.params.caseNo));
    const acc = cases.fileAccess(req.user, row);
    if (acc === 'unauthenticated') return sendError(res, 'UNAUTHENTICATED');
    if (acc === 'not_found') return sendError(res, 'NOT_FOUND');
    if (acc === 'forbidden') return sendError(res, 'FORBIDDEN');
    res.json({ items: cases.files(row.id).map((f) => ({ fileId: f.fileId, name: f.name, docKey: f.docKey, size: f.size })) });
  });

  app.get('/api/files/:fileId', (req, res) => {
    if (!req.user) return sendError(res, 'UNAUTHENTICATED');
    const f = cases.fileWithContent(String(req.params.fileId));
    if (!f) return sendError(res, 'NOT_FOUND');
    const acc = cases.fileAccess(req.user, cases.getById(f.caseId));
    if (acc === 'unauthenticated') return sendError(res, 'UNAUTHENTICATED');
    if (acc === 'not_found') return sendError(res, 'NOT_FOUND');
    if (acc === 'forbidden') return sendError(res, 'FORBIDDEN');
    res.set('Content-Type', f.mime);
    res.set('Content-Length', String(f.content.length));
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(f.content);
  });

  return { viewableCase };
};
