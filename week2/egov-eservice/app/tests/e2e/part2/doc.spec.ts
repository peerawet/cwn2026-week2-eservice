/**
 * หมวด DOC (TEST-PLAN §11) · TC-DOC-01 … 03
 */
import {
  test,
  expect,
  T0,
  BASE,
  CIT,
  cn,
  expectStatus,
  approveApi,
  issueApi,
  approveAndIssue,
  issueOnly,
  pdfSearchable,
  expectVerifyResult,
  type Actor,
  type Lab,
} from './helpers';

async function verifyAt(lab: Lab, anon: Actor, code: string, now: string, text: string, result: string, expires?: string) {
  await lab.clock(now);
  const res = await anon.open(`/verify/${code}`);
  expect(res?.status(), `/verify/${code} @ ${now}`).toBe(200);
  await expectVerifyResult(anon, text, result);
  if (expires) await expect(anon.tid('verify-expires')).toHaveAttribute('data-iso', expires);
}

test('TC-DOC-01 · ออกเอกสารและข้อมูลในเอกสาร', async ({ lab }) => {
  const C25 = cn(25);
  await lab.reset();
  const reg2 = await lab.staff('off.reg2');
  let code = '';

  await test.step('off.reg2 approve + issue …000025 ผ่าน API → 200 DOC-2569-000002 COMPLETED', async () => {
    await expectStatus(await approveApi(reg2, C25), 200, undefined, 'approve …000025');
    const j = await expectStatus(await issueApi(reg2, C25), 200, undefined, 'issue …000025');
    expect(j).toMatchObject({ docNo: 'DOC-2569-000002', status: 'COMPLETED' });
    expect(String(j.verifyCode)).toMatch(/^[A-Z0-9]{8}$/);
    code = j.verifyCode;
  });

  await test.step('สมหญิง GET PDF → application/pdf · ชื่อไฟล์ · บรรทัด ASCII', async () => {
    const sy = await lab.citizen(CIT.somying);
    const res = await sy.api.get('/api/documents/DOC-2569-000002/pdf');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toMatch(/^application\/pdf/i);
    expect(res.headers()['content-disposition'] ?? '').toContain('DOC-2569-000002.pdf');
    const text = pdfSearchable(await res.body());
    expect(text).toMatch(new RegExp(`docNo=DOC-2569-000002 caseNo=EG-2569-000025 verify=${code} validUntil=2027-02-28(?![0-9])`));

    await test.step('หน้าเคส doc-qr data-url = <BASE_URL>/verify/<code>', async () => {
      await reg2.open(`/officer/cases/${C25}`);
      await expect(reg2.tid('doc-qr')).toHaveAttribute('data-url', `${BASE}/verify/${code}`);
      await sy.open(`/citizen/cases/${C25}`);
      await expect(sy.tid('doc-qr')).toHaveAttribute('data-url', `${BASE}/verify/${code}`);
    });
  });

  await test.step('เนื้อหาเอกสารผ่าน /verify/<code> (ไม่ล็อกอิน)', async () => {
    const anon = await lab.anon();
    const res = await anon.open(`/verify/${code}`);
    expect(res?.status()).toBe(200);
    await expectVerifyResult(anon, 'เอกสารถูกต้อง', 'VALID');
    await expect(anon.tid('verify-doc-no')).toHaveText('DOC-2569-000002');
    await expect(anon.tid('verify-applicant')).toHaveText('สมหญิง ร***');
    await expect(anon.tid('verify-service')).toHaveText('SV-01 ขอหนังสือรับรอง');
    await expect(anon.tid('verify-issued')).toHaveAttribute('data-iso', T0);
    await expect(anon.tid('verify-expires')).toHaveAttribute('data-iso', '2027-02-28');
    await expect(anon.tid('verify-signer')).toHaveText('เจ้าหน้าที่ทะเบียน 2');

    const v = await expectStatus(await anon.api.get(`/api/verify/${code}`), 200, undefined, 'GET /api/verify');
    expect(v.result).toBe('VALID');
    expect(v.validUntil).toBe('2027-02-28');
    expect(v.issuedAt).toBe(T0);
  });

  await test.step('สมชาย (ไม่ใช่ผู้ยื่น) GET PDF → 404', async () => {
    const sc = await lab.citizen(CIT.somchai);
    await expectStatus(await sc.api.get('/api/documents/DOC-2569-000002/pdf'), 404, undefined, 'สมชาย GET PDF ของสมหญิง');
  });

  await test.step('issue ซ้ำ → 409 INVALID_STATE · เอกสารถัดไปยังเป็น DOC-2569-000003', async () => {
    await expectStatus(await issueApi(reg2, C25), 409, 'INVALID_STATE', 'issue ซ้ำ');
    // พิสูจน์ว่าไม่เกิดเอกสารที่ 2: ออกเอกสารใบถัดไป (seed …000019 SV-02 APPROVED ผู้ออก off.reg1) ต้องได้ DOC-2569-000003
    const reg1 = await lab.staff('off.reg1');
    const next = await issueOnly(reg1, cn(19));
    expect(next.docNo, 'เลขเอกสารถัดไป').toBe('DOC-2569-000003');
  });
});

test('TC-DOC-02 · ตรวจเอกสาร /verify', async ({ lab }) => {
  await lab.reset();
  const anon = await lab.anon();

  await test.step('/verify/K7M2Q9XA → 200 เอกสารถูกต้อง (ไม่ redirect /login)', async () => {
    const res = await anon.open('/verify/K7M2Q9XA');
    expect(res?.status()).toBe(200);
    expect(new URL(anon.page.url()).pathname).toBe('/verify/K7M2Q9XA');
    await expectVerifyResult(anon, 'เอกสารถูกต้อง', 'VALID');
    await expect(anon.tid('verify-doc-no')).toHaveText('DOC-2569-000001');
    await expect(anon.tid('verify-applicant')).toHaveText('สมชาย ใ***');
    await expect(anon.tid('verify-service')).toHaveText('SV-01 ขอหนังสือรับรอง');
    await expect(anon.tid('verify-issued')).toHaveAttribute('data-iso', '2026-11-05T10:00:00+07:00');
    await expect(anon.tid('verify-expires')).toHaveAttribute('data-iso', '2027-02-02');
    await expect(anon.tid('verify-signer')).toHaveText('เจ้าหน้าที่ทะเบียน 1');

    const html = await anon.page.content();
    expect(html.includes('ใจดี'), 'หน้า verify ต้องไม่มีนามสกุลเต็ม ใจดี').toBe(false);
    expect(html.includes('1101700123456'), 'หน้า verify ต้องไม่มีเลขบัตร').toBe(false);
  });

  await test.step('/verify/ZZZZZZZZ → 404 ไม่พบเอกสาร', async () => {
    const res = await anon.open('/verify/ZZZZZZZZ');
    expect(res?.status()).toBe(404);
    await expectVerifyResult(anon, 'ไม่พบเอกสาร', 'NOT_FOUND');
    await expect(anon.tid('verify-applicant')).toHaveCount(0);
    await expect(anon.tid('verify-doc-no')).toHaveCount(0);
  });

  await test.step('API /api/verify', async () => {
    const ok = await expectStatus(await anon.api.get('/api/verify/K7M2Q9XA'), 200, undefined, 'GET /api/verify/K7M2Q9XA');
    expect(ok).toMatchObject({ result: 'VALID', applicantMasked: 'สมชาย ใ***' });
    const nf = await expectStatus(await anon.api.get('/api/verify/ZZZZZZZZ'), 404, undefined, 'GET /api/verify/ZZZZZZZZ');
    expect(nf?.result).toBe('NOT_FOUND');
    expect(nf).not.toHaveProperty('applicantMasked');
    expect(nf).not.toHaveProperty('docNo');
  });
});

test('TC-DOC-03 · เอกสารหมดอายุและลายเซ็นไม่ตรง', async ({ lab }) => {
  test.setTimeout(180_000);

  await test.step('ส่วน A: SV-01 ออก 1 ธ.ค. 69 → ใช้ได้ถึง 2027-02-28', async () => {
    await lab.reset();
    const reg2 = await lab.staff('off.reg2');
    const { verifyCode: c1 } = await approveAndIssue(reg2, cn(25));
    const anon = await lab.anon();
    await verifyAt(lab, anon, c1, '2027-02-28T23:59:00+07:00', 'เอกสารถูกต้อง', 'VALID', '2027-02-28');
    await verifyAt(lab, anon, c1, '2027-03-01T00:00:00+07:00', 'เอกสารหมดอายุ', 'EXPIRED', '2027-02-28');
  });

  await test.step('ส่วน B: SV-02 ออก 1 ธ.ค. 69 → ใช้ได้ถึง 2027-11-30', async () => {
    await lab.reset();
    const reg1 = await lab.staff('off.reg1');
    const { verifyCode: c2 } = await issueOnly(reg1, cn(19));
    const anon = await lab.anon();
    await verifyAt(lab, anon, c2, '2027-11-30T23:59:00+07:00', 'เอกสารถูกต้อง', 'VALID', '2027-11-30');
    await verifyAt(lab, anon, c2, '2027-12-01T00:00:00+07:00', 'เอกสารหมดอายุ', 'EXPIRED');
  });

  await test.step('ส่วน C: seed K7M2Q9XA ใช้ได้ถึง 2027-02-02', async () => {
    await lab.reset();
    const anon = await lab.anon();
    await verifyAt(lab, anon, 'K7M2Q9XA', '2027-02-02T23:59:00+07:00', 'เอกสารถูกต้อง', 'VALID');
    await verifyAt(lab, anon, 'K7M2Q9XA', '2027-02-03T00:00:00+07:00', 'เอกสารหมดอายุ', 'EXPIRED');
  });

  await test.step('ส่วน E: ออกเอกสาร 29 ก.พ. 2571 (2028-02-29)', async () => {
    await lab.reset();
    await lab.clock('2028-02-29T10:00:00+07:00');
    const reg2 = await lab.staff('off.reg2');
    const d1 = await approveAndIssue(reg2, cn(25));
    expect(d1.docNo, 'เลขเอกสารปีใหม่ SV-01').toBe('DOC-2571-000001');
    const reg1 = await lab.staff('off.reg1');
    const d2 = await issueOnly(reg1, cn(19));
    expect(d2.docNo, 'เลขเอกสารปีใหม่ SV-02').toBe('DOC-2571-000002');
    const anon = await lab.anon();

    // SV-01 (…000025): ออก + 89 วัน = 2028-05-28
    await verifyAt(lab, anon, d1.verifyCode, '2028-05-28T23:59:00+07:00', 'เอกสารถูกต้อง', 'VALID', '2028-05-28');
    await verifyAt(lab, anon, d1.verifyCode, '2028-05-29T00:00:00+07:00', 'เอกสารหมดอายุ', 'EXPIRED', '2028-05-28');
    // SV-02 (…000019): วันครบรอบ 28 ก.พ. 2572 − 1 วัน = 2029-02-27
    await verifyAt(lab, anon, d2.verifyCode, '2029-02-27T23:59:00+07:00', 'เอกสารถูกต้อง', 'VALID', '2029-02-27');
    await verifyAt(lab, anon, d2.verifyCode, '2029-02-28T00:00:00+07:00', 'เอกสารหมดอายุ', 'EXPIRED', '2029-02-27');
  });

  await test.step('ส่วน D: ลายเซ็นไม่ตรง (tamper) → TAMPERED แม้หมดอายุด้วย', async () => {
    await lab.reset();
    const hook = await lab.hook();
    const t = await expectStatus(await hook.post('/api/test/documents/DOC-2569-000001/tamper'), 200, undefined, 'tamper');
    expect(t).toEqual({ ok: true });
    const anon = await lab.anon();
    let res = await anon.open('/verify/K7M2Q9XA');
    expect(res?.status()).toBe(200);
    await expectVerifyResult(anon, 'ลายเซ็นไม่ถูกต้อง', 'TAMPERED');
    await expect(anon.tid('verify-doc-no')).toHaveCount(0);
    await expect(anon.tid('verify-applicant')).toHaveCount(0);
    await lab.clock('2027-03-01T00:00:00+07:00');
    res = await anon.open('/verify/K7M2Q9XA');
    expect(res?.status()).toBe(200);
    await expectVerifyResult(anon, 'ลายเซ็นไม่ถูกต้อง', 'TAMPERED');
  });
});
