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
let settings = { products: ['مانجر', 'أورنيوم'], alertDays: 10 };
let alertsShown = false;
const today = () => Subs.todayStr();
const statusOf = c => Subs.customerStatus(c, today(), settings.alertDays);
const money = v => (v === '' || v == null) ? '' : Number(v).toLocaleString('en-US') + ' ريال';

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
    if (data.settings) settings = data.settings;
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
  const sf = $('#filterSub').value;
  let list = customers.filter(c => {
    if (cat && c.category !== cat) return false;
    if (sf) {
      const st = statusOf(c);
      if (sf === 'under' ? !st.underYear : st.kind !== sf) return false;
    }
    if (!q) return true;
    const products = (c.subscriptions || []).map(x => x.product);
    return norm([c.no, c.name, c.phone, c.phone2, c.email, c.company, c.city, c.address, c.notes, ...products].join(' ')).includes(q);
  });
  const k = sort.key;
  const val = c => {
    if (k === 'product') return statusOf(c).subs.map(x => x.product).join('، ');
    if (k === 'end') return statusOf(c).sub ? statusOf(c).sub.end : '';
    if (k === 'remaining') { const d = statusOf(c).days; return d == null ? 999999 : d; }
    return c[k];
  };
  list.sort((a, b) => {
    const x = val(a), y = val(b);
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
  rows.innerHTML = list.map(c => {
    const st = statusOf(c);
    const cls = [c.id === selectedId ? 'sel' : '', st.kind === 'soon' || st.kind === 'expired' ? 'st-' + st.kind : ''].join(' ');
    return `
    <tr data-id="${esc(c.id)}" class="${cls}">
      <td>${esc(c.no)}</td>
      <td class="wrap">${esc(c.name)}</td>
      <td class="ltr">${esc(c.phone)}</td>
      <td class="wrap">${esc(c.company)}</td>
      <td class="wrap">${esc(c.city)}</td>
      <td class="wrap">${esc(st.subs.map(x => x.product).join('، '))}${st.underYear ? ' <span class="tag under">أقل من سنة</span>' : ''}</td>
      <td>${st.sub ? esc(st.sub.end.replace(/-/g, '/')) : ''}</td>
      <td class="days ${st.kind}">${st.kind === 'none' ? '<span style="color:#888">—</span>' : esc(Subs.daysText(st.days))}</td>
      <td>${catTag(c.category)}</td>
    </tr>`;
  }).join('');

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
  updateAlerts();
}

// العملاء اللي اشتراكهم قرب ينتهي أو انتهى
function alertList() {
  const out = [];
  for (const c of customers) {
    for (const sub of Subs.currentSubs(c)) {
      const st = Subs.subStatus(sub, today(), settings.alertDays);
      if (st.kind === 'soon' || st.kind === 'expired') out.push({ c, sub, st });
    }
  }
  return out.sort((a, b) => a.st.days - b.st.days);
}

function updateAlerts() {
  const list = alertList();
  const soon = list.filter(x => x.st.kind === 'soon').length;
  const expired = list.length - soon;
  const badge = $('#alertBadge');
  badge.hidden = !list.length;
  badge.textContent = list.length;
  $('#stAlerts').innerHTML = list.length
    ? `🔔 <span class="days soon">${soon} قرب الانتهاء</span> · <span class="days expired">${expired} منتهي</span>`
    : '🔔 لا توجد تنبيهات';
}

function showAlerts() {
  const list = alertList();
  const d = dialog('tplAlerts');
  d.node.querySelector('.alerts-intro').innerHTML = list.length
    ? `الاشتراكات اللي باقي عليها <b>${settings.alertDays} يوم أو أقل</b>، أو انتهت ولم تُجدَّد. اضغط مرتين على العميل لفتحه.`
    : '✓ لا يوجد عملاء قرب انتهاء اشتراكهم.';
  const tb = d.node.querySelector('.alerts-rows');
  tb.innerHTML = list.map(({ c, sub, st }) => `
    <tr data-id="${esc(c.id)}" data-sid="${esc(sub.id)}" class="st-${st.kind}">
      <td>${esc(c.name)}</td>
      <td class="ltr">${esc(c.phone)}</td>
      <td>${esc(sub.product)}${st.underYear ? ' <span class="tag under">أقل من سنة</span>' : ''}</td>
      <td>${esc(sub.end.replace(/-/g, '/'))}</td>
      <td class="days ${st.kind}">${esc(Subs.daysText(st.days))}</td>
      <td><button class="btn mini" data-renew>تجديد</button></td>
    </tr>`).join('');
  const pick = tr => { selectedId = tr.dataset.id; d.close(null); render(); scrollToSelected(); };
  tb.addEventListener('dblclick', e => { const tr = e.target.closest('tr'); if (tr) pick(tr); });
  tb.addEventListener('click', e => {
    if (!e.target.closest('[data-renew]')) return;
    const tr = e.target.closest('tr');
    const c = customers.find(x => x.id === tr.dataset.id);
    const sub = c && c.subscriptions.find(x => x.id === tr.dataset.sid);
    selectedId = tr.dataset.id;
    d.close(null);
    render();
    scrollToSelected();
    if (sub) editSub(c, sub, 'renew');
  });
  return d.done;
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
    </div>
    ${subsHtml(c)}`;
}

function subsHtml(c) {
  const current = Subs.currentSubs(c);
  const currentIds = new Set(current.map(x => x.id));
  const older = (c.subscriptions || []).filter(x => !currentIds.has(x.id))
    .sort((a, b) => (a.end < b.end ? 1 : -1));
  const cards = current.map(sub => {
    const st = Subs.subStatus(sub, today(), settings.alertDays);
    return `
    <div class="sub-card">
      <div class="row1">
        <span class="pname">${esc(sub.product)}</span>
        <span><span class="tag s-${st.kind}">${Subs.STATUS_NAMES[st.kind]}</span>
        ${st.underYear ? '<span class="tag under">أقل من سنة</span>' : ''}</span>
      </div>
      <div class="line">من ${esc(sub.start.replace(/-/g, '/'))} إلى ${esc(sub.end.replace(/-/g, '/'))} (${esc(Subs.periodText(sub.start, sub.end))})</div>
      <div class="line days ${st.kind}">${esc(Subs.daysText(st.days))}</div>
      ${sub.amount !== '' && sub.amount != null ? `<div class="line">المبلغ: ${esc(money(sub.amount))}</div>` : ''}
      ${sub.notes ? `<div class="line">${esc(sub.notes)}</div>` : ''}
      <div class="acts">
        <button class="btn mini" data-sub="renew" data-sid="${esc(sub.id)}">🔁 تجديد</button>
        <button class="btn mini" data-sub="edit" data-sid="${esc(sub.id)}">تعديل</button>
        <button class="btn mini" data-sub="delete" data-sid="${esc(sub.id)}">حذف</button>
      </div>
    </div>`;
  }).join('');
  const hist = older.length ? `
    <details class="history">
      <summary>سجل التجديدات السابقة (${older.length})</summary>
      ${older.map(sub => `
        <div class="h-row">
          <span>${esc(sub.product)}: ${esc(sub.start.replace(/-/g, '/'))} ← ${esc(sub.end.replace(/-/g, '/'))}
            (${esc(Subs.periodText(sub.start, sub.end))})${Subs.isUnderYear(sub) ? ' ⚠️' : ''}${sub.amount !== '' && sub.amount != null ? ' — ' + esc(money(sub.amount)) : ''}</span>
          <span><button class="linkbtn" data-sub="edit" data-sid="${esc(sub.id)}">تعديل</button><button class="linkbtn" data-sub="delete" data-sid="${esc(sub.id)}">حذف</button></span>
        </div>`).join('')}
    </details>` : '';
  return `
    <div class="subs-head"><span>📅 الاشتراكات</span>
      <button class="btn mini" data-cmd="addSub">➕ إضافة اشتراك</button></div>
    ${cards || '<div class="placeholder" style="padding:10px">لا يوجد اشتراك لهذا العميل.</div>'}
    ${hist}`;
}

// نافذة الاشتراك: mode = 'new' | 'edit' | 'renew'
async function editSub(c, sub, mode) {
  const d = dialog('tplSub');
  const f = d.node.querySelector('form');
  const titles = { new: 'اشتراك جديد', edit: 'تعديل الاشتراك', renew: 'تجديد الاشتراك' };
  d.node.querySelector('.title-bar-text').textContent = titles[mode];
  d.node.querySelector('.sub-customer').textContent = c.name;

  const products = settings.products.slice();
  if (sub && !products.includes(sub.product)) products.push(sub.product);
  products.forEach(p => f.product.add(new Option(p, p)));

  const t = today();
  if (mode === 'edit') {
    f.product.value = sub.product;
    f.start.value = sub.start;
    f.end.value = sub.end;
    f.amount.value = sub.amount;
    f.notes.value = sub.notes || '';
    const m = [12, 6, 3, 1].find(n => Subs.addMonths(sub.start, n) === sub.end);
    f.duration.value = m ? String(m) : 'custom';
  } else if (mode === 'renew') {
    f.product.value = sub.product;
    // التجديد يبدأ من نهاية الاشتراك السابق (أو من اليوم إذا كان منتهي من زمان)
    f.start.value = Subs.diffDays(sub.end, t) > 30 ? t : sub.end;
    f.amount.value = sub.amount;
    f.duration.value = '12';
    f.end.value = Subs.addMonths(f.start.value, 12);
  } else {
    f.start.value = t;
    f.duration.value = '12';
    f.end.value = Subs.addMonths(t, 12);
  }

  const summary = () => {
    const box = d.node.querySelector('.sub-summary');
    const s0 = f.start.value, e0 = f.end.value;
    if (!s0 || !e0 || e0 <= s0) { box.innerHTML = '<span class="days expired">تاريخ النهاية لازم يكون بعد البداية</span>'; return; }
    const sx = { start: s0, end: e0 };
    const st = Subs.subStatus(sx, t, settings.alertDays);
    box.innerHTML = `المدة: <b>${esc(Subs.periodText(s0, e0))}</b>
      ${Subs.isUnderYear(sx) ? ' <span class="tag under">⚠️ أقل من سنة</span>' : ''}<br>
      <span class="days ${st.kind}">${esc(Subs.daysText(st.days))}</span>`;
  };
  f.duration.addEventListener('change', () => {
    if (f.duration.value !== 'custom' && f.start.value) f.end.value = Subs.addMonths(f.start.value, Number(f.duration.value));
    if (f.duration.value === 'custom') f.end.focus();
    summary();
  });
  f.start.addEventListener('change', () => {
    if (f.duration.value !== 'custom' && f.start.value) f.end.value = Subs.addMonths(f.start.value, Number(f.duration.value));
    summary();
  });
  f.end.addEventListener('change', () => { f.duration.value = 'custom'; summary(); });
  summary();
  setTimeout(() => f.product.focus(), 0);

  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const data = { product: f.product.value, start: f.start.value, end: f.end.value, amount: f.amount.value, notes: f.notes.value };
    const err = f.querySelector('.error');
    try {
      const base = '/api/customers/' + encodeURIComponent(c.id) + '/subscriptions';
      if (mode === 'edit') await api('PUT', base + '/' + encodeURIComponent(sub.id), data);
      else await api('POST', base, data);
      selectedId = c.id;
      d.close(true);
      await reload();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });
  return d.done;
}

async function deleteSub(c, sub) {
  const ans = await msgbox(`حذف اشتراك «${sub.product}» (${sub.start} ← ${sub.end}) للعميل «${c.name}»؟`,
    { title: 'تأكيد الحذف', icon: '⚠️', buttons: ['نعم، احذف', 'لا'] });
  if (ans !== 0) return;
  try {
    await api('DELETE', `/api/customers/${encodeURIComponent(c.id)}/subscriptions/${encodeURIComponent(sub.id)}`);
    await reload();
  } catch (e) {
    msgbox(e.message, { icon: '❌', title: 'خطأ' });
  }
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
  const themeBefore = currentTheme();
  let themeSaved = false;
  n.querySelectorAll('input[name=theme]').forEach(r => {
    r.checked = r.value === themeBefore;
    r.addEventListener('change', () => setTheme(r.value));
  });
  d.done.then(() => { if (!themeSaved) setTheme(themeBefore); });
  const setMode = m => { n.classList.remove('m-local', 'm-server', 'm-client'); n.classList.add('m-' + m); };
  n.querySelectorAll('input[name=mode]').forEach(r => {
    r.checked = r.value === cfg.mode;
    r.addEventListener('change', () => setMode(r.value));
  });
  setMode(cfg.mode);
  n.querySelector('[name=serverHost]').value = cfg.serverHost;
  n.querySelector('[name=port]').value = cfg.port;
  n.querySelector('[name=accessKey]').value = cfg.accessKey;
  n.querySelector('[name=products]').value = settings.products.join('\n');
  n.querySelector('[name=alertDays]').value = settings.alertDays;
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
    // الخدمات وأيام التنبيه محفوظة في الخادم ومشتركة بين الأجهزة
    const products = n.querySelector('[name=products]').value.split('\n').map(x => x.trim()).filter(Boolean);
    const alertDays = Number(n.querySelector('[name=alertDays]').value);
    if (products.join('\n') !== settings.products.join('\n') || alertDays !== settings.alertDays) {
      try {
        settings = await api('PUT', '/api/settings', { products, alertDays });
      } catch (e) {
        const er = n.querySelector('.settings-error');
        er.textContent = 'لم يتم حفظ الخدمات: ' + e.message;
        er.hidden = false;
        return;
      }
    }
    S = await window.crm.saveConfig(v);
    themeSaved = true;
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
    ['category', 'التصنيف'], ['notes', 'ملاحظات'],
    ['_product', 'الخدمة'], ['_start', 'بداية الاشتراك'], ['_end', 'نهاية الاشتراك'], ['_period', 'المدة'],
    ['_days', 'الأيام المتبقية'], ['_status', 'حالة الاشتراك'], ['_under', 'أقل من سنة'], ['_amount', 'مبلغ الاشتراك'],
    ['createdAt', 'تاريخ الإضافة'], ['updatedAt', 'آخر تعديل']];
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [cols.map(c => cell(c[1])).join(',')];
  for (const c of list) {
    const subs = Subs.currentSubs(c);
    const rows = subs.length ? subs : [null];
    for (const sub of rows) {
      const st = sub ? Subs.subStatus(sub, today(), settings.alertDays) : null;
      const extra = sub ? {
        _product: sub.product, _start: sub.start, _end: sub.end, _period: Subs.periodText(sub.start, sub.end),
        _days: st.days, _status: Subs.STATUS_NAMES[st.kind], _under: st.underYear ? 'نعم' : 'لا', _amount: sub.amount
      } : { _status: Subs.STATUS_NAMES.none };
      lines.push(cols.map(([k]) => cell(k.endsWith('At') ? fmtDate(c[k]) : (k[0] === '_' ? extra[k] : c[k]))).join(','));
    }
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

// ---------- الثيم ----------
function currentTheme() {
  return document.documentElement.classList.contains('theme-modern') ? 'modern' : 'classic';
}
function setTheme(name) {
  document.documentElement.classList.toggle('theme-modern', name === 'modern');
  try { localStorage.setItem('crm-theme', name); } catch (_) { /* ignore */ }
  markTheme();
}
function markTheme() {
  const t = currentTheme();
  document.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('check', b.dataset.theme === t));
}

// ---------- الأوامر ----------
const commands = {
  new: () => editCustomer(null),
  edit: () => {
    const c = customers.find(x => x.id === selectedId);
    return c ? editCustomer(c) : msgbox('اختر عميلاً من القائمة أولاً.');
  },
  delete: deleteSelected,
  addSub: () => {
    const c = customers.find(x => x.id === selectedId);
    return c ? editSub(c, null, 'new') : msgbox('اختر عميلاً من القائمة أولاً.');
  },
  alerts: showAlerts,
  themeClassic: () => setTheme('classic'),
  themeModern: () => setTheme('modern'),
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
$('#filterSub').addEventListener('change', render);

$('#details').addEventListener('click', e => {
  const b = e.target.closest('[data-sub]');
  if (!b) return;
  const c = customers.find(x => x.id === selectedId);
  const sub = c && c.subscriptions.find(x => x.id === b.dataset.sid);
  if (!sub) return;
  if (b.dataset.sub === 'delete') deleteSub(c, sub);
  else editSub(c, sub, b.dataset.sub);
});

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

// تنبيه عند فتح البرنامج
function startupAlert() {
  if (alertsShown) return;
  alertsShown = true;
  const list = alertList();
  if (!list.length) return;
  const soon = list.filter(x => x.st.kind === 'soon').length;
  try {
    new Notification('برنامج العملاء', {
      body: `${soon} عميل قرب انتهاء اشتراكهم، و${list.length - soon} اشتراك منتهي`
    });
  } catch (_) { /* الإشعارات غير متاحة */ }
  showAlerts();
}

// ---------- التشغيل ----------
(async function init() {
  CATEGORIES.forEach(c => $('#filterCat').add(new Option(c, c)));
  markTheme();
  S = await window.crm.state();
  updateStatus();
  await reload();
  if (S.config.mode === 'client' && !S.config.serverHost) openSettings();
  if (S.serverError) msgbox(S.serverError, { icon: '⚠️', title: 'تنبيه' });
  else startupAlert();
  setInterval(poll, 3000);
  // تحديث الحالة كل ساعة (لو البرنامج مفتوح عدة أيام)
  setInterval(render, 60 * 60 * 1000);
})();
