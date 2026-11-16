// Admin: forms built on an uploaded PDF. Upload → automatic detection → review on the page
// (move, resize, add, delete fields) → save / publish. The original PDF is kept as it is.
import { h, icon, toast, modal, confirmDialog, ICON_NAMES, downloadBlob } from './common.js';
import { FIELD_TYPES, PDF_FIELD_TYPES, allFields, validateSchema, validate, DAYS } from '../shared/core.js';
import {
  openPdf, pageInfos, renderPage, filledPreview, buildFilledPdf, looksLikePdf, checkWritable,
  rememberBytes, pdfFileName, fieldCanvas, DEFAULT_COLOR,
} from './pdf-template.js';
import { detectFields } from './pdf-detect.js';
import { renderForm, initialData } from './form-ui.js';
import * as fb from './fb.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const rid = () => 'f' + Math.random().toString(36).slice(2, 8);
const r1 = (v) => Math.round(v * 10) / 10;
const TYPE_LABEL = (t) => FIELD_TYPES[t]?.label || t;
const MIN = 4; // smallest box (points)

// ---------------------------------------------------------------- file picking & analysis
/** Lets the owner choose a PDF; resolves { bytes, name } or null. */
export function pickPdfFile() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; inp.remove();
      if (!f) return resolve(null);
      resolve({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
    });
    document.body.append(inp); inp.click();
    window.addEventListener('focus', () => setTimeout(() => { if (inp.isConnected && !inp.files.length) { inp.remove(); resolve(null); } }, 1500), { once: true });
  });
}

/** Checks a chosen file and opens it. Throws Arabic messages. */
export async function preparePdf(bytes) {
  if (!bytes?.length) throw new Error('الملف فارغ');
  if (!looksLikePdf(bytes)) throw new Error('الملف ليس بصيغة PDF');
  if (bytes.length > fb.MAX_PDF_BYTES) throw new Error(`حجم الملف ${(bytes.length / 1048576).toFixed(1)} م.ب، والحد الأقصى ١٠ م.ب. اضغطي الملف (مثلًا بموقع لضغط PDF أو بحفظه بجودة أقل) ثم أعيدي المحاولة.`);
  await checkWritable(bytes);
  const doc = await openPdf(bytes);
  const pages = await pageInfos(doc);
  return { doc, pages };
}

/** Upload screen for a new PDF form. Calls onReady({ form, bytes }) once the file is analysed. */
export function pdfUploadScreen({ onReady }) {
  const status = h('div', { 'aria-live': 'polite' });
  const drop = h('div.drop', { role: 'button', tabindex: '0', 'aria-label': 'اختيار ملف PDF' },
    h('div.badge-ic', icon('file', 28)),
    h('b', 'اسحبي ملف PDF هنا أو اضغطي للاختيار'),
    h('div.small.muted', 'نموذج جاهز (من Word أو ممسوح ضوئيًا) — حتى ١٠ ميجابايت'));
  let busy = false;
  const run = async (file) => {
    if (busy || !file) return;
    busy = true; drop.classList.add('over');
    const say = (t) => status.replaceChildren(h('div.banner.info', h('span.btn.ghost.loading', { style: { minHeight: 0, padding: 0 } }), h('span.grow', t)));
    try {
      say('جارٍ فحص الملف…');
      const { doc, pages } = await preparePdf(file.bytes);
      say('جارٍ اكتشاف الحقول تلقائيًا…');
      const det = await detectFields(doc, { onProgress: (i, n) => say(`جارٍ تحليل الصفحة ${i} من ${n}…`) });
      doc.destroy();
      const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 120) || 'نموذج PDF';
      onReady({
        bytes: file.bytes,
        detection: det,
        form: {
          title, slug: '', description: '', tags: [], icon: 'file', status: 'draft',
          schema: {
            mode: 'pdf', submitterField: '',
            pdfTemplate: { fileId: '', name: file.name.slice(0, 200), size: file.bytes.length, pages, color: DEFAULT_COLOR, hasForm: det.method === 'acroform' },
            sections: [{ id: 's1', title: 'بيانات النموذج', columns: 2, fields: det.fields }],
          },
        },
      });
    } catch (e) {
      console.error(e);
      status.replaceChildren(h('div.banner.err', icon('alert'), h('span.grow', e.message || 'تعذر قراءة الملف')));
    } finally { busy = false; drop.classList.remove('over'); }
  };
  const choose = async () => run(await pickPdfFile());
  drop.addEventListener('click', choose);
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) run({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
  });
  return h('div',
    h('div.page-head', h('h1', 'نموذج جديد من ملف PDF'), h('div.acts', h('a.btn', { href: '#/forms' }, icon('arrowRight', 16), 'العودة'))),
    h('div.steps', ['١. رفع الملف', '٢. اكتشاف الحقول تلقائيًا', '٣. مراجعة الحقول وتعديلها', '٤. الحفظ والنشر'].map((t, i) => h('span' + (i === 0 ? '.on' : ''), t))),
    h('div.card.panel', drop, status),
    h('div.card.panel', h('h2', 'كيف يعمل؟'),
      h('ul.small', { style: { margin: 0, paddingInlineStart: '18px', lineHeight: 1.9 } },
        h('li', 'يبقى تصميم الملف الأصلي كما هو تمامًا؛ تُكتب إجابات المعلمة فوق الأماكن الفارغة فقط.'),
        h('li', 'يكتشف الموقع تلقائيًا: الخانات الفارغة في الجداول، الخطوط المنقطة والسطور، المربعات (✓)، وحقول PDF التفاعلية إن وجدت.'),
        h('li', 'يمكنك بعد ذلك تحريك أي حقل أو تغيير حجمه أو حذفه أو إضافة حقول جديدة يدويًا.'),
        h('li', 'الملفات الممسوحة ضوئيًا (صور): تُكتشف المربعات والسطور غالبًا، لكن قد تحتاجين لكتابة أسماء الحقول بنفسك.'),
        h('li', 'يُحفظ الملف الفارغ في قاعدة بياناتك (Firebase). إجابات المعلمات لا تُحفظ إطلاقًا.'))));
}

// ---------------------------------------------------------------- designer
/**
 * @param form   { id?, title, slug, description, tags, icon, status, schema(mode:'pdf') }
 * @param bytes  original PDF (Uint8Array)
 * @param onSave async (payload) => saved form
 */
export async function buildPdfDesigner(form, { bytes, onSave, settings = () => ({}), detection = null }) {
  const st = clone(form);
  const tpl = st.schema.pdfTemplate;
  tpl.color ||= DEFAULT_COLOR;
  let fields = allFields(st.schema).map((f) => ({ ...f }));
  let doc = (await openPdf(bytes));
  let dirty = !form.id; // a new form is unsaved
  let oldFileId = '';
  let zoom = 1;
  let selId = null;
  let drawMode = false;
  let sample = false;
  let tab = 'design';
  let shown = false; // pages rendered once

  const root = h('div.pdd', { 'data-dirty': dirty ? '1' : '0' });
  const errBox = h('div');
  const body = h('div');
  const markDirty = () => { dirty = true; root.dataset.dirty = '1'; };

  const saveBtn = h('button.btn.primary', { type: 'button', onclick: () => save() }, icon('save', 16), h('span', 'حفظ النموذج'));
  const publishBtn = h('button.btn.primary', { type: 'button', hidden: st.status === 'published', onclick: () => save({ publish: true }) }, icon('send', 16), 'حفظ ونشر');
  const tabs = h('div.tabs', [['design', 'الحقول على الملف'], ['settings', 'الإعدادات العامة']].map(([k, t]) =>
    h('button', { type: 'button', 'data-k': k, onclick: () => { tab = k; paintTab(); } }, t)));

  root.append(
    h('div.page-head', h('h1', form.id ? 'تعديل نموذج PDF' : 'نموذج جديد من ملف PDF'), h('div.acts',
      h('a.btn', { href: '#/forms' }, icon('arrowRight', 16), 'العودة'),
      h('button.btn', { type: 'button', onclick: tryForm }, icon('eye', 16), 'تجربة النموذج'),
      saveBtn, publishBtn)),
    errBox, tabs, body);

  // ---------- design view ----------
  const pagesBox = h('div.pdd-pages');
  const scroller = h('div.pdd-scroll', pagesBox);
  const side = h('aside.pdd-side');
  const countEl = h('span.small.muted');
  const zoomLbl = h('span.pdd-zoom', '100%');
  const drawBtn = h('button.btn.sm', { type: 'button', 'aria-pressed': 'false', title: 'ارسمي مربعًا على الصفحة أو اضغطي في مكان الحقل', onclick: () => setDraw(!drawMode) }, icon('plus', 15), 'إضافة حقل');
  const sampleBtn = h('button.btn.sm', { type: 'button', 'aria-pressed': 'false', title: 'يكتب نصًا تجريبيًا داخل الحقول لمعاينة حجم الخط', onclick: () => { sample = !sample; sampleBtn.classList.toggle('soft', sample); sampleBtn.setAttribute('aria-pressed', String(sample)); paintAllBoxes(); } }, icon('eye', 15), 'نص تجريبي');
  const toolbar = h('div.pdd-bar',
    drawBtn,
    h('button.btn.sm', { type: 'button', onclick: autoDetect }, icon('wand', 15), 'اكتشاف تلقائي'),
    sampleBtn,
    h('span.pdd-sep'),
    h('button.icon-btn', { type: 'button', title: 'تصغير', 'aria-label': 'تصغير', onclick: () => setZoom(zoom / 1.2) }, icon('minus')),
    zoomLbl,
    h('button.icon-btn', { type: 'button', title: 'تكبير', 'aria-label': 'تكبير', onclick: () => setZoom(zoom * 1.2) }, icon('plus')),
    h('button.btn.sm.ghost', { type: 'button', onclick: () => setZoom(fitZoom()) }, 'ملاءمة العرض'),
    h('span.pdd-sep'),
    h('button.btn.sm.ghost', { type: 'button', onclick: replaceFile }, icon('refresh', 15), 'استبدال ملف PDF'),
    h('button.btn.sm.ghost.danger-text', { type: 'button', onclick: async () => {
      if (!fields.length) return;
      if (!await confirmDialog('حذف جميع الحقول', `سيتم حذف ${fields.length} حقل من الملف. يمكنك بعدها إضافتها يدويًا أو بالاكتشاف التلقائي.`, { okLabel: 'حذف الكل', danger: true })) return;
      fields = []; selId = null; markDirty(); paintAllBoxes(); paintSide();
    } }, icon('trash', 15), 'حذف الكل'),
    h('span.grow'), countEl);
  const design = h('div.pdd-design', toolbar, h('div.pdd-main', side, scroller));

  const pageEls = []; // { wrap, canvas, layer }
  function buildPages() {
    pagesBox.replaceChildren();
    pageEls.length = 0;
    tpl.pages.forEach((pg, p) => {
      const canvas = h('canvas.pdd-canvas');
      const layer = h('div.pdd-layer', { 'data-p': p });
      const wrap = h('div.pdd-page', { 'data-p': p }, canvas, layer, h('div.pdd-pno', `الصفحة ${p + 1} من ${tpl.pages.length}`));
      pageEls.push({ wrap, canvas, layer });
      pagesBox.append(wrap);
      layer.addEventListener('pointerdown', (e) => onPointerDown(e, p));
    });
  }

  let renderGen = 0;
  async function renderPages() {
    const gen = ++renderGen;
    tpl.pages.forEach((pg, p) => {
      const el = pageEls[p];
      el.wrap.style.width = `${pg.w * zoom}px`; el.wrap.style.height = `${pg.h * zoom}px`;
    });
    paintAllBoxes();
    for (let p = 0; p < tpl.pages.length; p++) {
      if (gen !== renderGen) return;
      try {
        const tmp = document.createElement('canvas');
        await renderPage(doc, p, zoom, { canvas: tmp });
        if (gen !== renderGen) return;
        const el = pageEls[p];
        el.canvas.replaceWith(tmp); tmp.className = 'pdd-canvas'; el.canvas = tmp;
      } catch (e) { console.error(e); }
    }
  }
  const fitZoom = () => {
    const avail = Math.max(280, scroller.clientWidth - 28);
    const maxW = Math.max(...tpl.pages.map((p) => p.w));
    return Math.max(0.3, Math.min(2.2, avail / maxW));
  };
  let zoomT;
  function setZoom(z) {
    zoom = Math.max(0.3, Math.min(4, z));
    zoomLbl.textContent = `${Math.round(zoom * 100)}%`;
    tpl.pages.forEach((pg, p) => { const el = pageEls[p]; el.wrap.style.width = `${pg.w * zoom}px`; el.wrap.style.height = `${pg.h * zoom}px`; el.canvas.style.width = '100%'; el.canvas.style.height = '100%'; });
    paintAllBoxes();
    clearTimeout(zoomT); zoomT = setTimeout(renderPages, 180);
  }

  function setDraw(on) {
    drawMode = on;
    drawBtn.classList.toggle('primary', on);
    drawBtn.setAttribute('aria-pressed', String(on));
    root.classList.toggle('drawing', on);
    if (on) toast('ارسمي مربعًا على الصفحة بالسحب، أو اضغطي في مكان الحقل. اضغطي Esc أو الزر مرة أخرى للإنهاء.', 'info', 4500);
  }

  // ---------- boxes ----------
  const byId = (id) => fields.find((f) => f.id === id);
  let sampleT;
  function boxEl(f) {
    const el = h('div.pdd-box.t-' + f.type + (f.id === selId ? '.sel' : ''), { 'data-id': f.id, title: `${f.label} — ${TYPE_LABEL(f.type)}` },
      h('span.pdd-lab', f.label || '؟'));
    if (f.required) el.classList.add('req');
    if (f.id === selId) for (const k of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) el.append(h('span.pdd-h.h-' + k, { 'data-h': k }));
    place(el, f);
    if (sample) paintSample(el, f);
    return el;
  }
  function place(el, f) {
    Object.assign(el.style, { left: `${f.box.x * zoom}px`, top: `${f.box.y * zoom}px`, width: `${f.box.w * zoom}px`, height: `${f.box.h * zoom}px` });
  }
  const sigSample = (() => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 80;
    const x = c.getContext('2d'); x.lineWidth = 3; x.strokeStyle = '#1b1d5c'; x.lineCap = 'round';
    x.beginPath(); x.moveTo(14, 56); x.bezierCurveTo(60, -10, 90, 100, 140, 30); x.bezierCurveTo(160, 10, 190, 70, 228, 40); x.stroke();
    return c.toDataURL('image/png');
  })();
  function sampleData(f) {
    switch (f.type) {
      case 'tick': return { [f.id]: true };
      case 'signature': return { [f.id]: sigSample };
      case 'date': return { [f.id]: new Date().toISOString().slice(0, 10) };
      case 'day': return { [f.id]: DAYS[0] };
      case 'number': return { [f.id]: '1234' };
      case 'select': return { [f.id]: f.options?.[0] || 'خيار' };
      case 'textarea': return { [f.id]: `${f.label || 'نص'} — نص تجريبي أطول لمعاينة حجم الخط وتوزيع الأسطر داخل الحقل.` };
      default: return { [f.id]: f.default || f.label || 'نص تجريبي' };
    }
  }
  async function paintSample(el, f) {
    try {
      const c = await fieldCanvas({ ...f, type: f.type === 'day' || f.type === 'select' ? 'text' : f.type }, sampleData(f), { color: tpl.color, scale: Math.min(4, zoom * 2) });
      if (c && el.isConnected) { el.style.backgroundImage = `url(${c.toDataURL('image/png')})`; el.classList.add('sample'); }
    } catch { /* ignore */ }
  }
  function paintAllBoxes() {
    pageEls.forEach(({ layer }, p) => layer.replaceChildren(...fields.filter((f) => f.box.p === p).map(boxEl)));
    countEl.textContent = `${fields.length} حقل`;
  }
  function repaintBox(f) {
    const old = pagesBox.querySelector(`.pdd-box[data-id="${CSS.escape(f.id)}"]`);
    const nel = boxEl(f);
    if (old && old.parentElement === pageEls[f.box.p]?.layer) old.replaceWith(nel);
    else { old?.remove(); pageEls[f.box.p]?.layer.append(nel); }
    countEl.textContent = `${fields.length} حقل`;
  }
  function select(id, { scroll = false } = {}) {
    const prev = selId; selId = id;
    if (prev && byId(prev)) repaintBox(byId(prev));
    if (id && byId(id)) {
      repaintBox(byId(id));
      if (scroll) pagesBox.querySelector(`.pdd-box[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }
    paintSide();
  }
  const clampBox = (b) => {
    const pg = tpl.pages[b.p];
    b.w = Math.max(MIN, Math.min(b.w, pg.w)); b.h = Math.max(MIN, Math.min(b.h, pg.h));
    b.x = Math.max(0, Math.min(b.x, pg.w - b.w)); b.y = Math.max(0, Math.min(b.y, pg.h - b.h));
    for (const k of ['x', 'y', 'w', 'h']) b[k] = r1(b[k]);
    return b;
  };

  // ---------- pointer: move / resize / draw ----------
  let drag = null;
  function onPointerDown(e, p) {
    if (e.button > 0) return;
    const layer = pageEls[p].layer;
    const rect = layer.getBoundingClientRect();
    const pt = { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
    const handle = e.target.closest('.pdd-h');
    const box = e.target.closest('.pdd-box');
    if (handle && box) {
      const f = byId(box.dataset.id);
      drag = { kind: 'resize', f, h: handle.dataset.h, start: { ...f.box }, pt, rect };
    } else if (box && !drawMode) {
      const f = byId(box.dataset.id);
      if (selId !== f.id) select(f.id);
      drag = { kind: 'move', f, start: { ...f.box }, pt, rect, moved: false };
    } else if (drawMode) {
      const ghost = h('div.pdd-box.ghost');
      layer.append(ghost);
      drag = { kind: 'draw', p, pt, rect, ghost };
    } else {
      if (selId) select(null);
      return; // let the page scroll (touch)
    }
    e.preventDefault();
    layer.setPointerCapture?.(e.pointerId);
    const move = (ev) => onPointerMove(ev);
    const up = (ev) => { layer.removeEventListener('pointermove', move); layer.removeEventListener('pointerup', up); layer.removeEventListener('pointercancel', up); onPointerUp(ev); };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
  }
  function onPointerMove(e) {
    if (!drag) return;
    const pt = { x: (e.clientX - drag.rect.left) / zoom, y: (e.clientY - drag.rect.top) / zoom };
    const dx = pt.x - drag.pt.x; const dy = pt.y - drag.pt.y;
    if (drag.kind === 'move') {
      if (!drag.moved && Math.hypot(dx, dy) * zoom < 3) return;
      drag.moved = true;
      Object.assign(drag.f.box, clampBox({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }));
      const el = pagesBox.querySelector(`.pdd-box[data-id="${CSS.escape(drag.f.id)}"]`); if (el) place(el, drag.f);
    } else if (drag.kind === 'resize') {
      const s = drag.start; const b = { ...s }; const k = drag.h;
      if (k.includes('e')) b.w = s.w + dx;
      if (k.includes('s')) b.h = s.h + dy;
      if (k.includes('w')) { b.x = s.x + dx; b.w = s.w - dx; }
      if (k.includes('n')) { b.y = s.y + dy; b.h = s.h - dy; }
      if (b.w < MIN) { if (k.includes('w')) b.x = s.x + s.w - MIN; b.w = MIN; }
      if (b.h < MIN) { if (k.includes('n')) b.y = s.y + s.h - MIN; b.h = MIN; }
      Object.assign(drag.f.box, clampBox(b));
      const el = pagesBox.querySelector(`.pdd-box[data-id="${CSS.escape(drag.f.id)}"]`); if (el) place(el, drag.f);
    } else if (drag.kind === 'draw') {
      const x = Math.min(pt.x, drag.pt.x); const y = Math.min(pt.y, drag.pt.y);
      drag.cur = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
      Object.assign(drag.ghost.style, { left: `${x * zoom}px`, top: `${y * zoom}px`, width: `${drag.cur.w * zoom}px`, height: `${drag.cur.h * zoom}px` });
    }
  }
  function onPointerUp() {
    const d = drag; drag = null;
    if (!d) return;
    if (d.kind === 'move' || d.kind === 'resize') {
      if (d.kind === 'resize' || d.moved) { markDirty(); repaintBox(d.f); paintSide(); }
      return;
    }
    d.ghost.remove();
    let b = d.cur && d.cur.w >= 6 && d.cur.h >= 5 ? { p: d.p, ...d.cur } : { p: d.p, x: d.pt.x - 60, y: d.pt.y - 9, w: 120, h: 18 };
    b = clampBox(b);
    const small = b.w <= 22 && b.h <= 22 && b.w / b.h > 0.7 && b.w / b.h < 1.43;
    const f = { id: uniqueId(), type: small ? 'tick' : b.h >= 34 && b.w >= 100 ? 'textarea' : 'text', label: `حقل ${fields.length + 1}`, box: b };
    fields.push(f); markDirty();
    select(f.id);
    setTimeout(() => side.querySelector('input[data-k="label"]')?.select(), 30);
  }
  const uniqueId = () => { let id; do id = rid(); while (byId(id)); return id; };

  // ---------- keyboard ----------
  function onKey(e) {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (tab !== 'design' || document.querySelector('.modal-back')) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === 'Escape') { if (drawMode) setDraw(false); else if (selId) select(null); return; }
    if (typing) return;
    const f = selId && byId(selId);
    if (!f) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeField(f); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(f); return; }
    const step = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); f.box.x += mv[0]; f.box.y += mv[1]; clampBox(f.box); markDirty(); repaintBox(f); paintPos(); }
  }
  document.addEventListener('keydown', onKey);

  function removeField(f) {
    fields = fields.filter((x) => x !== f);
    if (st.schema.submitterField === f.id) st.schema.submitterField = '';
    selId = null; markDirty();
    pagesBox.querySelector(`.pdd-box[data-id="${CSS.escape(f.id)}"]`)?.remove();
    countEl.textContent = `${fields.length} حقل`;
    paintSide();
  }
  function duplicate(f) {
    const c = clone(f); c.id = uniqueId(); c.label = `${f.label} (نسخة)`;
    c.box.y = f.box.y + f.box.h + 4; clampBox(c.box);
    fields.push(c); markDirty(); select(c.id);
  }

  // ---------- side panel ----------
  let paintPos = () => {};
  function paintSide() {
    const f = selId && byId(selId);
    if (!f) { paintList(); return; }
    const inp = (k, attrs = {}, { num = false, onChange } = {}) => h('input.inp', {
      value: f[k] ?? '', 'data-k': k, ...attrs,
      oninput: (e) => {
        const v = e.target.value;
        if (num) { if (v === '') delete f[k]; else f[k] = Number(v); } else f[k] = v;
        markDirty(); onChange?.();
      },
    });
    const lab = (t, el, cls = '') => h('div.fg' + cls, h('label', t), el);
    const selEl = (k, opts, { onChange, def } = {}) => {
      const s = h('select.inp', { onchange: (e) => { const v = e.target.value; if (v === '') delete f[k]; else f[k] = /^\d+$/.test(v) ? Number(v) : v; markDirty(); onChange?.(); } },
        opts.map(([v, t]) => h('option', { value: String(v) }, t)));
      s.value = f[k] == null ? (def ?? '') : String(f[k]);
      return s;
    };
    const chk = (k, t, onChange) => h('label.chk', h('input', { type: 'checkbox', checked: !!f[k], onchange: (e) => { if (e.target.checked) f[k] = true; else delete f[k]; markDirty(); onChange?.(); } }), t);
    const refresh = () => repaintBox(f);

    const typeSel = selEl('type', PDF_FIELD_TYPES.map((t) => [t, TYPE_LABEL(t)]), { onChange: () => {
      if (f.type === 'select' && !(f.options || []).length) f.options = ['الخيار الأول', 'الخيار الثاني'];
      refresh(); paintSide();
    } });
    const textual = !['tick', 'signature'].includes(f.type);
    const posIn = (k) => h('input.inp', { type: 'number', step: '0.5', value: f.box[k], 'aria-label': k, oninput: (e) => {
      const v = Number(e.target.value); if (!Number.isFinite(v)) return;
      f.box[k] = v; clampBox(f.box); markDirty(); refresh();
    } });
    const pos = h('div.pdd-pos');
    paintPos = () => pos.replaceChildren(
      lab('من اليسار', posIn('x')), lab('من الأعلى', posIn('y')), lab('العرض', posIn('w')), lab('الارتفاع', posIn('h')));
    paintPos();

    side.replaceChildren(
      h('div.pdd-side-head', h('b', 'خصائص الحقل'), h('span.pill.gray', `الصفحة ${f.box.p + 1}`),
        h('button.icon-btn', { type: 'button', title: 'إغلاق', 'aria-label': 'إغلاق', onclick: () => select(null) }, icon('x'))),
      lab('عنوان الحقل (يظهر للمعلمة) *', inp('label', { maxLength: 120 }, { onChange: () => { const el = pagesBox.querySelector(`.pdd-box[data-id="${CSS.escape(f.id)}"] .pdd-lab`); if (el) el.textContent = f.label || '؟'; if (sample) { clearTimeout(sampleT); sampleT = setTimeout(refresh, 300); } } })),
      lab('نوع الحقل', typeSel),
      f.type === 'select' ? lab('الخيارات (خيار في كل سطر)', h('textarea.inp', { rows: 4, value: (f.options || []).join('\n'), oninput: (e) => { f.options = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markDirty(); } })) : null,
      f.type === 'date' ? lab('شكل التاريخ في الملف', selEl('dateStyle', [['hijri', 'هجري: 05/06/1448 هـ'], ['greg', 'ميلادي: 16/11/2026 م'], ['both', 'هجري وميلادي معًا']], { def: 'hijri', onChange: refresh })) : null,
      ['text', 'textarea', 'number'].includes(f.type) ? lab('قيمة مكتوبة مسبقًا (اختياري)', inp('default', { maxLength: 300, placeholder: 'تستطيع المعلمة تعديلها' })) : null,
      lab('تلميح للمعلمة (اختياري)', inp('help', { maxLength: 200 })),
      h('div.pdd-checks', chk('required', 'حقل مطلوب', refresh), textual ? chk('bold', 'خط عريض', refresh) : null),
      textual ? h('div.pdd-two',
        lab('حجم الخط', selEl('fontSize', [['', 'تلقائي (يناسب المربع)'], ...[7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24].map((n) => [n, `${n}`])], { onChange: refresh })),
        lab('المحاذاة', selEl('align', [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']], { def: 'right', onChange: refresh }))) : null,
      f.type === 'signature' ? lab('موضع التوقيع', selEl('align', [['center', 'وسط'], ['right', 'يمين'], ['left', 'يسار']], { def: 'center', onChange: refresh })) : null,
      f.type === 'textarea' ? lab('عدد الأسطر المسطّرة في الملف (اختياري)', inp('rules', { type: 'number', min: 0, max: 60, placeholder: '0 = بدون' }, { num: true, onChange: refresh })) : null,
      h('details.pdd-adv', h('summary', 'الموضع الدقيق والمعرّف'),
        h('p.small.muted', { style: { margin: '6px 0' } }, 'بالنقاط (1 نقطة = 0.35 مم). يمكنك أيضًا تحريك الحقل بالأسهم في لوحة المفاتيح (Shift للخطوة الأكبر).'),
        pos,
        lab('المعرّف (إنجليزي، فريد)', inp('id', { dir: 'ltr', maxLength: 40, onchange: (e) => {
          const v = e.target.value.trim();
          if (!/^[A-Za-z][\w-]{0,40}$/.test(v) || fields.some((x) => x !== f && x.id === v)) { toast('معرّف غير صالح أو مكرر', 'err'); e.target.value = selId; f.id = selId; return; }
          if (st.schema.submitterField === selId) st.schema.submitterField = v;
          pagesBox.querySelector(`.pdd-box[data-id="${CSS.escape(selId)}"]`)?.setAttribute('data-id', v);
          selId = v; f.id = v; markDirty();
        } }))),
      h('div.pdd-acts',
        h('button.btn.sm', { type: 'button', onclick: () => duplicate(f) }, icon('copy', 15), 'تكرار'),
        h('button.btn.sm.danger', { type: 'button', onclick: () => removeField(f) }, icon('trash', 15), 'حذف الحقل')));
  }

  function paintList() {
    const sorted = sortFields(fields);
    side.replaceChildren(
      h('div.pdd-side-head', h('b', 'الحقول'), h('span.pill', String(fields.length))),
      h('div.pdd-help.small',
        h('div', icon('info', 15), h('span', 'اضغطي على أي مربع لتعديله. اسحبيه لتحريكه، واسحبي النقاط على أطرافه لتغيير حجمه.')),
        h('div', icon('plus', 15), h('span', 'لإضافة حقل: «إضافة حقل» ثم ارسمي مربعًا في المكان الفارغ.')),
        h('div', icon('trash', 15), h('span', 'للحذف: اختاري المربع ثم زر الحذف (أو مفتاح Delete).'))),
      fields.length ? h('div.pdd-list', sorted.map((f) => h('button.pdd-item', { type: 'button', onclick: () => select(f.id, { scroll: true }) },
        h('span.pdd-dot.t-' + f.type), h('span.grow', f.label || '؟'), h('span.small.muted', `صفحة ${f.box.p + 1}`))))
        : h('div.empty.small', 'لا توجد حقول بعد. استخدمي «اكتشاف تلقائي» أو «إضافة حقل».'));
  }

  // ---------- auto detection ----------
  async function autoDetect(e) {
    const b = e.currentTarget; b.classList.add('loading');
    let det;
    try { det = await detectFields(doc, { onProgress: (i, n) => { b.lastChild.textContent = `جارٍ التحليل ${i}/${n}`; } }); } catch (err) { console.error(err); toast('تعذر التحليل التلقائي لهذا الملف', 'err'); return; } finally { b.classList.remove('loading'); b.lastChild.textContent = 'اكتشاف تلقائي'; }
    if (!det.fields.length) { toast('لم يُعثر على أماكن فارغة واضحة. أضيفي الحقول يدويًا بزر «إضافة حقل».', 'info', 6000); return; }
    const apply = (mode) => {
      const incoming = det.fields.map((f) => ({ ...f, id: uniqueId() }));
      if (mode === 'replace') fields = incoming;
      else {
        const over = (a, c) => a.box.p === c.box.p && Math.max(0, Math.min(a.box.x + a.box.w, c.box.x + c.box.w) - Math.max(a.box.x, c.box.x)) * Math.max(0, Math.min(a.box.y + a.box.h, c.box.y + c.box.h) - Math.max(a.box.y, c.box.y)) > 0.3 * Math.min(a.box.w * a.box.h, c.box.w * c.box.h);
        const add = incoming.filter((f) => !fields.some((x) => over(x, f)));
        fields.push(...add);
        toast(`أُضيف ${add.length} حقل جديد`);
      }
      selId = null; markDirty(); paintAllBoxes(); paintSide();
    };
    if (!fields.length) { apply('replace'); toast(`تم اكتشاف ${det.fields.length} حقل`); return; }
    modal({
      title: 'نتيجة الاكتشاف التلقائي',
      body: h('p', `تم اكتشاف ${det.fields.length} حقل. ماذا تريدين أن تفعلي بالحقول الحالية (${fields.length})؟`),
      actions: [
        { label: 'إضافة الجديدة فقط', kind: 'primary', onClick: () => apply('add') },
        { label: 'استبدال جميع الحقول', kind: 'danger', onClick: () => apply('replace') },
        { label: 'إلغاء', kind: 'ghost' },
      ],
    });
  }

  // ---------- replace the PDF file ----------
  async function replaceFile() {
    const file = await pickPdfFile();
    if (!file) return;
    let prepared;
    try { prepared = await preparePdf(file.bytes); } catch (e) { toast(e.message, 'err', 7000); return; }
    const lost = fields.filter((f) => f.box.p >= prepared.pages.length);
    if (lost.length && !await confirmDialog('عدد الصفحات أقل', `الملف الجديد ${prepared.pages.length} صفحة، لذلك سيُحذف ${lost.length} حقل موجود في الصفحات الأخيرة. متابعة؟`, { okLabel: 'متابعة', danger: true })) { prepared.doc.destroy(); return; }
    fields = fields.filter((f) => f.box.p < prepared.pages.length);
    fields.forEach((f) => clampBoxTo(f.box, prepared.pages));
    doc.destroy(); doc = prepared.doc; bytes = file.bytes;
    if (tpl.fileId && !oldFileId) oldFileId = tpl.fileId;
    Object.assign(tpl, { fileId: '', name: file.name.slice(0, 200), size: file.bytes.length, pages: prepared.pages });
    markDirty(); selId = null; buildPages(); setZoom(fitZoom()); renderPages(); paintSide();
    toast('تم استبدال الملف مع الإبقاء على الحقول. يمكنك استخدام «اكتشاف تلقائي» لإضافة حقول جديدة.', 'ok', 6000);
  }
  function clampBoxTo(b, pages) { const pg = pages[b.p]; b.w = Math.min(b.w, pg.w); b.h = Math.min(b.h, pg.h); b.x = Math.max(0, Math.min(b.x, pg.w - b.w)); b.y = Math.max(0, Math.min(b.y, pg.h - b.h)); }

  // ---------- settings ----------
  function settingsTab() {
    const inp = (obj, k, attrs = {}) => h(attrs.rows ? 'textarea.inp' : 'input.inp', { value: obj[k] ?? '', ...attrs, oninput: (e) => { obj[k] = e.target.value; markDirty(); } });
    const lab = (t, el, cls = '') => h('div.fg' + cls, h('label', t), el);
    const sel = (obj, k, opts) => { const s = h('select.inp', { onchange: (e) => { obj[k] = e.target.value; markDirty(); } }, opts.map(([v, t]) => h('option', { value: v }, t))); s.value = obj[k] ?? ''; return s; };
    const textFields = sortFields(fields).filter((f) => f.type === 'text');
    const color = h('input', { type: 'color', value: tpl.color || DEFAULT_COLOR, oninput: (e) => { tpl.color = e.target.value; markDirty(); }, style: { width: '56px', height: '38px', border: '1px solid var(--line)', borderRadius: '8px', background: '#fff' } });
    return h('div',
      h('div.card.panel', h('h2', 'بيانات النموذج'),
        h('div.form-grid',
          lab('عنوان النموذج *', inp(st, 'title', { placeholder: 'مثال: نموذج زيارة صفية', maxLength: 200 }), '.full'),
          lab('وصف قصير يظهر في بطاقة النموذج', inp(st, 'description', { rows: 2, maxLength: 1000 }), '.full'),
          lab('الوسوم (افصلي بفاصلة)', h('input.inp', { value: (st.tags || []).join('، '), oninput: (e) => { st.tags = e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean); markDirty(); } })),
          lab('الرابط المختصر (حروف إنجليزية صغيرة وأرقام وشرطة)', inp(st, 'slug', { placeholder: 'class-visit', dir: 'ltr' })),
          lab('الأيقونة', sel(st, 'icon', ICON_NAMES.map((n) => [n, n]))),
          lab('الحالة', sel(st, 'status', [['draft', 'مسودة (غير ظاهر)'], ['published', 'منشور للمعلمات'], ['inactive', 'موقوف']])),
          lab('الحقل الذي يحدد اسم المعلمة (يظهر في قائمة المسودات)', sel(st.schema, 'submitterField', [['', '— تلقائي —'], ...textFields.map((f) => [f.id, f.label])]), '.full'))),
      h('div.card.panel', h('h2', 'الملف الأصلي'),
        h('dl.kv', h('dt', 'اسم الملف'), h('dd', tpl.name || '—'), h('dt', 'الحجم'), h('dd', `${(tpl.size / 1024).toFixed(0)} ك.ب`), h('dt', 'عدد الصفحات'), h('dd', String(tpl.pages.length))),
        h('div.form-grid', { style: { marginTop: '12px' } },
          lab('لون النص الذي يُكتب على الملف', h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, color, h('span.small.muted', 'الافتراضي: كحلي داكن'))))));
  }

  // ---------- try the form ----------
  function currentSchema() {
    const sorted = sortFields(fields);
    const pages = [...new Set(sorted.map((f) => f.box.p))].sort((a, b) => a - b);
    const one = pages.length <= 1;
    const sections = (pages.length ? pages : [0]).map((p) => ({
      id: `p${p + 1}`, title: one ? 'بيانات النموذج' : `الصفحة ${p + 1}`, columns: 2,
      fields: sorted.filter((f) => f.box.p === p).map((f) => ({ ...f, width: ['textarea', 'signature'].includes(f.type) ? 'full' : 'half' })),
    }));
    return { ...st.schema, mode: 'pdf', pdfTemplate: { ...tpl }, sections };
  }
  function tryForm() {
    const schema = { ...currentSchema(), title: st.title };
    if (!fields.length) { toast('أضيفي حقلًا واحدًا على الأقل', 'err'); return; }
    const data = initialData(schema);
    const ui = renderForm(schema, data, () => {});
    modal({
      title: `تجربة: ${st.title || 'نموذج'}`, wide: true,
      body: h('div', h('p.small.muted', 'هذه تجربة فقط — لا يُحفظ أي شيء. عبّئي بعض الحقول ثم اختاري المعاينة أو التنزيل.'), ui.el),
      actions: [
        { label: 'معاينة على الملف', kind: 'primary', icon: 'eye', keepOpen: true, onClick: async (e) => {
          const b = e.currentTarget; b.classList.add('loading');
          try {
            const clean = validate(schema, data, { requireAll: false }).clean;
            const pv = await filledPreview(bytes, schema, clean, { width: 794 });
            modal({ title: 'معاينة الملف بعد التعبئة', wide: true, body: pv });
          } catch (err) { console.error(err); toast(err.message, 'err'); } finally { b.classList.remove('loading'); }
        } },
        { label: 'تنزيل PDF تجريبي', icon: 'download', keepOpen: true, onClick: async (e) => {
          const b = e.currentTarget; b.classList.add('loading');
          try {
            const out = await buildFilledPdf(bytes, schema, validate(schema, data, { requireAll: false }).clean, { title: st.title });
            downloadBlob(new Blob([out], { type: 'application/pdf' }), pdfFileName(`${st.title || 'نموذج'} (تجربة)`));
          } catch (err) { console.error(err); toast(err.message, 'err'); } finally { b.classList.remove('loading'); }
        } },
        { label: 'إغلاق', kind: 'ghost' },
      ],
    });
  }

  // ---------- save ----------
  function showErrors(errs) {
    errBox.replaceChildren(errs.length ? h('div.banner.err', icon('alert'), h('div.grow', h('b', 'يرجى تصحيح ما يلي:'), h('ul', { style: { margin: '4px 0 0', paddingInlineStart: '18px' } }, errs.slice(0, 12).map((e) => h('li', e))))) : '');
    if (errs.length) errBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function save({ publish = false } = {}) {
    const errs = [];
    if (!String(st.title || '').trim()) errs.push('عنوان النموذج مطلوب (في تبويب الإعدادات العامة)');
    if (!fields.length) errs.push('أضيفي حقلًا واحدًا على الأقل على الملف');
    const ids = new Set();
    for (const f of fields) {
      f.label = String(f.label || '').trim();
      if (!f.label) errs.push(`يوجد حقل بلا عنوان في الصفحة ${f.box.p + 1}`);
      if (!/^[A-Za-z][\w-]{0,40}$/.test(f.id) || ids.has(f.id)) f.id = uniqueId();
      ids.add(f.id);
      if (f.type === 'select' && !(f.options || []).length) errs.push(`الحقل «${f.label}» يحتاج خيارات`);
    }
    if (errs.length) { showErrors(errs); return; }
    saveBtn.classList.add('loading'); publishBtn.disabled = true;
    const lbl = saveBtn.querySelector('span');
    try {
      if (!tpl.fileId) {
        lbl.textContent = 'جارٍ رفع الملف…';
        try {
          tpl.fileId = await fb.adminSavePdfFile(bytes, { name: tpl.name, onProgress: (i, n) => { lbl.textContent = `جارٍ رفع الملف ${Math.round((i / n) * 100)}%`; } });
        } catch (e) {
          if (String(e?.code || '').includes('permission-denied')) throw new Error('رفض Firebase حفظ ملف PDF. حدّثي قواعد الأمان (firestore.rules) في Firebase كما في دليل التحديث، ثم أعيدي المحاولة.');
          throw e;
        }
        rememberBytes(tpl.fileId, bytes);
      }
      lbl.textContent = 'جارٍ الحفظ…';
      const schema = currentSchema();
      const vErrs = validateSchema(schema);
      if (vErrs.length) { showErrors(vErrs); return; }
      const status = publish ? 'published' : st.status;
      const saved = await onSave({ title: st.title, slug: st.slug, description: st.description, tags: st.tags, icon: st.icon, status, schema });
      Object.assign(st, { id: saved.id, slug: saved.slug, status: saved.status });
      fields = allFields(saved.schema).map((f) => ({ ...f }));
      dirty = false; root.dataset.dirty = '0'; showErrors([]);
      publishBtn.hidden = st.status === 'published';
      if (publish) toast('تم النشر — أصبح النموذج متاحًا للمعلمات');
      if (oldFileId && oldFileId !== tpl.fileId) { const old = oldFileId; oldFileId = ''; fb.adminCleanupPdfFile(old).catch((e) => console.warn(e)); }
      paintAllBoxes(); paintSide();
      if (tab === 'settings') paintTab();
    } catch (e) {
      console.error(e);
      showErrors([fb.errText(e)]);
    } finally { saveBtn.classList.remove('loading'); publishBtn.disabled = false; lbl.textContent = 'حفظ النموذج'; }
  }

  // ---------- mount ----------
  function paintTab() {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === tab));
    body.replaceChildren(tab === 'settings' ? settingsTab() : design);
    if (tab === 'design' && !shown && scroller.clientWidth) { shown = true; setZoom(fitZoom()); renderPages(); }
  }
  buildPages();
  paintSide();
  paintTab();
  if (detection) {
    const n = detection.fields.length;
    errBox.replaceChildren(n
      ? h('div.banner.info', icon('checkCircle'), h('span.grow', detection.method === 'acroform'
        ? `الملف يحتوي ${n} حقل تفاعلي جاهز، وتم استخدامها. راجعي العناوين والأحجام ثم احفظي.`
        : `تم اكتشاف ${n} حقل تلقائيًا. راجعيها: حرّكي أو غيّري حجم ما يلزم، احذفي الزائد، وأضيفي الناقص.${detection.textless ? ' (الملف صورة ممسوحة: اكتبي عناوين الحقول بنفسك.)' : ''}`))
      : h('div.banner', icon('info'), h('span.grow', 'لم يتمكن الموقع من اكتشاف الحقول تلقائيًا في هذا الملف. أضيفيها يدويًا: اضغطي «إضافة حقل» ثم ارسمي مربعًا في كل مكان تكتب فيه المعلمة.')));
  }
  // first render once the element is in the page (needs its width)
  const ro = new ResizeObserver(() => { if (!shown && scroller.clientWidth) { shown = true; setZoom(fitZoom()); renderPages(); } });
  ro.observe(scroller);

  return { el: root, isDirty: () => dirty };
}

/** Reading order: page, then line (top → bottom), then right → left. */
export function sortFields(list) {
  return [...list].sort((a, b) => {
    if (a.box.p !== b.box.p) return a.box.p - b.box.p;
    const same = Math.abs((a.box.y + a.box.h / 2) - (b.box.y + b.box.h / 2)) < Math.min(a.box.h, b.box.h) * 0.6;
    return same ? (b.box.x + b.box.w) - (a.box.x + a.box.w) : a.box.y - b.box.y;
  });
}
