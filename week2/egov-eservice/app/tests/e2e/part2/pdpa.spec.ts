/**
 * หมวด PDPA (TEST-PLAN §12) · TC-PDPA-01 … 03
 * บั๊กที่ต้องจับ: B09 (API คิวส่งเลขบัตรเต็ม) → TC-PDPA-02 · B11 (unmask ไม่บันทึก Audit) → TC-PDPA-03
 */
import {
  test,
  expect,
  T0,
  CIT,
  MSG,
  cn,
  row,
  textList,
  expectStatus,
  unmaskApi,
  reasonSubmit,
  auditRowsFor,
  hasKeyDeep,
  parseJson,
} from './helpers';

const MASK_RE = /^X-XXXX-XXXXX-\d{2}-\d$/;

test('TC-PDPA-01 · ปิดบังเลขบัตรบนจอ', async ({ lab }) => {
  const C25 = cn(25);
  await lab.reset();

  await test.step('off.reg2 /officer/queue: ทุก row-id-masked ปิดบัง', async () => {
    const reg2 = await lab.staff('off.reg2');
    await reg2.open('/officer/queue');
    await expect(reg2.tid('queue-row').first()).toBeVisible();
    const masked = await textList(reg2.page.locator('[data-testid="queue-row"] [data-testid="row-id-masked"]'));
    expect(masked.length, 'มี row-id-masked').toBeGreaterThan(0);
    for (const m of masked) expect(m, 'row-id-masked').toMatch(MASK_RE);
    await expect(row(reg2.page, 'queue-row', 'data-case-no', C25).getByTestId('row-id-masked')).toHaveText('X-XXXX-XXXXX-65-9');
    await expect(row(reg2.page, 'queue-row', 'data-case-no', cn(26)).getByTestId('row-id-masked')).toHaveText('X-XXXX-XXXXX-45-6');

    await test.step('off.reg2 /officer/cases/…000025: applicant-id ปิดบัง · HTML ไม่มีเลขเต็ม', async () => {
      await reg2.open(`/officer/cases/${C25}`);
      await expect(reg2.tid('applicant-id')).toHaveText('X-XXXX-XXXXX-65-9');
      const html = await reg2.page.content();
      expect(html.includes('3100600987659'), 'HTML มี 3100600987659').toBe(false);
      expect(html.includes('3-1006-00987-65-9'), 'HTML มี 3-1006-00987-65-9').toBe(false);
    });
  });

  await test.step('head1 /officer/cases/…000025: applicant-id ปิดบัง', async () => {
    const head = await lab.staff('head1');
    await head.open(`/officer/cases/${C25}`);
    await expect(head.tid('applicant-id')).toHaveText('X-XXXX-XXXXX-65-9');
  });

  await test.step('สมหญิงเห็นเลขเต็มของตัวเอง', async () => {
    const sy = await lab.citizen(CIT.somying);
    await sy.open(`/citizen/cases/${C25}`);
    await expect(sy.tid('case-id-full')).toHaveText('3-1006-00987-65-9');
  });

  await test.step('สมชายเห็นเลขเต็มของตัวเอง', async () => {
    const sc = await lab.citizen(CIT.somchai);
    await sc.open(`/citizen/cases/${cn(20)}`);
    await expect(sc.tid('case-id-full')).toHaveText('1-1017-00123-45-6');
  });
});

test('TC-PDPA-02 · API (JSON) ไม่ส่งเลขบัตรเต็ม', async ({ lab }) => {
  await lab.reset();
  const endpoints = [
    '/api/officer/queue?filter=all',
    `/api/cases/${cn(25)}`,
    `/api/cases/${cn(26)}`,
    `/api/cases/${cn(20)}`,
    '/api/notifications',
    `/api/cases/${cn(25)}/files`,
  ];
  for (const user of ['off.reg1', 'head1']) {
    await test.step(`${user}: ตรวจ JSON ทั้งก้อนของ API เจ้าหน้าที่`, async () => {
      const a = await lab.staff(user);
      for (const ep of endpoints) {
        const res = await a.api.get(ep);
        const raw = await res.text();
        const label = `${user} GET ${ep}`;
        expect(res.status(), `${label} → ${raw.slice(0, 300)}`).toBe(200);
        expect(res.headers()['content-type'] ?? '', `${label} Content-Type`).toMatch(/application\/json/i);
        const body = parseJson(raw);
        expect(body, `${label} ต้องเป็น JSON`).toBeDefined();
        const whole = JSON.stringify(body);
        // \d{13} ตรวจบน JSON.stringify ทั้งก้อน · ตามขอบเขตการ์ด "เลข 13 หลักอื่น เช่น epoch ms ไม่นับ"
        // จึงยกเว้นเฉพาะค่า number (ไม่ใช่ string) ขนาด 13 หลัก · เลขบัตร seed ถูกตรวจแยกแบบตรงตัวด้านล่างอยู่แล้ว
        const noEpoch = JSON.stringify(body, (_k, v) =>
          typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 1e12 && Math.abs(v) < 1e13 ? '<epoch-ms>' : v,
        );
        expect(noEpoch.match(/\d{13}/)?.[0] ?? null, `${label} พบเลข 13 หลัก`).toBeNull();
        expect(whole.match(/\d-\d{4}-\d{5}-\d{2}-\d/)?.[0] ?? null, `${label} พบเลขบัตรรูปแบบมีขีด`).toBeNull();
        expect(hasKeyDeep(body, 'idNo'), `${label} มี key idNo`).toBe(false);
        for (const s of ['3100600987659', '1101700123456', '1909900555015']) {
          expect(whole.includes(s) || raw.includes(s), `${label} พบ ${s}`).toBe(false);
        }
        if (Array.isArray(body?.items)) {
          for (const it of body.items) {
            if (ep.startsWith('/api/officer/queue')) expect(it?.idMasked, `${label} items[].idMasked`).toMatch(MASK_RE);
            else if (it && typeof it === 'object' && 'idMasked' in it) expect(it.idMasked, `${label} items[].idMasked`).toMatch(MASK_RE);
          }
        }
        if (/^\/api\/cases\/EG-\d{4}-\d{6}$/.test(ep)) expect(body?.idMasked, `${label} idMasked`).toMatch(MASK_RE);
      }
    });
  }
});

test('TC-PDPA-03 · แสดงเลขเต็มต้องมีเหตุผลและบันทึก Audit', async ({ lab }) => {
  const C25 = cn(25);
  await lab.reset();
  const reg2 = await lab.staff('off.reg2');
  await reg2.open(`/officer/cases/${C25}`);

  await test.step('1 เหตุผลว่าง → กรุณากรอกเหตุผล · ไม่มี full-id · API 400 REASON_REQUIRED', async () => {
    await reg2.tid('show-full-id-btn').click();
    await reasonSubmit(reg2.page, 'unmask', '');
    await expect(reg2.tid('unmask-error')).toHaveText(MSG.reasonRequired);
    await expect(reg2.tid('full-id')).toHaveCount(0);
    await expectStatus(await unmaskApi(reg2, C25, ''), 400, 'REASON_REQUIRED', 'unmask เหตุผลว่าง');
  });

  await test.step('2 เหตุผลเว้นวรรคล้วน → ข้อความเดียวกัน', async () => {
    await reg2.open(`/officer/cases/${C25}`);
    // เงื่อนไขเริ่มต้น: หน้าใหม่ต้องไม่มีข้อความ error ที่มองเห็น (การ์ด/CONTRACT ไม่ได้กำหนดว่า element ต้องไม่ถูก render)
    await expect(reg2.tid('unmask-error')).not.toBeVisible();
    await reasonSubmit(reg2.page, 'unmask', '     ');
    await expect(reg2.tid('unmask-error')).toHaveText(MSG.reasonRequired);
    await expect(reg2.tid('full-id')).toHaveCount(0);
  });

  await test.step('3 เหตุผล ตรวจสอบตัวตนซ้ำ → full-id = เลขเต็ม', async () => {
    await reg2.open(`/officer/cases/${C25}`);
    await reasonSubmit(reg2.page, 'unmask', 'ตรวจสอบตัวตนซ้ำ');
    await expect(reg2.tid('full-id')).toHaveText('3-1006-00987-65-9');
  });

  await test.step('4 โหลดหน้าซ้ำ → ปิดบังตามเดิม', async () => {
    await reg2.page.reload();
    await expect(reg2.tid('applicant-id')).toHaveText('X-XXXX-XXXXX-65-9');
    await expect(reg2.tid('full-id')).toHaveCount(0);
  });

  await test.step('5 audit1 กรอง UNMASK → 1 แถว (ความพยายามที่ผิดไม่ถูกบันทึก)', async () => {
    const auditor = await lab.staff('audit1');
    const rows = await auditRowsFor(auditor, { event: 'UNMASK' }, 1, 'UNMASK');
    const r = rows[0];
    expect(r.actor, 'data-actor').toBe('off.reg2');
    expect(r.role, 'audit-role').toBe('officer');
    expect(r.caseNoText, 'audit-case-no').toBe(C25);
    expect(r.eventText, 'audit-event').toBe('UNMASK');
    expect(r.detail, 'audit-detail').toContain('ตรวจสอบตัวตนซ้ำ');
    expect(r.time, 'audit-time data-iso').toBe(T0);
  });

  await test.step('6 exec1 · audit1 · สมหญิง เรียก unmask → 403 ทั้งหมด', async () => {
    for (const u of ['exec1', 'audit1']) {
      const a = await lab.staff(u);
      await expectStatus(await unmaskApi(a, C25, 'x'), 403, undefined, `${u} unmask`);
    }
    const sy = await lab.citizen(CIT.somying);
    await expectStatus(await unmaskApi(sy, C25, 'x'), 403, undefined, 'สมหญิง unmask');
  });
});
