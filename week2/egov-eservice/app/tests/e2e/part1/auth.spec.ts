/**
 * หมวด AUTH (TEST-PLAN §2) · TC-AUTH-01 … TC-AUTH-04
 */
import {
  test,
  expect,
  CIT,
  PASSWORD,
  OTP_OK,
  expectStatus,
  sameInstant,
  openCitizenLogin,
  openStaffLogin,
  uiLoginCitizen,
} from './helpers';

const MSG_INVALID_ID = 'เลขบัตรประชาชนไม่ถูกต้อง';

test('TC-AUTH-01 · เลขบัตร 13 หลัก + checksum', async ({ s }) => {
  await s.reset();
  const page = await s.newPage();
  const api = await s.newApi();

  const invalid: Array<[string, string]> = [
    ['110170012345', '12 หลัก ต่ำกว่าขอบ'],
    ['11017001234567', '14 หลัก เกินขอบ'],
    ['1101700123457', '13 หลัก checksum ผิด'],
    ['11017001234ab', 'ไม่ใช่ตัวเลขล้วน'],
  ];
  for (const [value, why] of invalid) {
    await test.step(`${value} (${why}) → ปฏิเสธ`, async () => {
      await openCitizenLogin(page);
      const input = page.getByTestId('thaid-id-input');
      await input.fill(value);
      // ช่องไม่จำกัด maxlength (A-45) — ต้องพิมพ์ได้ครบทุกตัว (14 หลักต้องครบ 14 ตัว)
      await expect(input).toHaveValue(value);
      await page.getByTestId('thaid-submit').click();
      await expect(page.getByTestId('thaid-error')).toHaveText(MSG_INVALID_ID);
      await expect(page.getByTestId('otp-step')).toBeHidden();

      const res = await api.post('/api/auth/thaid/start', { data: { idNo: value } });
      await expectStatus(res, 400, 'INVALID_ID');
    });
  }

  for (const value of [CIT.somchai, CIT.somying, CIT.piti, CIT.mana]) {
    await test.step(`${value} (checksum ถูก) → otp-step แสดง`, async () => {
      await openCitizenLogin(page);
      await page.getByTestId('thaid-id-input').fill(value);
      await page.getByTestId('thaid-submit').click();
      await expect(page.getByTestId('otp-step')).toBeVisible();
      await expect(page.getByTestId('thaid-error')).toBeHidden();

      const body = await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo: value } }), 200);
      expect(body).toMatchObject({ status: 'OTP_SENT' });
    });
  }
});

test('TC-AUTH-02 · OTP ผิด 3 ครั้งล็อก 15 นาที', async ({ s }) => {
  test.setTimeout(180_000);
  const PITI = CIT.piti;

  // ---- รอบ API: ตรวจ HTTP status / code / attemptsLeft / lockedUntil ทุกขั้น 1–8
  await s.reset();
  const api = await s.newApi();
  const start = () => api.post('/api/auth/thaid/start', { data: { idNo: PITI } });
  const verify = (otp: string) => api.post('/api/auth/thaid/verify', { data: { idNo: PITI, otp } });

  await test.step('API 1: start → OTP 000000 → 401 OTP_INVALID เหลือ 2', async () => {
    await expectStatus(await start(), 200);
    const b = await expectStatus(await verify('000000'), 401, 'OTP_INVALID');
    expect(b.attemptsLeft).toBe(2);
  });
  await test.step('API 2: OTP 000000 อีกครั้ง → เหลือ 1', async () => {
    const b = await expectStatus(await verify('000000'), 401, 'OTP_INVALID');
    expect(b.attemptsLeft).toBe(1);
  });
  await test.step('API 3: OTP 000000 ครั้งที่ 3 → 423 LOCKED ถึง 09:15:00', async () => {
    const b = await expectStatus(await verify('000000'), 423, 'LOCKED');
    expect(sameInstant(b.lockedUntil, '2026-12-01T09:15:00+07:00'), `lockedUntil=${b.lockedUntil}`).toBe(true);
  });
  await test.step('API 4: OTP ถูกทันที → ยัง 423', async () => {
    await expectStatus(await verify(OTP_OK), 423, 'LOCKED');
  });
  await test.step('API 5: สมชายล็อกอินได้ระหว่างที่ปิติถูกล็อก', async () => {
    const somchai = await s.newApi();
    await expectStatus(await somchai.post('/api/auth/thaid/start', { data: { idNo: CIT.somchai } }), 200);
    await expectStatus(await somchai.post('/api/auth/thaid/verify', { data: { idNo: CIT.somchai, otp: OTP_OK } }), 200);
  });
  await test.step('API 6: 09:14:59 OTP ถูก → ยัง 423', async () => {
    await s.clock('2026-12-01T09:14:59+07:00');
    await expectStatus(await verify(OTP_OK), 423, 'LOCKED');
    await expectStatus(await start(), 423, 'LOCKED'); // CONTRACT 6.1: start ระหว่างล็อก → 423
  });
  await test.step('API 7: 09:15:00 ปลดล็อก → OTP 000000 → 401 เหลือ 2 (ตัวนับเริ่มใหม่)', async () => {
    await s.clock('2026-12-01T09:15:00+07:00');
    await expectStatus(await start(), 200);
    const b = await expectStatus(await verify('000000'), 401, 'OTP_INVALID');
    expect(b.attemptsLeft).toBe(2);
  });
  await test.step('API 8: OTP 123456 → 200', async () => {
    await expectStatus(await verify(OTP_OK), 200);
  });

  // ---- รอบหน้าจอ: ข้อความ otp-error / otp-attempts-left / lock-message / lock-until
  await s.reset();
  const page = await s.newPage();
  await test.step('UI 1–3: ผิด 3 ครั้งบนหน้า /login', async () => {
    await openCitizenLogin(page);
    await page.getByTestId('thaid-id-input').fill(PITI);
    await page.getByTestId('thaid-submit').click();
    await expect(page.getByTestId('otp-step')).toBeVisible();

    await page.getByTestId('otp-input').fill('000000');
    await page.getByTestId('otp-submit').click();
    await expect(page.getByTestId('otp-error')).toHaveText('รหัส OTP ไม่ถูกต้อง');
    await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 2 ครั้ง');

    await page.getByTestId('otp-input').fill('000000');
    await page.getByTestId('otp-submit').click();
    await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 1 ครั้ง');

    await page.getByTestId('otp-input').fill('000000');
    await page.getByTestId('otp-submit').click();
    await expect(page.getByTestId('lock-message')).toHaveText('ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที');
    await expect(page.getByTestId('lock-until')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
  });
  await test.step('UI 7–8: 09:15:00 ปลดล็อก → ผิด 1 ครั้งเหลือ 2 → OTP ถูกเข้าได้', async () => {
    await s.clock('2026-12-01T09:15:00+07:00');
    await openCitizenLogin(page);
    await page.getByTestId('thaid-id-input').fill(PITI);
    await page.getByTestId('thaid-submit').click();
    await expect(page.getByTestId('otp-step')).toBeVisible();
    await page.getByTestId('otp-input').fill('000000');
    await page.getByTestId('otp-submit').click();
    await expect(page.getByTestId('otp-error')).toHaveText('รหัส OTP ไม่ถูกต้อง');
    await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 2 ครั้ง');
    await page.getByTestId('otp-input').fill(OTP_OK);
    await page.getByTestId('otp-submit').click();
    await expect(page).toHaveURL((u) => u.pathname === '/citizen');
  });

  // ---- ขั้น 9: OTP ถูกรีเซ็ตตัวนับเป็น 0
  await test.step('9: RESET · ผิด 2 → ถูก → ออก → ผิดอีก 2 → ไม่ล็อก (ยังเหลือ 1 ครั้ง)', async () => {
    await s.reset();
    const api9 = await s.newApi();
    const v = (otp: string) => api9.post('/api/auth/thaid/verify', { data: { idNo: PITI, otp } });
    await expectStatus(await api9.post('/api/auth/thaid/start', { data: { idNo: PITI } }), 200);
    expect((await expectStatus(await v('000000'), 401, 'OTP_INVALID')).attemptsLeft).toBe(2);
    expect((await expectStatus(await v('000000'), 401, 'OTP_INVALID')).attemptsLeft).toBe(1);
    await expectStatus(await v(OTP_OK), 200);
    await expectStatus(await api9.post('/api/auth/logout'), 204);
    await expectStatus(await api9.post('/api/auth/thaid/start', { data: { idNo: PITI } }), 200);
    expect((await expectStatus(await v('000000'), 401, 'OTP_INVALID')).attemptsLeft).toBe(2);
    expect((await expectStatus(await v('000000'), 401, 'OTP_INVALID')).attemptsLeft).toBe(1);
    await expectStatus(await v(OTP_OK), 200); // ไม่ถูกล็อก
  });
});

test('TC-AUTH-03 · ลงทะเบียนครั้งแรก', async ({ s }) => {
  test.setTimeout(150_000);
  const MSG_MOBILE = 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0';
  const onRegister = (u: URL) => u.pathname === '/register';

  await s.reset();
  const page = await s.newPage();
  await test.step('LOGIN_C มานะผ่าน /login → /register', async () => {
    await uiLoginCitizen(page, CIT.mana);
    await expect(page).toHaveURL(onRegister);
  });

  await test.step('1: reg-name = มานะ ตั้งใจ และ readOnly', async () => {
    const name = page.getByTestId('reg-name');
    await expect(name).toHaveValue('มานะ ตั้งใจ');
    expect(await name.evaluate((el) => (el as HTMLInputElement).readOnly)).toBe(true);
    await name.click();
    await page.keyboard.type('แก้ชื่อ');
    await expect(name).toHaveValue('มานะ ตั้งใจ');
  });

  const submitWith = async (mobile: string, consent: boolean) => {
    await page.getByTestId('reg-mobile').fill(mobile);
    await page.getByTestId('reg-email').fill('');
    if (consent) await page.getByTestId('reg-consent').check();
    else await page.getByTestId('reg-consent').uncheck();
    await page.getByTestId('reg-submit').click();
  };

  for (const [mobile, why] of [
    ['081234567', '9 หลัก'],
    ['08123456789', '11 หลัก'],
    ['1812345678', '10 หลักไม่ขึ้นต้น 0'],
    ['08123abcde', 'มีตัวอักษร'],
  ] as const) {
    await test.step(`2–4: เบอร์ ${mobile} (${why}) → reg-error-mobile`, async () => {
      await submitWith(mobile, true);
      await expect(page.getByTestId('reg-error-mobile')).toHaveText(MSG_MOBILE);
      await expect(page).toHaveURL(onRegister);
    });
  }

  await test.step('5: เบอร์ถูกแต่ไม่ติ๊กยินยอม → reg-error-consent', async () => {
    await submitWith('0845678901', false);
    await expect(page.getByTestId('reg-error-consent')).toHaveText('กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)');
    await expect(page).toHaveURL(onRegister);
  });

  await test.step('6: เบอร์ถูก + ติ๊ก + อีเมลว่าง → /citizen', async () => {
    await submitWith('0845678901', true);
    await expect(page).toHaveURL((u) => u.pathname === '/citizen');
    await expect(page.getByTestId('citizen-welcome')).toHaveText('สวัสดี มานะ ตั้งใจ');
  });

  await test.step('7: ออกจากระบบ → ล็อกอินมานะอีกครั้ง → /citizen ตรง ๆ ไม่ผ่าน /register', async () => {
    await page.getByTestId('logout-btn').click();
    await expect(page).toHaveURL((u) => u.pathname === '/login');
    const visited: string[] = [];
    const onNav = (f: import('@playwright/test').Frame) => {
      if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
    };
    page.on('framenavigated', onNav);
    await uiLoginCitizen(page, CIT.mana);
    await expect(page).toHaveURL((u) => u.pathname === '/citizen');
    page.off('framenavigated', onNav);
    expect(visited, 'เส้นทางหลังล็อกอินครั้งที่ 2').not.toContain('/register');
  });

  await test.step('8: RESET · API register → 400 INVALID_MOBILE / 400 CONSENT_REQUIRED', async () => {
    await s.reset();
    const api = await s.newApi();
    await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo: CIT.mana } }), 200);
    const v = await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: CIT.mana, otp: OTP_OK } }), 200);
    expect(v.registered).toBe(false);
    await expectStatus(
      await api.post('/api/auth/register', { data: { mobile: '081234567', email: '', consent: true } }),
      400,
      'INVALID_MOBILE',
    );
    await expectStatus(
      await api.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: false } }),
      400,
      'CONSENT_REQUIRED',
    );
  });
});

test('TC-AUTH-04 · เจ้าหน้าที่ SSO จำลองและหน้าตั้งต้น', async ({ s }) => {
  test.setTimeout(180_000);
  await s.reset();
  const page = await s.newPage();
  const api = await s.newApi();

  const rows: Array<{ u: string; landing: string; name: string; roleText: string; role: string; dept?: string }> = [
    { u: 'off.reg1', landing: '/officer/queue', name: 'เจ้าหน้าที่ทะเบียน 1', roleText: 'เจ้าหน้าที่', role: 'officer', dept: 'registry' },
    { u: 'off.reg2', landing: '/officer/queue', name: 'เจ้าหน้าที่ทะเบียน 2', roleText: 'เจ้าหน้าที่', role: 'officer', dept: 'registry' },
    { u: 'off.works1', landing: '/officer/queue', name: 'เจ้าหน้าที่โยธา 1', roleText: 'เจ้าหน้าที่', role: 'officer', dept: 'works' },
    { u: 'head1', landing: '/head/approvals', name: 'หัวหน้าฝ่าย', roleText: 'หัวหน้าฝ่าย', role: 'head' },
    { u: 'exec1', landing: '/dashboard', name: 'ผู้บริหาร', roleText: 'ผู้บริหาร', role: 'executive' },
    { u: 'audit1', landing: '/audit', name: 'ผู้ตรวจสอบภายใน', roleText: 'ผู้ตรวจสอบภายใน', role: 'auditor' },
    { u: 'admin1', landing: '/admin/services', name: 'ผู้ดูแลระบบ', roleText: 'ผู้ดูแลระบบ', role: 'admin' },
  ];

  for (const r of rows) {
    await test.step(`${r.u} → ${r.landing}`, async () => {
      await openStaffLogin(page);
      await expect(page.getByTestId('staff-submit')).toHaveText('เข้าสู่ระบบเจ้าหน้าที่ (SSO ภาครัฐ จำลอง)');
      await page.getByTestId('staff-username').fill(r.u);
      await page.getByTestId('staff-password').fill(PASSWORD);
      await page.getByTestId('staff-submit').click();
      await expect(page).toHaveURL((u) => u.pathname === r.landing);
      await expect(page.getByTestId('user-name')).toHaveText(r.name);
      const role = page.getByTestId('user-role');
      await expect(role).toHaveText(r.roleText);
      await expect(role).toHaveAttribute('data-role', r.role);
      if (r.dept) await expect(role).toHaveAttribute('data-dept', r.dept);

      await page.getByTestId('logout-btn').click();
      await expect(page).toHaveURL((u) => u.pathname === '/login');
    });
  }

  await test.step('หลังออกจากระบบ เปิด /officer/queue → redirect /login', async () => {
    await page.goto('/officer/queue');
    await expect(page).toHaveURL((u) => u.pathname === '/login');
  });

  for (const [username, password, why] of [
    ['off.reg1', 'wrong', 'รหัสผ่านผิด'],
    ['nobody', PASSWORD, 'username ไม่มี'],
    [CIT.somchai, PASSWORD, 'เลขบัตรประชาชนในช่อง username'],
  ] as const) {
    await test.step(`${why} → staff-error + 401 INVALID_CREDENTIALS`, async () => {
      await openStaffLogin(page);
      await page.getByTestId('staff-username').fill(username);
      await page.getByTestId('staff-password').fill(password);
      await page.getByTestId('staff-submit').click();
      await expect(page.getByTestId('staff-error')).toHaveText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      await expect(page).toHaveURL((u) => u.pathname === '/login');

      await expectStatus(
        await api.post('/api/auth/staff/login', { data: { username, password } }),
        401,
        'INVALID_CREDENTIALS',
      );
    });
  }
});
