'use strict';
// หน้าเว็บของประชาชน: /login /register /citizen /citizen/new/:service /citizen/cases/:caseNo  (CONTRACT §2.2–2.6)

const path = require('node:path');
const QRCode = require('qrcode');

module.exports = function registerPages(app, ctx, { draftJson, viewableCase }) {
  const { layout, session, cases, catalog, errors, db, clock, crypto } = ctx;
  const { html, raw, money, timeEl, statusBadge, levelBadge } = ctx.format;
  const citizenOnly = session.requireRole('citizen');

  app.use('/static/citizen', ctx.express.static(path.join(__dirname, 'static'), { maxAge: 0 }));

  const TAB_CSS = `<style>
    .tabs{display:flex;gap:8px;margin:0 0 16px;flex-wrap:wrap}
    .tabs [role=tab]{background:#fff;color:#0b4fb3;border:2px solid #0b4fb3;border-radius:6px}
    .tabs [role=tab][aria-selected=true]{background:#0b4fb3;color:#fff;text-decoration:underline;text-underline-offset:4px}
    .check{display:flex;gap:8px;align-items:flex-start}
    .check input{margin-top:6px;width:auto}
    .doc-row{margin:0 0 14px}
    .file-list{list-style:none;margin:0 0 12px;padding:0}
    .file-list li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 6px}
    .confirm-box{border:2px solid #b91c1c;border-radius:8px;padding:12px;margin:12px 0}
  </style>`;

  // ---------- /login ----------
  app.get('/login', (req, res) => {
    layout.send(res, {
      req, title: 'เข้าสู่ระบบ', head: TAB_CSS, scripts: ['/static/citizen/login.js'],
      body: html`<div class="card">
        <div role="tablist" aria-label="ประเภทผู้ใช้" class="tabs">
          <button type="button" role="tab" id="tab-citizen" aria-selected="true" aria-controls="panel-citizen" data-testid="login-tab-citizen">ประชาชน</button>
          <button type="button" role="tab" id="tab-staff" aria-selected="false" tabindex="-1" aria-controls="panel-staff" data-testid="login-tab-staff">เจ้าหน้าที่</button>
        </div>
        <section role="tabpanel" id="panel-citizen" aria-labelledby="tab-citizen">
          <form id="thaid-form" novalidate>
            <div class="form-row">
              <label for="thaid-id-input">เลขบัตรประชาชน 13 หลัก</label>
              <input id="thaid-id-input" data-testid="thaid-id-input" type="text" inputmode="numeric" autocomplete="off">
            </div>
            <div id="thaid-msg" aria-live="polite"></div>
            <button type="submit" class="btn" data-testid="thaid-submit">เข้าสู่ระบบด้วย ThaiD (จำลอง)</button>
          </form>
          <div id="otp-host" aria-live="polite"></div>
          <template id="otp-template">
            <div data-testid="otp-step" class="card">
              <form id="otp-form" novalidate>
                <p class="muted">ระบบจำลองส่งรหัส OTP แล้ว (รหัสทดสอบคือ 123456)</p>
                <div class="form-row">
                  <label for="otp-input">รหัส OTP</label>
                  <input id="otp-input" data-testid="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code">
                </div>
                <div id="otp-msg" aria-live="polite"></div>
                <button type="submit" class="btn" data-testid="otp-submit">ยืนยัน OTP</button>
              </form>
            </div>
          </template>
        </section>
        <section role="tabpanel" id="panel-staff" aria-labelledby="tab-staff" hidden>
          <form id="staff-form" novalidate>
            <div class="form-row"><label for="staff-username">ชื่อผู้ใช้</label>
              <input id="staff-username" data-testid="staff-username" type="text" autocomplete="username"></div>
            <div class="form-row"><label for="staff-password">รหัสผ่าน</label>
              <input id="staff-password" data-testid="staff-password" type="password" autocomplete="current-password"></div>
            <div id="staff-msg" aria-live="polite"></div>
            <button type="submit" class="btn" data-testid="staff-submit">เข้าสู่ระบบเจ้าหน้าที่ (SSO ภาครัฐ จำลอง)</button>
          </form>
        </section>
      </div>`,
    });
  });

  // ---------- /register ----------
  app.get('/register', (req, res) => {
    if (req.user) return res.redirect(302, session.landingFor(req.user));
    if (!req.pending) return res.redirect(302, '/login');
    const msgs = JSON.stringify({ INVALID_MOBILE: errors.message('INVALID_MOBILE'), CONSENT_REQUIRED: errors.message('CONSENT_REQUIRED') });
    layout.send(res, {
      req, title: 'ลงทะเบียนใช้งานครั้งแรก', head: TAB_CSS, scripts: ['/static/citizen/register.js'],
      body: html`<div class="card"><form id="reg-form" novalidate data-msgs="${msgs}">
        <div class="form-row"><label for="reg-name">ชื่อ-สกุล (จาก ThaiD แก้ไขไม่ได้)</label>
          <input id="reg-name" data-testid="reg-name" type="text" readonly value="${req.pending.name}"></div>
        <div class="form-row"><label for="reg-mobile">เบอร์มือถือ (10 หลัก ขึ้นต้นด้วย 0)</label>
          <input id="reg-mobile" data-testid="reg-mobile" type="text" inputmode="numeric" autocomplete="tel"></div>
        <div id="reg-mobile-msg" aria-live="polite"></div>
        <div class="form-row"><label for="reg-email">อีเมล (ไม่บังคับ)</label>
          <input id="reg-email" data-testid="reg-email" type="text" inputmode="email" autocomplete="email"></div>
        <div class="form-row check"><input id="reg-consent" data-testid="reg-consent" type="checkbox">
          <label for="reg-consent">ข้าพเจ้ายินยอมให้ประมวลผลข้อมูลส่วนบุคคลตาม PDPA เพื่อใช้บริการ e-Service</label></div>
        <div id="reg-consent-msg" aria-live="polite"></div>
        <button type="submit" class="btn" data-testid="reg-submit">ลงทะเบียน</button>
      </form></div>`,
    });
  });

  // ---------- /citizen ----------
  app.get('/citizen', citizenOnly, (req, res) => {
    const rows = db.all('SELECT * FROM cases WHERE citizen_id = ? AND case_no IS NOT NULL ORDER BY case_no DESC', req.user.citizenId);
    const drafts = db.all(`SELECT * FROM cases WHERE citizen_id = ? AND draft_id IS NOT NULL AND status IN ('DRAFT','PENDING_PAYMENT') ORDER BY draft_id`, req.user.citizenId);
    layout.send(res, {
      req, title: 'คำขอของฉัน', wide: true,
      body: html`<p data-testid="citizen-welcome">สวัสดี ${req.user.name}</p>
      <section class="card" aria-labelledby="h-start"><h2 id="h-start">เริ่มบริการ</h2>
        <div class="actions">${catalog.SERVICE_IDS.map((sv) => html`<a class="btn" data-testid="start-service-${sv}" href="/citizen/new/${sv}">${sv} ${catalog.SERVICE_NAMES[sv]}</a>`)}</div>
      </section>
      <section aria-labelledby="h-drafts"><h2 id="h-drafts">ร่างและรอชำระเงิน</h2>
        <div class="table-wrap" data-label="ร่างและรอชำระเงิน"><table class="data">
          <thead><tr><th scope="col">รหัสร่าง</th><th scope="col">บริการ</th><th scope="col">สถานะ</th><th scope="col">การดำเนินการ</th></tr></thead>
          <tbody>${drafts.length ? drafts.map((d) => html`<tr data-testid="my-draft-row" data-draft-id="${d.draft_id}" data-status="${d.status}">
            <td data-testid="row-draft-id">${d.draft_id}</td><td data-testid="row-service">${catalog.serviceLabel(d.service_id)}</td>
            <td>${statusBadge(d.status, 'row-status')}</td>
            <td><a class="btn btn-small" data-testid="open-draft-btn" href="/citizen/new/${d.service_id}?draft=${d.draft_id}" aria-label="เปิดร่าง ${d.draft_id}">เปิดร่าง</a></td></tr>`)
    : html`<tr><td colspan="4" class="muted">ไม่มีร่าง</td></tr>`}</tbody></table></div>
      </section>
      <section aria-labelledby="h-cases"><h2 id="h-cases">คำขอที่ยื่นแล้ว</h2>
        <div class="table-wrap" data-label="คำขอที่ยื่นแล้ว"><table class="data">
          <thead><tr><th scope="col">เลขคำขอ</th><th scope="col">บริการ</th><th scope="col">สถานะ</th><th scope="col">กำหนดเสร็จ</th></tr></thead>
          <tbody>${rows.length ? rows.map((r) => html`<tr data-testid="my-case-row" data-case-no="${r.case_no}" data-status="${r.status}">
            <td><a data-testid="row-case-no" href="/citizen/cases/${r.case_no}">${r.case_no}</a></td>
            <td data-testid="row-service">${catalog.serviceLabel(r.service_id)}</td>
            <td>${statusBadge(r.status, 'row-status')}</td>
            <td>${timeEl(r.due_at, { testid: 'row-due' })}</td></tr>`)
    : html`<tr><td colspan="4" class="muted">ยังไม่มีคำขอ</td></tr>`}</tbody></table></div>
      </section>`,
    });
  });

  // ---------- /citizen/new/:service ----------
  app.get('/citizen/new/:service', citizenOnly, errors.wrap(async (req, res) => {
    const sv = String(req.params.service);
    if (!catalog.SERVICE_IDS.includes(sv)) return layout.sendNotFound(req, res);
    let draft = null;
    if (req.query.draft) {
      const row = cases.getByDraftId(String(req.query.draft));
      if (!row || row.citizen_id !== req.user.citizenId || row.service_id !== sv) return layout.sendCaseNotFound(req, res);
      if (row.case_no) return res.redirect(302, `/citizen/cases/${row.case_no}`);
      draft = draftJson(row);
    }
    const svc = db.get('SELECT * FROM services WHERE id = ?', sv);
    const docs = [...catalog.DOCS[sv], catalog.EXTRA_DOC];
    let qrImage = null;
    if (draft && draft.payment && draft.payment.status === 'PENDING') {
      qrImage = await QRCode.toDataURL(`EGOV-PROMPTPAY-MOCK|${draft.payment.ref}|${draft.payment.amount}`, { margin: 1, width: 220 });
    }
    const feeNow = sv === 'SV-02' ? svc.fee : (sv === 'SV-01' ? svc.fee * ((draft && draft.qty) || 1) : (draft && draft.fee));
    const state = {
      service: sv, draft, qrImage,
      labels: catalog.DOC_LABELS,
      msgs: { INVALID_QTY: errors.message('INVALID_QTY'), INVALID_AREA: errors.message('INVALID_AREA'), AREA_TOO_LARGE: errors.message('AREA_TOO_LARGE') },
    };
    const step1Ok = sv !== 'SV-03' || (draft && draft.areaSqm);
    const docRow = (d) => {
      const tidKey = `upload-input-${d.key}`;
      const label = `${d.label}${d.required ? ' ✱' : ' (ไม่บังคับ)'}${d.pdfOnly ? ' (PDF เท่านั้น)' : ''}${d.multiple ? ' (เลือกได้หลายไฟล์)' : ''}`;
      return html`<div class="doc-row"><label for="${tidKey}">${label}</label><br>
        <input type="file" id="${tidKey}" data-testid="${tidKey}" data-doc-key="${d.key}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"${d.multiple ? raw(' multiple') : ''}></div>`;
    };
    layout.send(res, {
      req, title: `ยื่นคำขอ ${catalog.SERVICE_NAMES[sv]}`, head: TAB_CSS, scripts: ['/static/citizen/wizard.js'],
      body: html`<div id="wizard" data-state="${JSON.stringify(state)}">
        <p>บริการ: <strong data-testid="service-name">${catalog.SERVICE_NAMES[sv]}</strong></p>
        <p class="notice" data-testid="wizard-step" aria-live="polite">1/3 กรอกข้อมูล</p>
        <p id="draft-line" hidden>รหัสร่าง: <strong data-testid="draft-id"></strong></p>

        <section id="step-1" class="card" aria-labelledby="h-step1"><h2 id="h-step1">ขั้นที่ 1 กรอกข้อมูล</h2>
          ${sv === 'SV-01' ? html`<div class="form-row"><label for="qty-input">จำนวนฉบับ (1–5 ฉบับ)</label>
            <input id="qty-input" data-testid="qty-input" type="text" inputmode="numeric" autocomplete="off" value="${(draft && draft.qty) || 1}"></div>` : ''}
          ${sv === 'SV-03' ? html`<div class="form-row"><label for="area-input">พื้นที่ก่อสร้าง (ตร.ม. 1–500)</label>
            <input id="area-input" data-testid="area-input" type="text" inputmode="numeric" autocomplete="off" value="${(draft && draft.areaSqm) || ''}"></div>` : ''}
          <p>ค่าธรรมเนียม: <strong data-testid="fee-total">${step1Ok ? money(feeNow) : '–'}</strong></p>
          <div id="fee-msg"></div>
          <div class="actions">
            <button type="button" class="btn" data-testid="to-upload-btn"${step1Ok ? '' : raw(' disabled')}>ไปขั้นแนบเอกสาร</button>
            <button type="button" class="btn btn-secondary" data-testid="save-draft-btn">บันทึกร่าง</button>
          </div>
        </section>

        <section id="step-2" class="card" aria-labelledby="h-step2" hidden><h2 id="h-step2">ขั้นที่ 2 แนบเอกสาร</h2>
          <p class="muted">รองรับไฟล์ PDF, JPG, PNG ขนาดไม่เกิน 5 MB ต่อไฟล์ รวมไม่เกิน 5 ไฟล์</p>
          ${docs.map(docRow)}
          <div id="upload-msg" aria-live="polite"></div>
          <h3>ไฟล์ที่แนบแล้ว</h3>
          <ul id="file-list" class="file-list"></ul>
          <div id="missing-msg"></div>
          <div class="actions"><button type="button" class="btn" data-testid="to-payment-btn" disabled>ไปชำระเงิน</button></div>
        </section>

        <section id="step-3" class="card" aria-labelledby="h-step3" hidden><h2 id="h-step3">ขั้นที่ 3 ชำระเงิน</h2>
          <p>ยอดที่ต้องชำระ: <strong data-testid="payment-amount">${money(feeNow)}</strong></p>
          <div id="pay-box"></div>
        </section>
      </div>`,
    });
  }));

  // ---------- /citizen/cases/:caseNo ----------
  app.get('/citizen/cases/:caseNo', citizenOnly, errors.wrap(async (req, res) => {
    const row = viewableCase(req, req.params.caseNo);
    if (!row) return layout.sendCaseNotFound(req, res);
    const isOwner = row.citizen_id === req.user.citizenId;
    const level = cases.levelOf(row);
    const stepLabel = catalog.stepLabel(row.service_id, row.step);
    const nowMs = clock.now();
    const canFix = row.status === 'NEED_FIX' && row.fix_deadline && nowMs < clock.parseIso(row.fix_deadline);
    let docBlock = '';
    if (row.doc_no) {
      const code = cases.verifyCodeOf(row);
      const url = `${ctx.baseUrl(req)}/verify/${code}`;
      const img = await QRCode.toDataURL(url, { margin: 1, width: 160 });
      docBlock = html`<section class="card" aria-labelledby="h-doc"><h2 id="h-doc">เอกสารดิจิทัล</h2><dl class="kv">
        <dt>เลขเอกสาร</dt><dd data-testid="doc-no">${row.doc_no}</dd>
        <dt>รหัสตรวจสอบ</dt><dd data-testid="verify-code">${code}</dd></dl>
        <p><img data-testid="doc-qr" data-url="${url}" src="${img}" alt="QR สำหรับตรวจสอบเอกสาร ${row.doc_no}" width="160" height="160"></p>
        <p><a class="btn" data-testid="download-doc-btn" href="/api/documents/${encodeURIComponent(row.doc_no)}/pdf">ดาวน์โหลดเอกสาร</a></p></section>`;
    }
    const canCancel = isOwner && row.status === 'SUBMITTED' && !row.owner;
    layout.send(res, {
      req, title: 'รายละเอียดคำขอ', scripts: ['/static/citizen/case.js'], head: TAB_CSS,
      body: html`<div id="case-page" data-case-no="${row.case_no}">
        <section class="card" aria-labelledby="h-info"><h2 id="h-info">ข้อมูลคำขอ</h2><dl class="kv">
          <dt>เลขคำขอ</dt><dd data-testid="case-no">${row.case_no}</dd>
          <dt>บริการ</dt><dd data-testid="case-service">${catalog.serviceLabel(row.service_id)}</dd>
          <dt>สถานะ</dt><dd>${statusBadge(row.status)}</dd>
          ${stepLabel ? html`<dt>ขั้นตอน</dt><dd data-testid="case-step">${stepLabel}</dd>` : ''}
          <dt>ค่าธรรมเนียม</dt><dd data-testid="case-fee">${money(row.fee)}</dd>
          ${isOwner ? html`<dt>เลขบัตรประชาชน</dt><dd data-testid="case-id-full">${crypto.formatThaiId(cases.applicantIdNo(row))}</dd>` : ''}
          <dt>กำหนดเสร็จ</dt><dd>${timeEl(row.due_at, { testid: 'sla-due' })}</dd>
          <dt>ระดับเตือน</dt><dd>${levelBadge(level)}</dd>
          ${row.closed_at ? html`<dt>ปิดงานเมื่อ</dt><dd>${timeEl(row.closed_at, { testid: 'closed-at' })}</dd>` : ''}
        </dl></section>
        ${row.status === 'REJECTED' || row.status === 'CANCELLED' ? html`<p class="notice" data-testid="no-refund-note">ค่าธรรมเนียมที่ชำระแล้วไม่คืน</p>` : ''}
        ${row.status === 'NEED_FIX' ? html`<section class="card" aria-labelledby="h-fix"><h2 id="h-fix">ต้องแก้ไขเอกสาร</h2>
          <p>เหตุผลที่ถูกตีกลับ: <strong data-testid="return-reason-display">${row.return_reason}</strong></p>
          <p>แก้ไขให้เสร็จภายใน: ${timeEl(row.fix_deadline, { testid: 'fix-deadline' })}</p>
          ${canFix ? html`<div class="form-row"><label for="fix-upload-input">แนบไฟล์ใหม่ (ไม่บังคับ)</label>
            <input type="file" id="fix-upload-input" data-testid="fix-upload-input" accept=".pdf,.jpg,.jpeg,.png"></div>
            <div class="actions"><button type="button" class="btn" data-testid="submit-fix-btn">ส่งแก้ไข</button></div>` : ''}
        </section>` : ''}
        ${canCancel ? html`<div class="actions"><button type="button" class="btn btn-danger" data-testid="cancel-case-btn" aria-expanded="false" aria-controls="cancel-confirm">ยกเลิกคำขอ</button></div>
          <div id="cancel-confirm" class="confirm-box" role="group" aria-label="ยืนยันการยกเลิกคำขอ" hidden>
            <p data-testid="cancel-confirm-text">ค่าธรรมเนียมที่ชำระแล้วไม่คืน</p>
            <div class="actions"><button type="button" class="btn btn-danger" data-testid="confirm-cancel-btn">ยืนยันยกเลิกคำขอ</button>
            <button type="button" class="btn btn-secondary" id="cancel-abort">ไม่ยกเลิก</button></div></div>` : ''}
        ${docBlock}
        <section class="card" aria-labelledby="h-files"><h2 id="h-files">เอกสารแนบ</h2>${cases.docItemsHtml(row.id)}</section>
        <section class="card" aria-labelledby="h-tl"><h2 id="h-tl">ไทม์ไลน์</h2>${cases.timelineHtml(row.id, { showActor: false })}</section>
      </div>`,
    });
  }));
};
