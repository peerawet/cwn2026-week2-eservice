/* ตัวช่วยฝั่ง browser กลาง (โหลดทุกหน้าโดย layout) → window.EG */
(function () {
  'use strict';
  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function q(tid) { return document.querySelector('[data-testid="' + tid + '"]'); }
  function setMsg(tid, msg) {
    var el = q(tid);
    if (!el) return;
    el.textContent = msg || '';
    if (msg) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
  }
  var EG = {
    /** แสดงข้อความใน action-error (role=alert) และซ่อน action-success */
    showError: function (msg) { setMsg('action-success', ''); setMsg('action-error', msg); },
    /** แสดงข้อความใน action-success และซ่อน action-error */
    showSuccess: function (msg) { setMsg('action-error', ''); setMsg('action-success', msg); },
    clearMessages: function () { setMsg('action-error', ''); setMsg('action-success', ''); },
    /**
     * เรียก API แบบ JSON (cookie session ส่งอัตโนมัติ)
     * body: object → JSON · FormData → multipart · คืน { ok, status, data }
     */
    api: function (method, url, body) {
      var opts = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
      if (body instanceof FormData) opts.body = body;
      else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
      return fetch(url, opts).then(function (r) {
        var ct = r.headers.get('content-type') || '';
        var p = ct.indexOf('application/json') >= 0 ? r.json() : r.text();
        return p.then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
      });
    },
    /** 1010 → '฿1,010' */
    money: function (n) {
      if (n === null || n === undefined || n === '' || !isFinite(Number(n))) return '–';
      return '฿' + String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    /** ISO +07:00 → '4 ธ.ค. 2569 16:30' (คิดเวลาไทยเอง ไม่ขึ้นกับเขตเวลาของ browser) */
    thaiDateTime: function (iso) {
      var ms = Date.parse(iso);
      if (isNaN(ms)) return '–';
      var t = new Date(ms + 7 * 3600 * 1000);
      var hh = String(t.getUTCHours()).padStart(2, '0'), mm = String(t.getUTCMinutes()).padStart(2, '0');
      return t.getUTCDate() + ' ' + TH_MONTHS[t.getUTCMonth()] + ' ' + (t.getUTCFullYear() + 543) + ' ' + hh + ':' + mm;
    },
    q: q,
  };
  window.EG = EG;

  // .table-wrap ที่เลื่อนแนวนอนได้จริง → ให้โฟกัสด้วยคีย์บอร์ดได้ (axe: scrollable-region-focusable)
  // ไม่เลื่อน → ไม่เพิ่ม tab stop · ป้ายจาก data-label / <caption> / 'ตาราง'
  function fixScrollRegions() {
    var list = document.querySelectorAll('.table-wrap');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.scrollWidth > el.clientWidth + 1) {
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'region');
        if (!el.getAttribute('aria-label')) {
          var cap = el.querySelector('caption');
          el.setAttribute('aria-label', el.getAttribute('data-label') || (cap && cap.textContent.trim()) || 'ตาราง');
        }
      } else if (el.getAttribute('tabindex') === '0' && !el.hasAttribute('data-keep-focusable')) {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
      }
    }
  }
  EG.fixScrollRegions = fixScrollRegions;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fixScrollRegions);
  else fixScrollRegions();
  window.addEventListener('resize', fixScrollRegions);
})();
