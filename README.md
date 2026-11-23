# cwn2026-week2-eservice

LAB Week 2 · e-Service กลางของ "เทศบาลนครตัวอย่าง" (สมมติ) — สร้างเว็บตามชุดโจทย์ของ TA แล้วพิสูจน์ด้วย Playwright

> **สถานะ: ครบทุกขั้นตามพรอมต์ (ข้อจำกัดอ่านที่ `REPORT.md` §1 และ §6)**
> | ขั้น | สถานะ |
> |---|---|
> | วางแผน (`blocks.json` · `PLAN.md` · `dag.png` · `gantt-plan.png`) | ✅ |
> | สร้างเว็บ (`week2/egov-eservice/app`) | ✅ |
> | Playwright 51 TC กับเว็บปกติ | ✅ 51/51 ผ่าน 2 รอบติดกัน (`app/tests/runs/normal-4`, `normal-5`) |
> | BUG_MODE B01–B12 + `BUG-HUNT.md` | ✅ จับได้ 12/12 (ล้มเกินตารางที่ยอมรับ 1 จุด: TC-NOTI-02 เมื่อเปิด B03) · ปิดบั๊กแล้วกลับมา 51/51 (`after-bughunt`) |
> | `REPORT.md` · `gantt-actual.png` · `compare.png` · `QUESTIONS-TO-TA.md` | ✅ |

## โครง

```text
week2/egov-brief/        ชุดโจทย์กลางของ TA (อ่านอย่างเดียว ที่มา: ชุดโจทย์ของคอร์ส)
week2/egov-eservice/
  blocks.json PLAN.md dag.png gantt-plan.png   แผนจาก dagplan.py (โควตาสมมติ)
  timing/events.jsonl                          เวลาเริ่ม/จบ/สะดุดจริงของแต่ละบล็อก
  app/                                         เว็บ Node 22 + Express + node:sqlite (INTERFACES.md อธิบายโครง)
  app/tests/                                   Playwright 51 TC (e2e/part1, e2e/part2) + runs/ (ผลรันจริง)
```

## รัน (ใน WSL/Linux ที่มี docker)

```bash
cd week2/egov-eservice/app
TEST_MODE=1 docker compose up --build            # เว็บที่ http://localhost:3000
TEST_MODE=1 BUG_MODE=B03,B07 docker compose up --build
bash scripts/run-suite.sh <ชื่อรอบ> [BUG_MODE]   # เว็บ + Playwright (container v1.56.1) → tests/runs/<ชื่อรอบ>/
node scripts/bug-matrix.mjs                      # B01–B12 + ชุดผสม เทียบกับ BUGS.md
```
