// اختبار تسجيل الدخول واستعادة كلمة المرور (مع خادم بريد وهمي)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const tls = require('tls');
const path = require('path');
const { createServer } = require('../src/server');
const { sendMail } = require('../src/mailer');

const { execSync } = require('child_process');

// شهادة مؤقتة للاختبار فقط (تُنشأ وقت الاختبار ثم تُحذف)
let key = null, cert = null;
try {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cert-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${path.join(t, 'k.pem')}" -out "${path.join(t, 'c.pem')}" -days 1 -subj "/CN=localhost"`, { stdio: 'ignore' });
  key = fs.readFileSync(path.join(t, 'k.pem'));
  cert = fs.readFileSync(path.join(t, 'c.pem'));
  fs.rmSync(t, { recursive: true, force: true });
} catch (_) {
  console.log('ℹ️ openssl غير متوفر: نختبر الإرسال ببديل وهمي');
}

// خادم SMTP وهمي يدعم STARTTLS أو اتصال مشفّر مباشرة
function fakeSmtp({ implicit, user, pass }) {
  const inbox = [];
  const handle = (sock, secured) => {
    let data = null;
    let buf = '';
    let authStep = 0;
    let gotUser = '';
    const w = l => sock.write(l + '\r\n');
    sock.setEncoding('utf8');
    const onData = chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data !== null) {
          if (line === '.') { inbox.push(data.join('\r\n')); data = null; w('250 OK queued'); }
          else data.push(line);
          continue;
        }
        if (authStep === 1) { gotUser = Buffer.from(line, 'base64').toString(); authStep = 2; w('334 UGFzc3dvcmQ6'); continue; }
        if (authStep === 2) {
          authStep = 0;
          const ok = gotUser === user && Buffer.from(line, 'base64').toString() === pass;
          w(ok ? '235 Authentication successful' : '535 Authentication failed');
          continue;
        }
        if (/^EHLO/i.test(line)) { w('250-fake'); if (!secured) w('250-STARTTLS'); w('250 AUTH LOGIN'); }
        else if (/^STARTTLS/i.test(line)) {
          w('220 Go ahead');
          sock.removeListener('data', onData);
          const t = new tls.TLSSocket(sock, { isServer: true, key, cert });
          handle(t, true);
          return;
        }
        else if (/^AUTH LOGIN/i.test(line)) { authStep = 1; w('334 VXNlcm5hbWU6'); }
        else if (/^MAIL FROM/i.test(line) || /^RCPT TO/i.test(line)) w('250 OK');
        else if (/^DATA/i.test(line)) { data = []; w('354 End data with .'); }
        else if (/^QUIT/i.test(line)) { w('221 Bye'); sock.end(); }
        else w('500 ?');
      }
    };
    sock.on('data', onData);
    sock.on('error', () => {});
  };
  const srv = implicit
    ? tls.createServer({ key, cert }, s => { handle(s, true); s.write('220 fake ESMTP\r\n'); })
    : net.createServer(s => { handle(s, false); s.write('220 fake ESMTP\r\n'); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, inbox })));
}

const decodeBody = raw => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\s/g, ''), 'base64').toString('utf8');

async function call(base, method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}

(async () => {
  const insecure = { rejectUnauthorized: false };

  if (cert) {
  // 1) المرسل: اتصال مشفّر مباشرة (مثل منفذ 465) + كلمة مرور خطأ
  const m1 = await fakeSmtp({ implicit: true, user: 'me@gmail.com', pass: 'apppass' });
  await sendMail({ host: '127.0.0.1', port: m1.port, secure: true, user: 'me@gmail.com', pass: 'apppass',
    from: 'me@gmail.com', fromName: 'برنامج العملاء', to: 'me@gmail.com', subject: 'تجربة', text: 'مرحبا ✓', tlsOptions: insecure });
  assert.strictEqual(m1.inbox.length, 1);
  assert.strictEqual(decodeBody(m1.inbox[0]), 'مرحبا ✓');
  await assert.rejects(sendMail({ host: '127.0.0.1', port: m1.port, secure: true, user: 'me@gmail.com', pass: 'wrong',
    from: 'me@gmail.com', to: 'x@y.com', subject: 's', text: 't', tlsOptions: insecure }), /غير صحيحة/);
  m1.srv.close();
  // خادم غير موجود
  await assert.rejects(sendMail({ host: '127.0.0.1', port: 1, secure: false, user: 'a@b.c', pass: 'p',
    from: 'a@b.c', to: 'a@b.c', subject: 's', text: 't' }), /تعذر الوصول/);

  }

  // 2) البرنامج كامل مع خادم بريد STARTTLS (مثل منفذ 587) — أو بديل وهمي
  const m2 = cert
    ? await fakeSmtp({ implicit: false, user: 'me@gmail.com', pass: 'abcdefghijklmnop' })
    : { inbox: [], port: 587, srv: { close() {} } };
  const mockSend = async o => {
    if (o.pass !== 'abcdefghijklmnop') throw new Error('البريد أو كلمة مرور التطبيق غير صحيحة');
    m2.inbox.push('x\r\n\r\n' + Buffer.from(o.text, 'utf8').toString('base64'));
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-auth-'));
  const s = createServer({ dataDir: dir, tlsOptions: insecure, send: cert ? undefined : mockSend });
  const port = await s.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;

  let r = await call(base, 'GET', '/api/auth/status');
  assert.deepStrictEqual(r.data, { hasAccount: false, smtpReady: false, emailHint: '' });
  assert.strictEqual((await call(base, 'POST', '/api/auth/setup', { username: 'ab', password: '123456', email: 'me@gmail.com' })).status, 400);
  assert.strictEqual((await call(base, 'POST', '/api/auth/setup', { username: 'admin', password: '123', email: 'me@gmail.com' })).status, 400);
  assert.strictEqual((await call(base, 'POST', '/api/auth/setup', { username: 'admin', password: '123456', email: 'bad' })).status, 400);
  r = await call(base, 'POST', '/api/auth/setup', { username: 'نعمة', password: 'pass1234', email: 'me@gmail.com' });
  assert.strictEqual(r.status, 201);
  assert.match(r.data.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  let token = r.data.token;
  let recovery = r.data.recoveryCode;
  assert.strictEqual((await call(base, 'POST', '/api/auth/setup', { username: 'x12', password: '123456', email: 'a@b.cd' })).status, 409, 'حساب واحد فقط');

  // كلمة المرور محفوظة مشفّرة وليست نص
  const raw = fs.readFileSync(path.join(dir, 'customers.json'), 'utf8');
  assert.ok(!raw.includes('pass1234'), 'كلمة المرور لا تُحفظ كنص');

  assert.strictEqual((await call(base, 'GET', '/api/customers', null, token)).status, 200);
  assert.strictEqual((await call(base, 'GET', '/api/customers', null, 'fake')).status, 401);

  // تسجيل خروج ودخول
  await call(base, 'POST', '/api/auth/logout', null, token);
  assert.strictEqual((await call(base, 'GET', '/api/customers', null, token)).status, 401);
  r = await call(base, 'POST', '/api/auth/login', { username: 'نعمة', password: 'wrong!' });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.data.code, 'bad_credentials');
  r = await call(base, 'POST', '/api/auth/login', { username: 'نعمة', password: 'pass1234' });
  token = r.data.token;
  assert.ok(token);

  // نسيت كلمة المرور قبل إعداد البريد
  r = await call(base, 'POST', '/api/auth/forgot');
  assert.strictEqual(r.data.code, 'smtp_not_ready');

  // إعداد البريد (كلمة مرور التطبيق من Gmail تجي بمسافات)
  r = await call(base, 'PUT', '/api/account/smtp', { host: '127.0.0.1', port: m2.port, user: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' }, token);
  assert.strictEqual(r.data.smtp.hasPass, true);
  assert.ok(!JSON.stringify(r.data).includes('abcd'), 'كلمة مرور البريد لا ترجع للواجهة');
  r = await call(base, 'POST', '/api/account/smtp-test', null, token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(m2.inbox.length, 1);

  // الاستعادة بالإيميل
  r = await call(base, 'GET', '/api/auth/status');
  assert.strictEqual(r.data.smtpReady, true);
  assert.strictEqual(r.data.emailHint, 'm*@gmail.com');
  r = await call(base, 'POST', '/api/auth/forgot');
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = decodeBody(m2.inbox[1]).match(/\d{6}/)[0];
  assert.strictEqual((await call(base, 'POST', '/api/auth/forgot')).status, 429, 'رمز واحد كل دقيقة');
  assert.strictEqual((await call(base, 'POST', '/api/auth/reset', { code: '000000', newPassword: 'newpass1' })).status, 400);
  r = await call(base, 'POST', '/api/auth/reset', { code, newPassword: 'newpass1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await call(base, 'GET', '/api/customers', null, token)).status, 401, 'الجلسات القديمة تنتهي بعد تغيير كلمة المرور');
  assert.strictEqual((await call(base, 'POST', '/api/auth/reset', { code, newPassword: 'again123' })).status, 400, 'الرمز يُستخدم مرة وحدة');
  r = await call(base, 'POST', '/api/auth/login', { username: 'نعمة', password: 'newpass1' });
  assert.strictEqual(r.status, 200);
  token = r.data.token;

  // الاستعادة برمز الاسترداد (بدون إنترنت) — يقبل حروف صغيرة وبدون شرطات
  r = await call(base, 'POST', '/api/auth/recover', { recoveryCode: recovery.toLowerCase().replace(/-/g, ''), newPassword: 'offline99' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.notStrictEqual(r.data.recoveryCode, recovery, 'رمز استرداد جديد بعد الاستخدام');
  assert.strictEqual((await call(base, 'POST', '/api/auth/recover', { recoveryCode: recovery, newPassword: 'zzzzzz' })).status, 401, 'الرمز القديم ما يشتغل');
  token = r.data.token;

  // تعديل الحساب يحتاج كلمة المرور الحالية
  assert.strictEqual((await call(base, 'PUT', '/api/account', { currentPassword: 'x', newPassword: 'abcdef' }, token)).status, 400);
  r = await call(base, 'PUT', '/api/account', { currentPassword: 'offline99', username: 'admin', email: 'new@mail.com', newPassword: 'final123' }, token);
  assert.strictEqual(r.data.username, 'admin');
  assert.strictEqual((await call(base, 'GET', '/api/customers', null, token)).status, 200, 'هذا الجهاز يبقى مسجل');

  // قفل بعد 5 محاولات خاطئة
  for (let i = 0; i < 5; i++) await call(base, 'POST', '/api/auth/login', { username: 'admin', password: 'bad' + i });
  r = await call(base, 'POST', '/api/auth/login', { username: 'admin', password: 'final123' });
  assert.strictEqual(r.status, 429, 'مقفل دقيقة بعد 5 محاولات');

  await s.close();
  m2.srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('✓ اختبارات الدخول والاستعادة نجحت');
})().catch(e => { console.error('✗ فشل الاختبار:', e); process.exit(1); });
