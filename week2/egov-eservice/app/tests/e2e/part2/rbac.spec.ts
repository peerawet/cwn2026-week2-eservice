/**
 * หมวด RBAC (TEST-PLAN §15) · TC-RBAC-01 … 06
 * บั๊กที่ต้องจับ: B06 (IDOR) → TC-RBAC-01 · B07 (เจ้าหน้าที่อนุมัติ SV-02 เอง) → TC-RBAC-02 (ยิง API ตรง ไม่ใช่แค่ดูปุ่ม)
 */
import {
  test,
  expect,
  CIT,
  MSG,
  ARROW,
  cn,
  row,
  attrList,
  expectStatus,
  approveApi,
  rejectApi,
  claimApi,
  getCase,
  captureFile,
  auditRowsFor,
  type Actor,
  type Lab,
} from './helpers';

// ───────────── TC-RBAC-01 ─────────────

test('TC-RBAC-01 · ประชาชนเปิดคำขอคนอื่นไม่ได้ (IDOR)', async ({ lab }) => {
  await lab.reset();
  const sy = await lab.citizen(CIT.somying);

  await test.step('UI /citizen/cases/…000005 (ของสมชาย) → 404 ไม่พบคำขอ', async () => {
    const res = await sy.open(`/citizen/cases/${cn(5)}`);
    expect(res?.status()).toBe(404);
    await expect(sy.tid('not-found-msg')).toHaveText(MSG.notFound);
    await expect(sy.tid('case-no')).toHaveCount(0);
    await expect(sy.tid('case-status')).toHaveCount(0);
    expect((await sy.page.content()).includes('สมชาย'), 'HTML มีชื่อสมชาย').toBe(false);
  });

  await test.step('API ของคนอื่น / ไม่มีจริง → 404 เนื้อหาเหมือนกันทุกตัวอักษร', async () => {
    const other = await sy.api.get(`/api/cases/${cn(5)}`);
    const otherText = await other.text();
    expect(other.status(), otherText).toBe(404);
    expect(JSON.parse(otherText)).toEqual({ code: 'NOT_FOUND', message: MSG.notFound });
    const none = await sy.api.get('/api/cases/EG-2569-999999');
    expect(none.status()).toBe(404);
    expect(await none.text(), 'เลขไม่มีจริงต้องตอบเหมือนเลขของคนอื่น').toBe(otherText);
    await expectStatus(await sy.api.get('/api/documents/DOC-2569-000001/pdf'), 404, undefined, 'PDF ของสมชาย');
    await expectStatus(await sy.api.get('/api/drafts/DR-0001'), 404, undefined, 'ร่างของสมชาย');
    await expectStatus(await sy.api.post(`/api/cases/${cn(30)}/cancel`, { data: {} }), 404, undefined, 'ยกเลิกคำขอของสมชาย');
  });

  await test.step('ของตัวเอง → 200', async () => {
    const res = await sy.open(`/citizen/cases/${cn(7)}`);
    expect(res?.status()).toBe(200);
    await expect(sy.tid('case-no')).toHaveText(cn(7));
    const sc = await lab.citizen(CIT.somchai);
    await expectStatus(await sc.api.get(`/api/cases/${cn(5)}`), 200, undefined, 'สมชาย GET ของตัวเอง');
  });
});

// ───────────── TC-RBAC-02 ─────────────

test('TC-RBAC-02 · เจ้าหน้าที่อนุมัติ SV-02 ไม่ได้ (ตรวจที่ API)', async ({ lab }) => {
  await lab.reset();
  const reg2 = await lab.staff('off.reg2');

  await test.step('1 off.reg2 approve …000014 (SV-02 PENDING_APPROVAL) → 403 · สถานะเดิม', async () => {
    await expectStatus(await approveApi(reg2, cn(14)), 403, 'FORBIDDEN', 'off.reg2 approve …000014');
    expect((await getCase(reg2, cn(14))).status).toBe('PENDING_APPROVAL');
  });
  await test.step('2 off.reg2 approve …000013 (SV-02 ที่ตัวเองถือ) → 403 · ยัง IN_REVIEW', async () => {
    await expectStatus(await approveApi(reg2, cn(13)), 403, undefined, 'off.reg2 approve …000013');
    expect((await getCase(reg2, cn(13))).status).toBe('IN_REVIEW');
  });
  await test.step('3 off.reg2 reject …000014 → 403 · สถานะเดิม', async () => {
    await expectStatus(await rejectApi(reg2, cn(14), 'xxxxxxxxxx'), 403, undefined, 'off.reg2 reject …000014');
    expect((await getCase(reg2, cn(14))).status).toBe('PENDING_APPROVAL');
  });
  await test.step('4 UI …000013 และ …000014 ไม่มี approve-btn', async () => {
    for (const n of [13, 14]) {
      await reg2.open(`/officer/cases/${cn(n)}`);
      await expect(reg2.tid('approve-btn'), `approve-btn ${cn(n)}`).toHaveCount(0);
    }
  });
  const head = await lab.staff('head1');
  await test.step('5 head1 approve SV-01 …000025 → 403', async () => {
    await expectStatus(await approveApi(head, cn(25)), 403, undefined, 'head1 approve …000025');
  });
  await test.step('6 head1 approve …000014 → 200 APPROVED (ตัวควบคุมบวก)', async () => {
    const j = await expectStatus(await approveApi(head, cn(14)), 200, undefined, 'head1 approve …000014');
    expect(j?.status).toBe('APPROVED');
  });
  await test.step('7 audit1 APPROVE = 1 แถวของ head1 เท่านั้น', async () => {
    const auditor = await lab.staff('audit1');
    const rows = await auditRowsFor(auditor, { event: 'APPROVE' }, 1, 'APPROVE');
    expect(rows[0].actor).toBe('head1');
    expect(rows.some((r) => r.actor === 'off.reg2')).toBe(false);
  });
});

// ───────────── TC-RBAC-03 ─────────────

type Role = 'anon' | 'citizen' | 'officer' | 'head' | 'executive' | 'auditor' | 'admin';
const ROLES: Role[] = ['anon', 'citizen', 'officer', 'head', 'executive', 'auditor', 'admin'];
type PageExp = 'ok' | '403' | 'login';

/** ส่วน A: [หน้า, ผลตามลำดับ ROLES] */
const PAGE_TABLE: [string, PageExp[]][] = [
  ['/citizen', ['login', 'ok', '403', '403', '403', '403', '403']],
  ['/officer/queue', ['login', '403', 'ok', 'ok', '403', '403', '403']],
  ['/head/approvals', ['login', '403', '403', 'ok', '403', '403', '403']],
  ['/dashboard', ['login', '403', '403', '403', 'ok', '403', '403']],
  ['/audit', ['login', '403', '403', '403', '403', 'ok', '403']],
  ['/admin/services', ['login', '403', '403', '403', '403', '403', 'ok']],
  ['/admin/holidays', ['login', '403', '403', '403', '403', '403', 'ok']],
  ['/admin/users', ['login', '403', '403', '403', '403', '403', 'ok']],
  ['/notifications', ['login', '403', 'ok', 'ok', '403', '403', '403']],
  ['/verify/K7M2Q9XA', ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']],
];

/** ส่วน B: [method, path, body, ผลตามลำดับ ROLES] · แถว claim อยู่ท้ายสุดเสมอ */
const API_TABLE: [string, string, unknown, number[]][] = [
  ['GET', '/api/officer/queue', undefined, [401, 403, 200, 200, 403, 403, 403]],
  ['GET', '/api/notifications', undefined, [401, 403, 200, 200, 403, 403, 403]],
  ['GET', '/api/dashboard?period=2026-12&service=ALL', undefined, [401, 403, 403, 403, 200, 403, 403]],
  ['GET', '/api/audit', undefined, [401, 403, 403, 403, 403, 200, 403]],
  ['GET', '/api/admin/services', undefined, [401, 403, 403, 403, 403, 403, 200]],
  ['POST', '/api/drafts', { serviceId: 'SV-01', qty: 1 }, [401, 201, 403, 403, 403, 403, 403]],
  ['GET', `/api/cases/${cn(25)}`, undefined, [401, 200, 200, 200, 403, 403, 403]],
  ['POST', `/api/officer/cases/${cn(28)}/claim`, {}, [401, 403, 200, 403, 403, 403, 403]],
];

const NAV_ALL = [
  'nav-my-cases',
  'nav-queue',
  'nav-approvals',
  'nav-dashboard',
  'nav-audit',
  'nav-admin-services',
  'nav-admin-holidays',
  'nav-admin-users',
  'nav-bell',
];
const NAV_OF: Record<Exclude<Role, 'anon'>, [string, string[]]> = {
  citizen: ['/citizen', ['nav-my-cases']],
  officer: ['/officer/queue', ['nav-queue', 'nav-bell']],
  head: ['/head/approvals', ['nav-queue', 'nav-approvals', 'nav-bell']],
  executive: ['/dashboard', ['nav-dashboard']],
  auditor: ['/audit', ['nav-audit']],
  admin: ['/admin/services', ['nav-admin-services', 'nav-admin-holidays', 'nav-admin-users']],
};

async function loginRole(lab: Lab, role: Role): Promise<Actor> {
  switch (role) {
    case 'anon':
      return lab.anon('anon');
    case 'citizen':
      return lab.citizen(CIT.somchai);
    case 'officer':
      return lab.staff('off.reg1');
    case 'head':
      return lab.staff('head1');
    case 'executive':
      return lab.staff('exec1');
    case 'auditor':
      return lab.staff('audit1');
    case 'admin':
      return lab.staff('admin1');
  }
}

test('TC-RBAC-03 · ตารางสิทธิ์หน้า/API ตามบทบาท', async ({ lab }) => {
  test.setTimeout(360_000);

  for (const [ri, role] of ROLES.entries()) {
    await test.step(`บทบาท ${role} (RESET ก่อน)`, async () => {
      await lab.reset();
      const a = await loginRole(lab, role);

      // ส่วน A หน้า
      for (const [p, exps] of PAGE_TABLE) {
        const exp = exps[ri];
        const res = await a.open(p);
        const finalPath = new URL(a.page.url()).pathname;
        const label = `${role} ${p}`;
        if (exp === 'ok') {
          expect.soft(res?.status(), `${label} ต้อง 200`).toBe(200);
          expect.soft(finalPath, `${label} ต้องไม่ redirect`).toBe(p);
        } else if (exp === 'login') {
          expect.soft(finalPath, `${label} ต้อง redirect /login`).toBe('/login');
        } else {
          expect.soft(res?.status(), `${label} ต้อง 403`).toBe(403);
          await expect.soft(a.tid('forbidden-msg'), `${label} forbidden-msg`).toHaveText(MSG.forbiddenPage);
        }
      }

      // ส่วน B API (citizen แถว /api/cases/…000025 ใช้สมหญิงเป็นตัวแทน)
      const somying = role === 'citizen' ? await lab.citizen(CIT.somying) : undefined;
      for (const [method, p, body, exps] of API_TABLE) {
        const caller = role === 'citizen' && p === `/api/cases/${cn(25)}` ? somying! : a;
        const res = method === 'GET' ? await caller.api.get(p) : await caller.api.post(p, { data: body ?? {} });
        expect.soft(res.status(), `${role} ${method} ${p} → ${(await res.text()).slice(0, 200)}`).toBe(exps[ri]);
      }

      // ส่วน D เมนู
      if (role !== 'anon') {
        const [landing, navs] = NAV_OF[role];
        await a.open(landing);
        for (const n of NAV_ALL) {
          const c = await a.tid(n).count();
          if (navs.includes(n)) expect.soft(c, `${role} ต้องมี ${n}`).toBeGreaterThan(0);
          else expect.soft(c, `${role} ต้องไม่มี ${n}`).toBe(0);
        }
      }
    });
  }

  await test.step('ส่วน C ขอบเขตแผนก (RESET)', async () => {
    await lab.reset();
    const works = await lab.staff('off.works1');
    const reg1 = await lab.staff('off.reg1');
    await expectStatus(await claimApi(works, cn(28)), 403, undefined, 'off.works1 claim คำขอทะเบียน …000028');
    await expectStatus(await claimApi(reg1, cn(10)), 403, undefined, 'off.reg1 claim คำขอโยธา …000010');
    const q = await expectStatus(await works.api.get('/api/officer/queue?filter=all'), 200, undefined, 'off.works1 queue');
    expect((q.items ?? []).map((x: any) => x.caseNo)).toEqual([cn(10)]);
    await works.open('/officer/queue');
    await expect(works.tid('queue-row')).toHaveCount(1);
    expect(await attrList(works.tid('queue-row'), 'data-case-no')).toEqual([cn(10)]);
  });
});

// ───────────── TC-RBAC-04 ─────────────

test('TC-RBAC-04 · ผู้ดูแลระบบ: บริการ วันหยุด ผู้ใช้ และยอดที่ล็อก', async ({ lab }) => {
  test.setTimeout(180_000);
  const T0 = '2026-12-01T09:00:00+07:00';
  await lab.reset();
  const admin = await lab.staff('admin1');
  admin.page.on('dialog', (d) => d.accept().catch(() => {}));
  let sc!: Actor;
  let c31 = '';

  await test.step('1 /admin/holidays = 4 วัน', async () => {
    await admin.open('/admin/holidays');
    await expect(admin.tid('holiday-row')).toHaveCount(4);
    expect((await attrList(admin.tid('holiday-row'), 'data-date')).sort()).toEqual(['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']);
  });

  await test.step('2 ก่อนแก้: NEW_PAID SV-01 qty 1 (฿20) → …000031 · dueAt 4 ธ.ค. 16:30', async () => {
    const r = await lab.newPaid({ service: 'SV-01', at: T0, qty: 1, expectFee: 20 });
    sc = r.citizen;
    c31 = r.caseNo;
    expect(c31).toBe(cn(31));
    expect((await getCase(sc, c31)).dueAt).toBe('2026-12-04T16:30:00+07:00');
  });

  await test.step('3 admin ตั้ง SV-01 = 25 และ SV-02 = 600 บนจอ', async () => {
    await admin.open('/admin/services');
    await admin.tid('svc-fee-SV-01').fill('25');
    await admin.tid('svc-save-SV-01').click();
    await expect(admin.tid('action-success')).toBeVisible();
    await expect
      .poll(async () => ((await admin.api.get('/api/admin/services').then((r) => r.json())).items ?? []).find((s: any) => s.id === 'SV-01')?.fee)
      .toBe(25);
    await admin.tid('svc-fee-SV-02').fill('600');
    await admin.tid('svc-save-SV-02').click();
    await expect(admin.tid('action-success')).toBeVisible();
    await expect
      .poll(async () => ((await admin.api.get('/api/admin/services').then((r) => r.json())).items ?? []).find((s: any) => s.id === 'SV-02')?.fee)
      .toBe(600);
  });

  await test.step('4 สมชายร่างใหม่ใช้ค่าใหม่ · คำขอเดิม …000030 ยัง ฿20', async () => {
    await sc.open('/citizen/new/SV-01');
    await sc.tid('qty-input').fill('5');
    await expect(sc.tid('fee-total')).toHaveText('฿125');
    await sc.tid('qty-input').fill('1');
    await expect(sc.tid('fee-total')).toHaveText('฿25');
    await sc.open('/citizen/new/SV-02');
    await expect(sc.tid('fee-total')).toHaveText('฿600');
    await sc.open(`/citizen/cases/${cn(30)}`);
    await expect(sc.tid('case-fee')).toHaveText('฿20');
  });

  await test.step('5 PP-0001 (DR-0002) ยอดล็อก ฿500', async () => {
    await sc.open('/citizen/new/SV-02?draft=DR-0002');
    await expect(sc.tid('payment-amount')).toHaveText('฿500');
    await expectStatus(await lab.pay('PP-0001', 600), 422, 'AMOUNT_MISMATCH', 'pay PP-0001 600');
    const j = await expectStatus(await lab.pay('PP-0001', 500), 200, undefined, 'pay PP-0001 500');
    expect(j?.status).toBe('PAID');
    expect(j?.caseNo).toBe(cn(32));
  });

  await test.step('6 admin เพิ่มวันหยุด 2026-12-02 → 5 แถว · dueAt …000031 ไม่คำนวณใหม่', async () => {
    await admin.open('/admin/holidays');
    await admin.tid('holiday-date-input').fill('2026-12-02');
    await admin.tid('holiday-name-input').fill('วันหยุดทดสอบ');
    await admin.tid('holiday-add-btn').click();
    await expect(admin.tid('holiday-row')).toHaveCount(5);
    expect((await getCase(sc, c31)).dueAt).toBe('2026-12-04T16:30:00+07:00');
  });

  await test.step('7 หลังเพิ่มวันหยุด NEW_PAID SV-01 (฿25) → …000033 · dueAt 8 ธ.ค. 16:30', async () => {
    const r = await lab.newPaid({ service: 'SV-01', at: T0, qty: 1, expectFee: 25 });
    expect(r.caseNo).toBe(cn(33));
    expect((await getCase(r.citizen, r.caseNo)).dueAt).toBe('2026-12-08T16:30:00+07:00');
  });

  let exec!: Actor;
  await test.step('8 เปลี่ยน exec1 เป็น auditor → ล็อกอินใหม่ไป /audit · /dashboard 403', async () => {
    await expectStatus(
      await admin.api.put('/api/admin/users/exec1', { data: { role: 'auditor', dept: '' } }),
      200,
      undefined,
      'PUT /api/admin/users/exec1',
    );
    exec = await lab.anon('exec1');
    const lg = await expectStatus(
      await exec.api.post('/api/auth/staff/login', { data: { username: 'exec1', password: 'Test@1234' } }),
      200,
      undefined,
      'LOGIN_S(exec1) หลังเปลี่ยนบทบาท',
    );
    expect(lg?.role).toBe('auditor');
    expect(lg?.landing).toBe('/audit');
    await exec.open('/');
    expect(new URL(exec.page.url()).pathname, 'หน้าตั้งต้น').toBe('/audit');
    const res = await exec.open('/dashboard');
    expect(res?.status()).toBe(403);
  });

  await test.step('9 exec1 (auditor) กรอง ADMIN_CHANGE = 4', async () => {
    const rows = await auditRowsFor(exec, { event: 'ADMIN_CHANGE' }, 4, 'ADMIN_CHANGE');
    for (const r of rows) {
      expect(r.actor).toBe('admin1');
      expect(r.role).toBe('admin');
    }
    for (const d of [`SV-01 fee 20 ${ARROW} 25`, `SV-02 fee 500 ${ARROW} 600`, 'holiday add 2026-12-02', `exec1 role executive ${ARROW} auditor`]) {
      expect(rows.some((r) => r.detail.includes(d)), `detail มี "${d}"`).toBe(true);
    }
  });

  await test.step('10 admin POST /api/drafts → 403', async () => {
    await expectStatus(await admin.api.post('/api/drafts', { data: { serviceId: 'SV-01', qty: 1 } }), 403, undefined, 'admin POST /api/drafts');
  });

  await test.step('11 admin ลบวันหยุด 2026-12-02 → 4 แถว · ADMIN_CHANGE รวม 5', async () => {
    await admin.open('/admin/holidays');
    await row(admin.page, 'holiday-row', 'data-date', '2026-12-02').getByTestId('holiday-delete-btn').click();
    await expect(admin.tid('holiday-row')).toHaveCount(4);
    const rows = await auditRowsFor(exec, { event: 'ADMIN_CHANGE' }, 5, 'ADMIN_CHANGE หลังลบ');
    expect(rows.some((r) => r.detail.includes('holiday delete 2026-12-02'))).toBe(true);
  });
});

// ───────────── TC-RBAC-05 ─────────────

test('TC-RBAC-05 · สิทธิ์เปิด/ดาวน์โหลดไฟล์แนบ', async ({ lab }) => {
  test.setTimeout(180_000);
  await lab.reset();
  const reg1 = await lab.staff('off.reg1');
  const reg2 = await lab.staff('off.reg2');
  const works = await lab.staff('off.works1');
  const head = await lab.staff('head1');
  const sy = await lab.citizen(CIT.somying);
  const sc = await lab.citizen(CIT.somchai);
  const others = [await lab.staff('exec1'), await lab.staff('audit1'), await lab.staff('admin1')];
  const anon = await lab.anon();
  const ids: Record<string, string[]> = {};

  const allowed = async (a: Actor, c: string, names: string[]) => {
    const j = await expectStatus(await a.api.get(`/api/cases/${c}/files`), 200, undefined, `${a.label} files ${c}`);
    const items: any[] = j?.items ?? [];
    expect(items.map((x) => x.name).sort(), `${a.label} ${c} รายชื่อไฟล์`).toEqual([...names].sort());
    ids[c] = items.map((x) => String(x.fileId));
    for (const fid of ids[c]) {
      const res = await a.api.get(`/api/files/${fid}`);
      expect(res.status(), `${a.label} GET /api/files/${fid}`).toBe(200);
      expect(res.headers()['content-type'] ?? '').toMatch(/application\/pdf/i);
      expect((await res.body()).subarray(0, 4).toString('latin1'), 'เนื้อไฟล์ขึ้นต้น %PDF').toBe('%PDF');
    }
  };
  const denied = async (a: Actor, c: string, status: number) => {
    await expectStatus(await a.api.get(`/api/cases/${c}/files`), status, undefined, `${a.label} files ${c}`);
    expect(ids[c]?.length, `ต้องมี fileId ของ ${c} ก่อน`).toBeGreaterThan(0);
    for (const fid of ids[c]) await expectStatus(await a.api.get(`/api/files/${fid}`), status, undefined, `${a.label} file ${fid}`);
  };
  const SV03 = ['id-card.pdf', 'plan.pdf', 'deed.pdf'];

  await test.step('ตารางผู้เรียก × คำขอ', async () => {
    await allowed(reg1, cn(25), ['id-card.pdf']);
    await denied(works, cn(25), 403);
    await allowed(reg2, cn(12), SV03);
    await denied(works, cn(12), 403);
    await allowed(works, cn(10), SV03);
    await allowed(reg1, cn(10), SV03);
    await allowed(works, cn(11), SV03);
    await allowed(head, cn(25), ['id-card.pdf']);
    await allowed(head, cn(10), SV03);
    await allowed(head, cn(12), SV03);
    await allowed(sy, cn(25), ['id-card.pdf']);
    await denied(sc, cn(25), 404);
    for (const o of others) await denied(o, cn(25), 403);
    await denied(anon, cn(25), 401);
  });

  await test.step('fileId ที่ไม่มี → 404', async () => {
    const fake = /^\d+$/.test(ids[cn(25)][0]) ? '999999999' : 'nonexistent-file-000000';
    await expectStatus(await reg1.api.get(`/api/files/${fake}`), 404, undefined, 'fileId ที่ไม่มี');
  });

  await test.step('UI doc-item และ doc-download-link', async () => {
    await reg1.open(`/officer/cases/${cn(25)}`);
    await expect(reg1.tid('doc-item')).toHaveCount(1);
    const item = row(reg1.page, 'doc-item', 'data-name', 'id-card.pdf');
    await expect(item).toHaveCount(1);
    const f = await captureFile(reg1, { url: /\/api\/files\//, contentType: /application\/pdf/i }, () =>
      item.getByTestId('doc-download-link').click(),
    );
    expect(f.body.length, 'ขนาดไฟล์ที่ได้').toBeGreaterThan(0);
    await reg2.open(`/officer/cases/${cn(12)}`);
    await expect(reg2.tid('doc-item')).toHaveCount(3);
    await sy.open(`/citizen/cases/${cn(25)}`);
    await expect(sy.tid('doc-item')).toHaveCount(1);
  });
});

// ───────────── TC-RBAC-06 ─────────────

test('TC-RBAC-06 · ผู้ดูแลระบบ: ช่วงค่าที่ยอมรับ', async ({ lab }) => {
  test.setTimeout(150_000);
  await lab.reset();
  const admin = await lab.staff('admin1');
  const sv01 = async () =>
    ((await expectStatus(await admin.api.get('/api/admin/services'), 200, undefined, 'GET /api/admin/services')).items ?? []).find(
      (s: any) => s.id === 'SV-01',
    );
  const putSv01 = (fee: number, sla: number) => admin.api.put('/api/admin/services/SV-01', { data: { fee, sla } });

  /** กรอกบนจอแล้วกดบันทึก (เปิดหน้าใหม่ทุกครั้ง เพื่อให้ action-error/success ต้องปรากฏใหม่) */
  const uiSave = async (fee: number, sla: number) => {
    await admin.open('/admin/services');
    await admin.tid('svc-fee-SV-01').fill(String(fee));
    await admin.tid('svc-sla-SV-01').fill(String(sla));
    await admin.tid('svc-save-SV-01').click();
  };

  // ค่าเริ่ม SV-01 fee 20 · sla 3 · ค่าที่ยอมรับทำครั้งเดียว (บนจอหรือ API) เพื่อให้ ADMIN_CHANGE = 5 ตรงการ์ด
  await test.step('fee = −1 → 400 INVALID_FEE · ค่าไม่เปลี่ยน', async () => {
    await uiSave(-1, 3);
    await expect(admin.tid('action-error')).toHaveText(MSG.invalidFee);
    await expectStatus(await putSv01(-1, 3), 400, 'INVALID_FEE', 'fee -1');
    expect((await sv01()).fee).toBe(20);
  });
  await test.step('fee = 0 → 200 (บนจอ)', async () => {
    await uiSave(0, 3);
    await expect(admin.tid('action-success')).toBeVisible();
    await expect.poll(async () => (await sv01()).fee).toBe(0);
  });
  await test.step('fee = 100000 → 200 (API)', async () => {
    await expectStatus(await putSv01(100000, 3), 200, undefined, 'fee 100000');
    expect((await sv01()).fee).toBe(100000);
  });
  await test.step('fee = 100001 → 400 INVALID_FEE', async () => {
    await uiSave(100001, 3);
    await expect(admin.tid('action-error')).toHaveText(MSG.invalidFee);
    await expectStatus(await putSv01(100001, 3), 400, 'INVALID_FEE', 'fee 100001');
    expect((await sv01()).fee).toBe(100000);
  });
  await test.step('sla = 0 → 400 INVALID_SLA', async () => {
    await uiSave(100000, 0);
    await expect(admin.tid('action-error')).toHaveText(MSG.invalidSla);
    await expectStatus(await putSv01(100000, 0), 400, 'INVALID_SLA', 'sla 0');
    expect((await sv01()).sla).toBe(3);
  });
  await test.step('sla = 1 → 200 (บนจอ)', async () => {
    await uiSave(100000, 1);
    await expect(admin.tid('action-success')).toBeVisible();
    await expect.poll(async () => (await sv01()).sla).toBe(1);
  });
  await test.step('sla = 60 → 200 (API)', async () => {
    await expectStatus(await putSv01(100000, 60), 200, undefined, 'sla 60');
    expect((await sv01()).sla).toBe(60);
  });
  await test.step('sla = 61 → 400 INVALID_SLA', async () => {
    await uiSave(100000, 61);
    await expect(admin.tid('action-error')).toHaveText(MSG.invalidSla);
    await expectStatus(await putSv01(100000, 61), 400, 'INVALID_SLA', 'sla 61');
    expect((await sv01()).sla).toBe(60);
  });

  await test.step('วันหยุดซ้ำ 409 · วันเสาร์ 201 · เปลี่ยนบทบาทตัวเอง 409', async () => {
    const dup = await expectStatus(
      await admin.api.post('/api/admin/holidays', { data: { date: '2026-12-07', name: 'ซ้ำ' } }),
      409,
      'DUPLICATE_HOLIDAY',
      'วันหยุดซ้ำ',
    );
    expect(dup?.message).toBe(MSG.duplicateHoliday);
    await admin.open('/admin/holidays');
    await expect(admin.tid('holiday-row')).toHaveCount(4);
    await expectStatus(
      await admin.api.post('/api/admin/holidays', { data: { date: '2026-12-05', name: 'วันเสาร์' } }),
      201,
      undefined,
      'วันหยุดวันเสาร์',
    );
    await expectStatus(
      await admin.api.put('/api/admin/users/admin1', { data: { role: 'executive', dept: '' } }),
      409,
      'SELF_ROLE_CHANGE',
      'เปลี่ยนบทบาทตัวเอง',
    );
    const me = await expectStatus(await admin.api.get('/api/me'), 200, undefined, 'GET /api/me');
    expect(me?.role).toBe('admin');
  });

  await test.step('Audit ADMIN_CHANGE = 5 (คำขอที่ถูกปฏิเสธไม่ถูกบันทึก)', async () => {
    const auditor = await lab.staff('audit1');
    const rows = await auditRowsFor(auditor, { event: 'ADMIN_CHANGE' }, 5, 'ADMIN_CHANGE');
    for (const d of [
      `SV-01 fee 20 ${ARROW} 0`,
      `SV-01 fee 0 ${ARROW} 100000`,
      `SV-01 sla 3 ${ARROW} 1`,
      `SV-01 sla 1 ${ARROW} 60`,
      'holiday add 2026-12-05',
    ]) {
      expect(rows.some((r) => r.detail.includes(d)), `detail มี "${d}"`).toBe(true);
    }
  });
});
