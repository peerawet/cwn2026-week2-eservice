# INTERFACES · คู่มือใช้ core สำหรับโมดูล citizen / workflow / mgmt

> เขียนโดย agent-core (B01) · อ่านไฟล์นี้แทนการอ่านโค้ด core ทั้งหมด · สเปกจริงอยู่ที่ `../../egov-brief/CONTRACT.md` (ชนะไฟล์นี้ถ้าขัดกัน)
> Stack: Node 22 · Express 4 · `node:sqlite` (DatabaseSync, synchronous) · HTML render ด้วย template string ฝั่งเซิร์ฟเวอร์ · ไม่มี build step

## 0. กติกาที่ต้องทำตาม

| ข้อ | กติกา |
|---|---|
| 1 | แต่ละโมดูลเขียน **เฉพาะ** `src/modules/<ชื่อ>/` ของตัวเอง (view, static, ตัวช่วย อยู่ในนั้นทั้งหมด เช่น `src/modules/citizen/views.js`) |
| 2 | **ห้ามแก้** `src/core/*` `src/server.js` `src/seed.js` `package.json` `package-lock.json` `Dockerfile` `docker-compose.yml` และ `tests/` · ต้องการอะไรเพิ่มใน core → เขียนตัวช่วยไว้ในโมดูลตัวเอง แล้วจดในรายงานให้ orchestrator |
| 3 | dependency ที่ติดตั้งแล้ว (ใช้ได้เลย ห้ามเพิ่ม): `express@4.22.3` `multer@2.5.0` `pdfkit@0.21.0` `exceljs@4.4.0` `qrcode@1.5.4` `@fontsource/sarabun@5.3.0` (ฟอนต์ไทย OFL) + โมดูลในตัวของ Node (`node:crypto` ฯลฯ) |
| 4 | **ห้ามเรียก `Date.now()` / `new Date()` ในกฎธุรกิจ** อ่านเวลาจาก `ctx.clock` เท่านั้น · เวลาที่เก็บ DB และส่งใน API ต้องเป็น `ctx.clock.toIso(ms)` = `2026-12-04T16:30:00+07:00` เสมอ (รูปแบบเดียว → เทียบ/เรียงด้วยสตริงได้) |
| 5 | ห้าม log / render เลขบัตร 13 หลักหรือเบอร์โทรตรง ๆ นอกจากที่ CONTRACT อนุญาต (ประชาชนเจ้าของ · `full-id` หลัง unmask) · อ่าน/เขียนผ่าน `ctx.people` / `ctx.cases` ซึ่งเข้ารหัสให้ |
| 6 | `action-error` และ `action-success` มีในทุกหน้าแล้ว (จาก `layout`) **อย่าง render ซ้ำ** (Playwright strict mode จะล้ม) · ตั้งข้อความด้วย `opts.error/opts.success` หรือ `EG.showError()/EG.showSuccess()` ฝั่ง browser |
| 7 | โมดูลห้ามสร้าง route `/api/test/*` เอง → ใช้ `ctx.hooks.testPay/testTamper` |
| 8 | handler ที่ "ตรวจแล้วเขียน" (claim, pay, cancel) ต้องทำให้จบแบบ synchronous **ไม่มี `await` คั่น** ระหว่างอ่านกับเขียน → atomic เอง (Node เธรดเดียว + DatabaseSync) · ถ้าเขียนหลายตารางใช้ `ctx.db.tx(() => {...})` |
| 9 | บั๊ก `BUG_MODE` ใส่ที่ตรรกะฝั่งเซิร์ฟเวอร์ตรงจุดเดียว: `if (ctx.bugs.isOn('B07')) {...}` · ไม่เปลี่ยนข้อความ ไม่เปลี่ยน seed |

## 1. โครงสร้างโฟลเดอร์

```text
app/
├── package.json  Dockerfile  docker-compose.yml  .dockerignore  INTERFACES.md
├── data/                      # DB ไฟล์ (bind mount ใน docker → /data/egov.db) · gitignore
├── src/
│   ├── server.js              # สร้าง app, mount core + โมดูล, 404/error handler, เริ่มเว็บ
│   ├── seed.js                # ข้อมูล TEST-DATA ทั้งหมด (seedAll)
│   ├── core/                  # ของ B01 คนเดียว
│   │   ├── clock.js  bugs.js  db.js  crypto.js  errors.js  catalog.js  format.js  sla.js
│   │   ├── session.js  audit.js  hooks.js  layout.js  people.js  cases.js  testhooks.js
│   │   └── static/app.css  static/app.js    # เสิร์ฟที่ /static/app.css /static/app.js
│   └── modules/
│       ├── citizen/index.js   # export register(app, ctx)   (B02)
│       ├── workflow/index.js  # export register(app, ctx)   (B03)
│       └── mgmt/index.js      # export register(app, ctx)   (B04)
└── tests/                     # Playwright (ของ agent test) ห้ามแตะ
```

## 2. การรัน

```bash
cd app && npm install                       # ติดตั้งแล้ว ไม่ต้องทำซ้ำ
TEST_MODE=1 PORT=3101 DB_PATH=./data/citizen.db node src/server.js      # citizen ใช้ 3101
TEST_MODE=1 PORT=3102 DB_PATH=./data/workflow.db node src/server.js     # workflow ใช้ 3102
TEST_MODE=1 PORT=3103 DB_PATH=./data/mgmt.db node src/server.js         # mgmt ใช้ 3103
# (ใช้ DB_PATH แยกกันเสมอ · 3000 = orchestrator/docker · 3100 = B01)
# EG_MODULES=citizen (คั่นด้วย ,) โหลดเฉพาะโมดูลที่ระบุ — ค่าเริ่มต้น citizen,workflow,mgmt
# docker: TEST_MODE=1 BUG_MODE=B03 docker compose up -d --build  (HOST_PORT=3000 เปลี่ยนพอร์ตฝั่งเครื่องได้)
```

- โมดูลที่ยังไม่มีไฟล์ถูกข้าม · โมดูลที่ `require` แล้ว throw ถูก log แล้วข้าม (เว็บยังรันต่อ — ดู log ตอนเริ่มเสมอ)
- `TEST_MODE=1`: เริ่มเว็บแล้ว reset + seed ทันที · นาฬิกาแช่แข็งที่ `2026-12-01T09:00:00+07:00`
- ไม่ตั้ง `TEST_MODE`: `/api/test/*` → 404 · seed เฉพาะเมื่อ DB ว่าง · นาฬิกา = เวลาจริง (หรือ env `FROZEN_NOW`) · `BUG_MODE` ถูกละเลย
- ทดสอบเร็ว: `curl -X POST localhost:3101/api/test/reset` → `{"ok":true,"now":"2026-12-01T09:00:00+07:00"}`

## 3. ลำดับ pipeline ของ request (server.js)

1. `express.json` / `urlencoded` (limit 10 MB) · `/static` · `Cache-Control: no-store`
2. `session.load` → `req.user` / `req.pending`
3. **`hooks.runBefore(req)`** ทุก request ยกเว้น `/api/test/*` และ `/static/*` (CONTRACT §0 ข้อ 7)
4. route ของ core: `/api/test/*` · `GET /api/health` · `GET /` · `GET|POST /logout` · `POST /api/auth/logout` · `GET /api/me`
5. `register(app, ctx)` ของ citizen → workflow → mgmt (ตามลำดับนี้)
6. 404 (API → `{"code":"NOT_FOUND","message":"ไม่พบคำขอ"}` · หน้า → `page-not-found`) · error handler (ด้านล่าง)

Error handler: `throw new ctx.errors.AppError('INVALID_STATE')` ใน handler (sync หรือ async ที่ห่อด้วย `ctx.errors.wrap`) → API ได้ `{"code","message"}` + HTTP ตามตาราง · หน้าได้หน้า error · `MulterError LIMIT_FILE_SIZE` (เกิน 8 MB) → `FILE_TOO_LARGE` · JSON เสีย → 400 `BAD_REQUEST`

## 4. `ctx` ที่ส่งให้ `register(app, ctx)`

| key | คืออะไร |
|---|---|
| `ctx.config` | `{ TEST_MODE: bool, PORT, DB_PATH, ROOT }` |
| `ctx.express` | โมดูล express (สร้าง `Router()` / `static`) |
| `ctx.upload` | multer memoryStorage (เพดาน 8 MB/ไฟล์ 10 ไฟล์) → `app.post(path, ctx.upload.single('file'), h)` แล้ว `req.file.buffer` `req.file.size` `req.file.originalname` `req.body.docKey` · **ตรวจขนาด 5 MB เอง** (B02) |
| `ctx.baseUrl(req)` | `<BASE_URL>` เช่น `http://localhost:3000` (env `BASE_URL` หรือจาก Host) → `doc-qr data-url = ${ctx.baseUrl(req)}/verify/${code}` |
| `ctx.db` | ฐานข้อมูล (§5) |
| `ctx.clock` | นาฬิกากลาง (§6.1) |
| `ctx.bugs` | `isOn('B07')` `list()` |
| `ctx.session` | ล็อกอิน/สิทธิ์ (§6.3) |
| `ctx.audit` | `log()` `query()` `EVENTS` (§6.4) |
| `ctx.crypto` | เข้ารหัส/เลขบัตร/ลายเซ็น/รหัสผ่าน (§6.5) |
| `ctx.format` | เงิน วันที่ ป้าย HTML (§6.6) |
| `ctx.layout` | หน้า HTML กลาง (§6.7) |
| `ctx.errors` | ข้อความ error ตรงตัว (§6.8) |
| `ctx.hooks` | registry (§6.9) |
| `ctx.sla` | วันทำการ / กำหนดเสร็จ / ระดับเตือน (§6.2) |
| `ctx.catalog` | ชื่อบริการ เอกสาร เส้นทาง (§6.10) |
| `ctx.people` | users / citizens (ถอดรหัสให้) (§6.11) |
| `ctx.cases` | อ่านคำขอ JSON §6.7 ไทม์ไลน์ ไฟล์ สิทธิ์ไฟล์ ออกเลข (§6.12) |
| `ctx.seed` | ข้อมูล seed (อ่านอย่างเดียว เช่น `ctx.seed.CASES`) · `ctx.resetAll()` = reset ทั้งระบบ |

ตัวอย่างโมดูลขั้นต่ำ:

```js
'use strict';
exports.register = (app, ctx) => {
  const { html, statusBadge, levelBadge, timeEl, money } = ctx.format;
  const { requireRole } = ctx.session;
  app.get('/officer/queue', requireRole('officer', 'head'), (req, res) => {
    const rows = ctx.db.all("SELECT * FROM cases WHERE dept = ? AND status IN ('SUBMITTED','IN_REVIEW','APPROVED') ORDER BY due_at, case_no", req.user.dept);
    ctx.layout.send(res, { req, title: 'คิวงาน', body: html`<div class="table-wrap"><table class="data">…${rows.map((r) => html`<tr data-testid="queue-row" data-case-no="${r.case_no}">…</tr>`)}</table></div>` });
  });
  app.post('/api/officer/cases/:caseNo/claim', requireRole('officer', 'head'), (req, res) => { /* … */ });
};
```

## 5. ฐานข้อมูล (`ctx.db`) และ schema ทุกตาราง

API: `get(sql, ...p)` แถวแรก · `all(sql, ...p)` · `run(sql, ...p)` → `{changes, lastInsertRowid}` · `exec(sql)` · `tx(fn)` (ซ้อนได้) · `nextCounter(key)` · `peekCounter(key)` · `setCounter(key, v)` · พารามิเตอร์ `?` หรือ object `{name}` กับ `:name` · `undefined`→NULL · boolean→1/0 · BLOB อ่านได้ `Uint8Array` → `Buffer.from(x)`
โมดูลเพิ่มตารางเองได้ใน `register()`: `ctx.db.exec('CREATE TABLE IF NOT EXISTS citizen_xxx (...)')` (ตั้งชื่อนำหน้าด้วยชื่อโมดูล) · reset ล้าง **ทุกตาราง** รวมของโมดูล · PRAGMA: journal MEMORY, synchronous OFF, secure_delete ON (ไม่มีไฟล์ -wal)

| ตาราง | คอลัมน์ (ความหมาย) |
|---|---|
| `users` | `username` PK · `password_hash` (scrypt) · `display_name` (= `user-name`) · `role` officer/head/executive/auditor/admin · `dept` registry/works/NULL · `active` · `created_at` |
| `citizens` | `id` PK (seed: 1 สมชาย 2 สมหญิง 3 มานะ 4 ปิติ) · `id_hash` = `crypto.blindIndex(idNo)` UNIQUE (ใช้ค้นหา) · `id_enc` AES-GCM ของเลขบัตร · `name` · `mobile_enc` AES-GCM (NULL = ยังไม่ลงทะเบียน) · `email` · `registered` 0/1 · `consent_at` · `registered_at` · `created_at` |
| `otp_state` | `id_hash` PK · `fail_count` (ผิดติดกัน) · `locked_until` ISO/NULL · `updated_at` — ว่างหลัง reset |
| `services` | `id` SV-01.. · `name` · `fee` (SV-01 ต่อฉบับ 20 · SV-02 คงที่ 500 · SV-03 ฐาน 1000 = `feeBase`) · `fee_per_sqm` (SV-03 = 10 · อื่น NULL) · `sla_days` 3/10/15 · `sort` |
| `holidays` | `date` 'YYYY-MM-DD' PK · `name` |
| `counters` | `key` PK · `value` — `case:2569`=30 · `doc:2569`=1 · `draft`=2 · `payref`=1 · `file`=50 (ใช้ผ่าน `ctx.cases.ids`) |
| `cases` | **แถวเดียวตั้งแต่ร่างจนปิด** — ดูตารางคอลัมน์ §5.1 |
| `case_files` | `file_id` 'F-000001' PK · `case_id` · `doc_key` id-card/map/site-photo/plan/deed/extra · `name` · `mime` (จาก magic bytes) · `size` · `content` BLOB · `phase` initial/fix · `uploaded_at` |
| `payments` | `ref` 'PP-0001' PK · `case_id` · `amount` (ยอดที่ล็อก) · `status` PENDING/PAID (EXPIRED **คำนวณ**: `now − qr_created_at ≥ 15:00`) · `qr_created_at` · `qr_expires_at` (= +15 นาที) · `paid_at` · `case_no` · `receipt_no` |
| `case_events` | `id` · `case_id` · `time` ISO · `type` (CREATED QR_CREATED PAID CANCEL CLAIM RETURN RESUBMIT FORWARD APPROVE REJECT ISSUE AUTO_CANCEL) · `actor` (username / 'citizen' / 'system') · `actor_role` · `from_status` · `to_status` · `note` |
| `notifications` | `id` · `username` ผู้รับ · `case_no` · `level` near/overdue · `text` 'คำขอ EG-2569-000024 ใกล้ครบกำหนด' · `created_at` · **UNIQUE(username, case_no, level)** → ใช้ `INSERT OR IGNORE` ได้เลย (ไม่แจ้งซ้ำ) · `bell-count` ใน header = COUNT ของ username |
| `documents` | `doc_no` PK · `case_id` · `case_no` · `verify_code` [A-Z0-9]{8} UNIQUE · `applicant` (ชื่อเต็ม — tamper แก้ตัวนี้) · `service_id` · `issued_at` ISO · `valid_until` 'YYYY-MM-DD' วันสุดท้ายที่ใช้ได้ · `signer` ชื่อแสดง · `signature` hex · `issued_by` |
| `audit_log` | `id` · `time` ISO · `time_ms` · `username` · `role` · `event` · `case_no` · `from_status` · `to_status` · `detail` — UPDATE ถูก trigger ห้าม · เขียนผ่าน `ctx.audit.log` เท่านั้น |

### 5.1 คอลัมน์ของ `cases` และใครเขียน

| คอลัมน์ | ความหมาย | ตั้งโดย |
|---|---|---|
| `id` | key ภายใน (ไฟล์/ชำระ/ไทม์ไลน์อ้างตัวนี้) | – |
| `draft_id` | DR-0001 (NULL สำหรับคำขอ seed 30 ใบ) | citizen สร้างร่าง (`ids.draftId()`) |
| `case_no` / `receipt_no` | EG-2569-000031 / RC-2569-000031 · NULL จนชำระ | citizen ตอนชำระ (`ids.caseNo(paidMs)`) |
| `service_id` `citizen_id` | บริการ · ผู้ยื่น | citizen |
| `status` | ตาราง CONTRACT 4.1 | ทุกโมดูลตามขั้น |
| `qty` / `area_sqm` | SV-01 จำนวนฉบับ / SV-03 พื้นที่ | citizen |
| `fee` | DRAFT = ค่าที่คำนวณล่าสุด (คำนวณใหม่จาก services ได้) · **ตั้งแต่ PENDING_PAYMENT = ยอดล็อก** (BR-11: QR ใหม่ใช้ยอดเดิม) | citizen |
| `paid_at` | เวลาชำระ = เวลายื่น | citizen |
| `due_at` | `ctx.sla.computeDueAt(paidAt, services.sla_days)` ครั้งเดียวตอนชำระ · ขยายตอนส่งแก้ด้วย `ctx.sla.extendDueAt` (B04 = ไม่ขยาย) | citizen / workflow |
| `step` | ลำดับขั้นใน `catalog.ROUTES[service]` เริ่ม 1 ตอนชำระ · เดินหน้าอย่างเดียว (= ขั้นสูงสุดที่เคยถึง ใช้ตัดสิทธิ์ไฟล์) · SV-01: 1 · SV-02: 1 ทะเบียน → 2 หัวหน้า · SV-03: 1 ทะเบียน → 2 โยธา → 3 หัวหน้า | workflow (forward) |
| `dept` | คิวที่เรื่องอยู่ตอนนี้: `registry` / `works` / `head` · **APPROVED = `registry`** (รอผู้ออกเอกสาร) · ปิด/ยกเลิก = NULL | citizen (ชำระ → registry) / workflow / mgmt |
| `owner` | ผู้ถือเรื่องของขั้นแผนกปัจจุบัน · NULL = ยังไม่มีผู้รับ · NEED_FIX คงผู้ถือเดิม · PENDING_APPROVAL/APPROVED/ปิด = NULL | workflow |
| `reg_officer` | เจ้าหน้าที่ทะเบียนที่รับเรื่องขั้น 1 = **ผู้ออกเอกสารทุกบริการ** (A-27 · SV-01 ผู้ถือ = ผู้อนุมัติ = คนเดียวกัน) | workflow (claim ขั้น 1) |
| `works_officer` | เจ้าหน้าที่โยธาที่รับขั้น 2 | workflow |
| `return_count` `returned_at` `return_reason` `fix_deadline` | จำนวนตีกลับ · เวลา/เหตุผลล่าสุด · `returned_at + 168 ชม.` (มีค่าเฉพาะตอน NEED_FIX) | workflow |
| `approved_by` `approved_at` `rejected_by` `reject_reason` | ผู้อนุมัติ (ผู้ลงนาม: SV-01 = เจ้าหน้าที่ · SV-02/03 = head) | workflow |
| `closed_at` | COMPLETED/REJECTED เท่านั้น (Dashboard) | workflow (reject) / mgmt (issue) |
| `cancelled_at` `cancel_kind` | CITIZEN / FIX_TIMEOUT (เวลา = fix_deadline · A-46) | citizen / workflow |
| `doc_no` | เอกสารที่ออก | mgmt |
| `created_at` `updated_at` | – | ทุกโมดูล (updated_at = `clock.nowIso()`) |

## 6. API ของ core ทีละไฟล์

### 6.1 `ctx.clock`
`now()` ms · `nowIso()` · `nowDateKey()` 'YYYY-MM-DD' · `set(iso)` → ISO หรือ null (ต้องมี offset) · `reset()` · `parseIso(str)` → ms/null · `toIso(ms)` · `normalizeIso(str)` · `dateKey(ms)` · `bkkMs('2026-12-04','16:30:00')` · `addDays(dk, n)` · `dowOf(dk)` 0=อา · `parts(ms)` {year,month,day,hour,minute,second,dow} ตามเวลาไทย · `DEFAULT_NOW`

### 6.2 `ctx.sla` — ฟังก์ชันวันทำการ "ตัวเดียว" (B03 อยู่ในนี้แล้ว: เปิดแล้วไม่ข้ามวันหยุดในตาราง)
`computeDueAt(paidIsoOrMs, slaDays)` → ISO (BR-12 · ตรวจแล้วตรง TC-SLA-01 ทุกแถว + seed ทุกใบ) · `extendDueAt(dueAt, returnedAt, resubmittedAt)` → `{dueAt, pausedDays}` (BR-13 · ตรวจแล้วตรง TC-SLA-02 ส่วน 1–5) · `levelOf(caseRow, nowMs?)` → normal/near/overdue/paused/closed/null (BR-14 + A-33 · ตรง TEST-DATA 4.1 และ 8.1) · `remainingWorkdays(dueAt, nowMs?)` · `isWorkday(dk)` `nextWorkday` `addWorkdays` `countWorkdays(from, to)` = วันทำการใน (from, to]

### 6.3 `ctx.session`
- `requireRole('officer','head')` middleware — หน้า: ไม่ล็อกอิน → 302 `/login` (ประชาชนค้างลงทะเบียน → `/register`) · บทบาทผิด → 403 + `forbidden-msg` · API (`/api/*`): 401 `UNAUTHENTICATED` / 403 `FORBIDDEN` · `requireRole()` = แค่ต้องล็อกอิน
- `req.user` = `{ kind:'staff'|'citizen', username (ประชาชน = null), name, role, dept, citizenId }` · `req.pending` = `{ citizenId, name }` (OTP ผ่านแต่ยังไม่ลงทะเบียน)
- `loginStaff(req, res, usersRow)` → user · `loginCitizen(req, res, citizensRow)` → user หรือ null (ยังไม่ลงทะเบียน → session pending) · `promotePending(req, citizensRow)` หลังลงทะเบียน · `logout(req, res)` · `landingFor(user)` · `clearAll()` (reset ใช้)
- บทบาท snapshot ตอนล็อกอิน → admin เปลี่ยนบทบาทมีผลครั้งถัดไป (TC-RBAC-04) · cookie `egov_sid` HttpOnly SameSite=Lax

### 6.4 `ctx.audit`
`log({ user: req.user, event, caseNo, fromStatus, toStatus, detail })` (หรือ `username`/`role` ตรง ๆ) — เรียกหลังทำสำเร็จเท่านั้น (A-36) · `query({ actor, event, from:'YYYY-MM-DD', to })` → `{count, items}` เรียงใหม่→เก่า ช่วงวันรวมหัวท้ายตามเวลาไทย · `toItem(row)` = รูปแบบ API §6.4 · `EVENTS` 10 ตัว

### 6.5 `ctx.crypto`
`encrypt(s)` / `decrypt(t)` (AES-256-GCM) · `blindIndex(s)` · `isValidThaiId(s)` (BR-01) · `formatThaiId('3100600987659')` → `3-1006-00987-65-9` · `maskThaiId()` → `X-XXXX-XXXXX-65-9` · `sign(fields)` / `verifySignature(fields, sig)` HMAC-SHA256 · `docSignFields(documentsRow)` = [doc_no, case_no, applicant, service_id, issued_at, valid_until, signer] (CONTRACT §3) · `hashPassword` / `verifyPassword(pw, users.password_hash)` · `randomCode(8)` [A-Z0-9] · `randomToken()`

### 6.6 `ctx.format`
- HTML: `` html`<p>${text}</p>` `` → escape ค่าให้อัตโนมัติ (array ต่อกันได้ · SafeHtml ไม่ escape ซ้ำ) · `esc(s)` · `raw(s)` (ไว้ใจแล้วเท่านั้น)
- `money(1010)` → `฿1,010` (null → `–`) · `thaiDateTime(iso)` → `4 ธ.ค. 2569 16:30` · `thaiDate('2027-02-02')` → `2 ก.พ. 2570` · `buddhistYear(iso)` · `percent(6,7)` → `85.7%` (ตัวหาร 0 → `–`)
- `timeEl(iso, { testid, prefix, text })` → `<time data-testid=".." data-iso="2026-12-04T16:30:00+07:00">4 ธ.ค. 2569 16:30</time>` (เช่น `prefix:'หมดอายุ '` ให้ `qr-expires`) · `dateEl('2027-02-02', {testid:'verify-expires'})`
- `statusBadge(status, testid='case-status')` → ข้อความไทย + `data-status` · `levelBadge(level, testid='sla-level')` → + `data-level` · `paymentBadge(st)` (`payment-status`) · ตาราง `STATUS_TH LEVEL_TH ROLE_TH DEPT_TH PAYMENT_TH EVENT_TH`
- `maskName('สมชาย ใจดี')` → `สมชาย ใ***`

### 6.7 `ctx.layout`
`send(res, { req, title, body, h1, error, success, head, scripts, inlineScript, wide }, status=200)` · `page(opts)` → string · `sendForbidden(req,res)` (403 + `forbidden-msg`) · `sendCaseNotFound(req,res)` (404 + `not-found-msg` = `ไม่พบคำขอ` · ไม่เผยข้อมูลคำขอ) · `sendNotFound` · `bellCount(username)`
- ทุกหน้ามี: `app-header` · (ล็อกอินแล้ว) `user-name` `user-role` (`data-role` · officer มี `data-dept`) `logout-btn` (POST /logout → /login) · เมนู `nav-*` ตามบทบาท · officer/head มี `nav-bell` + `bell-count` · `action-error` (role=alert, hidden ถ้าว่าง) · `action-success` · `<main id="main">` · `lang="th"` · skip link
- `user: null` = หน้าสาธารณะ (`/login` `/register` `/verify`) · `body` ที่เป็น string ถือว่าเป็น HTML ปลอดภัยแล้ว
- CSS พร้อมใช้: `.card .grid .kpis .kpi .actions .btn .btn-secondary .btn-danger .btn-small .form-row .field-error .muted .notice .badge .table-wrap table.data dl.kv ol.timeline .sr-only` · **ตารางต้องอยู่ใน `<div class="table-wrap" data-label="ชื่อตาราง">`** (เลื่อนในกล่อง ไม่ให้ทั้งหน้ามี scroll แนวนอน · JS ใส่ tabindex/role ให้เองเมื่อเลื่อนได้ → ผ่าน axe)
- ฝั่ง browser (`/static/app.js`): `EG.api(method, url, body|FormData)` → `{ok,status,data}` · `EG.showError(msg)` `EG.showSuccess(msg)` `EG.clearMessages()` · `EG.money()` `EG.thaiDateTime()` · static ของโมดูลเอง: `app.use('/static/citizen', ctx.express.static(path.join(__dirname,'static')))` แล้ว `scripts:['/static/citizen/x.js']`
- a11y (TC-NFR-02 axe 0 serious/critical): ทุก `input/select/textarea` ต้องมี `<label for>` หรือ `aria-label` (รวม `<input type=file>`) · ปุ่มต้องมีข้อความ · อย่าใช้สีเป็นสื่ออย่างเดียว · ไม่ตั้ง `maxlength` ที่ `thaid-id-input`

### 6.8 `ctx.errors`
`sendError(res, 'ALREADY_CLAIMED')` · `sendError(res, 'OTP_INVALID', { attemptsLeft: 2 })` · `sendError(res, 'MISSING_DOCS', { missing: ['แบบแปลน','โฉนด'] })` (ประกอบข้อความให้) · `throw new AppError(code, extra)` · `message(code)` `status(code)` `missingDocsMessage(names)` · `wrap(asyncFn)` · ข้อความทุกตัวตรง CONTRACT §5 (en dash แล้ว) · รหัสเพิ่ม: `INVALID_TIME` `BAD_REQUEST` `NOT_IMPLEMENTED`

### 6.9 `ctx.hooks`
`beforeRequest(fn(req))` (sync/async · error ถูก log ไม่ทำให้ request ล้ม) · `onReset(fn)` (ล้าง cache ของโมดูลหลัง reset) · `testPay(handler(req,res))` → `POST /api/test/payments/:ref/pay` · `testTamper(handler)` → `POST /api/test/documents/:docNo/tamper` (ยังไม่ลง → 501 · ลงได้ตัวเดียว)

### 6.10 `ctx.catalog`
`SERVICE_NAMES` · `serviceLabel('SV-01')` → `SV-01 ขอหนังสือรับรอง` · `DOCS[sv]` = [{key,label,required,pdfOnly}] ตามลำดับ missing-docs · `EXTRA_DOC` · `DOC_LABELS` · `missingDocs(sv, docKeys)` → ['แบบแปลน','โฉนด'] · `ROUTES` · `APPROVER` · `DEPT_NAMES` · `stepLabel('SV-03', 2)` → `ขั้นตอน 2/3 · ฝ่ายโยธา` (บริการอื่น null)

### 6.11 `ctx.people`
`getUser(username)` (มี password_hash) · `displayName(username)` · `officersOfDept('registry')` · `heads()` · `listUsers()` · `findCitizenByIdNo(idNo)` → `{id, idNo, name, mobile, email, registered, _row}` · `getCitizen(id)` · `getCitizenRow(id)` (แถวดิบให้ loginCitizen) · `createCitizen({idNo, name})` · `registerCitizen(id, {mobile, email})` (เข้ารหัสเบอร์ให้)

### 6.12 `ctx.cases`
- อ่าน: `getByCaseNo(no)` · `getById(id)` · `getByDraftId(dr)` → แถว cases + `applicant_name` (+ `applicant_id_enc`) · `applicantIdNo(row)` · `applicantIdMasked(row)` · `levelOf(row)` · `verifyCodeOf(row)`
- `toJson(row, req.user)` = **JSON CONTRACT §6.7 พร้อมกฎ PDPA** (เจ้าของได้ `idNo` · คนอื่นได้ `idMasked` เท่านั้น · `step` เฉพาะ SV-03 · `fixDeadline` เฉพาะ NEED_FIX)
- ไทม์ไลน์: `addEvent(caseId, {type, actor, actorRole, fromStatus, toStatus, note, time?})` · `events(caseId)` · `timelineHtml(caseId)` → `case-timeline` + `timeline-item[data-iso]`
- ไฟล์: `files(caseId)` → [{fileId,name,docKey,size,mime}] · `fileWithContent(fileId)` · `fileAccess(req.user, row)` → `'ok'|'unauthenticated'|'not_found'|'forbidden'` (BR-29 ตรวจแล้วตรง TC-RBAC-05) · `docItemsHtml(caseId)` → `doc-item[data-name][data-file-id]` + `doc-download-link` · `detectMime(buf)` (magic bytes) · `addFile(caseId, {docKey,name,mime,content,phase})` · `countFiles(caseId)` · `MAX_FILE_BYTES` (5,242,880) · `MAX_FILES_PER_CASE` (5)
- ออกเลข: `ids.draftId()` DR-0003 · `ids.payRef()` PP-0002 · `ids.caseNo(paidMs)` → `{caseNo, receiptNo}` ตามปี พ.ศ. ของเวลาชำระ (2570 → EG-2570-000001) · `ids.docNo(ms)` DOC-2569-000002 · `ids.fileId()`

## 7. ข้อมูล seed หลัง reset (สรุป · ครบตาม TEST-DATA)

- เจ้าหน้าที่ 7 คน รหัส `Test@1234`: off.reg1 / off.reg2 (registry) · off.works1 (works) · head1 · exec1 · audit1 · admin1
- ประชาชน 4 คน (OTP `123456`): สมชาย 1101700123456 (คำขอ 10 + ร่าง 2) · สมหญิง 3100600987659 (11) · มานะ 5500400111221 **ยังไม่ลงทะเบียน** · ปิติ 1909900555015 (9)
- บริการ SV-01 20/ฉบับ SLA 3 · SV-02 500 SLA 10 · SV-03 1000 + 10/ตร.ม. เกิน 100 SLA 15 · วันหยุด 2026-12-07, 12-10, 12-31, 2027-01-01
- คำขอ EG-2569-000001..000030 ทุกค่าตามตาราง TEST-DATA 4.1 (due_at ตายตัว) · F01 (…17) NEED_FIX ตีกลับ 2 ครั้ง fix_deadline 2026-12-04T14:00 · F02 (…23) return_count 2 · W01 (…10) step 2 dept works · P01 (…14) / P02 (…11) PENDING_APPROVAL dept head · A01 (…19) APPROVED dept registry reg_officer off.reg1 approved head1 11-30 15:00 · X01 (…09) CANCELLED · ไฟล์แนบ PDF จริงตามเอกสารบังคับทุกใบ (F-000001..F-000050)
- ร่าง DR-0001 (SV-01 qty 2 ฿40 DRAFT ไม่มีไฟล์) · DR-0002 (SV-02 PENDING_PAYMENT ฿500 id-card+map · PP-0001 สร้าง 08:55 หมด 09:10)
- เอกสาร DOC-2569-000001 ของ …05 verify `K7M2Q9XA` valid_until 2027-02-02 signer เจ้าหน้าที่ทะเบียน 1 (ลายเซ็นคำนวณจริง)
- ว่าง: audit_log · notifications · otp_state · ถัดไป: EG-2569-000031 · RC-2569-000031 · DOC-2569-000002 · DR-0003 · PP-0002
- สมมติฐานของ B01 (ไม่มีในสเปก): created_at ของร่าง (DR-0001 2026-11-30 15:00 · DR-0002 08:50) · ไทม์ไลน์ seed ใส่เฉพาะเหตุการณ์ที่ TEST-DATA ให้เวลา (ชำระ, ตีกลับ/ส่งแก้ F01 F02, อนุมัติ A01, ปิด/ยกเลิก) ไม่มี CLAIM/FORWARD

## 8. การแบ่งงานโมดูล (route / API / บั๊ก) — ห้ามลงทะเบียน route ซ้ำกัน

| โมดูล | หน้า | API | hook | บั๊ก |
|---|---|---|---|---|
| **core (เสร็จแล้ว)** | `/` `/logout` | `GET /api/health` · `POST /api/auth/logout` · `GET /api/me` · `/api/test/reset` `/api/test/clock` | – | **B03** (ใน `ctx.sla`) |
| **citizen** (B02) | `/login` (แท็บประชาชน + เจ้าหน้าที่) · `/register` · `/citizen` · `/citizen/new/:service` · `/citizen/cases/:caseNo` | `POST /api/auth/thaid/start` `/verify` `/api/auth/register` · `POST /api/auth/staff/login` (+ Audit `STAFF_LOGIN`) · `/api/drafts*` (CRUD, files, payment) · `GET /api/payments/:ref` · `GET /api/cases` · `GET /api/cases/:caseNo` (citizen เจ้าของ + officer + head ด้วย `cases.toJson`) · `POST /api/cases/:caseNo/cancel` · `GET /api/cases/:caseNo/files` · `GET /api/files/:fileId` | `testPay` | B01 B02 B05 B06 |
| **workflow** (B03) | `/officer/queue` · `/officer/cases/:caseNo` · `/head/approvals` · `/notifications` | `GET /api/officer/queue` · `POST /api/officer/cases/:caseNo/claim` `/return` `/forward` · `POST /api/cases/:caseNo/approve` `/reject` · **`POST /api/cases/:caseNo/resubmit`** (multipart ไม่บังคับ · ขยาย due_at · ใช้ `cases.detectMime/addFile`) · `GET /api/notifications` | `beforeRequest` (แจ้งเตือน A-30/A-31 + ยกเลิกอัตโนมัติ A-46) | B04 B07 B08 **B09** B12 |
| **mgmt** (B04) | `/verify/:code` · `/dashboard` · `/audit` · `/admin/services` `/admin/holidays` `/admin/users` | `POST /api/officer/cases/:caseNo/issue` · `POST /api/officer/cases/:caseNo/unmask` (+ Audit `UNMASK`) · `GET /api/documents/:docNo/pdf` · `GET /api/verify/:code` · `/api/dashboard` + `/export` · `/api/audit` + `/export.csv` + 405 (`PUT/PATCH/DELETE /api/audit` และ `/api/audit/:id`) · `/api/admin/*` | `testTamper` | B10 B11 |

ข้อตกลงข้ามโมดูล (ตัดสินโดย B01 จากสเปก — ต่างจากคำสั่งตั้งต้นเล็กน้อย):
1. **SLA วันทำการอยู่ใน core** (`ctx.sla`) เพราะ citizen ต้องคำนวณ due_at ตอนชำระ และ DECISIONS ข้อ 18 บังคับ "ฟังก์ชันวันทำการตัวเดียว" สำหรับทั้งกำหนดเสร็จและวันคงเหลือ → B03 อยู่ใน core แล้ว · workflow ใช้ `extendDueAt` ตอนส่งแก้ (B04 อยู่ที่ workflow)
2. **B09 อยู่ที่ workflow** (blocks.json เขียนไว้ใต้ citizen) เพราะ endpoint ที่บั๊กกระทบคือ `GET /api/officer/queue` ของ workflow · ตอนเปิด B09 ใส่ `idNo` เต็มในแถวคิว (หน้าจอยังปิดบัง)
3. **`resubmit` เป็นของ workflow** (หน้า `/citizen/cases/:caseNo` ของ citizen render `fix-upload-input` + `submit-fix-btn` แล้วเรียก API นี้) เพราะผูกกับ 168 ชม./คืนผู้ถือเดิม/หยุดนับ (B04)
4. หน้า `/officer/cases/:caseNo` (workflow) render ปุ่ม/ช่องของ mgmt ด้วย testid ตาม CONTRACT แล้วเรียก API ของ mgmt: `issue-btn` (แสดงเมื่อ `status = APPROVED` และ `req.user.username === row.reg_officer`) → `POST …/issue` · `applicant-id` `show-full-id-btn` `unmask-reason` `unmask-submit` `unmask-error` `full-id` → `POST …/unmask` · `doc-no` `verify-code` `doc-qr` อ่านจาก `cases.doc_no` + `documents`
5. หน้า `/citizen/cases/:caseNo` (citizen) แสดง `doc-no` `verify-code` `doc-qr` (`data-url` = `ctx.baseUrl(req)+'/verify/'+code`, รูปจาก `qrcode`) และ `download-doc-btn` → `GET /api/documents/:docNo/pdf` (mgmt)
6. เมื่อ workflow `approve`: `status=APPROVED, dept='registry', owner=NULL` · `forward` ไปขั้นแผนกถัดไป: `step+1, dept=<แผนก>, owner=NULL` · ไปขั้นหัวหน้า: `status=PENDING_APPROVAL, dept='head', owner=NULL` · `claim` ขั้น 1 ตั้ง `reg_officer` · mgmt `issue`: `status=COMPLETED, closed_at=now, dept=NULL, doc_no` · ทุกการเปลี่ยนสถานะเพิ่ม `cases.addEvent`
7. แจ้งเตือน: workflow เขียนตาราง `notifications` (INSERT OR IGNORE) — header นับ `bell-count` จากตารางนี้เอง

## 9. เกร็ดที่ตรวจแล้ว (ประหยัดเวลา)

- **pdfkit เข้ารหัสข้อความที่วาดเป็น hex** (`<646f63...> Tj`) แม้ `compress:false` → บรรทัด ASCII ที่ test ค้นในไบต์ดิบ **ต้องใส่ใน `doc.info`** เช่น `doc.info.Keywords = 'docNo=DOC-2569-000002 caseNo=EG-2569-000025 verify=K7M2Q9XA validUntil=2027-02-28'` (เขียนเป็น literal `( … )` ในไฟล์) · Dashboard PDF: `kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1`
- ฟอนต์ไทย pdfkit (ทดสอบแล้ว): `doc.registerFont('th', require.resolve('@fontsource/sarabun/files/sarabun-thai-400-normal.woff'))` (ชุด thai มีเฉพาะอักษรไทย · ข้อความอังกฤษ/ตัวเลขใช้ `sarabun-latin-400-normal.woff` หรือ Helvetica)
- เวลาเปรียบเทียบด้วย ms: `ctx.clock.now() - ctx.clock.parseIso(p.qr_created_at) >= 15*60*1000` → หมดอายุ (B05 ใช้ `>`)
- ค่าใน `data-iso` ต้องเป็น ISO +07:00 ตรงตัว → ใช้ `timeEl` · Audit กรองด้วย `ctx.audit.query`
- ตรวจแล้ว (B01): ไฟล์ DB ดิบหลัง seed + มานะลงทะเบียน `0845678901` ไม่พบเลขบัตร/เบอร์ทั้ง 12 ค่าของ TC-NFR-04 · layout ผ่าน axe 0 serious/critical ที่ 375/1280 · ไม่มี scroll แนวนอน 375/768/1280 · focus มองเห็นได้
