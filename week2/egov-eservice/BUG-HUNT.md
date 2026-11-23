# BUG-HUNT · เปิด BUG_MODE ทีละตัวแล้วรันชุดเต็ม 51 TC

ผลรันจริงจาก `app/tests/runs/bug-<รหัส>/` (สคริปต์ `app/scripts/bug-matrix.mjs` เทียบเซตของ TC ที่ล้มกับตารางใน BUGS.md §2 อัตโนมัติ) · ทุกรอบ: เว็บใหม่ใน WSL docker, `TEST_MODE=1 BUG_MODE=<รหัส>`, ชุดเต็ม 51 TC

## สรุป

- **จับบั๊กได้ 12/12 ตัว** — TC ที่ BUGS.md ระบุว่า "ต้องล้ม" ล้มจริงทุกตัว และ **ไม่มีบั๊กตัวไหนที่ควรล้มแต่ผ่าน** (คอลัมน์ "ควรล้มแต่ผ่าน" ว่างทุกแถว)
- **ล้มเกินที่ BUGS.md ยอมรับ 1 จุด:** `TC-NOTI-02` เมื่อเปิด B03 (และชุดผสม B03,B07 ที่มี B03) — ดูหมายเหตุ 1
- ชุดผสม `B03,B07` และ `B01,B05,B09` ล้ม = union ของแต่ละตัวพอดี (ไม่หายไป ไม่เพิ่มแปลกๆ)
- ปิดบั๊กทั้งหมดแล้วรันซ้ำ (รอบ `after-bughunt`): ดูหัวข้อท้ายไฟล์

## ตาราง triage (BUGS.md §4)

| บั๊ก | TC ที่ต้องล้ม (BUGS.md) | TC ที่ล้มจริง | ล้มเพิ่มที่ BUGS.md ยอมรับ | ล้มเกินที่ยอมรับ | ควรล้มแต่ผ่าน | ผล |
|---|---|---|---|---|---|---|
| B01 · SV-03 พื้นที่ 101 คิด ฿1,000 | TC-FEE-01 | TC-FEE-01 | – | – | – | ✅ |
| B02 · ไฟล์ 5,242,880 ไบต์ถูกปฏิเสธ | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | – | ✅ |
| B03 · SLA ไม่ข้ามวันหยุดในตาราง | TC-SLA-01 · TC-SLA-02 | TC-NOTI-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 | TC-SLA-03 · TC-RBAC-04 | TC-NOTI-02 | – | ⚠️ ดูหมายเหตุ |
| B04 · SLA ไม่หยุดนับระหว่างรอแก้ไข | TC-SLA-02 | TC-SLA-02 | – | – | – | ✅ |
| B05 · QR อายุ 15:00 พอดียังจ่ายได้ | TC-PAY-01 | TC-PAY-01 | – | – | – | ✅ |
| B06 · IDOR: เปิดคำขอคนอื่นได้ | TC-RBAC-01 | TC-RBAC-01 | – | – | – | ✅ |
| B07 · เจ้าหน้าที่อนุมัติ SV-02 เองได้ (API ไม่เช็กสิทธิ์) | TC-RBAC-02 | TC-RBAC-02 | – | – | – | ✅ |
| B08 · รับเรื่องซ้ำได้ (ข้ามการตรวจผู้ถือ) | TC-QUEUE-02 | TC-QUEUE-02 | – | – | – | ✅ |
| B09 · API คิวส่งเลขบัตรเต็ม | TC-PDPA-02 | TC-PDPA-02 | – | – | – | ✅ |
| B10 · ทันกำหนด % หารด้วย "รับเรื่อง" | TC-DASH-02 | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | TC-DASH-01 · TC-DASH-03 | – | – | ✅ |
| B11 · unmask ไม่บันทึก Audit | TC-PDPA-03 · TC-AUDIT-01 | TC-AUDIT-01 · TC-PDPA-03 | – | – | – | ✅ |
| B12 · ตีกลับครั้งที่ 3 ได้ | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | – | ✅ |
| ชุดผสม B03,B07 | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 | TC-NOTI-02 · TC-RBAC-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 | TC-SLA-03 · TC-RBAC-04 | TC-NOTI-02 | – | ⚠️ ดูหมายเหตุ |
| ชุดผสม B01,B05,B09 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | – | – | – | ✅ |

## ข้อความที่ล้ม (ค่าที่คาดหวัง vs ค่าที่ได้) ของ TC ที่ต้องล้ม

ตัดข้อความยาวเป็น `…` · "–" = assertion นั้นไม่มีบรรทัด Expected/Received แยก (เช่นเช็ก element ที่ไม่มี) ดูข้อความเต็มใน `results.json` ของแต่ละรอบ

| บั๊ก | TC | ล้ม | assertion | Expected | Received |
|---|---|---|---|---|---|
| B01 | TC-FEE-01 | ✅ | SV-03 areaSqm=101 | Expected: "฿1,010" | Received: "฿1,000" |
| B02 | TC-UPLOAD-01 | ✅ | expect(locator).toHaveCount(expected) failed | Expected: 1 | Received: 0 |
| B03 | TC-SLA-01 | ✅ | dueAt แถว c | Expected: "2026-12-08T16:30:00+07:00" | Received: "2026-12-07T16:30:00+07:00" |
| B03 | TC-SLA-02 | ✅ | expect(locator).toHaveAttribute(expected) failed | Expected: "2026-12-08T16:30:00+07:00" | Received: "2026-12-07T16:30:00+07:00" |
| B04 | TC-SLA-02 | ✅ | expect(locator).toHaveAttribute(expected) failed | Expected: "2026-12-08T16:30:00+07:00" | Received: "2026-12-04T16:30:00+07:00" |
| B05 | TC-PAY-01 | ✅ | http://localhost:3000/api/test/payments/PP-0001/pay → 200 {"status":"PAID","caseNo":"EG… | Expected: 410 | Received: 200 |
| B06 | TC-RBAC-01 | ✅ | expect(received).toBe(expected) // Object.is equality | Expected: 404 | Received: 200 |
| B07 | TC-RBAC-02 | ✅ | off.reg2 approve …000014 [http://localhost:3000/api/cases/EG-2569-000014/approve] → HTT… | Expected: 403 | Received: 200 |
| B08 | TC-QUEUE-02 | ✅ | expect(locator).toHaveText(expected) failed | Expected: "มีเจ้าหน้าที่รับเรื่องนี้แล้ว" | Received: "" |
| B09 | TC-PDPA-02 | ✅ | off.reg1 GET /api/officer/queue?filter=all พบเลข 13 หลัก | – | Received: "1101700123456" |
| B10 | TC-DASH-02 | ✅ | 2026-11 ALL kpi-ontime-pct | Expected: "85.7%" | Received: "23.1%" |
| B11 | TC-PDPA-03 | ✅ | UNMASK audit-count | Expected: "1" | Received: "0" |
| B11 | TC-AUDIT-01 | ✅ | expect(locator).toHaveText(expected) failed | Expected: "16" | Received: "15" |
| B12 | TC-WORKFLOW-04 | ✅ | expect(locator).toHaveCount(expected) failed | Expected: 0 | Received: 1 |

## หมายเหตุ

1. **B03 ทำให้ TC-NOTI-02 ล้มเพิ่ม** (BUGS.md ยอมรับเฉพาะ TC-SLA-03 และ TC-RBAC-04) — ล้มที่ส่วน B (นาฬิกา ส. 5 ธ.ค.) ขั้น `bell-count` ของ `off.reg2` ต้องได้ 10 เพราะฟังก์ชันวันทำการตัวเดียวกันถูกใช้นับ "วันคงเหลือ" ของระดับเตือน (ไม่ข้าม 7 ธ.ค.) จึงเป็นผลข้างเคียงของบั๊กโดยตรง ไม่ใช่เทสต์ผิดหรือเว็บปกติผิด · ใช้ข้อมูลชุดเดียวกับ TC-SLA-03 ส่วน B ที่ BUGS.md ยอมรับไว้แล้ว · ส่งเป็นคำถามถึง TA ใน `QUESTIONS-TO-TA.md` ข้อ 5 (ไม่ได้ปรับให้ดูเหมือนตรงตาราง ตาม BUGS.md §1 ข้อ 5)
2. **B07**: ไม่มี `TC-WORKFLOW-01` ล้มด้วย (BUGS.md บอกว่า "อาจ") — B07 ในเว็บนี้ปล่อยเฉพาะ approve ของเจ้าหน้าที่กับ SV-02/03 ส่วน reject ยัง 403
3. **B10** ล้ม TC-DASH-01 และ TC-DASH-03 ด้วย (ผลข้างเคียงที่ BUGS.md ยอมรับ: ใช้สูตรเดียวกัน)
4. ตัวอย่างบั๊กที่ BUGS.md ใช้เตือนว่า "test ผ่านหลอก" (B07: ตรวจแค่ว่าไม่มีปุ่ม) — เทสต์ `TC-RBAC-02` ยิง `POST /api/cases/.../approve` ตรงที่ API จึงจับได้จริง
5. ข้อจำกัดของหลักฐานนี้: เว็บที่ฝังบั๊กกับชุดเทสต์ถูกเขียนในโปรเจกต์เดียวกัน (โดย agent คนละตัวและเทสต์เขียนจากสเปกโดยไม่อ่านโค้ดเว็บ) แต่ผู้ตรวจควรรันซ้ำเองด้วย `node app/scripts/bug-matrix.mjs`

## ปิดบั๊กทั้งหมดแล้วรันซ้ำ (BUGS.md §3 ขั้น 6)

รอบ `app/tests/runs/after-bughunt/` (ไม่ตั้ง `BUG_MODE`, เว็บใหม่) → **51/51 ผ่าน** · `flaky: 0` · สคริปต์ exit 0 · ตามหลังรอบ `normal-4` และ `normal-5` ที่ผ่าน 51/51 เช่นกัน (ขั้น 1–2: รันซ้ำทันทีได้ผลเท่าเดิม)
