/**
 * หมวด SLA (TEST-PLAN §8) · TC-SLA-01 (จับ B03) · TC-SLA-02 (จับ B04 และ B03) · TC-SLA-03
 * วันทำการ จ.–ศ. ยกเว้น 7 ธ.ค. · 10 ธ.ค. · 31 ธ.ค. 2569 · 1 ม.ค. 2570 · ตัดรอบ 16:30:00
 */
import {
  test,
  expect,
  CIT,
  EG,
  T0,
  expectStatus,
  newPaid,
  getCase,
  claimApi,
  returnApi,
  resubmitApi,
  queueRow,
  type ServiceId,
} from './helpers';
import type { Page } from '@playwright/test';

const C31 = 'EG-2569-000031';
const LEVEL_CODE: Record<string, string> = {
  ปกติ: 'normal',
  ใกล้ครบกำหนด: 'near',
  เกินกำหนด: 'overdue',
  หยุดนับ: 'paused',
  ปิดแล้ว: 'closed',
};

/** ตรวจ sla-due (ข้อความ + data-iso) บนหน้าคำขอที่เปิดอยู่ */
async function expectSlaDue(page: Page, iso: string, text: string) {
  await expect(page.getByTestId('sla-due')).toHaveAttribute('data-iso', iso);
  await expect(page.getByTestId('sla-due')).toHaveText(text);
}

/** ตรวจ sla-level (ข้อความ + data-level) บนหน้าคำขอที่เปิดอยู่ */
async function expectSlaLevel(page: Page, th: string) {
  await expect(page.getByTestId('sla-level')).toHaveText(th);
  await expect(page.getByTestId('sla-level')).toHaveAttribute('data-level', LEVEL_CODE[th]);
}

test('TC-SLA-01 · กำหนดเสร็จตามตารางวันที่', async ({ s }) => {
  test.setTimeout(300_000);
  // ข้อความบนจอของแถว b f g การ์ดไม่ได้เขียนไว้ → ใช้รูปแบบ CONTRACT 0.2 (`4 ธ.ค. 2569 16:30`) ของ dueAt เดียวกัน
  const rows: Array<{ id: string; service: ServiceId; at: string; areaSqm?: number; due: string; text: string }> = [
    { id: 'a', service: 'SV-01', at: '2026-12-01T09:00:00+07:00', due: '2026-12-04T16:30:00+07:00', text: '4 ธ.ค. 2569 16:30' },
    { id: 'b', service: 'SV-01', at: '2026-12-01T16:29:00+07:00', due: '2026-12-04T16:30:00+07:00', text: '4 ธ.ค. 2569 16:30' },
    { id: 'c', service: 'SV-01', at: '2026-12-01T16:30:00+07:00', due: '2026-12-08T16:30:00+07:00', text: '8 ธ.ค. 2569 16:30' },
    { id: 'd', service: 'SV-01', at: '2026-12-04T10:00:00+07:00', due: '2026-12-11T16:30:00+07:00', text: '11 ธ.ค. 2569 16:30' },
    { id: 'e', service: 'SV-01', at: '2026-12-05T10:00:00+07:00', due: '2026-12-14T16:30:00+07:00', text: '14 ธ.ค. 2569 16:30' },
    { id: 'f', service: 'SV-02', at: '2026-12-01T09:00:00+07:00', due: '2026-12-17T16:30:00+07:00', text: '17 ธ.ค. 2569 16:30' },
    { id: 'g', service: 'SV-03', at: '2026-12-01T09:00:00+07:00', areaSqm: 100, due: '2026-12-24T16:30:00+07:00', text: '24 ธ.ค. 2569 16:30' },
    { id: 'h', service: 'SV-01', at: '2026-12-29T10:00:00+07:00', due: '2027-01-05T16:30:00+07:00', text: '5 ม.ค. 2570 16:30' },
    { id: 'i', service: 'SV-01', at: '2026-12-31T23:59:00+07:00', due: '2027-01-07T16:30:00+07:00', text: '7 ม.ค. 2570 16:30' },
  ];
  for (const r of rows) {
    await test.step(`แถว ${r.id}: ${r.service} ชำระ ${r.at} → ${r.due}`, async () => {
      await s.reset();
      const p = await newPaid(s, { service: r.service, at: r.at, areaSqm: r.areaSqm });
      expect(p.caseNo).toBe(C31);
      expect((await getCase(p.api, C31)).dueAt, `dueAt แถว ${r.id}`).toBe(r.due);
      await p.page.goto(`/citizen/cases/${C31}`);
      await expectSlaDue(p.page, r.due, r.text);
    });
  }
});

test('TC-SLA-02 · หยุดนับ SLA ระหว่างรอแก้ไข', async ({ s }) => {
  test.setTimeout(300_000);

  /** NEW_PAID 09:00 → CLOCK(ตีกลับ) off.reg1 claim + return */
  const paidThenReturned = async (returnAt: string) => {
    await s.reset();
    const p = await newPaid(s, { at: T0 });
    expect(p.caseNo).toBe(C31);
    expect((await getCase(p.api, C31)).dueAt).toBe('2026-12-04T16:30:00+07:00');
    await s.clock(returnAt);
    const reg1 = await s.staffPage('off.reg1');
    await expectStatus(await claimApi(reg1.request, C31), 200);
    const r = await expectStatus(await returnApi(reg1.request, C31, 'xxxxxxxxxx'), 200);
    expect(r).toMatchObject({ status: 'NEED_FIX', returnCount: 1 });
    return reg1;
  };

  await test.step('ส่วน 1: ตีกลับ พ.2 11:00 · ส่งแก้ พฤ.3 10:00 → dueAt 8 ธ.ค. 16:30', async () => {
    const reg1 = await paidThenReturned('2026-12-02T11:00:00+07:00');
    await reg1.goto(`/officer/cases/${C31}`);
    await expect(reg1.getByTestId('case-status')).toHaveText('รอแก้ไขเอกสาร');

    const cit = await s.citizenPage(CIT.somchai);
    await cit.goto(`/citizen/cases/${C31}`);
    await expectSlaLevel(cit, 'หยุดนับ');
    await expect(cit.getByTestId('fix-deadline')).toHaveAttribute('data-iso', '2026-12-09T11:00:00+07:00');

    await s.clock('2026-12-03T10:00:00+07:00');
    await cit.reload();
    await cit.getByTestId('submit-fix-btn').click();
    await expect(cit.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
    await cit.goto(`/citizen/cases/${C31}`);
    await expectSlaDue(cit, '2026-12-08T16:30:00+07:00', '8 ธ.ค. 2569 16:30');
    await expectSlaLevel(cit, 'ปกติ');
    expect((await getCase(cit.request, C31)).dueAt).toBe('2026-12-08T16:30:00+07:00');

    await reg1.goto(`/officer/cases/${C31}`);
    await expect(reg1.getByTestId('case-owner')).toHaveText('off.reg1');
  });

  await test.step('ส่วน 2: seed …000017 ส่งแก้ 1 ธ.ค. 09:00 → dueAt 1 ธ.ค. 16:30 ใกล้ครบกำหนด', async () => {
    await s.reset();
    const cit = await s.citizenPage(CIT.somchai);
    await cit.goto(`/citizen/cases/${EG(17)}`);
    await expectSlaLevel(cit, 'หยุดนับ');
    await expect(cit.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-11-27T16:30:00+07:00');
    await cit.getByTestId('submit-fix-btn').click();
    await expect(cit.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
    expect((await getCase(cit.request, EG(17))).dueAt).toBe('2026-12-01T16:30:00+07:00');
    await cit.goto(`/citizen/cases/${EG(17)}`);
    await expectSlaLevel(cit, 'ใกล้ครบกำหนด');
    const reg1 = await s.staffApi('off.reg1');
    expect((await getCase(reg1, EG(17))).owner).toBe('off.reg1');
  });

  await test.step('ส่วน 3: ส่งแก้ …000017 ที่ 4 ธ.ค. 10:00 → dueAt 4 ธ.ค. 16:30 ใกล้ครบกำหนด', async () => {
    await s.reset();
    await s.clock('2026-12-04T10:00:00+07:00');
    const cit = await s.citizenPage(CIT.somchai);
    await expectStatus(await resubmitApi(cit.request, EG(17)), 200);
    const c = await getCase(cit.request, EG(17));
    expect(c.dueAt).toBe('2026-12-04T16:30:00+07:00');
    expect(c.slaLevel).toBe('near');
    await cit.goto(`/citizen/cases/${EG(17)}`);
    await expectSlaLevel(cit, 'ใกล้ครบกำหนด');
  });

  await test.step('ส่วน 4: ตีกลับและส่งแก้วันเดียวกัน (2 ธ.ค.) → dueAt ยัง 4 ธ.ค. 16:30', async () => {
    await paidThenReturned('2026-12-02T09:00:00+07:00');
    await s.clock('2026-12-02T15:00:00+07:00');
    const cit = await s.citizenApi(CIT.somchai);
    await expectStatus(await resubmitApi(cit, C31), 200);
    expect((await getCase(cit, C31)).dueAt).toBe('2026-12-04T16:30:00+07:00');
  });

  await test.step('ส่วน 5: ตีกลับ ศ.4 10:00 · ส่งแก้ อ.8 17:00 → dueAt 8 ธ.ค. 16:30 เกินกำหนด', async () => {
    await paidThenReturned('2026-12-04T10:00:00+07:00');
    await s.clock('2026-12-08T17:00:00+07:00');
    const cit = await s.citizenPage(CIT.somchai);
    await expectStatus(await resubmitApi(cit.request, C31), 200);
    const c = await getCase(cit.request, C31);
    expect(c.dueAt).toBe('2026-12-08T16:30:00+07:00');
    expect(c.slaLevel).toBe('overdue');
    await cit.goto(`/citizen/cases/${C31}`);
    await expectSlaLevel(cit, 'เกินกำหนด');
  });
});

test('TC-SLA-03 · ระดับเตือน ปกติ / ใกล้ครบกำหนด / เกินกำหนด', async ({ s }) => {
  test.setTimeout(300_000);

  /** ตั้งนาฬิกา → ล็อกอินใหม่ → อ่าน sla-level บนหน้าเคสของประชาชน + slaLevel ใน API */
  const levelAt = async (idNo: string, caseNo: string, clock: string, th: string) => {
    await s.clock(clock);
    const page = await s.citizenPage(idNo);
    await page.goto(`/citizen/cases/${caseNo}`);
    await expectSlaLevel(page, th);
    expect((await getCase(page.request, caseNo)).slaLevel, `slaLevel ${caseNo} @ ${clock}`).toBe(LEVEL_CODE[th]);
  };

  await test.step('ส่วน A: คำขอใหม่ …000031 กำหนด ศ.4 ธ.ค. 16:30', async () => {
    await s.reset();
    const p = await newPaid(s, { at: T0 });
    expect(p.caseNo).toBe(C31);
    const rows: Array<[string, string]> = [
      ['2026-12-01T09:00:00+07:00', 'ปกติ'],
      ['2026-12-02T09:00:00+07:00', 'ปกติ'],
      ['2026-12-03T09:00:00+07:00', 'ใกล้ครบกำหนด'],
      ['2026-12-04T16:30:00+07:00', 'ใกล้ครบกำหนด'],
      ['2026-12-04T16:30:01+07:00', 'เกินกำหนด'],
      ['2026-12-04T16:31:00+07:00', 'เกินกำหนด'],
      ['2026-12-05T10:00:00+07:00', 'เกินกำหนด'],
    ];
    for (const [clock, th] of rows) await test.step(`${clock} → ${th}`, () => levelAt(CIT.somchai, C31, clock, th));
  });

  await test.step('ส่วน B: seed …000016 (ปิติ) กำหนด อ.8 ธ.ค. 16:30', async () => {
    await s.reset();
    const rows: Array<[string, string]> = [
      ['2026-12-03T09:00:00+07:00', 'ปกติ'],
      ['2026-12-04T09:00:00+07:00', 'ใกล้ครบกำหนด'],
      ['2026-12-08T16:30:00+07:00', 'ใกล้ครบกำหนด'],
      ['2026-12-08T16:31:00+07:00', 'เกินกำหนด'],
    ];
    for (const [clock, th] of rows) await test.step(`${clock} → ${th}`, () => levelAt(CIT.piti, EG(16), clock, th));
  });

  await test.step('ส่วน C: seed ที่ 09:00 ผ่าน /officer/queue และหน้าเคส', async () => {
    await s.reset();
    const reg1 = await s.staffPage('off.reg1');
    const inQueue: Array<[number, string]> = [
      [20, 'เกินกำหนด'],
      [22, 'ใกล้ครบกำหนด'],
      [24, 'ใกล้ครบกำหนด'],
      [25, 'ปกติ'],
    ];
    await reg1.goto('/officer/queue');
    for (const [n, th] of inQueue) await expect(queueRow(reg1, EG(n)).getByTestId('row-sla-level')).toHaveText(th);
    for (const [n, th] of inQueue) {
      await reg1.goto(`/officer/cases/${EG(n)}`);
      await expectSlaLevel(reg1, th);
    }
    await reg1.goto(`/officer/cases/${EG(17)}`);
    await expectSlaLevel(reg1, 'หยุดนับ');

    const somying = await s.citizenPage(CIT.somying);
    await somying.goto(`/citizen/cases/${EG(1)}`);
    await expectSlaLevel(somying, 'ปิดแล้ว');

    for (const [clock, th] of [
      ['2026-12-01T16:30:00+07:00', 'ใกล้ครบกำหนด'],
      ['2026-12-01T16:31:00+07:00', 'เกินกำหนด'],
    ]) {
      await s.clock(clock);
      await reg1.goto('/officer/queue');
      await expect(queueRow(reg1, EG(22)).getByTestId('row-sla-level'), `…000022 @ ${clock}`).toHaveText(th);
      await reg1.goto(`/officer/cases/${EG(22)}`);
      await expectSlaLevel(reg1, th);
    }
  });
});
