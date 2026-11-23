/**
 * globalSetup — สร้างไฟล์ทดสอบอัปโหลดตาม TEST-DATA ข้อ 11 ลงใน fixtures/files/
 * (แปลงจากสคริปต์ make_testfiles.py ของ TA เป็น Node built-in ล้วน: fs, path, zlib)
 *
 * - สร้างใหม่เฉพาะไฟล์ที่ยังไม่มี หรือมีแต่เนื้อไฟล์ไม่ตรง (ขนาด/ไบต์ไม่เท่ากับที่ควรได้)
 * - ใช้ร่วมกันทั้ง part1 (T1) และ part2 (T2) · รายชื่อไฟล์ดู fixtures/README.md
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export const FILES_DIR = path.resolve(__dirname, 'files');

// ---------- CRC32 (สำหรับ chunk ของ PNG) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
function u16be(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

/** PDF จริงขนาด n ไบต์ (หัว %PDF + เติมช่องว่างแล้วปิดด้วย %%EOF) — ตรงกับ pdf(n) ใน TEST-DATA */
export function pdf(n: number): Buffer {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'latin1');
  const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
  const pad = n - head.length - tail.length;
  if (pad < 0) throw new Error(`pdf(${n}) เล็กเกินไป`);
  return Buffer.concat([head, Buffer.alloc(pad, 0x20), tail]);
}

/** PNG จริง 1x1 + เติม chunk tEXt ให้ครบขนาด n ไบต์ — ตรงกับ png(n) ใน TEST-DATA */
export function png(n: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type, 'latin1');
    return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))]);
  };
  const ihdr = Buffer.concat([u32be(1), u32be(1), Buffer.from([8, 2, 0, 0, 0])]);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const base = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const pad = n - base.length - 12; // overhead ของ chunk tEXt = 12 ไบต์
  if (pad < 2) throw new Error(`png(${n}) เล็กเกินไป`);
  const text = chunk('tEXt', Buffer.concat([Buffer.from('k\x00', 'latin1'), Buffer.alloc(pad - 2, 0x78)]));
  return Buffer.concat([base.subarray(0, base.length - 12), text, base.subarray(base.length - 12)]);
}

/** JPEG จริงแบบย่อ: SOI + APP0(JFIF) + COM เติมให้ครบ + EOI — ตรงกับ jpg(n) ใน TEST-DATA */
export function jpg(n: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const pad = n - soi.length - app0.length - 2 - 4;
  if (pad < 0) throw new Error(`jpg(${n}) เล็กเกินไป`);
  return Buffer.concat([soi, app0, Buffer.from([0xff, 0xfe]), u16be(pad + 2), Buffer.alloc(pad, 0x78), Buffer.from([0xff, 0xd9])]);
}

/** รายการไฟล์ทั้งหมดที่ TEST-DATA ข้อ 11 / TEST-PLAN อ้างถึง */
export function fixtureSpecs(): Record<string, () => Buffer> {
  const specs: Record<string, () => Buffer> = {};
  for (const name of ['ok-id.pdf', 'id-card.pdf', 'map.pdf', 'plan.pdf', 'deed.pdf']) specs[name] = () => pdf(1024);
  for (let i = 1; i <= 6; i++) specs[`multi-${i}.pdf`] = () => pdf(1024);
  specs['real.jpg'] = () => jpg(1024);
  specs['real.png'] = () => png(1024);
  specs['plan-as-jpg.jpg'] = () => jpg(1024);
  for (const n of [5242879, 5242880, 5242881]) specs[`size-${n}.pdf`] = () => pdf(n);
  specs['fake-text.pdf'] = () => Buffer.from('hello', 'latin1');
  specs['fake-text.jpg'] = () => Buffer.from('hello', 'latin1');
  specs['notes.txt'] = () => Buffer.from('hello', 'latin1');
  specs['exe-as.png'] = () => Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(1022, 0)]);
  return specs;
}

export function ensureFixtureFiles(): void {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  for (const [name, make] of Object.entries(fixtureSpecs())) {
    const p = path.join(FILES_DIR, name);
    const want = make();
    let ok = false;
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      ok = st.size === want.length && fs.readFileSync(p).equals(want);
    }
    if (!ok) fs.writeFileSync(p, want);
  }
  // ตรวจขนาดขอบตรงไบต์ (5 MB = 5 × 1,048,576)
  for (const n of [5242879, 5242880, 5242881]) {
    const size = fs.statSync(path.join(FILES_DIR, `size-${n}.pdf`)).size;
    if (size !== n) throw new Error(`size-${n}.pdf มีขนาด ${size} ไม่ตรง ${n}`);
  }
}

export default async function globalSetup(): Promise<void> {
  ensureFixtureFiles();
}
