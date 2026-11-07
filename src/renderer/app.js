// واجهة البرنامج
'use strict';

const CATEGORIES = ['عميل', 'عميل محتمل', 'عميل مميز', 'متوقف'];
const MODE_NAMES = { local: 'جهاز واحد', server: 'خادم (سيرفر)', client: 'عميل شبكة' };

let S = null;              // حالة البرنامج من العملية الرئيسية
let customers = [];
let revision = 0;
let selectedId = null;
let online = false;
let lastError = '';
let sort = { key: 'no', dir: -1 };

const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// توحيد الحروف العربية للبحث (أ إ آ ← ا ، ة ← ه ، ى ← ي ، وإزالة التشكيل)
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- الاتصال بالخادم ----------
async function api(method, path, body) {
  if (!S.apiBase) throw new Error('لم يتم تحديد جهاز الخادم. افتح الإعدادات.');
  const headers = { 'Content-Type': 'application/json' };
  if (S.sendKey) headers['X-CRM-Key'] = encodeURIComponent(S.sendKey);
  let res;
  try {
    res = await fetch(S.apiBase + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6000)
    });
  } catch (_) {
    throw new Error('تعذر الاتصال بالخادم. تأكد أن جهاز الخادم شغال وأن البرنامج مفتوح عليه.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('خطأ ' + res.status));
  return data;
}

async function reload() {
  try {
    const data = await api('GET', '/api/customers');
    customers = data.customers;
    revision = data.revision;
    setOnline(true);
  } catch (e) {
    setOnline(false, e.message);
  }
  render();
}

async function poll() {
  if (!S || !S.apiBase) return;
  try {
    const { revision: r } = await api('GET', '/api/revision');
    setOnline(true);
    if (r !== revision) await reload();
  } catch (e) {
    setOnline(false, e.message);
  }
}

function setOnline(v, err) {
  const changed = v !== online;
  online = v;
  lastError = v ? '' : (err || '');
  updateStatus();
  if (changed && !v) render();
}

// ---------- العرض ----------
function filtered() {
  const q = norm($('#search').value.trim());
  const cat = $('#filterCat').value;
  let list = customers.filter(c => {
    if (cat && c.category !== cat) return false;
    if (!q) return true;
    return norm([c.no, c.name, c.phone, c.phone2, c.email, c.company, c.city, c.address, c.notes].join(' ')).includes(q);
  });
  const k = sort.key;
  list.sort((a, b) => {
    const x = a[k], y = b[k];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
    return String(x || '').localeCompare(String(y || ''), 'ar') * sort.dir;
  });
  return list;
}

function catTag(cat) {
  const i = CATEGORIES.indexOf(cat);
  return `<span class="tag c${i < 0 ? 0 : i}">${esc(cat)}</span>`;
}

function render() {
  const list = filtered();
  const rows = $('#rows');
  rows.innerHTML = list.map(c => `
    <tr data-id="${esc(c.id)}" class="${c.id === selectedId ? 'sel' : ''}">
      <td>${esc(c.no)}</td>
      <td>${esc(c.name)}</td>
      <td class="ltr">${esc(c.phone)}</td>
      <td>${esc(c.company)}</td>
      <td>${esc(c.city)}</td>
      <td>${catTag(c.category)}</td>
      <td>${esc(fmtDate(c.updatedAt))}</td>
    </tr>`).join('');

  document.querySelectorAll('.grid th').forEach(th => {
    th.classList.toggle('asc', th.dataset.sort === sort.key && sort.dir === 1);
    th.classList.toggle('desc', th.dataset.sort === sort.key && sort.dir === -1);
  });

  const empty = $('#empty');
  if (!online && lastError) {
    empty.innerHTML = `⚠️ ${esc(lastError)}`;
  } else if (!customers.length) {
    empty.innerHTML = 'لا يوجد عملاء بعد. اضغط «جديد» لإضافة أول عميل.';
  } else if (!list.length) {
    empty.textContent = 'لا توجد نتائج مطابقة للبحث.';
  } else {
    empty.textContent = '';
  }

  $('#stCount').textContent = list.length === customers.length
    ? `عدد العملاء: ${customers.length}`
    : `المعروض: ${list.length} من ${customers.length}`;

  if (selectedId && !customers.some(c => c.id === selectedId)) selectedId = null;
  renderDetails();
}

function renderDetails() {
  const c = customers.find(x => x.id === selectedId);
  const box = $('#details');
  if (!c) {
    box.innerHTML = '<div class="placeholder">اختر عميلاً من القائمة لعرض بياناته.</div>';
    return;
  }
  const row = (label, val, ltr) => val ? `<dt>${label}</dt><dd${ltr ? ' dir="ltr" style="text-align:right"' : ''}>${esc(val)}</dd>` : '';
  box.innerHTML = `
    <div class="big">${esc(c.name)}</div>
    <div>رقم العميل: ${esc(c.no)} &nbsp; ${catTag(c.category)}</div>
    <dl>
      ${row('الجوال', c.phone, true)}
      ${row('جوال آخر', c.phone2, true)}
      ${row('البريد', c.email, true)}
      ${row('الشركة', c.company)}
      ${row('المدينة', c.city)}
      ${row('العنوان', c.address)}
      <dt>أضيف في</dt><dd>${esc(fmtDate(c.createdAt))}</dd>
      <dt>آخر تعديل</dt><dd>${esc(fmtDate(c.updatedAt))}</dd>
    </dl>
    <div>ملاحظات:</div>
    <div class="notes sunken">${esc(c.notes) || '<span style="color:#888">—</span>'}</div>
    <div class="actions">
      <button class="btn" data-cmd="edit">تعديل</button>
      <button class="btn" data-cmd="delete">حذف</button>
    </div>`;
}

function updateStatus() {
  $('#stMode').textContent = 'الوضع: ' + MODE_NAMES[S.config.mode];
  const conn = $('#stConn');
  if (S.serverError) {
    conn.innerHTML = '<span class="bad">● الخادم متوقف</span>';
  } else {
    conn.innerHTML = online ? '<span class="ok">● متصل</span>' : '<span class="bad">● غير متصل</span>';
  }
  let info = '';
  if (S.serverError) info = S.serverError;
  else if (S.config.mode === 'server') info = `عنوان هذا الجهاز للأجهزة الثانية: ${S.localIPs.join(' ، ') || 'غير متوفر'} — المنفذ ${S.config.port}`;
  else if (S.config.mode === 'client') info = `الخادم: ${S.config.serverHost || 'غير محدد'}:${S.config.port}`;
  else info = 'البيانات محفوظة على هذا الجهاز';
  $('#stInfo').textContent = info;
}

// ---------- النوافذ ----------
let closeCurrent = null;

// يفتح نافذة من قالب ويرجع العنصر ودالة الإغلاق ووعد بالنتيجة
function dialog(tplId) {
  const overlay = $('#overlay');
  overlay.innerHTML = '';
  const node = document.getElementById(tplId).content.firstElementChild.cloneNode(true);
  overlay.appendChild(node);
  overlay.hidden = false;
  let resolveFn;
  const done = new Promise(r => { resolveFn = r; });
  const close = value => {
    if (!closeCurrent) return;
    overlay.hidden = true;
    overlay.innerHTML = '';
    closeCurrent = null;
    resolveFn(value);
  };
  closeCurrent = close;
  node.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => close(null)));
  return { node, close, done };
}

function msgbox(text, { title = 'برنامج العملاء', icon = 'ℹ️', buttons = ['موافق'] } = {}) {
  const d = dialog('tplMsg');
  d.node.querySelector('.title-bar-text').textContent = title;
  d.node.querySelector('.msg-ico').textContent = icon;
  d.node.querySelector('.msg-text').textContent = text;
  const bar = d.node.querySelector('.buttons');
  buttons.forEach((label, i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === 0 ? ' default' : '');
    b.textContent = label;
    b.addEventListener('click', () => d.close(i));
    bar.appendChild(b);
  });
  setTimeout(() => bar.querySelector('button').focus(), 0);
  return d.done;
}

async function editCustomer(existing) {
  const d = dialog('tplCustomer');
  const form = d.node.querySelector('form');
  d.node.querySelector('.title-bar-text').textContent = existing ? `تعديل العميل — ${existing.name}` : 'عميل جديد';
  const sel = form.elements.category;
  CATEGORIES.forEach(c => sel.add(new Option(c, c)));
  if (existing) {
    for (const el of form.elements) if (el.name && existing[el.name] != null) el.value = existing[el.name];
  }
  setTimeout(() => form.elements.name.focus(), 0);

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const err = form.querySelector('.error');
    try {
      const saved = existing
        ? await api('PUT', '/api/customers/' + encodeURIComponent(existing.id), data)
        : await api('POST', '/api/customers', data);
      selectedId = saved.id;
      d.close(saved);
      await reload();
      scrollToSelected();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });
  return d.done;
}

async function deleteSelected() {
  const c = customers.find(x => x.id === selectedId);
  if (!c) return msgbox('اختر عميلاً من القائمة أولاً.');
  const ans = await msgbox(`هل تريد حذف العميل «${c.name}» نهائياً؟`,
    { title: 'تأكيد الحذف', icon: '⚠️', buttons: ['نعم، احذف', 'لا'] });
  if (ans !== 0) return;
  try {
    await api('DELETE', '/api/customers/' + encodeURIComponent(c.id));
    selectedId = null;
    await reload();
  } catch (e) {
    msgbox(e.message, { icon: '❌', title: 'خطأ' });
  }
}

async function openSettings() {
  const d = dialog('tplSettings');
  const n = d.node;
  const cfg = S.config;
  const setMode = m => { n.classList.remove('m-local', 'm-server', 'm-client'); n.classList.add('m-' + m); };
  n.querySelectorAll('input[name=mode]').forEach(r => {
    r.checked = r.value === cfg.mode;
    r.addEventListener('change', () => setMode(r.value));
  });
  setMode(cfg.mode);
  n.querySelector('[name=serverHost]').value = cfg.serverHost;
  n.querySelector('[name=port]').value = cfg.port;
  n.querySelector('[name=accessKey]').value = cfg.accessKey;
  n.querySelector('#ipHint').innerHTML =
    'في الأجهزة الثانية اختر «عميل» واكتب عنوان هذا الجهاز:<br>' +
    (S.localIPs.length ? S.localIPs.map(ip => `<span class="ip">${esc(ip)}</span>`).join(' ') : 'لم يتم العثور على شبكة') +
    '<br>إذا ظهرت رسالة «جدار حماية ويندوز» اضغط «السماح بالوصول».';

  const read = () => ({
    mode: n.querySelector('input[name=mode]:checked').value,
    serverHost: n.querySelector('[name=serverHost]').value.trim(),
    port: n.querySelector('[name=port]').value,
    accessKey: n.querySelector('[name=accessKey]').value
  });

  n.querySelector('#btnTest').addEventListener('click', async () => {
    const v = read();
    const out = n.querySelector('#testResult');
    if (!v.serverHost) { out.innerHTML = '<span class="bad">اكتب عنوان الخادم</span>'; return; }
    out.textContent = 'جاري الاختبار…';
    const base = `http://${v.serverHost}:${Number(v.port) || 5055}`;
    try {
      const ping = await (await fetch(base + '/api/ping', { signal: AbortSignal.timeout(5000) })).json();
      if (ping.app !== 'MiniCRM') throw new Error();
      if (ping.needsKey) {
        const r = await fetch(base + '/api/revision', { headers: { 'X-CRM-Key': encodeURIComponent(v.accessKey) }, signal: AbortSignal.timeout(5000) });
        if (r.status === 401) { out.innerHTML = '<span class="bad">✕ الخادم موجود لكن رمز الشبكة غير صحيح</span>'; return; }
      }
      out.innerHTML = '<span class="ok">✓ تم الاتصال بالخادم بنجاح</span>';
    } catch (_) {
      out.innerHTML = '<span class="bad">✕ تعذر الاتصال. تأكد من العنوان وأن البرنامج شغال على جهاز الخادم.</span>';
    }
  });

  n.querySelector('#btnSaveSettings').addEventListener('click', async () => {
    const v = read();
    if (v.mode === 'client' && !v.serverHost) {
      n.querySelector('[name=serverHost]').focus();
      return;
    }
    S = await window.crm.saveConfig(v);
    d.close(true);
    revision = -1;
    customers = [];
    selectedId = null;
    updateStatus();
    await reload();
    if (S.serverError) msgbox(S.serverError, { icon: '⚠️', title: 'تنبيه' });
  });
  return d.done;
}

function exportCSV() {
  const list = filtered();
  if (!list.length) return msgbox('لا توجد بيانات للتصدير.');
  const cols = [['no', 'الرقم'], ['name', 'اسم العميل'], ['phone', 'الجوال'], ['phone2', 'جوال آخر'],
    ['email', 'البريد'], ['company', 'الشركة'], ['city', 'المدينة'], ['address', 'العنوان'],
    ['category', 'التصنيف'], ['notes', 'ملاحظات'], ['createdAt', 'تاريخ الإضافة'], ['updatedAt', 'آخر تعديل']];
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [cols.map(c => cell(c[1])).join(',')];
  for (const c of list) {
    lines.push(cols.map(([k]) => cell(k.endsWith('At') ? fmtDate(c[k]) : c[k])).join(','));
  }
  const name = `العملاء-${new Date().toISOString().slice(0, 10)}.csv`;
  window.crm.saveText(name, '﻿' + lines.join('\r\n')).then(r => {
    if (r.saved) msgbox('تم حفظ الملف:\n' + r.path);
  });
}

function scrollToSelected() {
  const tr = document.querySelector('#rows tr.sel');
  if (tr) tr.scrollIntoView({ block: 'nearest' });
}

// ---------- الأوامر ----------
const commands = {
  new: () => editCustomer(null),
  edit: () => {
    const c = customers.find(x => x.id === selectedId);
    return c ? editCustomer(c) : msgbox('اختر عميلاً من القائمة أولاً.');
  },
  delete: deleteSelected,
  refresh: reload,
  export: exportCSV,
  settings: openSettings,
  find: () => $('#search').focus(),
  openData: () => {
    if (S.config.mode === 'client') return msgbox('هذا الجهاز «عميل»، والبيانات محفوظة على جهاز الخادم.');
    window.crm.openDataFolder();
  },
  quit: () => window.close(),
  about: () => msgbox(
    `برنامج العملاء — الإصدار ${S.version}\n\nبرنامج بسيط لحفظ بيانات العملاء، يشتغل على جهاز واحد أو على الشبكة المحلية بدون إنترنت.\n\nمكان البيانات:\n${S.dataDir}\n\nيتم أخذ نسخة احتياطية تلقائية يومياً.`,
    { title: 'حول البرنامج' })
};

function run(cmd) {
  closeMenus();
  if (commands[cmd]) commands[cmd]();
}

function closeMenus() {
  document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
}

// ---------- الأحداث ----------
document.addEventListener('click', e => {
  const cmdEl = e.target.closest('[data-cmd]');
  if (cmdEl) { run(cmdEl.dataset.cmd); return; }
  const menuBtn = e.target.closest('.menu-btn');
  if (menuBtn) {
    const menu = menuBtn.parentElement;
    const wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) menu.classList.add('open');
    return;
  }
  closeMenus();
});

document.querySelectorAll('.menu-btn').forEach(b => b.addEventListener('mouseenter', () => {
  if (document.querySelector('.menu.open')) { closeMenus(); b.parentElement.classList.add('open'); }
}));

$('#rows').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  selectedId = tr.dataset.id;
  document.querySelectorAll('#rows tr').forEach(r => r.classList.toggle('sel', r === tr));
  renderDetails();
});
$('#rows').addEventListener('dblclick', e => { if (e.target.closest('tr')) commands.edit(); });

document.querySelectorAll('.grid th').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.sort;
  sort = { key: k, dir: sort.key === k ? -sort.dir : 1 };
  render();
}));

$('#search').addEventListener('input', render);
$('#filterCat').addEventListener('change', render);

document.addEventListener('keydown', e => {
  if (closeCurrent) {
    if (e.key === 'Escape') closeCurrent(null);
    return;
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); run('new'); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); run('find'); }
  else if (e.key === 'F5') { e.preventDefault(); run('refresh'); }
  else if (typing) { if (e.key === 'Escape') { document.activeElement.blur(); } }
  else if (e.key === 'Enter') run('edit');
  else if (e.key === 'Delete') run('delete');
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const list = filtered();
    if (!list.length) return;
    let i = list.findIndex(c => c.id === selectedId);
    i = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    selectedId = list[i].id;
    render();
    scrollToSelected();
  }
});

// ---------- التشغيل ----------
(async function init() {
  CATEGORIES.forEach(c => $('#filterCat').add(new Option(c, c)));
  S = await window.crm.state();
  updateStatus();
  await reload();
  if (S.config.mode === 'client' && !S.config.serverHost) openSettings();
  if (S.serverError) msgbox(S.serverError, { icon: '⚠️', title: 'تنبيه' });
  setInterval(poll, 3000);
})();
