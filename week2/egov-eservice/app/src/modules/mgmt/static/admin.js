/* หน้าผู้ดูแลระบบ: บริการ / วันหยุด / ผู้ใช้ (เรียก /api/admin/* แล้วแสดงผลใน action-error / action-success) */
(function () {
  'use strict';
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : null; }
  function num(v) { return v === '' || v === null ? 'invalid' : Number(v); }
  function done(r, okMsg) {
    if (r.ok) { EG.showSuccess(okMsg); return true; }
    EG.showError((r.data && r.data.message) || 'เกิดข้อผิดพลาด');
    return false;
  }

  // ----- บริการ -----
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-save-service]') : null;
    if (!t) return;
    var id = t.getAttribute('data-save-service');
    var body = { sla: num(val('svc-sla-' + id)) };
    if (id === 'SV-03') {
      body.feeBase = num(val('svc-fee-' + id));
      body.feePerSqm = num(val('svc-fee-per-sqm-' + id));
    } else {
      body.fee = num(val('svc-fee-' + id));
    }
    EG.api('PUT', '/api/admin/services/' + encodeURIComponent(id), body).then(function (r) {
      done(r, 'บันทึกบริการ ' + id + ' แล้ว');
    });
  });

  // ----- วันหยุด -----
  function reloadHolidays() {
    return fetch('/admin/holidays?partial=1', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (t) {
      var box = document.getElementById('holiday-list');
      var tmp = document.createElement('div'); tmp.innerHTML = t;
      if (box && tmp.firstElementChild) box.replaceWith(tmp.firstElementChild);
      if (EG.fixScrollRegions) EG.fixScrollRegions();
    });
  }
  var hf = document.getElementById('holiday-form');
  if (hf) {
    hf.addEventListener('submit', function (e) {
      e.preventDefault();
      var date = val('holiday-date-input'), name = val('holiday-name-input');
      EG.api('POST', '/api/admin/holidays', { date: date, name: name }).then(function (r) {
        if (done(r, 'เพิ่มวันหยุด ' + date + ' แล้ว')) { reloadHolidays(); }
      });
    });
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-delete-holiday]') : null;
    if (!t) return;
    var d = t.getAttribute('data-delete-holiday');
    EG.api('DELETE', '/api/admin/holidays/' + encodeURIComponent(d)).then(function (r) {
      if (done(r, 'ลบวันหยุด ' + d + ' แล้ว')) { reloadHolidays(); }
    });
  });

  // ----- ผู้ใช้ -----
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-save-user]') : null;
    if (!t) return;
    var u = t.getAttribute('data-save-user');
    var role = val('role-' + u), dept = val('dept-' + u);
    EG.api('PUT', '/api/admin/users/' + encodeURIComponent(u), { role: role, dept: dept }).then(function (r) {
      done(r, 'บันทึกผู้ใช้ ' + u + ' แล้ว (มีผลเมื่อล็อกอินครั้งถัดไป)');
    });
  });
})();
