'use strict';
// ล็อกอินประชาชน (ThaiD จำลอง) · ลงทะเบียน · ล็อกอินเจ้าหน้าที่ (SSO จำลอง)  — CONTRACT §6.1

const OTP_OK = '123456';
const MAX_FAIL = 3;
const LOCK_MS = 15 * 60 * 1000;

module.exports = function registerAuth(app, ctx) {
  const { errors, crypto, people, clock, db, session, audit } = ctx;
  const { sendError } = errors;

  const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  const idOf = (req) => {
    const v = bodyOf(req).idNo;
    return typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : '');
  };

  /** สถานะล็อก ณ ตอนนี้ → ISO ที่ปลดล็อก หรือ null (ปลดล็อกแล้วรีเซ็ตตัวนับให้) */
  function activeLock(hash) {
    const st = db.get('SELECT * FROM otp_state WHERE id_hash = ?', hash);
    if (!st || !st.locked_until) return null;
    const until = clock.parseIso(st.locked_until);
    if (clock.now() < until) return st.locked_until;
    db.run('UPDATE otp_state SET fail_count = 0, locked_until = NULL, updated_at = ? WHERE id_hash = ?', clock.nowIso(), hash);
    return null;
  }

  app.post('/api/auth/thaid/start', (req, res) => {
    const idNo = idOf(req);
    if (!crypto.isValidThaiId(idNo)) return sendError(res, 'INVALID_ID');
    const lockedUntil = activeLock(crypto.blindIndex(idNo));
    if (lockedUntil) return sendError(res, 'LOCKED', { lockedUntil });
    res.json({ status: 'OTP_SENT' });
  });

  app.post('/api/auth/thaid/verify', (req, res) => {
    const idNo = idOf(req);
    if (!crypto.isValidThaiId(idNo)) return sendError(res, 'INVALID_ID');
    const otp = bodyOf(req).otp;
    const hash = crypto.blindIndex(idNo);
    const lockedUntil = activeLock(hash);
    if (lockedUntil) return sendError(res, 'LOCKED', { lockedUntil });

    if (String(otp == null ? '' : otp).trim() !== OTP_OK) {
      const st = db.get('SELECT fail_count FROM otp_state WHERE id_hash = ?', hash);
      const fails = (st ? Number(st.fail_count) : 0) + 1;
      const nowIso = clock.nowIso();
      if (fails >= MAX_FAIL) {
        const until = clock.toIso(clock.now() + LOCK_MS);
        db.run(`INSERT INTO otp_state(id_hash, fail_count, locked_until, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(id_hash) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
        hash, fails, until, nowIso);
        return sendError(res, 'LOCKED', { lockedUntil: until });
      }
      db.run(`INSERT INTO otp_state(id_hash, fail_count, locked_until, updated_at) VALUES (?, ?, NULL, ?)
              ON CONFLICT(id_hash) DO UPDATE SET fail_count = excluded.fail_count, updated_at = excluded.updated_at`,
      hash, fails, nowIso);
      return sendError(res, 'OTP_INVALID', { attemptsLeft: MAX_FAIL - fails });
    }

    // OTP ถูก: รีเซ็ตตัวนับ แล้วล็อกอิน (ไม่มีในระบบ → สร้างประชาชนใหม่ที่ยังไม่ลงทะเบียน)
    db.run('DELETE FROM otp_state WHERE id_hash = ?', hash);
    let c = people.findCitizenByIdNo(idNo);
    let row;
    if (c) row = people.getCitizenRow(c.id);
    else row = people.getCitizenRow(people.createCitizen({ idNo, name: 'ประชาชน ผู้ใช้ใหม่' }));
    const user = session.loginCitizen(req, res, row);
    res.json({ registered: !!user });
  });

  app.post('/api/auth/register', (req, res) => {
    if (!req.pending) {
      if (req.user && req.user.role === 'citizen') return sendError(res, 'INVALID_STATE');
      return sendError(res, 'UNAUTHENTICATED');
    }
    const b = bodyOf(req);
    const mobile = typeof b.mobile === 'string' ? b.mobile.trim() : '';
    if (!/^0\d{9}$/.test(mobile)) return sendError(res, 'INVALID_MOBILE');
    if (b.consent !== true && b.consent !== 'true' && b.consent !== 'on') return sendError(res, 'CONSENT_REQUIRED');
    const email = typeof b.email === 'string' ? b.email.trim().slice(0, 200) : '';
    people.registerCitizen(req.pending.citizenId, { mobile, email });
    const row = people.getCitizenRow(req.pending.citizenId);
    session.promotePending(req, row);
    res.status(201).json({ ok: true, landing: '/citizen' });
  });

  app.post('/api/auth/staff/login', (req, res) => {
    const b = bodyOf(req);
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const row = username ? people.getUser(username) : undefined;
    if (!row || !row.active || !password || !crypto.verifyPassword(password, row.password_hash)) {
      return sendError(res, 'INVALID_CREDENTIALS');
    }
    const user = session.loginStaff(req, res, row);
    audit.log({ user, event: 'STAFF_LOGIN', detail: '' });
    res.json({ role: user.role, dept: user.dept || null, landing: session.landingFor(user) });
  });
};
