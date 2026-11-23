'use strict';
// Audit Trail (BR-27): ดู/กรอง/ส่งออก CSV · เพิ่มได้อย่างเดียว (PUT/PATCH/DELETE → 405)

module.exports = function registerAudit(app, ctx) {
  const { errors, format, layout, session, audit } = ctx;
  const { html, raw, timeEl } = format;
  const { requireRole } = session;

  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  function filters(req) {
    const f = { actor: str(req.query.actor), event: str(req.query.event), from: str(req.query.from), to: str(req.query.to) };
    if (f.event && !audit.EVENTS.includes(f.event)) f.event = '__none__'; // เหตุการณ์ที่ไม่มีจริง → ไม่พบรายการ
    return f;
  }

  // ---------- 405: แก้/ลบไม่ได้ (ทุกบทบาท รวมไม่ล็อกอิน · แม้ :id ไม่มีจริง) ----------
  const notAllowed = (req, res) => {
    res.set('Allow', 'GET');
    return errors.sendError(res, 'METHOD_NOT_ALLOWED');
  };
  for (const m of ['put', 'patch', 'delete', 'post']) {
    app[m]('/api/audit', notAllowed);
    app[m]('/api/audit/:id', notAllowed);
  }

  // ---------- API ----------
  app.get('/api/audit', requireRole('auditor'), (req, res) => res.json(audit.query(filters(req))));

  const q = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // กัน CSV injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  app.get('/api/audit/export.csv', requireRole('auditor'), (req, res) => {
    const { items } = audit.query(filters(req));
    const lines = ['time,username,role,event,caseNo,fromStatus,toStatus,detail'];
    for (const r of items) {
      lines.push([r.time, r.username, r.role, r.event, r.caseNo, r.fromStatus, r.toStatus, r.detail].map(q).join(','));
    }
    // บันทึก EXPORT หลังสร้างไฟล์ (ไฟล์จึงไม่รวมแถว EXPORT ของการส่งออกนี้เอง)
    audit.log({ user: req.user, event: 'EXPORT', detail: 'audit-csv' });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit-log.csv"' });
    return res.send(lines.join('\n') + '\n');
  });

  // ---------- หน้า ----------
  function resultsHtml(f) {
    const { count, items } = audit.query(f);
    const qs = new URLSearchParams();
    for (const k of ['actor', 'event', 'from', 'to']) if (f[k] && f[k] !== '__none__') qs.set(k, f[k]);
    const csv = '/api/audit/export.csv' + (qs.toString() ? '?' + qs.toString() : '');
    return html`<div id="audit-results">
      <p>พบ <strong data-testid="audit-count">${count}</strong> รายการ
        <a class="btn btn-secondary btn-small" data-testid="audit-export-csv-btn" href="${csv}" download>ส่งออก CSV</a></p>
      <div class="table-wrap" data-label="Audit Trail"><table class="data">
        <thead><tr><th scope="col">เวลา</th><th scope="col">ผู้ทำ</th><th scope="col">บทบาท</th><th scope="col">เหตุการณ์</th>
          <th scope="col">เลขคำขอ</th><th scope="col">สถานะก่อน → หลัง</th><th scope="col">รายละเอียด</th></tr></thead>
        <tbody>${items.map((r) => html`<tr data-testid="audit-row" data-id="${r.id}" data-event="${r.event}" data-actor="${r.username}" data-case-no="${r.caseNo || ''}">
          <td>${timeEl(r.time, { testid: 'audit-time' })}</td>
          <td data-testid="audit-actor">${r.username}</td>
          <td data-testid="audit-role">${r.role}</td>
          <td data-testid="audit-event">${r.event}</td>
          <td data-testid="audit-case-no">${r.caseNo || '–'}</td>
          <td data-testid="audit-transition">${r.fromStatus || r.toStatus ? `${r.fromStatus || '–'} → ${r.toStatus || '–'}` : '–'}</td>
          <td data-testid="audit-detail">${r.detail || ''}</td>
        </tr>`)}</tbody>
      </table></div>
    </div>`;
  }

  app.get('/audit', requireRole('auditor'), (req, res) => {
    const f = filters(req);
    if (req.query.partial === '1') return res.type('html').send(resultsHtml(f).toString());
    const shown = (k) => (f[k] && f[k] !== '__none__' ? f[k] : '');
    const body = html`
      <form method="get" action="/audit" class="card" id="audit-form">
        <div class="grid">
          <div class="form-row"><label for="audit-filter-actor">ผู้ทำ (username)</label>
            <input id="audit-filter-actor" name="actor" type="text" data-testid="audit-filter-actor" value="${shown('actor')}" autocomplete="off"></div>
          <div class="form-row"><label for="audit-filter-event">เหตุการณ์</label>
            <select id="audit-filter-event" name="event" data-testid="audit-filter-event"><option value="">ทั้งหมด</option>${audit.EVENTS.map((e) => html`<option value="${e}"${e === f.event ? raw(' selected') : ''}>${e}</option>`)}</select></div>
          <div class="form-row"><label for="audit-filter-from">ตั้งแต่วันที่</label>
            <input id="audit-filter-from" name="from" type="date" data-testid="audit-filter-from" value="${shown('from')}"></div>
          <div class="form-row"><label for="audit-filter-to">ถึงวันที่</label>
            <input id="audit-filter-to" name="to" type="date" data-testid="audit-filter-to" value="${shown('to')}"></div>
        </div>
        <button type="submit" class="btn" data-testid="audit-apply-btn">ค้นหา</button>
      </form>
      ${resultsHtml(f)}`;
    layout.send(res, { req, title: 'Audit Trail', body, wide: true, inlineScript: AUDIT_JS });
  });
};

const AUDIT_JS = `
(function () {
  var form = document.getElementById('audit-form');
  if (!form) return;
  var seq = 0;
  function qs() {
    var p = new URLSearchParams();
    ['actor', 'event', 'from', 'to'].forEach(function (n) {
      var v = form.elements[n].value.trim(); if (v) p.set(n, v);
    });
    return p.toString();
  }
  function refresh() {
    var s = qs(), my = ++seq;
    fetch('/audit?' + (s ? s + '&' : '') + 'partial=1', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (t) {
      if (my !== seq) return;
      var box = document.getElementById('audit-results');
      var tmp = document.createElement('div'); tmp.innerHTML = t;
      if (box && tmp.firstElementChild) box.replaceWith(tmp.firstElementChild);
      try { history.replaceState(null, '', '/audit' + (s ? '?' + s : '')); } catch (e) {}
      if (window.EG && EG.fixScrollRegions) EG.fixScrollRegions();
    });
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); refresh(); });
  // ส่งออก CSV บันทึก Audit EXPORT เพิ่ม 1 แถว → โหลดรายการใหม่ให้ตรงกับจำนวนจริง
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-testid="audit-export-csv-btn"]');
    if (a) setTimeout(refresh, 600);
  });
})();
`;
