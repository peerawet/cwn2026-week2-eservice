/**
 * หมวด AUDIT (TEST-PLAN §14) · TC-AUDIT-01 … 03
 * บั๊กที่ต้องจับ: B11 (แถว UNMASK หาย) → TC-AUDIT-01
 */
import {
  test,
  expect,
  T0,
  ARROW,
  cn,
  expectStatus,
  claimApi,
  returnApi,
  forwardApi,
  approveApi,
  issueApi,
  rejectApi,
  unmaskApi,
  auditFilter,
  readAuditRows,
  captureFile,
  parseCsv,
  type Actor,
  type AuditRowUI,
} from './helpers';

const NO_TRANSITION = '–';
const tr = (a: string, b: string) => `${a} ${ARROW} ${b}`;

function expectSortedNewToOld(rows: AuditRowUI[]) {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const ta = Date.parse(a.time);
    const tb = Date.parse(b.time);
    expect(ta, `แถว ${i} เวลาต้องใหม่ → เก่า`).toBeGreaterThanOrEqual(tb);
    if (ta === tb) {
      const cmp = a.id.localeCompare(b.id, undefined, { numeric: true });
      expect(cmp, `เวลาเท่ากันต้องเรียง data-id มาก → น้อย (${a.id} ก่อน ${b.id})`).toBeGreaterThan(0);
    }
  }
}

test('TC-AUDIT-01 · เหตุการณ์และฟิลด์ใน Audit', async ({ lab }) => {
  test.setTimeout(150_000);
  await lab.reset();
  let auditor!: Actor;

  await test.step('ทำรายการตามลำดับ (ล็อกอินครั้งเดียวต่อบัญชี · นาฬิกา 09:00)', async () => {
    const reg2 = await lab.staff('off.reg2');
    await expectStatus(await claimApi(reg2, cn(28)), 200, undefined, '1 claim …000028');
    const reg1 = await lab.staff('off.reg1');
    await expectStatus(await returnApi(reg1, cn(20), 'xxxxxxxxxx'), 200, undefined, '2 return …000020');
    await expectStatus(await forwardApi(reg2, cn(13)), 200, undefined, '3 forward …000013');
    const head = await lab.staff('head1');
    await expectStatus(await approveApi(head, cn(13)), 200, undefined, '4 head approve …000013');
    await expectStatus(await approveApi(reg2, cn(25)), 200, undefined, '5 approve …000025');
    await expectStatus(await issueApi(reg2, cn(25)), 200, undefined, '5 issue …000025');
    await expectStatus(await rejectApi(reg2, cn(26), 'xxxxxxxxxx'), 200, undefined, '5 reject …000026');
    await expectStatus(await unmaskApi(reg2, cn(25), 'ตรวจสอบตัวตนซ้ำ'), 200, undefined, '5 unmask …000025');
    const exec = await lab.staff('exec1');
    const ex = await exec.api.get('/api/dashboard/export?format=xlsx&period=2026-12&service=ALL');
    expect(ex.status(), '6 export xlsx').toBe(200);
    const admin = await lab.staff('admin1');
    await expectStatus(await admin.api.put('/api/admin/services/SV-01', { data: { fee: 25, sla: 3 } }), 200, undefined, '7 admin SV-01 fee 25');
    auditor = await lab.staff('audit1');
    await auditor.open('/audit');
  });

  let all: AuditRowUI[] = [];
  await test.step('ไม่กรอง: audit-count 16 · เรียงใหม่ → เก่า · ทุกแถวเวลา 09:00', async () => {
    await expect(auditor.tid('audit-count')).toHaveText('16');
    await expect(auditor.tid('audit-row')).toHaveCount(16);
    all = await readAuditRows(auditor.page);
    expectSortedNewToOld(all);
    for (const r of all) expect(r.time, `${r.event} audit-time`).toBe(T0);
  });

  await test.step('ตารางเหตุการณ์ · ผู้ทำ · บทบาท · เลขคำขอ · transition · detail', async () => {
    const of = (ev: string) => all.filter((r) => r.event === ev);
    const roleOf: Record<string, string> = {
      'off.reg2': 'officer',
      'off.reg1': 'officer',
      head1: 'head',
      exec1: 'executive',
      admin1: 'admin',
      audit1: 'auditor',
    };
    const login = of('STAFF_LOGIN');
    expect(login.map((r) => r.actor).sort()).toEqual(['admin1', 'audit1', 'exec1', 'head1', 'off.reg1', 'off.reg2']);
    for (const r of login) {
      expect(r.role, `STAFF_LOGIN ${r.actor} role`).toBe(roleOf[r.actor]);
      expect(r.transition).toBe(NO_TRANSITION);
      expect(r.caseNoText).not.toMatch(/EG-/);
    }
    const one = (ev: string): AuditRowUI => {
      const l = of(ev);
      expect(l.length, `จำนวน ${ev}`).toBe(1);
      return l[0];
    };
    const expectRow = (r: AuditRowUI, actor: string, role: string, caseNo: string | null, transition: string, detail?: string[]) => {
      expect(r.actor, `${r.event} data-actor`).toBe(actor);
      expect(r.actorText, `${r.event} audit-actor`).toBe(actor);
      expect(r.role, `${r.event} audit-role`).toBe(role);
      expect(r.eventText, `${r.event} audit-event`).toBe(r.event);
      if (caseNo) expect(r.caseNoText, `${r.event} audit-case-no`).toBe(caseNo);
      else expect(r.caseNoText, `${r.event} audit-case-no`).not.toMatch(/EG-/);
      expect(r.transition, `${r.event} audit-transition`).toBe(transition);
      for (const d of detail ?? []) expect(r.detail, `${r.event} audit-detail`).toContain(d);
    };
    expectRow(one('CLAIM'), 'off.reg2', 'officer', cn(28), tr('SUBMITTED', 'IN_REVIEW'));
    expectRow(one('RETURN'), 'off.reg1', 'officer', cn(20), tr('IN_REVIEW', 'NEED_FIX'), ['xxxxxxxxxx']);
    expectRow(one('FORWARD'), 'off.reg2', 'officer', cn(13), tr('IN_REVIEW', 'PENDING_APPROVAL'));
    const appr = of('APPROVE');
    expect(appr.length, 'จำนวน APPROVE').toBe(2);
    const aHead = appr.find((r) => r.actor === 'head1');
    const aReg2 = appr.find((r) => r.actor === 'off.reg2');
    expect(aHead, 'APPROVE ของ head1').toBeTruthy();
    expect(aReg2, 'APPROVE ของ off.reg2').toBeTruthy();
    expectRow(aHead!, 'head1', 'head', cn(13), tr('PENDING_APPROVAL', 'APPROVED'));
    expectRow(aReg2!, 'off.reg2', 'officer', cn(25), tr('IN_REVIEW', 'APPROVED'));
    expectRow(one('ISSUE'), 'off.reg2', 'officer', cn(25), tr('APPROVED', 'COMPLETED'), ['DOC-2569-000002']);
    expectRow(one('REJECT'), 'off.reg2', 'officer', cn(26), tr('IN_REVIEW', 'REJECTED'), ['xxxxxxxxxx']);
    expectRow(one('UNMASK'), 'off.reg2', 'officer', cn(25), NO_TRANSITION, ['ตรวจสอบตัวตนซ้ำ']);
    expectRow(one('EXPORT'), 'exec1', 'executive', null, NO_TRANSITION, ['xlsx', '2026-12']);
    expectRow(one('ADMIN_CHANGE'), 'admin1', 'admin', null, NO_TRANSITION, [`SV-01 fee 20 ${ARROW} 25`]);
  });

  await test.step('กรอง actor / event', async () => {
    await auditFilter(auditor.page, { actor: 'off.reg2' });
    await expect(auditor.tid('audit-count')).toHaveText('7');
    const r1 = await readAuditRows(auditor.page);
    expect(r1.map((r) => r.event).sort()).toEqual(['APPROVE', 'CLAIM', 'FORWARD', 'ISSUE', 'REJECT', 'STAFF_LOGIN', 'UNMASK']);
    expect(r1.every((r) => r.actor === 'off.reg2')).toBe(true);

    await auditFilter(auditor.page, { event: 'APPROVE' });
    await expect(auditor.tid('audit-count')).toHaveText('2');
    expect((await readAuditRows(auditor.page)).map((r) => r.actor).sort()).toEqual(['head1', 'off.reg2']);

    await auditFilter(auditor.page, { actor: 'off.reg2', event: 'APPROVE' });
    await expect(auditor.tid('audit-count')).toHaveText('1');
    expect((await readAuditRows(auditor.page)).map((r) => r.actor)).toEqual(['off.reg2']);
  });

  await test.step('CSV: หัวตาราง · 16 แถวเท่าหน้าจอ · หลังส่งออก audit-count 17', async () => {
    await auditFilter(auditor.page, {});
    await expect(auditor.tid('audit-count')).toHaveText('16');
    const screen = await readAuditRows(auditor.page);
    const f = await captureFile(auditor, { url: /export/i, contentType: /text\/csv/i }, () => auditor.tid('audit-export-csv-btn').click());
    let text = '';
    expect(() => (text = new TextDecoder('utf-8', { fatal: true }).decode(f.body)), 'CSV ต้องเป็น UTF-8').not.toThrow();
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0];
    expect(firstLine, 'หัวตาราง CSV').toBe('time,username,role,event,caseNo,fromStatus,toStatus,detail');
    const rows = parseCsv(text).slice(1);
    expect(rows.length, 'จำนวนแถวข้อมูล CSV').toBe(16);
    // ลำดับเดียวกับบนจอ (CONTRACT §7)
    expect(rows.map((r) => `${r[3]}|${r[1]}`)).toEqual(screen.map((r) => `${r.event}|${r.actor}`));

    await auditor.open('/audit');
    await expect(auditor.tid('audit-count')).toHaveText('17');
    const after = await readAuditRows(auditor.page);
    const csvExport = after.filter((r) => r.event === 'EXPORT' && r.actor === 'audit1');
    expect(csvExport.length, 'แถว EXPORT ของ audit1').toBe(1);
    expect(csvExport[0].detail).toContain('audit-csv');
  });
});

test('TC-AUDIT-02 · Audit แก้/ลบไม่ได้ (405)', async ({ lab }) => {
  await lab.reset();
  const auditor = await lab.staff('audit1');
  const before = await expectStatus(await auditor.api.get('/api/audit'), 200, undefined, 'GET /api/audit (before)');
  const beforeItems: any[] = before?.items ?? [];
  expect(beforeItems.length, 'มีแถว STAFF_LOGIN ของ audit1').toBe(1);
  const id = beforeItems[0].id;
  const admin = await lab.staff('admin1');

  for (const a of [admin, auditor]) {
    await test.step(`${a.label}: PUT/PATCH/DELETE → 405`, async () => {
      await expectStatus(await a.api.put(`/api/audit/${id}`, { data: { detail: 'x' } }), 405, 'METHOD_NOT_ALLOWED', `${a.label} PUT /api/audit/${id}`);
      await expectStatus(await a.api.patch(`/api/audit/${id}`, { data: { detail: 'x' } }), 405, undefined, `${a.label} PATCH /api/audit/${id}`);
      await expectStatus(await a.api.delete(`/api/audit/${id}`), 405, undefined, `${a.label} DELETE /api/audit/${id}`);
      await expectStatus(await a.api.put('/api/audit', { data: { detail: 'x' } }), 405, undefined, `${a.label} PUT /api/audit`);
      await expectStatus(await a.api.delete('/api/audit'), 405, undefined, `${a.label} DELETE /api/audit`);
      await expectStatus(await a.api.delete('/api/audit/999999'), 405, undefined, `${a.label} DELETE /api/audit/999999`);
    });
  }

  await test.step('หลังทำทั้งหมด: แถวเดิมไม่ถูกแก้/หาย · เพิ่มเฉพาะ STAFF_LOGIN ของ admin1', async () => {
    const after = await expectStatus(await auditor.api.get('/api/audit'), 200, undefined, 'GET /api/audit (after)');
    const afterItems: any[] = after?.items ?? [];
    for (const b of beforeItems) {
      expect(afterItems.find((x) => x.id === b.id), `แถว id ${b.id} ต้องยังอยู่และไม่ถูกแก้`).toEqual(b);
    }
    const added = afterItems.filter((x) => !beforeItems.some((b) => b.id === x.id));
    expect(added.map((x) => `${x.event}|${x.username}`)).toEqual(['STAFF_LOGIN|admin1']);
  });

  await test.step('UI ไม่มีปุ่มแก้/ลบ · admin1 GET /api/audit → 403', async () => {
    await auditor.open('/audit');
    await expect(auditor.tid('audit-row').first()).toBeVisible();
    await expect(auditor.tid('audit-edit-btn')).toHaveCount(0);
    await expect(auditor.tid('audit-delete-btn')).toHaveCount(0);
    await expectStatus(await admin.api.get('/api/audit'), 403, undefined, 'admin1 GET /api/audit');
  });
});

test('TC-AUDIT-03 · กรองช่วงวันที่ตามเวลาไทย', async ({ lab }) => {
  test.setTimeout(120_000);
  await lab.reset();
  const L = {
    L1: { at: '2026-11-30T23:59:59+07:00', user: 'off.reg1' },
    L2: { at: '2026-12-01T00:00:00+07:00', user: 'off.reg2' },
    L3: { at: '2026-12-01T23:59:59+07:00', user: 'off.works1' },
    L4: { at: '2026-12-02T00:00:00+07:00', user: 'off.reg1' },
    L5: { at: '2026-12-02T09:00:00+07:00', user: 'audit1' },
  };
  let auditor!: Actor;
  await test.step('สร้างแถว STAFF_LOGIN L1–L5 ตามนาฬิกา', async () => {
    for (const k of ['L1', 'L2', 'L3', 'L4', 'L5'] as const) {
      await lab.clock(L[k].at);
      const a = await lab.staff(L[k].user);
      if (k === 'L5') auditor = a;
    }
    await auditor.open('/audit');
  });

  const cases: { from: string; to: string; actor?: string; want: (keyof typeof L)[] }[] = [
    { from: '2026-12-01', to: '2026-12-01', want: ['L2', 'L3'] },
    { from: '2026-11-30', to: '2026-11-30', want: ['L1'] },
    { from: '2026-11-30', to: '2026-12-01', want: ['L1', 'L2', 'L3'] },
    { from: '2026-12-02', to: '', want: ['L4', 'L5'] },
    { from: '', to: '2026-11-30', want: ['L1'] },
    { from: '2026-12-01', to: '2026-12-02', want: ['L2', 'L3', 'L4', 'L5'] },
    { from: '2026-12-01', to: '2026-12-01', actor: 'off.reg2', want: ['L2'] },
  ];
  for (const c of cases) {
    await test.step(`from=${c.from || '(ว่าง)'} to=${c.to || '(ว่าง)'}${c.actor ? ` actor=${c.actor}` : ''} → ${c.want.join(' ')}`, async () => {
      const expected = c.want.map((k) => `${L[k].user}|${L[k].at}`).sort();
      await auditFilter(auditor.page, { from: c.from, to: c.to, actor: c.actor });
      await expect(auditor.tid('audit-count')).toHaveText(String(c.want.length));
      const ui = await readAuditRows(auditor.page);
      expect(ui.map((r) => `${r.actor}|${r.time}`).sort(), 'แถวบนจอ').toEqual(expected);

      const q = new URLSearchParams({ actor: c.actor ?? '', event: '', from: c.from, to: c.to });
      const j = await expectStatus(await auditor.api.get(`/api/audit?${q}`), 200, undefined, `GET /api/audit?${q}`);
      expect(j.count, 'API count').toBe(c.want.length);
      expect((j.items ?? []).map((x: any) => `${x.username}|${x.time}`).sort(), 'API items').toEqual(expected);
    });
  }
});
