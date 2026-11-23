# PLAN · egov-eservice

แผนงานบล็อกสำหรับ LAB Week 2 (รายละเอียดแต่ละบล็อกอยู่ใน [`blocks.json`](blocks.json))

> **ข้อต่างจากวิธีของคอร์ส:** เครื่องนี้ไม่มี container `multi-account` และสกิล `dag-planner` / `agent-team`
> จึงใช้ Claude Code (orchestrator) แตกงานเองและส่งงานให้ subagent ของ Claude Code ทำ
> ทุกบล็อกใช้บัญชีเดียวกัน (ไม่มีการกระจายโควตาข้ามบัญชี yolo/cyolo) · เวลาจริงจดใน [`timing/events.jsonl`](timing/events.jsonl) ตอนเริ่มและจบแต่ละบล็อก

## บล็อก

| บล็อก | ชื่อ | ผู้ทำ | ความยาก | ต้องรอ | แผน (นาที) |
|---|---|---|---|---|---|
| B01 | โครงโปรเจกต์ + DB + seed + clock + test hook + BUG_MODE + Docker | agent-core | ยาก | – | 35 |
| T1 | Playwright ส่วน 1: AUTH FEE SUBMIT UPLOAD PAY QUEUE SLA NOTI (22 TC) | agent-test-1 | กลาง | – | 45 |
| T2 | Playwright ส่วน 2: WORKFLOW DOC PDPA DASH AUDIT RBAC NFR (29 TC) | agent-test-2 | กลาง | – | 45 |
| B02 | ประชาชน: ล็อกอิน/ยื่น/อัปโหลด/ค่าธรรมเนียม/ชำระ/API คำขอ | agent-citizen | ยาก | B01 | 50 |
| B03 | เจ้าหน้าที่/หัวหน้า: คิว/รับเรื่อง/ตีกลับ/อนุมัติ/SLA/แจ้งเตือน | agent-workflow | ยาก | B01 | 55 |
| B04 | เอกสาร+verify · Dashboard+ส่งออก · Audit · Admin · PDPA | agent-mgmt | ยาก | B01 | 50 |
| B07 🔒 | รวม + Playwright ชุดเต็มใน WSL docker จนผ่าน 51/51 + test-report | orchestrator | ยาก | B02 B03 B04 T1 T2 | 40 |
| B08 🔒 | BUG_MODE B01–B12 ทีละตัว + triage | orchestrator | กลาง | B07 | 30 |
| B09 | gantt-actual · compare · REPORT · README | orchestrator | ง่าย | B08 | 15 |

## DAG

```text
B01 ──┬─> B02 ──┐
      ├─> B03 ──┤
      └─> B04 ──┼─> B07 🔒 ─> B08 🔒 ─> B09
T1 ─────────────┤
T2 ─────────────┘
```

- บล็อก Playwright (T1, T2) อ่านแค่ TEST-PLAN / CONTRACT / TEST-DATA ห้ามอ่านโค้ดเว็บ → ไม่มีลูกศรจากบล็อกเว็บ ทำขนานได้ตั้งแต่นาทีที่ 0
- ไฟล์ไม่ชนกัน: core = `app/src/core/` + `package.json` · โมดูล = `app/src/modules/<ชื่อ>/` ของใครของมัน · test = `app/tests/e2e/part1|part2/` (fixtures เป็นของ T1)
- กฎตัวเลขเยอะ (SLA วันทำการใน B03 · Dashboard ใน B04) ไม่มีบัญชีที่สองไว้ review → ใช้ชุด Playwright ที่เขียนแยกจากโค้ด (T1/T2) เป็นตัวตรวจใน B07
- BUG_MODE แต่ละตัวฝังในโมดูลที่เป็นเจ้าของกฎนั้น: B02 ← B01 B02 B05 B06 B09 · B03 ← B03 B04 B07 B08 B12 · B04 ← B10 B11

## สายวิกฤต

**B01 → B03 → B07 → B08 → B09 = 35 + 55 + 40 + 30 + 15 = 175 นาที** (B03 มีกฎเวลา/วันทำการ/สถานะมากที่สุด และ B07–B08 ต้องรันทีละชุดแบบ exclusive บนเว็บเดียว)

## Gantt (แผน · นาทีนับจากเริ่ม)

| บล็อก | ผู้ทำ | เริ่ม–จบ |
|---|---|---|
| B01 | agent-core | 0–35 |
| T1 | agent-test-1 | 0–45 |
| T2 | agent-test-2 | 0–45 |
| B02 | agent-citizen | 35–85 |
| B03 | agent-workflow | 35–90 |
| B04 | agent-mgmt | 45–95 (รอให้ T1/T2 จบก่อน เพื่อไม่เกิน 4 agent พร้อมกัน) |
| B07 🔒 | orchestrator | 95–135 |
| B08 🔒 | orchestrator | 135–165 |
| B09 | orchestrator | 165–180 |
