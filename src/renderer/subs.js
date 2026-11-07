// حسابات الاشتراكات: الأيام المتبقية، المدة، أقل من سنة، حالة الاشتراك
// يعمل داخل البرنامج وفي الاختبارات (Node)
(function (root) {
  'use strict';
  const DAY = 86400000;
  const pad = n => String(n).padStart(2, '0');

  const parse = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fmt = t => new Date(t).toISOString().slice(0, 10);

  function todayStr(now) {
    now = now || new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function addMonths(s, n) {
    const [y, m, d] = s.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(d, last));
    return fmt(first.getTime());
  }

  const addDays = (s, n) => fmt(parse(s) + n * DAY);
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY); // b - a

  // الاشتراك أقل من سنة إذا انتهى قبل (البداية + 12 شهر) بأكثر من يوم
  const isUnderYear = sub => diffDays(sub.end, addMonths(sub.start, 12)) > 1;

  function plural(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
  }

  // نص المدة: "سنة"، "8 أشهر"، "سنة و3 أشهر"، "شهرين و5 أيام"
  function periodText(start, end) {
    let m = 0;
    while (addMonths(start, m + 1) <= end) m++;
    const d = diffDays(addMonths(start, m), end);
    const y = Math.floor(m / 12);
    const mm = m % 12;
    const parts = [];
    if (y) parts.push(plural(y, 'سنة', 'سنتين', 'سنوات', 'سنة'));
    if (mm) parts.push(plural(mm, 'شهر', 'شهرين', 'أشهر', 'شهر'));
    if (d) parts.push(plural(d, 'يوم', 'يومين', 'أيام', 'يوم'));
    return parts.length ? parts.join(' و') : '0 يوم';
  }

  const remaining = (sub, today) => diffDays(today, sub.end);

  function subStatus(sub, today, alertDays) {
    const days = remaining(sub, today);
    const kind = days < 0 ? 'expired' : days <= alertDays ? 'soon' : 'active';
    return { kind, days, sub, underYear: isUnderYear(sub) };
  }

  // الاشتراك الحالي لكل خدمة = الأحدث انتهاءً
  function currentSubs(customer) {
    const map = new Map();
    for (const s of customer.subscriptions || []) {
      const cur = map.get(s.product);
      if (!cur || s.end > cur.end || (s.end === cur.end && s.start > cur.start)) map.set(s.product, s);
    }
    return [...map.values()].sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  }

  // حالة العميل = أقرب اشتراك حالي للانتهاء
  function customerStatus(customer, today, alertDays) {
    const subs = currentSubs(customer);
    if (!subs.length) return { kind: 'none', days: null, subs: [], underYear: false };
    const st = subStatus(subs[0], today, alertDays);
    st.subs = subs;
    st.underYear = subs.some(isUnderYear);
    return st;
  }

  function daysText(days) {
    if (days == null) return '';
    if (days < 0) return `منتهي منذ ${plural(-days, 'يوم', 'يومين', 'أيام', 'يوم')}`;
    if (days === 0) return 'ينتهي اليوم';
    return `باقي ${plural(days, 'يوم', 'يومين', 'أيام', 'يوم')}`;
  }

  const STATUS_NAMES = { none: 'بدون اشتراك', active: 'فعّال', soon: 'قرب الانتهاء', expired: 'منتهي' };

  const api = { todayStr, addMonths, addDays, diffDays, isUnderYear, periodText, remaining,
    subStatus, currentSubs, customerStatus, daysText, STATUS_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Subs = api;
})(this);
