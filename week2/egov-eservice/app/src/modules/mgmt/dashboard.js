'use strict';
// Dashboard ผู้บริหาร (BR-25 BR-26 · A-41): ตัวชี้วัด + งานในมือ + ย้อนหลังรายเดือน + ส่งออก xlsx/pdf (ไม่มีข้อมูลส่วนบุคคล)

const ExcelJS = require('exceljs');
const pdf = require('./pdf');

const SERVICES = ['ALL', 'SV-01', 'SV-02', 'SV-03'];
const OPEN = ['SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'PENDING_APPROVAL', 'APPROVED'];
const p2 = (n) => String(n).padStart(2, '0');

module.exports = function registerDashboard(app, ctx) {
  const { db, clock, errors, format, layout, session, audit } = ctx;
  const { html, raw } = format;
  const { requireRole } = session;

  const validPeriod = (p) => typeof p === 'string' && /^(\d{4})(-(0[1-9]|1[0-2]))?$/.test(p);
  const validService = (s) => SERVICES.includes(s);
  const monthOfNow = () => clock.nowDateKey().slice(0, 7);

  function thaiMonthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return `${format.TH_MONTHS[m - 1]} ${y + 543}`;
  }
  const periodLabel = (p) => (p.length === 4 ? `ทั้งปี ${Number(p) + 543}` : thaiMonthLabel(p));

  /** ตัวชี้วัดของช่วง/บริการ (BR-25) */
  function compute(period, service) {
    const rows = db.all('SELECT service_id, status, paid_at, closed_at, due_at FROM cases WHERE case_no IS NOT NULL')
      .filter((r) => service === 'ALL' || r.service_id === service);
    const inPeriod = (iso) => {
      const ms = iso ? clock.parseIso(iso) : null;
      return ms != null && clock.dateKey(ms).startsWith(period);
    };
    const received = rows.filter((r) => inPeriod(r.paid_at)).length;
    const closedRows = rows.filter((r) => (r.status === 'COMPLETED' || r.status === 'REJECTED') && inPeriod(r.closed_at));
    const closed = closedRows.length;
    const onTime = closedRows.filter((r) => clock.parseIso(r.closed_at) <= clock.parseIso(r.due_at)).length;
    const nowMs = clock.now();
    const open = rows.filter((r) => OPEN.includes(r.status));
    const backlog = open.length;
    const overdue = open.filter((r) => r.status !== 'NEED_FIX' && r.due_at && nowMs > clock.parseIso(r.due_at)).length;
    // BUG B10: ทันกำหนด % หารด้วย "รับเรื่อง" แทน "ปิดงาน"
    const den = ctx.bugs.isOn('B10') ? received : closed;
    const pctText = format.percent(onTime, den);
    const ontimePct = den ? Number(pctText.replace('%', '')) : null;
    return { received, closed, onTime, ontimePct, pctText, backlog, overdue };
  }

  function workload() {
    const officers = db.all("SELECT username, display_name FROM users WHERE role = 'officer' ORDER BY username");
    return officers.map((o) => ({
      username: o.username,
      name: o.display_name,
      count: Number(db.get("SELECT COUNT(*) AS n FROM cases WHERE status = 'IN_REVIEW' AND owner = ?", o.username).n),
    }));
  }

  /** เดือนทั้งหมดตั้งแต่เดือนแรกที่มีการชำระ ถึงเดือนของนาฬิกา (ใหม่ → เก่า) */
  function months() {
    const first = db.get('SELECT MIN(paid_at) AS p FROM cases WHERE case_no IS NOT NULL').p;
    const nowKey = monthOfNow();
    let start = first ? clock.dateKey(clock.parseIso(first)).slice(0, 7) : nowKey;
    if (start > nowKey) start = nowKey;
    const out = [];
    let [y, m] = nowKey.split('-').map(Number);
    for (let i = 0; i < 36; i++) {
      const k = `${y}-${p2(m)}`;
      out.push(k);
      if (k <= start) break;
      m -= 1; if (m === 0) { m = 12; y -= 1; }
    }
    return out;
  }
  function periodOptions() {
    const ms = months();
    const years = [...new Set(ms.map((k) => k.slice(0, 4)))];
    return [...ms, ...years];
  }

  const publicKpi = (c) => ({
    received: c.received, closed: c.closed, onTime: c.onTime, ontimePct: c.ontimePct, backlog: c.backlog, overdue: c.overdue,
  });

  // ---------- API ----------
  function parseQuery(req) {
    const period = req.query.period === undefined || req.query.period === '' ? monthOfNow() : req.query.period;
    const service = req.query.service === undefined || req.query.service === '' ? 'ALL' : req.query.service;
    if (!validPeriod(period) || !validService(service)) return null;
    return { period, service };
  }

  app.get('/api/dashboard', requireRole('executive'), (req, res) => {
    const q = parseQuery(req);
    if (!q) return errors.sendError(res, 'BAD_REQUEST');
    const c = compute(q.period, q.service);
    return res.json({ ...publicKpi(c), workload: workload().map((w) => ({ username: w.username, count: w.count })) });
  });

  app.get('/api/dashboard/export', requireRole('executive'), errors.wrap(async (req, res) => {
    const q = parseQuery(req);
    const fmt = req.query.format;
    if (!q || (fmt !== 'xlsx' && fmt !== 'pdf')) return errors.sendError(res, 'BAD_REQUEST');
    const c = compute(q.period, q.service);
    const cells = [
      ['รับเรื่อง', String(c.received)],
      ['ปิดงาน', String(c.closed)],
      ['ทันกำหนด %', c.pctText],
      ['งานคงค้าง', String(c.backlog)],
      ['เกินกำหนดคงค้าง', String(c.overdue)],
    ];
    let buf; let type;
    if (fmt === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Dashboard');
      ws.addRow(['ตัวชี้วัด', 'ค่า']);
      for (const r of cells) ws.addRow(r);
      ws.addRow([]);
      ws.addRow(['ช่วงเวลา', q.period]);
      ws.addRow(['บริการ', q.service]);
      ws.getRow(1).font = { bold: true };
      ws.getColumn(1).width = 24; ws.getColumn(2).width = 16;
      for (let i = 2; i <= 6; i++) ws.getCell(`B${i}`).numFmt = '@';
      buf = Buffer.from(await wb.xlsx.writeBuffer());
      type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      buf = await buildPdf(q, c, cells);
      type = 'application/pdf';
    }
    // บันทึก Audit หลังสร้างไฟล์สำเร็จ (A-36)
    audit.log({ user: req.user, event: 'EXPORT', detail: `${fmt} ${q.period} ${q.service}` });
    res.set({
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="dashboard-${q.period}-${q.service}.${fmt}"`,
      'Content-Length': String(buf.length),
    });
    return res.end(buf);
  }));

  async function buildPdf(q, c, cells) {
    const doc = pdf.newDoc({
      Title: 'Dashboard',
      Author: 'e-Service',
      Subject: 'dashboard',
      Keywords: `kpi received=${c.received} closed=${c.closed} ontime=${c.ontimePct == null ? '-' : c.pctText} backlog=${c.backlog} overdue=${c.overdue}`,
    });
    pdf.centered(doc, 'รายงานตัวชี้วัดการให้บริการ e-Service', 60, 20);
    pdf.centered(doc, `ช่วงเวลา: ${periodLabel(q.period)} · บริการ: ${q.service === 'ALL' ? 'ทั้งหมด' : q.service}`, 92, 14);
    let y = 150;
    for (const [k, v] of cells) {
      pdf.mixed(doc, k, 90, y, 16);
      pdf.mixed(doc, v, 360, y, 16);
      y += 34;
    }
    pdf.mixed(doc, 'รายงานนี้ไม่มีข้อมูลส่วนบุคคลของผู้ยื่นคำขอ', 90, y + 20, 11);
    return pdf.toBuffer(doc);
  }

  // ---------- หน้า ----------
  function trendRows(service) {
    return months().map((k) => ({ key: k, c: compute(k, service) }));
  }

  function resultsHtml(q) {
    const c = compute(q.period, q.service);
    const wl = workload();
    const trend = trendRows(q.service);
    const qs = `period=${encodeURIComponent(q.period)}&service=${encodeURIComponent(q.service)}`;
    return html`<div id="dash-results">
      <section aria-labelledby="h-kpi">
        <h2 id="h-kpi">ตัวชี้วัด · ${periodLabel(q.period)} · ${q.service === 'ALL' ? 'ทุกบริการ' : q.service}</h2>
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">รับเรื่อง</div><div class="value" data-testid="kpi-received">${c.received}</div></div>
          <div class="kpi"><div class="kpi-label">ปิดงาน</div><div class="value" data-testid="kpi-closed">${c.closed}</div></div>
          <div class="kpi"><div class="kpi-label">ทันกำหนด %</div><div class="value" data-testid="kpi-ontime-pct">${c.pctText}</div></div>
          <div class="kpi"><div class="kpi-label">งานคงค้าง</div><div class="value" data-testid="kpi-backlog">${c.backlog}</div></div>
          <div class="kpi"><div class="kpi-label">เกินกำหนดคงค้าง</div><div class="value" data-testid="kpi-overdue">${c.overdue}</div></div>
        </div>
        <p class="muted">งานคงค้างและเกินกำหนดคงค้างคิด ณ ตอนนี้ ไม่ขึ้นกับช่วงเวลาที่เลือก</p>
        <div class="actions">
          <a class="btn" data-testid="export-xlsx-btn" href="/api/dashboard/export?format=xlsx&amp;${qs}" download>ส่งออก Excel</a>
          <a class="btn btn-secondary" data-testid="export-pdf-btn" href="/api/dashboard/export?format=pdf&amp;${qs}" download>ส่งออก PDF</a>
        </div>
      </section>
      <section aria-labelledby="h-wl">
        <h2 id="h-wl">งานในมือรายเจ้าหน้าที่</h2>
        <div class="table-wrap" data-label="งานในมือรายเจ้าหน้าที่"><table class="data">
          <thead><tr><th scope="col">เจ้าหน้าที่</th><th scope="col">งานในมือ (กำลังตรวจสอบ)</th></tr></thead>
          <tbody>${wl.map((w) => html`<tr data-testid="workload-row" data-username="${w.username}"><td>${w.name} (${w.username})</td><td data-testid="workload-value">${w.count}</td></tr>`)}</tbody>
        </table></div>
      </section>
      <section aria-labelledby="h-trend">
        <h2 id="h-trend">ย้อนหลังรายเดือน</h2>
        <div class="table-wrap" data-label="ย้อนหลังรายเดือน"><table class="data">
          <thead><tr><th scope="col">เดือน</th><th scope="col">รับเรื่อง</th><th scope="col">ปิดงาน</th><th scope="col">ทันกำหนด %</th></tr></thead>
          <tbody>${trend.map((t) => html`<tr data-testid="trend-row" data-period="${t.key}"><td>${thaiMonthLabel(t.key)}</td><td>${t.c.received}</td><td>${t.c.closed}</td><td>${t.c.pctText}</td></tr>`)}</tbody>
        </table></div>
      </section>
    </div>`;
  }

  app.get('/dashboard', requireRole('executive'), (req, res) => {
    const q = parseQuery(req) || { period: monthOfNow(), service: 'ALL' };
    if (req.query.partial === '1') return res.type('html').send(resultsHtml(q).toString());
    const opts = periodOptions();
    if (!opts.includes(q.period)) opts.unshift(q.period);
    const body = html`
      <form method="get" action="/dashboard" class="card" id="dash-form">
        <div class="grid">
          <div class="form-row"><label for="period-select">ช่วงเวลา</label>
            <select id="period-select" name="period" data-testid="period-select">${opts.map((o) => html`<option value="${o}"${o === q.period ? raw(' selected') : ''}>${periodLabel(o)}</option>`)}</select></div>
          <div class="form-row"><label for="service-select">บริการ</label>
            <select id="service-select" name="service" data-testid="service-select">${SERVICES.map((s) => html`<option value="${s}"${s === q.service ? raw(' selected') : ''}>${s === 'ALL' ? 'ทุกบริการ' : ctx.catalog.serviceLabel(s)}</option>`)}</select></div>
        </div>
        <noscript><button type="submit" class="btn">แสดงผล</button></noscript>
      </form>
      ${resultsHtml(q)}`;
    layout.send(res, { req, title: 'Dashboard ผู้บริหาร', body, wide: true, inlineScript: DASH_JS });
  });
};

const DASH_JS = `
(function () {
  var form = document.getElementById('dash-form');
  if (!form) return;
  var seq = 0;
  function refresh() {
    var p = document.getElementById('period-select').value;
    var s = document.getElementById('service-select').value;
    var qs = 'period=' + encodeURIComponent(p) + '&service=' + encodeURIComponent(s);
    var my = ++seq;
    fetch('/dashboard?' + qs + '&partial=1', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (t) {
      if (my !== seq) return;
      var box = document.getElementById('dash-results');
      var tmp = document.createElement('div'); tmp.innerHTML = t;
      var fresh = tmp.firstElementChild;
      if (box && fresh) box.replaceWith(fresh);
      try { history.replaceState(null, '', '/dashboard?' + qs); } catch (e) {}
      if (window.EG && EG.fixScrollRegions) EG.fixScrollRegions();
    });
  }
  document.getElementById('period-select').addEventListener('change', refresh);
  document.getElementById('service-select').addEventListener('change', refresh);
  form.addEventListener('submit', function (e) { e.preventDefault(); refresh(); });
})();
`;
