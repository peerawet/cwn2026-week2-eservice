# fixtures · ไฟล์ทดสอบอัปโหลด (ใช้ร่วม part1 / part2)

`global-setup.ts` (globalSetup ของ `playwright.config.ts`) สร้างไฟล์ทั้งหมดใน `fixtures/files/` ทุกครั้งที่รัน
(สร้างเฉพาะไฟล์ที่ยังไม่มีหรือเนื้อไม่ตรง) · แปลงจาก `make_testfiles.py` ใน TEST-DATA ข้อ 11 แบบไบต์ต่อไบต์
(ตรวจแล้วว่าได้ไฟล์เหมือนสคริปต์ Python ของ TA ทุกไบต์) · ใช้แค่ Node built-in (`fs` `path` `zlib`)

| ไฟล์ | ชนิดจริง (magic bytes) | ขนาด (ไบต์) | ผลที่คาดหวัง / ใช้ใน |
|---|---|---|---|
| `id-card.pdf` | PDF (`%PDF`) | 1,024 | เอกสารบังคับทุกบริการ (`docKey` `id-card`) · NEW_PAID · SUBMIT-01/02 · UPLOAD-01 |
| `map.pdf` | PDF | 1,024 | SV-02 แผนที่ตั้ง (`map`) · NEW_PAID SV-02 · SUBMIT-02 |
| `plan.pdf` | PDF | 1,024 | SV-03 แบบแปลน (`plan` · PDF เท่านั้น) · NEW_PAID SV-03 · SUBMIT-02 |
| `deed.pdf` | PDF | 1,024 | SV-03 โฉนด (`deed`) · NEW_PAID SV-03 · SUBMIT-02 |
| `ok-id.pdf` | PDF | 1,024 | รับ · UPLOAD-02 |
| `real.jpg` | JPEG (`FF D8 FF`) | 1,024 | รับ (บัตรประชาชน/ภาพสถานที่/แผนที่) · UPLOAD-02 |
| `real.png` | PNG (`89 50 4E 47`) | 1,024 | รับ · UPLOAD-02 |
| `plan-as-jpg.jpg` | JPEG | 1,024 | ช่องแบบแปลน SV-03 → `แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น` (400 `PLAN_NOT_PDF`) · SUBMIT-02 |
| `size-5242879.pdf` | PDF | **5,242,879** | รับ · UPLOAD-01 |
| `size-5242880.pdf` | PDF | **5,242,880** | **รับ** (ขอบ ≤ 5 MB · จับ B02) · UPLOAD-01 |
| `size-5242881.pdf` | PDF | **5,242,881** | ปฏิเสธ `ไฟล์ใหญ่เกิน 5 MB` (400 `FILE_TOO_LARGE`) · UPLOAD-01 |
| `fake-text.pdf` | ข้อความ `hello` | 5 | ปฏิเสธ `รองรับเฉพาะไฟล์ PDF, JPG, PNG` (400 `FILE_TYPE`) · ส่งด้วย `mimeType: application/pdf` ก็ต้องถูกปฏิเสธ · UPLOAD-02 |
| `fake-text.jpg` | ข้อความ `hello` | 5 | ปฏิเสธ (`FILE_TYPE`) · UPLOAD-02 |
| `exe-as.png` | หัว `MZ` + 0x00 | 1,024 | ปฏิเสธ (`FILE_TYPE`) · UPLOAD-02 |
| `notes.txt` | ข้อความ `hello` | 5 | ปฏิเสธ (`FILE_TYPE`) · UPLOAD-02 |
| `multi-1.pdf` … `multi-6.pdf` | PDF | 1,024 | ทดสอบจำนวน: รวม 5 ไฟล์ → รับ · ไฟล์ที่ 6 → `แนบได้สูงสุด 5 ไฟล์ต่อคำขอ` (400 `FILE_COUNT`) · UPLOAD-01 |

## วิธีใช้ใน spec

```ts
import * as path from 'path';
const FILES = path.resolve(__dirname, '../../fixtures/files');   // จาก e2e/partN/*.spec.ts
await page.getByTestId('upload-input-id-card').setInputFiles(path.join(FILES, 'id-card.pdf'));
// API: multipart ตาม CONTRACT 6.2
await api.post(`/api/drafts/${id}/files`, { multipart: { docKey: 'id-card',
  file: { name: 'id-card.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(FILES, 'id-card.pdf')) } } });
```

`part1/helpers.ts` มี `FILES_DIR`, `fixturePath(name)`, `uploadApi(api, draftId, docKey, name, mime?)` ให้ใช้ได้เลย
