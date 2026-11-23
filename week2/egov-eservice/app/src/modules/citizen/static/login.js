/* หน้า /login: แท็บประชาชน (ThaiD จำลอง) + เจ้าหน้าที่ (SSO จำลอง) */
(function () {
  'use strict';
  var EG = window.EG;
  var $ = function (id) { return document.getElementById(id); };

  function msgP(testid, text, extra) {
    var p = document.createElement('p');
    p.className = 'field-error';
    p.setAttribute('role', 'alert');
    p.setAttribute('data-testid', testid);
    p.textContent = text;
    if (extra) p.id = extra;
    return p;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------- แท็บ ----------
  var tabs = [$('tab-citizen'), $('tab-staff')];
  var panels = [$('panel-citizen'), $('panel-staff')];
  function selectTab(i, focus) {
    tabs.forEach(function (t, k) {
      t.setAttribute('aria-selected', k === i ? 'true' : 'false');
      t.setAttribute('tabindex', k === i ? '0' : '-1');
      panels[k].hidden = k !== i;
    });
    if (focus) tabs[i].focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { selectTab(i, false); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); selectTab((i + 1) % 2, true); }
    });
  });

  // ---------- ประชาชน ----------
  var idInput = $('thaid-id-input');
  var thaidMsg = $('thaid-msg');
  var otpHost = $('otp-host');
  var startedId = '';

  function showLock(host, lockedUntil) {
    var p = msgP('lock-message', 'ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที');
    host.appendChild(p);
    var q = document.createElement('p');
    q.appendChild(document.createTextNode('ปลดล็อกเวลา '));
    var t = document.createElement('time');
    t.setAttribute('data-testid', 'lock-until');
    t.setAttribute('data-iso', lockedUntil);
    t.setAttribute('datetime', lockedUntil);
    t.textContent = EG.thaiDateTime(lockedUntil);
    q.appendChild(t);
    host.appendChild(q);
  }

  function openOtpStep() {
    clear(otpHost);
    var tpl = $('otp-template');
    otpHost.appendChild(tpl.content.cloneNode(true));
    var otpForm = $('otp-form');
    var otpInput = $('otp-input');
    var otpMsg = $('otp-msg');
    otpForm.addEventListener('submit', function (e) {
      e.preventDefault();
      clear(otpMsg);
      EG.api('POST', '/api/auth/thaid/verify', { idNo: startedId, otp: otpInput.value }).then(function (r) {
        if (r.ok) { window.location.href = r.data.registered ? '/citizen' : '/register'; return; }
        var d = r.data || {};
        if (d.code === 'OTP_INVALID') {
          otpMsg.appendChild(msgP('otp-error', d.message));
          var a = document.createElement('p');
          a.setAttribute('data-testid', 'otp-attempts-left');
          a.className = 'field-error';
          a.textContent = 'เหลือ ' + d.attemptsLeft + ' ครั้ง';
          otpMsg.appendChild(a);
        } else if (d.code === 'LOCKED') {
          showLock(otpMsg, d.lockedUntil);
        } else {
          otpMsg.appendChild(msgP('thaid-error', d.message || 'เกิดข้อผิดพลาด'));
        }
        otpInput.focus();
      });
    });
    otpInput.focus();
  }

  $('thaid-form').addEventListener('submit', function (e) {
    e.preventDefault();
    clear(thaidMsg);
    EG.api('POST', '/api/auth/thaid/start', { idNo: idInput.value }).then(function (r) {
      if (r.ok) { startedId = idInput.value.trim(); openOtpStep(); return; }
      clear(otpHost);
      var d = r.data || {};
      if (d.code === 'LOCKED') showLock(thaidMsg, d.lockedUntil);
      else thaidMsg.appendChild(msgP('thaid-error', d.message || 'เกิดข้อผิดพลาด'));
    });
  });

  // ---------- เจ้าหน้าที่ ----------
  var staffMsg = $('staff-msg');
  $('staff-form').addEventListener('submit', function (e) {
    e.preventDefault();
    clear(staffMsg);
    EG.api('POST', '/api/auth/staff/login', { username: $('staff-username').value, password: $('staff-password').value }).then(function (r) {
      if (r.ok) { window.location.href = r.data.landing; return; }
      staffMsg.appendChild(msgP('staff-error', (r.data && r.data.message) || 'เกิดข้อผิดพลาด'));
    });
  });
})();
