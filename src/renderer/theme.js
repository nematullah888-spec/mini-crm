// يطبّق الثيم المحفوظ قبل ظهور الواجهة (بدون وميض)
(function () {
  try {
    if (localStorage.getItem('crm-theme') === 'modern') document.documentElement.classList.add('theme-modern');
  } catch (_) { /* التخزين غير متاح: نستخدم الكلاسيكي */ }
})();
