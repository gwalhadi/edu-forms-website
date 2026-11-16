import { h, icon, toast, confirmDialog, fmtDate, siteHeader, setTitle, modal, downloadBlob } from './common.js';
import { buildEditor } from './builder.js';
import { docPreview } from './preview.js';
import { generatePdf, openPdfTab } from './pdf.js';
import { validateSchema } from '../shared/core.js';
import * as fb from './fb.js';
import { formUrl } from './teacher-shell.js';

const FSTATUS = { published: ['منشور', 'ok'], inactive: ['موقوف', 'gray'], draft: ['مسودة', 'warn'] };
const pill = (map, k) => h('span.pill.' + (map[k]?.[1] || 'gray'), map[k]?.[0] || k);
const app = document.getElementById('app');
const absUrl = (rel) => new URL(rel, location.href).href;

// ---------- gate screens ----------
function gate(settings, ...content) {
  app.replaceChildren(siteHeader(settings || {}, { admin: true }), h('main', h('div.wrap', h('div.card.gate', content))));
}

function setupScreen() {
  setTitle('إعداد لوحة التحكم');
  gate({}, h('div.badge-ic', icon('settings', 26)), h('h1', { style: { margin: 0, fontSize: '20px' } }, 'الموقع غير مربوط بـ Firebase بعد'),
    h('p.muted', 'افتحي الملف ', h('span.ref', 'js/firebase-config.js'), ' والصقي فيه إعدادات مشروع Firebase كما في دليل النشر (README.md)، ثم ارفعي الملف وحدّثي الصفحة.'));
}

function loginScreen() {
  setTitle('دخول الإدارة');
  const email = h('input.inp#email', { type: 'email', autocomplete: 'username', required: true, dir: 'ltr' });
  const pw = h('input.inp#pw', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
  const msg = h('div.alert.err', { role: 'alert', hidden: true });
  const btn = h('button.btn.primary.block', { type: 'submit' }, 'تسجيل الدخول');
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault(); msg.hidden = true;
      if (!email.value.trim() || !pw.value) { msg.textContent = 'أدخلي البريد وكلمة المرور'; msg.hidden = false; return; }
      btn.classList.add('loading');
      try { await fb.login(email.value.trim(), pw.value); location.reload(); } catch (err) { msg.textContent = fb.errText(err); msg.hidden = false; } finally { btn.classList.remove('loading'); }
    },
  },
  h('div.fld', h('label', { for: 'email' }, 'البريد الإلكتروني'), email),
  h('div.fld', h('label', { for: 'pw' }, 'كلمة المرور'), pw),
  msg, btn,
  h('button.btn.ghost.sm', { type: 'button', onclick: async () => {
    if (!email.value.trim()) { msg.textContent = 'اكتبي بريدك أولًا ثم اضغطي «نسيت كلمة المرور»'; msg.hidden = false; return; }
    try { await fb.resetPassword(email.value.trim()); } catch { /* same message either way */ }
    toast('إذا كان البريد مسجّلًا فستصلك رسالة لإعادة تعيين كلمة المرور', 'info', 6000);
  } }, 'نسيت كلمة المرور؟'),
  h('a.small', { href: './', style: { textAlign: 'center' } }, 'العودة إلى صفحة النماذج'));
  gate({}, h('div.badge-ic', icon('lock', 26)), h('h1', { style: { margin: 0, fontSize: '20px' } }, 'لوحة تحكم المالكة'),
    h('p.muted', { style: { margin: '6px 0 0' } }, 'هذه الصفحة مخصصة لإدارة المنصة فقط.'), form);
  email.focus();
}

function uidScreen(user, configured) {
  setTitle('الحساب غير مصرّح');
  const copy = h('button.btn.sm', { type: 'button', onclick: () => navigator.clipboard?.writeText(user.uid).then(() => toast('تم النسخ')) }, icon('copy', 15), 'نسخ');
  gate({}, h('div.badge-ic', icon(configured ? 'alert' : 'shield', 26)),
    h('h1', { style: { margin: 0, fontSize: '20px' } }, configured ? 'هذا الحساب ليس حساب المالكة' : 'خطوة أخيرة: تسجيل معرّف حسابك'),
    configured
      ? h('p.muted', 'لوحة التحكم متاحة لحساب واحد فقط. سجّلي الخروج ثم ادخلي بحساب المالكة.')
      : h('p.muted', 'انسخي المعرّف التالي وضعيه في الملف js/firebase-config.js (adminUid) وفي قواعد الأمان firestore.rules، كما في الدليل.'),
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' } }, h('span.ref', { dir: 'ltr' }, user.uid), copy),
    h('button.btn', { type: 'button', onclick: async () => { await fb.logout(); location.reload(); } }, icon('logout', 16), 'تسجيل الخروج'));
}

// ---------- boot ----------
let settings = {};
let me = null;
const main = h('div.adm-main');
const links = [
  ['forms', 'إدارة النماذج', 'layers'],
  ['identity', 'هوية المدرسة', 'settings'],
  ['backup', 'النسخ الاحتياطي', 'save'],
  ['account', 'الحساب والأمان', 'shield'],
];
const side = h('aside.side', links.map(([k, t, i]) => h('a', { href: `#/${k}`, 'data-k': k }, icon(i), t)),
  h('div.sp'),
  h('a', { href: './', target: '_blank', rel: 'noopener' }, icon('external'), 'موقع المعلمات'),
  h('button', { type: 'button', onclick: async () => { await fb.logout(); location.reload(); } }, icon('logout'), 'تسجيل الخروج'));
const menuBtn = h('button.icon-btn.light.mob-menu', { type: 'button', 'aria-label': 'القائمة', onclick: () => side.classList.toggle('open') }, icon('menu'));
function frame() {
  app.replaceChildren(siteHeader(settings, { admin: true, nav: [h('span.nav-btn', icon('user', 16), h('span', me?.email || 'المالكة')), menuBtn] }), h('div.adm', side, main));
}

async function boot() {
  if (!fb.isConfigured) return setupScreen();
  me = await fb.waitForUser();
  if (!me) return loginScreen();
  if (!fb.ADMIN_UID || me.uid !== fb.ADMIN_UID) return uidScreen(me, !!fb.ADMIN_UID);
  try { settings = await fb.adminGetSettings(); } catch (e) { settings = { ...fb.DEFAULT_SETTINGS }; toast(fb.errText(e), 'err', 8000); }
  frame();
  window.addEventListener('hashchange', route);
  route();
}

// ---------- router ----------
let leaveGuard = null;
async function route() {
  if (leaveGuard && !(await leaveGuard())) return;
  leaveGuard = null;
  side.classList.remove('open');
  const parts = (location.hash.replace(/^#\/?/, '') || 'forms').split('/');
  const k = parts[0];
  side.querySelectorAll('a[data-k]').forEach((a) => a.classList.toggle('active', a.dataset.k === k));
  main.replaceChildren(h('p.muted', 'جارٍ التحميل…'));
  try {
    if (k === 'forms' && parts[1]) await viewFormEditor(decodeURIComponent(parts[1]));
    else if (k === 'forms') await viewForms();
    else if (k === 'identity') await viewIdentity();
    else if (k === 'backup') viewBackup();
    else if (k === 'account') viewAccount();
    else location.hash = '#/forms';
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div.banner.err', icon('alert'), fb.errText(e)));
  }
  window.scrollTo({ top: 0 });
}
const head = (title, ...acts) => h('div.page-head', h('h1', title), h('div.acts', acts));

// ---------- forms ----------
async function importInitial(btn) {
  btn?.classList.add('loading');
  try {
    const res = await fetch('data/initial-data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('ملف البيانات الأولية غير موجود');
    const n = await fb.importBackup(await res.json(), { mode: 'merge', withSettings: true, validateSchema });
    settings = await fb.adminGetSettings(); frame();
    toast(`تم نقل ${n} نماذج مع هوية المدرسة والشعار`);
    route();
  } catch (e) { toast(fb.errText(e), 'err', 8000); } finally { btn?.classList.remove('loading'); }
}

async function viewForms() {
  setTitle('إدارة النماذج');
  const forms = await fb.adminListForms();
  const move = async (i, d) => {
    const slugs = forms.map((f) => f.slug);
    const j = i + d; if (j < 0 || j >= slugs.length) return;
    [slugs[i], slugs[j]] = [slugs[j], slugs[i]];
    try { await fb.adminReorder(slugs); } catch (e) { toast(fb.errText(e), 'err'); }
    viewForms();
  };
  const setStatus = async (f, status) => {
    try {
      await fb.adminSetStatus(f.slug, status);
      toast(status === 'published' ? 'تم نشر النموذج للمعلمات' : 'تم إيقاف النموذج');
    } catch (e) { toast(fb.errText(e), 'err'); }
    viewForms();
  };
  const copyLink = (f) => {
    const url = absUrl(formUrl(f.slug));
    navigator.clipboard?.writeText(url).then(() => toast('تم نسخ رابط النموذج'), () => modal({ title: 'رابط النموذج', body: h('p.ref', { dir: 'ltr' }, url) }));
  };
  const onboarding = !forms.length ? h('div.card.panel', h('h2', 'ابدئي من هنا'),
    h('p.muted', 'قاعدة البيانات فارغة. يمكنك نقل النماذج الأربعة الحالية مع هوية المدرسة والشعار بضغطة واحدة، ثم مراجعتها وتعديلها.'),
    h('button.btn.primary', { type: 'button', onclick: (e) => importInitial(e.currentTarget) }, icon('download', 16), 'نقل النماذج الحالية'),
    ' ', h('a.btn', { href: '#/forms/new' }, icon('plus', 16), 'إنشاء نموذج من الصفر')) : null;
  main.replaceChildren(
    head('إدارة النماذج',
      h('a.btn.primary', { href: '#/forms/new' }, icon('plus', 16), 'نموذج جديد'),
      h('button.btn', { onclick: importJSON }, icon('code', 16), 'استيراد JSON')),
    h('p.muted.small', 'النماذج «المنشورة» فقط تظهر للمعلمات. رابط الموقع للمعلمات: ', h('span.ref', { dir: 'ltr' }, absUrl('./')),
      ' ', h('button.btn.sm.ghost', { type: 'button', onclick: () => navigator.clipboard?.writeText(absUrl('./')).then(() => toast('تم نسخ رابط الموقع')) }, icon('copy', 14), 'نسخ')),
    onboarding,
    forms.length ? h('div.tbl-wrap', h('table.tbl',
      h('thead', h('tr', h('th', 'الترتيب'), h('th', 'النموذج'), h('th', 'الحالة'), h('th', 'آخر تعديل'), h('th', ''))),
      h('tbody', forms.map((f, i) => h('tr',
        h('td', h('div.acts', { style: { justifyContent: 'flex-start' } },
          h('button.icon-btn', { title: 'أعلى', 'aria-label': 'نقل للأعلى', disabled: i === 0, onclick: () => move(i, -1) }, icon('up')),
          h('button.icon-btn', { title: 'أسفل', 'aria-label': 'نقل للأسفل', disabled: i === forms.length - 1, onclick: () => move(i, 1) }, icon('down')))),
        h('td', h('b', f.title), h('div.small.muted', h('span.ref', { dir: 'ltr' }, f.slug))),
        h('td', pill(FSTATUS, f.status)),
        h('td', { style: { whiteSpace: 'nowrap' } }, f.updatedAt ? fmtDate(f.updatedAt) : '—'),
        h('td', h('div.acts',
          f.status === 'published'
            ? h('button.btn.sm', { onclick: () => setStatus(f, 'inactive') }, icon('power', 14), 'إيقاف')
            : h('button.btn.sm.soft', { onclick: () => setStatus(f, 'published') }, icon('check', 14), 'نشر'),
          h('a.icon-btn', { href: `#/forms/${encodeURIComponent(f.slug)}`, title: 'تعديل', 'aria-label': 'تعديل' }, icon('edit')),
          h('a.icon-btn', { href: `${formUrl(f.slug)}&preview=1`, target: '_blank', rel: 'noopener', title: 'معاينة كما تراه المعلمة', 'aria-label': 'معاينة' }, icon('eye')),
          f.status === 'published' ? h('button.icon-btn', { title: 'نسخ رابط النموذج للمعلمات', 'aria-label': 'نسخ الرابط', onclick: () => copyLink(f) }, icon('link')) : null,
          h('button.icon-btn', { title: 'نسخ النموذج (مسودة جديدة)', 'aria-label': 'نسخ النموذج', onclick: async () => {
            try {
              const slug = await fb.freeSlug(`${f.slug}-copy`);
              await fb.adminSaveForm(null, { ...f, slug, title: `${f.title} (نسخة)`, status: 'draft', sortOrder: null });
              toast('تم إنشاء نسخة (مسودة)'); location.hash = `#/forms/${slug}`;
            } catch (e) { toast(fb.errText(e), 'err'); }
          } }, icon('copy')),
          h('button.icon-btn', { title: 'تصدير JSON', 'aria-label': 'تصدير JSON', onclick: () => {
            const { title, slug, description, tags, icon: ic, schema } = f;
            downloadBlob(new Blob([JSON.stringify({ title, slug, description, tags, icon: ic, schema }, null, 2)], { type: 'application/json' }), `${f.slug}.json`);
          } }, icon('download')),
          h('button.icon-btn.danger', { title: 'حذف', 'aria-label': 'حذف النموذج', onclick: async () => {
            if (!await confirmDialog('حذف النموذج', `سيتم حذف النموذج «${f.title}» نهائيًا.\nإذا أردتِ فقط إخفاءه عن المعلمات فاستخدمي «إيقاف».`, { okLabel: 'حذف', danger: true })) return;
            try { await fb.adminDeleteForm(f.slug); toast('تم حذف النموذج'); } catch (e) { toast(fb.errText(e), 'err'); }
            viewForms();
          } }, icon('trash'))))))))) : (onboarding ? null : h('div.empty', 'لا توجد نماذج بعد.')));
}

function importJSON() {
  const ta = h('textarea.inp.code', { placeholder: '{ "title": "...", "schema": { "sections": [...] } }' });
  modal({
    title: 'استيراد نموذج من JSON', wide: true,
    body: h('div', h('p.small.muted', 'الصقي ملف JSON لنموذج سبق تصديره من هذه المنصة.'), ta),
    actions: [{ label: 'استيراد', kind: 'primary', onClick: async () => {
      let obj;
      try { obj = JSON.parse(ta.value); } catch { toast('صيغة JSON غير صحيحة', 'err'); return false; }
      const errs = validateSchema(obj.schema);
      if (!String(obj.title || '').trim()) errs.unshift('عنوان النموذج مطلوب');
      if (errs.length) { toast(errs[0], 'err'); return false; }
      try {
        const base = fb.SLUG_RE.test(String(obj.slug || '')) ? obj.slug : 'form-' + Math.random().toString(36).slice(2, 8);
        const slug = await fb.freeSlug(base);
        await fb.adminSaveForm(null, { ...obj, slug, status: 'draft', sortOrder: null });
        toast('تم استيراد النموذج كمسودة'); location.hash = `#/forms/${slug}`;
      } catch (e) { toast(fb.errText(e), 'err'); return false; }
    } }, { label: 'إلغاء', kind: 'ghost' }],
  });
}

async function viewFormEditor(slugOrNew) {
  let form;
  if (slugOrNew === 'new') {
    form = { title: '', slug: '', description: '', tags: [], icon: 'clipboard', status: 'draft', schema: { submitterField: '', pdf: { title: '', showPrincipal: true, showPrincipalMarks: true }, sections: [{ id: 's1', title: 'البيانات', columns: 2, fields: [] }] } };
  } else {
    form = await fb.adminGetForm(slugOrNew);
    if (!form) { main.replaceChildren(h('div.banner.err', icon('alert'), 'النموذج غير موجود'), h('a.btn', { href: '#/forms' }, 'العودة')); return; }
  }
  let curSlug = form.id ? form.slug : null;
  setTitle(curSlug ? `تعديل: ${form.title}` : 'نموذج جديد');
  const ed = buildEditor(form, {
    settings: () => settings,
    onSave: async (payload) => {
      const slug = String(payload.slug || '').trim().toLowerCase() || (curSlug ?? await fb.freeSlug('form-' + Math.random().toString(36).slice(2, 8)));
      const saved = await fb.adminSaveForm(curSlug, { ...payload, slug, sortOrder: null });
      toast('تم حفظ النموذج');
      if (curSlug !== saved.slug) {
        curSlug = saved.slug;
        history.replaceState(null, '', `#/forms/${encodeURIComponent(saved.slug)}`);
      }
      return saved;
    },
  });
  leaveGuard = async () => !ed.isDirty() || confirmDialog('تغييرات غير محفوظة', 'لم تحفظي التعديلات على النموذج. هل تريدين المغادرة؟', { okLabel: 'مغادرة', danger: true });
  main.replaceChildren(ed.el);
}
window.addEventListener('beforeunload', (e) => { if (leaveGuard && document.querySelector('[data-dirty="1"]')) { e.preventDefault(); e.returnValue = ''; } });

// ---------- identity ----------
/** Reads an image file, optionally makes near-white pixels transparent, and keeps it small enough for Firestore. */
function readImage(file, { removeWhite = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('اختاري صورة PNG أو JPG أو WEBP'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('حجم الصورة أكبر من ١٠ ميجابايت'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      for (const maxW of [1400, 1000, 750, 500, 350]) {
        const scale = Math.min(1, maxW / img.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        if (removeWhite) {
          const d = ctx.getImageData(0, 0, c.width, c.height); const p = d.data;
          for (let i = 0; i < p.length; i += 4) {
            const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
            if (lum > 235) p[i + 3] = 0; else if (lum > 200) p[i + 3] = Math.round(p[i + 3] * (235 - lum) / 35);
          }
          ctx.putImageData(d, 0, 0);
        }
        const out = removeWhite || file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
        if (out.length <= 700_000) return resolve(out);
      }
      reject(new Error('الصورة كبيرة جدًا، جرّبي صورة أصغر'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة')); };
    img.src = url;
  });
}

/** True when the opaque pixels of an image are mostly white/very light (e.g. a white logo on transparency). */
function isLightImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); const sc = Math.min(1, 200 / img.naturalWidth);
      c.width = Math.max(1, Math.round(img.naturalWidth * sc)); c.height = Math.max(1, Math.round(img.naturalHeight * sc));
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
      const p = x.getImageData(0, 0, c.width, c.height).data; let op = 0; let light = 0;
      for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 40) { op++; if (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2] > 225) light++; }
      const transparent = p.length / 4 - op;
      resolve(op > 0 && transparent / (p.length / 4) > 0.15 && light / op > 0.8);
    };
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

const SAMPLE_SCHEMA = {
  title: 'نموذج تجريبي',
  pdf: { title: 'معاينة الترويسة والتوقيع', showPrincipal: true },
  sections: [{ id: 'a', title: 'البيانات', columns: 2, fields: [
    { id: 'n', type: 'text', label: 'اسم المعلمة', width: 'half' }, { id: 'd', type: 'date', label: 'التاريخ', width: 'half' },
    { id: 'x', type: 'textarea', label: 'الملاحظات', width: 'full' }] }],
};
const sampleData = () => ({ n: 'نورة القحطاني', d: new Date().toISOString().slice(0, 10), x: 'نص تجريبي' });

async function viewIdentity() {
  setTitle('هوية المدرسة');
  const loaded = await fb.adminGetSettings();
  const st = { ...loaded };
  const texts = [
    ['schoolName', 'اسم المدرسة', true], ['department', 'الإدارة التعليمية (سطر الترويسة)', true],
    ['line1', 'السطر الأول في الترويسة'], ['line2', 'السطر الثاني في الترويسة'],
    ['siteTitle', 'عنوان الموقع (الشريط العلوي)', true], ['heroTitle', 'العنوان الرئيسي في الصفحة الرئيسية', true],
    ['heroSubtitle', 'النص التعريفي في الصفحة الرئيسية', true], ['footerNote', 'ملاحظة أسفل كل ملف PDF (اختياري)', true],
  ];
  let dirty = false;
  const pvBox = h('div');
  let t;
  const preview = () => { clearTimeout(t); t = setTimeout(() => pvBox.replaceChildren(docPreview(SAMPLE_SCHEMA, sampleData(), st).el), 200); };
  const touch = () => { dirty = true; preview(); };
  const txt = (k, label, full, tag = 'input.inp') => {
    const el = h(tag, { value: st[k] || '', maxLength: 400, rows: 2, oninput: (e) => { st[k] = e.target.value; touch(); } });
    return h('div.fg' + (full ? '.full' : ''), h('label', label), el);
  };
  const slider = (k, label, min, max) => {
    const out = h('span.small.muted', `${st[k]}px`);
    return h('div.fg', h('label', label, ' ', out), h('input', { type: 'range', min, max, value: st[k], style: { width: '100%' }, 'aria-label': label,
      oninput: (e) => { st[k] = Number(e.target.value); out.textContent = `${st[k]}px`; touch(); } }));
  };
  const select = (k, label, opts) => {
    const el = h('select.inp', { onchange: (e) => { st[k] = e.target.value; touch(); } }, opts.map(([v, tx]) => h('option', { value: v }, tx)));
    el.value = st[k];
    return h('div.fg', h('label', label), el);
  };
  const imageCard = (k, label, { sizeKey, min, max, whiteDefault = false, hint = '', boxKey = null }) => {
    const thumb = h('div.thumb');
    const removeWhite = h('input', { type: 'checkbox', checked: whiteDefault });
    const boxChk = boxKey ? h('input', { type: 'checkbox', checked: st[boxKey] !== false, onchange: (e) => { st[boxKey] = e.target.checked; paint(); touch(); } }) : null;
    const paint = () => {
      thumb.classList.toggle('dark', !!boxKey && st[boxKey] === false);
      thumb.replaceChildren(st[k] ? h('img', { src: st[k], alt: label }) : h('span.small.muted', 'لا يوجد'));
    };
    paint();
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        st[k] = await readImage(f, { removeWhite: removeWhite.checked });
        if (boxKey && await isLightImage(st[k])) { st[boxKey] = false; boxChk.checked = false; toast('الشعار أبيض اللون، لذلك سيظهر مباشرة على الشريط البنفسجي بدون مربع أبيض', 'info', 5000); }
        paint(); touch();
      } catch (err) { toast(err.message, 'err'); }
    } });
    return h('div.card.panel.img-card', h('h2', label), hint ? h('p.small.muted', hint) : null,
      h('div.logo-prev', thumb, file,
        h('button.btn.sm', { type: 'button', onclick: () => file.click() }, icon('image', 15), st[k] ? 'استبدال' : 'رفع صورة'),
        h('button.btn.sm.ghost', { type: 'button', onclick: () => { st[k] = ''; paint(); touch(); } }, 'إزالة')),
      h('label.chk.small', { style: { marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center' } }, removeWhite, 'إزالة الخلفية البيضاء عند الرفع'),
      boxChk ? h('label.chk.small', { style: { marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center' } }, boxChk, 'إظهار مربع أبيض خلف الشعار (أوقفيه للشعارات البيضاء)') : null,
      slider(sizeKey, 'الحجم في النموذج', min, max));
  };

  main.replaceChildren(
    head('هوية المدرسة',
      h('button.btn', { onclick: async (e) => {
        const b = e.currentTarget; b.classList.add('loading'); const tab = openPdfTab();
        try { await tab.show(await generatePdf({ ...SAMPLE_SCHEMA }, sampleData(), st)); } catch (err) { tab.close(); toast(err.message, 'err'); } finally { b.classList.remove('loading'); }
      } }, icon('file', 16), 'معاينة PDF'),
      h('button.btn.primary', { onclick: async (e) => {
        const b = e.currentTarget; b.classList.add('loading');
        try {
          settings = await fb.adminSaveSettings(st, loaded);
          dirty = false; leaveGuard = null; frame(); route(); toast('تم حفظ هوية المدرسة — تُطبّق على جميع النماذج');
        } catch (err) { toast(fb.errText(err), 'err'); } finally { b.classList.remove('loading'); }
      } }, icon('save', 16), 'حفظ')),
    h('p.muted.small', 'تُطبّق هذه الإعدادات تلقائيًا على جميع النماذج: في رأس الموقع، ومعاينة المعلمات، وكل ملف PDF. لا تستطيع المعلمات تعديل أي منها.'),
    h('div.ident',
      h('div',
        h('div.card.panel', h('h2', 'البيانات'), h('div.form-grid', texts.map(([k, l, f]) => txt(k, l, f, k === 'heroSubtitle' ? 'textarea.inp' : 'input.inp')))),
        h('div.card.panel', h('h2', 'الترويسة'), h('div.form-grid',
          select('headerAlign', 'محاذاة نص الترويسة', [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']]))),
        imageCard('logo', 'الشعار الأيمن (أعلى يمين النموذج)', { sizeKey: 'logoSize', min: 16, max: 110, boxKey: 'logoBox' }),
        imageCard('logo2', 'الشعار الأيسر (أعلى يسار النموذج)', { sizeKey: 'logo2Size', min: 16, max: 110, boxKey: 'logo2Box' }),
        h('div.card.panel', h('h2', 'المديرة'), h('div.form-grid',
          txt('principalTitle', 'المسمى (مثل: مديرة المدرسة)'), txt('principalName', 'اسم المديرة'),
          select('principalAlign', 'مكان التوقيع في النموذج', [['center', 'في الوسط'], ['right', 'يمين الصفحة'], ['left', 'يسار الصفحة']]),
          select('stampMode', 'وضع الختم', [['beside', 'بجانب التوقيع'], ['overlap', 'فوق التوقيع (متداخل)']]))),
        imageCard('principalSig', 'توقيع المديرة', { sizeKey: 'sigSize', min: 20, max: 140, whiteDefault: true, hint: 'صوّري التوقيع على ورقة بيضاء. خيار «إزالة الخلفية البيضاء» يجعله شفافًا.' }),
        imageCard('stamp', 'ختم المدرسة', { sizeKey: 'stampSize', min: 30, max: 200, whiteDefault: true }),
        h('div.card.panel', h('h2', 'إدراج التوقيع والختم في ملفات المعلمات'),
          h('label.chk', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } },
            h('input', { type: 'checkbox', checked: !!st.marksPublic, onchange: (e) => { st.marksPublic = e.target.checked; touch(); } }),
            h('span', 'إظهار توقيع المديرة وختم المدرسة في معاينة المعلمات وفي ملفات PDF التي ينزّلنها')),
          h('div.banner', { style: { marginTop: '10px' } }, icon('alert'), h('span.grow.small',
            'تنبيه أمني: عند التفعيل تصبح صورتا التوقيع والختم قابلتين للتنزيل لأي شخص لديه رابط الموقع، لأنه لا يوجد خادم يضيفهما لاحقًا. عند الإيقاف تبقيان محفوظتين ولا يراهما إلا حسابك.')),
          h('p.small.muted', 'يمكن إخفاء التوقيع أو كتلة المديرة كاملة في نموذج معيّن من إعدادات ذلك النموذج.'))),
      h('div', { style: { position: 'sticky', top: '80px' } }, h('div.card.panel', h('h2', 'معاينة مباشرة'), pvBox))));
  preview();
  leaveGuard = async () => !dirty || confirmDialog('تغييرات غير محفوظة', 'لم تحفظي تعديلات هوية المدرسة. هل تريدين المغادرة؟', { okLabel: 'مغادرة', danger: true });
}

// ---------- backup ----------
function viewBackup() {
  setTitle('النسخ الاحتياطي');
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { toast('الملف ليس JSON صالحًا', 'err'); return; }
    const replace = modeSel.value === 'replace';
    const ok = await confirmDialog('استعادة نسخة احتياطية', `سيتم استيراد ${Array.isArray(obj.forms) ? obj.forms.length : 0} نموذج${withSet.checked ? ' مع هوية المدرسة والصور' : ''}.\n${replace ? 'سيتم حذف النماذج غير الموجودة في الملف.' : 'النماذج التي لها نفس الرابط المختصر ستُستبدل، والباقي يبقى كما هو.'}`, { okLabel: 'استعادة', danger: replace });
    if (!ok) return;
    try {
      const n = await fb.importBackup(obj, { mode: replace ? 'replace' : 'merge', withSettings: withSet.checked, validateSchema });
      settings = await fb.adminGetSettings(); frame(); route();
      toast(`تمت استعادة ${n} نموذج`);
    } catch (err) { toast(fb.errText(err), 'err', 8000); }
  } });
  const modeSel = h('select.inp', h('option', { value: 'merge' }, 'دمج: إضافة/استبدال النماذج الموجودة في الملف فقط'), h('option', { value: 'replace' }, 'استبدال كامل: حذف النماذج غير الموجودة في الملف'));
  const withSet = h('input', { type: 'checkbox', checked: true });
  main.replaceChildren(
    head('النسخ الاحتياطي'),
    h('div.card.panel', h('h2', 'تنزيل نسخة احتياطية'),
      h('p.small.muted', 'ملف واحد يحتوي جميع النماذج وهوية المدرسة والشعارات. احفظيه في مكان آمن بعد كل تعديل مهم. (لا يحتوي أي بيانات للمعلمات، فهي لا تُحفظ أصلًا.)'),
      h('button.btn.primary', { onclick: async (e) => {
        const b = e.currentTarget; b.classList.add('loading');
        try {
          const data = await fb.exportBackup();
          downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `edu-forms-backup-${new Date().toISOString().slice(0, 10)}.json`);
          toast('تم تنزيل النسخة الاحتياطية');
        } catch (err) { toast(fb.errText(err), 'err'); } finally { b.classList.remove('loading'); }
      } }, icon('download', 16), 'تنزيل النسخة الاحتياطية')),
    h('div.card.panel', h('h2', 'استعادة من نسخة احتياطية'),
      h('div.form-grid', h('div.fg.full', h('label', 'طريقة الاستعادة'), modeSel),
        h('div.fg.full', h('label.chk', withSet, ' استعادة هوية المدرسة والشعارات أيضًا'))),
      file, h('button.btn', { style: { marginTop: '10px' }, onclick: () => file.click() }, icon('file', 16), 'اختيار ملف النسخة الاحتياطية…')),
    h('div.card.panel', h('h2', 'النماذج الأصلية'),
      h('p.small.muted', 'إعادة نقل النماذج الأربعة الأصلية وهوية المدرسة كما كانت في الموقع القديم (تُستبدل النماذج التي لها نفس الرابط المختصر).'),
      h('button.btn', { onclick: async (e) => {
        if (!await confirmDialog('النماذج الأصلية', 'سيتم استبدال النماذج الأربعة الأصلية وهوية المدرسة بالنسخة الأصلية. هل تريدين المتابعة؟', { okLabel: 'متابعة' })) return;
        importInitial(e.currentTarget);
      } }, icon('refresh', 16), 'استعادة النماذج الأصلية')));
}

// ---------- account ----------
function viewAccount() {
  setTitle('الحساب والأمان');
  const cur = h('input.inp', { type: 'password', autocomplete: 'current-password', dir: 'ltr' });
  const nw = h('input.inp', { type: 'password', autocomplete: 'new-password', dir: 'ltr', minLength: 10 });
  const nw2 = h('input.inp', { type: 'password', autocomplete: 'new-password', dir: 'ltr' });
  main.replaceChildren(
    head('الحساب والأمان'),
    h('div.card.panel', h('h2', 'الحساب'),
      h('dl.kv', h('dt', 'البريد'), h('dd', { dir: 'ltr', style: { textAlign: 'right' } }, me?.email || ''), h('dt', 'معرّف الحساب'), h('dd', h('span.ref', { dir: 'ltr' }, me?.uid || ''))),
      h('p.small.muted', 'لتغيير بريد الدخول: Firebase Console ← Authentication ← Users. لوحة التحكم مقفلة على معرّف هذا الحساب في قواعد الأمان.')),
    h('div.card.panel', h('h2', 'تغيير كلمة المرور'),
      h('div.form-grid', h('div.fg.full', h('label', 'كلمة المرور الحالية'), cur), h('div.fg', h('label', 'كلمة المرور الجديدة (١٠ أحرف على الأقل)'), nw), h('div.fg', h('label', 'تأكيد كلمة المرور الجديدة'), nw2)),
      h('button.btn.primary', { style: { marginTop: '10px' }, onclick: async (e) => {
        if (nw.value.length < 10) return toast('كلمة المرور الجديدة يجب ألا تقل عن ١٠ أحرف', 'err');
        if (nw.value !== nw2.value) return toast('كلمتا المرور غير متطابقتين', 'err');
        const b = e.currentTarget; b.classList.add('loading');
        try { await fb.changePassword(cur.value, nw.value); toast('تم تغيير كلمة المرور'); cur.value = nw.value = nw2.value = ''; } catch (err) { toast(fb.errText(err), 'err'); } finally { b.classList.remove('loading'); }
      } }, 'تغيير كلمة المرور')),
    h('div.card.panel', h('h2', 'الخصوصية'),
      h('ul.small', { style: { margin: 0, paddingInlineStart: '18px', lineHeight: 1.9 } },
        h('li', 'لا تُحفظ إجابات المعلمات ولا ملفات PDF في Firebase ولا على GitHub؛ كل ذلك يتم داخل متصفح المعلمة.'),
        h('li', 'المسودات تُحفظ في متصفح المعلمة على جهازها فقط.'),
        h('li', 'المحفوظ في Firebase: النماذج، هوية المدرسة، والصور التي ترفعينها.'))));
}

boot();
