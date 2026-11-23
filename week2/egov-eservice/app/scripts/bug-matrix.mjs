#!/usr/bin/env node
// รันชุด Playwright เต็ม 51 TC ทีละบั๊ก (BUGS.md §3 ขั้น 3 และ 5) แล้วเทียบเซตของ TC ที่ล้มกับตารางใน BUGS.md §2
// ใช้ (ใน WSL):  node scripts/bug-matrix.mjs [B01 B03 ... | B03,B07 ...]   (ไม่ใส่ = ทั้ง 12 ตัว + ชุดผสม 2 ชุด)
// ผลลัพธ์: tests/runs/bug-<id>/ ต่อบั๊ก + tests/runs/bug-matrix/summary.json
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = path.join(HERE, 'tests', 'runs');

// ตาราง BUGS.md §2: [ต้องล้ม, อาจล้มด้วย (ผลข้างเคียงที่ยอมรับ)]
const EXPECT = {
  B01: [['TC-FEE-01'], []],
  B02: [['TC-UPLOAD-01'], []],
  B03: [['TC-SLA-01', 'TC-SLA-02'], ['TC-SLA-03', 'TC-RBAC-04']],
  B04: [['TC-SLA-02'], []],
  B05: [['TC-PAY-01'], []],
  B06: [['TC-RBAC-01'], []],
  B07: [['TC-RBAC-02'], ['TC-WORKFLOW-01']],
  B08: [['TC-QUEUE-02'], []],
  B09: [['TC-PDPA-02'], []],
  B10: [['TC-DASH-02'], ['TC-DASH-01', 'TC-DASH-03']],
  B11: [['TC-PDPA-03', 'TC-AUDIT-01'], []],
  B12: [['TC-WORKFLOW-04'], []],
};

const args = process.argv.slice(2);
const combos = args.length ? args : [...Object.keys(EXPECT), 'B03,B07', 'B01,B05,B09'];

const strip = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
const code = (title) => (title.match(/^(TC-[A-Z]+-\d+)/) || [])[1];

function readResults(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const specs = [];
  const walk = (s) => {
    (s.specs || []).forEach((sp) => specs.push(sp));
    (s.suites || []).forEach(walk);
  };
  (j.suites || []).forEach(walk);
  const failed = new Map();
  const all = new Set();
  for (const sp of specs) {
    const c = code(sp.title);
    if (!c) continue;
    all.add(c);
    if (!sp.ok) {
      const r = sp.tests?.[0]?.results?.find((x) => x.status !== 'passed');
      failed.set(c, strip(r?.error?.message || '').split('\n').filter(Boolean).slice(0, 3).join(' ⏎ ').slice(0, 300));
    }
  }
  return { all, failed };
}

const union = (ids) => {
  const must = new Set();
  const may = new Set();
  ids.forEach((i) => {
    EXPECT[i][0].forEach((t) => must.add(t));
    EXPECT[i][1].forEach((t) => may.add(t));
  });
  return { must, may };
};

fs.mkdirSync(path.join(RUNS, 'bug-matrix'), { recursive: true });
const summary = [];
for (const combo of combos) {
  const ids = combo.split(',');
  const bad = ids.filter((i) => !EXPECT[i]);
  if (bad.length) throw new Error(`ไม่รู้จักบั๊ก ${bad.join(',')}`);
  const run = 'bug-' + ids.join('+');
  const t0 = Date.now();
  console.log(`\n=== ${combo} → ${run}`);
  const r = spawnSync('bash', [path.join(HERE, 'scripts', 'run-suite.sh'), run, combo], { cwd: HERE, encoding: 'utf8', timeout: 20 * 60_000 });
  const resFile = path.join(RUNS, run, 'results.json');
  if (!fs.existsSync(resFile)) {
    console.log('ไม่มี results.json — รันล้ม', (r.stdout || '').slice(-400), (r.stderr || '').slice(-400));
    summary.push({ combo, error: 'no results.json', seconds: Math.round((Date.now() - t0) / 1000) });
    continue;
  }
  const { all, failed } = readResults(resFile);
  const { must, may } = union(ids);
  const failedSet = new Set(failed.keys());
  const expectedFailed = [...must].filter((t) => failedSet.has(t));
  const missed = [...must].filter((t) => !failedSet.has(t)); // ควรล้มแต่ผ่าน = test ผ่านหลอก
  const allowedExtra = [...failedSet].filter((t) => !must.has(t) && may.has(t));
  const unexpected = [...failedSet].filter((t) => !must.has(t) && !may.has(t)); // ล้มเกินที่ยอมรับ
  const row = {
    combo,
    total: all.size,
    failed: [...failedSet].sort(),
    mustFail: [...must],
    mayFail: [...may],
    expectedFailed,
    missed,
    allowedExtra,
    unexpected,
    verdict: missed.length === 0 && unexpected.length === 0 ? 'OK' : 'CHECK',
    messages: Object.fromEntries([...failed.entries()].map(([k, v]) => [k, v])),
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  summary.push(row);
  console.log(`  total=${row.total} failed=[${row.failed.join(', ')}] missed=[${missed.join(', ')}] unexpected=[${unexpected.join(', ')}] → ${row.verdict}`);
  fs.writeFileSync(path.join(RUNS, 'bug-matrix', 'summary.json'), JSON.stringify(summary, null, 2));
}
fs.writeFileSync(path.join(RUNS, 'bug-matrix', 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\nเสร็จ → tests/runs/bug-matrix/summary.json');
