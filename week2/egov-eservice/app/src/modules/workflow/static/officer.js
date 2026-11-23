/* ฝั่ง browser ของ workflow: คิวงาน (กรอง/รับเรื่อง) และหน้าคำขอของเจ้าหน้าที่ (ปุ่มดำเนินการ) */
(function () {
  'use strict';
  var EG = window.EG;
  function $(id) { return document.getElementById(id); }
  function q(tid, root) { return (root || document).querySelector('[data-testid="' + tid + '"]'); }
  function fail(r) { EG.showError((r && r.data && r.data.message) || 'เกิดข้อผิดพลาด'); }

  // ข้อความสำเร็จข้ามการโหลดหน้าใหม่
  function flashSet(msg) { try { sessionStorage.setItem('eg_flash', msg); } catch (e) { /* ไม่มี storage ก็ไม่เป็นไร */ } }
  try {
    var f = sessionStorage.getItem('eg_flash');
    if (f) { sessionStorage.removeItem('eg_flash'); EG.showSuccess(f); }
  } catch (e) { /* ignore */ }

  // ---------- คิวงาน ----------
  var table = $('queue-table');
  if (table) {
    var body = $('queue-body');
    var all = Array.prototype.slice.call(body.children);
    var me = table.getAttribute('data-me') || '';
    var select = q('queue-filter');
    var wrap = table.parentNode;

    var match = function (tr, filter) {
      var owner = tr.getAttribute('data-owner') || '';
      var st = tr.getAttribute('data-status');
      if (filter === 'unclaimed') return !owner && (st === 'SUBMITTED' || st === 'IN_REVIEW');
      if (filter === 'mine') return st === 'IN_REVIEW' && owner === me;
      return true;
    };
    var apply = function () {
      var filter = select.value;
      var rows = all.filter(function (tr) { return match(tr, filter); });
      while (body.firstChild) body.removeChild(body.firstChild);
      rows.forEach(function (tr) { body.appendChild(tr); });
      var empty = $('queue-empty');
      if (!rows.length && !empty) {
        empty = document.createElement('p');
        empty.id = 'queue-empty';
        empty.setAttribute('data-testid', 'queue-empty');
        empty.textContent = 'ไม่มีงานในคิว';
        wrap.parentNode.insertBefore(empty, wrap.nextSibling);
      } else if (rows.length && empty) empty.parentNode.removeChild(empty);
    };
    select.addEventListener('change', apply);
    apply();

    body.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-testid="claim-btn"]') : null;
      if (!btn) return;
      var caseNo = btn.getAttribute('data-case-no');
      btn.disabled = true;
      EG.api('POST', '/api/officer/cases/' + encodeURIComponent(caseNo) + '/claim').then(function (r) {
        if (!r.ok) { btn.disabled = false; fail(r); return; }
        var tr = btn.closest('tr');
        tr.setAttribute('data-owner', r.data.owner);
        tr.setAttribute('data-status', 'IN_REVIEW');
        q('row-owner', tr).textContent = r.data.owner;
        var st = q('row-status', tr);
        st.setAttribute('data-status', 'IN_REVIEW');
        st.className = 'badge st-IN_REVIEW';
        st.textContent = 'กำลังตรวจสอบ';
        btn.parentNode.removeChild(btn);
        var wl = q('workload-count');
        if (wl) wl.textContent = String(Number(wl.textContent) + 1);
        EG.showSuccess('รับเรื่อง ' + caseNo + ' แล้ว');
        apply();
      });
    });
  }

  // ---------- หน้าคำขอของเจ้าหน้าที่ ----------
  var box = $('actions');
  var caseNoEl = q('case-no');
  var caseNo = caseNoEl ? caseNoEl.textContent.trim() : '';
  var base = '/api/officer/cases/' + encodeURIComponent(caseNo);

  function done(msg) { flashSet(msg); window.location.reload(); }
  function post(btn, url, payload, msg, onFail) {
    if (btn) btn.disabled = true;
    EG.clearMessages();
    return EG.api('POST', url, payload).then(function (r) {
      if (r.ok) { done(msg); return r; }
      if (btn) btn.disabled = false;
      if (onFail) onFail(r); else fail(r);
      return r;
    });
  }
  function bind(id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); }

  if (box) {
    bind('act-claim', function (e) { post(e.currentTarget, base + '/claim', undefined, 'รับเรื่องแล้ว'); });
    bind('act-forward', function (e) {
      post(e.currentTarget, base + '/forward', { note: $('forward-note') ? $('forward-note').value : '' }, 'ส่งต่อแล้ว');
    });
    bind('act-approve', function (e) { post(e.currentTarget, '/api/cases/' + encodeURIComponent(caseNo) + '/approve', undefined, 'อนุมัติแล้ว'); });
    bind('act-issue', function (e) { post(e.currentTarget, base + '/issue', undefined, 'ออกเอกสารแล้ว'); });

    // ตีกลับ / ไม่อนุมัติ: ปุ่มหลักโฟกัสช่องเหตุผลถ้ายังว่าง · ปุ่มยืนยันส่งเสมอ
    var reasonFlow = function (prefix, url, msg) {
      var ta = $(prefix + '-reason');
      var err = $(prefix + '-reason-error');
      var submit = function (btn) {
        err.hidden = true; err.textContent = '';
        ta.removeAttribute('aria-invalid');
        post(btn, url, { reason: ta.value }, msg, function (r) {
          if (r.data && r.data.code === 'REASON_TOO_SHORT') {
            err.textContent = r.data.message; err.hidden = false; ta.setAttribute('aria-invalid', 'true'); ta.focus();
          } else fail(r);
        });
      };
      bind('act-' + prefix, function (e) { if (ta.value.trim()) submit(e.currentTarget); else ta.focus(); });
      bind('act-' + prefix + '-submit', function (e) { submit(e.currentTarget); });
    };
    if ($('return-reason')) reasonFlow('return', base + '/return', 'ตีกลับให้แก้ไขแล้ว');
    if ($('reject-reason')) reasonFlow('reject', '/api/cases/' + encodeURIComponent(caseNo) + '/reject', 'ไม่อนุมัติคำขอแล้ว');
  }

  // แสดงเลขเต็ม (API ของ mgmt): กรอกเหตุผล → เห็นเฉพาะในหน้านี้ (โหลดใหม่แล้วปิดบังตามเดิม)
  var showBtn = $('show-full-id');
  if (showBtn) {
    var ubox = $('unmask-box');
    showBtn.addEventListener('click', function () {
      ubox.hidden = false;
      showBtn.setAttribute('aria-expanded', 'true');
      $('unmask-reason').focus();
    });
    var fmt = function (s) { return String(s).replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/, '$1-$2-$3-$4-$5'); };
    $('unmask-submit').addEventListener('click', function (e) {
      var btn = e.currentTarget; var err = $('unmask-error');
      err.hidden = true; err.textContent = '';
      btn.disabled = true;
      EG.api('POST', base + '/unmask', { reason: $('unmask-reason').value }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { err.textContent = (r.data && r.data.message) || 'เกิดข้อผิดพลาด'; err.hidden = false; return; }
        var slot = $('full-id-slot');
        slot.textContent = '';
        var s = document.createElement('strong');
        s.setAttribute('data-testid', 'full-id');
        s.textContent = fmt(r.data.idNo);
        slot.appendChild(document.createTextNode(' → '));
        slot.appendChild(s);
        slot.appendChild(document.createTextNode(' '));
        ubox.hidden = true;
        $('unmask-reason').value = '';
      });
    });
  }
})();
