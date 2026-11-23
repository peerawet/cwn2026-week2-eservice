'use strict';
// ฐานข้อมูลไฟล์เดียว (node:sqlite · DatabaseSync = เรียกแบบ synchronous ทั้งหมด จึงไม่มี race ภายในโปรเซส)
// DB_PATH (ค่าเริ่มต้น ./data/egov.db) · schema ของ "ทุกตาราง" ในระบบอยู่ที่นี่ (ดู INTERFACES.md §4)
// โมดูลอื่นเพิ่มตารางของตัวเองได้ด้วย db.exec('CREATE TABLE IF NOT EXISTS ...') ตอน register()
// reset ล้าง "ทุกตาราง" ใน sqlite_master (รวมตารางของโมดูล) แล้ว seed ใหม่

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(process.env.DB_PATH || './data/egov.db');

const SCHEMA = `
-- ผู้ใช้ฝั่งเจ้าหน้าที่ทุกบทบาท (ล็อกอิน SSO จำลองด้วย username/password)
CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,            -- crypto.hashPassword()
  display_name  TEXT NOT NULL,            -- เช่น 'เจ้าหน้าที่ทะเบียน 1' (user-name)
  role          TEXT NOT NULL,            -- officer|head|executive|auditor|admin (citizen ใช้ตาราง citizens)
  dept          TEXT,                     -- registry|works|NULL
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- ประชาชน (ThaiD จำลอง) · ข้อมูลส่วนบุคคลเข้ารหัส AES-256-GCM (NFR-04)
CREATE TABLE IF NOT EXISTS citizens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  id_hash       TEXT NOT NULL UNIQUE,     -- crypto.blindIndex(idNo) ใช้ค้นหาแทนเลขบัตร
  id_enc        TEXT NOT NULL,            -- crypto.encrypt(idNo 13 หลัก)
  name          TEXT NOT NULL,            -- ชื่อ-สกุลจาก ThaiD (แก้ไม่ได้)
  mobile_enc    TEXT,                     -- crypto.encrypt(เบอร์) · NULL = ยังไม่ลงทะเบียน
  email         TEXT NOT NULL DEFAULT '',
  registered    INTEGER NOT NULL DEFAULT 0,  -- 1 = ลงทะเบียนแล้ว
  consent_at    TEXT,
  registered_at TEXT,
  created_at    TEXT NOT NULL
);

-- ตัวนับ OTP ผิด / การล็อก ต่อเลขบัตร (key = blindIndex ไม่ใช่เลขบัตรตรง ๆ)
CREATE TABLE IF NOT EXISTS otp_state (
  id_hash       TEXT PRIMARY KEY,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,                     -- ISO +07:00 · NULL = ไม่ล็อก
  updated_at    TEXT
);

-- บริการ (admin แก้ fee / fee_per_sqm / sla_days ได้)
CREATE TABLE IF NOT EXISTS services (
  id            TEXT PRIMARY KEY,         -- SV-01 SV-02 SV-03
  name          TEXT NOT NULL,            -- ขอหนังสือรับรอง ...
  fee           INTEGER NOT NULL,         -- SV-01 ต่อฉบับ · SV-02 คงที่ · SV-03 ฐาน (feeBase พื้นที่ 1–100)
  fee_per_sqm   INTEGER,                  -- SV-03 เท่านั้น (ส่วนเกิน 100 ตร.ม.) · อื่น NULL
  sla_days      INTEGER NOT NULL,         -- วันทำการ
  sort          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays (
  date          TEXT PRIMARY KEY,         -- 'YYYY-MM-DD' ค.ศ.
  name          TEXT NOT NULL
);

-- ตัวนับเลขรัน: 'case:2569' 'doc:2569' 'draft' 'payref' 'file' (ใช้ db.nextCounter)
CREATE TABLE IF NOT EXISTS counters (
  key           TEXT PRIMARY KEY,
  value         INTEGER NOT NULL
);

-- คำขอ: แถวเดียวตั้งแต่ร่างจนปิด (DRAFT → PENDING_PAYMENT → SUBMITTED → ... )
CREATE TABLE IF NOT EXISTS cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id      TEXT UNIQUE,              -- DR-0001 · NULL สำหรับคำขอ seed ที่ไม่ได้มาจากร่าง
  case_no       TEXT UNIQUE,              -- EG-2569-000031 · NULL จนกว่าชำระสำเร็จ
  service_id    TEXT NOT NULL,
  citizen_id    INTEGER NOT NULL,         -- citizens.id
  status        TEXT NOT NULL,            -- ตาราง CONTRACT 4.1
  qty           INTEGER,                  -- SV-01 จำนวนฉบับ
  area_sqm      INTEGER,                  -- SV-03 พื้นที่
  fee           INTEGER NOT NULL DEFAULT 0, -- DRAFT: ค่าที่คำนวณล่าสุด · ตั้งแต่ PENDING_PAYMENT: ยอดที่ล็อก (BR-11)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  paid_at       TEXT,                     -- เวลาชำระสำเร็จ (= เวลายื่น/SUBMITTED)
  receipt_no    TEXT UNIQUE,              -- RC-2569-000031 (ลำดับเดียวกับเลขคำขอ)
  due_at        TEXT,                     -- กำหนดเสร็จ ISO +07:00 (คำนวณครั้งเดียวตอนชำระ · ขยายเมื่อส่งแก้)
  step          INTEGER,                  -- ลำดับขั้นในเส้นทาง (catalog.ROUTES) เริ่ม 1 · ไม่ถอยหลัง = "ขั้นสูงสุดที่เคยถึง"
  dept          TEXT,                     -- คิวที่เรื่องอยู่ตอนนี้: registry|works|head · NULL เมื่อปิด/ยกเลิก/ยังไม่ชำระ
  owner         TEXT,                     -- ผู้ถือเรื่อง (username) ของขั้นแผนกปัจจุบัน · NULL = ยังไม่มีผู้รับ
  reg_officer   TEXT,                     -- เจ้าหน้าที่ทะเบียนที่รับเรื่องขั้นแรก = "ผู้ออกเอกสาร" ทุกบริการ (A-27)
  works_officer TEXT,                     -- เจ้าหน้าที่โยธาที่รับเรื่องขั้น 2 (SV-03)
  return_count  INTEGER NOT NULL DEFAULT 0,
  returned_at   TEXT,                     -- เวลาตีกลับล่าสุด
  return_reason TEXT,                     -- เหตุผลตีกลับล่าสุด (return-reason-display)
  fix_deadline  TEXT,                     -- returned_at + 168 ชม. (เฉพาะตอน NEED_FIX)
  approved_by   TEXT,
  approved_at   TEXT,
  rejected_by   TEXT,
  reject_reason TEXT,
  closed_at     TEXT,                     -- COMPLETED / REJECTED เท่านั้น
  cancelled_at  TEXT,
  cancel_kind   TEXT,                     -- CITIZEN | FIX_TIMEOUT
  doc_no        TEXT                      -- เอกสารที่ออกแล้ว
);
CREATE INDEX IF NOT EXISTS idx_cases_status  ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_citizen ON cases(citizen_id);
CREATE INDEX IF NOT EXISTS idx_cases_owner   ON cases(owner);

-- ไฟล์แนบ (เก็บเนื้อไฟล์เป็น BLOB ในฐานข้อมูล → reset ล้างพร้อมกัน)
CREATE TABLE IF NOT EXISTS case_files (
  file_id       TEXT PRIMARY KEY,         -- F-000001
  case_id       INTEGER NOT NULL,         -- cases.id (ร่างหรือคำขอ)
  doc_key       TEXT NOT NULL,            -- id-card map site-photo plan deed extra
  name          TEXT NOT NULL,            -- ชื่อไฟล์เดิม
  mime          TEXT NOT NULL,            -- application/pdf image/jpeg image/png (จาก magic bytes)
  size          INTEGER NOT NULL,
  content       BLOB NOT NULL,            -- อ่านแล้วได้ Uint8Array → Buffer.from(row.content)
  phase         TEXT NOT NULL DEFAULT 'initial', -- initial | fix (แนบตอนส่งแก้)
  uploaded_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_case ON case_files(case_id);

-- QR ชำระเงิน (1 ร่างมีได้หลาย ref · สร้างใหม่ได้)
CREATE TABLE IF NOT EXISTS payments (
  ref           TEXT PRIMARY KEY,         -- PP-0001
  case_id       INTEGER NOT NULL,
  amount        INTEGER NOT NULL,         -- ยอดที่ล็อก
  status        TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PAID (EXPIRED คำนวณจากเวลา: now - qr_created_at >= 15 นาที)
  qr_created_at TEXT NOT NULL,
  qr_expires_at TEXT NOT NULL,            -- qr_created_at + 15:00
  paid_at       TEXT,
  case_no       TEXT,
  receipt_no    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_case ON payments(case_id);

-- ไทม์ไลน์ของคำขอ (case-timeline / timeline-item)
CREATE TABLE IF NOT EXISTS case_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL,
  time          TEXT NOT NULL,            -- ISO +07:00 จากนาฬิกากลาง
  type          TEXT NOT NULL,            -- ดู format.EVENT_TH
  actor         TEXT,                     -- username / 'citizen' / 'system'
  actor_role    TEXT,
  from_status   TEXT,
  to_status     TEXT,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(case_id);

-- แจ้งเตือนกระดิ่ง: 1 ครั้งต่อ (ผู้ใช้, คำขอ, ระดับ)
CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL,
  case_no       TEXT NOT NULL,
  level         TEXT NOT NULL,            -- near | overdue
  text          TEXT NOT NULL,            -- 'คำขอ EG-2569-000024 ใกล้ครบกำหนด'
  created_at    TEXT NOT NULL,
  UNIQUE(username, case_no, level)
);

-- เอกสารดิจิทัล (ลายเซ็น = HMAC ของ doc_no|case_no|applicant|service_id|issued_at|valid_until|signer)
CREATE TABLE IF NOT EXISTS documents (
  doc_no        TEXT PRIMARY KEY,         -- DOC-2569-000001
  case_id       INTEGER NOT NULL,
  case_no       TEXT NOT NULL,
  verify_code   TEXT NOT NULL UNIQUE,     -- [A-Z0-9]{8}
  applicant     TEXT NOT NULL,            -- ชื่อเต็มผู้ยื่น (tamper แก้ฟิลด์นี้)
  service_id    TEXT NOT NULL,
  issued_at     TEXT NOT NULL,            -- ISO +07:00
  valid_until   TEXT NOT NULL,            -- 'YYYY-MM-DD' วันสุดท้ายที่ใช้ได้
  signer        TEXT NOT NULL,            -- ชื่อแสดงผู้ลงนาม
  signature     TEXT NOT NULL,            -- hex
  issued_by     TEXT                      -- username ผู้กดออกเอกสาร
);

-- Audit Trail (เพิ่มได้อย่างเดียว · UPDATE ถูก trigger ปฏิเสธ)
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  time          TEXT NOT NULL,            -- ISO +07:00
  time_ms       INTEGER NOT NULL,
  username      TEXT NOT NULL,
  role          TEXT NOT NULL,
  event         TEXT NOT NULL,            -- STAFF_LOGIN CLAIM RETURN FORWARD APPROVE REJECT ISSUE UNMASK EXPORT ADMIN_CHANGE
  case_no       TEXT,
  from_status   TEXT,
  to_status     TEXT,
  detail        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(time);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const raw = new DatabaseSync(DB_PATH);
// journal ในหน่วยความจำ + ไม่ fsync: เร็วบน bind mount (WSL/drvfs) และไม่มีไฟล์ -wal/-shm ให้ข้อมูลหลุดไปอยู่นอก DB_PATH
raw.exec('PRAGMA journal_mode = MEMORY');
raw.exec('PRAGMA synchronous = OFF');
raw.exec('PRAGMA secure_delete = ON');   // หน้าที่ถูกลบถูกเขียนทับด้วย 0
raw.exec('PRAGMA foreign_keys = OFF');
raw.exec(SCHEMA);

const cache = new Map();
function prepare(sql) {
  let s = cache.get(sql);
  if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
  return s;
}

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
function normParams(params) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object'
      && !(params[0] instanceof Uint8Array) && !Array.isArray(params[0])) {
    const o = {};
    for (const [k, v] of Object.entries(params[0])) o[k] = norm(v);
    return [o];
  }
  if (params.length === 1 && Array.isArray(params[0])) return params[0].map(norm);
  return params.map(norm);
}

/** แถวแรก หรือ undefined · พารามิเตอร์: ?, ?... หรือ object {name} สำหรับ :name/$name/@name */
function get(sql, ...params) { return prepare(sql).get(...normParams(params)); }
/** ทุกแถว (array) */
function all(sql, ...params) { return prepare(sql).all(...normParams(params)); }
/** INSERT/UPDATE/DELETE → { changes, lastInsertRowid } */
function run(sql, ...params) { return prepare(sql).run(...normParams(params)); }
/** รันหลายคำสั่ง (ไม่มีพารามิเตอร์) */
function exec(sql) { return raw.exec(sql); }

let txDepth = 0;
/** รัน fn ใน transaction (ซ้อนได้ด้วย SAVEPOINT) · fn ต้องเป็น synchronous · throw → rollback */
function tx(fn) {
  const sp = `sp_${txDepth}`;
  if (txDepth === 0) raw.exec('BEGIN IMMEDIATE'); else raw.exec(`SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const out = fn();
    txDepth--;
    if (txDepth === 0) raw.exec('COMMIT'); else raw.exec(`RELEASE ${sp}`);
    return out;
  } catch (e) {
    txDepth--;
    if (txDepth === 0) raw.exec('ROLLBACK'); else raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

/** เพิ่มตัวนับแล้วคืนค่าใหม่ (เริ่ม 1) · atomic เพราะ DatabaseSync ทำงานทีละคำสั่ง */
function nextCounter(key) {
  run('INSERT INTO counters(key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1', key);
  return get('SELECT value FROM counters WHERE key = ?', key).value;
}
function peekCounter(key) { const r = get('SELECT value FROM counters WHERE key = ?', key); return r ? r.value : 0; }
function setCounter(key, value) {
  run('INSERT INTO counters(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

/** ชื่อตารางทั้งหมด (รวมตารางที่โมดูลสร้าง) */
function tableNames() {
  return all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
}

/** ล้างข้อมูลทุกตาราง + รีเซ็ต AUTOINCREMENT (ใช้ใน reset เท่านั้น) */
function wipeAll() {
  for (const t of tableNames()) raw.exec(`DELETE FROM "${t}"`);
  const seq = get("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'");
  if (seq) raw.exec('DELETE FROM sqlite_sequence');
}

/** ย่อไฟล์เมื่อมีหน้าว่างมาก (เช่น หลังลบไฟล์อัปโหลดขนาดใหญ่) */
function compactIfNeeded() {
  const free = get('PRAGMA freelist_count');
  const n = free ? Object.values(free)[0] : 0;
  if (n > 2048) raw.exec('VACUUM');
}

module.exports = {
  DB_PATH, raw, prepare, get, all, run, exec, tx,
  nextCounter, peekCounter, setCounter, tableNames, wipeAll, compactIfNeeded,
};
