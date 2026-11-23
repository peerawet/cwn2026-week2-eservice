/* หน้า /register */
(function () {
  'use strict';
  var EG = window.EG;
  var form = document.getElementById('reg-form');
  var mobileMsg = document.getElementById('reg-mobile-msg');
  var consentMsg = document.getElementById('reg-consent-msg');
  var M = JSON.parse(form.getAttribute('data-msgs'));

  function setMsg(host, testid, text) {
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!text) return;
    var p = document.createElement('p');
    p.className = 'field-error';
    p.setAttribute('role', 'alert');
    p.setAttribute('data-testid', testid);
    p.textContent = text;
    host.appendChild(p);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var mobile = document.querySelector('[data-testid="reg-mobile"]').value.trim();
    var email = document.querySelector('[data-testid="reg-email"]').value.trim();
    var consent = document.querySelector('[data-testid="reg-consent"]').checked;
    var badMobile = !/^0\d{9}$/.test(mobile);
    setMsg(mobileMsg, 'reg-error-mobile', badMobile ? M.INVALID_MOBILE : '');
    setMsg(consentMsg, 'reg-error-consent', consent ? '' : M.CONSENT_REQUIRED);
    if (badMobile || !consent) return;
    EG.api('POST', '/api/auth/register', { mobile: mobile, email: email, consent: true }).then(function (r) {
      if (r.ok) { window.location.href = '/citizen'; return; }
      var d = r.data || {};
      if (d.code === 'INVALID_MOBILE') setMsg(mobileMsg, 'reg-error-mobile', d.message);
      else if (d.code === 'CONSENT_REQUIRED') setMsg(consentMsg, 'reg-error-consent', d.message);
      else EG.showError(d.message || 'เกิดข้อผิดพลาด');
    });
  });
})();
