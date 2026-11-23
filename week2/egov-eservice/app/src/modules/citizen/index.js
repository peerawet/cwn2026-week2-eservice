'use strict';
// โมดูล citizen (B02): ล็อกอิน/ลงทะเบียน · ยื่นคำขอ 3 ขั้น · ชำระ QR จำลอง · ดูคำขอ/ไฟล์ · ยกเลิก
// BUG_MODE ที่เป็นของโมดูลนี้: B01 (fees.js) B02 B05 (drafts.js) B06 (caseapi.js)

const makeFees = require('./fees');
const registerAuth = require('./auth');
const registerDrafts = require('./drafts');
const registerCaseApi = require('./caseapi');
const registerPages = require('./pages');

exports.register = (app, ctx) => {
  const fees = makeFees(ctx);
  registerAuth(app, ctx);
  const { draftJson } = registerDrafts(app, ctx, fees);
  const { viewableCase } = registerCaseApi(app, ctx);
  registerPages(app, ctx, { draftJson, viewableCase });
};
