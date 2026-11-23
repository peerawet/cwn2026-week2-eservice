'use strict';
// โครงหน้า HTML กลาง (CONTRACT §2.1) · lang="th" · landmark header/nav/main/footer · skip link
// ทุกหน้ามี action-error (role=alert) และ action-success "อย่างละ 1 ตัว" ที่นี่ — โมดูลห้าม render ซ้ำ
// ตั้งข้อความฝั่งเซิร์ฟเวอร์ด้วย opts.error / opts.success หรือฝั่ง browser ด้วย EG.showError()/EG.showSuccess()

const db = require('./db');
const { html, raw, esc, ROLE_TH } = require('./format');

const APP_NAME = 'e-Service เทศบาลนครตัวอย่าง';

// เมนูตามบทบาท (CONTRACT §2.1: แสดงเฉพาะบทบาทที่เข้าหน้านั้นได้)
const NAV = {
  citizen: [['nav-my-cases', '/citizen', 'คำขอของฉัน']],
  officer: [['nav-queue', '/officer/queue', 'คิวงาน'], ['nav-bell', '/notifications', 'แจ้งเตือน']],
  head: [['nav-queue', '/officer/queue', 'คิวงาน'], ['nav-approvals', '/head/approvals', 'รออนุมัติ'], ['nav-bell', '/notifications', 'แจ้งเตือน']],
  executive: [['nav-dashboard', '/dashboard', 'Dashboard']],
  auditor: [['nav-audit', '/audit', 'Audit Trail']],
  admin: [['nav-admin-services', '/admin/services', 'บริการ'], ['nav-admin-holidays', '/admin/holidays', 'วันหยุด'], ['nav-admin-users', '/admin/users', 'ผู้ใช้/บทบาท']],
};

/** จำนวนแจ้งเตือนทั้งหมดของผู้ใช้ (bell-count · A-30 ไม่มีสถานะอ่านแล้ว) */
function bellCount(username) {
  const r = db.get('SELECT COUNT(*) AS n FROM notifications WHERE username = ?', username);
  return r ? Number(r.n) : 0;
}

function navHtml(user, currentPath) {
  const items = NAV[user.role] || [];
  return html`<nav class="app-nav" aria-label="เมนูหลัก"><ul>${items.map(([tid, href, label]) => {
    const cur = currentPath === href || (href !== '/' && currentPath && currentPath.startsWith(href + '/'));
    if (tid === 'nav-bell') {
      const n = bellCount(user.username);
      return html`<li><a data-testid="nav-bell" href="${href}"${cur ? raw(' aria-current="page"') : ''}>${label} <span class="count" data-testid="bell-count">${n}</span></a></li>`;
    }
    return html`<li><a data-testid="${tid}" href="${href}"${cur ? raw(' aria-current="page"') : ''}>${label}</a></li>`;
  })}</ul></nav>`;
}

function headerHtml(user, currentPath) {
  const who = user ? html`
    ${navHtml(user, currentPath)}
    <div class="who">
      <span class="who-name" data-testid="user-name">${user.name}</span>
      <span class="who-role" data-testid="user-role" data-role="${user.role}"${user.dept ? raw(` data-dept="${esc(user.dept)}"`) : ''}>${ROLE_TH[user.role] || user.role}</span>
      <form method="post" action="/logout" class="logout-form"><button type="submit" class="btn btn-small btn-light" data-testid="logout-btn">ออกจากระบบ</button></form>
    </div>` : '';
  return html`<header class="app-header" data-testid="app-header">
    <a class="skip-link" href="#main">ข้ามไปเนื้อหาหลัก</a>
    <div class="brand"><a href="/">${APP_NAME}</a> <span class="demo-tag">ระบบจำลองเพื่อการทดสอบ</span></div>
    ${who}
  </header>`;
}

/**
 * สร้างหน้า HTML ทั้งหน้า → string
 * opts: {
 *   req            (ใช้ req.user และ req.path) หรือ user (ระบุเอง; null = ไม่แสดงข้อมูลผู้ใช้)
 *   title          ข้อความใน <title> และ <h1> (ถ้าไม่ปิด h1)
 *   h1             false = ไม่ render <h1> ให้ (หน้า render เอง) · string = ข้อความ h1 ต่างจาก title
 *   body           SafeHtml/string ของเนื้อหา (string ถือว่าเป็น HTML ที่ปลอดภัยแล้ว)
 *   error/success  ข้อความแสดงใน action-error/action-success ตั้งแต่โหลดหน้า
 *   head           HTML เพิ่มใน <head> (เช่น <link>/<style>)
 *   scripts        ['/static/citizen/x.js'] โหลดแบบ defer หลัง /static/app.js
 *   inlineScript   สคริปต์ inline ท้ายหน้า (string)
 *   wide           true = main กว้างขึ้น (ตาราง)
 * }
 */
function page(opts = {}) {
  const user = opts.user !== undefined ? opts.user : (opts.req && opts.req.user) || null;
  const currentPath = opts.req ? opts.req.path : '';
  const title = opts.title || APP_NAME;
  const h1 = opts.h1 === false ? '' : html`<h1>${opts.h1 || title}</h1>`;
  const body = opts.body == null ? '' : raw(opts.body);
  const scripts = (opts.scripts || []).map((s) => html`<script src="${s}" defer></script>`);
  return '<!doctype html>\n' + html`<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${APP_NAME}</title>
<link rel="stylesheet" href="/static/app.css">
${opts.head ? raw(opts.head) : ''}
</head>
<body>
${headerHtml(user, currentPath)}
<main id="main" tabindex="-1" class="${opts.wide ? 'wide' : ''}">
  <div class="messages">
    <div data-testid="action-error" role="alert" class="msg msg-error"${opts.error ? '' : raw(' hidden')}>${opts.error || ''}</div>
    <div data-testid="action-success" role="status" class="msg msg-success"${opts.success ? '' : raw(' hidden')}>${opts.success || ''}</div>
  </div>
  ${h1}
  ${body}
</main>
<footer class="app-footer"><p>${APP_NAME} · หน่วยงานสมมติ · ThaiD / PromptPay / ลายเซ็นดิจิทัลเป็นตัวจำลอง</p></footer>
<script src="/static/app.js" defer></script>
${scripts}
${opts.inlineScript ? raw(`<script>${opts.inlineScript}</script>`) : ''}
</body>
</html>`.toString();
}

/** ส่งหน้า: send(res, { req, title, body, ... }, status=200) */
function send(res, opts, status = 200) {
  res.status(status).type('html').send(page(opts));
}

/** 403 หน้าเว็บ: forbidden-msg = 'ไม่มีสิทธิ์เข้าถึงหน้านี้' */
function sendForbidden(req, res) {
  send(res, {
    req, title: 'ไม่มีสิทธิ์เข้าถึง', h1: 'ไม่มีสิทธิ์เข้าถึง',
    body: html`<p class="notice" data-testid="forbidden-msg">ไม่มีสิทธิ์เข้าถึงหน้านี้</p><p><a href="/">กลับหน้าแรก</a></p>`,
  }, 403);
}

/** 404 ของคำขอ (ไม่มีจริง/ของคนอื่น ใช้หน้าเดียวกัน · ห้ามเผยข้อมูลคำขอ): not-found-msg = 'ไม่พบคำขอ' */
function sendCaseNotFound(req, res) {
  send(res, {
    req, title: 'ไม่พบคำขอ', h1: 'ไม่พบคำขอ',
    body: html`<p class="notice" data-testid="not-found-msg">ไม่พบคำขอ</p><p><a href="/">กลับหน้าแรก</a></p>`,
  }, 404);
}

/** 404 หน้าทั่วไป (route ที่ไม่มี) */
function sendNotFound(req, res) {
  send(res, {
    req, title: 'ไม่พบหน้า', h1: 'ไม่พบหน้า',
    body: html`<p class="notice" data-testid="page-not-found">ไม่พบหน้าที่ต้องการ</p><p><a href="/">กลับหน้าแรก</a></p>`,
  }, 404);
}

module.exports = { APP_NAME, NAV, bellCount, page, send, sendForbidden, sendCaseNotFound, sendNotFound };
