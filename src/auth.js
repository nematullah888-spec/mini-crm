// الحساب وتسجيل الدخول واستعادة كلمة المرور
'use strict';

const crypto = require('crypto');
const { sendMail } = require('./mailer');

const SESSION_TTL = 12 * 60 * 60 * 1000;    // 12 ساعة بدون استخدام
const RESET_TTL = 15 * 60 * 1000;           // رمز الإيميل صالح 15 دقيقة
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function httpError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function hash(secret, salt) {
  return crypto.scryptSync(String(secret), salt, 64).toString('hex');
}
function makeHash(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hash(secret, salt) };
}
function verify(secret, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const a = Buffer.from(hash(secret, rec.salt), 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newRecoveryCode() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s.match(/.{4}/g).join('-');
}
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!d) return '';
  return (u.length <= 2 ? u[0] + '*' : u[0] + '***' + u[u.length - 1]) + '@' + d;
}

function checkUsername(u) {
  u = String(u || '').trim();
  if (u.length < 3 || u.length > 40) throw httpError(400, 'اسم المستخدم لازم يكون من 3 إلى 40 حرف');
  return u;
}
function checkPassword(p) {
  p = String(p || '');
  if (p.length < 6) throw httpError(400, 'كلمة المرور لازم تكون 6 خانات على الأقل');
  if (p.length > 200) throw httpError(400, 'كلمة المرور طويلة جداً');
  return p;
}
function checkEmail(e) {
  e = String(e || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120) throw httpError(400, 'البريد الإلكتروني غير صحيح');
  return e;
}

/**
 * store: { getAuth(), setAuth(obj) }  — يحفظ بيانات الحساب في ملف البيانات
 * options.send: دالة إرسال بريد بديلة (للاختبار)
 */
function createAuth(store, options = {}) {
  const send = options.send || sendMail;
  const sessions = new Map();     // token -> expires
  let reset = null;               // { hash, expires, attempts }
  let lastResetSent = 0;
  let failures = 0;
  let lockedUntil = 0;

  const acc = () => store.getAuth();
  const hasAccount = () => !!(acc() && acc().username);

  function newSession() {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    return token;
  }

  function checkSession(token) {
    const exp = token && sessions.get(token);
    if (!exp || exp < Date.now()) {
      if (token) sessions.delete(token);
      return false;
    }
    sessions.set(token, Date.now() + SESSION_TTL);
    return true;
  }

  function guardLock() {
    if (Date.now() < lockedUntil) {
      const s = Math.ceil((lockedUntil - Date.now()) / 1000);
      throw httpError(429, `محاولات كثيرة خاطئة. حاول بعد ${s} ثانية.`);
    }
  }
  function fail(msg) {
    failures += 1;
    if (failures >= 5) { lockedUntil = Date.now() + 60 * 1000; failures = 0; }
    throw httpError(401, msg, 'bad_credentials');
  }

  function smtpReady() {
    const s = acc() && acc().smtp;
    return !!(s && s.host && s.user && s.pass);
  }

  async function mail(to, subject, text) {
    const s = acc().smtp;
    await send({ host: s.host, port: s.port, user: s.user, pass: s.pass,
      from: s.user, fromName: 'برنامج العملاء', to, subject, text, tlsOptions: options.tlsOptions });
  }

  function setPassword(password) {
    const a = acc();
    a.password = makeHash(password);
    store.setAuth(a);
    sessions.clear();
    reset = null;
  }

  return {
    hasAccount,
    checkSession,

    status() {
      return { hasAccount: hasAccount(), smtpReady: hasAccount() && smtpReady(),
        emailHint: hasAccount() ? maskEmail(acc().email) : '' };
    },

    setup({ username, password, email }) {
      if (hasAccount()) throw httpError(409, 'الحساب موجود مسبقاً');
      const code = newRecoveryCode();
      store.setAuth({
        username: checkUsername(username),
        password: makeHash(checkPassword(password)),
        email: checkEmail(email),
        recovery: makeHash(normCode(code)),
        smtp: { host: 'smtp.gmail.com', port: 465, user: '', pass: '' }
      });
      return { token: newSession(), username: acc().username, recoveryCode: code };
    },

    login({ username, password }) {
      if (!hasAccount()) throw httpError(409, 'لا يوجد حساب بعد');
      guardLock();
      const a = acc();
      const sameUser = String(username || '').trim().toLowerCase() === a.username.toLowerCase();
      if (!sameUser || !verify(String(password || ''), a.password)) fail('اسم المستخدم أو كلمة المرور غير صحيحة');
      failures = 0;
      return { token: newSession(), username: a.username };
    },

    logout(token) { sessions.delete(token); },

    async forgot() {
      if (!hasAccount()) throw httpError(409, 'لا يوجد حساب بعد');
      if (!smtpReady()) {
        throw httpError(400, 'إرسال البريد غير مُعدّ في البرنامج. استخدم رمز الاسترداد.', 'smtp_not_ready');
      }
      if (Date.now() - lastResetSent < 60 * 1000) throw httpError(429, 'انتظر دقيقة قبل طلب رمز جديد');
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await mail(acc().email, 'رمز استعادة كلمة المرور - برنامج العملاء',
        `رمز استعادة كلمة المرور:\n\n${code}\n\nالرمز صالح لمدة 15 دقيقة.\nإذا ما طلبت هذا الرمز، تجاهل الرسالة.`);
      lastResetSent = Date.now();
      reset = { rec: makeHash(code), expires: Date.now() + RESET_TTL, attempts: 0 };
      return { sent: true, emailHint: maskEmail(acc().email) };
    },

    resetWithEmailCode({ code, newPassword }) {
      checkPassword(newPassword);
      if (!reset || reset.expires < Date.now()) throw httpError(400, 'الرمز منتهي. اطلب رمز جديد.');
      if (++reset.attempts > 5) { reset = null; throw httpError(400, 'محاولات كثيرة. اطلب رمز جديد.'); }
      if (!verify(String(code || '').trim(), reset.rec)) throw httpError(400, 'الرمز غير صحيح');
      setPassword(newPassword);
      return { token: newSession(), username: acc().username };
    },

    resetWithRecoveryCode({ recoveryCode, newPassword }) {
      if (!hasAccount()) throw httpError(409, 'لا يوجد حساب بعد');
      checkPassword(newPassword);
      guardLock();
      if (!verify(normCode(recoveryCode), acc().recovery)) fail('رمز الاسترداد غير صحيح');
      failures = 0;
      setPassword(newPassword);
      const code = newRecoveryCode();
      const a = acc();
      a.recovery = makeHash(normCode(code));
      store.setAuth(a);
      return { token: newSession(), username: a.username, recoveryCode: code };
    },

    account() {
      const a = acc();
      return { username: a.username, email: a.email,
        smtp: { host: a.smtp.host, port: a.smtp.port, user: a.smtp.user, hasPass: !!a.smtp.pass } };
    },

    updateAccount(token, { currentPassword, username, email, newPassword }) {
      const a = acc();
      if (!verify(String(currentPassword || ''), a.password)) throw httpError(400, 'كلمة المرور الحالية غير صحيحة');
      if (username != null && username !== '') a.username = checkUsername(username);
      if (email != null && email !== '') a.email = checkEmail(email);
      if (newPassword) {
        a.password = makeHash(checkPassword(newPassword));
        // تسجيل خروج باقي الأجهزة، والإبقاء على هذا الجهاز
        for (const t of [...sessions.keys()]) if (t !== token) sessions.delete(t);
      }
      store.setAuth(a);
      return this.account();
    },

    newRecovery({ currentPassword }) {
      const a = acc();
      if (!verify(String(currentPassword || ''), a.password)) throw httpError(400, 'كلمة المرور الحالية غير صحيحة');
      const code = newRecoveryCode();
      a.recovery = makeHash(normCode(code));
      store.setAuth(a);
      return { recoveryCode: code };
    },

    updateSmtp({ host, port, user, pass }) {
      const a = acc();
      host = String(host || '').trim();
      port = Number(port) || 465;
      user = String(user || '').trim();
      if (!host) throw httpError(400, 'اكتب عنوان خادم البريد');
      if (user) checkEmail(user);
      a.smtp = { host, port, user, pass: pass ? String(pass).replace(/\s+/g, '') : a.smtp.pass };
      if (!user) a.smtp.pass = '';
      store.setAuth(a);
      return this.account();
    },

    async testSmtp() {
      if (!smtpReady()) throw httpError(400, 'أكمل بيانات البريد أولاً');
      await mail(acc().email, 'رسالة تجربة - برنامج العملاء',
        'تم إعداد إرسال البريد بنجاح ✓\nإذا نسيت كلمة المرور، بيوصلك رمز الاستعادة على هذا البريد.');
      return { sent: true, emailHint: maskEmail(acc().email) };
    }
  };
}

module.exports = { createAuth, newRecoveryCode, maskEmail };
