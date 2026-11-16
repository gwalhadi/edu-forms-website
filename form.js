import { h, icon, store, toast, confirmDialog, fmtDateTime, setTitle } from './common.js';
import { shell, loadSettings, KEYS, formUrl } from './teacher-shell.js';
import { renderForm, initialData } from './form-ui.js';
import { docPreview } from './preview.js';
import { downloadPdf } from './pdf.js';
import { validate } from '../shared/core.js';
import { getForm, errText, waitForUser } from './fb.js';

const params = new URLSearchParams(location.search);
const slug = params.get('f') || '';
const isAdminPreview = params.get('preview') === '1';
let draftId = params.get('draft');

const settings = await loadSettings();

let form = null;
let failMsg = settings.error || '';
if (!failMsg) {
  try {
    if (isAdminPreview) await waitForUser(); // the owner's session lets her preview unpublished forms
    form = await getForm(slug);
  } catch (e) { failMsg = errText(e); }
}
if (!form || !form.schema) {
  shell(settings, h('div.wrap.narrow', h('div.card.gate', h('div.badge-ic', icon('alert', 26)), h('h1', { style: { fontSize: '20px' } }, 'النموذج غير متاح'),
    h('p.muted', failMsg || 'هذا النموذج غير موجود أو أوقفته إدارة المدرسة.'), h('a.btn.primary', { href: './' }, 'العودة إلى النماذج'))));
  throw new Error('form unavailable');
}
const schema = { ...form.schema, title: form.title };
setTitle(`${form.title} · ${settings.siteTitle || ''}`);

// Forms built on an original PDF: the blank file is fetched in the background (and kept on this device).
const isPdfForm = schema.mode === 'pdf';
let pdfTpl = null;
const loadTemplate = () => (pdfTpl ||= import('./pdf-template.js')
  .then(async (m) => ({ m, bytes: await m.templateBytes(schema.pdfTemplate?.fileId) }))
  .catch((e) => { pdfTpl = null; throw e; }));
if (isPdfForm) loadTemplate().catch((e) => console.warn(e));

// ---------- state ----------
let data = initialData(schema);
let dirty = false;
let lastSaved = null;
const autoKey = KEYS.auto(slug);
const drafts = () => store.get(KEYS.drafts, []) || [];

if (draftId) {
  const d = drafts().find((x) => x.id === draftId && x.slug === slug);
  if (d) { data = { ...data, ...structuredClone(d.data) }; lastSaved = d.updatedAt; } else draftId = null;
}

// ---------- layout ----------
const container = h('div.wrap.narrow');
shell(settings, container);

const editView = h('div');
const previewView = h('div', { hidden: true });
container.append(editView, previewView);

const unsavedPill = h('span.pill.warn', { hidden: true }, 'تغييرات غير محفوظة');
const kindPill = h('span.pill', draftId ? 'مسودة محفوظة' : 'نموذج جديد');
const statusEl = h('span.status', { 'aria-live': 'polite' });
let ui;

function paintStatus() {
  unsavedPill.hidden = !dirty;
  statusEl.textContent = dirty ? 'لم يتم حفظ آخر التغييرات' : lastSaved ? `آخر حفظ: ${fmtDateTime(lastSaved)}` : '';
  kindPill.textContent = draftId ? 'مسودة محفوظة' : 'نموذج جديد';
}

let autoTimer;
function onChange() {
  dirty = true; paintStatus();
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => store.set(autoKey, { data, at: new Date().toISOString(), draftId }), 800);
}

function buildEdit() {
  ui = renderForm(schema, data, onChange);
  const restore = maybeRestoreBanner();
  editView.replaceChildren(
    isAdminPreview ? h('div.banner.info', icon('eye'), h('span.grow', `معاينة المالكة — حالة النموذج: ${({ draft: 'مسودة', inactive: 'موقوف', published: 'منشور' })[form.status]}. النماذج غير المنشورة لا تظهر للمعلمات.`)) : null,
    h('div.form-top',
      h('div.ft-title', h('span.badge-ic', icon(form.icon || 'clipboard', 20)),
        h('div', h('h1', form.title), h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' } }, kindPill, unsavedPill))),
      h('button.btn.sm.ghost', { type: 'button', onclick: clearForm }, icon('refresh', 15), 'مسح النموذج')),
    restore,
    form.description ? h('p.muted', { style: { marginTop: 0 } }, form.description) : null,
    h('p.small.muted', { style: { marginTop: 0 } }, 'الحقول المعلّمة بـ ', h('span.req', '*'), ' مطلوبة.'),
    ui.el);
  paintStatus();
}

function maybeRestoreBanner() {
  const a = store.get(autoKey);
  if (!a?.data || (a.draftId || null) !== (draftId || null)) return null;
  if (lastSaved && a.at <= lastSaved) return null;
  const b = h('div.banner', icon('clock'), h('span.grow', `وُجد عمل غير محفوظ من ${fmtDateTime(a.at)}. هل تريدين استعادته؟`),
    h('button.btn.sm.primary', { type: 'button', onclick: () => { data = { ...initialData(schema), ...a.data }; dirty = true; buildEdit(); toast('تمت استعادة العمل غير المحفوظ'); } }, 'استعادة'),
    h('button.btn.sm', { type: 'button', onclick: () => { store.del(autoKey); b.remove(); } }, 'تجاهل'));
  return b;
}

async function clearForm() {
  if (!await confirmDialog('مسح النموذج', 'سيتم مسح جميع البيانات المدخلة في هذا النموذج. هل تريدين المتابعة؟', { okLabel: 'مسح', danger: true })) return;
  data = initialData(schema); dirty = false; store.del(autoKey);
  buildEdit(); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('تم مسح النموذج');
}

function saveDraft() {
  const all = drafts();
  const now = new Date().toISOString();
  const label = data[schema.submitterField] || '';
  if (draftId) {
    const d = all.find((x) => x.id === draftId);
    if (d) Object.assign(d, { data: structuredClone(data), updatedAt: now, label });
    else all.push({ id: draftId, slug, formTitle: form.title, data: structuredClone(data), updatedAt: now, label });
  } else {
    draftId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    all.push({ id: draftId, slug, formTitle: form.title, data: structuredClone(data), updatedAt: now, label });
    history.replaceState(null, '', `${formUrl(slug)}&draft=${draftId}${isAdminPreview ? '&preview=1' : ''}`);
  }
  if (!store.set(KEYS.drafts, all)) { toast('تعذر الحفظ: مساحة التخزين في المتصفح ممتلئة', 'err'); return; }
  store.del(autoKey);
  dirty = false; lastSaved = now; paintStatus();
  toast('تم حفظ المسودة على جهازك');
}

function checkValid() {
  const v = validate(schema, data);
  ui.setErrors(v.errors);
  if (!v.ok) {
    for (const el of document.querySelectorAll('.fld.has-err')) el.markMissing?.();
    const first = ui.firstError();
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => first?.querySelector('input,select,textarea,button')?.focus({ preventScroll: true }), 350);
    toast(`يرجى استكمال ${Object.keys(v.errors).length} حقل/حقول مطلوبة`, 'err');
  }
  return v;
}

// ---------- preview & PDF ----------
let pv;
function showPreview() {
  const v = checkValid();
  if (!v.ok) return;
  if (isPdfForm) { showPdfPreview(v.clean); return; }
  pv = docPreview(schema, v.clean, settings);
  const dlBtn = h('button.btn.primary', { type: 'button', onclick: () => doDownload(dlBtn, v.clean) }, icon('download', 16), 'تنزيل PDF');
  previewView.replaceChildren(
    h('div.pv-bar',
      h('button.btn', { type: 'button', onclick: showEdit }, icon('arrowRight', 16), 'العودة للتعديل'),
      h('span.small.muted.grow', 'A4 · راجعي النموذج قبل التنزيل'),
      h('button.btn', { type: 'button', title: 'يفتح نافذة الطباعة؛ اختاري «حفظ بتنسيق PDF» للحصول على ملف نصي قابل للبحث', onclick: () => pv.print() }, icon('print', 16), 'طباعة'),
      dlBtn),
    pv.el,
    h('div.banner.info', { style: { marginTop: '16px' } }, icon('info'), h('span.grow',
      'يُنشأ ملف PDF داخل متصفحك ولا تُرسل بياناتك أو توقيعك إلى أي خادم. بعد التنزيل أرسلي الملف إلى الإدارة بالطريقة المعتمدة في المدرسة.')));
  editView.hidden = true; bar.hidden = true; previewView.hidden = false;
  window.scrollTo({ top: 0 });
}
async function showPdfPreview(clean) {
  const area = h('div', h('div.pdft-pages', h('p.muted', { style: { padding: '40px', textAlign: 'center' } }, 'جارٍ تجهيز المعاينة…')));
  const dlBtn = h('button.btn.primary', { type: 'button', onclick: () => doPdfDownload(dlBtn, clean) }, icon('download', 16), 'تنزيل PDF');
  const openBtn = h('button.btn', { type: 'button', title: 'يفتح الملف في نافذة جديدة للطباعة', onclick: () => doPdfOpen(openBtn, clean) }, icon('print', 16), 'فتح للطباعة');
  previewView.replaceChildren(
    h('div.pv-bar',
      h('button.btn', { type: 'button', onclick: showEdit }, icon('arrowRight', 16), 'العودة للتعديل'),
      h('span.small.muted.grow', 'راجعي النموذج قبل التنزيل — نفس تصميم الملف الأصلي'),
      openBtn, dlBtn),
    area,
    h('div.banner.info', { style: { marginTop: '16px' } }, icon('info'), h('span.grow',
      'يُنشأ ملف PDF داخل متصفحك ولا تُرسل بياناتك أو توقيعك إلى أي خادم. بعد التنزيل أرسلي الملف إلى الإدارة بالطريقة المعتمدة في المدرسة.')));
  editView.hidden = true; bar.hidden = true; previewView.hidden = false;
  window.scrollTo({ top: 0 });
  try {
    const { m, bytes } = await loadTemplate();
    const width = Math.min(794, Math.max(300, area.clientWidth - 28));
    area.replaceChildren(await m.filledPreview(bytes, schema, clean, { width }));
  } catch (e) {
    console.error(e);
    area.replaceChildren(h('div.banner.err', icon('alert'), h('span.grow', `${errText(e)} — تعذر عرض المعاينة. يمكنك تجربة «تنزيل PDF» مباشرة أو تحديث الصفحة.`)));
  }
}

async function makePdfBlob(clean) {
  const { m, bytes } = await loadTemplate();
  const out = await m.buildFilledPdf(bytes, schema, clean, { title: form.title });
  return { m, blob: new Blob([out], { type: 'application/pdf' }) };
}
async function doPdfDownload(btn, clean) {
  if (busy) return;
  busy = true; btn.classList.add('loading');
  try {
    const { m, blob } = await makePdfBlob(clean);
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: m.pdfFileName(form.title) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast('تم تنزيل ملف PDF');
  } catch (e) {
    console.error(e);
    toast(`تعذر إنشاء الملف: ${errText(e)}`, 'err', 8000);
  } finally { busy = false; btn.classList.remove('loading'); }
}
async function doPdfOpen(btn, clean) {
  if (busy) return;
  const win = window.open('', '_blank');
  win?.document.write('<p style="font-family:sans-serif;padding:24px" dir="rtl">جارٍ إنشاء ملف PDF…</p>');
  busy = true; btn.classList.add('loading');
  try {
    const { blob } = await makePdfBlob(clean);
    const url = URL.createObjectURL(blob);
    if (win) win.location = url; else location.href = url;
  } catch (e) {
    win?.close();
    toast(`تعذر إنشاء الملف: ${errText(e)}`, 'err', 8000);
  } finally { busy = false; btn.classList.remove('loading'); }
}

function showEdit() { previewView.hidden = true; editView.hidden = false; bar.hidden = false; window.scrollTo({ top: 0 }); }

let busy = false;
async function doDownload(btn, clean) {
  if (busy) return;
  busy = true; btn.classList.add('loading');
  const label = btn.lastChild; const orig = label.textContent;
  try {
    await downloadPdf(schema, clean, settings, form.title, { onProgress: (i, n) => { label.textContent = n > 1 ? `جارٍ الإنشاء ${i}/${n}` : 'جارٍ الإنشاء…'; } });
    toast('تم تنزيل ملف PDF');
  } catch (e) {
    console.error(e);
    toast('تعذر إنشاء الملف على هذا المتصفح. جرّبي زر «طباعة» ثم «حفظ بتنسيق PDF»، أو متصفحًا آخر.', 'err', 8000);
  } finally { busy = false; btn.classList.remove('loading'); label.textContent = orig; }
}

// ---------- action bar ----------
const bar = h('div.actionbar', h('div.actionbar-in',
  h('button.btn.primary', { type: 'button', onclick: showPreview }, icon('eye', 16), 'معاينة وتنزيل PDF'),
  h('button.btn', { type: 'button', onclick: saveDraft }, icon('save', 16), 'حفظ كمسودة'),
  statusEl));
document.getElementById('app').insertBefore(bar, document.querySelector('.site-foot'));

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[href]');
  if (!a || !dirty || a.target || a.hasAttribute('download') || a.href.startsWith('blob:')) return;
  e.preventDefault();
  if (await confirmDialog('تغييرات غير محفوظة', 'لديك تغييرات غير محفوظة. هل تريدين المغادرة وفقدانها؟\n(يمكنك حفظها كمسودة أولًا)', { okLabel: 'مغادرة', danger: true })) {
    dirty = false; location.href = a.href;
  }
});
buildEdit();
