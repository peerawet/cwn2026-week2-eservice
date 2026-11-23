/* หน้า /citizen/cases/:caseNo — ยกเลิกคำขอ (มี confirm) · ส่งแก้ไขเอกสาร */
(function () {
  'use strict';
  var EG = window.EG;
  var tid = function (t) { return document.querySelector('[data-testid="' + t + '"]'); };
  var page = document.getElementById('case-page');
  if (!page) return;
  var caseNo = page.getAttribute('data-case-no');

  var cancelBtn = tid('cancel-case-btn');
  var box = document.getElementById('cancel-confirm');
  if (cancelBtn && box) {
    cancelBtn.addEventListener('click', function () {
      box.hidden = false;
      cancelBtn.setAttribute('aria-expanded', 'true');
      tid('confirm-cancel-btn').focus();
    });
    document.getElementById('cancel-abort').addEventListener('click', function () {
      box.hidden = true;
      cancelBtn.setAttribute('aria-expanded', 'false');
      cancelBtn.focus();
    });
    tid('confirm-cancel-btn').addEventListener('click', function () {
      EG.api('POST', '/api/cases/' + encodeURIComponent(caseNo) + '/cancel').then(function (r) {
        if (r.ok) { window.location.reload(); return; }
        box.hidden = true;
        EG.showError((r.data && r.data.message) || 'เกิดข้อผิดพลาด');
      });
    });
  }

  var fixBtn = tid('submit-fix-btn');
  if (fixBtn) {
    fixBtn.addEventListener('click', function () {
      var inp = tid('fix-upload-input');
      var fd = new FormData();
      if (inp && inp.files && inp.files.length) {
        fd.append('docKey', 'extra');
        fd.append('file', inp.files[0], inp.files[0].name);
      }
      EG.api('POST', '/api/cases/' + encodeURIComponent(caseNo) + '/resubmit', fd).then(function (r) {
        if (r.ok) { window.location.reload(); return; }
        EG.showError((r.data && r.data.message) || 'เกิดข้อผิดพลาด');
      });
    });
  }
})();
