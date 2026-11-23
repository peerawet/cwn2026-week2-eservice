'use strict';
// ตัวช่วยสร้าง PDF (pdfkit + ฟอนต์ Sarabun) · ข้อความไทย/ละตินผสมด้วยการแยกช่วงตามชุดอักษร
// บรรทัด ASCII ที่เครื่องอ่านได้ต้องอยู่ใน doc.info.Keywords (ข้อความที่วาดถูกเข้ารหัสเป็น hex)

const PDFDocument = require('pdfkit');

const FONT_TH = require.resolve('@fontsource/sarabun/files/sarabun-thai-400-normal.woff');
const FONT_LAT = require.resolve('@fontsource/sarabun/files/sarabun-latin-400-normal.woff');
const THAI = /[฀-๿]/;

function newDoc(info) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info });
  doc.registerFont('th', FONT_TH);
  doc.registerFont('lat', FONT_LAT);
  return doc;
}

function runs(text) {
  const out = [];
  for (const ch of String(text)) {
    const th = THAI.test(ch);
    const last = out[out.length - 1];
    if (last && last.th === th) last.s += ch; else out.push({ th, s: ch });
  }
  return out;
}

function widthOf(doc, text, size) {
  let w = 0;
  for (const r of runs(text)) { doc.font(r.th ? 'th' : 'lat').fontSize(size); w += doc.widthOfString(r.s); }
  return w;
}

/** วาดข้อความผสมไทย/ละตินที่ (x, y) บรรทัดเดียว คืนความกว้าง */
function mixed(doc, text, x, y, size = 14) {
  let xx = x;
  for (const r of runs(text)) {
    doc.font(r.th ? 'th' : 'lat').fontSize(size);
    doc.text(r.s, xx, y, { lineBreak: false });
    xx += doc.widthOfString(r.s);
  }
  return xx - x;
}

function centered(doc, text, y, size = 14) {
  const w = widthOf(doc, text, size);
  mixed(doc, text, (doc.page.width - w) / 2, y, size);
}

/** รวมผลเป็น Buffer */
function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { newDoc, mixed, centered, widthOf, toBuffer };
