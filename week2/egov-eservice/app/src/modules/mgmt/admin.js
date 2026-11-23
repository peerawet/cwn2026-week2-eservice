'use strict';
// ผู้ดูแลระบบ (BR-28): บริการ (ค่าธรรมเนียม/SLA) · วันหยุด · ผู้ใช้/บทบาท · ทุกการแก้บันทึก Audit ADMIN_CHANGE

const ROLES = ['citizen', 'officer', 'head', 'executive', 'auditor', 'admin'];
const DEPTS = ['registry', 'works'];

module.exports = function registerAdmin(app, ctx) {
  const { db, errors, format, layout, session, audit, catalog } = ctx;
  const { html, raw, ROLE_TH } = format;
  const { requireRole } = session;
  const admin = requireRole('admin');

  /** จำนวนเต็มจาก number หรือสตริงตัวเลขล้วน · อื่น ๆ → null */
  function toInt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : null;
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
    return null;
  }
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null && o[k] !== '';
  const log = (req, detail) => audit.log({ user: req.user, event: 'ADMIN_CHANGE', detail });

  // ================= บริการ =================
  const svcJson = (s) => ({ id: s.id, name: s.name, fee: s.fee, feePerSqm: s.fee_per_sqm == null ? null : s.fee_per_sqm, sla: s.sla_days });
  const listServices = () => db.all('SELECT * FROM services ORDER BY sort, id');

  app.get('/api/admin/services', admin, (req, res) => res.json({ items: listServices().map(svcJson) }));

  app.put('/api/admin/services/:id', admin, (req, res) => {
    const s = db.get('SELECT * FROM services WHERE id = ?', req.params.id);
    if (!s) return errors.sendError(res, 'NOT_FOUND');
    const b = req.body || {};
    const isBase = s.id === 'SV-03';
    const feeKey = isBase && has(b, 'feeBase') ? 'feeBase' : 'fee';
    const upd = {}; // คอลัมน์ → ค่าใหม่
    if (has(b, feeKey)) {
      const v = toInt(b[feeKey]);
      if (v == null || v < 0 || v > 100000) return errors.sendError(res, 'INVALID_FEE');
      upd.fee = v;
    }
    if (isBase && has(b, 'feePerSqm')) {
      const v = toInt(b.feePerSqm);
      if (v == null || v < 0 || v > 100000) return errors.sendError(res, 'INVALID_FEE');
      upd.fee_per_sqm = v;
    }
    if (has(b, 'sla')) {
      const v = toInt(b.sla);
      if (v == null || v < 1 || v > 60) return errors.sendError(res, 'INVALID_SLA');
      upd.sla_days = v;
    }
    if (!Object.keys(upd).length) return errors.sendError(res, 'BAD_REQUEST');

    const names = { fee: 'fee', fee_per_sqm: 'feePerSqm', sla_days: 'sla' };
    const changes = Object.entries(upd).filter(([col, v]) => s[col] !== v);
    db.tx(() => {
      for (const [col, v] of changes) db.run(`UPDATE services SET ${col} = ? WHERE id = ?`, v, s.id); // col มาจากชุดคงที่ข้างบน
      if (changes.length) log(req, changes.map(([col, v]) => `${s.id} ${names[col]} ${s[col]} → ${v}`).join('; '));
    });
    return res.json(svcJson(db.get('SELECT * FROM services WHERE id = ?', s.id)));
  });

  // ================= วันหยุด =================
  const listHolidays = () => db.all('SELECT date, name FROM holidays ORDER BY date');
  const validDate = (d) => {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const [y, m, dd] = d.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd;
  };

  app.get('/api/admin/holidays', admin, (req, res) => res.json({ items: listHolidays() }));

  app.post('/api/admin/holidays', admin, (req, res) => {
    const date = req.body && typeof req.body.date === 'string' ? req.body.date.trim() : '';
    const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!validDate(date)) return errors.sendError(res, 'BAD_REQUEST');
    let out;
    db.tx(() => {
      if (db.get('SELECT 1 AS x FROM holidays WHERE date = ?', date)) { out = 'DUP'; return; }
      db.run('INSERT INTO holidays(date, name) VALUES (?, ?)', date, name || 'วันหยุดพิเศษ');
      log(req, `holiday add ${date}`);
      out = 'OK';
    });
    if (out === 'DUP') return errors.sendError(res, 'DUPLICATE_HOLIDAY');
    return res.status(201).json({ date, name: name || 'วันหยุดพิเศษ' });
  });

  app.delete('/api/admin/holidays/:date', admin, (req, res) => {
    const date = req.params.date;
    let removed = 0;
    db.tx(() => {
      removed = db.run('DELETE FROM holidays WHERE date = ?', date).changes;
      if (removed) log(req, `holiday delete ${date}`);
    });
    if (!removed) return errors.sendError(res, 'NOT_FOUND');
    return res.json({ ok: true });
  });

  // ================= ผู้ใช้ =================
  const userJson = (u) => ({ username: u.username, name: u.display_name, role: u.role, dept: u.dept || '', active: !!u.active });
  const listUsers = () => db.all('SELECT username, display_name, role, dept, active FROM users ORDER BY rowid');

  app.get('/api/admin/users', admin, (req, res) => res.json({ items: listUsers().map(userJson) }));

  app.put('/api/admin/users/:username', admin, (req, res) => {
    // ผู้ดูแลแก้บัญชีตัวเองไม่ได้ (§6.5)
    if (req.params.username === req.user.username) return errors.sendError(res, 'SELF_ROLE_CHANGE');
    const u = db.get('SELECT * FROM users WHERE username = ?', req.params.username);
    if (!u) return errors.sendError(res, 'NOT_FOUND');
    const b = req.body || {};
    const role = has(b, 'role') ? b.role : u.role;
    if (typeof role !== 'string' || !ROLES.includes(role)) return errors.sendError(res, 'BAD_REQUEST');
    let dept = has(b, 'dept') ? b.dept : (b.dept === '' ? '' : (u.dept || ''));
    if (typeof dept !== 'string') return errors.sendError(res, 'BAD_REQUEST');
    if (dept && !DEPTS.includes(dept)) return errors.sendError(res, 'BAD_REQUEST');
    if (role === 'officer' && !dept) return errors.sendError(res, 'BAD_REQUEST');
    if (role !== 'officer') dept = ''; // เฉพาะเจ้าหน้าที่มีสังกัดแผนก
    const changes = [];
    if (role !== u.role) changes.push(`${u.username} role ${u.role} → ${role}`);
    if (dept !== (u.dept || '')) changes.push(`${u.username} dept ${u.dept || '-'} → ${dept || '-'}`);
    db.tx(() => {
      if (changes.length) {
        db.run('UPDATE users SET role = ?, dept = ? WHERE username = ?', role, dept || null, u.username);
        log(req, changes.join('; '));
      }
    });
    return res.json(userJson(db.get('SELECT username, display_name, role, dept, active FROM users WHERE username = ?', u.username)));
  });

  // ================= หน้า =================
  const adminJs = '/static/mgmt/admin.js';
  const path = require('node:path');
  app.use('/static/mgmt', ctx.express.static(path.join(__dirname, 'static')));

  app.get('/admin/services', admin, (req, res) => {
    const rows = listServices();
    const body = html`<p class="muted">ค่าธรรมเนียมเป็นจำนวนเต็ม 0–100,000 บาท · SLA เป็นจำนวนเต็ม 1–60 วันทำการ · ค่าที่แก้มีผลกับคำขอใหม่เท่านั้น (ยอดที่ล็อกแล้วไม่เปลี่ยน)</p>
      <div class="table-wrap" data-label="บริการ"><table class="data">
        <thead><tr><th scope="col">บริการ</th><th scope="col">ค่าธรรมเนียม (บาท)</th><th scope="col">ต่อ ตร.ม. ส่วนเกิน 100 (บาท)</th><th scope="col">SLA (วันทำการ)</th><th scope="col">บันทึก</th></tr></thead>
        <tbody>${rows.map((s) => html`<tr data-testid="service-row" data-service-id="${s.id}">
          <td>${catalog.serviceLabel(s.id)}<br><span class="muted">${s.id === 'SV-01' ? 'ต่อฉบับ' : s.id === 'SV-03' ? 'ฐาน (พื้นที่ 1–100 ตร.ม.)' : 'คงที่'}</span></td>
          <td><label class="sr-only" for="svc-fee-${s.id}">ค่าธรรมเนียม ${s.id}</label>
            <input id="svc-fee-${s.id}" type="number" step="1" data-testid="svc-fee-${s.id}" value="${s.fee}"></td>
          <td>${s.fee_per_sqm == null ? raw('<span class="muted">–</span>') : html`<label class="sr-only" for="svc-fee-per-sqm-${s.id}">ค่าธรรมเนียมต่อ ตร.ม. ${s.id}</label>
            <input id="svc-fee-per-sqm-${s.id}" type="number" step="1" data-testid="svc-fee-per-sqm-${s.id}" value="${s.fee_per_sqm}">`}</td>
          <td><label class="sr-only" for="svc-sla-${s.id}">SLA ${s.id}</label>
            <input id="svc-sla-${s.id}" type="number" step="1" data-testid="svc-sla-${s.id}" value="${s.sla_days}"></td>
          <td><button type="button" class="btn btn-small" data-testid="svc-save-${s.id}" data-save-service="${s.id}">บันทึก ${s.id}</button></td>
        </tr>`)}</tbody></table></div>`;
    layout.send(res, { req, title: 'จัดการบริการ', body, wide: true, scripts: [adminJs] });
  });

  function holidayListHtml() {
    const rows = listHolidays();
    return html`<div id="holiday-list" class="table-wrap" data-label="วันหยุด"><table class="data">
      <thead><tr><th scope="col">วันที่</th><th scope="col">ชื่อวันหยุด</th><th scope="col">จัดการ</th></tr></thead>
      <tbody>${rows.map((h) => html`<tr data-testid="holiday-row" data-date="${h.date}">
        <td>${format.thaiDate(h.date)} <span class="muted">(${h.date})</span></td><td>${h.name}</td>
        <td><button type="button" class="btn btn-danger btn-small" data-testid="holiday-delete-btn" data-delete-holiday="${h.date}">ลบ <span class="sr-only">${h.date}</span></button></td>
      </tr>`)}</tbody></table></div>`;
  }

  app.get('/admin/holidays', admin, (req, res) => {
    if (req.query.partial === '1') return res.type('html').send(holidayListHtml().toString());
    const body = html`<form class="card" id="holiday-form" novalidate>
        <div class="grid">
          <div class="form-row"><label for="holiday-date-input">วันที่ (YYYY-MM-DD ค.ศ.)</label>
            <input id="holiday-date-input" type="date" data-testid="holiday-date-input"></div>
          <div class="form-row"><label for="holiday-name-input">ชื่อวันหยุด</label>
            <input id="holiday-name-input" type="text" data-testid="holiday-name-input" autocomplete="off"></div>
        </div>
        <button type="submit" class="btn" data-testid="holiday-add-btn">เพิ่มวันหยุด</button>
      </form>
      ${holidayListHtml()}`;
    layout.send(res, { req, title: 'จัดการวันหยุด', body, wide: true, scripts: [adminJs] });
  });

  app.get('/admin/users', admin, (req, res) => {
    const rows = listUsers();
    const body = html`<p class="muted">บทบาทที่เปลี่ยนมีผลเมื่อผู้ใช้ล็อกอินครั้งถัดไป · ไม่สามารถเปลี่ยนบทบาทของตัวเองได้</p>
      <div class="table-wrap" data-label="ผู้ใช้และบทบาท"><table class="data">
        <thead><tr><th scope="col">ผู้ใช้</th><th scope="col">บทบาท</th><th scope="col">แผนก</th><th scope="col">บันทึก</th></tr></thead>
        <tbody>${rows.map((u) => html`<tr data-testid="user-row" data-username="${u.username}">
          <td>${u.display_name} <span class="muted">(${u.username})</span></td>
          <td><label class="sr-only" for="role-${u.username}">บทบาทของ ${u.username}</label>
            <select id="role-${u.username}" data-testid="user-role-select">${ROLES.map((r) => html`<option value="${r}"${r === u.role ? raw(' selected') : ''}>${r} · ${ROLE_TH[r]}</option>`)}</select></td>
          <td><label class="sr-only" for="dept-${u.username}">แผนกของ ${u.username}</label>
            <select id="dept-${u.username}" data-testid="user-dept-select"><option value=""${!u.dept ? raw(' selected') : ''}>(ไม่มี)</option>${DEPTS.map((d) => html`<option value="${d}"${d === u.dept ? raw(' selected') : ''}>${d} · ${format.DEPT_TH[d]}</option>`)}</select></td>
          <td><button type="button" class="btn btn-small" data-testid="user-save-btn" data-save-user="${u.username}">บันทึก <span class="sr-only">${u.username}</span></button></td>
        </tr>`)}</tbody></table></div>`;
    layout.send(res, { req, title: 'จัดการผู้ใช้/บทบาท', body, wide: true, scripts: [adminJs] });
  });

};
