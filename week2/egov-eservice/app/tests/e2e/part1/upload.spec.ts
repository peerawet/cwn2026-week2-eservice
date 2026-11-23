/**
 * หมวด UPLOAD (TEST-PLAN §5) · TC-UPLOAD-01 (จับ B02: 5,242,880 ไบต์ต้องรับ) · TC-UPLOAD-02
 * ไฟล์ทดสอบสร้างโดย fixtures/global-setup.ts (TEST-DATA ข้อ 11 ขนาดตรงไบต์)
 */
import * as fs from 'fs';
import {
  test,
  expect,
  CIT,
  expectStatus,
  createDraft,
  uploadApi,
  fileItem,
  fixturePath,
  wizardToUpload,
  uiUpload,
} from './helpers';

test('TC-UPLOAD-01 · ขนาดและจำนวนไฟล์', async ({ s }) => {
  test.setTimeout(180_000);
  await s.reset();
  const page = await s.citizenPage(CIT.somchai);
  const api = page.request;
  const items = page.getByTestId('file-item');
  const err = page.getByTestId('upload-error');

  await test.step('ตรวจขนาดไฟล์ทดสอบตรงไบต์', async () => {
    for (const n of [5242879, 5242880, 5242881]) expect(fs.statSync(fixturePath(`size-${n}.pdf`)).size).toBe(n);
  });

  await wizardToUpload(page, 'SV-01', { qty: 1 });

  await test.step('size-5242879.pdf → รับ', async () => {
    await uiUpload(page, 'id-card', 'size-5242879.pdf');
    await expect(items).toHaveCount(1);
    await expect(err).toBeHidden();
    await fileItem(page, 'id-card').getByTestId('file-remove-btn').click();
    await expect(items).toHaveCount(0);
  });

  await test.step('size-5242880.pdf (ขอบ ≤ 5 MB) → รับ', async () => {
    await uiUpload(page, 'id-card', 'size-5242880.pdf');
    await expect(items).toHaveCount(1);
    await expect(err).toBeHidden();
    await fileItem(page, 'id-card').getByTestId('file-remove-btn').click();
    await expect(items).toHaveCount(0);
  });

  await test.step('size-5242881.pdf → ไฟล์ใหญ่เกิน 5 MB', async () => {
    await uiUpload(page, 'id-card', 'size-5242881.pdf');
    await expect(err).toHaveText('ไฟล์ใหญ่เกิน 5 MB');
    await expect(items).toHaveCount(0);
  });

  await test.step('API: 201 / 201 / 400 FILE_TOO_LARGE (ไม่ใช่ 413)', async () => {
    // ใช้ร่างแยกต่อไฟล์ (CONTRACT ไม่มี API ลบไฟล์ในร่าง)
    for (const [n, status] of [
      [5242879, 201],
      [5242880, 201],
    ] as const) {
      const { draftId } = await createDraft(api, 'SV-01', { qty: 1 });
      const b = await expectStatus(await uploadApi(api, draftId, 'id-card', `size-${n}.pdf`), status);
      expect(b.size).toBe(n);
    }
    const { draftId } = await createDraft(api, 'SV-01', { qty: 1 });
    await expectStatus(await uploadApi(api, draftId, 'id-card', 'size-5242881.pdf'), 400, 'FILE_TOO_LARGE');
  });

  await test.step('จำนวน: รวม 5 ไฟล์รับครบ · ไฟล์ที่ 6 ถูกปฏิเสธ · ลบ 1 แล้วแนบใหม่ได้', async () => {
    await wizardToUpload(page, 'SV-01', { qty: 1 });
    await uiUpload(page, 'id-card', 'id-card.pdf');
    await expect(items).toHaveCount(1);
    for (let i = 1; i <= 4; i++) {
      await uiUpload(page, 'extra', `multi-${i}.pdf`);
      await expect(items).toHaveCount(1 + i);
    }
    await expect(items).toHaveCount(5);

    await uiUpload(page, 'extra', 'multi-5.pdf');
    await expect(err).toHaveText('แนบได้สูงสุด 5 ไฟล์ต่อคำขอ');
    await expect(items).toHaveCount(5);

    await fileItem(page, 'extra').first().getByTestId('file-remove-btn').click();
    await expect(items).toHaveCount(4);
    await uiUpload(page, 'extra', 'multi-5.pdf');
    await expect(items).toHaveCount(5);
    await expect(page.locator('[data-testid="file-item"][data-name="multi-5.pdf"]')).toHaveCount(1);
  });

  await test.step('API: ไฟล์ที่ 6 → 400 FILE_COUNT', async () => {
    const { draftId } = await createDraft(api, 'SV-01', { qty: 1 });
    await expectStatus(await uploadApi(api, draftId, 'id-card', 'id-card.pdf'), 201);
    for (let i = 1; i <= 4; i++) await expectStatus(await uploadApi(api, draftId, 'extra', `multi-${i}.pdf`), 201);
    await expectStatus(await uploadApi(api, draftId, 'extra', 'multi-5.pdf'), 400, 'FILE_COUNT');
  });
});

test('TC-UPLOAD-02 · ชนิดไฟล์จากเนื้อไฟล์', async ({ s }) => {
  test.setTimeout(150_000);
  await s.reset();
  const page = await s.citizenPage(CIT.somchai);
  const api = page.request;
  const items = page.getByTestId('file-item');
  const err = page.getByTestId('upload-error');
  const MSG_TYPE = 'รองรับเฉพาะไฟล์ PDF, JPG, PNG';

  await wizardToUpload(page, 'SV-01', { qty: 1 });

  for (const name of ['ok-id.pdf', 'real.jpg', 'real.png']) {
    await test.step(`${name} → รับ`, async () => {
      await uiUpload(page, 'id-card', name);
      await expect(items).toHaveCount(1);
      await expect(err).toBeHidden();
      await fileItem(page, 'id-card').getByTestId('file-remove-btn').click();
      await expect(items).toHaveCount(0);
    });
  }

  for (const name of ['fake-text.pdf', 'fake-text.jpg', 'exe-as.png', 'notes.txt']) {
    await test.step(`${name} → ปฏิเสธ`, async () => {
      await uiUpload(page, 'id-card', name);
      await expect(err).toHaveText(MSG_TYPE);
      await expect(items).toHaveCount(0);
    });
  }

  await test.step('fake-text.pdf ส่งด้วย mimeType application/pdf → ปฏิเสธ (ไม่เชื่อ Content-Type)', async () => {
    await uiUpload(page, 'id-card', {
      name: 'fake-text.pdf',
      mimeType: 'application/pdf',
      buffer: fs.readFileSync(fixturePath('fake-text.pdf')),
    });
    await expect(err).toHaveText(MSG_TYPE);
    await expect(items).toHaveCount(0);
  });

  await test.step('API: รับ 201 · ปฏิเสธ 400 FILE_TYPE · ไฟล์ที่ปฏิเสธไม่ถูกเก็บ', async () => {
    for (const name of ['ok-id.pdf', 'real.jpg', 'real.png']) {
      const { draftId } = await createDraft(api, 'SV-01', { qty: 1 });
      await expectStatus(await uploadApi(api, draftId, 'id-card', name), 201);
    }

    const { draftId } = await createDraft(api, 'SV-01', { qty: 1 });
    const rejected: Array<[string, string | undefined]> = [
      ['fake-text.pdf', undefined],
      ['fake-text.jpg', undefined],
      ['exe-as.png', undefined],
      ['notes.txt', undefined],
      ['fake-text.pdf', 'application/pdf'],
    ];
    for (const [name, mime] of rejected) {
      await expectStatus(await uploadApi(api, draftId, 'id-card', name, mime), 400, 'FILE_TYPE');
    }

    // GET /api/drafts/:id จำนวนไฟล์ไม่เพิ่ม (CONTRACT ไม่กำหนดชื่อฟิลด์รายการไฟล์ → อ่านจากรูปแบบที่พบ)
    const d = await expectStatus(await api.get(`/api/drafts/${draftId}`), 200);
    const draft = Array.isArray(d.items) ? d.items[0] : d;
    const files = draft?.files ?? d.files;
    if (Array.isArray(files)) expect(files, 'ไฟล์ที่ถูกปฏิเสธต้องไม่ถูกเก็บ').toHaveLength(0);
    else if (typeof draft?.fileCount === 'number') expect(draft.fileCount).toBe(0);
    else test.info().annotations.push({ type: 'note', description: 'GET /api/drafts/:id ไม่มีรายการไฟล์ — ใช้การนับเพดาน 5 ไฟล์ตรวจแทน' });

    // ตรวจทางอ้อมที่ไม่พึ่งชื่อฟิลด์: ถ้าไฟล์ที่ถูกปฏิเสธ (5 ไฟล์) ถูกนับไว้ ไฟล์ที่ดีชุดนี้จะติด FILE_COUNT
    await expectStatus(await uploadApi(api, draftId, 'id-card', 'id-card.pdf'), 201);
    for (let i = 1; i <= 4; i++) await expectStatus(await uploadApi(api, draftId, 'extra', `multi-${i}.pdf`), 201);
  });
});
