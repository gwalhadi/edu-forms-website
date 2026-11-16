// In-browser PDF generation.
//
// The official document is the same HTML/CSS (shared/core.js) that the old server printed with Chromium.
// Here the browser itself lays it out at the exact A4 content width (210mm − 2×9mm), we choose page breaks
// at row / block boundaries (never inside a table row, never right after a section title, table headers are
// repeated on the next page), every page is drawn by the browser engine (SVG <foreignObject>, so Arabic shaping,
// fonts, borders and colours are identical to the on-screen preview), and the pages are assembled into an A4
// PDF with jsPDF together with the purple page-number footer of the original.
//
// Nothing leaves the device: no network request is made with the teacher's data.
import { renderDocBody, DOC_CSS, fontFaceCSS } from '../shared/core.js';

const MM = 96 / 25.4; // CSS px per mm
const PAGE = { w: 210, h: 297, top: 10, bottom: 14, side: 9 };
const CW = (PAGE.w - 2 * PAGE.side) * MM; // content width  ≈ 725.7px
const CH = (PAGE.h - PAGE.top - PAGE.bottom) * MM; // content height ≈ 1031.8px
const SCALE = 2.6; // raster scale → ≈ 250 dpi

const FONT_FILES = { ar400: 'arabic-400', ar500: 'arabic-500', ar700: 'arabic-700', la400: 'latin-400', la500: 'latin-500', la700: 'latin-700' };
export const fontUrl = (n) => new URL(`../fonts/ibm-plex-sans-arabic-${n}-normal.woff2`, import.meta.url).href;
/** @font-face rules pointing at the site's font files (used for the on-screen preview and printing). */
export const LINKED_FONT_CSS = fontFaceCSS(Object.fromEntries(Object.entries(FONT_FILES).map(([k, n]) => [k, fontUrl(n)])));

let inlineFontCss = null;
async function inlineFonts() {
  if (inlineFontCss) return inlineFontCss;
  const entries = await Promise.all(Object.entries(FONT_FILES).map(async ([k, n]) => {
    const res = await fetch(fontUrl(n));
    if (!res.ok) throw new Error('تعذر تحميل الخط');
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return [k, `data:font/woff2;base64,${btoa(bin)}`];
  }));
  inlineFontCss = fontFaceCSS(Object.fromEntries(entries));
  return inlineFontCss;
}

let jspdfPromise = null;
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  jspdfPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
    s.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF')));
    s.onerror = () => { jspdfPromise = null; reject(new Error('تعذر تحميل مكتبة PDF')); };
    document.head.append(s);
  });
  return jspdfPromise;
}

const LAYOUT_CSS = `html,body{margin:0;padding:0;background:#fff}.doc{width:${CW}px;margin:0;padding:0;background:#fff}`;

/** Lays the document out in a hidden same-origin iframe at the exact A4 content width. */
async function layout(bodyHtml, fontCss) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  Object.assign(iframe.style, { position: 'fixed', left: '-10000px', top: '0', width: `${CW}px`, height: '1200px', border: '0', visibility: 'hidden' });
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${fontCss}${DOC_CSS}${LAYOUT_CSS}</style></head><body><div class="doc" id="root">${bodyHtml}</div></body></html>`);
  doc.close();
  await doc.fonts?.ready;
  await Promise.all([...doc.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
  await doc.fonts?.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { iframe, doc, root: doc.getElementById('root') };
}

/** Collects unbreakable blocks and computes page slices. */
function paginate(root) {
  const base = root.getBoundingClientRect().top;
  const total = Math.ceil(root.scrollHeight);
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top - base, bottom: r.bottom - base }; };
  const blocks = [...root.querySelectorAll('.doc-head,.doc-title,.doc-sub,.sec-title,.sub-title,tr,.note-block,.principal,.foot-note')]
    .map((el) => {
      const isHeadRow = el.tagName === 'TR' && (el.parentElement?.tagName === 'THEAD' || [...el.children].every((c) => c.tagName === 'TH'));
      return { el, ...rect(el), keep: isHeadRow || el.matches('.doc-head,.doc-title,.doc-sub,.sec-title,.sub-title') };
    })
    .filter((b) => b.bottom > b.top)
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  // candidate cut positions: the top of a block, unless the previous block must stay with the next one
  const cands = [];
  for (let i = 1; i < blocks.length; i++) {
    const c = blocks[i].top;
    if (blocks[i - 1].keep && blocks[i - 1].bottom <= c + 1) continue;
    if (blocks.some((b) => b.top < c - 0.5 && b.bottom > c + 0.5)) continue; // would cut through a block
    cands.push(c);
  }

  // tables with a header that Chrome would repeat on the next page
  const heads = [...root.querySelectorAll('table')].map((t) => {
    const th = t.tHead;
    if (!th) return null;
    return { table: rect(t), head: rect(th) };
  }).filter(Boolean);
  const headAt = (y) => heads.find((x) => y > x.head.bottom - 0.5 && y < x.table.bottom - 0.5) || null;

  const pages = [];
  let start = 0;
  let guard = 0;
  while (start < total - 1 && guard++ < 200) {
    const rep = pages.length ? headAt(start) : null;
    const repH = rep ? rep.head.bottom - rep.head.top : 0;
    const avail = CH - repH;
    let end;
    if (total - start <= avail) end = total;
    else {
      const ok = cands.filter((c) => c > start + 40 && c <= start + avail);
      end = ok.length ? Math.max(...ok) : start + avail;
    }
    pages.push({ start, end, rep });
    start = end;
  }
  return pages;
}

function svgFor(xhtml, cssText, y0, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${h}" viewBox="0 0 ${CW} ${h}">`
    + `<foreignObject x="0" y="0" width="${CW}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" dir="rtl" style="width:${CW}px;height:${h}px;overflow:hidden;background:#fff;">`
    + `<style>${cssText}</style><div style="transform:translateY(${-y0}px);">${xhtml}</div></div></foreignObject></svg>`;
}

async function drawSlice(ctx, xhtml, cssText, y0, y1, dy) {
  const h = Math.max(1, y1 - y0);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('svg'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgFor(xhtml, cssText, y0, h));
  });
  await img.decode?.().catch(() => {}); // Safari may reject decode() for SVG; onload is enough there
  await new Promise((r) => setTimeout(r, 30)); // give embedded fonts a moment (WebKit)
  ctx.drawImage(img, 0, dy * SCALE, CW * SCALE, h * SCALE);
}

/**
 * Builds the PDF for a filled form.
 * @returns {Promise<Blob>}
 */
export async function generatePdf(schema, data, settings, { onProgress } = {}) {
  const [jsPDF, fontCss] = await Promise.all([loadJsPDF(), inlineFonts()]);
  const bodyHtml = renderDocBody(schema, data, settings);
  const { iframe, root } = await layout(bodyHtml, fontCss);
  try {
    const pages = paginate(root);
    const xhtml = new XMLSerializer().serializeToString(root);
    const cssText = fontCss + DOC_CSS + LAYOUT_CSS;

    // warm-up: lets the engine decode the embedded fonts before the first real page (needed by some Safari versions)
    await drawSlice(document.createElement('canvas').getContext('2d'), xhtml, cssText, 0, 40, 0).catch(() => {});

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    pdf.setProperties({ title: schema?.pdf?.title || schema?.title || 'نموذج', creator: settings?.schoolName || '' });
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i + 1, pages.length);
      const p = pages[i];
      const repH = p.rep ? p.rep.head.bottom - p.rep.head.top : 0;
      const y0 = i ? p.start - 1 : 0; // include the shared 1px table border on both pages
      const y1 = Math.min(p.end + (i < pages.length - 1 ? 1 : 0), root.scrollHeight);
      const hPx = repH + (y1 - y0);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(CW * SCALE);
      canvas.height = Math.round(hPx * SCALE);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (p.rep) await drawSlice(ctx, xhtml, cssText, p.rep.head.top, p.rep.head.bottom, 0);
      await drawSlice(ctx, xhtml, cssText, y0, y1, repH);
      if (i) pdf.addPage('a4', 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', PAGE.side, PAGE.top, PAGE.w - 2 * PAGE.side, hPx / MM, undefined, 'FAST');
      // footer (same as the original: purple bar with "page / total")
      const fy = PAGE.h - PAGE.bottom + 5.2;
      pdf.setFillColor(90, 61, 159);
      pdf.roundedRect(PAGE.side, fy, PAGE.w - 2 * PAGE.side, 4, 0.5, 0.5, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      pdf.text(`${i + 1} / ${pages.length}`, PAGE.w / 2, fy + 2.75, { align: 'center' });
      canvas.width = canvas.height = 0; // free memory (iOS)
    }
    return pdf.output('blob');
  } finally {
    iframe.remove();
  }
}

/** Generates and downloads; returns the number of bytes. */
export async function downloadPdf(schema, data, settings, fileName, opts) {
  const blob = await generatePdf(schema, data, settings, opts);
  const name = `${String(fileName || 'نموذج').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || 'form'}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return blob.size;
}

/** Opens the PDF in a new tab (owner previews). Call openTab() synchronously inside the click handler. */
export function openPdfTab() {
  const win = window.open('', '_blank');
  if (win) win.document.write('<p style="font-family:sans-serif;padding:24px" dir="rtl">جارٍ إنشاء ملف PDF…</p>');
  return {
    async show(blob) { const url = URL.createObjectURL(blob); if (win) win.location = url; else location.href = url; },
    close() { win?.close(); },
  };
}
