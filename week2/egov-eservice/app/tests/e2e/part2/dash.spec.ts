/**
 * หมวด DASH (TEST-PLAN §13) · TC-DASH-01 … 04
 * บั๊กที่ต้องจับ: B10 (ทันกำหนด % หารด้วยรับเรื่อง) → TC-DASH-02 (DASH-01/03 อาจล้มด้วย)
 */
import {
  test,
  expect,
  EN_DASH,
  SEED_NAMES,
  cn,
  row,
  expectStatus,
  approveApi,
  issueApi,
  rejectApi,
  dashApi,
  dashSelect,
  expectKpis,
  readKpis,
  captureFile,
  readXlsx,
  pdfSearchable,
  pdfTextStrings,
  piiFindings,
  auditRowsFor,
  type Actor,
} from './helpers';

const BACKLOG: Record<string, [number, number]> = { ALL: [21, 1], 'SV-01': [11, 1], 'SV-02': [7, 0], 'SV-03': [3, 0] };

/** "85.7%" → 85.7 · "–" → null (รูปแบบ API ontimePct) */
const pctToApi = (s: string): number | null => (s === EN_DASH ? null : Number(s.replace('%', '')));

async function checkDash(exec: Actor, period: string, service: string, received: number, closed: number, ontime: string) {
  const [backlog, overdue] = BACKLOG[service];
  const label = `${period} ${service}`;
  await dashSelect(exec.page, period, service);
  await expectKpis(
    exec.page,
    { received: String(received), closed: String(closed), ontime, backlog: String(backlog), overdue: String(overdue) },
    label,
  );
  const d = await dashApi(exec, period, service);
  expect(d.received, `${label} API received`).toBe(received);
  expect(d.closed, `${label} API closed`).toBe(closed);
  expect(d.ontimePct, `${label} API ontimePct`).toBe(pctToApi(ontime));
  expect(d.backlog, `${label} API backlog`).toBe(backlog);
  expect(d.overdue, `${label} API overdue`).toBe(overdue);
}

test('TC-DASH-01 · Dashboard ตัวเลขเริ่มต้น', async ({ lab }) => {
  await lab.reset();
  const exec = await lab.staff('exec1');
  await exec.open('/dashboard');

  await test.step('ค่าเริ่มต้น period 2026-12 · service ALL', async () => {
    await expect(exec.tid('period-select')).toHaveValue('2026-12');
    await expect(exec.tid('service-select')).toHaveValue('ALL');
  });

  await test.step('KPI บนจอ + API (ธ.ค. ALL)', async () => {
    await expectKpis(exec.page, { received: '3', closed: '0', ontime: EN_DASH, backlog: '21', overdue: '1' }, 'ธ.ค. ALL');
    const d = await dashApi(exec, '2026-12', 'ALL');
    expect(d.received).toBe(3);
    expect(d.closed).toBe(0);
    expect(d.ontimePct, 'ontimePct ต้องเป็น null เมื่อปิดงาน 0').toBeNull();
    expect(d.backlog).toBe(21);
    expect(d.overdue).toBe(1);
    const wl = Object.fromEntries((d.workload ?? []).map((w: any) => [w.username, w.count]));
    expect(wl).toEqual({ 'off.reg1': 3, 'off.reg2': 9, 'off.works1': 0 });
  });

  await test.step('workload-row 3 แถว: off.reg1 3 · off.reg2 9 · off.works1 0', async () => {
    await expect(exec.tid('workload-row')).toHaveCount(3);
    for (const [u, n] of [
      ['off.reg1', '3'],
      ['off.reg2', '9'],
      ['off.works1', '0'],
    ]) {
      await expect(row(exec.page, 'workload-row', 'data-username', u).getByTestId('workload-value')).toHaveText(n);
    }
  });

  await test.step('ไม่มีข้อมูลส่วนบุคคลใน innerText', async () => {
    const text = await exec.page.evaluate(() => document.body.innerText);
    expect(text.match(/\d{13}/)?.[0] ?? null, 'เลข 13 หลัก').toBeNull();
    expect(text.match(/0\d{9}/)?.[0] ?? null, 'เบอร์โทร').toBeNull();
    for (const n of SEED_NAMES) expect(text.includes(n), `พบชื่อ ${n}`).toBe(false);
  });

  await test.step('ตัวกรองบริการ (ธ.ค.)', async () => {
    await checkDash(exec, '2026-12', 'SV-01', 3, 0, EN_DASH);
    await checkDash(exec, '2026-12', 'SV-02', 0, 0, EN_DASH);
    await checkDash(exec, '2026-12', 'SV-03', 0, 0, EN_DASH);
  });
});

test('TC-DASH-02 · Dashboard ย้อนหลัง', async ({ lab }) => {
  test.setTimeout(150_000);
  await lab.reset();
  const exec = await lab.staff('exec1');
  await exec.open('/dashboard');
  const rows: [string, string, number, number, string][] = [
    ['2026-10', 'ALL', 1, 1, '100.0%'],
    ['2026-11', 'ALL', 26, 7, '85.7%'],
    ['2026-11', 'SV-01', 12, 3, '100.0%'],
    ['2026-11', 'SV-02', 10, 3, '66.7%'],
    ['2026-11', 'SV-03', 4, 1, '100.0%'],
    ['2026', 'ALL', 30, 8, '87.5%'],
    ['2026', 'SV-01', 16, 4, '100.0%'],
    ['2026', 'SV-02', 10, 3, '66.7%'],
    ['2026', 'SV-03', 4, 1, '100.0%'],
  ];
  for (const [period, service, received, closed, ontime] of rows) {
    await test.step(`${period} / ${service} → รับ ${received} · ปิด ${closed} · ทัน ${ontime}`, async () => {
      await checkDash(exec, period, service, received, closed, ontime);
    });
  }
});

test('TC-DASH-03 · ส่งออก Excel/PDF เท่าหน้าจอ', async ({ lab }) => {
  test.setTimeout(150_000);
  await lab.reset();
  const exec = await lab.staff('exec1');
  await exec.open('/dashboard');
  const LABELS = ['รับเรื่อง', 'ปิดงาน', 'ทันกำหนด %', 'งานคงค้าง', 'เกินกำหนดคงค้าง'];

  const exportXlsx = async (expected: string[], label: string) => {
    const screen = await readKpis(exec.page);
    expect(screen, `${label} ค่าบนจอ`).toEqual(expected);
    const f = await captureFile(exec, { url: /export/i, contentType: /spreadsheetml|excel|octet-stream/i }, () =>
      exec.tid('export-xlsx-btn').click(),
    );
    const { first, allText } = readXlsx(f.body);
    expect([first.get('A1'), first.get('B1')], `${label} หัวตาราง`).toEqual(['ตัวชี้วัด', 'ค่า']);
    for (let i = 0; i < 5; i++) {
      expect(first.get(`A${i + 2}`), `${label} A${i + 2}`).toBe(LABELS[i]);
      expect(first.get(`B${i + 2}`), `${label} B${i + 2} (${LABELS[i]})`).toBe(expected[i]);
      expect(first.get(`B${i + 2}`), `${label} B${i + 2} เท่าจอ`).toBe(screen[i]);
    }
    expect(piiFindings(allText), `${label} ข้อมูลส่วนบุคคลใน xlsx`).toEqual([]);
  };

  await test.step('พ.ย. ALL → xlsx 26 · 7 · 85.7% · 21 · 1', async () => {
    await dashSelect(exec.page, '2026-11', 'ALL');
    await expectKpis(exec.page, { received: '26', closed: '7', ontime: '85.7%', backlog: '21', overdue: '1' });
    await exportXlsx(['26', '7', '85.7%', '21', '1'], 'xlsx พ.ย.');
  });

  let pdfUrl = '';
  await test.step('พ.ย. ALL → pdf มีบรรทัด kpi', async () => {
    const f = await captureFile(exec, { url: /export/i, contentType: /application\/pdf/i }, () => exec.tid('export-pdf-btn').click());
    pdfUrl = f.url;
    // ลิงก์ <a download> อ่าน header ไม่ได้ → Content-Type ตรวจในขั้นท้ายด้วยคำขอตรง (หลังตรวจจำนวน Audit EXPORT แล้ว)
    if (!f.viaDownload) expect(f.headers['content-type'] ?? '', 'Content-Type').toMatch(/^application\/pdf/i);
    expect(f.body.subarray(0, 5).toString('latin1'), 'ไฟล์ต้องขึ้นต้นด้วย %PDF-').toBe('%PDF-');
    expect(pdfSearchable(f.body)).toMatch(/kpi received=26 closed=7 ontime=85\.7% backlog=21 overdue=1(?![0-9])/);
    expect(piiFindings(pdfTextStrings(f.body)), 'ข้อมูลส่วนบุคคลใน PDF').toEqual([]);
  });

  await test.step('ธ.ค. ALL → xlsx 3 · 0 · – · 21 · 1', async () => {
    await dashSelect(exec.page, '2026-12', 'ALL');
    await expectKpis(exec.page, { received: '3', closed: '0', ontime: EN_DASH, backlog: '21', overdue: '1' });
    await exportXlsx(['3', '0', EN_DASH, '21', '1'], 'xlsx ธ.ค.');
  });

  await test.step('Audit EXPORT = 3 แถวของ exec1', async () => {
    const auditor = await lab.staff('audit1');
    const rows = await auditRowsFor(auditor, { event: 'EXPORT' }, 3, 'EXPORT');
    for (const r of rows) {
      expect(r.actor, 'data-actor').toBe('exec1');
      expect(r.role, 'audit-role').toBe('executive');
    }
    const has = (fmt: string, period: string) => rows.filter((r) => r.detail.includes(fmt) && r.detail.includes(period)).length;
    expect(has('xlsx', '2026-11'), 'EXPORT xlsx 2026-11').toBe(1);
    expect(has('pdf', '2026-11'), 'EXPORT pdf 2026-11').toBe(1);
    expect(has('xlsx', '2026-12'), 'EXPORT xlsx 2026-12').toBe(1);
  });

  // ตรวจ Content-Type ของ PDF ด้วยคำขอตรง — ทำหลังนับ Audit EXPORT แล้ว เพราะคำขอนี้เพิ่มแถว EXPORT อีก 1 แถว
  await test.step('pdf พ.ย. → Content-Type: application/pdf', async () => {
    expect(pdfUrl, 'ต้องมี URL ของ PDF จากขั้นก่อนหน้า').not.toBe('');
    const res = await exec.ctx.request.get(pdfUrl);
    expect(res.status(), 'HTTP status ของ pdf').toBe(200);
    expect(res.headers()['content-type'] ?? '', 'Content-Type').toMatch(/^application\/pdf/i);
  });
});

test('TC-DASH-04 · ค่าขอบ "ทันกำหนด" 16:29:59 / 16:30:00 / 16:30:01', async ({ lab }) => {
  test.setTimeout(120_000);
  const C25 = cn(25);
  const C26 = cn(26);
  const C23 = cn(23);
  await lab.reset();
  await lab.clock('2026-12-03T16:00:00+07:00');
  const reg1 = await lab.staff('off.reg1');
  const reg2 = await lab.staff('off.reg2');
  const exec = await lab.staff('exec1');

  const checkAfter = async (officer: Actor, c: string, closedAt: string, closed: number, onTime: number) => {
    await officer.open(`/officer/cases/${c}`);
    await expect(officer.tid('closed-at'), `${c} closed-at`).toHaveAttribute('data-iso', closedAt);
    const d = await dashApi(exec, '2026-12', 'ALL');
    expect(d.closed, 'API closed').toBe(closed);
    expect(d.onTime, 'API onTime').toBe(onTime);
    await exec.open('/dashboard');
    await expect(exec.tid('kpi-closed')).toHaveText(String(closed));
    return d;
  };

  await test.step('1 ที่ 16:00 approve …000025 (off.reg2) และ …000023 (off.reg1)', async () => {
    expect((await expectStatus(await approveApi(reg2, C25), 200, undefined, 'approve …000025'))?.status).toBe('APPROVED');
    expect((await expectStatus(await approveApi(reg1, C23), 200, undefined, 'approve …000023'))?.status).toBe('APPROVED');
  });

  await test.step('2 16:29:59 issue …000025 → ทัน (1 · 1)', async () => {
    await lab.clock('2026-12-03T16:29:59+07:00');
    expect((await expectStatus(await issueApi(reg2, C25), 200, undefined, 'issue …000025'))?.status).toBe('COMPLETED');
    await checkAfter(reg2, C25, '2026-12-03T16:29:59+07:00', 1, 1);
  });

  await test.step('3 16:30:00 reject …000026 → ทันที่ขอบ (2 · 2)', async () => {
    await lab.clock('2026-12-03T16:30:00+07:00');
    expect((await expectStatus(await rejectApi(reg2, C26, 'xxxxxxxxxx'), 200, undefined, 'reject …000026'))?.status).toBe('REJECTED');
    await checkAfter(reg2, C26, '2026-12-03T16:30:00+07:00', 2, 2);
  });

  await test.step('4 16:30:01 issue …000023 → ไม่ทัน (3 · 2) · backlog 18', async () => {
    await lab.clock('2026-12-03T16:30:01+07:00');
    expect((await expectStatus(await issueApi(reg1, C23), 200, undefined, 'issue …000023'))?.status).toBe('COMPLETED');
    const d = await checkAfter(reg1, C23, '2026-12-03T16:30:01+07:00', 3, 2);
    expect(d.backlog, 'API backlog').toBe(18);
    await expect(exec.tid('kpi-backlog')).toHaveText('18');
  });
});
