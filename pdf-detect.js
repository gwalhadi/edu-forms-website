// Automatic detection of the places to fill in an uploaded PDF — entirely in the browser, no paid service.
//
// Order of trust:
//   1. Interactive fields already in the PDF (AcroForm)          → used as they are.
//   2. Dotted / underscore leaders in the text  "الاسم: ........"  → field over the leader.
//   3. Blank underlines drawn as lines                              → field just above the line.
//   4. Empty table cells / empty boxes, small square boxes          → field (or ✓ box) inside.
//   5. "Label:" followed by blank space on the same line            → field in the blank space.
// Labels are taken from the nearest text on the right (Arabic) / left (Latin) or from the column header.
// All coordinates are PDF points in the page's display space (top-left origin), like the designer.
import { loadPdfJs } from './pdf-template.js';

const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const LEADER_RE = /_{3,}|\.{4,}|…{2,}|ـ{4,}|-{5,}|(?:\. ?){4,}|(?:_ ?){3,}/g;
const BOX_CHARS = /[☐□▢❑◻⬜]/g;
const GENERIC_NAME = /^(text|txt|field|fill|check ?box|checkbox|untitled|textfield|text field|dropdown|combo ?box|list ?box|radio|button|sig(nature)?)[\s_\-.]*\d*$/i;

const hasLeader = (s) => String(s).replace(LEADER_RE, '') !== String(s);
const clean = (s) => String(s || '').normalize('NFKC').replace(LEADER_RE, ' ').replace(BOX_CHARS, ' ').replace(/[:：*•]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const vOverlap = (a, b) => Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const hOverlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
const inter = (a, b) => hOverlap(a, b) * vOverlap(a, b);

/**
 * @param doc pdf.js document
 * @returns {Promise<{fields: Array, method: 'acroform'|'auto', textless: boolean}>}
 */
export async function detectFields(doc, { onProgress, maxPages = 30 } = {}) {
  const pdfjs = await loadPdfJs();
  const n = Math.min(doc.numPages, maxPages);
  const perPage = [];
  let acroCount = 0;
  let textChars = 0;
  for (let p = 0; p < n; p++) {
    onProgress?.(p + 1, n);
    const page = await doc.getPage(p + 1);
    const vp = page.getViewport({ scale: 1 });
    const texts = await textBoxes(pdfjs, page, vp);
    textChars += texts.reduce((s, t) => s + t.str.trim().length, 0);
    const acro = await acroFields(page, vp);
    acroCount += acro.length;
    perPage.push({ page, vp, texts, acro });
  }

  let all = [];
  if (acroCount > 0) {
    for (const [p, pg] of perPage.entries()) {
      for (const f of pg.acro) {
        f.p = p;
        if (!f.label) f.label = labelFromNeighbours(f, phrases(pg.texts), []);
        all.push(f);
      }
    }
    return { fields: finish(all), method: 'acroform', textless: textChars < 10 };
  }

  for (const [p, pg] of perPage.entries()) {
    onProgress?.(p + 1, n, 'scan');
    const found = await scanPage(pg.page, pg.vp, pg.texts);
    found.forEach((f) => { f.p = p; });
    all.push(...found);
    await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  return { fields: finish(all), method: 'auto', textless: textChars < 10 };
}

// ---------- text ----------
const REV_LAM = /(^|[\s:(（«"])([وبفك]?)ا([اإأآ])ل/g;
const REV_WORDS = [['مالحظ', 'ملاحظ'], ['خالل', 'خلال'], ['إسالم', 'إسلام'], ['عالقة', 'علاقة'], ['صالحي', 'صلاحي'], ['تالميذ', 'تلاميذ'], ['استالم', 'استلام'], ['إعالن', 'إعلان'], ['فاعلي', 'فاعلي'], ['تطبيقاال', 'تطبيقالا']];
function fixLamAlef(s) {
  let out = s.replace(REV_LAM, '$1$2ال$3');
  for (const [a, b] of REV_WORDS) out = out.split(a).join(b);
  return out;
}

async function textBoxes(pdfjs, page, vp) {
  const tc = await page.getTextContent();
  const out = [];
  const pageText = tc.items.map((i) => i.str).join(' ').normalize('NFKC');
  const reversed = /(^|[\s:(])[وبفك]?ا[اإأآ]ل/.test(pageText); // tell-tale of reversed lam-alef
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const t = pdfjs.Util.transform(vp.transform, it.transform);
    if (Math.abs(t[1]) > Math.abs(t[0]) * 0.05 || t[0] <= 0) continue; // rotated or mirrored text: ignore
    const fh = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
    const w = it.width * (vp.scale || 1);
    if (!(w > 0)) continue;
    let str = it.str.normalize('NFKC');
    if (reversed) str = fixLamAlef(str);
    out.push({ str, rtl: it.dir === 'rtl' || AR.test(str), x: t[4], y: t[5] - fh * 0.85, w, h: fh * 1.15, base: t[5], fh });
  }
  return out;
}

// ---------- 1. existing interactive fields ----------
async function acroFields(page, vp) {
  let annots = [];
  try { annots = await page.getAnnotations({ intent: 'display' }); } catch { return []; }
  const out = [];
  for (const a of annots) {
    if (a.subtype !== 'Widget' || a.hidden || !a.fieldType || !a.rect) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    if (box.w < 2 || box.h < 2) continue;
    const name = String(a.alternativeText || '').trim() || (GENERIC_NAME.test(String(a.fieldName || '').trim()) ? '' : String(a.fieldName || '').split('.').pop());
    let type = 'text'; const extra = {};
    if (a.fieldType === 'Tx') type = a.multiLine ? 'textarea' : 'text';
    else if (a.fieldType === 'Btn') { if (!a.checkBox && !a.radioButton) continue; type = 'tick'; }
    else if (a.fieldType === 'Ch') {
      const opts = (a.options || []).map((o) => String(o.displayValue ?? o.exportValue ?? '').trim()).filter(Boolean);
      if (opts.length) { type = 'select'; extra.options = [...new Set(opts)]; }
    } else if (a.fieldType === 'Sig') type = 'signature';
    let label = clean(name);
    if (a.radioButton && a.buttonValue && label) label = `${label}: ${a.buttonValue}`;
    out.push({ ...box, type, label, src: 'acroform', ...extra });
  }
  return out;
}

// ---------- 2–5. visual heuristics ----------
async function scanPage(page, vp, texts) {
  const W0 = vp.width; const H0 = vp.height;
  const S = Math.min(3, Math.max(1.2, 1500 / W0)); // pixels per point
  const W = Math.floor(W0 * S); const H = Math.floor(H0 * S);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: S }) }).promise;
  const px = ctx.getImageData(0, 0, W, H).data;
  canvas.width = canvas.height = 0;

  const N = W * H;
  const ink = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const lum = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
    if (lum < 200) ink[i] = 1;
  }

  // ink without the text glyphs (for the check-box finder)
  const src = ink.slice();
  for (const t of texts) {
    if (isLeaderOnly(t.str)) continue;
    const x1 = Math.max(0, Math.floor(t.x * S) + 1); const x2 = Math.min(W - 1, Math.ceil((t.x + t.w) * S) - 1);
    const y1 = Math.max(0, Math.floor((t.base - t.fh * 0.8) * S)); const y2 = Math.min(H - 1, Math.ceil((t.base + t.fh * 0.28) * S));
    for (let y = y1; y <= y2; y++) src.fill(0, y * W + x1, y * W + x2 + 1);
  }

  // long thin horizontal / vertical runs. A run lying entirely inside a text run is a letter stroke
  // (Arabic words are joined on the baseline); a table border passing under text extends beyond it.
  const rowBoxes = new Array(H);
  for (const t of texts) {
    if (isLeaderOnly(t.str)) continue;
    const b = { x1: t.x * S - 2, x2: (t.x + t.w) * S + 2, y1: Math.floor((t.base - t.fh * 0.85) * S), y2: Math.ceil((t.base + t.fh * 0.3) * S) };
    for (let y = Math.max(0, b.y1); y <= Math.min(H - 1, b.y2); y++) (rowBoxes[y] ||= []).push(b);
  }
  const inTextH = (y, a, e) => (rowBoxes[y] || []).some((b) => b.x1 <= a && b.x2 >= e);
  const inTextV = (x, a, e) => (rowBoxes[a] || []).some((b) => b.x1 <= x && b.x2 >= x && b.y2 >= e);
  const minH = Math.round(14 * S); const minV = Math.round(9 * S); const maxThick = Math.max(3, Math.round(2.6 * S));
  const hl = new Uint8Array(N); const vl = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    let x = 0; const o = y * W;
    while (x < W) {
      if (!ink[o + x]) { x++; continue; }
      let e = x; while (e < W && ink[o + e]) e++;
      if (e - x >= minH && !inTextH(y, x, e - 1)) hl.fill(1, o + x, o + e);
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!ink[y * W + x]) { y++; continue; }
      let e = y; while (e < H && ink[e * W + x]) e++;
      if (e - y >= minV && !inTextV(x, y, e - 1)) for (let k = y; k < e; k++) vl[k * W + x] = 1;
      y = e;
    }
  }
  // drop thick areas (filled/shaded blocks are not lines)
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!hl[y * W + x]) { y++; continue; }
      let e = y; while (e < H && hl[e * W + x]) e++;
      if (e - y > maxThick) for (let k = y; k < e; k++) hl[k * W + x] = 0;
      y = e;
    }
  }
  for (let y = 0; y < H; y++) {
    let x = 0; const o = y * W;
    while (x < W) {
      if (!vl[o + x]) { x++; continue; }
      let e = x; while (e < W && vl[o + e]) e++;
      if (e - x > maxThick) vl.fill(0, o + x, o + e);
      x = e;
    }
  }

  // walls = lines, slightly thickened to close anti-aliasing gaps
  const r = Math.max(1, Math.round(0.6 * S));
  const wall = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!hl[i] && !vl[i]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        const o = yy * W;
        for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) wall[o + xx] = 1; }
      }
    }
  }

  const P = (v) => v / S; // px → pt
  const out = [];
  const cells = enclosedCells(wall, ink, W, H, S, r);
  const rects = cells.map((c) => ({ x: P(c.x1), y: P(c.y1), w: P(c.x2 - c.x1 + 1), h: P(c.y2 - c.y1 + 1), empty: c.empty }));

  // texts inside a "cell" make it non-empty (light-coloured text may be under the ink threshold)
  for (const c of rects) if (c.empty && texts.some((t) => !isLeaderOnly(t.str) && inter(c, t) > 0.3 * t.w * t.h)) c.empty = false;

  // 2. leaders in the text
  for (const t of texts) {
    for (const seg of leaderSegments(t)) out.push(seg);
    for (const b of boxGlyphs(t)) out.push(b);
  }

  // 3. underlines (horizontal segments with free ends and blank space above)
  for (const seg of segmentsOf(hl, W, H, Math.round(22 * S))) {
    const yTop = seg.y1;
    const near = (x) => { // a vertical line touches this end → part of a box
      for (let dx = -3 * r; dx <= 3 * r; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= W) continue;
        for (let dy = -Math.round(4 * S); dy <= Math.round(4 * S); dy++) {
          const yy = yTop + dy; if (yy >= 0 && yy < H && vl[yy * W + xx]) return true;
        }
      }
      return false;
    };
    if (near(seg.x1) || near(seg.x2)) continue;
    const a = seg.x1 + 2; const b = seg.x2 - 2;
    let free = 0; const maxUp = Math.round(24 * S);
    for (let y = yTop - 2; y > Math.max(0, yTop - maxUp); y--) {
      let c = 0; const o = y * W;
      for (let x = a; x <= b; x++) if (ink[o + x]) { c++; if (c > 2) break; }
      if (c > 2) break;
      free++;
    }
    if (free < 8 * S) continue;
    const hgt = Math.min(free, 20 * S);
    out.push({ x: P(seg.x1), y: P(yTop - hgt), w: P(seg.x2 - seg.x1), h: P(hgt - 1), type: 'text', src: 'line' });
  }

  // 4. empty boxes / cells
  for (const c of rects) {
    if (!c.empty) continue;
    const sq = c.w <= 20 && c.h <= 20 && c.w >= 4.5 && c.h >= 4.5 && c.w / c.h > 0.7 && c.w / c.h < 1.43;
    if (sq) { out.push({ ...c, type: 'tick', src: 'box' }); continue; }
    if (c.w < 12 || c.h < 7) continue;
    const pad = Math.min(1.5, c.h * 0.08);
    out.push({ x: c.x + pad, y: c.y + pad, w: c.w - 2 * pad, h: c.h - 2 * pad, type: 'text', src: 'cell' });
  }

  // 4b. small hollow squares (check boxes too small to be found as cells)
  for (const q of hollowSquares(src, ink, W, H, S)) out.push({ x: P(q.x1), y: P(q.y1), w: P(q.x2 - q.x1 + 1), h: P(q.y2 - q.y1 + 1), type: 'tick', src: 'box' });

  // 5. "Label:" followed by blank space
  const margin = texts.length ? Math.min(...texts.map((t) => t.x)) : W0 * 0.06;
  const marginR = texts.length ? Math.max(...texts.map((t) => t.x + t.w)) : W0 * 0.94;
  const phr = phrases(texts);
  for (const t of phr) {
    const s = t.str.trim();
    if (!/[:：]$/.test(s) || hasLeader(s)) continue;
    const band = { y1: Math.round((t.base - t.fh * 0.85) * S), y2: Math.round((t.base + t.fh * 0.25) * S) };
    const free = (x) => { for (let y = Math.max(0, band.y1); y <= Math.min(H - 1, band.y2); y++) if (ink[y * W + x] || wall[y * W + x]) return false; return true; };
    if (t.rtl) {
      const start = Math.floor(t.x * S) - Math.round(3 * S);
      const stop = Math.floor(margin * S) - Math.round(4 * S);
      let x = start; while (x > Math.max(0, stop) && free(x)) x--;
      const wpx = start - x;
      if (wpx >= 40 * S) out.push({ x: P(x + 3 * S), y: P(band.y1), w: Math.min(P(wpx - 3 * S), 260), h: P(band.y2 - band.y1), type: 'text', src: 'colon', anchorRight: P(start), lab: t });
    } else {
      const start = Math.ceil((t.x + t.w) * S) + Math.round(3 * S);
      const stop = Math.ceil(marginR * S) + Math.round(4 * S);
      let x = start; while (x < Math.min(W - 1, stop) && free(x)) x++;
      const wpx = x - start;
      if (wpx >= 40 * S) out.push({ x: P(start), y: P(band.y1), w: Math.min(P(wpx - 3 * S), 260), h: P(band.y2 - band.y1), type: 'text', src: 'colon', lab: t });
    }
  }
  for (const f of out) if (f.anchorRight) { f.x = f.anchorRight - f.w; delete f.anchorRight; }

  // "____ / ____ / ________" (a date written in parts) → one field
  const leaders = out.filter((f) => f.src === 'leader').sort((a, b) => b.x - a.x);
  for (const a of leaders) {
    if (a.gone) continue;
    for (;;) {
      const nb = leaders.find((b) => !b.gone && b !== a && Math.abs(b.y - a.y) < 2 && b.x + b.w <= a.x + 1 && a.x - (b.x + b.w) < 24
        && texts.filter((t) => t.x < a.x && t.x + t.w > b.x + b.w && Math.abs(t.base - (a.y + a.h)) < a.h)
          .every((t) => /^[\s/\\.\-_ـ0-9٠-٩هـ]*$/.test(t.str.replace(LEADER_RE, ''))));
      if (!nb) break;
      const x1 = nb.x; const x2 = a.x + a.w;
      a.x = x1; a.w = x2 - x1; nb.gone = true; a.parts = (a.parts || 1) + 1;
      if (!clean(a.label).replace(/[/\\\s]/g, '')) a.label = nb.label;
    }
    if (a.parts > 1 && !clean(a.label).replace(/[/\\\s]/g, '')) a.label = '';
  }
  for (const f of out) if (f.src === 'leader' && f.label && !clean(f.label).replace(/[/\\\s\d]/g, '')) f.label = '';

  // merge ruled writing lines stacked under each other into one multi-line field
  const lines = out.filter((f) => f.src === 'line').sort((a, b) => a.y - b.y);
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]; if (a.gone) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j]; if (b.gone) continue;
      if (Math.abs(a.x - b.x) < 8 && Math.abs(a.x + a.w - b.x - b.w) < 8 && b.y - (a.y + a.h) < 6 && b.y > a.y) {
        a.h = b.y + b.h - a.y; a.type = 'textarea'; a.rules = (a.rules || 1) + 1; b.gone = true;
      }
    }
  }

  // de-duplicate (earlier sources win)
  const rank = { leader: 0, glyph: 0, line: 1, box: 2, cell: 2, colon: 3 };
  const cands = out.filter((f) => !f.gone && f.w > 3 && f.h > 3).sort((a, b) => rank[a.src] - rank[b.src] || a.y - b.y);
  const kept = [];
  for (const f of cands) {
    if (kept.some((k) => inter(k, f) > 0.35 * Math.min(k.w * k.h, f.w * f.h))) continue;
    // "Notes:" with the writing area below it → the area below is the field
    if (f.src === 'colon' && kept.some((k) => k.y >= f.y + f.h - 2 && k.y - (f.y + f.h) < 30 && hOverlap(k, f.lab) > 0.5 * f.lab.w)) continue;
    kept.push(f);
  }
  for (const f of kept) if (!f.label) f.right = labelFromNeighbours(f, phr, kept);
  columnLabels(kept, phr);
  return kept;
}

/** Table cells: header text above the column, row label on the right (or the row number). */
function columnLabels(fields, phr) {
  const cells = fields.filter((f) => f.src === 'cell' || f.src === 'box').sort((a, b) => a.y - b.y);
  for (const f of cells) {
    const up = cells.filter((o) => o !== f && o.y + o.h <= f.y + 3 && f.y - (o.y + o.h) < 8 && hOverlap(o, f) > 0.8 * Math.min(o.w, f.w) && Math.abs(o.w - f.w) < 0.25 * Math.max(o.w, f.w)).sort((a, b) => b.y - a.y)[0];
    if (up) { f.colOf = up.colOf || up; f.row = (up.row || 1) + 1; continue; }
    f.colOf = f; f.row = 1;
    const head = phr.filter((t) => t.y + t.h <= f.y + 3 && f.y - (t.y + t.h) < 40 && hOverlap(t, f) > 0.5 * Math.min(t.w, f.w) && clean(t.str))
      .filter((t) => !fields.some((o) => o !== f && o.y >= t.y + t.h - 2 && o.y + o.h <= f.y + 2 && hOverlap(o, f) > 0)).sort((a, b) => b.y - a.y)[0];
    f.head = head ? clean(head.str) : '';
  }
  const groups = new Map();
  for (const f of cells) { const k = f.colOf; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
  for (const g of groups.values()) {
    const head = g[0].head;
    const allNamed = g.every((f) => f.right && !/^[\d٠-٩]+[.)-]?$/.test(f.right));
    for (const f of g) {
      if (f.label) continue;
      if (g.length > 1 && head && !allNamed) f.label = `${head} - ${f.right || f.row}`;
      else f.label = f.right || head || '';
    }
  }
  for (const f of fields) if (!f.label) f.label = f.right || '';
}

/** Joins words of the same line that pdf.js returned separately (a colon ends a label). */
function phrases(texts) {
  // runs containing dots/underscores are split into their real words (the blanks are fields, not labels)
  const parts = [];
  for (const t of texts) {
    if (!hasLeader(t.str)) { parts.push(t); continue; }
    const chars = [...t.str];
    const re = new RegExp(LEADER_RE.source, 'g');
    let m; let prev = 0; const s = chars.join('');
    const push = (from, to) => {
      const str = chars.slice(from, to).join('');
      if (!/[\p{L}\p{N}]/u.test(str)) return;
      const { x1, x2 } = spanX(t, from, to);
      parts.push({ ...t, str, x: x1, w: Math.max(1, x2 - x1) });
    };
    while ((m = re.exec(s))) { const from = [...s.slice(0, m.index)].length; push(prev, from); prev = from + [...m[0]].length; }
    push(prev, chars.length);
  }
  const items = parts.sort((a, b) => a.base - b.base || b.x - a.x);
  const endsColon = (t) => /[:：]\s*$/.test(t.str);
  const groups = [];
  for (const t of items) {
    const g = groups.find((o) => {
      if (Math.abs(o.base - t.base) > Math.min(o.fh, t.fh) * 0.35 || Math.abs(o.fh - t.fh) > Math.max(o.fh, t.fh) * 0.4) return false;
      const rtl = o.rtl || t.rtl;
      if (t.x + t.w <= o.x + 1) { // t is on the left of the group
        if (o.x - (t.x + t.w) > t.fh * 0.9) return false;
        const leftPart = o.parts.reduce((m, p) => (p.x < m.x ? p : m));
        return rtl ? !endsColon(leftPart) : !endsColon(t);
      }
      if (t.x >= o.x + o.w - 1) { // t is on the right
        if (t.x - (o.x + o.w) > t.fh * 0.9) return false;
        const rightPart = o.parts.reduce((m, p) => (p.x + p.w > m.x + m.w ? p : m));
        return rtl ? !endsColon(t) : !endsColon(rightPart);
      }
      return false;
    });
    if (g) {
      g.parts.push(t);
      const x1 = Math.min(g.x, t.x); const x2 = Math.max(g.x + g.w, t.x + t.w);
      g.x = x1; g.w = x2 - x1; g.y = Math.min(g.y, t.y); g.h = Math.max(g.h, t.h); g.rtl = g.rtl || t.rtl;
    } else groups.push({ ...t, parts: [t] });
  }
  for (const g of groups) {
    if (g.parts.length < 2) continue;
    g.parts.sort((a, b) => (g.rtl ? (b.x + b.w) - (a.x + a.w) : a.x - b.x));
    // a space only where there is a visible gap (some PDF makers write every glyph separately)
    g.str = g.parts.reduce((acc, p, i) => {
      if (!i) return p.str.trim();
      const prev = g.parts[i - 1];
      const gap = g.rtl ? prev.x - (p.x + p.w) : p.x - (prev.x + prev.w);
      return acc + (gap > Math.min(prev.fh, p.fh) * 0.12 ? ' ' : '') + p.str.trim();
    }, '');
  }
  return groups;
}

function isLeaderOnly(s) { return hasLeader(s) && String(s).replace(LEADER_RE, '').replace(/[\s:：]/g, '') === ''; }

/** Width weights to locate a part of a text run (fonts are unknown, so approximate). */
function charW(ch) { return ch === '.' ? 0.3 : ch === '_' ? 0.5 : ch === 'ـ' ? 0.35 : ch === ' ' ? 0.27 : ch === '…' ? 0.9 : /[0-9]/.test(ch) ? 0.5 : 0.52; }
function spanX(t, from, to) {
  const chars = [...t.str];
  const ws = chars.map(charW);
  const total = ws.reduce((a, b) => a + b, 0) || 1;
  const before = ws.slice(0, from).reduce((a, b) => a + b, 0) / total;
  const upto = ws.slice(0, to).reduce((a, b) => a + b, 0) / total;
  return t.rtl ? { x1: t.x + t.w * (1 - upto), x2: t.x + t.w * (1 - before) } : { x1: t.x + t.w * before, x2: t.x + t.w * upto };
}

function leaderSegments(t) {
  const out = [];
  const chars = [...t.str];
  const s = chars.join('');
  const re = new RegExp(LEADER_RE.source, 'g'); // own instance: clean() also uses LEADER_RE
  let m; let prevEnd = 0;
  while ((m = re.exec(s))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const from = [...s.slice(0, m.index)].length;
    const to = from + [...m[0]].length;
    const { x1, x2 } = spanX(t, from, to);
    const between = chars.slice(prevEnd, from).join('');
    const last = out[out.length - 1];
    if (last && /^[\s/\\.\-]*$/.test(between) && /\//.test(between)) { // "____ / ____ / ____" → one field
      const a = Math.min(last.x, x1); const b = Math.max(last.x + last.w, x2);
      last.x = a; last.w = b - a; last.parts = (last.parts || 1) + 1;
    } else if (x2 - x1 >= 12) {
      out.push({ x: x1, y: t.base - t.fh * 1.45, w: x2 - x1, h: t.fh * 1.4, type: 'text', src: 'leader', label: clean(between) || '' });
    }
    prevEnd = to;
  }
  // a single leader with its label written after it
  if (out.length === 1 && !out[0].label) out[0].label = clean(s);
  return out;
}

function boxGlyphs(t) {
  const out = [];
  const chars = [...t.str];
  chars.forEach((ch, i) => {
    if (!/[☐□▢❑◻⬜]/.test(ch)) return;
    const { x1, x2 } = spanX(t, i, i + 1);
    const s = Math.min(t.fh * 0.85, Math.max(5, x2 - x1));
    const cx = (x1 + x2) / 2;
    const rest = clean(chars.slice(i + 1).join('').split(/[☐□▢❑◻⬜]/)[0]) || clean(chars.slice(0, i).join('').split(/[☐□▢❑◻⬜]/).pop());
    out.push({ x: cx - s / 2, y: t.base - t.fh * 0.4 - s / 2, w: s, h: s, type: 'tick', src: 'glyph', label: rest });
  });
  return out;
}

/** Enclosed white regions (cells) between walls. */
function enclosedCells(wall, ink, W, H, S, r) {
  const N = W * H;
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const cells = [];
  const maxArea = 0.3 * N;
  for (let s0 = 0; s0 < N; s0++) {
    if (wall[s0] || seen[s0]) continue;
    let sp = 0; stack[sp++] = s0; seen[s0] = 1;
    let x1 = W; let x2 = -1; let y1 = H; let y2 = -1; let area = 0; let inkN = 0; let border = false;
    while (sp) {
      const i = stack[--sp];
      const y = (i / W) | 0; const x = i - y * W;
      area++; if (ink[i]) inkN++;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (x > 0 && !wall[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < W - 1 && !wall[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !wall[i - W] && !seen[i - W]) { seen[i - W] = 1; stack[sp++] = i - W; }
      if (y < H - 1 && !wall[i + W] && !seen[i + W]) { seen[i + W] = 1; stack[sp++] = i + W; }
    }
    if (border || area > maxArea) continue;
    const bw = x2 - x1 + 1; const bh = y2 - y1 + 1;
    if (bw < 4 * S || bh < 4 * S) continue;
    if (area / (bw * bh) < 0.85) continue;
    // real interior = region + the thickening of the walls around it
    const g = r;
    cells.push({ x1: x1 - g, x2: x2 + g, y1: y1 - g, y2: y2 + g, empty: inkN <= Math.max(3, area * 0.0015) });
  }
  return cells;
}

/** Small hollow squares in the ink (check boxes). */
function hollowSquares(src, ink, W, H, S) {
  const lo = Math.round(4.5 * S); const hi = Math.round(20 * S);
  const seen = new Uint8Array(W * H);
  const stack = [];
  const out = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!src[s0] || seen[s0]) continue;
    seen[s0] = 1; stack.length = 0; stack.push(s0);
    let x1 = W; let x2 = -1; let y1 = H; let y2 = -1; let n = 0; let big = false;
    while (stack.length) {
      const i = stack.pop(); n++;
      const y = (i / W) | 0; const x = i - y * W;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (x2 - x1 > hi || y2 - y1 > hi) big = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (src[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (big) continue;
    const bw = x2 - x1 + 1; const bh = y2 - y1 + 1;
    if (bw < lo || bh < lo || bw / bh < 0.75 || bw / bh > 1.33) continue;
    const fill = n / (bw * bh);
    if (fill < 0.08 || fill > 0.6) continue;
    // each side: the best-covered row/column near the edge must be (almost) full
    const th = Math.max(1, Math.round(bw * 0.15));
    const rowCov = (y) => { let c = 0; for (let x = x1; x <= x2; x++) if (src[y * W + x]) c++; return c / bw; };
    const colCov = (x) => { let c = 0; for (let y = y1; y <= y2; y++) if (src[y * W + x]) c++; return c / bh; };
    const best = (f, a, b) => { let m = 0; for (let k = a; k <= b; k++) m = Math.max(m, f(k)); return m; };
    if (best(rowCov, y1, y1 + th) < 0.8 || best(rowCov, y2 - th, y2) < 0.8 || best(colCov, x1, x1 + th) < 0.8 || best(colCov, x2 - th, x2) < 0.8) continue;
    const ix = Math.round(bw * 0.28); const iy = Math.round(bh * 0.28);
    let inside = 0;
    for (let y = y1 + iy; y <= y2 - iy; y++) for (let x = x1 + ix; x <= x2 - ix; x++) if (ink[y * W + x]) inside++;
    if (inside > 2) continue; // already ticked or a letter
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}

/** Horizontal line segments (from the line mask), merged across their thickness. */
function segmentsOf(hl, W, H, minLen) {
  const segs = [];
  const open = [];
  for (let y = 0; y < H; y++) {
    const o = y * W; let x = 0; const rowRuns = [];
    while (x < W) {
      if (!hl[o + x]) { x++; continue; }
      let e = x; while (e < W && hl[o + e]) e++;
      if (e - x >= minLen) rowRuns.push([x, e - 1]);
      x = e;
    }
    for (const [a, b] of rowRuns) {
      const s = open.find((q) => q.last === y - 1 && q.x1 < b && q.x2 > a);
      if (s) { s.x1 = Math.min(s.x1, a); s.x2 = Math.max(s.x2, b); s.last = y; } else open.push({ x1: a, x2: b, y1: y, last: y });
    }
    for (let i = open.length - 1; i >= 0; i--) if (open[i].last < y - 1) segs.push(...open.splice(i, 1));
  }
  segs.push(...open);
  return segs;
}

// ---------- labels & types ----------
function labelFromNeighbours(f, texts, fields) {
  const cy = f.y + f.h / 2;
  const sameLine = texts.filter((t) => {
    if (isLeaderOnly(t.str) || !clean(t.str)) return false;
    const tc = t.base - t.fh * 0.35;
    return tc > f.y - Math.max(4, f.h * 0.25) && tc < f.y + f.h + Math.max(4, f.h * 0.25);
  });
  if (f.type === 'tick') { // "☐ option": the nearest text on either side, not a "Label:" heading
    const gap = (t) => (t.x >= f.x + f.w - 2 ? t.x - (f.x + f.w) : f.x - (t.x + t.w)) + (/[:：]\s*$/.test(t.str) ? 1000 : 0);
    const near = sameLine.filter((t) => gap(t) < 60).sort((a, b) => gap(a) - gap(b))[0];
    if (near) return clean(near.str);
  }
  // Arabic labels are on the right of the blank, Latin labels on the left
  const right = sameLine.filter((t) => t.x >= f.x + f.w - 6 && t.x - (f.x + f.w) < 220)
    .filter((t) => !fields.some((o) => o !== f && o.x >= f.x + f.w - 2 && o.x + o.w <= t.x + 2 && vOverlap(o, f) > 0))
    .sort((a, b) => a.x - b.x)[0];
  if (right && (right.rtl || AR.test(right.str))) return clean(right.str);
  const left = sameLine.filter((t) => !t.rtl && t.x + t.w <= f.x + 6 && f.x - (t.x + t.w) < 160).sort((a, b) => b.x - a.x)[0];
  if (left) return clean(left.str);
  if (right) return clean(right.str);
  if (f.src === 'cell' || f.src === 'box') return ''; // column headers are handled with the table
  const above = texts.filter((t) => clean(t.str) && t.y + t.h <= f.y + 3 && f.y - (t.y + t.h) < 30 && hOverlap(t, f) > 0)
    .filter((t) => !fields.some((o) => o !== f && o.y >= t.y + t.h - 2 && o.y + o.h <= f.y + 2 && hOverlap(o, f) > 0)).sort((a, b) => b.y - a.y)[0];
  return above ? clean(above.str) : '';
}

/** Column headers for table cells, numbering, types, ids. */
function finish(fields) {
  // reading order: page, line, right → left
  fields.sort((a, b) => a.p - b.p || (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? b.x - a.x : a.y - b.y));
  let n = 0;
  const seen = new Map();
  for (const f of fields) {
    n++;
    let label = f.label || '';
    if (!label) label = f.type === 'tick' ? `مربع ${n}` : `حقل ${n}`;
    const k = label;
    seen.set(k, (seen.get(k) || 0) + 1);
    f.label = label;
    f.type = guessType(f);
    f.id = `f${n}`;
  }
  // repeated labels → numbered
  const count = new Map();
  for (const f of fields) {
    if ((seen.get(f.label) || 0) < 2) continue;
    const c = (count.get(f.label) || 0) + 1; count.set(f.label, c);
    f.label = `${f.label} (${c})`;
  }
  return fields.slice(0, 400).map((f) => {
    const out = { id: f.id, type: f.type, label: f.label, box: { p: f.p, x: r1(f.x), y: r1(f.y), w: r1(f.w), h: r1(f.h) }, auto: f.src };
    if (f.options) out.options = f.options;
    if (f.rules > 1) out.rules = f.rules;

    return out;
  });
}
const r1 = (v) => Math.round(v * 10) / 10;

function guessType(f) {
  if (f.type === 'tick' || f.type === 'select' || f.type === 'signature') return f.type;
  const l = f.label || '';
  if (/توقيع|التوقيع|signature|sign\b/i.test(l)) return 'signature';
  if ((/تاريخ|التاريخ|\bdate\b/i.test(l) && f.w < 260) || f.parts >= 3) return 'date';
  if (/^(ال)?يوم$/.test(l.trim())) return 'day';
  if (f.type === 'textarea') return 'textarea';
  if (f.h >= 34 && f.w >= 120) return 'textarea';
  return 'text';
}
