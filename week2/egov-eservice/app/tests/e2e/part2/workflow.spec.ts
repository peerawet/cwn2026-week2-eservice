/**
 * หมวด WORKFLOW (TEST-PLAN §10) · TC-WORKFLOW-01 … 06
 * บั๊กที่ต้องจับ: B12 (ตีกลับครั้งที่ 3 ได้) → TC-WORKFLOW-04
 */
import {
  test,
  expect,
  T0,
  CIT,
  MSG,
  cn,
  row,
  attrList,
  trimmedText,
  expectStatus,
  approveApi,
  rejectApi,
  returnApi,
  resubmitApi,
  issueApi,
  claimApi,
  getCase,
  dashApi,
  captureFile,
  pdfSearchable,
  reasonSubmit,
  auditRowsFor,
  type Actor,
} from './helpers';

/** อ่าน verify-code บนหน้าเคส แล้วเปิด /verify/<code> แบบไม่ล็อกอิน ตรวจ verify-signer */
async function expectSignerOnVerify(page: Actor['page'], anon: Actor, signer: string): Promise<string> {
  const code = await trimmedText(page.getByTestId('verify-code'));
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  await anon.open(`/verify/${code}`);
  await expect(anon.tid('verify-signer')).toHaveText(signer);
  return code;
}

test('TC-WORKFLOW-01 · SV-01 อนุมัติ + ออกเอกสาร', async ({ lab }) => {
  const C25 = cn(25);
  await lab.reset();
  const reg2 = await lab.staff('off.reg2');

  await test.step('1 ตรวจปุ่มของผู้ถือเรื่อง (SV-01 IN_REVIEW)', async () => {
    await reg2.open(`/officer/cases/${C25}`);
    await expect(reg2.tid('case-status')).toHaveText('กำลังตรวจสอบ');
    await expect(reg2.tid('approve-btn')).toHaveCount(1);
    await expect(reg2.tid('return-btn')).toHaveCount(1);
    await expect(reg2.tid('reject-btn')).toHaveCount(1);
    await expect(reg2.tid('forward-btn')).toHaveCount(0);
    await expect(reg2.tid('issue-btn')).toHaveCount(0);
    await expect(reg2.tid('case-fee')).toHaveText('฿60');
  });

  await test.step('2 off.reg1 อนุมัติ …000026 ที่ off.reg2 ถือ → 403 FORBIDDEN', async () => {
    const reg1 = await lab.staff('off.reg1');
    await expectStatus(await approveApi(reg1, cn(26)), 403, 'FORBIDDEN', 'off.reg1 approve …000026');
  });

  await test.step('3 off.reg2 กด approve-btn → อนุมัติ', async () => {
    await reg2.tid('approve-btn').click();
    await expect(reg2.tid('case-status')).toHaveText('อนุมัติ');
    await expect(reg2.tid('case-status')).toHaveAttribute('data-status', 'APPROVED');
    await expect(reg2.tid('issue-btn')).toHaveCount(1);
    await expect(reg2.tid('approve-btn')).toHaveCount(0);
  });

  await test.step('4 กด issue-btn → เสร็จสิ้น + เอกสาร DOC-2569-000002', async () => {
    await reg2.tid('issue-btn').click();
    await expect(reg2.tid('case-status')).toHaveText('เสร็จสิ้น');
    await expect(reg2.tid('case-status')).toHaveAttribute('data-status', 'COMPLETED');
    await expect(reg2.tid('doc-no')).toHaveText('DOC-2569-000002');
    expect(await trimmedText(reg2.tid('verify-code'))).toMatch(/^[A-Z0-9]{8}$/);
    await expect(reg2.tid('closed-at')).toHaveAttribute('data-iso', T0);
    await expect(reg2.tid('sla-level')).toHaveText('ปิดแล้ว');
  });

  await test.step('5 สมหญิงเห็นเสร็จสิ้นและดาวน์โหลด PDF', async () => {
    const sy = await lab.citizen(CIT.somying);
    await sy.open(`/citizen/cases/${C25}`);
    await expect(sy.tid('case-status')).toHaveText('เสร็จสิ้น');
    await expect(sy.tid('download-doc-btn')).toHaveCount(1);
    const f = await captureFile(sy, { url: /\/api\/documents\/|\.pdf(\?|$)/i, contentType: /application\/pdf/i }, () =>
      sy.tid('download-doc-btn').click(),
    );
    expect(f.headers['content-type'] ?? '', 'Content-Type').toMatch(/^application\/pdf/i);
    expect(f.headers['content-disposition'] ?? '', 'Content-Disposition').toContain('DOC-2569-000002.pdf');
    expect(pdfSearchable(f.body), 'บรรทัด ASCII ใน PDF').toMatch(/docNo=DOC-2569-000002 caseNo=EG-2569-000025(?![0-9])/);
  });

  await test.step('6 exec1 Dashboard ธ.ค. ALL: closed 1 · onTime 1 · received 3 · backlog 20', async () => {
    const exec = await lab.staff('exec1');
    const d = await dashApi(exec, '2026-12', 'ALL');
    expect(d.closed, 'closed').toBe(1);
    expect(d.onTime, 'onTime').toBe(1);
    expect(d.received, 'received').toBe(3);
    expect(d.backlog, 'backlog').toBe(20);
  });
});

test('TC-WORKFLOW-02 · SV-02 ผ่านหัวหน้า', async ({ lab }) => {
  test.setTimeout(150_000);
  const C13 = cn(13);
  await lab.reset();
  const reg2 = await lab.staff('off.reg2');

  await test.step('1 ตรวจปุ่ม: ไม่มี approve-btn · มี forward-btn · ไม่มี forward-target', async () => {
    await reg2.open(`/officer/cases/${C13}`);
    await expect(reg2.tid('approve-btn')).toHaveCount(0);
    await expect(reg2.tid('forward-btn')).toHaveCount(1);
    await expect(reg2.tid('forward-target')).toHaveCount(0);
  });

  await test.step('2 กด forward-btn → รออนุมัติ · workload 8 · หายจากคิวทะเบียน', async () => {
    await reg2.tid('forward-btn').click();
    await expect(reg2.tid('case-status')).toHaveText('รออนุมัติ');
    await expect(reg2.tid('case-status')).toHaveAttribute('data-status', 'PENDING_APPROVAL');
    await reg2.open('/officer/queue');
    await expect(reg2.tid('workload-count')).toHaveText('8');
    await expect(row(reg2.page, 'queue-row', 'data-case-no', C13)).toHaveCount(0);
  });

  const head = await lab.staff('head1');
  await test.step('3 head1 /head/approvals = 3 แถว …000013 → …000014 → …000011', async () => {
    await head.open('/head/approvals');
    await expect(head.tid('approval-row')).toHaveCount(3);
    expect(await attrList(head.tid('approval-row'), 'data-case-no')).toEqual([cn(13), cn(14), cn(11)]);
  });

  await test.step('4 approval-open ของ …000013 → approve-btn 1 · reject-btn 1 · issue-btn 0', async () => {
    await row(head.page, 'approval-row', 'data-case-no', C13).getByTestId('approval-open').click();
    await head.page.waitForURL(/\/officer\/cases\/EG-2569-000013(\?|#|$)/);
    await expect(head.tid('approve-btn')).toHaveCount(1);
    await expect(head.tid('reject-btn')).toHaveCount(1);
    await expect(head.tid('issue-btn')).toHaveCount(0);
  });

  await test.step('5 head1 กด approve-btn → อนุมัติ · หัวหน้าไม่มี issue-btn', async () => {
    await head.tid('approve-btn').click();
    await expect(head.tid('case-status')).toHaveText('อนุมัติ');
    await expect(head.tid('case-status')).toHaveAttribute('data-status', 'APPROVED');
    await expect(head.tid('issue-btn')).toHaveCount(0);
  });

  await test.step('6 off.reg1 (ไม่ใช่ผู้รับเรื่อง) ไม่มี issue-btn · API issue 403', async () => {
    const reg1 = await lab.staff('off.reg1');
    await reg1.open(`/officer/cases/${C13}`);
    await expect(reg1.tid('case-status')).toHaveText('อนุมัติ');
    await expect(reg1.tid('issue-btn')).toHaveCount(0);
    await expectStatus(await issueApi(reg1, C13), 403, 'FORBIDDEN', 'off.reg1 issue …000013');
  });

  await test.step('7 off.reg2 กด issue-btn → เสร็จสิ้น · DOC-2569-000002 · verify-signer หัวหน้าฝ่าย', async () => {
    await reg2.open(`/officer/cases/${C13}`);
    await reg2.tid('issue-btn').click();
    await expect(reg2.tid('case-status')).toHaveText('เสร็จสิ้น');
    await expect(reg2.tid('doc-no')).toHaveText('DOC-2569-000002');
    const anon = await lab.anon();
    await expectSignerOnVerify(reg2.page, anon, 'หัวหน้าฝ่าย');
  });

  await test.step('8 RESET · off.reg1 ออกเอกสาร seed …000019 → COMPLETED · DOC-2569-000002 · signer หัวหน้าฝ่าย', async () => {
    await lab.reset();
    const reg1 = await lab.staff('off.reg1');
    await reg1.open(`/officer/cases/${cn(19)}`);
    await reg1.tid('issue-btn').click();
    await expect(reg1.tid('case-status')).toHaveAttribute('data-status', 'COMPLETED');
    await expect(reg1.tid('doc-no')).toHaveText('DOC-2569-000002');
    const anon = await lab.anon();
    await expectSignerOnVerify(reg1.page, anon, 'หัวหน้าฝ่าย');
  });
});

test('TC-WORKFLOW-03 · SV-03 สามขั้นตอน', async ({ lab }) => {
  test.setTimeout(150_000);
  const C12 = cn(12);
  await lab.reset();
  const reg2 = await lab.staff('off.reg2');

  await test.step('1 ขั้นตอน 1/3 · ฝ่ายทะเบียน · ฿1,010 · forward-btn 1', async () => {
    await reg2.open(`/officer/cases/${C12}`);
    await expect(reg2.tid('case-step')).toHaveText('ขั้นตอน 1/3 · ฝ่ายทะเบียน');
    await expect(reg2.tid('case-fee')).toHaveText('฿1,010');
    await expect(reg2.tid('forward-btn')).toHaveCount(1);
  });

  await test.step('2 กด forward-btn → ยัง IN_REVIEW · ขั้นตอน 2/3 · ฝ่ายโยธา · ยังไม่มีผู้รับ · workload 8', async () => {
    await reg2.tid('forward-btn').click();
    await expect(reg2.tid('case-step')).toHaveText('ขั้นตอน 2/3 · ฝ่ายโยธา');
    await expect(reg2.tid('case-status')).toHaveText('กำลังตรวจสอบ');
    await expect(reg2.tid('case-status')).toHaveAttribute('data-status', 'IN_REVIEW');
    await expect(reg2.tid('case-owner')).toHaveText('ยังไม่มีผู้รับ');
    await reg2.open('/officer/queue');
    await expect(reg2.tid('workload-count')).toHaveText('8');
  });

  await test.step('3 คิว off.reg2 ไม่มี …000012 (เหลือ 16 แถว)', async () => {
    await expect(row(reg2.page, 'queue-row', 'data-case-no', C12)).toHaveCount(0);
    await expect(reg2.tid('queue-row')).toHaveCount(16);
  });

  const works = await lab.staff('off.works1');
  await test.step('4 คิว off.works1 = …000010 → …000012 · claim-btn 2', async () => {
    await works.open('/officer/queue');
    await expect(works.tid('queue-row')).toHaveCount(2);
    expect(await attrList(works.tid('queue-row'), 'data-case-no')).toEqual([cn(10), C12]);
    await expect(works.tid('claim-btn')).toHaveCount(2);
  });

  await test.step('5 off.reg1 claim …000012 (ข้ามแผนก) → 403', async () => {
    const reg1 = await lab.staff('off.reg1');
    await expectStatus(await claimApi(reg1, C12), 403, 'FORBIDDEN', 'off.reg1 claim …000012');
  });

  await test.step('6 off.works1 claim แล้วส่งต่อ → รออนุมัติ · ขั้นตอน 3/3 · หัวหน้าฝ่าย', async () => {
    const j = await expectStatus(await claimApi(works, C12), 200, undefined, 'off.works1 claim …000012');
    expect(j?.owner).toBe('off.works1');
    await works.open(`/officer/cases/${C12}`);
    await expect(works.tid('case-owner')).toHaveText('off.works1');
    await works.tid('forward-btn').click();
    await expect(works.tid('case-status')).toHaveText('รออนุมัติ');
    await expect(works.tid('case-step')).toHaveText('ขั้นตอน 3/3 · หัวหน้าฝ่าย');
  });

  await test.step('7 head1 เห็น …000012 (รวม 3 แถว) แล้วอนุมัติ', async () => {
    const head = await lab.staff('head1');
    await head.open('/head/approvals');
    await expect(head.tid('approval-row')).toHaveCount(3);
    await expect(row(head.page, 'approval-row', 'data-case-no', C12)).toHaveCount(1);
    await row(head.page, 'approval-row', 'data-case-no', C12).getByTestId('approval-open').click();
    await head.page.waitForURL(/\/officer\/cases\/EG-2569-000012(\?|#|$)/);
    await head.tid('approve-btn').click();
    await expect(head.tid('case-status')).toHaveText('อนุมัติ');
  });

  await test.step('8 off.works1 ไม่มี issue-btn · off.reg2 (ทะเบียนขั้นแรก) ออกเอกสาร · signer หัวหน้าฝ่าย', async () => {
    await works.open(`/officer/cases/${C12}`);
    await expect(works.tid('case-status')).toHaveText('อนุมัติ');
    await expect(works.tid('issue-btn')).toHaveCount(0);
    await reg2.open(`/officer/cases/${C12}`);
    await expect(reg2.tid('issue-btn')).toHaveCount(1);
    await reg2.tid('issue-btn').click();
    await expect(reg2.tid('case-status')).toHaveText('เสร็จสิ้น');
    const anon = await lab.anon();
    await expectSignerOnVerify(reg2.page, anon, 'หัวหน้าฝ่าย');
  });
});

test('TC-WORKFLOW-04 · ตีกลับสูงสุด 2 ครั้ง และผลหลังครบ', async ({ lab }) => {
  test.setTimeout(180_000);

  await test.step('ส่วน A: SV-01 …000020 ตีกลับครั้งที่ 1, 2 ได้ · ครั้งที่ 3 → 409 RETURN_LIMIT', async () => {
    const C20 = cn(20);
    await lab.reset();
    const reg1 = await lab.staff('off.reg1');
    const sc = await lab.citizen(CIT.somchai);
    await reg1.open(`/officer/cases/${C20}`);
    await expect(reg1.tid('return-count')).toHaveText('0');

    // 1
    await reasonSubmit(reg1.page, 'return', 'xxxxxxxxxx');
    await expect(reg1.tid('case-status')).toHaveText('รอแก้ไขเอกสาร');
    await expect(reg1.tid('return-count')).toHaveText('1');
    // 2
    const r1 = await expectStatus(await resubmitApi(sc, C20), 200, undefined, 'สมชายส่งแก้ครั้งที่ 1');
    expect(r1?.status).toBe('IN_REVIEW');
    const c1 = await getCase(reg1, C20);
    expect(c1.status).toBe('IN_REVIEW');
    expect(c1.owner, 'ผู้ถือเดิม').toBe('off.reg1');
    // 3
    await reg1.open(`/officer/cases/${C20}`);
    await expect(reg1.tid('case-status')).toHaveText('กำลังตรวจสอบ');
    await reasonSubmit(reg1.page, 'return', 'xxxxxxxxxx');
    await expect(reg1.tid('case-status')).toHaveText('รอแก้ไขเอกสาร');
    await expect(reg1.tid('return-count')).toHaveText('2');
    // 4
    const r2 = await expectStatus(await resubmitApi(sc, C20), 200, undefined, 'สมชายส่งแก้ครั้งที่ 2');
    expect(r2?.status).toBe('IN_REVIEW');
    // 5
    await reg1.open(`/officer/cases/${C20}`);
    await expect(reg1.tid('case-status')).toHaveText('กำลังตรวจสอบ');
    await expect(reg1.tid('return-btn')).toHaveCount(0);
    const j = await expectStatus(await returnApi(reg1, C20, 'xxxxxxxxxx'), 409, 'RETURN_LIMIT', 'ตีกลับครั้งที่ 3');
    expect(j?.message).toBe(MSG.returnLimit);
    const after = await getCase(reg1, C20);
    expect(after.status).toBe('IN_REVIEW');
    expect(after.returnCount).toBe(2);
    await reg1.page.reload();
    await expect(reg1.tid('return-count')).toHaveText('2');
    await expect(reg1.tid('approve-btn')).toHaveCount(1);
    await expect(reg1.tid('reject-btn')).toHaveCount(1);
  });

  await test.step('ส่วน B: seed …000023 ตีกลับแล้ว 2 ครั้ง', async () => {
    const C23 = cn(23);
    await lab.reset();
    const reg1 = await lab.staff('off.reg1');
    await reg1.open(`/officer/cases/${C23}`);
    await expect(reg1.tid('return-count')).toHaveText('2');
    await expect(reg1.tid('return-btn')).toHaveCount(0);
    const j = await expectStatus(await returnApi(reg1, C23, 'xxxxxxxxxx'), 409, 'RETURN_LIMIT', 'return …000023');
    expect(j?.message).toBe(MSG.returnLimit);
    expect((await getCase(reg1, C23)).status).toBe('IN_REVIEW');
    await reg1.page.reload();
    await expect(reg1.tid('case-status')).toHaveText('กำลังตรวจสอบ');
    await expect(reg1.tid('approve-btn')).toHaveCount(1);
    await expect(reg1.tid('reject-btn')).toHaveCount(1);
  });

  await test.step('ส่วน C: SV-02 …000013 หลังตีกลับครบ 2 ครั้ง → ส่งต่อหัวหน้าเท่านั้น', async () => {
    const C13 = cn(13);
    const note = 'ส่งต่อให้หัวหน้าพิจารณา';
    await lab.reset();
    const reg2 = await lab.staff('off.reg2');
    const sc = await lab.citizen(CIT.somchai);
    for (let i = 1; i <= 2; i++) {
      const r = await expectStatus(await returnApi(reg2, C13, 'xxxxxxxxxx'), 200, undefined, `ตีกลับ …000013 ครั้งที่ ${i}`);
      expect(r?.status).toBe('NEED_FIX');
      expect(r?.returnCount).toBe(i);
      await expectStatus(await resubmitApi(sc, C13), 200, undefined, `สมชายส่งแก้ …000013 ครั้งที่ ${i}`);
    }
    await reg2.open(`/officer/cases/${C13}`);
    await expect(reg2.tid('case-status')).toHaveText('กำลังตรวจสอบ');
    await expect(reg2.tid('return-btn')).toHaveCount(0);
    await expect(reg2.tid('approve-btn')).toHaveCount(0);
    await expect(reg2.tid('reject-btn')).toHaveCount(0);
    await expect(reg2.tid('forward-btn')).toHaveCount(1);
    await expectStatus(await rejectApi(reg2, C13, 'xxxxxxxxxx'), 403, undefined, 'off.reg2 reject SV-02');

    await reg2.tid('forward-note').fill(note);
    await reg2.tid('forward-btn').click();
    await expect(reg2.tid('case-status')).toHaveText('รออนุมัติ');

    const auditor = await lab.staff('audit1');
    const rows = await auditRowsFor(auditor, { event: 'FORWARD' }, 1, 'FORWARD');
    const fw = rows.find((r) => r.caseNo === C13 || r.caseNoText === C13);
    expect(fw, 'แถว Audit FORWARD ของ …000013').toBeTruthy();
    expect(fw!.detail).toContain(note);

    const head = await lab.staff('head1');
    await head.open(`/officer/cases/${C13}`);
    await expect(head.tid('reject-btn')).toHaveCount(1);
    await expect(head.tid('approve-btn')).toHaveCount(1);
  });
});

test('TC-WORKFLOW-05 · เหตุผล ≥ 10 ตัวอักษร (ตีกลับ / ไม่อนุมัติ)', async ({ lab }) => {
  test.setTimeout(150_000);
  const NINE = 'xxxxxxxxx';
  const TEN = 'xxxxxxxxxx';
  const SPACES = ' '.repeat(10);

  await test.step('ส่วน A ตีกลับ …000020 (off.reg1)', async () => {
    const C20 = cn(20);
    await lab.reset();
    const reg1 = await lab.staff('off.reg1');
    await reg1.open(`/officer/cases/${C20}`);

    // 9 ตัว
    await reasonSubmit(reg1.page, 'return', NINE);
    await expect(reg1.tid('return-reason-error')).toHaveText(MSG.reasonTooShort);
    await expectStatus(await returnApi(reg1, C20, NINE), 400, 'REASON_TOO_SHORT', 'return 9 ตัว');
    await reg1.open(`/officer/cases/${C20}`);
    await expect(reg1.tid('case-status')).toHaveText('กำลังตรวจสอบ');

    // เว้นวรรคล้วน 10 ตัว (เปิดหน้าใหม่ก่อน เพื่อให้ข้อความ error ต้องปรากฏใหม่)
    await expect(reg1.tid('return-reason-error')).toHaveCount(0);
    await reasonSubmit(reg1.page, 'return', SPACES);
    await expect(reg1.tid('return-reason-error')).toHaveText(MSG.reasonTooShort);
    await expectStatus(await returnApi(reg1, C20, SPACES), 400, 'REASON_TOO_SHORT', 'return เว้นวรรค 10 ตัว');
    await reg1.open(`/officer/cases/${C20}`);
    await expect(reg1.tid('case-status')).toHaveText('กำลังตรวจสอบ');

    // 10 ตัว
    await reasonSubmit(reg1.page, 'return', TEN);
    await expect(reg1.tid('case-status')).toHaveText('รอแก้ไขเอกสาร');
    const sc = await lab.citizen(CIT.somchai);
    await sc.open(`/citizen/cases/${C20}`);
    await expect(sc.tid('return-reason-display')).toHaveText(TEN);
  });

  await test.step('ส่วน B ไม่อนุมัติ SV-01 …000026 (off.reg2)', async () => {
    const C26 = cn(26);
    await lab.reset();
    const reg2 = await lab.staff('off.reg2');
    await reg2.open(`/officer/cases/${C26}`);
    await reasonSubmit(reg2.page, 'reject', NINE);
    await expect(reg2.tid('reject-reason-error')).toHaveText(MSG.reasonTooShort);
    await expectStatus(await rejectApi(reg2, C26, NINE), 400, 'REASON_TOO_SHORT', 'reject 9 ตัว');

    await reg2.open(`/officer/cases/${C26}`);
    await expect(reg2.tid('case-status')).toHaveText('กำลังตรวจสอบ');
    await reasonSubmit(reg2.page, 'reject', TEN);
    await expect(reg2.tid('case-status')).toHaveText('ไม่อนุมัติ');
    await expect(reg2.tid('case-status')).toHaveAttribute('data-status', 'REJECTED');
    await expect(reg2.tid('closed-at')).toHaveAttribute('data-iso', T0);
    await expect(reg2.tid('sla-level')).toHaveText('ปิดแล้ว');

    const sc = await lab.citizen(CIT.somchai);
    await sc.open(`/citizen/cases/${C26}`);
    await expect(sc.tid('no-refund-note')).toBeVisible();

    const exec = await lab.staff('exec1');
    const d = await dashApi(exec, '2026-12', 'ALL');
    expect(d.closed, 'closed (REJECTED นับเป็นปิดงาน)').toBe(1);
    expect(d.onTime, 'onTime').toBe(1);
  });

  await test.step('ส่วน C หัวหน้าไม่อนุมัติ …000011 (head1)', async () => {
    const C11 = cn(11);
    await lab.reset();
    const head = await lab.staff('head1');
    await expectStatus(await rejectApi(head, C11, NINE), 400, 'REASON_TOO_SHORT', 'head reject 9 ตัว');
    const j = await expectStatus(await rejectApi(head, C11, TEN), 200, undefined, 'head reject 10 ตัว');
    expect(j?.status).toBe('REJECTED');
    expect((await getCase(head, C11)).status).toBe('REJECTED');
  });
});

test('TC-WORKFLOW-06 · เวลาแก้ไข 168 ชั่วโมง', async ({ lab }) => {
  test.setTimeout(120_000);
  const C17 = cn(17);
  const DEADLINE = '2026-12-04T14:00:00+07:00';

  await test.step('หน้าตั้งต้น …000017 (NEED_FIX)', async () => {
    await lab.reset();
    const sc = await lab.citizen(CIT.somchai);
    await sc.open(`/citizen/cases/${C17}`);
    await expect(sc.tid('case-status')).toHaveText('รอแก้ไขเอกสาร');
    await expect(sc.tid('return-reason-display')).toHaveText('ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข');
    await expect(sc.tid('fix-deadline')).toHaveText('4 ธ.ค. 2569 14:00');
    await expect(sc.tid('fix-deadline')).toHaveAttribute('data-iso', DEADLINE);
    await expect(sc.tid('submit-fix-btn')).toHaveCount(1);
  });

  await test.step('รอบ A 167:59 → ส่งแก้ได้ → กำลังตรวจสอบ', async () => {
    await lab.reset();
    await lab.clock('2026-12-04T13:59:00+07:00');
    const sc = await lab.citizen(CIT.somchai);
    await sc.open(`/citizen/cases/${C17}`);
    await expect(sc.tid('submit-fix-btn')).toBeEnabled();
    await sc.tid('submit-fix-btn').click();
    await expect(sc.tid('case-status')).toHaveText('กำลังตรวจสอบ');
    expect((await getCase(sc, C17)).status).toBe('IN_REVIEW');
  });

  await test.step('รอบ B 168:00 → ยกเลิกอัตโนมัติ', async () => {
    await lab.reset();
    await lab.clock(DEADLINE);
    const sc = await lab.citizen(CIT.somchai);
    await sc.open(`/citizen/cases/${C17}`);
    await expect(sc.tid('case-status')).toHaveText('ยกเลิก');
    await expect(sc.tid('case-status')).toHaveAttribute('data-status', 'CANCELLED');
    await expect(sc.tid('submit-fix-btn')).toHaveCount(0);
    await expect(sc.tid('no-refund-note')).toBeVisible();
    await expectStatus(await resubmitApi(sc, C17), 409, undefined, 'resubmit หลังเส้นตาย');
    await expect(
      sc.page.locator(`[data-testid="case-timeline"] [data-testid="timeline-item"][data-iso="${DEADLINE}"]`),
      'timeline-item เวลายกเลิก',
    ).not.toHaveCount(0);
    const exec = await lab.staff('exec1');
    expect((await dashApi(exec, '2026-12', 'ALL')).backlog, 'backlog').toBe(20);
  });
});
