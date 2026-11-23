/**
 * หมวด FEE (TEST-PLAN §3) · TC-FEE-01 (จับ B01: พื้นที่ 101 ต้อง ฿1,010)
 * ผลคาดหวังคิดจากสูตร BR-04/BR-05 ตามการ์ด ไม่ได้อ่านจากหน้าจอ
 */
import { test, expect, CIT, expectStatus } from './helpers';

const MSG_AREA = 'กรุณาระบุพื้นที่ 1–500 ตร.ม.';
const MSG_AREA_BIG = 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน';
const MSG_QTY = 'จำนวนฉบับต้อง 1–5 ฉบับ';

type Row = { v: number; total: string; fee?: number; error?: string; code?: string };

// SV-03 ตามตารางในการ์ด (ค่าที่ถูกต้อง: fee = 1,000 ถ้า ≤ 100 · 1,000 + 10 × (พื้นที่ − 100) ถ้า 101–500)
const SV03: Row[] = [
  { v: 0, total: '–', error: MSG_AREA, code: 'INVALID_AREA' },
  { v: -1, total: '–', error: MSG_AREA, code: 'INVALID_AREA' },
  { v: 1, total: '฿1,000', fee: 1000 },
  { v: 100, total: '฿1,000', fee: 1000 },
  { v: 101, total: '฿1,010', fee: 1010 }, // B01
  { v: 102, total: '฿1,020', fee: 1020 },
  { v: 250, total: '฿2,500', fee: 2500 },
  { v: 300, total: '฿3,000', fee: 3000 },
  { v: 499, total: '฿4,990', fee: 4990 },
  { v: 500, total: '฿5,000', fee: 5000 },
  { v: 501, total: '–', error: MSG_AREA_BIG, code: 'AREA_TOO_LARGE' },
];

// SV-01 ฿20 × จำนวนฉบับ (1–5) · ค่าไม่ถูกต้อง: fee-total = – และ to-upload-btn disabled ตาม CONTRACT 2.5
const SV01: Row[] = [
  { v: 0, total: '–', error: MSG_QTY, code: 'INVALID_QTY' },
  { v: 1, total: '฿20', fee: 20 },
  { v: 2, total: '฿40', fee: 40 },
  { v: 3, total: '฿60', fee: 60 },
  { v: 4, total: '฿80', fee: 80 },
  { v: 5, total: '฿100', fee: 100 },
  { v: 6, total: '–', error: MSG_QTY, code: 'INVALID_QTY' },
];

test('TC-FEE-01 · ค่าธรรมเนียม SV-01 / SV-02 / SV-03', async ({ s }) => {
  test.setTimeout(180_000);
  await s.reset();
  const page = await s.citizenPage(CIT.somchai);
  const api = page.request;

  const check = async (service: 'SV-01' | 'SV-03', inputId: 'qty-input' | 'area-input', field: 'qty' | 'areaSqm', r: Row) => {
    const input = page.getByTestId(inputId);
    await input.fill(String(r.v));
    await input.blur();
    await expect(page.getByTestId('fee-total'), `${service} ${field}=${r.v}`).toHaveText(r.total);
    if (r.error) {
      await expect(page.getByTestId('fee-error')).toHaveText(r.error);
      await expect(page.getByTestId('to-upload-btn')).toBeDisabled();
    } else {
      await expect(page.getByTestId('fee-error')).toBeHidden();
      await expect(page.getByTestId('to-upload-btn')).toBeEnabled();
    }
    // ตรวจที่ API ด้วย (ฟิลด์ fee)
    const res = await api.post('/api/drafts', { data: { serviceId: service, [field]: r.v } });
    if (r.error) {
      await expectStatus(res, 400, r.code);
    } else {
      const body = await expectStatus(res, 201);
      expect(body.fee, `API fee ${service} ${field}=${r.v}`).toBe(r.fee);
    }
  };

  await test.step('SV-03 พื้นที่ (area-input)', async () => {
    await page.goto('/citizen/new/SV-03');
    await expect(page.getByTestId('area-input')).toBeVisible();
    for (const r of SV03) await test.step(`พื้นที่ ${r.v} → ${r.total}`, () => check('SV-03', 'area-input', 'areaSqm', r));
  });

  await test.step('SV-01 จำนวนฉบับ (qty-input)', async () => {
    await page.goto('/citizen/new/SV-01');
    await expect(page.getByTestId('qty-input')).toBeVisible();
    for (const r of SV01) await test.step(`qty ${r.v} → ${r.total}`, () => check('SV-01', 'qty-input', 'qty', r));
  });

  await test.step('SV-02 ไม่มีช่องกรอก ฿500', async () => {
    await page.goto('/citizen/new/SV-02');
    await expect(page.getByTestId('fee-total')).toHaveText('฿500');
    await expect(page.getByTestId('qty-input')).toHaveCount(0);
    await expect(page.getByTestId('area-input')).toHaveCount(0);
    const body = await expectStatus(await api.post('/api/drafts', { data: { serviceId: 'SV-02' } }), 201);
    expect(body.fee).toBe(500);
  });
});
