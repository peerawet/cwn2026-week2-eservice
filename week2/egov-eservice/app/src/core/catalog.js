'use strict';
// ข้อมูลคงที่ของบริการ (ชื่อ เอกสาร เส้นทาง) · ค่าธรรมเนียม/SLA ที่แก้ได้อยู่ในตาราง services (DB)

const SERVICE_IDS = ['SV-01', 'SV-02', 'SV-03'];

const SERVICE_NAMES = {
  'SV-01': 'ขอหนังสือรับรอง',
  'SV-02': 'ขออนุญาตประกอบกิจการ',
  'SV-03': 'ขออนุญาตก่อสร้าง/ต่อเติมอาคาร',
};

// เอกสารต่อบริการ "ตามลำดับที่ใช้ใน missing-docs" (CONTRACT 4.3)
const DOCS = {
  'SV-01': [
    { key: 'id-card', label: 'บัตรประชาชน', required: true },
  ],
  'SV-02': [
    { key: 'id-card', label: 'บัตรประชาชน', required: true },
    { key: 'map', label: 'แผนที่ตั้ง', required: true },
    { key: 'site-photo', label: 'ภาพสถานที่', required: false },
  ],
  'SV-03': [
    { key: 'id-card', label: 'บัตรประชาชน', required: true },
    { key: 'plan', label: 'แบบแปลน', required: true, pdfOnly: true },
    { key: 'deed', label: 'โฉนด', required: true },
  ],
};
// ช่องเอกสารเพิ่มเติม (ทุกบริการ ไม่บังคับ หลายไฟล์)
const EXTRA_DOC = { key: 'extra', label: 'เอกสารเพิ่มเติม', required: false, multiple: true };
const DOC_LABELS = { 'id-card': 'บัตรประชาชน', map: 'แผนที่ตั้ง', 'site-photo': 'ภาพสถานที่', plan: 'แบบแปลน', deed: 'โฉนด', extra: 'เอกสารเพิ่มเติม' };

// เส้นทาง (step เริ่ม 1) · dept ของขั้น: registry | works | head
// SV-01: ทะเบียน (ตรวจ + อนุมัติโดยเจ้าหน้าที่) → ออกเอกสาร
// SV-02: ทะเบียน → หัวหน้าอนุมัติ → ออกเอกสาร
// SV-03: ทะเบียน → โยธา → หัวหน้าอนุมัติ → ออกเอกสาร
const ROUTES = {
  'SV-01': ['registry'],
  'SV-02': ['registry', 'head'],
  'SV-03': ['registry', 'works', 'head'],
};
// ผู้อนุมัติ: SV-01 = เจ้าหน้าที่ผู้ถือเรื่อง · SV-02/03 = head ที่ PENDING_APPROVAL
const APPROVER = { 'SV-01': 'officer', 'SV-02': 'head', 'SV-03': 'head' };

const DEPT_NAMES = { registry: 'ฝ่ายทะเบียน', works: 'ฝ่ายโยธา', head: 'หัวหน้าฝ่าย' };

/** 'SV-01 ขอหนังสือรับรอง' (case-service / verify-service) */
function serviceLabel(id) { return `${id} ${SERVICE_NAMES[id] || ''}`.trim(); }

/** เอกสารบังคับที่ยังขาด (ตามลำดับตาราง) · docKeys = รายการ doc_key ที่แนบแล้ว */
function missingDocs(serviceId, docKeys) {
  const have = new Set(docKeys);
  return (DOCS[serviceId] || []).filter((d) => d.required && !have.has(d.key)).map((d) => d.label);
}

/** ป้ายขั้นตอน SV-03 (A-40): 'ขั้นตอน 2/3 · ฝ่ายโยธา' · บริการอื่น → null */
function stepLabel(serviceId, step) {
  if (serviceId !== 'SV-03' || !step) return null;
  const route = ROUTES['SV-03'];
  const s = Math.min(Math.max(step, 1), route.length);
  return `ขั้นตอน ${s}/${route.length} · ${DEPT_NAMES[route[s - 1]]}`;
}

module.exports = {
  SERVICE_IDS, SERVICE_NAMES, DOCS, EXTRA_DOC, DOC_LABELS, ROUTES, APPROVER, DEPT_NAMES,
  serviceLabel, missingDocs, stepLabel,
};
