// Shared (browser + Node) logic: schema helpers, validation, and the official document renderer.
// Everything that ends up in HTML is escaped here.

export const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const FIELD_TYPES = {
  text: { label: 'نص قصير', simple: true },
  textarea: { label: 'نص طويل', simple: true },
  number: { label: 'رقم', simple: true },
  date: { label: 'تاريخ (هجري/ميلادي)', simple: true },
  day: { label: 'اليوم (يُحدد من التاريخ)', simple: true },
  select: { label: 'قائمة منسدلة', simple: true },
  radio: { label: 'اختيار واحد', simple: true },
  checkbox: { label: 'اختيار متعدد', simple: true },
  signature: { label: 'توقيع إلكتروني', simple: true },
  file: { label: 'إرفاق ملفات (صور / PDF / مستندات)', simple: true },
  tick: { label: 'مربع علامة (✓)', simple: true },
  list: { label: 'قائمة بنود قابلة للإضافة', simple: false },
  rating: { label: 'جدول تقييم', simple: false },
  signatureGrid: { label: 'جدول أسماء وتواقيع', simple: false },
  table: { label: 'جدول قابل للتعبئة', simple: false },
  note: { label: 'نص إرشادي', simple: false },
};

export const LIMITS = { text: 300, textarea: 5000, listItems: 60, listItem: 2000, gridPeople: 150, signatureBytes: 400_000 };

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function allFields(schema) {
  const out = [];
  for (const s of schema?.sections || []) for (const f of s.fields || []) out.push(f);
  return out;
}

export function isVisible(field, data) {
  const c = field.showIf;
  if (!c || !c.field) return true;
  const v = data?.[c.field];
  if (Array.isArray(v)) return v.includes(c.equals);
  return String(v ?? '') === String(c.equals ?? '');
}

// ---------- dates ----------
function partsOf(fmt, d) {
  const o = {};
  for (const p of fmt.formatToParts(d)) o[p.type] = p.value;
  return o;
}
let hijriFmt, gregFmt;
export function parseISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}
export function dateInfo(iso) {
  const d = parseISODate(iso);
  if (!d) return null;
  hijriFmt ||= new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  gregFmt ||= new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const h = partsOf(hijriFmt, d);
  const g = partsOf(gregFmt, d);
  return {
    hijri: `${h.day}/${h.month}/${String(h.year).replace(/\D/g, '')}`,
    greg: `${g.day}/${g.month}/${g.year}`,
    day: DAYS[d.getUTCDay()],
  };
}
export function dateText(iso, showHijri = true) {
  const i = dateInfo(iso);
  if (!i) return '';
  return showHijri ? `${i.hijri} هـ الموافق ${i.greg} م` : `${i.greg} م`;
}

// ---------- display values ----------
export function valueText(field, data) {
  const v = data?.[field.id];
  switch (field.type) {
    case 'date': return dateText(v, field.showHijri !== false);
    case 'checkbox': {
      const arr = Array.isArray(v) ? [...v] : [];
      const other = data?.[field.id + '__other'];
      const i = arr.indexOf('__other');
      if (i >= 0) arr.splice(i, 1, other ? `أخرى: ${other}` : 'أخرى');
      return arr.join('، ');
    }
    case 'radio': case 'select':
      if (v === '__other') return data?.[field.id + '__other'] ? `أخرى: ${data[field.id + '__other']}` : 'أخرى';
      return v ?? '';
    case 'signature': return v ? '(موقّع)' : '';
    case 'file': return Array.isArray(v) ? v.join('، ') : ''; 
    case 'tick': return v === true ? '✓' : '';
    case 'list': return (Array.isArray(v) ? v : []).filter((x) => String(x).trim()).map((x, i) => `${i + 1}. ${x}`).join('\n');
    case 'rating': return (field.items || []).map((it, i) => {
      const r = Array.isArray(v) ? v[i] : null;
      return `${i + 1}. ${it}: ${r?.r || '—'}${r?.n ? ` (${r.n})` : ''}`;
    }).join('\n');
    case 'signatureGrid': return (Array.isArray(v) ? v : []).filter((p) => p?.name || p?.sig).map((p) => `${p.name || '—'}${p.sig ? ' (موقّعة)' : ''}`).join('، ');
    case 'table': {
      const f = field;
      const cols = (f.columns || []).map((c) => c.label || '');
      return (Array.isArray(v) ? v : []).map((row, i) => {
        const cells = (Array.isArray(row) ? row : []).map((c, j) => (String(c || '').trim() ? `${cols[j] || ''}: ${c}` : '')).filter(Boolean);
        if (!cells.length) return '';
        const lead = f.rowLabels?.[i] ? `${f.rowLabels[i]} — ` : `${i + 1}. `;
        return lead + cells.join('، ');
      }).filter(Boolean).join('\n');
    }
    case 'note': return '';
    default: return v == null ? '' : String(v);
  }
}

export function fillTemplate(tpl, schema, data) {
  if (!tpl) return '';
  const byId = Object.fromEntries(allFields(schema).map((f) => [f.id, f]));
  return String(tpl).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, id) => (byId[id] ? valueText(byId[id], data) : ''));
}

/** Flat label/value summary – used for admin details, CSV export and search. */
export function summarize(schema, data) {
  const out = [];
  for (const s of schema?.sections || []) {
    for (const f of s.fields || []) {
      if (f.type === 'note' || !isVisible(f, data)) continue;
      out.push({ section: s.title, id: f.id, label: f.label, type: f.type, text: valueText(f, data) });
    }
  }
  return out;
}

export function submitterName(schema, data) {
  const id = schema?.submitterField;
  const f = allFields(schema).find((x) => x.id === id);
  if (f) return valueText(f, data).slice(0, 200);
  const g = allFields(schema).find((x) => x.type === 'text' && x.required);
  return g ? valueText(g, data).slice(0, 200) : '';
}

// ---------- validation ----------
const isStr = (v) => typeof v === 'string';
const PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
export function validSignature(v) {
  return v === '' || v == null || (isStr(v) && v.length <= LIMITS.signatureBytes && PNG_RE.test(v));
}

/**
 * Validates data against a schema.
 * @returns {{ ok:boolean, errors:Object<string,string>, clean:Object }}
 */
export function validate(schema, data, { requireAll = true } = {}) {
  const errors = {};
  const clean = {};
  data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const req = (f) => requireAll && f.required;

  for (const f of allFields(schema)) {
    if (f.type === 'note') continue;
    if (!isVisible(f, data)) continue;
    const v = data[f.id];
    const err = (m) => { errors[f.id] = m; };
    switch (f.type) {
      case 'file': {
        const names = Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 15).map(x => x.slice(0, 180)) : [];
        if (req(f) && !names.length) err('أرفقي ملفًا واحدًا على الأقل');
        clean[f.id] = names;
        break;
      }
      case 'text': case 'textarea': {
        const s = v == null ? '' : String(v);
        const max = f.maxLength || (f.type === 'text' ? LIMITS.text : LIMITS.textarea);
        if (s.length > max) err(`الحد الأقصى ${max} حرفًا`);
        else if (req(f) && !s.trim()) err('هذا الحقل مطلوب');
        clean[f.id] = s;
        break;
      }
      case 'number': {
        const s = v == null ? '' : String(v).trim();
        if (s === '') { if (req(f)) err('هذا الحقل مطلوب'); clean[f.id] = ''; break; }
        const n = Number(s);
        if (!Number.isFinite(n)) err('أدخلي رقمًا صحيحًا');
        else if (f.min != null && f.min !== '' && n < Number(f.min)) err(`أقل قيمة ${f.min}`);
        else if (f.max != null && f.max !== '' && n > Number(f.max)) err(`أكبر قيمة ${f.max}`);
        clean[f.id] = s.slice(0, 30);
        break;
      }
      case 'date': {
        const s = v == null ? '' : String(v);
        if (!s) { if (req(f)) err('هذا الحقل مطلوب'); clean[f.id] = ''; break; }
        if (!parseISODate(s)) err('تاريخ غير صحيح');
        clean[f.id] = s;
        break;
      }
      case 'day': {
        const s = v == null ? '' : String(v);
        if (!s) { if (req(f)) err('هذا الحقل مطلوب'); }
        else if (!DAYS.includes(s)) err('اختاري يومًا صحيحًا');
        clean[f.id] = s;
        break;
      }
      case 'select': case 'radio': {
        const s = v == null ? '' : String(v);
        const opts = f.options || [];
        if (!s) { if (req(f)) err('اختاري أحد الخيارات'); }
        else if (!(opts.includes(s) || (f.allowOther && s === '__other'))) err('خيار غير صالح');
        clean[f.id] = s;
        if (f.allowOther) {
          const o = String(data[f.id + '__other'] ?? '').slice(0, LIMITS.text);
          clean[f.id + '__other'] = o;
          if (s === '__other' && req(f) && !o.trim()) err('اكتبي الخيار الآخر');
        }
        break;
      }
      case 'checkbox': {
        const arr = Array.isArray(v) ? v.map(String) : [];
        const opts = f.options || [];
        const bad = arr.find((x) => !(opts.includes(x) || (f.allowOther && x === '__other')));
        if (bad) err('خيار غير صالح');
        else if (req(f) && arr.length === 0) err('اختاري خيارًا واحدًا على الأقل');
        clean[f.id] = [...new Set(arr)];
        if (f.allowOther) clean[f.id + '__other'] = String(data[f.id + '__other'] ?? '').slice(0, LIMITS.text);
        break;
      }
      case 'tick': {
        if (req(f) && v !== true) err('هذا الحقل مطلوب');
        clean[f.id] = v === true;
        break;
      }
      case 'signature': {
        if (!validSignature(v)) err('توقيع غير صالح');
        else if (req(f) && !v) err('التوقيع مطلوب');
        clean[f.id] = v || '';
        break;
      }
      case 'list': {
        const arr = Array.isArray(v) ? v : [];
        if (arr.length > (f.maxItems || LIMITS.listItems)) { err('عدد البنود أكبر من المسموح'); break; }
        const items = arr.map((x) => String(x ?? ''));
        if (items.some((x) => x.length > LIMITS.listItem)) err(`الحد الأقصى ${LIMITS.listItem} حرفًا للبند`);
        else if (req(f) && items.filter((x) => x.trim()).length < Math.max(1, Number(f.minItems) || 1)) err(`أدخلي ${Math.max(1, Number(f.minItems) || 1)} بند على الأقل`);
        clean[f.id] = items;
        break;
      }
      case 'rating': {
        const arr = Array.isArray(v) ? v : [];
        const scale = f.scale || [];
        const items = f.items || [];
        const out = items.map((_, i) => {
          const r = arr[i] && typeof arr[i] === 'object' ? arr[i] : {};
          return { r: String(r.r ?? ''), n: String(r.n ?? '').slice(0, 500) };
        });
        if (out.some((x) => x.r && !scale.includes(x.r))) err('تقييم غير صالح');
        else if (req(f) && out.some((x) => !x.r)) err('قيّمي جميع العناصر');
        clean[f.id] = out;
        break;
      }
      case 'signatureGrid': {
        const arr = Array.isArray(v) ? v : [];
        if (arr.length > LIMITS.gridPeople) { err('عدد الأسماء أكبر من المسموح'); break; }
        const out = arr.map((p) => ({ name: String(p?.name ?? '').slice(0, 120), sig: p?.sig || '' }));
        if (out.some((p) => !validSignature(p.sig))) err('توقيع غير صالح');
        else if (req(f) && !out.some((p) => p.name.trim())) err('أدخلي اسمًا واحدًا على الأقل');
        clean[f.id] = out;
        break;
      }
      case 'table': {
        const ncol = (f.columns || []).length;
        const max = f.rowLabels?.length ? f.rowLabels.length : Math.min(100, Number(f.maxRows) || 60);
        const arr = Array.isArray(v) ? v : [];
        if (arr.length > max) { err('عدد الصفوف أكبر من المسموح'); break; }
        const out = arr.map((row) => Array.from({ length: ncol }, (_, j) => String((Array.isArray(row) ? row[j] : '') ?? '').slice(0, 1000)));
        if (req(f) && !out.some((r) => r.some((c) => c.trim()))) err('عبّئي صفًا واحدًا على الأقل');
        clean[f.id] = out;
        break;
      }
      default:
        break;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

/** Validates the schema itself (admin side). Returns an array of Arabic error strings. */
export function validateSchema(schema) {
  const errs = [];
  if (!schema || typeof schema !== 'object') return ['بنية النموذج غير صالحة'];
  if (!Array.isArray(schema.sections) || !schema.sections.length) errs.push('أضيفي قسمًا واحدًا على الأقل');
  const ids = new Set();
  for (const [si, s] of (schema.sections || []).entries()) {
    if (!s || typeof s !== 'object') { errs.push(`القسم ${si + 1} غير صالح`); continue; }
    if (!String(s.title || '').trim()) errs.push(`القسم ${si + 1} بلا عنوان`);
    if (!Array.isArray(s.fields)) { errs.push(`القسم "${s.title}" بلا حقول`); continue; }
    for (const f of s.fields) {
      if (!f || !FIELD_TYPES[f.type]) { errs.push(`نوع حقل غير معروف في القسم "${s.title}"`); continue; }
      if (!/^[A-Za-z][\w-]{0,40}$/.test(f.id || '')) errs.push(`معرّف غير صالح للحقل "${f.label || ''}"`);
      else if (ids.has(f.id)) errs.push(`المعرّف "${f.id}" مكرر`);
      ids.add(f.id);
      if (f.type !== 'note' && !String(f.label || '').trim()) errs.push(`حقل بلا عنوان في القسم "${s.title}"`);
      if (['select', 'radio', 'checkbox'].includes(f.type) && !(f.options || []).length) errs.push(`الحقل "${f.label}" يحتاج خيارات`);
      if (f.type === 'rating' && (!(f.items || []).length || !(f.scale || []).length)) errs.push(`جدول التقييم "${f.label}" يحتاج عناصر ودرجات`);
      if (f.type === 'table' && (!Array.isArray(f.columns) || !f.columns.length || f.columns.some((c) => !String(c?.label || '').trim()))) errs.push(`الجدول "${f.label}" يحتاج أعمدة بعناوين`);
    }
  }
  for (const f of allFields(schema)) {
    if (f.showIf?.field && !ids.has(f.showIf.field)) errs.push(`شرط الإظهار للحقل "${f.label}" يشير إلى حقل غير موجود`);
    if (f.type === 'day' && f.autoFrom && !ids.has(f.autoFrom)) errs.push(`الحقل "${f.label}" مرتبط بتاريخ غير موجود`);
  }
  if (schema.mode === 'pdf') errs.push(...validatePdfTemplate(schema));
  if (JSON.stringify(schema).length > 400_000) errs.push('النموذج كبير جدًا');
  return errs;
}

/** Extra checks for forms built on an uploaded PDF (fields positioned on the original pages). */
export const PDF_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'day', 'select', 'tick', 'signature'];
function validatePdfTemplate(schema) {
  const errs = [];
  const t = schema.pdfTemplate;
  if (!t || typeof t !== 'object' || !/^[A-Za-z0-9_-]{8,40}$/.test(String(t.fileId || ''))) return ['ملف PDF الأصلي غير مرفوع'];
  if (!Array.isArray(t.pages) || !t.pages.length) return ['معلومات صفحات ملف PDF مفقودة'];
  for (const f of allFields(schema)) {
    const b = f.box;
    if (!PDF_FIELD_TYPES.includes(f.type)) { errs.push(`نوع الحقل "${f.label}" غير مدعوم في نماذج PDF`); continue; }
    if (!b || !Number.isInteger(b.p) || !t.pages[b.p] || ![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w <= 0 || b.h <= 0) errs.push(`موضع الحقل "${f.label}" على الملف غير صالح`);
  }
  return errs;
}

// ---------- document renderer ----------
const MARK_ON = '<span class="mk on">●</span>';
const MARK_OFF = '<span class="mk">○</span>';
const BOX_ON = '<span class="mk on">☑</span>';
const BOX_OFF = '<span class="mk">☐</span>';
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

function sigImg(src, cls = 'sig') {
  return src && PNG_RE.test(src) ? `<img class="${cls}" src="${src}" alt="توقيع">` : '';
}
/** Owner images (logos, principal signature, stamp) are inline data URLs. */
export function safeImg(x) {
  return typeof x === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(x) ? x : '';
}
const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function simpleValueHTML(f, data) {
  const v = data?.[f.id];
  switch (f.type) {
    case 'radio': case 'checkbox': {
      const sel = f.type === 'radio' ? [v] : (Array.isArray(v) ? v : []);
      const on = f.type === 'radio' ? MARK_ON : BOX_ON;
      const off = f.type === 'radio' ? MARK_OFF : BOX_OFF;
      if (f.pdfShowAll === false) return nl2br(valueText(f, data));
      const opts = (f.options || []).map((o) => `<span class="opt${sel.includes(o) ? ' sel' : ''}">${sel.includes(o) ? on : off} ${esc(o)}</span>`);
      if (f.allowOther) {
        const isOn = sel.includes('__other');
        const t = data?.[f.id + '__other'];
        opts.push(`<span class="opt${isOn ? ' sel' : ''}">${isOn ? on : off} أخرى${isOn && t ? `: ${esc(t)}` : ''}</span>`);
      }
      return `<span class="opts">${opts.join('')}</span>`;
    }
    case 'signature': return sigImg(v);
    case 'tick': return v === true ? BOX_ON : BOX_OFF;
    case 'textarea': return nl2br(applyFormat(f, valueText(f, data)));
    default: return esc(applyFormat(f, valueText(f, data)));
  }
}
function applyFormat(f, text) {
  if (!f.pdfFormat || !String(text).trim()) return text;
  return String(f.pdfFormat).replace(/\{\{\s*value\s*\}\}/g, text);
}

function gridRowsOf(fields, cols) {
  const rows = [];
  let cur = []; let used = 0;
  for (const f of fields) {
    const span = Math.min(cols, Math.max(1, f.pdfSpan || (f.width === 'full' || f.type === 'textarea' && !f.width ? cols : f.width === 'half' && cols >= 2 ? Math.ceil(cols / 2) : 1)));
    if (used + span > cols && cur.length) { rows.push(cur); cur = []; used = 0; }
    cur.push({ f, span }); used += span;
    if (used >= cols) { rows.push(cur); cur = []; used = 0; }
  }
  if (cur.length) rows.push(cur);
  return rows;
}

function renderGrid(fields, data, cols, layout) {
  const rows = gridRowsOf(fields, cols);
  let html = '';
  if (layout === 'stacked') {
    for (const row of rows) {
      const used = row.reduce((a, c) => a + c.span, 0);
      if (used < cols) row[row.length - 1].span += cols - used;
      html += `<table class="t"><colgroup>${'<col>'.repeat(cols)}</colgroup><tr>${row.map(({ f, span }) => `<th class="lbl" colspan="${span}">${esc(f.label)}</th>`).join('')}</tr>`
        + `<tr>${row.map(({ f, span }) => `<td class="val tall" colspan="${span}">${simpleValueHTML(f, data)}</td>`).join('')}</tr></table>`;
    }
    return html;
  }
  html += `<table class="t grid c${cols}"><colgroup>${'<col class="lc"><col class="vc">'.repeat(cols)}</colgroup>`;
  for (const row of rows) {
    const used = row.reduce((a, c) => a + c.span, 0);
    if (used < cols) row[row.length - 1].span += cols - used;
    html += '<tr>' + row.map(({ f, span }) => (f.pdfHideLabel ? '' : `<th class="lbl">${esc(f.label)}</th>`)
      + `<td class="val${f.type === 'signature' ? ' sigcell' : ''}${f.type === 'textarea' ? ' tall' : ''}" colspan="${f.pdfHideLabel ? span * 2 : span * 2 - 1}">${simpleValueHTML(f, data)}</td>`).join('') + '</tr>';
  }
  return html + '</table>';
}

function renderBlock(f, data, showLabel) {
  const v = data?.[f.id];
  const head = showLabel && f.label ? `<div class="sub-title">${esc(f.label)}</div>` : '';
  switch (f.type) {
    case 'note':
      return f.pdfHide ? '' : `<div class="note-block">${nl2br(f.text || f.label || '')}</div>`;
    case 'list': {
      let items = (Array.isArray(v) ? v : []).filter((x) => String(x).trim());
      const minRows = Number(f.pdfMinRows ?? 0);
      while (items.length < minRows) items.push('');
      if (!items.length) items = [''];
      return head + `<table class="t list">${items.map((x, i) => `<tr><td class="num">${i + 1}.</td><td class="val">${nl2br(x)}</td></tr>`).join('')}</table>`;
    }
    case 'rating': {
      const scale = f.scale || [];
      const arr = Array.isArray(v) ? v : [];
      const notes = f.notes !== false;
      const sw = Math.min(11, Math.floor(40 / Math.max(1, scale.length)));
      const cg = `<colgroup><col style="width:5%"><col>${scale.map(() => `<col style="width:${sw}%">`).join('')}${notes ? '<col style="width:20%">' : ''}</colgroup>`;
      let h = head + `<table class="t rating">${cg}<thead><tr><th class="lbl n" rowspan="2">م</th><th class="lbl" rowspan="2">${esc(f.itemsHeader || 'العنصر')}</th><th class="lbl" colspan="${scale.length}">${esc(f.scaleHeader || 'التقدير')}</th>${notes ? '<th class="lbl" rowspan="2">ملاحظات</th>' : ''}</tr><tr>${scale.map((s) => `<th class="lbl sc">${esc(s)}</th>`).join('')}</tr></thead><tbody>`;
      (f.items || []).forEach((it, i) => {
        const r = arr[i] || {};
        h += `<tr><td class="num c">${i + 1}</td><td class="val">${esc(it)}</td>${scale.map((s) => `<td class="c chk">${r.r === s ? '✓' : ''}</td>`).join('')}${notes ? `<td class="val small">${esc(r.n || '')}</td>` : ''}</tr>`;
      });
      return h + '</tbody></table>';
    }
    case 'signatureGrid': {
      const per = Math.max(1, Math.min(4, Number(f.perRow) || 3));
      const people = (Array.isArray(v) ? v : []);
      let rows = [];
      for (let i = 0; i < people.length; i += per) rows.push(people.slice(i, i + per));
      // drop trailing fully-empty rows, then pad to the minimum rows for manual signing
      while (rows.length && rows[rows.length - 1].every((p) => !p?.name && !p?.sig)) rows.pop();
      const minRows = Number(f.pdfMinRows ?? f.defaultRows ?? 3);
      while (rows.length < minRows) rows.push([]);
      const first = f.firstHeader || f.nameHeader || 'الاسم';
      let h = head + `<table class="t sgrid"><thead><tr>${Array.from({ length: per }, (_, i) => `<th class="lbl">${esc(i === 0 ? first : (f.nameHeader || 'الاسم'))}</th><th class="lbl">التوقيع</th>`).join('')}</tr></thead><tbody>`;
      for (const r of rows) {
        h += '<tr>' + Array.from({ length: per }, (_, i) => `<td class="val">${esc(r[i]?.name || '')}</td><td class="c sigcell">${sigImg(r[i]?.sig, 'sig sm')}</td>`).join('') + '</tr>';
      }
      return h + '</tbody></table>';
    }
    case 'table': {
      const cols = f.columns || [];
      const fixed = Array.isArray(f.rowLabels) && f.rowLabels.length ? f.rowLabels : null;
      let rows = (Array.isArray(v) ? v : []).map((r) => (Array.isArray(r) ? r : []));
      if (!fixed) {
        while (rows.length && rows[rows.length - 1].every((c) => !String(c || '').trim())) rows.pop();
        const minRows = Number(f.pdfMinRows ?? f.defaultRows ?? 3);
        while (rows.length < minRows) rows.push([]);
      } else rows = fixed.map((_, i) => rows[i] || []);
      const num = !fixed && f.numbered !== false;
      const cg = `<colgroup>${num ? '<col style="width:6%">' : ''}${fixed ? `<col style="width:${clampN(f.rowLabelWidth, 10, 60, 24)}%">` : ''}${cols.map((c) => (c.width ? `<col style="width:${clampN(c.width, 4, 80, 10)}%">` : '<col>')).join('')}</colgroup>`;
      let h = head + `<table class="t dtable">${cg}<thead><tr>${num ? '<th class="lbl">م</th>' : ''}${fixed ? `<th class="lbl">${esc(f.rowLabelHeader || '')}</th>` : ''}${cols.map((c) => `<th class="lbl">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>`;
      rows.forEach((r, i) => {
        h += `<tr>${num ? `<td class="num c">${i + 1}</td>` : ''}${fixed ? `<th class="lbl rl">${esc(fixed[i])}</th>` : ''}${cols.map((_, j) => `<td class="val">${nl2br(r[j] || '')}</td>`).join('')}</tr>`;
      });
      return h + '</tbody></table>';
    }
    default:
      return '';
  }
}

export function renderDocBody(schema, data, settings, opts = {}) {
  const s = settings || {};
  const pdf = schema.pdf || {};
  const logoR = safeImg(s.logo); const logoL = safeImg(s.logo2);
  const box = (src, size, side, boxed) => (src ? `<div class="logo-box ${side}"><img src="${src}" alt=""${boxed === false ? ' class="nobox"' : ''} style="height:${clampN(size, 16, 110, 46)}px"></div>` : '');
  const align = ['right', 'center', 'left'].includes(s.headerAlign) ? s.headerAlign : 'center';
  let html = `<header class="doc-head">${box(logoR, s.logoSize, 'r', s.logoBox)}<div class="head-lines" style="text-align:${align}">`
    + [s.line1, s.line2, s.department].filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('')
    + (s.schoolName ? `<div class="b">${esc(s.schoolName)}</div>` : '')
    + `</div>${box(logoL, s.logo2Size, 'l', s.logo2Box)}</header>`;
  html += `<h1 class="doc-title">${esc(pdf.title || schema.title || '')}</h1>`;
  const sub = fillTemplate(pdf.subtitle, schema, data);
  if (sub.trim()) html += `<div class="doc-sub">${esc(sub)}</div>`;

  for (const sec of schema.sections || []) {
    if (sec.pdfHidden) continue;
    const fields = (sec.fields || []).filter((f) => isVisible(f, data) && !f.pdfHide);
    if (!fields.length) continue;
    const cols = Math.max(1, Math.min(3, Number(sec.columns) || 2));
    const title = fillTemplate(sec.pdfTitle || sec.title, schema, data);
    const right = sec.pdfTitleEnd ? fillTemplate(sec.pdfTitleEnd, schema, data) : '';
    html += `<section class="sec"><div class="sec-title${right ? ' split' : ''}"><span>${esc(title)}</span>${right ? `<span>${esc(right)}</span>` : ''}</div>`;
    let buf = [];
    const flush = () => { if (buf.length) { html += renderGrid(buf, data, cols, sec.pdfLayout); buf = []; } };
    const multi = fields.filter((f) => f.type !== 'note').length > 1;
    for (const f of fields) {
      if (FIELD_TYPES[f.type]?.simple) buf.push(f);
      else { flush(); html += renderBlock(f, data, multi && !f.pdfHideLabel); }
    }
    flush();
    html += '</section>';
  }
  html += principalBlock(s, pdf, opts);
  if (s.footerNote) html += `<div class="foot-note">${esc(s.footerNote)}</div>`;
  return html;
}

/** Principal title/name + signature and stamp, inserted automatically from the owner's settings. */
export function principalBlock(s, pdf = {}, opts = {}) {
  if (pdf.showPrincipal === false) return '';
  const sig = safeImg(s.principalSig); const stamp = safeImg(s.stamp);
  const marksOn = pdf.showPrincipalMarks !== false;
  const hasMarks = marksOn && (sig || stamp);
  const pending = marksOn && opts.marksPending;
  if (!s.principalTitle && !s.principalName && !hasMarks && !pending) return '';
  const align = ['right', 'left', 'center'].includes(s.principalAlign) ? s.principalAlign : 'center';
  const overlap = s.stampMode === 'overlap' && sig && stamp;
  let marks = '';
  if (hasMarks) {
    marks = `<div class="p-marks${overlap ? ' overlap' : ''}">`
      + (sig ? `<img class="p-sig" src="${sig}" alt="توقيع المديرة" style="height:${clampN(s.sigSize, 20, 140, 50)}px">` : '')
      + (stamp ? `<img class="p-stamp" src="${stamp}" alt="ختم المدرسة" style="height:${clampN(s.stampSize, 30, 200, 80)}px">` : '')
      + '</div>';
  } else if (pending) {
    marks = '<div class="p-pending">يُضاف توقيع المديرة وختم المدرسة تلقائيًا في النسخة المرسلة</div>';
  }
  return `<div class="principal pa-${align}"><div class="p-in">${s.principalTitle ? `<div class="pt">${esc(s.principalTitle)}</div>` : ''}${s.principalName ? `<div class="pn">${esc(s.principalName)}</div>` : ''}${marks}</div></div>`;
}

export const DOC_CSS = `
@page { size: A4; margin: 10mm 9mm 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body.doc, .doc { font-family: 'Plex Arabic', 'IBM Plex Sans Arabic', 'Noto Naskh Arabic', 'DejaVu Sans', sans-serif; color: #1f1b2e; font-size: 10.5pt; line-height: 1.45; direction: rtl; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: linear-gradient(90deg, #4c2f8f, #6a49b5); color: #fff; padding: 10px 14px; border-radius: 4px; min-height: 64px; }
.head-lines { font-size: 8.5pt; line-height: 1.55; text-align: center; flex: 1; }
.head-lines .b { font-weight: 700; }
.logo-box { flex: 0 0 auto; min-width: 40px; display: flex; align-items: center; }
.logo-box.r { justify-content: flex-start; } .logo-box.l { justify-content: flex-end; }
.logo-box img { background: #fff; border-radius: 6px; padding: 4px 6px; max-width: 300px; object-fit: contain; display: block; }
.logo-box img.nobox { background: transparent; padding: 0; border-radius: 0; }
.doc-title { text-align: center; font-size: 15pt; margin: 12px 0 2px; font-weight: 700; color: #241a46; }
.doc-sub { text-align: center; font-size: 10pt; margin-bottom: 8px; font-weight: 500; }
.sec { margin-top: 8px; break-inside: auto; }
.sec-title { background: #c9bfe0; border: 1px solid #5a5a6e; border-bottom: 0; text-align: center; font-weight: 700; padding: 4px 8px; font-size: 10.5pt; break-after: avoid; }
.sec-title.split { display: flex; justify-content: space-between; padding: 4px 16px; }
.sub-title { background: #e7e1f3; border: 1px solid #5a5a6e; border-bottom: 0; padding: 3px 8px; font-weight: 700; font-size: 9.5pt; }
table.t { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.t + table.t, .sub-title + table.t { border-top: 0; }
.t th, .t td { border: 1px solid #5a5a6e; padding: 4px 6px; vertical-align: middle; word-wrap: break-word; overflow-wrap: anywhere; }
.t tr { break-inside: avoid; }
.t thead { display: table-header-group; }
.lbl { background: #dbe6f2; font-weight: 700; text-align: center; font-size: 9.5pt; }
.grid.c1 col.lc { width: 22%; } .grid.c2 col.lc { width: 15%; } .grid.c3 col.lc { width: 11%; }
.val { text-align: right; min-height: 22px; height: 24px; }
.val.tall { height: 70px; vertical-align: top; white-space: normal; }
.c { text-align: center; }
.num { width: 7%; text-align: center; }
.rating .sc { font-size: 8.5pt; }
.rating .chk { font-size: 12pt; font-weight: 700; color: #3b2a77; }
.small { font-size: 8.5pt; }
.opts { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.opt { white-space: nowrap; } .opt.sel { font-weight: 700; }
.mk { font-size: 10pt; color: #555; } .mk.on { color: #3b2a77; }
img.sig { max-height: 46px; max-width: 100%; display: inline-block; vertical-align: middle; }
img.sig.sm { max-height: 32px; }
.sigcell { text-align: center; height: 38px; }
.sgrid td { height: 34px; }
.list td.val { height: 24px; }
.note-block { border: 1px solid #5a5a6e; padding: 6px 10px; font-size: 9pt; background: #faf8fd; }
.principal { margin-top: 18px; display: flex; break-inside: avoid; }
.principal.pa-center { justify-content: center; } .principal.pa-right { justify-content: flex-start; } .principal.pa-left { justify-content: flex-end; }
.p-in { text-align: center; min-width: 180px; padding: 0 12px; }
.principal .pt { font-weight: 700; }
.principal .pn { margin-top: 3px; font-weight: 500; }
.p-marks { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 4px; }
.p-marks img { object-fit: contain; max-width: 260px; display: block; }
.p-marks.overlap { position: relative; }
.p-marks.overlap .p-stamp { margin-inline-start: -46px; opacity: .88; mix-blend-mode: multiply; }
.p-pending { margin-top: 6px; font-size: 8pt; color: #7a7290; border: 1px dashed #c9bfe0; padding: 4px 10px; border-radius: 4px; }
.dtable .rl { text-align: right; }
.foot-note { margin-top: 12px; text-align: center; font-size: 8.5pt; color: #555; }
`;

export function fontFaceCSS(urls) {
  // urls: { ar400, ar700, la400, la700 }
  const AR = 'U+0600-06FF,U+0750-077F,U+0870-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFC';
  const LA = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212,U+2215,U+25CB,U+25CF,U+2610,U+2611,U+2713';
  const face = (u, w, r) => `@font-face{font-family:'Plex Arabic';font-style:normal;font-weight:${w};font-display:block;src:url(${u}) format('woff2');unicode-range:${r};}`;
  return face(urls.ar400, 400, AR) + face(urls.ar700, 700, AR) + face(urls.ar500 || urls.ar400, 500, AR)
    + face(urls.la400, 400, LA) + face(urls.la700, 700, LA) + face(urls.la500 || urls.la400, 500, LA);
}

export function renderDocHTML(schema, data, settings, fontCSS = '', opts = {}) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(schema?.pdf?.title || schema?.title || '')}</title><style>${fontCSS}${DOC_CSS}</style></head><body class="doc">${renderDocBody(schema, data, settings, opts)}</body></html>`;
}
