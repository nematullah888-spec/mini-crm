// اختبار حسابات الاشتراكات
'use strict';
const assert = require('assert');
const S = require('../src/renderer/subs');

assert.strictEqual(S.addMonths('2026-01-31', 1), '2026-02-28');
assert.strictEqual(S.addMonths('2024-02-29', 12), '2025-02-28');
assert.strictEqual(S.addMonths('2026-11-07', 12), '2027-11-07');

// سنة كاملة، أو سنة ناقص يوم (لو كتب المستخدم آخر يوم) = ليست أقل من سنة
assert.strictEqual(S.isUnderYear({ start: '2026-01-01', end: '2027-01-01' }), false);
assert.strictEqual(S.isUnderYear({ start: '2026-01-01', end: '2026-12-31' }), false);
assert.strictEqual(S.isUnderYear({ start: '2026-01-01', end: '2026-09-01' }), true);
assert.strictEqual(S.isUnderYear({ start: '2026-01-01', end: '2028-01-01' }), false);

assert.strictEqual(S.periodText('2026-01-01', '2027-01-01'), 'سنة');
assert.strictEqual(S.periodText('2026-01-01', '2026-09-01'), '8 أشهر');
assert.strictEqual(S.periodText('2026-01-01', '2026-03-06'), 'شهرين و5 أيام');
assert.strictEqual(S.periodText('2026-01-01', '2027-04-01'), 'سنة و3 أشهر');

const today = '2026-11-07';
assert.strictEqual(S.subStatus({ start: '2025-11-20', end: '2026-11-20' }, today, 10).kind, 'active');
assert.strictEqual(S.subStatus({ start: '2025-11-17', end: '2026-11-17' }, today, 10).kind, 'soon');
assert.strictEqual(S.subStatus({ start: '2025-11-07', end: '2026-11-07' }, today, 10).days, 0);
assert.strictEqual(S.subStatus({ start: '2025-11-01', end: '2026-11-01' }, today, 10).kind, 'expired');
assert.strictEqual(S.daysText(-3), 'منتهي منذ 3 أيام');
assert.strictEqual(S.daysText(1), 'باقي يوم');
assert.strictEqual(S.daysText(15), 'باقي 15 يوم');

// العميل عنده تجديد: الاشتراك القديم منتهي والجديد فعّال ← الحالة فعّال
const c = { subscriptions: [
  { product: 'مانجر', start: '2025-01-01', end: '2026-01-01' },
  { product: 'مانجر', start: '2026-01-01', end: '2026-11-12' },
  { product: 'أورنيوم', start: '2026-05-01', end: '2027-05-01' }
] };
const st = S.customerStatus(c, today, 10);
assert.strictEqual(st.subs.length, 2, 'اشتراك حالي لكل خدمة');
assert.strictEqual(st.sub.product, 'مانجر');
assert.strictEqual(st.kind, 'soon');
assert.strictEqual(st.underYear, true);
assert.strictEqual(S.customerStatus({ subscriptions: [] }, today, 10).kind, 'none');

console.log('✓ اختبارات الاشتراكات نجحت');
