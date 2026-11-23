'use strict';
// HTML ของหน้า workflow: /officer/queue · /officer/cases/:caseNo · /head/approvals · /notifications
// ใช้ ctx.format (html`` escape อัตโนมัติ) · data-testid ตาม CONTRACT §2.6–2.8 §2.12

module.exports = function createViews(ctx, logic) {
  const { format, catalog, cases, clock, sla } = ctx;
  const { html, raw, esc, money, timeEl, statusBadge, levelBadge } = format;

  const CSS = `
.queue-bar { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: end; margin: 0 0 12px; }
.queue-bar .form-row { margin: 0; }
.queue-bar .workload { font-size: 1.1rem; }
.queue-bar .workload strong { font-size: 1.4rem; }
.act-card h2, .card h2 { margin-top: 0; font-size: 1.15rem; }
.act-card .sub { border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 12px; }
.act-card textarea { width: 100%; }
.noti-list { list-style: none; margin: 0; padding: 0; }
.noti-list li { background: #ffffff; border: 1px solid #d1d5db; border-left: 5px solid #b45309; border-radius: 6px; padding: 10px 12px; margin: 0 0 8px; }
.noti-list li[data-level="overdue"] { border-left-color: #b91c1c; }
@media (max-width: 640px) {
  table.stack-sm thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.stack-sm, table.stack-sm tbody, table.stack-sm tr, table.stack-sm td { display: block; width: 100%; }
  table.stack-sm tr { border-bottom: 2px solid #d1d5db; padding: 6px 0; }
  table.stack-sm td { border-bottom: 0; padding: 3px 10px; }
  table.stack-sm td:empty { display: none; }
  table.stack-sm td[data-label]::before { content: attr(data-label) ': '; font-weight: 600; color: #374151; }
}`;

  const serviceCell = (id) => catalog.serviceLabel(id);
  const ownerText = (row) => row.owner || '';
  const caseHref = (row) => `/officer/cases/${encodeURIComponent(row.case_no)}`;

  // ---------- /officer/queue ----------
  function queuePage(req, filter) {
    const user = req.user;
    const rows = logic.queueRows(user, 'all');
    const isOfficer = user.role === 'officer';
    const nowMs = clock.now();
    const options = [['all', 'ทั้งหมด'], ['unclaimed', 'ยังไม่มีผู้รับ'], ['mine', 'ของฉัน']];
    const body = html`
<div class="queue-bar">
  <div class="form-row">
    <label for="queue-filter">ตัวกรอง</label>
    <select id="queue-filter" data-testid="queue-filter">${options.map(([v, t]) => html`<option value="${v}"${v === filter ? raw(' selected') : ''}>${t}</option>`)}</select>
  </div>
  ${isOfficer ? html`<p class="workload">งานในมือของฉัน: <strong data-testid="workload-count">${logic.workloadOf(user.username)}</strong> เรื่อง (สูงสุด ${logic.MAX_WORKLOAD})</p>` : ''}
</div>
${!isOfficer ? html`<p class="muted">หัวหน้าฝ่ายดูคิวของทุกแผนกแบบอ่านอย่างเดียว</p>` : ''}
<div class="table-wrap" data-label="คิวงาน">
<table class="data stack-sm" data-testid="queue-table" data-me="${user.username || ''}" id="queue-table">
  <thead><tr><th scope="col">เลขคำขอ</th><th scope="col">บริการ</th><th scope="col">ผู้ยื่น</th><th scope="col">เลขบัตร</th><th scope="col">สถานะ</th><th scope="col">กำหนดเสร็จ</th><th scope="col">ระดับเตือน</th><th scope="col">ผู้ถือเรื่อง</th><th scope="col">ดำเนินการ</th></tr></thead>
  <tbody id="queue-body">${rows.map((r) => {
    const level = sla.levelOf(r, nowMs);
    const claimable = logic.canClaim(user, r);
    return html`<tr data-testid="queue-row" data-case-no="${r.case_no}" data-owner="${ownerText(r)}" data-status="${r.status}" data-sla-level="${level || ''}">
    <td data-label="เลขคำขอ" class="nowrap"><a data-testid="row-case-no" href="${caseHref(r)}">${r.case_no}</a></td>
    <td data-label="บริการ"><span data-testid="row-service">${serviceCell(r.service_id)}</span></td>
    <td data-label="ผู้ยื่น"><span data-testid="row-applicant">${r.applicant_name}</span></td>
    <td data-label="เลขบัตร" class="nowrap"><span data-testid="row-id-masked">${cases.applicantIdMasked(r)}</span></td>
    <td data-label="สถานะ">${statusBadge(r.status, 'row-status')}</td>
    <td data-label="กำหนดเสร็จ" class="nowrap">${timeEl(r.due_at, { testid: 'row-due' })}</td>
    <td data-label="ระดับเตือน">${levelBadge(level, 'row-sla-level')}</td>
    <td data-label="ผู้ถือเรื่อง"><span data-testid="row-owner">${ownerText(r)}</span></td>
    <td data-label="ดำเนินการ">${claimable ? html`<button type="button" class="btn btn-small" data-testid="claim-btn" data-case-no="${r.case_no}">รับเรื่อง</button>` : ''}</td>
  </tr>`;
  })}</tbody>
</table>
</div>
${rows.length === 0 ? html`<p data-testid="queue-empty" id="queue-empty">ไม่มีงานในคิว</p>` : ''}`;
    return ctx.layout.page({ req, title: 'คิวงาน', body, head: `<style>${CSS}</style>`, wide: true, scripts: ['/static/workflow/officer.js'] });
  }

  // ---------- /head/approvals ----------
  function approvalsPage(req) {
    const rows = logic.approvalRows();
    const body = html`
${rows.length ? html`<div class="table-wrap" data-label="รายการรออนุมัติ"><table class="data stack-sm">
  <thead><tr><th scope="col">เลขคำขอ</th><th scope="col">บริการ</th><th scope="col">ผู้ยื่น</th><th scope="col">กำหนดเสร็จ</th><th scope="col">เปิดดู</th></tr></thead>
  <tbody>${rows.map((r) => html`<tr data-testid="approval-row" data-case-no="${r.case_no}">
    <td data-label="เลขคำขอ" class="nowrap"><span data-testid="row-case-no">${r.case_no}</span></td>
    <td data-label="บริการ"><span data-testid="row-service">${serviceCell(r.service_id)}</span></td>
    <td data-label="ผู้ยื่น"><span data-testid="row-applicant">${r.applicant_name}</span></td>
    <td data-label="กำหนดเสร็จ" class="nowrap">${timeEl(r.due_at, { testid: 'row-due' })}</td>
    <td data-label="เปิดดู"><a class="btn btn-small" data-testid="approval-open" href="${caseHref(r)}">เปิดคำขอ<span class="sr-only"> ${r.case_no}</span></a></td>
  </tr>`)}</tbody></table></div>` : html`<p data-testid="approvals-empty">ไม่มีรายการรออนุมัติ</p>`}`;
    return ctx.layout.page({ req, title: 'รออนุมัติ', body, head: `<style>${CSS}</style>`, wide: true });
  }

  // ---------- /notifications ----------
  function notificationsPage(req) {
    const items = logic.notificationsOf(req.user.username);
    const body = items.length
      ? html`<ul class="noti-list">${items.map((n) => html`<li data-testid="noti-item" data-case-no="${n.case_no}" data-level="${n.level}" data-iso="${n.created_at}"><a href="/officer/cases/${encodeURIComponent(n.case_no)}">${n.text}</a></li>`)}</ul>`
      : html`<p data-testid="noti-empty">ไม่มีแจ้งเตือน</p>`;
    return ctx.layout.page({ req, title: 'แจ้งเตือน', body, head: `<style>${CSS}</style>` });
  }

  // ---------- /officer/cases/:caseNo ----------
  /** doc-qr: ภาพ QR (data URL) ส่งเข้ามาจากภายนอก เพราะสร้างแบบ async */
  function casePage(req, row, qr) {
    const user = req.user;
    const level = sla.levelOf(row);
    const stage = catalog.stepLabel(row.service_id, row.step);
    const holder = logic.isHolder(user, row);
    const isOfficer = user.role === 'officer';
    const sv = row.service_id;
    const canClaim = logic.canClaim(user, row);
    const inReview = row.status === 'IN_REVIEW';
    const canReturn = holder && inReview && ((row.return_count || 0) < logic.MAX_RETURNS || ctx.bugs.isOn('B12'));
    const canForward = holder && inReview && !!logic.nextStage(row);
    // อำนาจอนุมัติ/ไม่อนุมัติ: SV-01 = ผู้ถือ (IN_REVIEW) · SV-02/03 = head ที่ PENDING_APPROVAL เท่านั้น
    const canDecide = sv === 'SV-01' ? holder && inReview : user.role === 'head' && row.status === 'PENDING_APPROVAL';
    const canIssue = row.status === 'APPROVED' && isOfficer && user.username === row.reg_officer;
    const closed = row.status === 'COMPLETED' || row.status === 'REJECTED';
    const ownerLabel = row.owner || (['SUBMITTED', 'IN_REVIEW', 'NEED_FIX'].includes(row.status) ? 'ยังไม่มีผู้รับ' : '–');
    const fileOk = cases.fileAccess(user, row) === 'ok';
    const docHtml = row.doc_no ? html`
      <dt>เลขเอกสาร</dt><dd data-testid="doc-no">${row.doc_no}</dd>
      <dt>รหัสตรวจสอบ</dt><dd data-testid="verify-code">${cases.verifyCodeOf(row) || ''}</dd>
      <dt>QR เอกสาร</dt><dd>${qr ? html`<img data-testid="doc-qr" data-url="${qr.url}" src="${qr.dataUrl}" alt="QR ตรวจสอบเอกสาร ${row.doc_no}" width="140" height="140">` : ''}</dd>` : '';

    const body = html`
<div class="card">
  <dl class="kv">
    <dt>เลขคำขอ</dt><dd data-testid="case-no">${row.case_no}</dd>
    <dt>บริการ</dt><dd data-testid="case-service">${serviceCell(sv)}</dd>
    <dt>สถานะ</dt><dd>${statusBadge(row.status)}</dd>
    ${stage ? html`<dt>ขั้นตอน</dt><dd data-testid="case-step">${stage}</dd>` : ''}
    <dt>ค่าธรรมเนียม</dt><dd data-testid="case-fee">${money(row.fee)}</dd>
    <dt>ผู้ยื่น</dt><dd data-testid="applicant-name">${row.applicant_name}</dd>
    <dt>เลขบัตร</dt><dd><span data-testid="applicant-id">${cases.applicantIdMasked(row)}</span>
      <span id="full-id-slot"></span>
      <button type="button" class="btn btn-secondary btn-small" id="show-full-id" data-testid="show-full-id-btn" aria-expanded="false" aria-controls="unmask-box">แสดงเลขเต็ม</button></dd>
    <dt>กำหนดเสร็จ</dt><dd>${timeEl(row.due_at, { testid: 'sla-due' })} ${levelBadge(level)}</dd>
    <dt>ผู้ถือเรื่อง</dt><dd data-testid="case-owner">${ownerLabel}</dd>
    <dt>ตีกลับแล้ว (ครั้ง)</dt><dd data-testid="return-count">${row.return_count || 0}</dd>
    ${row.status === 'NEED_FIX' ? html`<dt>เหตุผลที่ตีกลับ</dt><dd>${row.return_reason || ''}</dd><dt>เส้นตายแก้ไข</dt><dd>${timeEl(row.fix_deadline)}</dd>` : ''}
    ${closed ? html`<dt>ปิดงานเมื่อ</dt><dd>${timeEl(row.closed_at, { testid: 'closed-at' })}</dd>` : ''}
    ${docHtml}
  </dl>
  <div id="unmask-box" class="sub" hidden>
    <div class="form-row">
      <label for="unmask-reason">เหตุผลที่ขอดูเลขบัตรเต็ม (บันทึกใน Audit)</label>
      <input type="text" id="unmask-reason" data-testid="unmask-reason" autocomplete="off">
      <p class="field-error" data-testid="unmask-error" id="unmask-error" hidden></p>
    </div>
    <button type="button" class="btn btn-small" id="unmask-submit" data-testid="unmask-submit">ยืนยัน</button>
  </div>
</div>

${(canClaim || canReturn || canForward || canDecide || canIssue) ? html`
<div class="card act-card" id="actions" data-case-no="${row.case_no}">
  <h2>ดำเนินการ</h2>
  <div class="actions">
    ${canClaim ? html`<button type="button" class="btn" data-testid="claim-btn" id="act-claim">รับเรื่อง</button>` : ''}
    ${canForward ? html`<button type="button" class="btn" data-testid="forward-btn" id="act-forward">ผ่าน/ส่งต่อ</button>` : ''}
    ${canDecide ? html`<button type="button" class="btn" data-testid="approve-btn" id="act-approve">อนุมัติ</button>` : ''}
    ${canIssue ? html`<button type="button" class="btn" data-testid="issue-btn" id="act-issue">ออกเอกสาร</button>` : ''}
  </div>
  ${canForward ? html`<div class="form-row"><label for="forward-note">หมายเหตุส่งต่อ (ไม่บังคับ)</label><textarea id="forward-note" data-testid="forward-note" rows="2"></textarea></div>` : ''}
  ${canReturn ? html`<div class="sub">
    <div class="form-row"><label for="return-reason">เหตุผลที่ตีกลับ (อย่างน้อย 10 ตัวอักษร)</label>
      <textarea id="return-reason" data-testid="return-reason" rows="2" aria-describedby="return-reason-error"></textarea>
      <p class="field-error" data-testid="return-reason-error" id="return-reason-error" hidden></p></div>
    <div class="actions"><button type="button" class="btn btn-secondary" data-testid="return-btn" id="act-return">ตีกลับ</button>
    <button type="button" class="btn btn-secondary" data-testid="return-submit" id="act-return-submit">ยืนยันตีกลับ</button></div>
  </div>` : ''}
  ${canDecide ? html`<div class="sub">
    <div class="form-row"><label for="reject-reason">เหตุผลที่ไม่อนุมัติ (อย่างน้อย 10 ตัวอักษร)</label>
      <textarea id="reject-reason" data-testid="reject-reason" rows="2" aria-describedby="reject-reason-error"></textarea>
      <p class="field-error" data-testid="reject-reason-error" id="reject-reason-error" hidden></p></div>
    <div class="actions"><button type="button" class="btn btn-danger" data-testid="reject-btn" id="act-reject">ไม่อนุมัติ</button>
    <button type="button" class="btn btn-danger" data-testid="reject-submit" id="act-reject-submit">ยืนยันไม่อนุมัติ</button></div>
  </div>` : ''}
</div>` : ''}

<div class="card">
  <h2>เอกสารแนบ</h2>
  ${fileOk ? cases.docItemsHtml(row.id) : html`<p class="muted">ไม่มีสิทธิ์ดูเอกสารแนบของคำขอนี้</p>`}
</div>
<div class="card">
  <h2>ไทม์ไลน์</h2>
  ${cases.timelineHtml(row.id)}
</div>`;
    return ctx.layout.page({
      req, title: `คำขอ ${row.case_no}`, body, head: `<style>${CSS}</style>`, scripts: ['/static/workflow/officer.js'],
    });
  }

  return { queuePage, approvalsPage, notificationsPage, casePage };
};
