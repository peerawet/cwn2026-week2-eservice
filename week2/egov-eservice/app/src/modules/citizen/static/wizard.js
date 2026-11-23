/* หน้า /citizen/new/:service — ยื่นคำขอ 3 ขั้น (กรอกข้อมูล · แนบเอกสาร · ชำระเงิน) */
(function () {
  'use strict';
  var EG = window.EG;
  var root = document.getElementById('wizard');
  var S = JSON.parse(root.getAttribute('data-state'));
  var $ = function (id) { return document.getElementById(id); };
  var tid = function (t, scope) { return (scope || document).querySelector('[data-testid="' + t + '"]'); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var draft = S.draft; // { draftId, status, fee, files, missing, payment } | null
  var qrImage = S.qrImage || null;
  var pollTimer = null;
  var STEP_TEXT = { 1: '1/3 กรอกข้อมูล', 2: '2/3 แนบเอกสาร', 3: '3/3 ชำระเงิน' };

  function showStep(n) {
    [1, 2, 3].forEach(function (k) { $('step-' + k).hidden = k !== n; });
    tid('wizard-step').textContent = STEP_TEXT[n];
    if (n !== 3) stopPoll();
  }
  function setBusy(btn, on) { if (btn) btn.setAttribute('aria-busy', on ? 'true' : 'false'); }
  function showDraftId() {
    if (!draft) return;
    tid('draft-id').textContent = draft.draftId;
    $('draft-line').hidden = false;
  }
  function putMsg(hostId, testid, text, cls, role) {
    var host = $(hostId);
    clear(host);
    if (!text) return;
    var p = document.createElement('p');
    p.className = cls || 'field-error';
    if (role) p.setAttribute('role', role);
    p.setAttribute('data-testid', testid);
    p.textContent = text;
    host.appendChild(p);
  }

  // ---------- ขั้น 1: ข้อมูล + ค่าธรรมเนียม ----------
  var qtyEl = tid('qty-input');
  var areaEl = tid('area-input');
  var feeEl = tid('fee-total');
  var toUploadBtn = tid('to-upload-btn');
  var quoteSeq = 0;

  function readVals() {
    if (S.service === 'SV-01') return { qty: qtyEl.value.trim() };
    if (S.service === 'SV-03') return { areaSqm: areaEl.value.trim() };
    return {};
  }
  /** ตรวจเบื้องต้นฝั่งหน้าจอ (ค่าธรรมเนียมจริงมาจากเซิร์ฟเวอร์เสมอ) → { ok, code } */
  function localCheck() {
    var v = readVals();
    if (S.service === 'SV-01') {
      if (!/^-?\d+$/.test(v.qty)) return { ok: false, code: 'INVALID_QTY' };
      var q = parseInt(v.qty, 10);
      return q >= 1 && q <= 5 ? { ok: true } : { ok: false, code: 'INVALID_QTY' };
    }
    if (S.service === 'SV-03') {
      if (v.areaSqm === '') return { ok: false, code: null };
      if (!/^-?\d+$/.test(v.areaSqm)) return { ok: false, code: 'INVALID_AREA' };
      var a = parseInt(v.areaSqm, 10);
      if (a < 1) return { ok: false, code: 'INVALID_AREA' };
      if (a > 500) return { ok: false, code: 'AREA_TOO_LARGE' };
    }
    return { ok: true };
  }
  function updateFee() {
    var c = localCheck();
    var seq = ++quoteSeq;
    putMsg('fee-msg', 'fee-error', c.ok || !c.code ? '' : S.msgs[c.code], 'field-error', 'alert');
    toUploadBtn.disabled = !c.ok;
    if (!c.ok) { feeEl.textContent = '–'; return; }
    var v = readVals();
    var qs = 'serviceId=' + encodeURIComponent(S.service) + (v.qty !== undefined ? '&qty=' + encodeURIComponent(v.qty) : '') +
      (v.areaSqm !== undefined ? '&areaSqm=' + encodeURIComponent(v.areaSqm) : '');
    EG.api('GET', '/api/fee/quote?' + qs).then(function (r) {
      if (seq !== quoteSeq) return;
      if (r.ok) feeEl.textContent = EG.money(r.data.fee);
      else {
        feeEl.textContent = '–';
        toUploadBtn.disabled = true;
        putMsg('fee-msg', 'fee-error', (r.data && r.data.message) || 'เกิดข้อผิดพลาด', 'field-error', 'alert');
      }
    });
  }
  if (qtyEl) qtyEl.addEventListener('input', updateFee);
  if (areaEl) areaEl.addEventListener('input', updateFee);

  /** สร้างร่าง (ถ้ายังไม่มี) หรือบันทึกค่าล่าสุดลงร่างเดิม (เฉพาะ DRAFT) → Promise<boolean> */
  function ensureDraft() {
    var v = readVals();
    var body = { serviceId: S.service };
    if (v.qty !== undefined) body.qty = v.qty;
    if (v.areaSqm !== undefined) body.areaSqm = v.areaSqm;
    var p;
    if (!draft) p = EG.api('POST', '/api/drafts', body);
    else if (draft.status === 'DRAFT') p = EG.api('PUT', '/api/drafts/' + encodeURIComponent(draft.draftId), body);
    else return Promise.resolve(true);
    return p.then(function (r) {
      if (!r.ok) {
        var d = r.data || {};
        if (/^(INVALID_QTY|INVALID_AREA|AREA_TOO_LARGE)$/.test(d.code)) putMsg('fee-msg', 'fee-error', d.message, 'field-error', 'alert');
        else EG.showError(d.message || 'เกิดข้อผิดพลาด');
        return false;
      }
      if (!draft) draft = { draftId: r.data.draftId, status: 'DRAFT', fee: r.data.fee, files: [], missing: [] };
      draft.fee = r.data.fee;
      showDraftId();
      return true;
    });
  }

  function reloadDraft() {
    return EG.api('GET', '/api/drafts/' + encodeURIComponent(draft.draftId)).then(function (r) {
      if (r.ok) { var keepImg = draft.payment; draft = r.data; void keepImg; }
      return r.ok;
    });
  }

  tid('save-draft-btn').addEventListener('click', function () {
    var c = localCheck();
    if (!c.ok) { updateFee(); return; }
    ensureDraft().then(function (ok) { if (ok) EG.showSuccess('บันทึกร่างแล้ว'); });
  });
  toUploadBtn.addEventListener('click', function () {
    if (!localCheck().ok) return;
    EG.clearMessages();
    ensureDraft().then(function (ok) {
      if (!ok) return;
      return reloadDraft().then(function () { renderFiles(); showStep(2); });
    });
  });

  // ---------- ขั้น 2: แนบเอกสาร ----------
  var toPaymentBtn = tid('to-payment-btn');
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB'; }
  function renderFiles() {
    var ul = $('file-list');
    clear(ul);
    (draft.files || []).forEach(function (f) {
      var li = document.createElement('li');
      li.setAttribute('data-testid', 'file-item');
      li.setAttribute('data-name', f.name);
      li.setAttribute('data-doc-key', f.docKey);
      li.setAttribute('data-file-id', f.fileId);
      li.innerHTML = '<span>' + esc(S.labels[f.docKey] || f.docKey) + ': ' + esc(f.name) + ' <span class="muted">(' + fmtSize(f.size) + ')</span></span> ';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary btn-small';
      b.setAttribute('data-testid', 'file-remove-btn');
      b.setAttribute('aria-label', 'ลบไฟล์ ' + f.name);
      b.textContent = 'ลบ';
      b.addEventListener('click', function () { removeFile(f.fileId); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    var miss = draft.missing || [];
    putMsg('missing-msg', 'missing-docs', miss.length ? 'ยังขาดเอกสาร: ' + miss.join(', ') : '', 'notice', 'status');
    toPaymentBtn.disabled = miss.length > 0;
  }
  function removeFile(fileId) {
    putMsg('upload-msg', 'upload-error', '');
    EG.api('DELETE', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files/' + encodeURIComponent(fileId)).then(function (r) {
      if (!r.ok) { putMsg('upload-msg', 'upload-error', (r.data && r.data.message) || 'เกิดข้อผิดพลาด', 'field-error', 'alert'); return; }
      return reloadDraft().then(renderFiles);
    });
  }
  function uploadOne(docKey, file) {
    var fd = new FormData();
    fd.append('docKey', docKey);
    fd.append('file', file, file.name);
    return EG.api('POST', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files', fd).then(function (r) {
      if (!r.ok) putMsg('upload-msg', 'upload-error', (r.data && r.data.message) || 'เกิดข้อผิดพลาด', 'field-error', 'alert');
      return r.ok;
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[type="file"][data-doc-key]'), function (inp) {
    inp.addEventListener('change', function () {
      var files = Array.prototype.slice.call(inp.files || []);
      var key = inp.getAttribute('data-doc-key');
      putMsg('upload-msg', 'upload-error', '');
      var chain = Promise.resolve();
      files.forEach(function (f) { chain = chain.then(function () { return uploadOne(key, f); }); });
      chain.then(function () { inp.value = ''; return reloadDraft(); }).then(renderFiles);
    });
  });
  toPaymentBtn.addEventListener('click', function () {
    if (toPaymentBtn.disabled) return;
    EG.clearMessages();
    tid('payment-amount').textContent = EG.money(draft.fee);
    showStep(3);
    renderPayment(draft.payment);
  });

  // ---------- ขั้น 3: ชำระเงิน ----------
  var payBox = $('pay-box');
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPoll() { stopPoll(); pollTimer = setInterval(refreshPayment, 3000); }
  function statusBadge(st) {
    var th = { PENDING: 'รอชำระ', PAID: 'ชำระแล้ว', EXPIRED: 'QR หมดอายุ' }[st] || st;
    return '<span data-testid="payment-status" data-status="' + st + '" class="badge pay-' + st + '">' + th + '</span>';
  }
  function timeHtml(t, iso, text) {
    return '<time data-testid="' + t + '" data-iso="' + esc(iso) + '" datetime="' + esc(iso) + '">' + esc(text) + '</time>';
  }
  function renderPayment(p) {
    stopPoll();
    var h = '';
    if (!p) {
      h = '<div class="actions"><button type="button" class="btn" data-testid="create-qr-btn">สร้าง QR</button></div>';
    } else {
      h += '<p>เลขอ้างอิง: <strong data-testid="qr-ref">' + esc(p.ref) + '</strong> · สถานะ: ' + statusBadge(p.status) + '</p>';
      if (p.status === 'PENDING') {
        h += '<p><img data-testid="qr-image" alt="QR ชำระเงินจำลอง เลขอ้างอิง ' + esc(p.ref) + '" width="220" height="220" src="' + esc(qrImage || '') + '"></p>';
        h += '<p>' + timeHtml('qr-expires', p.qrExpiresAt, 'หมดอายุ ' + EG.thaiDateTime(p.qrExpiresAt)) + '</p>';
        h += '<div class="actions"><button type="button" class="btn btn-secondary" data-testid="refresh-payment-btn">ตรวจสอบการชำระเงิน</button></div>';
        h += '<p class="muted">ระบบจำลอง: ใช้ตัวช่วยทดสอบจำลองการชำระเงินเพื่อชำระรายการนี้</p>';
      } else if (p.status === 'EXPIRED') {
        h += '<p class="notice" role="alert" data-testid="qr-expired-msg">QR หมดอายุ กรุณาสร้าง QR ใหม่</p>';
        h += '<p>' + timeHtml('qr-expires', p.qrExpiresAt, 'หมดอายุ ' + EG.thaiDateTime(p.qrExpiresAt)) + '</p>';
        h += '<div class="actions"><button type="button" class="btn" data-testid="regenerate-qr-btn">สร้าง QR ใหม่</button> ' +
          '<button type="button" class="btn btn-secondary" data-testid="refresh-payment-btn">ตรวจสอบการชำระเงิน</button></div>';
      } else {
        h += '<div class="card" role="status"><h3>ใบเสร็จ</h3><dl class="kv">' +
          '<dt>เลขคำขอ</dt><dd data-testid="submitted-case-no">' + esc(p.caseNo) + '</dd>' +
          '<dt>เลขใบเสร็จ</dt><dd data-testid="receipt-no">' + esc(p.receiptNo) + '</dd>' +
          '<dt>ยอดชำระ</dt><dd data-testid="receipt-amount">' + esc(EG.money(p.amount)) + '</dd>' +
          '<dt>เวลาชำระ</dt><dd>' + timeHtml('receipt-paid-at', p.paidAt, EG.thaiDateTime(p.paidAt)) + '</dd></dl></div>' +
          '<div class="actions"><a class="btn" data-testid="go-case-btn" href="/citizen/cases/' + encodeURIComponent(p.caseNo) + '">ดูคำขอ</a></div>';
      }
    }
    payBox.innerHTML = h;
    var c = tid('create-qr-btn', payBox) || tid('regenerate-qr-btn', payBox);
    if (c) c.addEventListener('click', function () { createQr(c); });
    var r = tid('refresh-payment-btn', payBox);
    if (r) r.addEventListener('click', refreshPayment);
    if (p && p.status === 'PENDING') startPoll();
    if (p && p.status === 'PAID') tid('payment-amount').textContent = EG.money(p.amount);
  }
  function createQr(btn) {
    setBusy(btn, true);
    EG.clearMessages();
    EG.api('POST', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/payment').then(function (r) {
      setBusy(btn, false);
      if (!r.ok) {
        var d = r.data || {};
        if (d.code === 'MISSING_DOCS') { draft.missing = d.missing; renderFiles(); showStep(2); }
        EG.showError(d.message || 'เกิดข้อผิดพลาด');
        return;
      }
      qrImage = r.data.qrImage;
      draft.status = 'PENDING_PAYMENT';
      draft.payment = r.data;
      tid('payment-amount').textContent = EG.money(r.data.amount);
      renderPayment(r.data);
    });
  }
  function refreshPayment() {
    var p = draft && draft.payment;
    if (!p) return;
    EG.api('GET', '/api/payments/' + encodeURIComponent(p.ref)).then(function (r) {
      if (!r.ok) return;
      if (r.data.status === p.status && r.data.status === 'PENDING') return; // ไม่เปลี่ยน ไม่ต้องวาดใหม่
      draft.payment = r.data;
      renderPayment(r.data);
    });
  }

  // ---------- เริ่มต้น ----------
  if (draft) showDraftId();
  updateFee();
  if (draft && draft.status === 'PENDING_PAYMENT') {
    tid('payment-amount').textContent = EG.money(draft.fee);
    showStep(3);
    renderPayment(draft.payment);
  } else {
    if (draft) renderFiles();
    showStep(1);
  }
})();
