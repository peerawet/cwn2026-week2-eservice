'use strict';
// ร่างคำขอ · ไฟล์แนบ · ชำระเงิน QR จำลอง · hook testPay  — CONTRACT §6.2 §8
// B02: ไฟล์ 5,242,880 ไบต์พอดีถูกปฏิเสธ (ใช้ < แทน ≤)
// B05: QR อายุ 15:00 พอดียังจ่ายได้ (ใช้ ≤ แทน <)

const QRCode = require('qrcode');

const QR_TTL_MS = 15 * 60 * 1000;

module.exports = function registerDrafts(app, ctx, fees) {
  const { errors, db, clock, cases, catalog, session } = ctx;
  const { AppError, sendError } = errors;
  const citizenOnly = session.requireRole('citizen');

  // ---------- ตัวช่วย ----------
  /** ร่างของฉัน (404 ถ้าไม่มี/ของคนอื่น/ไม่ใช่ร่าง) */
  function ownDraft(req, draftId) {
    const row = cases.getByDraftId(String(draftId));
    if (!row || row.citizen_id !== req.user.citizenId) throw new AppError('NOT_FOUND');
    return row;
  }
  const docKeysOf = (caseId) => db.all('SELECT doc_key FROM case_files WHERE case_id = ?', caseId).map((r) => r.doc_key);
  const missingOf = (row) => catalog.missingDocs(row.service_id, docKeysOf(row.id));

  function isExpired(p, nowMs = clock.now()) {
    return nowMs - clock.parseIso(p.qr_created_at) >= QR_TTL_MS;
  }
  function payStatus(p) {
    if (p.status === 'PAID') return 'PAID';
    return isExpired(p) ? 'EXPIRED' : 'PENDING';
  }
  const payJson = (p) => ({
    ref: p.ref, amount: p.amount, status: payStatus(p),
    qrCreatedAt: p.qr_created_at, qrExpiresAt: p.qr_expires_at, paidAt: p.paid_at || null,
    caseNo: p.case_no || null, receiptNo: p.receipt_no || null,
  });
  const latestPayment = (caseId) => db.get('SELECT * FROM payments WHERE case_id = ? ORDER BY rowid DESC LIMIT 1', caseId);

  function draftJson(row) {
    const files = cases.files(row.id).map((f) => ({ fileId: f.fileId, name: f.name, docKey: f.docKey, size: f.size }));
    const p = latestPayment(row.id);
    return {
      draftId: row.draft_id, serviceId: row.service_id, status: row.status, fee: row.fee,
      qty: row.qty, areaSqm: row.area_sqm, caseNo: row.case_no || null,
      files, fileCount: files.length, missing: missingOf(row),
      payment: p ? payJson(p) : null,
    };
  }

  /** ชื่อไฟล์จาก multer (latin1) → UTF-8 ถ้าเป็นภาษาไทย */
  function fixName(name) {
    const s = String(name || 'file');
    if (/^[\x00-\xff]*$/.test(s) && /[\x80-\xff]/.test(s)) {
      const u = Buffer.from(s, 'latin1').toString('utf8');
      if (!u.includes('�')) return u;
    }
    return s;
  }

  // ---------- ค่าธรรมเนียม (หน้า wizard เรียกเพื่อแสดง fee-total) ----------
  app.get('/api/fee/quote', session.requireRole(), (req, res) => {
    const q = req.query || {};
    const r = fees.calc(String(q.serviceId || ''), { qty: q.qty, areaSqm: q.areaSqm });
    res.json({ fee: r.fee });
  });

  // ---------- ร่าง ----------
  app.post('/api/drafts', citizenOnly, (req, res) => {
    const b = req.body || {};
    const serviceId = String(b.serviceId || '');
    if (!catalog.SERVICE_IDS.includes(serviceId)) return sendError(res, 'BAD_REQUEST');
    const r = fees.calc(serviceId, b);
    const draftId = cases.ids.draftId();
    const now = clock.nowIso();
    db.run(`INSERT INTO cases(draft_id, service_id, citizen_id, status, qty, area_sqm, fee, created_at, updated_at)
            VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`, draftId, serviceId, req.user.citizenId, r.qty, r.areaSqm, r.fee, now, now);
    res.status(201).json({ draftId, fee: r.fee });
  });

  app.get('/api/drafts', citizenOnly, (req, res) => {
    const rows = db.all(`SELECT * FROM cases WHERE citizen_id = ? AND draft_id IS NOT NULL AND status IN ('DRAFT','PENDING_PAYMENT') ORDER BY draft_id`, req.user.citizenId);
    res.json({ items: rows.map((r) => ({ draftId: r.draft_id, serviceId: r.service_id, status: r.status, fee: r.fee })) });
  });

  app.get('/api/drafts/:id', citizenOnly, (req, res) => {
    res.json(draftJson(ownDraft(req, req.params.id)));
  });

  // แก้ข้อมูลร่าง (จำนวนฉบับ/พื้นที่) เฉพาะ DRAFT
  app.put('/api/drafts/:id', citizenOnly, (req, res) => {
    const row = ownDraft(req, req.params.id);
    if (row.status !== 'DRAFT') return sendError(res, 'INVALID_STATE');
    const r = fees.calc(row.service_id, req.body || {});
    db.run('UPDATE cases SET qty = ?, area_sqm = ?, fee = ?, updated_at = ? WHERE id = ?', r.qty, r.areaSqm, r.fee, clock.nowIso(), row.id);
    res.json({ draftId: row.draft_id, fee: r.fee });
  });

  app.delete('/api/drafts/:id', citizenOnly, (req, res) => {
    const row = ownDraft(req, req.params.id);
    if (row.status !== 'DRAFT' && row.status !== 'PENDING_PAYMENT') return sendError(res, 'INVALID_STATE');
    db.tx(() => {
      db.run('DELETE FROM payments WHERE case_id = ?', row.id);
      db.run('DELETE FROM case_files WHERE case_id = ?', row.id);
      db.run('DELETE FROM case_events WHERE case_id = ?', row.id);
      db.run('DELETE FROM cases WHERE id = ?', row.id);
    });
    res.status(204).end();
  });

  // ---------- ไฟล์แนบ ----------
  app.post('/api/drafts/:id/files', citizenOnly, ctx.upload.single('file'), (req, res) => {
    const row = ownDraft(req, req.params.id);
    if (row.status !== 'DRAFT') return sendError(res, 'INVALID_STATE');
    const f = req.file;
    const docKey = String((req.body && req.body.docKey) || '');
    const allowed = new Set([...catalog.DOCS[row.service_id].map((d) => d.key), catalog.EXTRA_DOC.key]);
    if (!f || !allowed.has(docKey)) return sendError(res, 'BAD_REQUEST');

    const size = f.size != null ? f.size : f.buffer.length;
    const max = cases.MAX_FILE_BYTES;
    const sizeOk = ctx.bugs.isOn('B02') ? size < max : size <= max; // B02: ขอบ 5 MB ผิด
    if (!sizeOk) return sendError(res, 'FILE_TOO_LARGE');
    const mime = cases.detectMime(f.buffer); // magic bytes เท่านั้น (A-49)
    if (!mime) return sendError(res, 'FILE_TYPE');
    if (docKey === 'plan' && mime !== 'application/pdf') return sendError(res, 'PLAN_NOT_PDF');

    // ช่องเดี่ยว (ไม่ใช่ extra) แนบซ้ำ = แทนที่ไฟล์เดิมของช่องนั้น
    const replaced = docKey === 'extra' ? [] : db.all('SELECT file_id FROM case_files WHERE case_id = ? AND doc_key = ?', row.id, docKey);
    if (cases.countFiles(row.id) - replaced.length >= cases.MAX_FILES_PER_CASE) return sendError(res, 'FILE_COUNT');

    let saved;
    db.tx(() => {
      for (const r of replaced) db.run('DELETE FROM case_files WHERE file_id = ?', r.file_id);
      saved = cases.addFile(row.id, { docKey, name: fixName(f.originalname), mime, content: f.buffer, phase: 'initial' });
      db.run('UPDATE cases SET updated_at = ? WHERE id = ?', clock.nowIso(), row.id);
    });
    res.status(201).json({ ...saved, missing: missingOf(row) });
  });

  app.delete('/api/drafts/:id/files/:fileId', citizenOnly, (req, res) => {
    const row = ownDraft(req, req.params.id);
    if (row.status !== 'DRAFT') return sendError(res, 'INVALID_STATE');
    const r = db.run('DELETE FROM case_files WHERE file_id = ? AND case_id = ?', req.params.fileId, row.id);
    if (!r.changes) return sendError(res, 'NOT_FOUND');
    res.json({ ok: true, missing: missingOf(row) });
  });

  // ---------- ชำระเงิน ----------
  app.post('/api/drafts/:id/payment', citizenOnly, errors.wrap(async (req, res) => {
    const row = ownDraft(req, req.params.id);
    if (row.status !== 'DRAFT' && row.status !== 'PENDING_PAYMENT') return sendError(res, 'INVALID_STATE');
    const missing = missingOf(row);
    if (missing.length) return sendError(res, 'MISSING_DOCS', { missing });

    let p;
    db.tx(() => {
      let amount = row.fee;
      if (row.status === 'DRAFT') { // ล็อกยอดตอนเข้า PENDING_PAYMENT (BR-11)
        amount = fees.calc(row.service_id, { qty: row.qty, areaSqm: row.area_sqm }).fee;
        db.run("UPDATE cases SET status = 'PENDING_PAYMENT', fee = ?, updated_at = ? WHERE id = ?", amount, clock.nowIso(), row.id);
      }
      const now = clock.now();
      const ref = cases.ids.payRef();
      db.run(`INSERT INTO payments(ref, case_id, amount, status, qr_created_at, qr_expires_at) VALUES (?, ?, ?, 'PENDING', ?, ?)`,
        ref, row.id, amount, clock.toIso(now), clock.toIso(now + QR_TTL_MS));
      p = db.get('SELECT * FROM payments WHERE ref = ?', ref);
    });
    const qrImage = await QRCode.toDataURL(`EGOV-PROMPTPAY-MOCK|${p.ref}|${p.amount}`, { margin: 1, width: 220 });
    res.status(201).json({ ...payJson(p), qrCreatedAt: p.qr_created_at, qrExpiresAt: p.qr_expires_at, qrImage });
  }));

  app.get('/api/payments/:ref', session.requireRole('citizen', 'officer', 'head'), (req, res) => {
    const p = db.get('SELECT * FROM payments WHERE ref = ?', req.params.ref);
    if (!p) return sendError(res, 'NOT_FOUND');
    if (req.user.role === 'citizen') {
      const c = cases.getById(p.case_id);
      if (!c || c.citizen_id !== req.user.citizenId) return sendError(res, 'NOT_FOUND');
    }
    res.json(payJson(p));
  });

  // ---------- hook: จำลอง callback ธนาคาร (POST /api/test/payments/:ref/pay) ----------
  ctx.hooks.testPay((req, res) => {
    const p = db.get('SELECT * FROM payments WHERE ref = ?', String(req.params.ref));
    if (!p) return sendError(res, 'NOT_FOUND');
    if (p.status === 'PAID') { // callback ซ้ำ = idempotent
      return res.json({ status: 'PAID', caseNo: p.case_no, receiptNo: p.receipt_no, duplicate: true });
    }
    const row = cases.getById(p.case_id);
    if (!row || row.status !== 'PENDING_PAYMENT') return sendError(res, 'INVALID_STATE');

    const nowMs = clock.now();
    const age = nowMs - clock.parseIso(p.qr_created_at);
    const expired = ctx.bugs.isOn('B05') ? age > QR_TTL_MS : age >= QR_TTL_MS; // B05: ขอบ 15:00 ผิด
    if (expired) return sendError(res, 'QR_EXPIRED');
    const amount = typeof req.body.amount === 'string' && req.body.amount.trim() !== '' ? Number(req.body.amount) : req.body.amount;
    if (typeof amount !== 'number' || amount !== p.amount) return sendError(res, 'AMOUNT_MISMATCH');

    let out;
    db.tx(() => {
      const paidIso = clock.toIso(nowMs);
      const { caseNo, receiptNo } = cases.ids.caseNo(nowMs);
      const svc = db.get('SELECT sla_days FROM services WHERE id = ?', row.service_id);
      const dueAt = ctx.sla.computeDueAt(nowMs, svc.sla_days);
      db.run(`UPDATE cases SET status = 'SUBMITTED', case_no = ?, receipt_no = ?, paid_at = ?, due_at = ?, step = 1, dept = 'registry',
              owner = NULL, updated_at = ? WHERE id = ?`, caseNo, receiptNo, paidIso, dueAt, paidIso, row.id);
      db.run("UPDATE payments SET status = 'PAID', paid_at = ?, case_no = ?, receipt_no = ? WHERE ref = ?", paidIso, caseNo, receiptNo, p.ref);
      cases.addEvent(row.id, { type: 'PAID', actor: 'citizen', actorRole: 'citizen', fromStatus: 'PENDING_PAYMENT', toStatus: 'SUBMITTED', time: paidIso });
      out = { status: 'PAID', caseNo, receiptNo, duplicate: false };
    });
    res.json(out);
  });

  return { draftJson };
};
