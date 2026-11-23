'use strict';
// โมดูล mgmt (B04): เอกสารดิจิทัล + /verify · Dashboard · Audit · ผู้ดูแลระบบ · unmask (PDPA)
// BUG_MODE ของโมดูลนี้: B10 (dashboard.js) · B11 (documents.js unmask)

exports.register = (app, ctx) => {
  require('./documents')(app, ctx);
  require('./dashboard')(app, ctx);
  require('./audit')(app, ctx);
  require('./admin')(app, ctx);
};
