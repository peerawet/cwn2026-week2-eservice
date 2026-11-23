/**
 * หมวด SUBMIT (TEST-PLAN §4) · TC-SUBMIT-01 … TC-SUBMIT-03
 */
import {
  test,
  expect,
  CIT,
  EG,
  expectStatus,
  createDraft,
  uploadApi,
  myCases,
  getCase,
  claimApi,
  queueRow,
  queueOrder,
  fileItem,
  wizardToUpload,
  uiUpload,
} from './helpers';

test('TC-SUBMIT-01 · ยื่นคำขอ SV-01 ครบวงจร', async ({ s }) => {
  test.setTimeout(150_000);
  await s.reset();
  const page = await s.citizenPage(CIT.somchai);
  const CASE = 'EG-2569-000031';

  await test.step('1: /citizen → start-service-SV-01 → qty 2 → ฿40', async () => {
    await page.goto('/citizen');
    await page.getByTestId('start-service-SV-01').click();
    await expect(page.getByTestId('wizard-step')).toHaveText('1/3 กรอกข้อมูล');
    await page.getByTestId('qty-input').fill('2');
    await page.getByTestId('qty-input').blur();
    await expect(page.getByTestId('fee-total')).toHaveText('฿40');
    await page.getByTestId('to-upload-btn').click();
  });

  await test.step('2: แนบ id-card.pdf → to-payment-btn ใช้ได้', async () => {
    await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
    await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
    await uiUpload(page, 'id-card', 'id-card.pdf');
    await expect(page.getByTestId('file-item')).toHaveCount(1);
    await expect(fileItem(page, 'id-card')).toHaveCount(1);
    await expect(page.getByTestId('to-payment-btn')).toBeEnabled();
    await page.getByTestId('to-payment-btn').click();
  });

  await test.step('3: ขั้นชำระ → QR PP-0002 หมดอายุ 09:15', async () => {
    await expect(page.getByTestId('wizard-step')).toHaveText('3/3 ชำระเงิน');
    await expect(page.getByTestId('payment-amount')).toHaveText('฿40');
    await page.getByTestId('create-qr-btn').click();
    await expect(page.getByTestId('qr-ref')).toHaveText('PP-0002');
    await expect(page.getByTestId('qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
    await expect(page.getByTestId('payment-status')).toHaveText('รอชำระ');
  });

  await test.step('4: pay PP-0002 ฿40 → PAID EG-2569-000031 · หน้าจอแสดงใบเสร็จ', async () => {
    const body = await expectStatus(await s.pay('PP-0002', 40), 200);
    expect(body).toMatchObject({ status: 'PAID', caseNo: CASE, receiptNo: 'RC-2569-000031', duplicate: false });
    await page.getByTestId('refresh-payment-btn').click();
    await expect(page.getByTestId('payment-status')).toHaveText('ชำระแล้ว');
    await expect(page.getByTestId('submitted-case-no')).toHaveText(CASE);
    await expect(page.getByTestId('receipt-no')).toHaveText('RC-2569-000031');
    await expect(page.getByTestId('receipt-amount')).toHaveText('฿40');
    await expect(page.getByTestId('receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-01T09:00:00+07:00');
  });

  await test.step('5: go-case-btn → หน้าคำขอ', async () => {
    await page.getByTestId('go-case-btn').click();
    await expect(page).toHaveURL((u) => u.pathname === `/citizen/cases/${CASE}`);
    await expect(page.getByTestId('case-status')).toHaveText('ส่งคำขอแล้ว');
    await expect(page.getByTestId('case-status')).toHaveAttribute('data-status', 'SUBMITTED');
    await expect(page.getByTestId('case-fee')).toHaveText('฿40');
    await expect(page.getByTestId('sla-due')).toHaveText('4 ธ.ค. 2569 16:30');
    await expect(page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-12-04T16:30:00+07:00');
    await expect(page.getByTestId('sla-level')).toHaveText('ปกติ');
    await expect(page.getByTestId('cancel-case-btn')).toHaveCount(1);
    await expect(page.getByTestId('case-step')).toHaveCount(0);
  });

  await test.step('off.reg1 เห็นในคิว ไม่มีผู้รับ มี claim-btn ท้ายกลุ่ม 4 ธ.ค.', async () => {
    const off = await s.staffPage('off.reg1');
    await off.goto('/officer/queue');
    const row = queueRow(off, CASE);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('row-owner')).toHaveText('');
    await expect(row.getByTestId('claim-btn')).toHaveCount(1);
    const order = await queueOrder(off);
    const i30 = order.indexOf(EG(30));
    const i31 = order.indexOf(CASE);
    expect(i30, 'มี …000030 ในคิว').toBeGreaterThanOrEqual(0);
    expect(i31, `${CASE} ต้องอยู่ถัดจาก …000030 ทันที · ลำดับ=${order.join(',')}`).toBe(i30 + 1);
    // แถวถัดไปเป็นกลุ่มกำหนด 8 ธ.ค. (…000016) = 031 อยู่ท้ายกลุ่ม 4 ธ.ค.
    expect(order[i31 + 1]).toBe(EG(16));
  });
});

test('TC-SUBMIT-02 · เอกสารบังคับครบก่อนชำระ', async ({ s }) => {
  test.setTimeout(150_000);
  await s.reset();
  const page = await s.citizenPage(CIT.somchai);
  const toPay = page.getByTestId('to-payment-btn');
  const missing = page.getByTestId('missing-docs');

  await test.step('SV-02', async () => {
    await wizardToUpload(page, 'SV-02');
    await uiUpload(page, 'id-card', 'id-card.pdf');
    await expect(fileItem(page, 'id-card')).toHaveCount(1);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');

    await uiUpload(page, 'map', 'map.pdf'); // ไม่แนบภาพสถานที่ (ไม่บังคับ)
    await expect(fileItem(page, 'map')).toHaveCount(1);
    await expect(toPay).toBeEnabled();
    await expect(missing).toHaveCount(0);

    await fileItem(page, 'map').getByTestId('file-remove-btn').click();
    await expect(fileItem(page, 'map')).toHaveCount(0);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');
  });

  await test.step('SV-03 พื้นที่ 100', async () => {
    await wizardToUpload(page, 'SV-03', { areaSqm: 100 });
    await uiUpload(page, 'id-card', 'id-card.pdf');
    await expect(fileItem(page, 'id-card')).toHaveCount(1);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน, โฉนด');

    await uiUpload(page, 'deed', 'deed.pdf');
    await expect(fileItem(page, 'deed')).toHaveCount(1);
    await expect(toPay).toBeDisabled();
    await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน');

    await uiUpload(page, 'plan', 'plan-as-jpg.jpg');
    await expect(page.getByTestId('upload-error')).toHaveText('แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น');
    await expect(page.getByTestId('file-item')).toHaveCount(2);
    await expect(fileItem(page, 'plan')).toHaveCount(0);
    await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน');
    await expect(toPay).toBeDisabled();

    await uiUpload(page, 'plan', 'plan.pdf');
    await expect(fileItem(page, 'plan')).toHaveCount(1);
    await expect(toPay).toBeEnabled();
    await expect(missing).toHaveCount(0);
  });

  await test.step('API: SV-03 ขาดแบบแปลน → 409 MISSING_DOCS ["แบบแปลน"] · ครบแล้ว → 201', async () => {
    const api = page.request;
    const { draftId } = await createDraft(api, 'SV-03', { areaSqm: 100 });
    await expectStatus(await uploadApi(api, draftId, 'id-card', 'id-card.pdf'), 201);
    await expectStatus(await uploadApi(api, draftId, 'deed', 'deed.pdf'), 201);
    const b = await expectStatus(await api.post(`/api/drafts/${draftId}/payment`), 409, 'MISSING_DOCS');
    expect(b.missing).toEqual(['แบบแปลน']);
    await expectStatus(await uploadApi(api, draftId, 'plan', 'plan.pdf'), 201);
    await expectStatus(await api.post(`/api/drafts/${draftId}/payment`), 201);
  });
});

test('TC-SUBMIT-03 · ร่าง และการยกเลิก', async ({ s }) => {
  test.setTimeout(240_000);

  await test.step('ส่วน A ร่าง', async () => {
    await s.reset();
    const page = await s.citizenPage(CIT.somchai);
    await page.goto('/citizen');
    await expect(page.getByTestId('my-case-row')).toHaveCount(10);
    const drafts = page.getByTestId('my-draft-row');
    await expect(drafts).toHaveCount(2);
    await expect(page.locator('[data-testid="my-draft-row"][data-draft-id="DR-0001"]')).toHaveAttribute('data-status', 'DRAFT');
    await expect(page.locator('[data-testid="my-draft-row"][data-draft-id="DR-0002"]')).toHaveAttribute(
      'data-status',
      'PENDING_PAYMENT',
    );
    for (const t of await drafts.allTextContents()) expect(t, 'แถวร่างต้องไม่มี EG-').not.toContain('EG-');

    await page.locator('[data-testid="my-draft-row"][data-draft-id="DR-0001"]').getByTestId('open-draft-btn').click();
    await expect(page.getByTestId('qty-input')).toHaveValue('2');
    await expect(page.getByTestId('fee-total')).toHaveText('฿40');

    await page.goto('/citizen');
    await page.getByTestId('start-service-SV-01').click();
    await page.getByTestId('qty-input').fill('3');
    await page.getByTestId('qty-input').blur();
    await page.getByTestId('save-draft-btn').click();
    await expect(page.getByTestId('draft-id')).toHaveText('DR-0003');

    await page.goto('/citizen');
    await expect(page.getByTestId('my-case-row')).toHaveCount(10);
    expect(await myCases(page.request)).toHaveLength(10);
    const d = await expectStatus(await page.request.get('/api/drafts'), 200);
    expect(d.items).toHaveLength(3);
  });

  await test.step('ส่วน B ยกเลิก …000030 (SUBMITTED ไม่มีผู้รับ)', async () => {
    await s.reset();
    const page = await s.citizenPage(CIT.somchai);
    await page.goto(`/citizen/cases/${EG(30)}`);
    await expect(page.getByTestId('cancel-case-btn')).toHaveCount(1);
    await page.getByTestId('cancel-case-btn').click();
    await expect(page.getByTestId('cancel-confirm-text')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
    await page.getByTestId('confirm-cancel-btn').click();
    await expect(page.getByTestId('case-status')).toHaveText('ยกเลิก');
    await expect(page.getByTestId('case-status')).toHaveAttribute('data-status', 'CANCELLED');
    await expect(page.getByTestId('no-refund-note')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
    await expect(page.getByTestId('cancel-case-btn')).toHaveCount(0);

    const off = await s.staffPage('off.reg1');
    await off.goto('/officer/queue');
    await expect(off.getByTestId('queue-row')).toHaveCount(16);
    await expect(queueRow(off, EG(30))).toHaveCount(0);

    const exec = await s.staffPage('exec1');
    await exec.goto('/dashboard');
    await expect(exec.getByTestId('kpi-backlog')).toHaveText('20');
    await expect(exec.getByTestId('kpi-received')).toHaveText('3');
  });

  await test.step('ส่วน C ยกเลิกไม่ได้เมื่อมีผู้รับ', async () => {
    await s.reset();
    const off = await s.staffApi('off.reg1');
    await expectStatus(await claimApi(off, EG(30)), 200);
    const page = await s.citizenPage(CIT.somchai);
    await page.goto(`/citizen/cases/${EG(30)}`);
    await expect(page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
    await expect(page.getByTestId('cancel-case-btn')).toHaveCount(0);
    await expectStatus(
      await page.request.post(`/api/cases/${EG(30)}/cancel`),
      409,
      'CANNOT_CANCEL',
      'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว',
    );
    // …000013 (IN_REVIEW ผู้ถือ off.reg2) "เช่นเดียวกัน" → 409 CANNOT_CANCEL
    await expectStatus(await page.request.post(`/api/cases/${EG(13)}/cancel`), 409, 'CANNOT_CANCEL');
  });

  await test.step('ส่วน E ลบร่าง', async () => {
    await s.reset();
    const page = await s.citizenPage(CIT.somchai);
    const api = page.request;
    await expectStatus(await api.delete('/api/drafts/DR-0001'), 204);
    await expectStatus(await api.get('/api/drafts/DR-0001'), 404);
    await page.goto('/citizen');
    await expect(page.getByTestId('my-draft-row')).toHaveCount(1);
    await expect(page.getByTestId('my-draft-row')).toHaveAttribute('data-draft-id', 'DR-0002');
    await expectStatus(await api.delete('/api/drafts/DR-0002'), 204);
    await expectStatus(await api.get('/api/payments/PP-0001'), 404);
    await expectStatus(await s.pay('PP-0001', 500), 404);
    expect(await myCases(api), 'ไม่เกิดเลขคำขอใหม่').toHaveLength(10);
  });

  await test.step('ส่วน F ยกเลิกชนกับรับเรื่อง (พร้อมกัน)', async () => {
    await s.reset();
    const citizen = await s.citizenApi(CIT.somchai);
    const off = await s.staffPage('off.reg1');
    const [cancel, claim] = await Promise.all([
      citizen.post(`/api/cases/${EG(30)}/cancel`),
      claimApi(off.request, EG(30)),
    ]);
    const cs = cancel.status();
    const ks = claim.status();
    expect([cs, ks], 'ห้ามได้ 200 ทั้งสองฝั่ง').not.toEqual([200, 200]);
    const c = await getCase(off.request, EG(30));
    if (cs === 200) {
      await expectStatus(claim, 409, 'INVALID_STATE');
      expect(c.status).toBe('CANCELLED');
      expect(c.owner ?? null, 'ยกเลิกชนะ → ไม่มีผู้ถือ').toBeFalsy();
      await off.goto('/officer/queue');
      await expect(off.getByTestId('workload-count')).toHaveText('3');
    } else {
      expect(ks, `ต้องสำเร็จฝั่งเดียว: cancel=${cs} claim=${ks}`).toBe(200);
      await expectStatus(cancel, 409, 'CANNOT_CANCEL');
      expect(c.status).toBe('IN_REVIEW');
      expect(c.owner).toBe('off.reg1');
      await off.goto('/officer/queue');
      await expect(off.getByTestId('workload-count')).toHaveText('4');
    }
  });
});
