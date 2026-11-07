// اختبار سريع للخادم: إضافة، تعديل، حذف، رمز الشبكة، وحفظ البيانات بعد إعادة التشغيل
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../src/server');

async function req(base, method, p, body, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['X-CRM-Key'] = encodeURIComponent(key);
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-'));

  // 1) وضع جهاز واحد بدون رمز
  let s = createServer({ dataDir: dir });
  let port = await s.listen(0, '127.0.0.1');
  let base = `http://127.0.0.1:${port}`;

  let r = await req(base, 'GET', '/api/ping');
  assert.strictEqual(r.data.app, 'MiniCRM');

  r = await req(base, 'POST', '/api/customers', { name: '' });
  assert.strictEqual(r.status, 400, 'الاسم مطلوب');

  r = await req(base, 'POST', '/api/customers', { name: '  محمد أحمد ', phone: '0500000000', category: 'xxx' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.name, 'محمد أحمد');
  assert.strictEqual(r.data.category, 'عميل');
  assert.strictEqual(r.data.no, 1001);
  const id = r.data.id;

  r = await req(base, 'POST', '/api/customers', { name: 'شركة النور', category: 'عميل مميز' });
  assert.strictEqual(r.data.no, 1002);

  const rev1 = (await req(base, 'GET', '/api/revision')).data.revision;
  r = await req(base, 'PUT', '/api/customers/' + id, { name: 'محمد أحمد', city: 'الرياض' });
  assert.strictEqual(r.data.city, 'الرياض');
  assert.ok((await req(base, 'GET', '/api/revision')).data.revision > rev1, 'رقم المراجعة يزيد');

  r = await req(base, 'GET', '/api/customers');
  assert.strictEqual(r.data.customers.length, 2);

  r = await req(base, 'DELETE', '/api/customers/' + id);
  assert.strictEqual(r.status, 200);
  r = await req(base, 'PUT', '/api/customers/' + id, { name: 'x' });
  assert.strictEqual(r.status, 404);
  await s.close();

  // 2) وضع الخادم مع رمز شبكة، والبيانات باقية بعد إعادة التشغيل
  s = createServer({ dataDir: dir, accessKey: 'سر123' });
  port = await s.listen(0, '0.0.0.0');
  base = `http://127.0.0.1:${port}`;
  assert.strictEqual((await req(base, 'GET', '/api/ping')).data.needsKey, true);
  assert.strictEqual((await req(base, 'GET', '/api/customers')).status, 401);
  assert.strictEqual((await req(base, 'GET', '/api/customers', null, 'خطأ')).status, 401);
  r = await req(base, 'GET', '/api/customers', null, 'سر123');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.customers.length, 1);
  assert.strictEqual(r.data.customers[0].name, 'شركة النور');
  r = await req(base, 'POST', '/api/customers', { name: 'عميل ثالث' }, 'سر123');
  assert.strictEqual(r.data.no, 1003, 'الترقيم يكمل بعد إعادة التشغيل');
  await s.close();

  assert.ok(fs.existsSync(path.join(dir, 'backups')), 'مجلد النسخ الاحتياطي موجود');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('✓ كل الاختبارات نجحت');
})().catch(e => { console.error('✗ فشل الاختبار:', e); process.exit(1); });
