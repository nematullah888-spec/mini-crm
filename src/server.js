// خادم البيانات: يحفظ العملاء في ملف JSON ويقدّم واجهة HTTP بسيطة.
// يستخدم مكتبات Node المدمجة فقط (بدون أي إضافات).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATEGORIES = ['عميل', 'عميل محتمل', 'عميل مميز', 'متوقف'];
const FIELDS = {
  name: 120, phone: 40, phone2: 40, email: 120, company: 120,
  city: 60, address: 250, category: 30, notes: 4000
};
const MAX_BACKUPS = 14;
const DEFAULT_SETTINGS = { products: ['مانجر', 'أورنيوم'], alertDays: 10 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'customers.json');
  const backupDir = path.join(dataDir, 'backups');
  let db = { customers: [], nextNo: 1001, revision: 1, settings: Object.assign({}, DEFAULT_SETTINGS) };

  if (fs.existsSync(file)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      db = Object.assign(db, loaded);
      if (!Array.isArray(db.customers)) db.customers = [];
    } catch (e) {
      // الملف تالف: نحتفظ بنسخة منه ونبدأ من آخر نسخة احتياطية إن وجدت
      const broken = file + '.broken-' + Date.now();
      fs.copyFileSync(file, broken);
      const restored = latestBackup(backupDir);
      if (restored) db = Object.assign(db, JSON.parse(fs.readFileSync(restored, 'utf8')));
    }
    dailyBackup();
  }
  // ترقية البيانات القديمة: كل عميل له قائمة اشتراكات
  db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings || {});
  for (const c of db.customers) if (!Array.isArray(c.subscriptions)) c.subscriptions = [];

  function latestBackup(dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    return files.length ? path.join(dir, files[files.length - 1]) : null;
  }

  function dailyBackup() {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const target = path.join(backupDir, `customers-${day}.json`);
      if (!fs.existsSync(target) && fs.existsSync(file)) fs.copyFileSync(file, target);
      const all = fs.readdirSync(backupDir).filter(f => f.endsWith('.json')).sort();
      while (all.length > MAX_BACKUPS) fs.unlinkSync(path.join(backupDir, all.shift()));
    } catch (_) { /* النسخ الاحتياطي لا يجب أن يوقف البرنامج */ }
  }

  function save() {
    db.revision += 1;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1), 'utf8');
    fs.renameSync(tmp, file);
    dailyBackup();
  }

  function clean(input) {
    const out = {};
    for (const [key, max] of Object.entries(FIELDS)) {
      let v = input && input[key] != null ? String(input[key]) : '';
      out[key] = v.trim().slice(0, max);
    }
    if (!CATEGORIES.includes(out.category)) out.category = CATEGORIES[0];
    return out;
  }

  function validDate(v) {
    if (!DATE_RE.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === v;
  }

  function cleanSub(input) {
    const product = String(input.product || '').trim().slice(0, 60);
    const start = String(input.start || '').trim();
    const end = String(input.end || '').trim();
    if (!product) throw httpError(400, 'اختر الخدمة / البرنامج');
    if (!validDate(start)) throw httpError(400, 'تاريخ بداية الاشتراك غير صحيح');
    if (!validDate(end)) throw httpError(400, 'تاريخ نهاية الاشتراك غير صحيح');
    if (end <= start) throw httpError(400, 'تاريخ النهاية لازم يكون بعد تاريخ البداية');
    let amount = '';
    if (input.amount !== '' && input.amount != null) {
      amount = Number(input.amount);
      if (!isFinite(amount) || amount < 0) throw httpError(400, 'المبلغ غير صحيح');
    }
    return { product, start, end, amount, notes: String(input.notes || '').trim().slice(0, 500) };
  }

  function findCustomer(id) {
    const c = db.customers.find(x => x.id === id);
    if (!c) throw httpError(404, 'العميل غير موجود (ربما حذفه مستخدم آخر)');
    return c;
  }

  return {
    file,
    get revision() { return db.revision; },
    list() { return db.customers; },
    settings() { return db.settings; },
    setSettings(input) {
      const products = [...new Set((Array.isArray(input.products) ? input.products : [])
        .map(p => String(p).trim().slice(0, 60)).filter(Boolean))].slice(0, 30);
      if (!products.length) throw httpError(400, 'أضف خدمة واحدة على الأقل');
      const alertDays = Math.round(Number(input.alertDays));
      if (!(alertDays >= 1 && alertDays <= 120)) throw httpError(400, 'أيام التنبيه لازم تكون بين 1 و 120');
      db.settings = { products, alertDays };
      save();
      return db.settings;
    },
    addSub(customerId, input) {
      const c = findCustomer(customerId);
      const sub = Object.assign({ id: crypto.randomUUID() }, cleanSub(input), { createdAt: new Date().toISOString() });
      c.subscriptions.push(sub);
      save();
      return c;
    },
    updateSub(customerId, subId, input) {
      const c = findCustomer(customerId);
      const sub = c.subscriptions.find(x => x.id === subId);
      if (!sub) throw httpError(404, 'الاشتراك غير موجود');
      Object.assign(sub, cleanSub(input));
      save();
      return c;
    },
    removeSub(customerId, subId) {
      const c = findCustomer(customerId);
      const i = c.subscriptions.findIndex(x => x.id === subId);
      if (i === -1) throw httpError(404, 'الاشتراك غير موجود');
      c.subscriptions.splice(i, 1);
      save();
      return c;
    },
    create(input) {
      const data = clean(input);
      if (!data.name) throw httpError(400, 'اسم العميل مطلوب');
      const now = new Date().toISOString();
      const c = Object.assign({ id: crypto.randomUUID(), no: db.nextNo++ }, data,
        { subscriptions: [], createdAt: now, updatedAt: now });
      db.customers.push(c);
      save();
      return c;
    },
    update(id, input) {
      const c = db.customers.find(x => x.id === id);
      if (!c) throw httpError(404, 'العميل غير موجود (ربما حذفه مستخدم آخر)');
      const data = clean(input);
      if (!data.name) throw httpError(400, 'اسم العميل مطلوب');
      Object.assign(c, data, { updatedAt: new Date().toISOString() });
      save();
      return c;
    },
    remove(id) {
      const i = db.customers.findIndex(x => x.id === id);
      if (i === -1) throw httpError(404, 'العميل غير موجود');
      db.customers.splice(i, 1);
      save();
    }
  };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', ch => {
      size += ch.length;
      if (size > 1024 * 1024) { reject(httpError(413, 'البيانات كبيرة جداً')); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(httpError(400, 'صيغة البيانات غير صحيحة')); }
    });
    req.on('error', reject);
  });
}

// الرمز يُرسل مُرمّزاً (encodeURIComponent) لأن ترويسات HTTP لا تقبل الحروف العربية
function decodeKey(v) {
  try { return decodeURIComponent(String(v || '')); } catch (_) { return ''; }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * ينشئ خادم HTTP.
 * options: { dataDir, accessKey, version }
 */
function createServer(options) {
  const store = createStore(options.dataDir);
  const accessKey = options.accessKey || '';
  const version = options.version || '1.0.0';

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CRM-Key');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean); // ['api','customers',id]
      if (parts[0] !== 'api') throw httpError(404, 'غير موجود');

      if (parts[1] === 'ping' && req.method === 'GET') {
        return send(200, { ok: true, app: 'MiniCRM', version, needsKey: !!accessKey });
      }

      if (accessKey && !safeEqual(decodeKey(req.headers['x-crm-key']), accessKey)) {
        throw httpError(401, 'رمز الشبكة غير صحيح');
      }

      if (parts[1] === 'revision' && req.method === 'GET') {
        return send(200, { revision: store.revision });
      }

      if (parts[1] === 'settings') {
        if (req.method === 'GET') return send(200, store.settings());
        if (req.method === 'PUT') return send(200, store.setSettings(await readBody(req)));
      }

      if (parts[1] === 'customers' && parts[3] === 'subscriptions') {
        const id = parts[2], sid = parts[4];
        if (!sid && req.method === 'POST') return send(201, store.addSub(id, await readBody(req)));
        if (sid && req.method === 'PUT') return send(200, store.updateSub(id, sid, await readBody(req)));
        if (sid && req.method === 'DELETE') return send(200, store.removeSub(id, sid));
      }

      if (parts[1] === 'customers' && parts.length <= 3) {
        const id = parts[2];
        if (!id && req.method === 'GET') {
          return send(200, { revision: store.revision, customers: store.list(), settings: store.settings() });
        }
        if (!id && req.method === 'POST') {
          return send(201, store.create(await readBody(req)));
        }
        if (id && req.method === 'PUT') {
          return send(200, store.update(id, await readBody(req)));
        }
        if (id && req.method === 'DELETE') {
          store.remove(id);
          return send(200, { ok: true });
        }
      }
      throw httpError(404, 'غير موجود');
    } catch (e) {
      send(e.status || 500, { error: e.message || 'خطأ غير متوقع' });
    }
  });

  return {
    store,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise(resolve => {
        server.close(() => resolve());
        if (server.closeAllConnections) server.closeAllConnections();
      });
    }
  };
}

module.exports = { createServer, CATEGORIES };
