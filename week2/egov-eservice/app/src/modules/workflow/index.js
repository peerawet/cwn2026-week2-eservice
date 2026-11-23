'use strict';
// โมดูล workflow (B03): คิวงาน · หน้าคำขอเจ้าหน้าที่ · รออนุมัติ · แจ้งเตือน · API รับเรื่อง/ตีกลับ/ส่งต่อ/อนุมัติ/ไม่อนุมัติ/ส่งแก้ไข
// + hook beforeRequest: ยกเลิกอัตโนมัติเมื่อเลย 168 ชม. และประเมินแจ้งเตือน SLA ทุก request (CONTRACT §0 ข้อ 7)
// BUG_MODE: B04 B07 B08 B09 B12 (ดูหมายเหตุในจุดที่ใช้ — logic.js / ด้านล่าง B09)

const path = require('node:path');
const QRCode = require('qrcode');
const createLogic = require('./logic');
const createViews = require('./views');

exports.register = (app, ctx) => {
  const { session, errors, cases, bugs, sla, format } = ctx;
  const { requireRole } = session;
  const logic = createLogic(ctx);
  const views = createViews(ctx, logic);
  const staff = requireRole('officer', 'head');

  app.use('/static/workflow', ctx.express.static(path.join(__dirname, 'static'), { maxAge: 0 }));

  // ---------- hook: ทุก request ----------
  ctx.hooks.beforeRequest(() => { logic.tick(); });

  // ---------- หน้า ----------
  app.get('/officer/queue', staff, (req, res) => {
    const f = String(req.query.filter || 'all');
    const filter = ['all', 'unclaimed', 'mine'].includes(f) ? f : 'all';
    res.status(200).type('html').send(views.queuePage(req, filter));
  });

  app.get('/officer/cases/:caseNo', staff, errors.wrap(async (req, res) => {
    const row = logic.findCase(req.params.caseNo);
    if (!row) return ctx.layout.sendCaseNotFound(req, res);
    let qr = null;
    if (row.doc_no) {
      const code = cases.verifyCodeOf(row);
      if (code) {
        const url = `${ctx.baseUrl(req)}/verify/${code}`;
        qr = { url, dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 140 }) };
      }
    }
    res.status(200).type('html').send(views.casePage(req, row, qr));
  }));

  app.get('/head/approvals', requireRole('head'), (req, res) => {
    res.status(200).type('html').send(views.approvalsPage(req));
  });

  app.get('/notifications', staff, (req, res) => {
    res.status(200).type('html').send(views.notificationsPage(req));
  });

  // ---------- API: คิว (CONTRACT §6.3) ----------
  app.get('/api/officer/queue', staff, (req, res) => {
    const f = String(req.query.filter || 'all');
    const filter = ['all', 'unclaimed', 'mine'].includes(f) ? f : 'all';
    const now = ctx.clock.now();
    const items = logic.queueRows(req.user, filter).map((r) => {
      const it = {
        caseNo: r.case_no,
        serviceId: r.service_id,
        applicantName: r.applicant_name,
        idMasked: cases.applicantIdMasked(r),
        status: r.status,
        step: r.service_id === 'SV-03' ? (r.step || null) : null,
        owner: r.owner || null,
        dueAt: r.due_at,
        slaLevel: sla.levelOf(r, now),
      };
      // B09: ส่งเลขบัตรเต็มใน JSON ของคิว (หน้าจอยังปิดบัง) — ละเมิด BR-24
      if (bugs.isOn('B09')) it.idNo = cases.applicantIdNo(r);
      return it;
    });
    res.json({ items });
  });

  // ---------- API: รับเรื่อง / ตีกลับ / ส่งต่อ ----------
  app.post('/api/officer/cases/:caseNo/claim', staff, (req, res) => res.json(logic.claim(req.user, req.params.caseNo)));
  app.post('/api/officer/cases/:caseNo/return', staff, (req, res) => res.json(logic.returnCase(req.user, req.params.caseNo, req.body)));
  app.post('/api/officer/cases/:caseNo/forward', staff, (req, res) => res.json(logic.forward(req.user, req.params.caseNo, req.body)));

  // ---------- API: อนุมัติ / ไม่อนุมัติ ----------
  app.post('/api/cases/:caseNo/approve', staff, (req, res) => res.json(logic.approve(req.user, req.params.caseNo)));
  app.post('/api/cases/:caseNo/reject', staff, (req, res) => res.json(logic.reject(req.user, req.params.caseNo, req.body)));

  // ---------- API: ส่งแก้ไข (ประชาชนเจ้าของ · multipart ไม่บังคับ) ----------
  app.post('/api/cases/:caseNo/resubmit', requireRole('citizen'), ctx.upload.any(), (req, res) => {
    const files = (req.files || []).map((f) => ({
      originalname: f.originalname, buffer: f.buffer, size: f.size,
      docKey: f.fieldname !== 'file' && f.fieldname !== 'files' ? f.fieldname.replace(/^upload-input-/, '') : (req.body && req.body.docKey),
    }));
    res.json(logic.resubmit(req.user, req.params.caseNo, files));
  });

  // ---------- API: แจ้งเตือน ----------
  app.get('/api/notifications', staff, (req, res) => {
    res.json({
      items: logic.notificationsOf(req.user.username).map((n) => ({
        id: n.id, caseNo: n.case_no, level: n.level, text: n.text, createdAt: n.created_at,
      })),
    });
  });

  void format;
};
