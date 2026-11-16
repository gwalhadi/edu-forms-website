// "PDF forms": the owner's original PDF + fields positioned on its pages.
//
// • Field positions are stored in PDF points in the page's *display* space (top-left origin, after /Rotate),
//   box = { p: pageIndex, x, y, w, h }. Each page keeps pdf.js' viewport matrix at scale 1 (m), so a box can be
//   mapped back to PDF user space without pdf.js.
// • Values are drawn by the browser (canvas) — Arabic shaping, bidi and the site font are exact — and the
//   resulting transparent images are placed on the *original* PDF with pdf-lib. The original pages (vector
//   text, tables, logos) are kept untouched, so the design is identical to the uploaded file.
// • Everything happens in the browser: teachers' answers are never sent anywhere.
import { dateInfo, valueText, isVisible, allFields } from '../shared/core.js';
import { getPdfFile } from './fb.js';

const VENDOR = new URL('../vendor/', import.meta.url).href;
export const FONT = '"Plex Arabic", "IBM Plex Sans Arabic", Tahoma, "Segoe UI", sans-serif';
export const DEFAULT_COLOR = '#14213d';
const HAS_AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

// ---------- libraries (loaded on demand, all local) ----------
let pdfjsP = null;
export function loadPdfJs() {
  pdfjsP ||= import(VENDOR + 'pdfjs/pdf.min.js').then((m) => {
    m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.js';
    return m;
  }).catch((e) => { pdfjsP = null; console.error(e); throw new Error('تعذر تحميل قارئ PDF. تحققي من الاتصال ثم حدّثي الصفحة.'); });
  return pdfjsP;
}

let pdfLibP = null;
export function loadPdfLib() {
  if (window.PDFLib?.PDFDocument) return Promise.resolve(window.PDFLib);
  pdfLibP ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = VENDOR + 'pdf-lib.min.js';
    s.onload = () => (window.PDFLib?.PDFDocument ? resolve(window.PDFLib) : reject(new Error('pdf-lib')));
    s.onerror = () => { pdfLibP = null; reject(new Error('تعذر تحميل مكتبة PDF. تحققي من الاتصال ثم حدّثي الصفحة.')); };
    document.head.append(s);
  });
  return pdfLibP;
}

/** Opens PDF bytes with pdf.js (a copy is passed: pdf.js transfers the buffer to its worker). */
export async function openPdf(bytes) {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    data: bytes.slice(0),
    isEvalSupported: false,
    enableXfa: false,
    standardFontDataUrl: VENDOR + 'pdfjs/standard_fonts/',
  }).promise;
}

const r3 = (n) => Math.round(n * 1000) / 1000;
/** Page geometry used to place fields: display size in points + pdf.js viewport matrix at scale 1. */
export async function pageInfos(doc) {
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    out.push({ w: r3(vp.width), h: r3(vp.height), r: page.rotate || 0, m: vp.transform.map(r3) });
  }
  return out;
}

/** True when the file starts like a PDF. */
export function looksLikePdf(bytes) {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/** Checks that pdf-lib can write the file (password-protected files cannot be filled). */
export async function checkWritable(bytes) {
  const { PDFDocument } = await loadPdfLib();
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e?.message || e?.name || ''))) throw new Error('الملف محمي بكلمة مرور أو مشفّر. احفظيه أولًا بدون حماية (مثلًا: طباعة ← حفظ بتنسيق PDF) ثم ارفعيه.');
    throw new Error('تعذر قراءة ملف PDF. قد يكون تالفًا؛ جرّبي حفظه من جديد ثم رفعه.');
  }
}

// ---------- template bytes (cached on the device: a file id never changes content) ----------
const CACHE = 'ef-pdf-templates-v1';
const cacheKey = (id) => new URL(`./__pdf-template/${id}`, location.href).href;
export async function templateBytes(fileId) {
  try {
    const c = await caches.open(CACHE);
    const r = await c.match(cacheKey(fileId));
    if (r) return new Uint8Array(await r.arrayBuffer());
  } catch { /* no Cache API (private mode, http) */ }
  const bytes = await getPdfFile(fileId);
  rememberBytes(fileId, bytes);
  return bytes;
}
export async function rememberBytes(fileId, bytes) {
  try {
    const c = await caches.open(CACHE);
    await c.put(cacheKey(fileId), new Response(bytes.slice(0), { headers: { 'content-type': 'application/pdf' } }));
    const keys = await c.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - 20))) await c.delete(k);
  } catch { /* ignore */ }
}

// ---------- drawing a field value ----------
let fontsReady = null;
export function ensureFonts() {
  fontsReady ||= Promise.all(['400', '700'].map((w) => document.fonts?.load(`${w} 16px "Plex Arabic"`, 'أبجد هوز 0123 abc'))).catch(() => {});
  return fontsReady;
}

/** Text that is printed in a field (null = nothing to draw). */
export function fieldText(f, data) {
  const v = data?.[f.id];
  switch (f.type) {
    case 'date': {
      const i = dateInfo(v);
      if (!i) return '';
      const st = f.dateStyle || 'hijri';
      return st === 'greg' ? `${i.greg} م` : st === 'both' ? `${i.hijri} هـ الموافق ${i.greg} م` : `${i.hijri} هـ`;
    }
    case 'tick': case 'signature': return null;
    default: return valueText(f, data);
  }
}
export function hasValue(f, data) {
  const v = data?.[f.id];
  if (f.type === 'tick') return v === true;
  if (f.type === 'signature') return typeof v === 'string' && v.startsWith('data:image/png');
  return String(fieldText(f, data) ?? '').trim() !== '';
}

function loadImg(src) {
  return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (!line || ctx.measureText(t).width <= maxW) line = t;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/**
 * Draws one field value into a transparent canvas of box size × scale (px per point).
 * Returns null when the field is empty.
 */
export async function fieldCanvas(f, data, { color = DEFAULT_COLOR, scale = 4 } = {}) {
  if (!hasValue(f, data)) return null;
  const { w, h } = f.box;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * scale));
  c.height = Math.max(1, Math.ceil(h * scale));
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = color; ctx.strokeStyle = color;

  if (f.type === 'tick') {
    const s = Math.min(w, h) * 0.78;
    const x0 = (w - s) / 2; const y0 = (h - s) / 2;
    ctx.lineWidth = Math.max(0.9, s * 0.13); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x0 + s * 0.12, y0 + s * 0.55); ctx.lineTo(x0 + s * 0.4, y0 + s * 0.82); ctx.lineTo(x0 + s * 0.9, y0 + s * 0.16); ctx.stroke();
    return c;
  }
  if (f.type === 'signature') {
    const im = await loadImg(data[f.id]);
    const k = Math.min(w / im.naturalWidth, h / im.naturalHeight);
    const dw = im.naturalWidth * k; const dh = im.naturalHeight * k;
    const al = f.align || 'center';
    const dx = al === 'right' ? w - dw : al === 'left' ? 0 : (w - dw) / 2;
    ctx.drawImage(im, dx, (h - dh) / 2, dw, dh);
    return c;
  }

  await ensureFonts();
  const text = String(fieldText(f, data));
  const ar = HAS_AR.test(text);
  ctx.direction = ar ? 'rtl' : 'ltr';
  const align = f.align || (ar ? 'right' : 'right');
  ctx.textAlign = align;
  const pad = Math.min(2, w * 0.04, h * 0.06);
  const aw = Math.max(1, w - 2 * pad); const ah = Math.max(1, h - 2 * pad);
  const weight = f.bold ? 700 : 400;
  const ax = align === 'right' ? w - pad : align === 'left' ? pad : w / 2;
  const fixed = Number(f.fontSize) > 0 ? Number(f.fontSize) : 0;
  const multi = f.type === 'textarea' || text.includes('\n');
  const rules = Math.min(60, Math.max(0, Math.round(Number(f.rules) || 0)));
  let size = fixed || Math.min(ah * (multi ? 0.5 : 0.8), multi ? 11 : 12);
  const setFont = () => { ctx.font = `${weight} ${size}px ${FONT}`; };
  setFont();

  if (rules > 1) { // ruled writing lines: one text line on each rule, extra text continues with smaller text
    const slot = h / rules;
    size = fixed || Math.min(slot * 0.62, 12); setFont();
    let lines = wrapLines(ctx, text, aw);
    while (lines.length > rules && size > 4) { size *= 0.93; setFont(); lines = wrapLines(ctx, text, aw); }
    const per = Math.max(1, Math.ceil(lines.length / rules));
    const lh = slot / per;
    ctx.textBaseline = 'alphabetic';
    lines.forEach((l, i) => {
      const r = Math.floor(i / per); const k = i % per;
      ctx.fillText(l, ax, r * slot + (k + 1) * lh - Math.max(1.5, lh * 0.22));
    });
    return c;
  }

  if (!multi && (ctx.measureText(text).width <= aw || ah < size * 2.4)) {
    while (ctx.measureText(text).width > aw && size > 4) { size *= 0.93; setFont(); }
    ctx.textBaseline = 'middle';
    ctx.fillText(text, ax, h / 2 + size * 0.06);
    return c;
  }
  // several lines: wrap, shrink until it fits
  let lines;
  for (let k = 0; k < 40; k++) {
    lines = wrapLines(ctx, text, aw);
    if (lines.length * size * 1.45 <= ah + 0.5 && lines.every((l) => ctx.measureText(l).width <= aw)) break;
    if (size <= 4) break;
    size *= 0.93; setFont();
  }
  const lh = size * 1.45;
  const total = lines.length * lh;
  let y = f.type === 'textarea' ? pad + lh / 2 : Math.max(pad + lh / 2, (h - total) / 2 + lh / 2);
  ctx.textBaseline = 'middle';
  for (const l of lines) { ctx.fillText(l, ax, y); y += lh; }
  return c;
}

/** Fields that are drawn (visible, positioned). */
export function placedFields(schema) {
  return allFields(schema).filter((f) => f.box && Number.isInteger(f.box.p));
}

// ---------- page images (designer, previews) ----------
/** Renders one page of a pdf.js document into a canvas at `zoom` CSS px per point. */
export async function renderPage(doc, pageIndex, zoom, { canvas, maxPixels = 9e6 } = {}) {
  const page = await doc.getPage(pageIndex + 1);
  const vp1 = page.getViewport({ scale: 1 });
  let ratio = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
  while (vp1.width * vp1.height * (zoom * ratio) ** 2 > maxPixels && ratio > 0.5) ratio *= 0.85;
  const vp = page.getViewport({ scale: zoom * ratio });
  const c = canvas || document.createElement('canvas');
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  c.style.width = `${vp1.width * zoom}px`; c.style.height = `${vp1.height * zoom}px`;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: c, ratio: zoom * ratio };
}

/**
 * Filled preview: each original page with the values drawn on top (same drawing as the downloaded PDF).
 * @returns {Promise<HTMLElement>}
 */
export async function filledPreview(bytes, schema, data, { width = 794 } = {}) {
  const doc = await openPdf(bytes);
  const tpl = schema.pdfTemplate;
  const color = tpl.color || DEFAULT_COLOR;
  const wrap = document.createElement('div');
  wrap.className = 'pdft-pages';
  try {
    const fields = placedFields(schema).filter((f) => isVisible(f, data));
    for (let p = 0; p < doc.numPages; p++) {
      const pw = tpl.pages[p]?.w || 595;
      const zoom = width / pw;
      const { canvas, ratio } = await renderPage(doc, p, zoom);
      const ctx = canvas.getContext('2d');
      for (const f of fields.filter((x) => x.box.p === p)) {
        const fc = await fieldCanvas(f, data, { color, scale: Math.max(2, ratio) });
        if (fc) ctx.drawImage(fc, f.box.x * ratio, f.box.y * ratio, f.box.w * ratio, f.box.h * ratio);
      }
      canvas.className = 'pdft-page';
      canvas.style.width = '100%'; canvas.style.height = 'auto';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `الصفحة ${p + 1}`);
      wrap.append(canvas);
    }
  } finally { doc.destroy(); }
  return wrap;
}

// ---------- the filled PDF ----------
function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
const apply = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

function canvasPng(c) {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? b.arrayBuffer().then((x) => resolve(new Uint8Array(x)), reject) : reject(new Error('png'))), 'image/png'));
}

/**
 * Original PDF + values → new PDF bytes. The original pages are copied untouched; values are added on top.
 */
export async function buildFilledPdf(bytes, schema, data, { title } = {}) {
  const PDFLib = await loadPdfLib();
  const { PDFDocument, PDFName, PDFArray, PDFDict, degrees } = PDFLib;
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const tpl = schema.pdfTemplate;
  const color = tpl.color || DEFAULT_COLOR;

  // Interactive form fields of the original file would be drawn above our values: flatten them first
  // (keeps their look), or remove them if the file's form cannot be flattened.
  try {
    if (pdf.catalog.has(PDFName.of('AcroForm'))) {
      try { pdf.getForm().flatten({ updateFieldAppearances: false }); } catch {
        for (const page of pdf.getPages()) {
          const annots = page.node.lookup(PDFName.of('Annots'));
          if (!(annots instanceof PDFArray)) continue;
          const keep = PDFArray.withContext(pdf.context);
          for (let i = 0; i < annots.size(); i++) {
            const a = annots.lookup(i);
            if (!(a instanceof PDFDict && a.get(PDFName.of('Subtype'))?.toString() === '/Widget')) keep.push(annots.get(i));
          }
          page.node.set(PDFName.of('Annots'), keep);
        }
        pdf.catalog.delete(PDFName.of('AcroForm'));
      }
    }
  } catch (e) { console.warn('form fields', e); }

  const pages = pdf.getPages();
  for (const f of placedFields(schema)) {
    if (!isVisible(f, data) || !hasValue(f, data)) continue;
    const page = pages[f.box.p];
    const info = tpl.pages[f.box.p];
    if (!page || !info) continue;
    const c = await fieldCanvas(f, data, { color, scale: 4 });
    if (!c) continue;
    const img = await pdf.embedPng(await canvasPng(c));
    c.width = c.height = 0;
    // bottom-left corner of the box (display space) → PDF user space; rotate with the page so it reads upright
    const [x, y] = apply(invert(info.m), f.box.x, f.box.y + f.box.h);
    page.drawImage(img, { x, y, width: f.box.w, height: f.box.h, rotate: degrees(info.r || 0) });
  }
  if (title) pdf.setTitle(String(title).slice(0, 200));
  pdf.setModificationDate(new Date());
  return pdf.save({ useObjectStreams: false });
}

export function pdfFileName(name) {
  return `${String(name || 'نموذج').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || 'form'}.pdf`;
}
