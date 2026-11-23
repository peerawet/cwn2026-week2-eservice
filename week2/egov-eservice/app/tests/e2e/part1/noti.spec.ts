/**
 * หมวด NOTI (TEST-PLAN §9) · TC-NOTI-01 · TC-NOTI-02
 * แจ้งเตือนประเมินเมื่อมี HTTP request ที่ไม่ใช่ /api/test/* (CONTRACT 0.7) → Session.reset()/clock() ใช้ hook จึงไม่กระตุ้น
 */
import { test, expect, EG, notificationsApi, notiItemsUi, pairs, type Session } from './helpers';
import type { APIRequestContext, Page } from '@playwright/test';

const LEVEL_TH: Record<string, string> = { near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด' };
/** "caseNo level" จากท้ายเลข เช่น P(24,'near') = 'EG-2569-000024 near' */
const P = (n: number, level: 'near' | 'overdue') => `${EG(n)} ${level}`;

/** เปิด /notifications แล้วตรวจชุดรายการ (ไม่สนลำดับ) + bell-count + ข้อความ + API */
async function expectNoti(page: Page, expected: string[], who: string) {
  const want = [...expected].sort();
  await page.goto('/notifications');
  await expect(page.getByTestId('bell-count'), `bell-count ${who}`).toHaveText(String(want.length));
  if (want.length === 0) {
    await expect(page.getByTestId('noti-empty')).toHaveText('ไม่มีแจ้งเตือน');
    await expect(page.getByTestId('noti-item')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('noti-item'), `noti-item ${who}`).toHaveCount(want.length);
  }
  const ui = await notiItemsUi(page);
  expect(pairs(ui), `รายการบนจอ ${who}`).toEqual(want);
  for (const it of ui) expect(it.text, `ข้อความ ${who}`).toContain(`คำขอ ${it.caseNo} ${LEVEL_TH[it.level]}`);

  const api = await notificationsApi(page.request);
  expect(pairs(api), `GET /api/notifications ${who}`).toEqual(want);
  for (const it of api) expect(it.text).toBe(`คำขอ ${it.caseNo} ${LEVEL_TH[it.level]}`);
}

/** รายการแจ้งเตือน (API) ของคำขอหนึ่ง */
async function notiOf(api: APIRequestContext, caseNo: string): Promise<string[]> {
  return pairs((await notificationsApi(api)).filter((i) => i.caseNo === caseNo));
}

/** TC-NOTI-01 ทั้งหมด — ใช้ซ้ำใน TC-NOTI-02 ส่วน A */
async function notiBaseline(s: Session) {
  await s.reset(); // หลัง reset ยังไม่มี request ใด ๆ (reset/clock เป็น /api/test/*)
  const reg1 = await s.staffPage('off.reg1'); // request แรก ที่ 09:00 → กระตุ้นการประเมิน
  const reg2 = await s.staffPage('off.reg2');
  const head = await s.staffPage('head1');
  const works = await s.staffPage('off.works1');

  await test.step('09:00 ชุดแรก (TEST-DATA ข้อ 8)', async () => {
    await expectNoti(reg1, [P(24, 'near'), P(22, 'near'), P(20, 'overdue')], 'off.reg1');
    await expectNoti(reg2, [P(24, 'near')], 'off.reg2');
    await expectNoti(head, [P(20, 'overdue')], 'head1');
    await expectNoti(works, [], 'off.works1');
  });

  await test.step('16:31 → …000022 overdue เพิ่มให้ off.reg1 (4) และ head1 (2) · off.reg2 ยัง 1', async () => {
    await s.clock('2026-12-01T16:31:00+07:00');
    await reg1.goto('/notifications'); // request ใด ๆ
    await expectNoti(reg1, [P(24, 'near'), P(22, 'near'), P(20, 'overdue'), P(22, 'overdue')], 'off.reg1');
    await expectNoti(head, [P(20, 'overdue'), P(22, 'overdue')], 'head1');
    await expectNoti(reg2, [P(24, 'near')], 'off.reg2');
  });
  return { reg1, reg2, head, works };
}

test('TC-NOTI-01 · ผู้รับแจ้งเตือนตามระดับ', async ({ s }) => {
  test.setTimeout(150_000);
  await notiBaseline(s);
});

test('TC-NOTI-02 · ไม่แจ้งซ้ำ ข้ามระดับ และขั้นรออนุมัติ/รอออกเอกสาร', async ({ s }) => {
  test.setTimeout(300_000);

  await test.step('ส่วน A ไม่แจ้งซ้ำ', async () => {
    const { reg1, head } = await notiBaseline(s);
    for (const page of [reg1, head]) {
      for (let i = 0; i < 3; i++) await page.goto('/notifications');
      for (let i = 0; i < 3; i++) await notificationsApi(page.request);
      for (let i = 0; i < 2; i++) await page.goto('/officer/queue');
    }
    await expectNoti(reg1, [P(24, 'near'), P(22, 'near'), P(20, 'overdue'), P(22, 'overdue')], 'off.reg1');
    await expectNoti(head, [P(20, 'overdue'), P(22, 'overdue')], 'head1');
  });

  await test.step('ส่วน B ข้ามระดับ: request แรกที่ ส. 5 ธ.ค. 10:00 (TEST-DATA 8.1)', async () => {
    await s.reset();
    await s.clock('2026-12-05T10:00:00+07:00');
    const reg1 = await s.staffPage('off.reg1');
    const reg2 = await s.staffPage('off.reg2');
    const works = await s.staffPage('off.works1');
    const head = await s.staffPage('head1');

    // …000024: เฉพาะ overdue 1 รายการต่อคน (ไม่มี near ย้อนหลัง) · …000020/…000022: off.reg1 และ head1 เฉพาะ overdue
    for (const [who, page] of [
      ['off.reg1', reg1],
      ['off.reg2', reg2],
      ['head1', head],
    ] as const) {
      expect(await notiOf(page.request, EG(24)), `${who} …000024`).toEqual([P(24, 'overdue')]);
    }
    for (const n of [20, 22]) {
      expect(await notiOf(reg1.request, EG(n)), `off.reg1 …0000${n}`).toEqual([P(n, 'overdue')]);
      expect(await notiOf(head.request, EG(n)), `head1 …0000${n}`).toEqual([P(n, 'overdue')]);
    }

    const od = (ns: number[]) => ns.map((n) => P(n, 'overdue'));
    await expectNoti(reg1, od([20, 22, 23, 24, 28, 29, 30]), 'off.reg1'); // 7
    await expectNoti(reg2, [...od([13, 15, 24, 25, 26, 27, 28, 29, 30]), P(16, 'near')], 'off.reg2'); // 10
    await expectNoti(works, od([10]), 'off.works1'); // 1
    await expectNoti(
      head,
      [...od([10, 13, 14, 15, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30]), P(11, 'near')],
      'head1',
    ); // 15
  });

  await test.step('ส่วน C ขั้นรออนุมัติ (…000014) และรอออกเอกสาร (…000019)', async () => {
    await s.reset();
    await s.clock('2026-12-04T09:00:00+07:00');
    let head = await s.staffApi('head1'); // request แรก
    let reg1 = await s.staffApi('off.reg1');
    let reg2 = await s.staffApi('off.reg2');
    expect(await notiOf(head, EG(14)), 'head1 …000014 @ 4 ธ.ค. 09:00').toEqual([P(14, 'near')]);
    expect(await notiOf(reg1, EG(14))).toEqual([]);
    expect(await notiOf(reg2, EG(14))).toEqual([]);

    // 1. ศ.4 16:31 → head1 …000014 near + overdue
    await s.clock('2026-12-04T16:31:00+07:00');
    head = await s.staffApi('head1');
    reg1 = await s.staffApi('off.reg1');
    reg2 = await s.staffApi('off.reg2');
    expect(await notiOf(head, EG(14)), 'head1 …000014 @ 4 ธ.ค. 16:31').toEqual([P(14, 'near'), P(14, 'overdue')].sort());
    expect(await notiOf(reg1, EG(14))).toEqual([]);
    expect(await notiOf(reg2, EG(14))).toEqual([]);

    // 2. อ.8 09:00 → …000019 off.reg1 (ผู้ออกเอกสาร) near · off.reg2 head1 ไม่มี
    await s.clock('2026-12-08T09:00:00+07:00');
    head = await s.staffApi('head1');
    reg1 = await s.staffApi('off.reg1');
    reg2 = await s.staffApi('off.reg2');
    expect(await notiOf(reg1, EG(19)), 'off.reg1 …000019 @ 8 ธ.ค. 09:00').toEqual([P(19, 'near')]);
    expect(await notiOf(reg2, EG(19))).toEqual([]);
    expect(await notiOf(head, EG(19))).toEqual([]);

    // 3. พ.9 16:31 → off.reg1 …000019 near + overdue · head1 overdue 1
    await s.clock('2026-12-09T16:31:00+07:00');
    head = await s.staffApi('head1');
    reg1 = await s.staffApi('off.reg1');
    expect(await notiOf(reg1, EG(19)), 'off.reg1 …000019 @ 9 ธ.ค. 16:31').toEqual([P(19, 'near'), P(19, 'overdue')].sort());
    expect(await notiOf(head, EG(19)), 'head1 …000019 @ 9 ธ.ค. 16:31').toEqual([P(19, 'overdue')]);
  });
});
