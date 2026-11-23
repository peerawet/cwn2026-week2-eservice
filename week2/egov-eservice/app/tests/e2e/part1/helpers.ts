/**
 * helpers ของ part1 (T1: AUTH FEE SUBMIT UPLOAD PAY QUEUE SLA NOTI)
 * สูตรกลางตาม TEST-PLAN §0: RESET · CLOCK(t) · LOGIN_C · LOGIN_S · NEW_PAID
 *
 * กติกาสำคัญ (CONTRACT 0.9): POST /api/test/reset ล้าง session ของทุกคน
 *   → Session.reset() ปิด context เก่าทั้งหมด (API + browser) เพื่อบังคับให้ล็อกอินใหม่ทุกครั้ง
 * ค่าที่คาดหวังทั้งหมดอยู่ในไฟล์ spec (มาจากการ์ด TC) · helper แค่ทำขั้นตอน + ตรวจว่าขั้นตอนตั้งต้นสำเร็จ
 */
import {
  test as base,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export { expect };

// ---------------------------------------------------------------- ค่าคงที่
export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
export const T0 = '2026-12-01T09:00:00+07:00';
export const PASSWORD = 'Test@1234';
export const OTP_OK = '123456';

/** ประชาชนใน TEST-DATA 1.1 */
export const CIT = {
  somchai: '1101700123456', // สมชาย ใจดี
  somying: '3100600987659', // สมหญิง รักไทย
  mana: '5500400111221', // มานะ ตั้งใจ (ยังไม่ลงทะเบียน)
  piti: '1909900555015', // ปิติ มีสุข
} as const;

export type ServiceId = 'SV-01' | 'SV-02' | 'SV-03';

/** เลขคำขอ EG-<พ.ศ.>-<6 หลัก> */
export const EG = (n: number, be = 2569) => `EG-${be}-${String(n).padStart(6, '0')}`;
export const RC = (n: number, be = 2569) => `RC-${be}-${String(n).padStart(6, '0')}`;

// ---------------------------------------------------------------- ไฟล์ทดสอบ (สร้างโดย fixtures/global-setup.ts)
export const FILES_DIR = path.resolve(__dirname, '../../fixtures/files');
export const fixturePath = (name: string) => path.join(FILES_DIR, name);

export function mimeOf(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.txt') return 'text/plain';
  return 'application/octet-stream';
}

/** เอกสารบังคับของแต่ละบริการ (TEST-PLAN §0 NEW_PAID / TEST-DATA ข้อ 11) [docKey, ไฟล์] */
export const REQUIRED_FILES: Record<ServiceId, Array<[string, string]>> = {
  'SV-01': [['id-card', 'id-card.pdf']],
  'SV-02': [['id-card', 'id-card.pdf'], ['map', 'map.pdf']],
  'SV-03': [['id-card', 'id-card.pdf'], ['plan', 'plan.pdf'], ['deed', 'deed.pdf']],
};

/** ค่าธรรมเนียมตามกฎ BR-04/BR-05 (TEST-DATA ข้อ 2) — ใช้เป็นยอดที่จ่ายใน NEW_PAID */
export function feeByRule(service: ServiceId, opt: { qty?: number; areaSqm?: number } = {}): number {
  if (service === 'SV-01') return 20 * (opt.qty ?? 1);
  if (service === 'SV-02') return 500;
  const a = opt.areaSqm ?? 100;
  return a <= 100 ? 1000 : 1000 + 10 * (a - 100);
}

// ---------------------------------------------------------------- ตัวช่วย assert API
export async function jsonOf(res: APIResponse): Promise<any> {
  const txt = await res.text().catch(() => '');
  try {
    return txt ? JSON.parse(txt) : {};
  } catch {
    return { __raw: txt.slice(0, 300) };
  }
}

/** ตรวจ HTTP status (และ code / message ของ error ถ้าระบุ) แล้วคืน body */
export async function expectStatus(res: APIResponse, status: number, code?: string, message?: string): Promise<any> {
  const body = await jsonOf(res);
  expect(res.status(), `${res.url()} → ${res.status()} ${JSON.stringify(body)}`).toBe(status);
  if (code !== undefined) expect(body.code, `code ของ ${res.url()}`).toBe(code);
  if (message !== undefined) expect(body.message, `message ของ ${res.url()}`).toBe(message);
  return body;
}

/** เทียบเวลา ISO แบบ instant (ใช้กับฟิลด์ API ที่การ์ดไม่ได้กำหนดรูปแบบสตริง) */
export function sameInstant(actual: unknown, expectedIso: string): boolean {
  return typeof actual === 'string' && Date.parse(actual) === Date.parse(expectedIso);
}

// ---------------------------------------------------------------- Session: จัดการ context + สูตรกลาง
export class Session {
  private apis: APIRequestContext[] = [];
  private ctxs: BrowserContext[] = [];
  private hookCtx: APIRequestContext | null = null;

  constructor(private readonly browser: Browser) {}

  /** context ไม่ล็อกอิน สำหรับ /api/test/* (test hook ไม่กระตุ้นการประเมินแจ้งเตือน CONTRACT 0.7) */
  async hook(): Promise<APIRequestContext> {
    if (!this.hookCtx) this.hookCtx = await pwRequest.newContext({ baseURL: BASE_URL });
    return this.hookCtx;
  }

  /** API context ใหม่ (ยังไม่ล็อกอิน) */
  async newApi(): Promise<APIRequestContext> {
    const api = await pwRequest.newContext({ baseURL: BASE_URL });
    this.apis.push(api);
    return api;
  }

  /** browser context ใหม่ + page (ยังไม่ล็อกอิน) */
  async newPage(): Promise<Page> {
    const ctx = await this.browser.newContext({ baseURL: BASE_URL, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
    this.ctxs.push(ctx);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    return page;
  }

  /** RESET (TEST-PLAN §0) — ปิด context เก่าทุกตัว (cookie เก่าใช้ไม่ได้) แล้ว POST /api/test/reset */
  async reset(): Promise<void> {
    await this.closeActors();
    const res = await (await this.hook()).post('/api/test/reset');
    const body = await expectStatus(res, 200);
    expect(body.ok, 'reset ok').toBe(true);
    expect(body.now, 'reset now').toBe(T0);
  }

  /** CLOCK(t) — PUT /api/test/clock (นาฬิกาแช่แข็ง) */
  async clock(iso: string): Promise<void> {
    const res = await (await this.hook()).put('/api/test/clock', { data: { now: iso } });
    const body = await expectStatus(res, 200);
    expect(sameInstant(body.now, iso), `clock now=${body.now} ต้องเท่ากับ ${iso}`).toBe(true);
  }

  /** POST /api/test/payments/<ref>/pay — คืน response ดิบ ให้ spec ตรวจเอง */
  async pay(ref: string, amount: number): Promise<APIResponse> {
    return (await this.hook()).post(`/api/test/payments/${ref}/pay`, { data: { amount } });
  }

  /** pay แล้วตรวจว่า 200 PAID คืน body */
  async payOk(ref: string, amount: number): Promise<any> {
    const body = await expectStatus(await this.pay(ref, amount), 200);
    expect(body.status).toBe('PAID');
    return body;
  }

  // ---------------- LOGIN_C / LOGIN_S ผ่าน API
  /** LOGIN_C(เลขบัตร) ผ่าน API → APIRequestContext ที่มี cookie */
  async citizenApi(idNo: string): Promise<APIRequestContext> {
    const api = await this.newApi();
    await loginCitizenVia(api, idNo);
    return api;
  }

  /** LOGIN_S(user) ผ่าน API → APIRequestContext ที่มี cookie */
  async staffApi(username: string): Promise<APIRequestContext> {
    const api = await this.newApi();
    await loginStaffVia(api, username);
    return api;
  }

  /** LOGIN_C ผ่าน API ของ browser context (cookie ใช้ร่วมกับหน้าเว็บ) → page (ยังไม่ goto) · page.request ใช้ยิง API ได้ */
  async citizenPage(idNo: string): Promise<Page> {
    const page = await this.newPage();
    await loginCitizenVia(page.request, idNo);
    return page;
  }

  /** LOGIN_S ผ่าน API ของ browser context → page (ยังไม่ goto) */
  async staffPage(username: string): Promise<Page> {
    const page = await this.newPage();
    await loginStaffVia(page.request, username);
    return page;
  }

  /** ปิด context ของผู้ใช้ทั้งหมด (ไม่ปิด hook) */
  async closeActors(): Promise<void> {
    const apis = this.apis.splice(0);
    const ctxs = this.ctxs.splice(0);
    await Promise.all([...apis.map((a) => a.dispose().catch(() => {})), ...ctxs.map((c) => c.close().catch(() => {}))]);
  }

  async closeAll(): Promise<void> {
    await this.closeActors();
    if (this.hookCtx) await this.hookCtx.dispose().catch(() => {});
    this.hookCtx = null;
  }
}

/** test ที่มี fixture `s` (Session) — ปิด context ทั้งหมดหลังจบ test */
export const test = base.extend<{ s: Session }>({
  s: async ({ browser }, use) => {
    const s = new Session(browser);
    await use(s);
    await s.closeAll();
  },
});

// ---------------------------------------------------------------- ล็อกอิน (API)
export async function loginCitizenVia(api: APIRequestContext, idNo: string, otp = OTP_OK): Promise<any> {
  await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo } }), 200);
  const body = await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo, otp } }), 200);
  return body;
}

export async function loginStaffVia(api: APIRequestContext, username: string, password = PASSWORD): Promise<any> {
  return expectStatus(await api.post('/api/auth/staff/login', { data: { username, password } }), 200);
}

// ---------------------------------------------------------------- ล็อกอิน (หน้าเว็บ)
export async function openCitizenLogin(page: Page): Promise<void> {
  await page.goto('/login');
  const tab = page.getByTestId('login-tab-citizen');
  if (await tab.count()) await tab.click();
  await expect(page.getByTestId('thaid-id-input')).toBeVisible();
}

export async function openStaffLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-tab-staff').click();
  await expect(page.getByTestId('staff-username')).toBeVisible();
}

/** LOGIN_C ผ่านหน้า /login (ThaiD จำลอง + OTP) — รอจนออกจาก /login */
export async function uiLoginCitizen(page: Page, idNo: string): Promise<void> {
  await openCitizenLogin(page);
  await page.getByTestId('thaid-id-input').fill(idNo);
  await page.getByTestId('thaid-submit').click();
  await expect(page.getByTestId('otp-step')).toBeVisible();
  await page.getByTestId('otp-input').fill(OTP_OK);
  await page.getByTestId('otp-submit').click();
  await expect(page).toHaveURL((u) => u.pathname !== '/login');
}

/** LOGIN_S ผ่านแท็บเจ้าหน้าที่ */
export async function uiLoginStaff(page: Page, username: string, password = PASSWORD): Promise<void> {
  await openStaffLogin(page);
  await page.getByTestId('staff-username').fill(username);
  await page.getByTestId('staff-password').fill(password);
  await page.getByTestId('staff-submit').click();
}

// ---------------------------------------------------------------- ร่าง / ไฟล์ / ชำระ (API)
export async function createDraft(
  api: APIRequestContext,
  service: ServiceId,
  opt: { qty?: number; areaSqm?: number } = {},
): Promise<{ draftId: string; fee: number }> {
  const data: Record<string, unknown> = { serviceId: service };
  if (service === 'SV-01') data.qty = opt.qty ?? 1;
  if (service === 'SV-03') data.areaSqm = opt.areaSqm ?? 100;
  const body = await expectStatus(await api.post('/api/drafts', { data }), 201);
  expect(body.draftId, 'draftId').toMatch(/^DR-\d{4}$/);
  return { draftId: body.draftId, fee: body.fee };
}

/** POST /api/drafts/:id/files (multipart: file, docKey) — คืน response ดิบ */
export async function uploadApi(
  api: APIRequestContext,
  draftId: string,
  docKey: string,
  fileName: string,
  mimeType?: string,
): Promise<APIResponse> {
  return api.post(`/api/drafts/${draftId}/files`, {
    multipart: {
      docKey,
      file: { name: fileName, mimeType: mimeType ?? mimeOf(fileName), buffer: fs.readFileSync(fixturePath(fileName)) },
    },
  });
}

export async function uploadRequired(api: APIRequestContext, draftId: string, service: ServiceId): Promise<void> {
  for (const [docKey, file] of REQUIRED_FILES[service]) {
    await expectStatus(await uploadApi(api, draftId, docKey, file), 201);
  }
}

/** POST /api/drafts/:id/payment → 201 {ref, amount, qrCreatedAt, qrExpiresAt} */
export async function createPayment(api: APIRequestContext, draftId: string): Promise<any> {
  const body = await expectStatus(await api.post(`/api/drafts/${draftId}/payment`), 201);
  expect(body.ref, 'ref').toMatch(/^PP-\d{4}$/);
  return body;
}

/** ร่าง → แนบไฟล์บังคับ → สร้าง QR (ยังไม่จ่าย) */
export async function draftToQr(
  api: APIRequestContext,
  service: ServiceId,
  opt: { qty?: number; areaSqm?: number } = {},
): Promise<{ draftId: string; ref: string; fee: number }> {
  const { draftId } = await createDraft(api, service, opt);
  await uploadRequired(api, draftId, service);
  const p = await createPayment(api, draftId);
  return { draftId, ref: p.ref, fee: feeByRule(service, opt) };
}

export interface PaidCase {
  caseNo: string;
  receiptNo: string;
  ref: string;
  /** browser page ของผู้ยื่น (ล็อกอินแล้ว · page.request ใช้ยิง API ได้) */
  page: Page;
  api: APIRequestContext;
}

/**
 * NEW_PAID(ผู้ยื่น, บริการ, เวลา, ตัวเลือก) — TEST-PLAN §0
 * CLOCK(เวลา) → LOGIN_C → POST /api/drafts → แนบไฟล์บังคับ → payment → pay {amount: fee} → GET /api/payments/<ref> ได้ caseNo
 */
export async function newPaid(
  s: Session,
  opt: { idNo?: string; service?: ServiceId; at?: string; qty?: number; areaSqm?: number } = {},
): Promise<PaidCase> {
  const service = opt.service ?? 'SV-01';
  if (opt.at) await s.clock(opt.at);
  const page = await s.citizenPage(opt.idNo ?? CIT.somchai);
  const api = page.request;
  const { ref, fee } = await draftToQr(api, service, { qty: opt.qty, areaSqm: opt.areaSqm });
  const paid = await s.payOk(ref, fee);
  const pay = await expectStatus(await api.get(`/api/payments/${ref}`), 200);
  expect(pay.status).toBe('PAID');
  expect(pay.caseNo, 'GET /api/payments caseNo = caseNo จาก pay').toBe(paid.caseNo);
  return { caseNo: paid.caseNo, receiptNo: paid.receiptNo, ref, page, api };
}

// ---------------------------------------------------------------- คำขอ / เจ้าหน้าที่ (API)
export async function getCase(api: APIRequestContext, caseNo: string): Promise<any> {
  return expectStatus(await api.get(`/api/cases/${caseNo}`), 200);
}

export async function myCases(api: APIRequestContext): Promise<any[]> {
  const body = await expectStatus(await api.get('/api/cases'), 200);
  return body.items;
}

export function claimApi(api: APIRequestContext, caseNo: string): Promise<APIResponse> {
  return api.post(`/api/officer/cases/${caseNo}/claim`);
}

export function returnApi(api: APIRequestContext, caseNo: string, reason = 'xxxxxxxxxx'): Promise<APIResponse> {
  return api.post(`/api/officer/cases/${caseNo}/return`, { data: { reason } });
}

export function resubmitApi(api: APIRequestContext, caseNo: string): Promise<APIResponse> {
  return api.post(`/api/cases/${caseNo}/resubmit`);
}

/** จำนวนแถว Audit เหตุการณ์ `event` ของคำขอ caseNo (ตรวจผ่าน audit1) */
export async function auditCount(s: Session, event: string, caseNo: string): Promise<number> {
  const auditor = await s.staffApi('audit1');
  const body = await expectStatus(await auditor.get(`/api/audit?event=${encodeURIComponent(event)}`), 200);
  return (body.items as any[]).filter((r) => r.caseNo === caseNo && r.event === event).length;
}

export async function notificationsApi(api: APIRequestContext): Promise<Array<{ caseNo: string; level: string; text: string }>> {
  const body = await expectStatus(await api.get('/api/notifications'), 200);
  return body.items;
}

/** คู่ "caseNo level" เรียงแล้ว — ใช้เทียบชุดแจ้งเตือนแบบไม่สนลำดับ */
export const pairs = (items: Array<{ caseNo: string; level: string }>) =>
  items.map((i) => `${i.caseNo} ${i.level}`).sort();

// ---------------------------------------------------------------- locator
export const byId = (page: Page, testId: string) => page.getByTestId(testId);

export const queueRow = (page: Page, caseNo: string): Locator =>
  page.locator(`[data-testid="queue-row"][data-case-no="${caseNo}"]`);

export const fileItem = (page: Page, docKey: string): Locator =>
  page.locator(`[data-testid="file-item"][data-doc-key="${docKey}"]`);

/** data-case-no ของ queue-row ตามลำดับบนจอ */
export async function queueOrder(page: Page): Promise<string[]> {
  return page.getByTestId('queue-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-case-no') || ''));
}

/** ท้าย 6 หลักของเลขคำขอ */
export const tail6 = (caseNos: string[]) => caseNos.map((c) => c.slice(-6));

/** อ่าน noti-item บนหน้า /notifications */
export async function notiItemsUi(page: Page): Promise<Array<{ caseNo: string; level: string; text: string }>> {
  return page.getByTestId('noti-item').evaluateAll((els) =>
    els.map((e) => ({
      caseNo: e.getAttribute('data-case-no') || '',
      level: e.getAttribute('data-level') || '',
      text: (e.textContent || '').replace(/\s+/g, ' ').trim(),
    })),
  );
}

/** เปิด /officer/queue แล้วอ่าน workload-count */
export async function expectWorkload(page: Page, expected: string): Promise<void> {
  await page.goto('/officer/queue');
  await expect(page.getByTestId('workload-count')).toHaveText(expected);
}

/** wizard: ไปขั้นแนบเอกสาร จาก /citizen/new/:service */
export async function wizardToUpload(page: Page, service: ServiceId, opt: { qty?: number; areaSqm?: number } = {}): Promise<void> {
  await page.goto(`/citizen/new/${service}`);
  await expect(page.getByTestId('wizard-step')).toHaveText('1/3 กรอกข้อมูล');
  if (service === 'SV-01') await page.getByTestId('qty-input').fill(String(opt.qty ?? 1));
  if (service === 'SV-03') await page.getByTestId('area-input').fill(String(opt.areaSqm ?? 100));
  await expect(page.getByTestId('to-upload-btn')).toBeEnabled();
  await page.getByTestId('to-upload-btn').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
}

/**
 * แนบไฟล์ผ่าน <input type=file> data-testid=upload-input-<docKey>
 * รอ request ที่ไม่ใช่ GET (การอัปโหลด) ตอบกลับก่อน (ถ้ามี · สูงสุด 5 วินาที) เพื่อไม่ให้ assert ผ่านเพราะ
 * `upload-error` / `file-item` ของไฟล์ก่อนหน้ายังค้างอยู่ — ถ้าเว็บตรวจฝั่ง client ไม่มี request ก็ไปต่อ
 */
export async function uiUpload(
  page: Page,
  docKey: string,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const settled = page
    .waitForResponse((r) => r.request().method() !== 'GET', { timeout: 5_000 })
    .catch(() => null);
  await page.getByTestId(`upload-input-${docKey}`).setInputFiles(typeof file === 'string' ? fixturePath(file) : file);
  await settled;
}
