/**
 * helpers.ts · ส่วนที่ 2 (agent-test-2 · WORKFLOW DOC PDPA DASH AUDIT RBAC NFR)
 *
 * เขียนจาก TEST-PLAN §0 (สูตรกลาง) + CONTRACT + TEST-DATA เท่านั้น — ไม่อ่านโค้ดเว็บ
 * - RESET ปิด browser context / request context เดิมทั้งหมด (CONTRACT 0.9: reset ล้าง session ทุกคน)
 *   หลัง RESET ต้องเรียก lab.staff()/lab.citizen() ใหม่เสมอ (ใช้ Actor เก่าไม่ได้ เพราะ context ถูกปิดแล้ว)
 * - Actor = 1 ผู้ใช้ = 1 BrowserContext (page + ctx.request ใช้ cookie ร่วมกัน)
 * - ตัวอ่าน xlsx/pdf/csv เขียนเองด้วย Node built-in (zlib) ไม่ใช้ไลบรารีภายนอก
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import {
  test as base,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
  type Response,
  type Route,
} from '@playwright/test';

/** PW_VIDEO=on → อัดวิดีโอของทุก context ที่เทสต์สร้างเอง (config use.video ครอบคลุมเฉพาะ page fixture) ลง test-results/by-tc/<รหัส TC>/ ไว้ทำ GIF */
const videoOpt = () => (process.env.PW_VIDEO === "on" ? { recordVideo: { dir: path.join("test-results", "by-tc", (base.info().title.match(/^(TC-[A-Z]+-\d+)/) || [])[1] ?? "misc"), size: { width: 800, height: 450 } } } : {});

export { expect };

// ───────────────────────── ค่าคงที่ (TEST-DATA / CONTRACT) ─────────────────────────

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
/** BASE_URL ไม่มี / ท้าย ใช้ประกอบ URL ที่คาดหวัง เช่น doc-qr data-url */
export const BASE = BASE_URL.replace(/\/+$/, '');
export const T0 = '2026-12-01T09:00:00+07:00';
export const PASSWORD = 'Test@1234';
export const OTP = '123456';
/** ขีดกลาง en dash U+2013 (ค่า "–" ของทันกำหนด % และในข้อความ 1–60 ฯลฯ) */
export const EN_DASH = '–';
/** ลูกศร U+2192 ใน audit-transition / detail */
export const ARROW = '→';

export const CIT = {
  somchai: '1101700123456',
  somying: '3100600987659',
  mana: '5500400111221',
  piti: '1909900555015',
} as const;

/** ค่าข้อมูลส่วนบุคคลของ seed ทั้งหมด (TC-NFR-04 / PDPA) */
export const SEED_IDS = ['1101700123456', '3100600987659', '1909900555015', '5500400111221'];
export const SEED_IDS_DASHED = ['1-1017-00123-45-6', '3-1006-00987-65-9', '1-9099-00555-01-5', '5-5004-00111-22-1'];
export const SEED_PHONES = ['0812345678', '0823456789', '0834567890', '0845678901'];
export const SEED_NAMES = ['สมชาย', 'สมหญิง', 'ปิติ', 'มานะ'];

/** เลขคำขอ ปี 2569: cn(25) = EG-2569-000025 */
export const cn = (n: number): string => `EG-2569-${String(n).padStart(6, '0')}`;

export const STATUS_TH: Record<string, string> = {
  DRAFT: 'ร่าง',
  PENDING_PAYMENT: 'รอชำระเงิน',
  SUBMITTED: 'ส่งคำขอแล้ว',
  IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติ',
  COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};
export const LEVEL_TH: Record<string, string> = {
  normal: 'ปกติ',
  near: 'ใกล้ครบกำหนด',
  overdue: 'เกินกำหนด',
  paused: 'หยุดนับ',
  closed: 'ปิดแล้ว',
};

/** ข้อความ error ตรงตัวอักษร (CONTRACT ตาราง 5) */
export const MSG = {
  reasonTooShort: 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร',
  reasonRequired: 'กรุณากรอกเหตุผล',
  returnLimit: 'ตีกลับได้สูงสุด 2 ครั้ง',
  notFound: 'ไม่พบคำขอ',
  forbiddenPage: 'ไม่มีสิทธิ์เข้าถึงหน้านี้',
  invalidFee: `ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0${EN_DASH}100,000 บาท`,
  invalidSla: `SLA ต้องเป็นจำนวนเต็ม 1${EN_DASH}60 วันทำการ`,
  duplicateHoliday: 'มีวันหยุดนี้อยู่แล้ว',
  noRefund: 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน',
} as const;

export const SERVICE_NAME: Record<string, string> = {
  'SV-01': 'SV-01 ขอหนังสือรับรอง',
  'SV-02': 'SV-02 ขออนุญาตประกอบกิจการ',
  'SV-03': 'SV-03 ขออนุญาตก่อสร้าง/ต่อเติมอาคาร',
};

/** เอกสารบังคับต่อบริการ (TEST-PLAN §0 NEW_PAID / TEST-DATA ข้อ 11) */
const REQUIRED_DOCS: Record<'SV-01' | 'SV-02' | 'SV-03', string[]> = {
  'SV-01': ['id-card'],
  'SV-02': ['id-card', 'map'],
  'SV-03': ['id-card', 'plan', 'deed'],
};

// ───────────────────────── ไฟล์ทดสอบ ─────────────────────────

/** ไฟล์ของ T1 (globalSetup) อยู่ที่ app/tests/fixtures/files/<ชื่อตาม TEST-DATA> */
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'fixtures', 'files');
/** สำรอง: ถ้า T1 ยังไม่สร้าง PDF เล็ก สร้างเองที่นี่ตอนรัน (สูตร pdf(1024) ของ TEST-DATA ข้อ 11) */
const GEN_DIR = path.resolve(__dirname, '.generated-files');
const SMALL_PDFS = new Set(['id-card.pdf', 'map.pdf', 'plan.pdf', 'deed.pdf', 'ok-id.pdf']);

function makePdf(n: number): Buffer {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'latin1');
  const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
  return Buffer.concat([head, Buffer.alloc(n - head.length - tail.length, 0x20), tail]);
}

export function testFilePath(name: string): string {
  const p = path.join(FIXTURE_DIR, name);
  if (fs.existsSync(p)) return p;
  if (!SMALL_PDFS.has(name)) throw new Error(`ไม่พบไฟล์ทดสอบ ${p} (ต้องสร้างโดย globalSetup ของ T1)`);
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const g = path.join(GEN_DIR, name);
  if (!fs.existsSync(g) || fs.statSync(g).size !== 1024) fs.writeFileSync(g, makePdf(1024));
  return g;
}
export const testFile = (name: string): Buffer => fs.readFileSync(testFilePath(name));

// ───────────────────────── HTTP ช่วยตรวจ ─────────────────────────

export function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** ตรวจ HTTP status (+ code ของ error ถ้าระบุ) แล้วคืน JSON (ถ้า parse ได้) */
export async function expectStatus(res: APIResponse, status: number, code?: string, label?: string): Promise<any> {
  const text = await res.text().catch(() => '');
  const msg = `${label ? label + ' ' : ''}[${res.url()}] → HTTP ${res.status()} ${text.slice(0, 400)}`;
  expect(res.status(), msg).toBe(status);
  const j = parseJson(text);
  if (code !== undefined) expect(j?.code, msg).toBe(code);
  return j;
}

// ───────────────────────── Actor / Lab ─────────────────────────

export type Viewport = { width: number; height: number };

export class Actor {
  constructor(
    readonly label: string,
    readonly ctx: BrowserContext,
    readonly page: Page,
  ) {}
  /** APIRequestContext ที่ใช้ cookie ร่วมกับ browser context ของผู้ใช้นี้ */
  get api(): APIRequestContext {
    return this.ctx.request;
  }
  tid(id: string): Locator {
    return this.page.getByTestId(id);
  }
  open(p: string): Promise<Response | null> {
    return this.page.goto(p);
  }
}

export class Lab {
  private actors: Actor[] = [];
  private hookCtx: APIRequestContext | undefined;

  constructor(private readonly browser: Browser) {}

  /** request context เปล่า (ไม่มี cookie) สำหรับ /api/test/* */
  async hook(): Promise<APIRequestContext> {
    if (!this.hookCtx) this.hookCtx = await pwRequest.newContext({ baseURL: BASE_URL });
    return this.hookCtx;
  }

  /** RESET: POST /api/test/reset → 200 now = T0 · ปิด context เดิมทั้งหมด (ต้องล็อกอินใหม่) */
  async reset(): Promise<void> {
    await this.closeActors();
    const res = await (await this.hook()).post('/api/test/reset');
    const j = await expectStatus(res, 200, undefined, 'RESET');
    expect(j?.now, 'RESET ต้องคืน now = 2026-12-01T09:00:00+07:00').toBe(T0);
  }

  /** CLOCK(t): PUT /api/test/clock {"now":t} */
  async clock(now: string): Promise<void> {
    const res = await (await this.hook()).put('/api/test/clock', { data: { now } });
    await expectStatus(res, 200, undefined, `CLOCK(${now})`);
  }

  async pay(ref: string, amount: number): Promise<APIResponse> {
    return (await this.hook()).post(`/api/test/payments/${ref}/pay`, { data: { amount } });
  }

  /** ผู้ใช้ไม่ล็อกอิน (context ใหม่ ไม่มี cookie) */
  async anon(label = 'anon', viewport?: Viewport): Promise<Actor> {
    const ctx = await this.browser.newContext({
      baseURL: BASE_URL,
      locale: 'th-TH',
      timezoneId: 'Asia/Bangkok',
      ...(viewport ? { viewport } : {}),
      ...videoOpt(),
    });
    const page = await ctx.newPage();
    const a = new Actor(label, ctx, page);
    this.actors.push(a);
    return a;
  }

  /** LOGIN_S(user): POST /api/auth/staff/login รหัสผ่าน Test@1234 */
  async staff(username: string, viewport?: Viewport): Promise<Actor> {
    const a = await this.anon(username, viewport);
    const res = await a.api.post('/api/auth/staff/login', { data: { username, password: PASSWORD } });
    await expectStatus(res, 200, undefined, `LOGIN_S(${username})`);
    return a;
  }

  /** LOGIN_C(idNo): thaid/start → thaid/verify OTP 123456 · registered ตามที่คาด (มานะ = false) */
  async citizen(idNo: string, opts: { registered?: boolean; viewport?: Viewport } = {}): Promise<Actor> {
    const a = await this.anon(`citizen ${idNo}`, opts.viewport);
    await expectStatus(await a.api.post('/api/auth/thaid/start', { data: { idNo } }), 200, undefined, `LOGIN_C start ${idNo}`);
    const j = await expectStatus(
      await a.api.post('/api/auth/thaid/verify', { data: { idNo, otp: OTP } }),
      200,
      undefined,
      `LOGIN_C verify ${idNo}`,
    );
    expect(j?.registered, `LOGIN_C(${idNo}) registered`).toBe(opts.registered ?? true);
    return a;
  }

  /**
   * NEW_PAID(ผู้ยื่น, บริการ, เวลา, ตัวเลือก) ตาม TEST-PLAN §0:
   * CLOCK → LOGIN_C → POST /api/drafts → แนบไฟล์บังคับ → POST payment → test pay → GET /api/payments/<ref> ได้ caseNo
   */
  async newPaid(o: {
    service: 'SV-01' | 'SV-02' | 'SV-03';
    at: string;
    idNo?: string;
    qty?: number;
    areaSqm?: number;
    expectFee?: number;
  }): Promise<{ caseNo: string; fee: number; ref: string; draftId: string; citizen: Actor }> {
    await this.clock(o.at);
    const c = await this.citizen(o.idNo ?? CIT.somchai);
    const body: Record<string, unknown> = { serviceId: o.service };
    if (o.service === 'SV-01') body.qty = o.qty ?? 1;
    if (o.service === 'SV-03') body.areaSqm = o.areaSqm ?? 100;
    const d = await expectStatus(await c.api.post('/api/drafts', { data: body }), 201, undefined, 'NEW_PAID POST /api/drafts');
    const draftId: string = d?.draftId;
    const fee: number = d?.fee;
    if (o.expectFee !== undefined) expect(fee, `NEW_PAID ${o.service} fee`).toBe(o.expectFee);
    for (const docKey of REQUIRED_DOCS[o.service]) {
      const name = `${docKey}.pdf`;
      const res = await c.api.post(`/api/drafts/${draftId}/files`, {
        multipart: { file: { name, mimeType: 'application/pdf', buffer: testFile(name) }, docKey },
      });
      await expectStatus(res, 201, undefined, `NEW_PAID upload ${name}`);
    }
    const p = await expectStatus(await c.api.post(`/api/drafts/${draftId}/payment`, { data: {} }), 201, undefined, 'NEW_PAID payment');
    const ref: string = p?.ref;
    const paid = await expectStatus(await this.pay(ref, fee), 200, undefined, `NEW_PAID pay ${ref}`);
    expect(paid?.status, 'NEW_PAID pay status').toBe('PAID');
    const pay = await expectStatus(await c.api.get(`/api/payments/${ref}`), 200, undefined, `GET /api/payments/${ref}`);
    expect(String(pay?.caseNo ?? ''), 'NEW_PAID caseNo').toMatch(/^EG-\d{4}-\d{6}$/);
    return { caseNo: pay.caseNo, fee, ref, draftId, citizen: c };
  }

  async closeActors(): Promise<void> {
    const list = this.actors;
    this.actors = [];
    await Promise.all(list.map((a) => a.ctx.close().catch(() => {})));
  }

  async dispose(): Promise<void> {
    await this.closeActors();
    await this.hookCtx?.dispose().catch(() => {});
    this.hookCtx = undefined;
  }
}

/** test ที่มี fixture `lab` (ทุก spec ใน part2 import test จากไฟล์นี้) */
export const test = base.extend<{ lab: Lab }>({
  lab: async ({ browser }, use) => {
    const lab = new Lab(browser);
    await use(lab);
    await lab.dispose();
  },
});

// ───────────────────────── API ของเจ้าหน้าที่ / ประชาชน (CONTRACT 6.2–6.4) ─────────────────────────

export const claimApi = (a: Actor, c: string) => a.api.post(`/api/officer/cases/${c}/claim`, { data: {} });
export const returnApi = (a: Actor, c: string, reason: string) =>
  a.api.post(`/api/officer/cases/${c}/return`, { data: { reason } });
export const forwardApi = (a: Actor, c: string, note?: string) =>
  a.api.post(`/api/officer/cases/${c}/forward`, { data: note === undefined ? {} : { note } });
export const approveApi = (a: Actor, c: string) => a.api.post(`/api/cases/${c}/approve`, { data: {} });
export const rejectApi = (a: Actor, c: string, reason: string) => a.api.post(`/api/cases/${c}/reject`, { data: { reason } });
export const issueApi = (a: Actor, c: string) => a.api.post(`/api/officer/cases/${c}/issue`, { data: {} });
export const unmaskApi = (a: Actor, c: string, reason: string) =>
  a.api.post(`/api/officer/cases/${c}/unmask`, { data: { reason } });
/** ส่งแก้ (multipart ไม่บังคับ → ส่ง body ว่าง) */
export const resubmitApi = (a: Actor, c: string) => a.api.post(`/api/cases/${c}/resubmit`);

export async function getCase(a: Actor, c: string): Promise<any> {
  return expectStatus(await a.api.get(`/api/cases/${c}`), 200, undefined, `${a.label} GET /api/cases/${c}`);
}

export async function dashApi(a: Actor, period = '2026-12', service = 'ALL'): Promise<any> {
  return expectStatus(
    await a.api.get(`/api/dashboard?period=${encodeURIComponent(period)}&service=${encodeURIComponent(service)}`),
    200,
    undefined,
    `GET /api/dashboard ${period} ${service}`,
  );
}

/** approve (ผู้ถือ SV-01) แล้ว issue → คืน { docNo, verifyCode } */
export async function approveAndIssue(a: Actor, c: string): Promise<{ docNo: string; verifyCode: string }> {
  const ap = await expectStatus(await approveApi(a, c), 200, undefined, `${a.label} approve ${c}`);
  expect(ap?.status).toBe('APPROVED');
  return issueOnly(a, c);
}

export async function issueOnly(a: Actor, c: string): Promise<{ docNo: string; verifyCode: string }> {
  const j = await expectStatus(await issueApi(a, c), 200, undefined, `${a.label} issue ${c}`);
  expect(j?.status).toBe('COMPLETED');
  expect(String(j?.verifyCode ?? '')).toMatch(/^[A-Z0-9]{8}$/);
  return { docNo: j.docNo, verifyCode: j.verifyCode };
}

// ───────────────────────── UI ช่วย ─────────────────────────

/** แถวที่กรองด้วย data-* เช่น row(page,'queue-row','data-case-no',cn(25)) */
export function row(page: Page, testid: string, attr: string, value: string): Locator {
  return page.locator(`[data-testid="${testid}"][${attr}="${value}"]`);
}

export async function attrList(loc: Locator, attr: string): Promise<string[]> {
  return loc.evaluateAll((els, a) => els.map((e) => e.getAttribute(a as string) ?? ''), attr);
}

export async function textList(loc: Locator): Promise<string[]> {
  return loc.evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

export async function trimmedText(loc: Locator): Promise<string> {
  return (await loc.innerText()).replace(/\s+/g, ' ').trim();
}

/**
 * ทำ action แล้วรอผลที่โหลดใหม่ (form submit = navigation หรือ fetch) ที่ URL ตรง urlRe
 * ถ้าเป็น navigation รอจนหน้าใหม่ load เสร็จ (กันการกดต่อบนหน้าเก่า)
 */
export async function waitAfter(page: Page, urlRe: RegExp, action: () => Promise<unknown>): Promise<void> {
  const respP = page
    .waitForResponse(
      (r) => urlRe.test(r.url()) && r.status() < 300 && ['document', 'fetch', 'xhr'].includes(r.request().resourceType()),
      { timeout: 8_000 },
    )
    .catch(() => null);
  await action();
  const r = await respP;
  if (r && r.request().resourceType() === 'document' && r.frame() === page.mainFrame()) {
    const target = r.url();
    await page.waitForURL((u) => u.href === target, { waitUntil: 'load', timeout: 10_000 }).catch(() => {});
  }
}

/**
 * ตีกลับ / ไม่อนุมัติ / แสดงเลขเต็ม ผ่านหน้าจอ:
 * กดปุ่มเปิดฟอร์ม (ถ้าช่องเหตุผลยังไม่แสดง) → กรอกเหตุผล → กดยืนยัน
 */
export async function reasonSubmit(page: Page, kind: 'return' | 'reject' | 'unmask', reason: string): Promise<void> {
  const ids = {
    return: ['return-btn', 'return-reason', 'return-submit'],
    reject: ['reject-btn', 'reject-reason', 'reject-submit'],
    unmask: ['show-full-id-btn', 'unmask-reason', 'unmask-submit'],
  }[kind];
  const input = page.getByTestId(ids[1]);
  if (!(await input.isVisible())) await page.getByTestId(ids[0]).click();
  await input.fill(reason);
  await page.getByTestId(ids[2]).click();
}

/** เลือก period-select / service-select บน /dashboard แล้วรอผลโหลด */
export async function dashSelect(page: Page, period: string, service: string): Promise<void> {
  for (const [id, v] of [
    ['period-select', period],
    ['service-select', service],
  ] as const) {
    const sel = page.getByTestId(id);
    if ((await sel.inputValue()) === v) continue;
    await waitAfter(page, /dashboard/i, () => sel.selectOption(v));
    await expect(page.getByTestId(id)).toHaveValue(v);
  }
}

export async function expectKpis(
  page: Page,
  k: Partial<Record<'received' | 'closed' | 'ontime' | 'backlog' | 'overdue', string>>,
  label = '',
): Promise<void> {
  const map = { received: 'kpi-received', closed: 'kpi-closed', ontime: 'kpi-ontime-pct', backlog: 'kpi-backlog', overdue: 'kpi-overdue' };
  for (const [key, val] of Object.entries(k)) {
    if (val === undefined) continue;
    await expect(page.getByTestId(map[key as keyof typeof map]), `${label} ${map[key as keyof typeof map]}`).toHaveText(val);
  }
}

export async function readKpis(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const id of ['kpi-received', 'kpi-closed', 'kpi-ontime-pct', 'kpi-backlog', 'kpi-overdue']) {
    out.push(await trimmedText(page.getByTestId(id)));
  }
  return out;
}

/** ตัวกรองหน้า /audit (ช่องที่ไม่ระบุ = ว่าง) แล้วกด audit-apply-btn */
export async function auditFilter(page: Page, f: { actor?: string; event?: string; from?: string; to?: string } = {}): Promise<void> {
  await page.getByTestId('audit-filter-actor').fill(f.actor ?? '');
  await page.getByTestId('audit-filter-event').selectOption({ value: f.event ?? '' });
  await page.getByTestId('audit-filter-from').fill(f.from ?? '');
  await page.getByTestId('audit-filter-to').fill(f.to ?? '');
  await waitAfter(page, /audit/i, () => page.getByTestId('audit-apply-btn').click());
}

export type AuditRowUI = {
  id: string;
  event: string;
  actor: string;
  caseNo: string;
  time: string;
  actorText: string;
  role: string;
  eventText: string;
  caseNoText: string;
  transition: string;
  detail: string;
};

export async function readAuditRows(page: Page): Promise<AuditRowUI[]> {
  return page.getByTestId('audit-row').evaluateAll((rows) =>
    rows.map((r) => {
      const q = (id: string) => r.querySelector(`[data-testid="${id}"]`);
      const t = (id: string) => (q(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        id: r.getAttribute('data-id') ?? '',
        event: r.getAttribute('data-event') ?? '',
        actor: r.getAttribute('data-actor') ?? '',
        caseNo: r.getAttribute('data-case-no') ?? '',
        time: q('audit-time')?.getAttribute('data-iso') ?? '',
        actorText: t('audit-actor'),
        role: t('audit-role'),
        eventText: t('audit-event'),
        caseNoText: t('audit-case-no'),
        transition: t('audit-transition'),
        detail: t('audit-detail'),
      };
    }),
  );
}

/** เปิด /audit ของ auditor แล้วกรองตามที่ระบุ · ตรวจ audit-count = n แล้วคืนแถว */
export async function auditRowsFor(
  auditor: Actor,
  f: { actor?: string; event?: string; from?: string; to?: string },
  count: number,
  label = '',
): Promise<AuditRowUI[]> {
  await auditor.open('/audit');
  await auditFilter(auditor.page, f);
  await expect(auditor.tid('audit-count'), `${label} audit-count`).toHaveText(String(count));
  await expect(auditor.tid('audit-row'), `${label} จำนวน audit-row`).toHaveCount(count);
  return readAuditRows(auditor.page);
}

/** ตรวจการ์ดผล /verify/<code> */
export async function openVerify(a: Actor, code: string): Promise<Response | null> {
  return a.open(`/verify/${code}`);
}

export async function expectVerifyResult(a: Actor, text: string, code: string): Promise<void> {
  await expect(a.tid('verify-result')).toHaveText(text);
  await expect(a.tid('verify-result')).toHaveAttribute('data-result', code);
}

// ───────────────────────── ดักไฟล์ดาวน์โหลด ─────────────────────────

/** viaDownload = true เมื่อได้ไฟล์จากเหตุการณ์ download ของเบราว์เซอร์ (ลิงก์ <a download>) ซึ่งอ่าน header ไม่ได้ */
export type Captured = { url: string; status: number; headers: Record<string, string>; body: Buffer; viaDownload?: boolean };

/**
 * กดปุ่มดาวน์โหลด/ส่งออกแล้วดักไฟล์ได้ 2 ทาง ทั้งสองทางเซิร์ฟเวอร์ได้รับคำขอเพียงครั้งเดียว
 * (ไม่เรียกซ้ำ จึงไม่เพิ่มแถว Audit EXPORT)
 *  1) context.route + route.fetch ส่งต่อ response เดิม — ใช้กับ fetch/XHR/ลิงก์ที่ไม่มี attribute download
 *     จับเมื่อ HTTP 2xx และ (URL ตรง match.url หรือ Content-Type ตรง match.contentType) และไม่ใช่หน้า HTML
 *  2) เหตุการณ์ download ของเบราว์เซอร์ — ลิงก์ <a download> ถูกจัดการก่อนถึงชั้นเครือข่าย
 *     จึงไม่ผ่าน route (ตรวจแล้ว: route/response/CDP ไม่เห็นคำขอ) · จับเมื่อ URL ตรง match.url เท่านั้น
 *     และ headers เป็นค่าว่าง (ถ้าต้องตรวจ header ให้ตรวจด้วยคำขอตรงในขั้นถัดไปที่ไม่กระทบจำนวน Audit)
 */
export async function captureFile(
  a: Actor,
  match: { url?: RegExp; contentType?: RegExp },
  action: () => Promise<unknown>,
  timeoutMs = 20_000,
): Promise<Captured> {
  let resolve!: (c: Captured) => void;
  const got = new Promise<Captured>((r) => (resolve = r));
  let done = false;
  const skipTypes = new Set(['image', 'stylesheet', 'font', 'script', 'media', 'manifest', 'websocket', 'eventsource']);
  const handler = async (route: Route) => {
    const req = route.request();
    if (done || skipTypes.has(req.resourceType())) {
      await route.continue().catch(() => {});
      return;
    }
    let resp;
    try {
      resp = await route.fetch({ maxRedirects: 0 });
    } catch {
      await route.continue().catch(() => {});
      return;
    }
    const headers = resp.headers();
    const ct = headers['content-type'] ?? '';
    const ok = resp.status() >= 200 && resp.status() < 300 && !/text\/html/i.test(ct);
    const hit = ok && ((match.url && match.url.test(req.url())) || (match.contentType && match.contentType.test(ct)));
    if (!done && hit) {
      done = true;
      const body = await resp.body();
      resolve({ url: req.url(), status: resp.status(), headers, body });
      await route.fulfill({ response: resp, body }).catch(() => {});
      return;
    }
    await route.fulfill({ response: resp }).catch(() => {});
  };
  const onDownload = async (d: Download) => {
    if (done || !match.url || !match.url.test(d.url())) return;
    done = true;
    const chunks: Buffer[] = [];
    for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
    resolve({ url: d.url(), status: 200, headers: {}, body: Buffer.concat(chunks), viaDownload: true });
  };
  const watched = new Set<Page>();
  const watch = (p: Page) => {
    if (watched.has(p)) return;
    watched.add(p);
    p.on('download', onDownload);
  };
  a.ctx.pages().forEach(watch);
  a.ctx.on('page', watch);
  await a.ctx.route('**/*', handler);
  let timer: NodeJS.Timeout | undefined;
  try {
    await action();
    return await Promise.race([
      got,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`ไม่พบไฟล์ที่ดาวน์โหลด (url ${match.url} / content-type ${match.contentType}) ภายใน ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    a.ctx.off('page', watch);
    watched.forEach((p) => p.off('download', onDownload));
    await a.ctx.unroute('**/*', handler).catch(() => {});
  }
}

// ───────────────────────── อ่าน zip / xlsx ─────────────────────────

/** แตก zip ด้วย Node built-in (อ่าน central directory · method 0 store / 8 deflate) */
export function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ไม่ใช่ไฟล์ zip/xlsx (ไม่พบ End Of Central Directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip central directory ไม่ถูกต้อง');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`zip compression method ${method} ไม่รองรับ (${name})`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function xmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    return e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10));
  });
}

function xmlTexts(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(xmlDecode(m[1]));
  return out;
}

function sheetCells(xml: string, shared: string[]): Map<string, string> {
  const cells = new Map<string, string>();
  const re = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
    const v = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
    let val = '';
    if (t === 's') val = shared[Number(v)] ?? '';
    else if (t === 'inlineStr') val = xmlTexts(inner).join('');
    else val = v !== undefined ? xmlDecode(v) : '';
    cells.set(ref, val);
  }
  return cells;
}

/** อ่าน xlsx: ชีตแรก (ตาม workbook.xml) เป็น Map ช่อง→ข้อความ และข้อความทุกเซลล์ทุกชีต */
export function readXlsx(buf: Buffer): { first: Map<string, string>; allText: string[] } {
  const files = unzip(buf);
  const str = (n: string) => files.get(n)?.toString('utf8');
  const sstXml = str('xl/sharedStrings.xml') ?? '';
  const shared: string[] = [];
  const siRe = /<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(sstXml))) shared.push(xmlTexts(m[1].replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '')).join(''));

  let firstPath = 'xl/worksheets/sheet1.xml';
  const wb = str('xl/workbook.xml');
  const rels = str('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = /<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
    if (rid) {
      const relRe = /<Relationship\b[^>]*>/g;
      let r: RegExpExecArray | null;
      while ((r = relRe.exec(rels))) {
        if (new RegExp(`\\bId="${rid}"`).test(r[0])) {
          const target = /\bTarget="([^"]+)"/.exec(r[0])?.[1];
          if (target) firstPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
        }
      }
    }
  }
  const firstXml = str(firstPath);
  if (!firstXml) throw new Error(`ไม่พบชีตแรก ${firstPath} ใน xlsx (มี: ${[...files.keys()].join(', ')})`);
  const first = sheetCells(firstXml, shared);
  const allText = [...shared];
  for (const [name, data] of files) {
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) allText.push(...sheetCells(data.toString('utf8'), shared).values());
  }
  return { first, allText };
}

// ───────────────────────── อ่าน PDF ─────────────────────────

/** เนื้อ stream ทั้งหมด (ถ้า FlateDecode ได้ก็ inflate ให้) เป็น latin1 */
export function pdfStreams(buf: Buffer): string[] {
  const s = buf.toString('latin1');
  const out: string[] = [];
  const re = /(?<![A-Za-z])stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const data = buf.subarray(start, end);
    let txt: string;
    try {
      txt = zlib.inflateSync(data).toString('latin1');
    } catch {
      try {
        txt = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1');
      } catch {
        txt = data.toString('latin1');
      }
    }
    out.push(txt);
    re.lastIndex = end + 'endstream'.length;
  }
  return out;
}

/** ข้อความสำหรับค้นบรรทัด ASCII (ไบต์ดิบ + stream ที่แตกแล้ว) */
export function pdfSearchable(buf: Buffer): string {
  return [buf.toString('latin1'), ...pdfStreams(buf)].join('\n');
}

function pdfLiteral(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_m, e: string) => {
    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
    if (e in map) return map[e];
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return '';
  });
}

/** ข้อความที่ดึงออกจาก PDF: string literal (...) และ hex <...> (UTF-16BE ถ้ามี BOM) + บรรทัด ASCII ที่มี key=value */
export function pdfTextStrings(buf: Buffer): string[] {
  const out: string[] = [];
  for (const src of [buf.toString('latin1'), ...pdfStreams(buf)]) {
    const lit = /\((?:\\[\s\S]|[^\\()])*\)/g;
    let m: RegExpExecArray | null;
    while ((m = lit.exec(src))) out.push(pdfLiteral(m[0].slice(1, -1)));
    const hex = /<([0-9A-Fa-f\s]{2,})>/g;
    while ((m = hex.exec(src))) {
      const h = m[1].replace(/\s+/g, '');
      if (h.length % 2) continue;
      const b = Buffer.from(h, 'hex');
      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
        const sw = Buffer.from(b.subarray(2));
        sw.swap16();
        out.push(sw.toString('utf16le'));
      } else out.push(b.toString('latin1'));
    }
    for (const line of src.split(/\r?\n/)) if (/^[ -~]*\b\w+=\S/.test(line) && line.length < 400) out.push(line);
  }
  // วันที่ใน metadata ของ PDF (/CreationDate (D:20261123055909Z)) ไม่ใช่ "ข้อความ" ตามการ์ด (ตรวจบนข้อความที่ดึงออกมา)
  // ตัดเฉพาะ string รูปแบบวันที่ของ PDF · เลข 13 หลัก/เบอร์โทรในเนื้อหายังถูกตรวจเหมือนเดิม
  return out.filter((s) => !/^D:\d{8,14}([Zz]|[+-]\d{2}'?\d{0,2}'?)?$/.test(s.trim()));
}

// ───────────────────────── CSV ─────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let rowBuf: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      rowBuf.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rowBuf.push(field);
      rows.push(rowBuf);
      rowBuf = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || rowBuf.length) {
    rowBuf.push(field);
    rows.push(rowBuf);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// ───────────────────────── PDPA ช่วยตรวจ ─────────────────────────

/** ข้อความที่มีข้อมูลส่วนบุคคลต้องห้าม (BR-24): \d{13} · 0\d{9} · ชื่อ seed */
export function piiFindings(texts: string[]): string[] {
  const bad: string[] = [];
  for (const t of texts) {
    if (/\d{13}/.test(t)) bad.push(`\\d{13}: ${t.slice(0, 120)}`);
    if (/0\d{9}/.test(t)) bad.push(`0\\d{9}: ${t.slice(0, 120)}`);
    for (const n of SEED_NAMES) if (t.includes(n)) bad.push(`ชื่อ ${n}: ${t.slice(0, 120)}`);
  }
  return bad;
}

export function hasKeyDeep(v: unknown, key: string): boolean {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, key));
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k === key || hasKeyDeep(x, key)) return true;
  }
  return false;
}
