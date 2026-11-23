'use strict';
// เอกสารดิจิทัล: ออกเอกสาร (issue) · PDF · /verify · test hook tamper · แสดงเลขบัตรเต็ม (unmask)

const QRCode = require('qrcode');
const pdf = require('./pdf');

const p2 = (n) => String(n).padStart(2, '0');

module.exports = function registerDocuments(app, ctx) {
  const { db, clock, crypto, errors, format, layout, session, audit, cases, catalog } = ctx;
  const { html, timeEl, dateEl, maskName } = format;
  const { requireRole } = session;

  // ---------- กฎอายุเอกสาร (BR-23 · A-23 A-61) ----------
  /** วันสุดท้ายที่ใช้ได้ 'YYYY-MM-DD' */
  function validUntilOf(serviceId, issuedMs) {
    const dk = clock.dateKey(issuedMs);
    if (serviceId === 'SV-01') return clock.addDays(dk, 89);
    const [y, m, d] = dk.split('-').map(Number);
    const anniversary = (m === 2 && d === 29) ? `${y + 1}-02-28` : `${y + 1}-${p2(m)}-${p2(d)}`;
    return clock.addDays(anniversary, -1);
  }

  function newVerifyCode() {
    for (let i = 0; i < 20; i++) {
      const c = crypto.randomCode(8);
      if (!db.get('SELECT 1 AS x FROM documents WHERE verify_code = ?', c)) return c;
    }
    throw new Error('cannot allocate verify code');
  }

  /** VALID | EXPIRED | TAMPERED (A-43: ลายเซ็นไม่ตรงชนะหมดอายุ) */
  function evaluate(d) {
    if (!crypto.verifySignature(crypto.docSignFields(d), d.signature)) return 'TAMPERED';
    if (clock.nowDateKey() > d.valid_until) return 'EXPIRED';
    return 'VALID';
  }

  // ---------- ออกเอกสาร ----------
  app.post('/api/officer/cases/:caseNo/issue', requireRole('officer'), (req, res) => {
    // ตรวจและเขียนจบแบบ synchronous (ไม่มี await) → ออกซ้ำไม่ได้
    const row = cases.getByCaseNo(req.params.caseNo);
    if (!row) return errors.sendError(res, 'NOT_FOUND');
    if (!row.reg_officer || row.reg_officer !== req.user.username) return errors.sendError(res, 'FORBIDDEN');
    if (row.status !== 'APPROVED' || row.doc_no) return errors.sendError(res, 'INVALID_STATE');

    const nowMs = clock.now();
    const nowIso = clock.toIso(nowMs);
    const signerUser = row.approved_by ? ctx.people.displayName(row.approved_by) : req.user.name;
    let result;
    db.tx(() => {
      const d = {
        doc_no: cases.ids.docNo(nowMs),
        case_no: row.case_no,
        applicant: row.applicant_name,
        service_id: row.service_id,
        issued_at: nowIso,
        valid_until: validUntilOf(row.service_id, nowMs),
        signer: signerUser || req.user.name,
      };
      const signature = crypto.sign(crypto.docSignFields(d));
      const verifyCode = newVerifyCode();
      db.run(`INSERT INTO documents(doc_no, case_id, case_no, verify_code, applicant, service_id, issued_at, valid_until, signer, signature, issued_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.doc_no, row.id, row.case_no, verifyCode, d.applicant, d.service_id, d.issued_at, d.valid_until, d.signer, signature, req.user.username);
      db.run(`UPDATE cases SET status = 'COMPLETED', closed_at = ?, dept = NULL, owner = NULL, doc_no = ?, updated_at = ? WHERE id = ?`,
        nowIso, d.doc_no, nowIso, row.id);
      cases.addEvent(row.id, {
        type: 'ISSUE', actor: req.user.username, actorRole: req.user.role,
        fromStatus: 'APPROVED', toStatus: 'COMPLETED', note: d.doc_no, time: nowIso,
      });
      audit.log({ user: req.user, event: 'ISSUE', caseNo: row.case_no, fromStatus: 'APPROVED', toStatus: 'COMPLETED', detail: d.doc_no });
      result = { docNo: d.doc_no, verifyCode, status: 'COMPLETED' };
    });
    return res.json(result);
  });

  // ---------- แสดงเลขบัตรเต็ม (PDPA · BR-24) ----------
  app.post('/api/officer/cases/:caseNo/unmask', requireRole('officer', 'head'), (req, res) => {
    const row = cases.getByCaseNo(req.params.caseNo);
    if (!row) return errors.sendError(res, 'NOT_FOUND');
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return errors.sendError(res, 'REASON_REQUIRED');
    const idNo = cases.applicantIdNo(row);
    // BUG B11: ไม่บันทึก Audit UNMASK
    if (!ctx.bugs.isOn('B11')) {
      audit.log({ user: req.user, event: 'UNMASK', caseNo: row.case_no, detail: reason });
    }
    return res.json({ idNo });
  });

  // ---------- PDF เอกสาร ----------
  app.get('/api/documents/:docNo/pdf', requireRole(), errors.wrap(async (req, res) => {
    const u = req.user;
    if (u.role !== 'citizen' && u.role !== 'officer' && u.role !== 'head') return errors.sendError(res, 'FORBIDDEN');
    const d = db.get('SELECT * FROM documents WHERE doc_no = ?', req.params.docNo);
    if (!d) return errors.sendError(res, 'NOT_FOUND');
    if (u.role === 'citizen') {
      const c = db.get('SELECT citizen_id FROM cases WHERE id = ?', d.case_id);
      if (!c || c.citizen_id !== u.citizenId) return errors.sendError(res, 'NOT_FOUND');
    }
    const buf = await buildDocumentPdf(d, ctx.baseUrl(req));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${d.doc_no}.pdf"`,
      'Content-Length': String(buf.length),
    });
    return res.end(buf);
  }));

  async function buildDocumentPdf(d, baseUrl) {
    const url = `${baseUrl}/verify/${d.verify_code}`;
    const qr = await QRCode.toBuffer(url, { margin: 1, width: 240 });
    const doc = pdf.newDoc({
      Title: d.doc_no,
      Author: 'e-Service',
      Subject: 'document',
      Keywords: `docNo=${d.doc_no} caseNo=${d.case_no} verify=${d.verify_code} validUntil=${d.valid_until}`,
    });
    const W = doc.page.width;
    doc.rect(30, 30, W - 60, doc.page.height - 60).lineWidth(1.5).stroke('#0b3d91');
    pdf.centered(doc, 'เทศบาลนครตัวอย่าง', 60, 22);
    pdf.centered(doc, `เอกสารดิจิทัล · ${catalog.SERVICE_NAMES[d.service_id] || d.service_id}`, 92, 18);
    doc.moveTo(60, 125).lineTo(W - 60, 125).lineWidth(0.8).stroke('#9ca3af');
    const rows = [
      ['เลขเอกสาร', d.doc_no],
      ['เลขคำขอ', d.case_no],
      ['ผู้ยื่นคำขอ', d.applicant],
      ['บริการ', catalog.serviceLabel(d.service_id)],
      ['วันที่ออก', format.thaiDateTime(d.issued_at)],
      ['ใช้ได้ถึง', format.thaiDate(d.valid_until)],
      ['ผู้ลงนาม', d.signer],
      ['รหัสตรวจสอบ', d.verify_code],
    ];
    let y = 150;
    for (const [k, v] of rows) {
      pdf.mixed(doc, k, 70, y, 15);
      pdf.mixed(doc, String(v), 200, y, 15);
      y += 30;
    }
    doc.image(qr, 70, y + 10, { width: 130 });
    pdf.mixed(doc, 'สแกนเพื่อตรวจสอบเอกสาร', 215, y + 40, 14);
    pdf.mixed(doc, url, 215, y + 66, 10);
    pdf.mixed(doc, `signature (HMAC-SHA256): ${d.signature.slice(0, 32)}...`, 70, y + 160, 9);
    pdf.mixed(doc, 'ลายเซ็นดิจิทัลเป็นตัวจำลองเพื่อการทดสอบ', 70, y + 176, 11);
    return pdf.toBuffer(doc);
  }

  // ---------- ตรวจเอกสาร (สาธารณะ) ----------
  const RESULT_TH = { VALID: 'เอกสารถูกต้อง', EXPIRED: 'เอกสารหมดอายุ', TAMPERED: 'ลายเซ็นไม่ถูกต้อง', NOT_FOUND: 'ไม่พบเอกสาร' };
  const findByCode = (code) => db.get('SELECT * FROM documents WHERE verify_code = ?', String(code));

  app.get('/api/verify/:code', (req, res) => {
    const d = findByCode(req.params.code);
    if (!d) return res.status(404).json({ result: 'NOT_FOUND' });
    const result = evaluate(d);
    if (result === 'TAMPERED') return res.json({ result });
    return res.json({
      result, docNo: d.doc_no, applicantMasked: maskName(d.applicant), serviceId: d.service_id,
      issuedAt: d.issued_at, validUntil: d.valid_until, signer: d.signer,
    });
  });

  // แบบฟอร์มกรอกรหัส (ไม่ต้องล็อกอิน)
  app.get('/verify', (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    if (code) return res.redirect(302, `/verify/${encodeURIComponent(code)}`);
    layout.send(res, {
      req, title: 'ตรวจสอบเอกสาร',
      body: html`<form method="get" action="/verify" class="card">
        <div class="form-row"><label for="verify-code-input">รหัสตรวจสอบ 8 ตัว</label>
        <input id="verify-code-input" name="code" type="text" autocomplete="off" inputmode="text"></div>
        <button type="submit" class="btn">ตรวจสอบ</button></form>`,
    });
  });

  app.get('/verify/:code', (req, res) => {
    const d = findByCode(req.params.code);
    const result = d ? evaluate(d) : 'NOT_FOUND';
    let detail = '';
    if (result === 'VALID' || result === 'EXPIRED') {
      detail = html`<dl class="kv">
        <dt>เลขเอกสาร</dt><dd data-testid="verify-doc-no">${d.doc_no}</dd>
        <dt>ผู้ยื่นคำขอ</dt><dd data-testid="verify-applicant">${maskName(d.applicant)}</dd>
        <dt>บริการ</dt><dd data-testid="verify-service">${catalog.serviceLabel(d.service_id)}</dd>
        <dt>วันที่ออก</dt><dd>${timeEl(d.issued_at, { testid: 'verify-issued' })}</dd>
        <dt>ผู้ลงนาม</dt><dd data-testid="verify-signer">${d.signer}</dd>
        <dt>ใช้ได้ถึง</dt><dd>${dateEl(d.valid_until, { testid: 'verify-expires' })}</dd>
      </dl>`;
    }
    const cls = result === 'VALID' ? 'notice' : 'notice notice-warn';
    layout.send(res, {
      req, title: 'ตรวจสอบเอกสาร',
      body: html`<div class="card">
        <p class="${cls}" role="status"><strong data-testid="verify-result" data-result="${result}">${RESULT_TH[result]}</strong></p>
        ${detail}
        <p class="muted"><a href="/verify">ตรวจสอบรหัสอื่น</a></p>
      </div>`,
    }, result === 'NOT_FOUND' ? 404 : 200);
  });

  // ---------- test hook: tamper (เฉพาะ TEST_MODE · ลงทะเบียนผ่าน core) ----------
  ctx.hooks.testTamper((req, res) => {
    const d = db.get('SELECT * FROM documents WHERE doc_no = ?', req.params.docNo);
    if (!d) return errors.sendError(res, 'NOT_FOUND');
    // แก้ข้อมูลที่เก็บโดยไม่คำนวณลายเซ็นใหม่
    db.run('UPDATE documents SET applicant = ? WHERE doc_no = ?', `${d.applicant} (แก้ไข)`, d.doc_no);
    return res.json({ ok: true });
  });

};
