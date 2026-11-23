import { defineConfig, devices } from '@playwright/test';

// ทุก TC เริ่มด้วย POST /api/test/reset ซึ่งล้างสถานะทั้งเว็บ → รันทีละ TC (workers: 1)
export default defineConfig({
  testDir: './e2e',
  globalSetup: './fixtures/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 7_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.PW_JSON_OUT || 'runs/latest/results.json' }],
    ['html', { outputFolder: process.env.PW_HTML_OUT || 'runs/latest/html', open: 'never' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: (process.env.PW_VIDEO as any) || 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
