/**
 * หมวด PAY (TEST-PLAN §6) · TC-PAY-01 (จับ B05: อายุ 15:00 พอดีต้อง 410) · TC-PAY-02 … TC-PAY-04
 */
import {
  test,
  expect,
  CIT,
  EG,
  RC,
  expectStatus,
  draftToQr,
  myCases,
  getCase,
  wizardToUpload,
  uiUpload,
} from './helpers';

test('TC-PAY-01 · อายุ QR 15:00', async ({ s }) => {
  test.setTimeout(150_000);

  await test.step('รอบ 1: 09:00:00 (อายุ 5:00) → 200 PAID EG-2569-000031', async () => {
    await s.reset();
    await s.citizenApi(CIT.somchai);
    const b = await expectStatus(await s.pay('PP-0001', 500), 200);
    expect(b).toMatchObject({ status: 'PAID', caseNo: 'EG-2569-000031' });
  });

  await test.step('รอบ 2: 09:09:59 (อายุ 14:59) → 200 PAID EG-2569-000031', async () => {
    await s.reset();
    await s.clock('2026-12-01T09:09:59+07:00');
    await s.citizenApi(CIT.somchai);
    const b = await expectStatus(await s.pay('PP-0001', 500), 200);
    expect(b).toMatchObject({ status: 'PAID', caseNo: 'EG-2569-000031' });
  });

  await test.step('รอบ 3: 09:10:00 (อายุ 15:00 พอดี) → 410 QR_EXPIRED · ไม่ออกเลข', async () => {
    await s.reset();
    await s.clock('2026-12-01T09:10:00+07:00');
    const page = await s.citizenPage(CIT.somchai);
    await expectStatus(await s.pay('PP-0001', 500), 410, 'QR_EXPIRED');
    const p = await expectStatus(await page.request.get('/api/payments/PP-0001'), 200);
    expect(p.status).toBe('EXPIRED');
    expect(await myCases(page.request), 'GET /api/cases ยัง 10 รายการ').toHaveLength(10);

    await test.step('รอบ 3 บนจอ: QR หมดอายุ → สร้าง QR ใหม่ PP-0002 หมดอายุ 09:25', async () => {
      await page.goto('/citizen/new/SV-02?draft=DR-0002');
      await expect(page.getByTestId('qr-expired-msg')).toHaveText('QR หมดอายุ กรุณาสร้าง QR ใหม่');
      await expect(page.getByTestId('payment-status')).toHaveText('QR หมดอายุ');
      await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'EXPIRED');
      await expect(page.getByTestId('regenerate-qr-btn')).toHaveCount(1);
      await page.getByTestId('regenerate-qr-btn').click();
      await expect(page.getByTestId('qr-ref')).toHaveText('PP-0002');
      await expect(page.getByTestId('qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:25:00+07:00');
      const b = await expectStatus(await s.pay('PP-0002', 500), 200);
      expect(b).toMatchObject({ status: 'PAID', caseNo: 'EG-2569-000031' });
    });
  });

  await test.step('รอบ 4: 09:10:01 (อายุ 15:01) → 410 QR_EXPIRED', async () => {
    await s.reset();
    await s.clock('2026-12-01T09:10:01+07:00');
    await s.citizenApi(CIT.somchai);
    await expectStatus(await s.pay('PP-0001', 500), 410, 'QR_EXPIRED');
  });
});

test('TC-PAY-02 · ยอดเงินและ callback ซ้ำ', async ({ s }) => {
  await s.reset();
  const api = await s.citizenApi(CIT.somchai);
  const { ref } = await draftToQr(api, 'SV-01', { qty: 1 });
  expect(ref).toBe('PP-0002');

  await test.step('1: ฿19 (ขาด ฿1) → 422 AMOUNT_MISMATCH · ยัง PENDING · cases 10', async () => {
    await expectStatus(await s.pay(ref, 19), 422, 'AMOUNT_MISMATCH');
    expect((await expectStatus(await api.get(`/api/payments/${ref}`), 200)).status).toBe('PENDING');
    expect(await myCases(api)).toHaveLength(10);
  });
  await test.step('2: ฿21 (เกิน ฿1) → 422 · ยัง PENDING', async () => {
    await expectStatus(await s.pay(ref, 21), 422, 'AMOUNT_MISMATCH');
    expect((await expectStatus(await api.get(`/api/payments/${ref}`), 200)).status).toBe('PENDING');
  });
  await test.step('3: ฿20 → 200 PAID EG-2569-000031 / RC-2569-000031 · cases 11', async () => {
    const b = await expectStatus(await s.pay(ref, 20), 200);
    expect(b).toMatchObject({ status: 'PAID', caseNo: EG(31), receiptNo: RC(31), duplicate: false });
    expect(await myCases(api)).toHaveLength(11);
  });
  await test.step('4: ฿20 ซ้ำ ref เดิม → 200 duplicate:true เลขเดิม · cases ยัง 11', async () => {
    const b = await expectStatus(await s.pay(ref, 20), 200);
    expect(b).toMatchObject({ duplicate: true, caseNo: EG(31), receiptNo: RC(31) });
    expect(await myCases(api)).toHaveLength(11);
  });
  await test.step('5: ร่างใหม่ SV-01 qty 1 จ่ายครบ → EG-2569-000032 / RC-2569-000032', async () => {
    const q = await draftToQr(api, 'SV-01', { qty: 1 });
    const b = await expectStatus(await s.pay(q.ref, 20), 200);
    expect(b).toMatchObject({ status: 'PAID', caseNo: EG(32), receiptNo: RC(32) });
  });
});

test('TC-PAY-03 · ชำระพร้อมกัน เลขไม่ซ้ำ', async ({ s }) => {
  await s.reset();
  const somchai = await s.citizenApi(CIT.somchai);
  const somying = await s.citizenApi(CIT.somying);
  const refsOf = new Map<string, 'somchai' | 'somying'>();
  for (const [who, api] of [
    ['somchai', somchai],
    ['somying', somying],
  ] as const) {
    for (let i = 0; i < 3; i++) {
      const { ref } = await draftToQr(api, 'SV-01', { qty: 1 });
      refsOf.set(ref, who);
    }
  }
  const refs = [...refsOf.keys()];
  expect([...refs].sort()).toEqual(['PP-0002', 'PP-0003', 'PP-0004', 'PP-0005', 'PP-0006', 'PP-0007']);

  const results = await Promise.all(refs.map((r) => s.pay(r, 20)));
  const bodies = await Promise.all(results.map((r) => expectStatus(r, 200)));
  const caseNos = bodies.map((b) => b.caseNo);
  const receipts = bodies.map((b) => b.receiptNo);
  expect([...caseNos].sort()).toEqual([31, 32, 33, 34, 35, 36].map((n) => EG(n)));
  expect(new Set(caseNos).size).toBe(6);
  expect([...receipts].sort()).toEqual([31, 32, 33, 34, 35, 36].map((n) => RC(n)));

  const newOf = (who: 'somchai' | 'somying') => caseNos.filter((_, i) => refsOf.get(refs[i]) === who).sort();
  const listed = async (api: typeof somchai) => (await myCases(api)).map((c: any) => c.caseNo);
  const somchaiList = await listed(somchai);
  const somyingList = await listed(somying);
  expect(newOf('somchai')).toHaveLength(3);
  expect(newOf('somying')).toHaveLength(3);
  for (const c of newOf('somchai')) expect(somchaiList, `สมชายต้องเห็น ${c}`).toContain(c);
  for (const c of newOf('somying')) expect(somyingList, `สมหญิงต้องเห็น ${c}`).toContain(c);

  const next = await draftToQr(somchai, 'SV-01', { qty: 1 });
  const b = await expectStatus(await s.pay(next.ref, 20), 200);
  expect(b.caseNo).toBe(EG(37));
});

test('TC-PAY-04 · เลขคำขอข้ามปี', async ({ s }) => {
  test.setTimeout(120_000);
  await s.reset();
  await s.clock('2026-12-31T23:58:00+07:00');
  const page = await s.citizenPage(CIT.somchai);
  const api = page.request;
  let ref = '';

  await test.step('1: 31 ธ.ค. 23:58 สร้างร่าง SV-01 + QR → ยังไม่มีเลขคำขอ', async () => {
    await wizardToUpload(page, 'SV-01', { qty: 1 });
    await uiUpload(page, 'id-card', 'id-card.pdf');
    await page.getByTestId('to-payment-btn').click();
    await page.getByTestId('create-qr-btn').click();
    await expect(page.getByTestId('qr-ref')).toHaveText(/^PP-\d{4}$/);
    ref = (await page.getByTestId('qr-ref').textContent())!.trim();
    const p = await expectStatus(await api.get(`/api/payments/${ref}`), 200);
    expect(p.status).toBe('PENDING');
    expect(p.caseNo ?? null, 'ยังไม่มีเลขคำขอ').toBeFalsy();
    expect(await myCases(api)).toHaveLength(10);
  });

  await test.step('2: 23:59 pay ฿20 → EG-2569-000031 / RC-2569-000031 · paid-at 23:59', async () => {
    await s.clock('2026-12-31T23:59:00+07:00');
    const b = await expectStatus(await s.pay(ref, 20), 200);
    expect(b).toMatchObject({ caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031' });
    await page.getByTestId('refresh-payment-btn').click();
    await expect(page.getByTestId('submitted-case-no')).toHaveText('EG-2569-000031');
    await expect(page.getByTestId('receipt-no')).toHaveText('RC-2569-000031');
    await expect(page.getByTestId('receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-31T23:59:00+07:00');
  });

  await test.step('3: 2027-01-01 00:00 ร่างใหม่ + QR + pay → EG-2570-000001 / RC-2570-000001', async () => {
    await s.clock('2027-01-01T00:00:00+07:00');
    const q = await draftToQr(api, 'SV-01', { qty: 1 });
    const b = await expectStatus(await s.pay(q.ref, 20), 200);
    expect(b).toMatchObject({ caseNo: 'EG-2570-000001', receiptNo: 'RC-2570-000001' });
  });

  await test.step('4: ใบที่ 2 ที่ 2027-01-01 00:00 → EG-2570-000002', async () => {
    const q = await draftToQr(api, 'SV-01', { qty: 1 });
    const b = await expectStatus(await s.pay(q.ref, 20), 200);
    expect(b.caseNo).toBe('EG-2570-000002');
  });

  await test.step('5: GET /api/cases/EG-2569-000031 ยังเป็นเลขเดิม', async () => {
    const c = await getCase(api, 'EG-2569-000031');
    expect(c.caseNo).toBe('EG-2569-000031');
  });
});
