/**
 * หมวด NFR (TEST-PLAN §16) · TC-NFR-01 … 04
 * env: BASE_URL_NO_TEST_MODE (NFR-03 ส่วนปิด hook · ไม่ตั้ง = บันทึกว่าข้าม) · DB_PATH (NFR-04 · ไม่ตั้ง = ล้ม)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { request as pwRequest, type Page } from '@playwright/test';
import {
  test,
  expect,
  BASE_URL,
  T0,
  CIT,
  OTP,
  STATUS_TH,
  LEVEL_TH,
  SEED_IDS,
  SEED_IDS_DASHED,
  SEED_PHONES,
  cn,
  expectStatus,
  claimApi,
  testFilePath,
  type Actor,
  type Lab,
} from './helpers';

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

/** UI login ประชาชนผ่าน /login (ThaiD จำลอง) */
async function uiLoginCitizen(page: Page, idNo: string) {
  await page.goto('/login');
  const tab = page.getByTestId('login-tab-citizen');
  if (await tab.count()) await tab.click();
  await page.getByTestId('thaid-id-input').fill(idNo);
  await page.getByTestId('thaid-submit').click();
  await expect(page.getByTestId('otp-step')).toBeVisible();
  await page.getByTestId('otp-input').fill(OTP);
  await page.getByTestId('otp-submit').click();
  await page.waitForURL((u) => u.pathname === '/citizen');
}

test('TC-NFR-01 · Responsive 375 / 768 / 1280', async ({ lab }) => {
  test.setTimeout(240_000);
  await lab.reset();
  const anon = await lab.anon();
  const sc = await lab.citizen(CIT.somchai);
  const reg1 = await lab.staff('off.reg1');
  const head = await lab.staff('head1');
  const exec = await lab.staff('exec1');
  const auditor = await lab.staff('audit1');
  const admin = await lab.staff('admin1');
  const pages: [Actor, string][] = [
    [anon, '/login'],
    [sc, '/citizen'],
    [sc, '/citizen/new/SV-03'],
    [sc, `/citizen/cases/${cn(13)}`],
    [reg1, '/officer/queue'],
    [reg1, `/officer/cases/${cn(20)}`],
    [head, '/head/approvals'],
    [exec, '/dashboard'],
    [auditor, '/audit'],
    [admin, '/admin/services'],
    [anon, '/verify/K7M2Q9XA'],
  ];
  let checks = 0;
  for (const vp of VIEWPORTS) {
    await test.step(`${vp.width}×${vp.height}: 11 หน้าไม่มี scroll แนวนอน`, async () => {
      for (const [a, p] of pages) {
        await a.page.setViewportSize(vp);
        await a.open(p);
        const m = await a.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        expect.soft(m.sw, `${vp.width}px ${a.label} ${p}: scrollWidth ${m.sw} > innerWidth ${m.iw}`).toBeLessThanOrEqual(m.iw);
        checks++;
      }
    });
  }
  expect(checks, 'จำนวนการตรวจ 11 หน้า × 3 ขนาด').toBe(33);

  await test.step('งานหลักที่ 375 px: ล็อกอิน → SV-01 → แนบไฟล์ → ไปชำระเงิน → create-qr-btn อยู่ในจอ', async () => {
    const m = await lab.anon('mobile', { width: 375, height: 812 });
    const page = m.page;
    await uiLoginCitizen(page, CIT.somchai);
    await page.getByTestId('start-service-SV-01').click();
    await page.waitForURL((u) => u.pathname === '/citizen/new/SV-01');
    await page.getByTestId('qty-input').fill('1');
    await expect(page.getByTestId('fee-total')).toHaveText('฿20');
    await page.getByTestId('to-upload-btn').click();
    await page.getByTestId('upload-input-id-card').setInputFiles(testFilePath('id-card.pdf'));
    await expect(page.locator('[data-testid="file-item"][data-doc-key="id-card"]')).toHaveCount(1);
    await expect(page.getByTestId('to-payment-btn')).toBeEnabled();
    await page.getByTestId('to-payment-btn').click();
    const qr = page.getByTestId('create-qr-btn');
    await expect(qr).toBeVisible();
    await qr.scrollIntoViewIfNeeded();
    const box = await qr.boundingBox();
    expect(box, 'create-qr-btn boundingBox').not.toBeNull();
    expect(box!.x, 'create-qr-btn x ≥ 0').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, 'create-qr-btn x + width ≤ 375').toBeLessThanOrEqual(375);
  });
});

// ───────────── TC-NFR-02 ─────────────

async function unlabeledFields(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) => {
      const s = getComputedStyle(el as HTMLElement);
      return el.getClientRects().length > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
      if (el instanceof HTMLInputElement && el.type === 'hidden') continue;
      if (!visible(el)) continue;
      const aria = (el.getAttribute('aria-label') ?? '').trim();
      const by = (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => (document.getElementById(id)?.textContent ?? '').trim())
        .join('');
      const labels = Array.from((el as HTMLInputElement).labels ?? [])
        .map((l) => (l.textContent ?? '').trim())
        .join('');
      if (!aria && !by && !labels) out.push(`${el.tagName.toLowerCase()}[data-testid=${el.getAttribute('data-testid') ?? '-'}]`);
    }
    return out;
  });
}

type StatusItem = { tid: string; code: string | null; text: string; visible: boolean };
async function statusItems(page: Page): Promise<StatusItem[]> {
  return page.evaluate(() => {
    const out: { tid: string; code: string | null; text: string; visible: boolean }[] = [];
    for (const tid of ['case-status', 'row-status', 'sla-level', 'row-sla-level']) {
      for (const el of Array.from(document.querySelectorAll(`[data-testid="${tid}"]`))) {
        const isLevel = tid.endsWith('level');
        let code = el.getAttribute(isLevel ? 'data-level' : 'data-status');
        if (!code) {
          const anc = el.closest(isLevel ? '[data-sla-level],[data-level]' : '[data-status]');
          code = anc ? anc.getAttribute(isLevel ? (anc.hasAttribute('data-sla-level') ? 'data-sla-level' : 'data-level') : 'data-status') : null;
        }
        out.push({ tid, code, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), visible: el.getClientRects().length > 0 });
      }
    }
    return out;
  });
}

function checkStatusItems(items: StatusItem[], label: string) {
  for (const it of items) {
    const table = it.tid.endsWith('level') ? LEVEL_TH : STATUS_TH;
    expect.soft(it.text, `${label} ${it.tid} textContent ว่าง`).not.toBe('');
    expect.soft(it.code, `${label} ${it.tid} ไม่มี data-status/data-level`).not.toBeNull();
    if (it.code) expect.soft(it.text, `${label} ${it.tid} (${it.code}) ข้อความไม่ตรง CONTRACT 4.1/4.2`).toBe(table[it.code]);
  }
}

/** กด Tab จนโฟกัส data-testid ที่ต้องการ · ตรวจทุกจุดที่โฟกัสว่ามี outline/box-shadow */
async function tabTo(page: Page, testid: string, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      document.getAnimations().forEach((a) => a.finish());
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { tid: el.getAttribute('data-testid'), tag: el.tagName, outline: cs.outlineStyle, shadow: cs.boxShadow };
    });
    if (!f) continue;
    expect
      .soft(f.outline !== 'none' || f.shadow !== 'none', `โฟกัส ${f.tag}[data-testid=${f.tid ?? '-'}] ต้องมี outline/ring มองเห็น`)
      .toBe(true);
    if (f.tid === testid) return;
  }
  throw new Error(`กด Tab ${max} ครั้งแล้วยังไม่ถึง ${testid}`);
}

test('TC-NFR-02 · WCAG: axe + คีย์บอร์ด + label + สถานะไม่ใช้สีอย่างเดียว', async ({ lab }) => {
  test.setTimeout(300_000);
  await lab.reset();
  const anon = await lab.anon();
  const mana = await lab.citizen(CIT.mana, { registered: false });
  const sc = await lab.citizen(CIT.somchai);
  const reg1 = await lab.staff('off.reg1');
  const head = await lab.staff('head1');
  const exec = await lab.staff('exec1');
  const auditor = await lab.staff('audit1');
  const admin = await lab.staff('admin1');
  const pages: [Actor, string][] = [
    [anon, '/login'],
    [mana, '/register'],
    [sc, '/citizen'],
    [sc, '/citizen/new/SV-01'],
    [sc, `/citizen/cases/${cn(17)}`],
    [reg1, '/officer/queue'],
    [reg1, `/officer/cases/${cn(20)}`],
    [head, '/head/approvals'],
    [exec, '/dashboard'],
    [auditor, '/audit'],
    [admin, '/admin/services'],
    [reg1, '/notifications'],
    [anon, '/verify/K7M2Q9XA'],
  ];
  const seenTids = new Set<string>();

  for (const [a, p] of pages) {
    await test.step(`${p} (${a.label}): axe · label · สถานะ`, async () => {
      await a.open(p);
      expect.soft(new URL(a.page.url()).pathname, `${p} เปิดได้จริง (ไม่ redirect)`).toBe(p.split('?')[0]);
      // ส่วน A axe
      // cast: @axe-core/playwright อ้าง type จาก playwright-core ตัวที่ hoist (1.65) ต่างจากของ @playwright/test 1.56 (runtime ใช้ได้)
      const r = await new AxeBuilder({ page: a.page as any }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const bad = r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect.soft(bad, `${p} axe serious/critical`).toEqual([]);
      // ส่วน C label
      expect.soft(await unlabeledFields(a.page), `${p} ช่องกรอกที่ไม่มีชื่อเข้าถึงได้`).toEqual([]);
      // ส่วน D สถานะไม่ใช้สีอย่างเดียว (ปกติ + forced colors)
      const items = await statusItems(a.page);
      items.forEach((i) => seenTids.add(i.tid));
      checkStatusItems(items, p);
      await a.page.emulateMedia({ forcedColors: 'active' });
      const forced = await statusItems(a.page);
      checkStatusItems(forced, `${p} [forced-colors]`);
      for (const it of forced) expect.soft(it.visible, `${p} [forced-colors] ${it.tid} ต้องยังมองเห็น`).toBe(true);
      await a.page.emulateMedia({ forcedColors: 'none' });
    });
  }
  for (const t of ['case-status', 'row-status', 'sla-level', 'row-sla-level']) {
    expect.soft(seenTids.has(t), `ส่วน D ต้องพบ ${t} อย่างน้อย 1 จุดในหน้าที่ตรวจ`).toBe(true);
  }

  await test.step('ส่วน B คีย์บอร์ดอย่างเดียว: ล็อกอิน → SV-01 → แนบไฟล์ → ไปชำระเงิน', async () => {
    const k = await lab.anon('keyboard');
    const page = k.page;
    await page.goto('/login');
    if (!(await page.getByTestId('thaid-id-input').isVisible())) {
      await tabTo(page, 'login-tab-citizen');
      await page.keyboard.press('Enter');
    }
    await tabTo(page, 'thaid-id-input');
    await page.keyboard.type(CIT.somchai);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('otp-input')).toBeVisible();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (focused !== 'otp-input') await tabTo(page, 'otp-input');
    await page.keyboard.type(OTP);
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => u.pathname === '/citizen');
    await tabTo(page, 'start-service-SV-01');
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => u.pathname === '/citizen/new/SV-01');
    await tabTo(page, 'qty-input');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1');
    await tabTo(page, 'to-upload-btn');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('upload-input-id-card')).toBeAttached();
    await tabTo(page, 'upload-input-id-card');
    // เลือกไฟล์จาก OS ด้วยคีย์บอร์ดไม่ได้ → ใส่ไฟล์ให้ช่องที่โฟกัสอยู่ (ไม่ใช้เมาส์)
    await page.getByTestId('upload-input-id-card').setInputFiles(testFilePath('id-card.pdf'));
    await expect(page.locator('[data-testid="file-item"][data-doc-key="id-card"]')).toHaveCount(1);
    await tabTo(page, 'to-payment-btn');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('create-qr-btn')).toBeVisible();
  });
});

// ───────────── TC-NFR-03 ─────────────

async function snapshot(lab: Lab) {
  const clock = await expectStatus(await (await lab.hook()).get('/api/test/clock'), 200, undefined, 'GET /api/test/clock');
  const reg1 = await lab.staff('off.reg1');
  const q = await expectStatus(await reg1.api.get('/api/officer/queue'), 200, undefined, 'off.reg1 GET /api/officer/queue');
  const queue = (q.items ?? []).map((x: any) => ({ caseNo: x.caseNo, dueAt: x.dueAt, status: x.status, owner: x.owner }));
  const exec = await lab.staff('exec1');
  const dash = await expectStatus(await exec.api.get('/api/dashboard?period=2026-12&service=ALL'), 200, undefined, 'dashboard');
  return { clock: clock?.now, queue, dash };
}

test('TC-NFR-03 · Health เวลาโหลด และผลซ้ำได้', async ({ lab }) => {
  test.setTimeout(180_000);

  await test.step('health: GET /api/health (ไม่มี cookie) → 200 {"status":"ok"} ตรงตัว', async () => {
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
    const j = await expectStatus(await ctx.get('/api/health'), 200, undefined, 'GET /api/health');
    expect(j).toEqual({ status: 'ok' });
    await ctx.dispose();
  });

  await test.step('เวลาโหลดรอบที่ 2 ≤ 3,000 ms', async () => {
    await lab.reset();
    const list: [Actor, string][] = [
      [await lab.anon(), '/login'],
      [await lab.citizen(CIT.somchai), '/citizen'],
      [await lab.staff('off.reg1'), '/officer/queue'],
      [await lab.staff('exec1'), '/dashboard'],
      [await lab.staff('audit1'), '/audit'],
    ];
    for (const [a, p] of list) {
      await a.page.goto(p, { waitUntil: 'load' });
      const t = Date.now();
      await a.page.goto(p, { waitUntil: 'load' });
      const ms = Date.now() - t;
      expect.soft(ms, `${p} โหลด ${ms} ms`).toBeLessThanOrEqual(3000);
    }
  });

  await test.step('ผลซ้ำได้: RESET → S1 → เปลี่ยนสถานะ → RESET → S2 · S1 = S2', async () => {
    await lab.reset();
    const s1 = await snapshot(lab);
    expect(s1.clock).toBe(T0);
    // เปลี่ยนสถานะ: นาฬิกา · claim …000028 · ชำระใหม่ 1 ใบ
    await lab.clock('2026-12-10T12:00:00+07:00');
    const reg1 = await lab.staff('off.reg1');
    await expectStatus(await claimApi(reg1, cn(28)), 200, undefined, 'claim …000028');
    await lab.newPaid({ service: 'SV-01', at: '2026-12-10T12:00:00+07:00', qty: 1 });
    await lab.reset();
    const s2 = await snapshot(lab);
    expect(s2).toEqual(s1);
    expect(s2.clock).toBe(T0);
  });

  await test.step('นาฬิกาไม่มี offset → 400 INVALID_TIME', async () => {
    const r = await (await lab.hook()).put('/api/test/clock', { data: { now: '2026-12-01 09:00' } });
    await expectStatus(r, 400, 'INVALID_TIME', 'PUT /api/test/clock ไม่มี offset');
  });

  await test.step('ปิด hook: เว็บที่ไม่ตั้ง TEST_MODE ตอบ /api/test/reset → 404', async () => {
    const noTm = process.env.BASE_URL_NO_TEST_MODE;
    if (!noTm) {
      test.info().annotations.push({
        type: 'skipped-part',
        description: 'TC-NFR-03 ข้ามส่วน "ปิด hook": ไม่ได้ตั้ง env BASE_URL_NO_TEST_MODE (URL ของเว็บที่ไม่ตั้ง TEST_MODE)',
      });
      return;
    }
    const ctx = await pwRequest.newContext({ baseURL: noTm });
    const r = await ctx.post('/api/test/reset');
    expect(r.status(), `${noTm} POST /api/test/reset`).toBe(404);
    await ctx.dispose();
  });
});

// ───────────── TC-NFR-04 ─────────────

function filesToScan(p: string): string[] {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    const out: string[] = [];
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) out.push(...filesToScan(f));
      else if (e.isFile()) out.push(f);
    }
    return out;
  }
  // ไฟล์ฐานข้อมูล + ไฟล์ข้างเคียงของ SQLite (ข้อมูลใหม่อาจยังอยู่ใน -wal)
  return [p, `${p}-wal`, `${p}-shm`, `${p}-journal`].filter((f) => fs.existsSync(f));
}

function countIn(buf: Buffer, needle: string): number {
  let n = 0;
  for (const enc of ['utf8', 'utf16le'] as const) {
    const nb = Buffer.from(needle, enc);
    let i = buf.indexOf(nb);
    while (i >= 0) {
      n++;
      i = buf.indexOf(nb, i + 1);
    }
  }
  return n;
}

test('TC-NFR-04 · เข้ารหัสข้อมูลส่วนบุคคลที่เก็บ (inspection)', async ({ lab }) => {
  const dbPath = process.env.DB_PATH;
  expect(
    dbPath,
    'TC-NFR-04 ต้องตั้ง env DB_PATH = พาธไฟล์ฐานข้อมูลของเว็บบนเครื่องที่รัน test (ไม่ตั้ง = ตรวจไม่ได้ จึงล้ม ไม่ผ่านหลอก)',
  ).toBeTruthy();
  expect(fs.existsSync(dbPath!), `ไม่พบไฟล์ DB_PATH=${dbPath}`).toBe(true);

  await test.step('RESET · มานะลงทะเบียน (เบอร์ 0845678901)', async () => {
    await lab.reset();
    const mana = await lab.citizen(CIT.mana, { registered: false });
    await expectStatus(
      await mana.api.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: true } }),
      201,
      undefined,
      'มานะ register',
    );
  });

  await test.step('ค้นค่าตรงตัวในไฟล์ฐานข้อมูล → พบ 0 ทุกค่า', async () => {
    const files = filesToScan(path.resolve(dbPath!));
    expect(files.length, 'ไฟล์ที่ตรวจ').toBeGreaterThan(0);
    test.info().annotations.push({ type: 'scanned-files', description: files.join(', ') });
    const bufs = files.map((f) => [f, fs.readFileSync(f)] as const);
    for (const v of [...SEED_IDS, ...SEED_PHONES, ...SEED_IDS_DASHED]) {
      const hits = bufs.map(([f, b]) => [f, countIn(b, v)] as const).filter(([, n]) => n > 0);
      expect.soft(hits.reduce((s, [, n]) => s + n, 0), `พบ "${v}" ใน ${hits.map(([f, n]) => `${f}×${n}`).join(', ')}`).toBe(0);
    }
  });

  await test.step('ตัวควบคุมบวก: สมชาย GET /api/cases/…000005 ได้ idNo เต็ม (ถอดรหัสได้)', async () => {
    const sc = await lab.citizen(CIT.somchai);
    const j = await expectStatus(await sc.api.get(`/api/cases/${cn(5)}`), 200, undefined, 'สมชาย GET …000005');
    expect(j?.idNo).toBe('1101700123456');
  });

  test.info().annotations.push({
    type: 'manual',
    description: 'ผู้ทดสอบต้องบันทึกวิธีเข้ารหัสที่เว็บใช้ (เช่น AES-256-GCM) ในรายงาน · HTTPS ตอน deploy เป็น Q-08 ไม่ทดสอบที่นี่',
  });
});
