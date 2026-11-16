import { h } from './common.js';
import { renderDocHTML } from '../shared/core.js';
import { LINKED_FONT_CSS } from './pdf.js';

const PAGE_W = 794; // A4 @96dpi
// Printing (vector PDF via the browser's "Save as PDF"): same margins and page-number footer as the original.
const PRINT_CSS = `@media print{body.doc{padding:0!important}.pv-foot{display:none}}
@page{size:A4;margin:10mm 9mm 14mm;@bottom-center{content:counter(page) " / " counter(pages);font-family:'DejaVu Sans',sans-serif;font-size:8px;color:#fff;background:#5a3d9f;border-radius:2px;height:4mm;margin:4mm 0 5mm;width:192mm;text-align:center;vertical-align:middle}}`;

/** Renders the official document into a scaled A4 "paper" preview. */
export function docPreview(schema, data, settings, opts = {}) {
  const iframe = h('iframe', { title: 'معاينة النموذج', sandbox: 'allow-same-origin allow-modals' });
  const paper = h('div.pv-paper', iframe);
  const stage = h('div.pv-stage', paper);
  const extra = `<style>body.doc{padding:38px 34px 30px;} .pv-foot{margin-top:24px;background:#5a3d9f;color:#fff;text-align:center;font-size:10px;padding:3px;border-radius:2px;} ${PRINT_CSS}</style>`;
  iframe.srcdoc = renderDocHTML(schema, data, settings, LINKED_FONT_CSS, opts).replace('</head>', extra + '</head>').replace('</body>', '<div class="pv-foot">A4</div></body>');

  const fit = () => {
    const doc = iframe.contentDocument;
    if (!doc?.body) return;
    const hgt = Math.max(1123, doc.documentElement.scrollHeight);
    iframe.style.height = hgt + 'px';
    const avail = stage.clientWidth - 2 * parseFloat(getComputedStyle(stage).paddingLeft || 0);
    const scale = Math.min(1, avail / PAGE_W);
    paper.style.transform = `scale(${scale})`;
    paper.style.height = hgt + 'px';
    stage.style.height = (hgt * scale + 2 * parseFloat(getComputedStyle(stage).paddingTop || 0)) + 'px';
  };
  iframe.addEventListener('load', () => { fit(); iframe.contentDocument?.fonts?.ready.then(fit); setTimeout(fit, 300); });
  const ro = new ResizeObserver(fit); ro.observe(stage);
  return {
    el: stage,
    print() { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); },
  };
}
