/**
 * หมวด QUEUE (TEST-PLAN §7) · TC-QUEUE-01 · TC-QUEUE-02 (จับ B08: ส่วน 3 ต่อกันล้มแน่นอน) · TC-QUEUE-03
 */
import {
  test,
  expect,
  CIT,
  EG,
  expectStatus,
  getCase,
  claimApi,
  auditCount,
  queueRow,
  queueOrder,
  tail6,
  expectWorkload,
} from './helpers';
import type { Page } from '@playwright/test';

const MSG_CLAIMED = 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว';
const MSG_LIMIT = 'รับงานได้สูงสุด 10 เรื่อง';
const STAFF_NAME: Record<string, string> = { 'off.reg1': 'เจ้าหน้าที่ทะเบียน 1', 'off.reg2': 'เจ้าหน้าที่ทะเบียน 2' };

const rowsWithClaim = (page: Page) =>
  page
    .locator('[data-testid="queue-row"]')
    .filter({ has: page.getByTestId('claim-btn') })
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-case-no') || ''));

test('TC-QUEUE-01 · ลำดับคิวและขอบเขตแผนก', async ({ s }) => {
  test.setTimeout(150_000);
  await s.reset();
  const ALL17 = [
    '000020', '000022', '000024', '000023', '000025', '000026', '000013', '000015', '000027',
    '000028', '000029', '000030', '000016', '000018', '000019', '000012', '000021',
  ];

  const reg1 = await s.staffPage('off.reg1');
  await reg1.goto('/officer/queue');
  const rows = reg1.getByTestId('queue-row');

  await test.step('off.reg1 filter all: 17 แถวตามลำดับ BR-16', async () => {
    await expect(reg1.getByTestId('queue-filter')).toHaveValue('all');
    await expect(rows).toHaveCount(17);
    expect(tail6(await queueOrder(reg1))).toEqual(ALL17);
  });

  await test.step('row-sla-level 3 แถวแรก · row-id-masked ทุกแถวปิดบัง', async () => {
    const levels = rows.getByTestId('row-sla-level');
    await expect(levels.nth(0)).toHaveText('เกินกำหนด');
    await expect(levels.nth(1)).toHaveText('ใกล้ครบกำหนด');
    await expect(levels.nth(2)).toHaveText('ใกล้ครบกำหนด');
    const masked = (await rows.getByTestId('row-id-masked').allTextContents()).map((t) => t.trim());
    expect(masked).toHaveLength(17);
    for (const m of masked) expect(m).toMatch(/^X-XXXX-XXXXX-\d{2}-\d$/);
  });

  await test.step('claim-btn 4 ปุ่ม (000024 000028 000029 000030)', async () => {
    await expect(reg1.getByTestId('claim-btn')).toHaveCount(4);
    expect(tail6(await rowsWithClaim(reg1))).toEqual(['000024', '000028', '000029', '000030']);
  });

  await test.step('ไม่อยู่ในคิว: NEED_FIX · PENDING_APPROVAL · ปิดแล้ว/ยกเลิก', async () => {
    const all = await queueOrder(reg1);
    for (const n of [17, 11, 14, 1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(all).not.toContain(EG(n));
  });

  await test.step('filter unclaimed → 4 แถว · mine → 3 แถว · workload 3', async () => {
    await reg1.getByTestId('queue-filter').selectOption('unclaimed');
    await expect(rows).toHaveCount(4);
    expect(tail6(await queueOrder(reg1))).toEqual(['000024', '000028', '000029', '000030']);
    await reg1.getByTestId('queue-filter').selectOption('mine');
    await expect(rows).toHaveCount(3);
    expect(tail6(await queueOrder(reg1))).toEqual(['000020', '000022', '000023']);
    await expect(reg1.getByTestId('workload-count')).toHaveText('3');
  });

  await test.step('off.reg2 mine → 9 แถว · workload 9', async () => {
    const reg2 = await s.staffPage('off.reg2');
    await reg2.goto('/officer/queue');
    await reg2.getByTestId('queue-filter').selectOption('mine');
    await expect(reg2.getByTestId('queue-row')).toHaveCount(9);
    expect(tail6(await queueOrder(reg2))).toEqual([
      '000025', '000026', '000013', '000015', '000027', '000016', '000018', '000012', '000021',
    ]);
    await expect(reg2.getByTestId('workload-count')).toHaveText('9');
  });

  await test.step('off.works1 เห็น 1 แถว: 000010', async () => {
    const works = await s.staffPage('off.works1');
    await works.goto('/officer/queue');
    await expect(works.getByTestId('queue-row')).toHaveCount(1);
    expect(await queueOrder(works)).toEqual([EG(10)]);
  });

  await test.step('head1 เห็น 18 แถว · กลุ่ม 3 ธ.ค. 010→023→025→026 · ไม่มี claim-btn', async () => {
    const head = await s.staffPage('head1');
    await head.goto('/officer/queue');
    await expect(head.getByTestId('queue-row')).toHaveCount(18);
    const order = tail6(await queueOrder(head));
    const i = order.indexOf('000010');
    expect(i, `ลำดับ head1 = ${order.join(',')}`).toBeGreaterThanOrEqual(0);
    expect(order.slice(i, i + 4)).toEqual(['000010', '000023', '000025', '000026']);
    await expect(head.getByTestId('claim-btn')).toHaveCount(0);
  });
});

test('TC-QUEUE-02 · รับเรื่องซ้อน (พร้อมกันและต่อกัน)', async ({ s }) => {
  test.setTimeout(180_000);

  await test.step('ส่วน 1 พร้อมกัน (UI 2 context) · …000028', async () => {
    await s.reset();
    const A = await s.staffPage('off.reg1');
    const B = await s.staffPage('off.reg2');
    await Promise.all([A.goto('/officer/queue'), B.goto('/officer/queue')]);
    await expect(queueRow(A, EG(28)).getByTestId('claim-btn')).toBeVisible();
    await expect(queueRow(B, EG(28)).getByTestId('claim-btn')).toBeVisible();

    await Promise.all([
      queueRow(A, EG(28)).getByTestId('claim-btn').click(),
      queueRow(B, EG(28)).getByTestId('claim-btn').click(),
    ]);

    await expect.poll(async () => (await getCase(A.request, EG(28))).owner, { timeout: 10_000 }).toMatch(/^off\.reg[12]$/);
    const c = await getCase(A.request, EG(28));
    expect(c.status).toBe('IN_REVIEW');
    const winner: string = c.owner;
    const loser = winner === 'off.reg1' ? B : A;
    await expect(loser.getByTestId('action-error')).toHaveText(MSG_CLAIMED);

    await loser.goto('/officer/queue');
    const owner = queueRow(loser, EG(28)).getByTestId('row-owner');
    // "ชื่อผู้ชนะ" — CONTRACT ไม่ระบุว่า row-owner เป็น username หรือชื่อแสดง → ยอมรับทั้งสองแบบของผู้ชนะเท่านั้น
    await expect(owner).toHaveText(new RegExp(`^\\s*(${winner.replace('.', '\\.')}|${STAFF_NAME[winner]})\\s*$`));
    expect(await auditCount(s, 'CLAIM', EG(28)), 'Audit CLAIM ของ …000028').toBe(1);
  });

  await test.step('ส่วน 2 พร้อมกัน (API 10 ครั้ง) · …000029', async () => {
    await s.reset();
    const r1 = await s.staffApi('off.reg1');
    const r2 = await s.staffApi('off.reg2');
    const who: string[] = [];
    const calls = [];
    for (let i = 0; i < 5; i++) {
      who.push('off.reg1', 'off.reg2');
      calls.push(claimApi(r1, EG(29)), claimApi(r2, EG(29)));
    }
    const res = await Promise.all(calls);
    const ok = res.map((r, i) => [r.status(), who[i]] as const).filter(([st]) => st === 200);
    expect(ok.length, `จำนวน 200 = ${ok.length} (ต้อง 1) · statuses=${res.map((r) => r.status()).join(',')}`).toBe(1);
    for (const r of res) if (r.status() !== 200) await expectStatus(r, 409, 'ALREADY_CLAIMED');
    const winner = ok[0][1];
    expect((await getCase(r1, EG(29))).owner).toBe(winner);
    expect(await auditCount(s, 'CLAIM', EG(29)), 'Audit CLAIM ของ …000029').toBe(1);
  });

  await test.step('ส่วน 3 ต่อกัน (ไม่พึ่ง race) · …000029', async () => {
    await s.reset();
    const r1 = await s.staffApi('off.reg1');
    const reg2 = await s.staffPage('off.reg2');
    const b = await expectStatus(await claimApi(r1, EG(29)), 200);
    expect(b.owner).toBe('off.reg1');
    await expectStatus(await claimApi(reg2.request, EG(29)), 409, 'ALREADY_CLAIMED', MSG_CLAIMED);
    expect((await getCase(r1, EG(29))).owner).toBe('off.reg1');
    await expectWorkload(reg2, '9');
    await expectStatus(await claimApi(r1, EG(29)), 409);
    expect(await auditCount(s, 'CLAIM', EG(29)), 'Audit CLAIM ของ …000029').toBe(1);
  });
});

test('TC-QUEUE-03 · งานในมือสูงสุด 10', async ({ s }) => {
  test.setTimeout(180_000);
  await s.reset();
  let reg2 = await s.staffPage('off.reg2');

  const claimUi = async (page: Page, caseNo: string) => {
    await page.goto('/officer/queue');
    await queueRow(page, caseNo).getByTestId('claim-btn').click();
  };
  const ownerOf = async (caseNo: string) => (await getCase(reg2.request, caseNo)).owner ?? null;

  await test.step('1: workload-count = 9', async () => {
    await expectWorkload(reg2, '9');
  });
  await test.step('2: claim …000028 (ครั้งที่ 10) → สำเร็จ · 10', async () => {
    await claimUi(reg2, EG(28));
    await expect.poll(() => ownerOf(EG(28)), { timeout: 10_000 }).toBe('off.reg2');
    await expectWorkload(reg2, '10');
  });
  await test.step('3: claim …000029 (ครั้งที่ 11) → รับงานได้สูงสุด 10 เรื่อง · 409 WORKLOAD_LIMIT', async () => {
    await claimUi(reg2, EG(29));
    await expect(reg2.getByTestId('action-error')).toHaveText(MSG_LIMIT);
    await expectStatus(await claimApi(reg2.request, EG(29)), 409, 'WORKLOAD_LIMIT');
    const c = await getCase(reg2.request, EG(29));
    expect(c.status).toBe('SUBMITTED');
    expect(c.owner ?? null, 'ยังไม่มีผู้รับ').toBeFalsy();
    await expectWorkload(reg2, '10');
  });
  await test.step('4: อนุมัติ …000025 (SV-01 ของตัวเอง) → 9', async () => {
    await reg2.goto(`/officer/cases/${EG(25)}`);
    await reg2.getByTestId('approve-btn').click();
    await expect.poll(async () => (await getCase(reg2.request, EG(25))).status, { timeout: 10_000 }).toBe('APPROVED');
    await expectWorkload(reg2, '9');
  });
  await test.step('5: claim …000029 อีกครั้ง → สำเร็จ · 10', async () => {
    await claimUi(reg2, EG(29));
    await expect.poll(() => ownerOf(EG(29)), { timeout: 10_000 }).toBe('off.reg2');
    await expectWorkload(reg2, '10');
  });
  await test.step('6: off.reg1 (งานในมือ 3) claim …000030 → สำเร็จ', async () => {
    const r1 = await s.staffApi('off.reg1');
    await expectStatus(await claimApi(r1, EG(30)), 200);
  });

  await test.step('7: RESET · off.reg2 ตีกลับ …000025 → รอแก้ไขเอกสาร · 8', async () => {
    await s.reset();
    reg2 = await s.staffPage('off.reg2');
    await reg2.goto(`/officer/cases/${EG(25)}`);
    await reg2.getByTestId('return-btn').click();
    await reg2.getByTestId('return-reason').fill('xxxxxxxxxx');
    await reg2.getByTestId('return-submit').click();
    await expect(reg2.getByTestId('case-status')).toHaveText('รอแก้ไขเอกสาร');
    await expectWorkload(reg2, '8');
  });
  await test.step('8: claim …000028 และ …000029 → สำเร็จทั้งคู่ · 10', async () => {
    await expectStatus(await claimApi(reg2.request, EG(28)), 200);
    await expectStatus(await claimApi(reg2.request, EG(29)), 200);
    await expectWorkload(reg2, '10');
  });
  await test.step('9: สมหญิงส่งแก้ …000025 → กำลังตรวจสอบ ผู้ถือ off.reg2 · 11', async () => {
    const somying = await s.citizenPage(CIT.somying);
    await somying.goto(`/citizen/cases/${EG(25)}`);
    await somying.getByTestId('submit-fix-btn').click();
    await expect(somying.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
    await expect(somying.getByTestId('action-error')).toBeHidden();
    expect((await getCase(reg2.request, EG(25))).owner).toBe('off.reg2');
    await expectWorkload(reg2, '11');
  });
  await test.step('10: off.reg2 claim …000030 → 409 WORKLOAD_LIMIT · ยัง 11', async () => {
    await expectStatus(await claimApi(reg2.request, EG(30)), 409, 'WORKLOAD_LIMIT', MSG_LIMIT);
    await expectWorkload(reg2, '11');
  });
});
