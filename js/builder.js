import { h, icon, toast, modal, confirmDialog, ICON_NAMES } from './common.js';
import { FIELD_TYPES, allFields, validateSchema, validate } from '../shared/core.js';
import { generatePdf, openPdfTab } from './pdf.js';
import { renderForm, initialData } from './form-ui.js';

const rid = (p = 'f') => p + Math.random().toString(36).slice(2, 7);
const clone = (o) => JSON.parse(JSON.stringify(o));
const WIDTHS = [['full', 'عرض كامل'], ['half', 'نصف'], ['third', 'ثلث']];

export function buildEditor(form, { onSave, settings = () => ({}) }) {
  let st = clone(form);
  st.schema ||= { sections: [] };
  st.schema.pdf ||= {};
  let dirty = false;
  let tab = 'sections';
  const openFields = new Set();
  const root = h('div', { 'data-dirty': dirty ? '1' : '0' });
  const errBox = h('div');
  const body = h('div');
  const markDirty = () => { dirty = true; root.dataset.dirty = '1'; saveBtn.classList.add('primary'); };

  const saveBtn = h('button.btn.primary', { type: 'button', onclick: () => save() }, icon('save', 16), 'حفظ النموذج');
  const publishBtn = h('button.btn.primary', { type: 'button', hidden: st.status === 'published', onclick: () => save({ publish: true }) }, icon('send', 16), 'حفظ ونشر');
  const tabList = [['settings', 'الإعدادات العامة'], ['sections', 'الأقسام والحقول'], ['json', 'JSON (متقدم)']];
  const tabs = h('div.tabs', tabList.map(([k, t]) =>
    h('button', { type: 'button', 'data-k': k, onclick: () => { tab = k; paint(); } }, t)));


  root.append(
    h('div.page-head', h('h1', form.id ? 'تعديل النموذج' : 'نموذج جديد'), h('div.acts',
      h('a.btn', { href: '#/forms' }, icon('arrowRight', 16), 'العودة'),
      h('button.btn', { type: 'button', onclick: livePreview }, icon('eye', 16), 'تجربة النموذج'),
      saveBtn, publishBtn)),
    errBox, tabs, body);

  function paint() {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === tab));
    body.replaceChildren(tab === 'settings' ? settingsTab() : tab === 'json' ? jsonTab() : sectionsTab());
  }

  // ---------- generic inputs ----------
  function inp(obj, key, { type = 'text', placeholder = '', onChange, dir, rows } = {}) {
    if (type === 'textarea') return h('textarea.inp', { rows: rows || 2, value: obj[key] ?? '', placeholder, dir, oninput: (e) => { obj[key] = e.target.value; markDirty(); onChange?.(); } });
    return h('input.inp', {
      type, value: obj[key] ?? '', placeholder, dir,
      oninput: (e) => {
        const v = e.target.value;
        if (type === 'number') { if (v === '') delete obj[key]; else obj[key] = Number(v); } else obj[key] = v;
        markDirty(); onChange?.();
      },
    });
  }
  function lines(obj, key, placeholder = 'خيار في كل سطر') {
    return h('textarea.inp', { rows: 4, value: (obj[key] || []).join('\n'), placeholder, oninput: (e) => { obj[key] = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markDirty(); } });
  }
  function check(obj, key, label, { def = false, onChange } = {}) {
    const c = h('input', { type: 'checkbox', checked: obj[key] ?? def, onchange: (e) => { obj[key] = e.target.checked; markDirty(); onChange?.(); } });
    return h('label.chk', c, label);
  }
  function sel(obj, key, options, { onChange, empty } = {}) {
    const s = h('select.inp', { onchange: (e) => { const v = e.target.value; if (v === '' && empty !== undefined) delete obj[key]; else obj[key] = /^\d+$/.test(v) && key === 'columns' ? Number(v) : v; markDirty(); onChange?.(); } },
      empty !== undefined ? h('option', { value: '' }, empty) : null,
      options.map(([v, t]) => h('option', { value: String(v) }, t)));
    s.value = obj[key] == null ? '' : String(obj[key]);
    return s;
  }
  const lab = (t, el, cls = '') => h('div' + cls, h('label', t), el);

  // ---------- settings tab ----------
  function settingsTab() {
    const textFields = allFields(st.schema).filter((f) => ['text', 'select'].includes(f.type));
    const ids = allFields(st.schema).filter((f) => FIELD_TYPES[f.type]?.simple);
    return h('div',
      h('div.card.panel', h('h2', 'بيانات النموذج'),
        h('div.form-grid',
          lab('عنوان النموذج *', inp(st, 'title', { placeholder: 'مثال: تقرير زيارة صفية' }), '.fg.full'),
          lab('وصف قصير يظهر في بطاقة النموذج', inp(st, 'description', { type: 'textarea' }), '.fg.full'),
          lab('الوسوم (افصلي بفاصلة)', h('input.inp', { value: (st.tags || []).join('، '), oninput: (e) => { st.tags = e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean); markDirty(); } }), '.fg'),
          lab('الرابط المختصر (حروف إنجليزية صغيرة وأرقام وشرطة)', inp(st, 'slug', { placeholder: 'weekly-report', dir: 'ltr' }), '.fg'),
          lab('الأيقونة', sel(st, 'icon', ICON_NAMES.map((n) => [n, n])), '.fg'),
          lab('الحالة', sel(st, 'status', [['draft', 'مسودة (غير ظاهر)'], ['published', 'منشور للمعلمات'], ['inactive', 'موقوف']]), '.fg'),
          lab('الحقل الذي يحدد اسم المعلمة (يظهر في قائمة المسودات)', sel(st.schema, 'submitterField', textFields.map((f) => [f.id, f.label]), { empty: '— تلقائي —' }), '.fg.full'))),
      h('div.card.panel', h('h2', 'إعدادات ملف PDF'),
        h('div.form-grid',
          lab('عنوان المستند في PDF', inp(st.schema.pdf, 'title', { placeholder: st.title || 'يستخدم عنوان النموذج إذا ترك فارغًا' }), '.fg.full'),
          lab('سطر فرعي تحت العنوان (اختياري)', inp(st.schema.pdf, 'subtitle', { placeholder: 'مثال: الفصل الدراسي: {{semester}}' }), '.fg.full'),
          h('div.fg.full', h('div.small.muted', 'يمكنك إدراج قيمة أي حقل بكتابة معرّفه بين قوسين مزدوجين، مثل ', h('span.ref', '{{fieldId}}'), '. المعرّفات المتاحة: ',
            ids.length ? ids.map((f, i) => [i ? '، ' : '', h('span.ref', f.id), ` (${f.label})`]) : '—')),
          h('div.fg.full', check(st.schema.pdf, 'showPrincipal', 'إظهار «مديرة المدرسة» واسمها أسفل الملف', { def: true })),
          h('div.fg.full', check(st.schema.pdf, 'showPrincipalMarks', 'إدراج توقيع المديرة وختم المدرسة تلقائيًا (من «هوية المدرسة»)', { def: true })))));
  }

  // ---------- json tab ----------
  function jsonTab() {
    const ta = h('textarea.inp.code', { value: JSON.stringify({ title: st.title, slug: st.slug, description: st.description, tags: st.tags, icon: st.icon, schema: st.schema }, null, 2) });
    return h('div.card.panel', h('h2', 'تعديل متقدم (JSON)'),
      h('p.small.muted', 'للنسخ الاحتياطي أو نقل النموذج لمنصة أخرى. أي تعديل هنا يستبدل النموذج الحالي بعد الضغط على «تطبيق».'),
      ta,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
        h('button.btn.primary', { type: 'button', onclick: () => {
          try {
            const o = JSON.parse(ta.value);
            const errs = validateSchema(o.schema);
            if (errs.length) { showErrors(errs); return; }
            Object.assign(st, { title: o.title ?? st.title, slug: o.slug ?? st.slug, description: o.description ?? '', tags: o.tags || [], icon: o.icon || st.icon, schema: o.schema });
            st.schema.pdf ||= {};
            markDirty(); showErrors([]); toast('تم تطبيق JSON — لا تنسي الحفظ');
          } catch { toast('صيغة JSON غير صحيحة', 'err'); }
        } }, 'تطبيق'),
        h('button.btn', { type: 'button', onclick: () => { navigator.clipboard?.writeText(ta.value).then(() => toast('تم النسخ')); } }, icon('copy', 15), 'نسخ')));
  }

  // ---------- sections tab ----------
  function sectionsTab() {
    const secs = st.schema.sections;
    const wrap = h('div.bld');
    secs.forEach((sec, si) => wrap.append(sectionCard(sec, si)));
    wrap.append(h('button.btn.soft', { type: 'button', onclick: () => { secs.push({ id: rid('s'), title: 'قسم جديد', columns: 2, fields: [] }); markDirty(); paint(); } }, icon('plus', 16), 'إضافة قسم'));
    return wrap;
  }

  function moveIn(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; markDirty(); paint(); }

  function sectionCard(sec, si) {
    const secs = st.schema.sections;
    sec.fields ||= [];
    const optsOpen = { v: false };
    const opts = h('div.bld-sec-opts', { hidden: true },
      lab('ملاحظة تظهر بجانب العنوان', inp(sec, 'note')),
      lab('عنوان القسم في PDF (اختياري)', inp(sec, 'pdfTitle', { placeholder: sec.title })),
      lab('نص على يسار شريط العنوان في PDF', inp(sec, 'pdfTitleEnd', { placeholder: 'مثال: رقم الجلسة ({{sessionNo}})' })),
      lab('عدد الأعمدة في PDF', sel(sec, 'columns', [[1, 'عمود واحد'], [2, 'عمودان'], [3, 'ثلاثة أعمدة']])),
      lab('تخطيط PDF', sel(sec, 'pdfLayout', [['grid', 'جدول: عنوان بجانب القيمة'], ['stacked', 'عنوان فوق القيمة']], { empty: 'جدول: عنوان بجانب القيمة' })),
      h('div', { style: { alignSelf: 'end' } }, check(sec, 'pdfHidden', 'إخفاء القسم من PDF (مثلًا إذا استُخدمت قيمه في العنوان)')));
    const fieldsBox = h('div.bld-sec-body');
    sec.fields.forEach((f, fi) => fieldsBox.append(fieldCard(sec, f, fi)));
    fieldsBox.append(h('button.btn.sm.add-btn', { type: 'button', onclick: () => addField(sec) }, icon('plus', 15), 'إضافة حقل'));
    return h('div.bld-sec',
      h('div.bld-sec-head',
        h('span.pill', `قسم ${si + 1}`),
        inp(sec, 'title', { placeholder: 'عنوان القسم' }),
        h('button.icon-btn', { type: 'button', title: 'خيارات القسم', 'aria-label': 'خيارات القسم', onclick: () => { optsOpen.v = !optsOpen.v; opts.hidden = !optsOpen.v; } }, icon('settings')),
        h('button.icon-btn', { type: 'button', title: 'أعلى', 'aria-label': 'نقل القسم للأعلى', disabled: si === 0, onclick: () => moveIn(secs, si, -1) }, icon('up')),
        h('button.icon-btn', { type: 'button', title: 'أسفل', 'aria-label': 'نقل القسم للأسفل', disabled: si === secs.length - 1, onclick: () => moveIn(secs, si, 1) }, icon('down')),
        h('button.icon-btn.danger', { type: 'button', title: 'حذف القسم', 'aria-label': 'حذف القسم', onclick: async () => {
          if (sec.fields.length && !await confirmDialog('حذف القسم', `سيتم حذف القسم «${sec.title}» وجميع حقوله (${sec.fields.length}).`, { okLabel: 'حذف', danger: true })) return;
          secs.splice(si, 1); markDirty(); paint();
        } }, icon('trash'))),
      opts, fieldsBox);
  }

  function addField(sec) {
    const m = modal({
      title: 'اختاري نوع الحقل', wide: true,
      body: h('div.type-grid', Object.entries(FIELD_TYPES).map(([t, meta]) => h('button', { type: 'button', onclick: () => {
        const f = { id: rid(), type: t, label: meta.label, width: ['text', 'number', 'date', 'day', 'select'].includes(t) ? 'half' : 'full' };
        if (['select', 'radio', 'checkbox'].includes(t)) f.options = ['الخيار الأول', 'الخيار الثاني'];
        if (t === 'file') Object.assign(f, { accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx', multiple: true });
        if (t === 'list') Object.assign(f, { defaultItems: 3, addLabel: 'إضافة بند', pdfMinRows: 3 });
        if (t === 'rating') Object.assign(f, { items: ['العنصر الأول', 'العنصر الثاني'], scale: ['ممتاز', 'جيد', 'مقبول'], notes: true, scaleHeader: 'التقدير', itemsHeader: 'العنصر' });
        if (t === 'signatureGrid') Object.assign(f, { perRow: 3, defaultRows: 3, nameLabel: 'اسم الحاضرة', addLabel: 'إضافة صف' });
        if (t === 'date') f.showHijri = true;
        if (t === 'table') Object.assign(f, { columns: [{ label: 'العمود الأول' }, { label: 'العمود الثاني' }], defaultRows: 3, numbered: true, addLabel: 'إضافة صف' });
        if (t === 'day') { const d = allFields(st.schema).find((x) => x.type === 'date'); if (d) f.autoFrom = d.id; f.help = 'يُحدد تلقائيًا من التاريخ'; }
        if (t === 'note') { f.text = 'اكتبي التعليمات هنا'; f.label = ''; }
        sec.fields.push(f); openFields.add(f.id); markDirty(); m.close(); paint();
      } }, h('b', meta.label), h('div.small.muted', t)))),
    });
  }

  function fieldCard(sec, f, fi) {
    const isOpen = openFields.has(f.id);
    const bodyEl = h('div.bld-fld-body', { hidden: !isOpen });
    const title = h('span.t', f.label || (f.type === 'note' ? 'نص إرشادي' : 'بدون عنوان'));
    const paintBody = () => { bodyEl.replaceChildren(...fieldProps(f, () => { title.textContent = f.label || 'بدون عنوان'; })); };
    if (isOpen) paintBody();
    const card = h('div.bld-fld',
      h('div.bld-fld-head', { onclick: (e) => { if (e.target.closest('button')) return; if (openFields.has(f.id)) openFields.delete(f.id); else openFields.add(f.id); bodyEl.hidden = !openFields.has(f.id); if (!bodyEl.hidden && !bodyEl.childElementCount) paintBody(); } },
        h('span.pill.gray', FIELD_TYPES[f.type]?.label || f.type),
        title,
        f.required ? h('span.pill.err', 'مطلوب') : null,
        f.showIf?.field ? h('span.pill', 'مشروط') : null,
        h('button.icon-btn', { type: 'button', title: 'أعلى', 'aria-label': 'نقل الحقل للأعلى', disabled: fi === 0, onclick: () => moveIn(sec.fields, fi, -1) }, icon('up')),
        h('button.icon-btn', { type: 'button', title: 'أسفل', 'aria-label': 'نقل الحقل للأسفل', disabled: fi === sec.fields.length - 1, onclick: () => moveIn(sec.fields, fi, 1) }, icon('down')),
        h('button.icon-btn', { type: 'button', title: 'نسخ الحقل', 'aria-label': 'نسخ الحقل', onclick: () => { const c = clone(f); c.id = rid(); sec.fields.splice(fi + 1, 0, c); openFields.add(c.id); markDirty(); paint(); } }, icon('copy')),
        h('button.icon-btn.danger', { type: 'button', title: 'حذف الحقل', 'aria-label': 'حذف الحقل', onclick: async () => {
          if (!await confirmDialog('حذف الحقل', `حذف الحقل «${f.label || f.type}»؟`, { okLabel: 'حذف', danger: true })) return;
          sec.fields.splice(fi, 1); markDirty(); paint();
        } }, icon('trash'))),
      bodyEl);
    return card;
  }

  function fieldProps(f, onLabel) {
    const t = f.type;
    const others = allFields(st.schema).filter((x) => x.id !== f.id && ['select', 'radio', 'checkbox', 'day'].includes(x.type));
    const out = [];
    if (t !== 'note') out.push(lab('عنوان الحقل *', inp(f, 'label', { onChange: onLabel }), '.two'));
    out.push(lab('المعرّف (إنجليزي، فريد)', inp(f, 'id', { dir: 'ltr' })));
    if (t === 'note') out.push(lab('النص', inp(f, 'text', { type: 'textarea', rows: 3 }), '.full'));
    if (FIELD_TYPES[t]?.simple) out.push(lab('العرض في الشاشة', sel(f, 'width', WIDTHS)));
    if (['text', 'textarea', 'number', 'select'].includes(t)) out.push(lab('نص توضيحي داخل الحقل', inp(f, 'placeholder')));
    if (t !== 'note') out.push(lab('تلميح أسفل الحقل', inp(f, 'help')));
    if (['text', 'textarea'].includes(t)) out.push(lab('أقصى عدد أحرف', inp(f, 'maxLength', { type: 'number' })));
    if (t === 'textarea') out.push(lab('عدد الأسطر', inp(f, 'rows', { type: 'number' })));
    if (t === 'file') {
      out.push(lab('أنواع الملفات المسموحة (accept)', inp(f, 'accept', { placeholder: 'image/*,.pdf,.doc,.docx,.xls,.xlsx' }), '.full'));
      out.push(h('div', { style: { alignSelf: 'end' } }, check(f, 'multiple', 'السماح بإرفاق عدة ملفات', { def: true })));
    }
    if (t === 'number') { out.push(lab('أقل قيمة', inp(f, 'min', { type: 'number' }))); out.push(lab('أكبر قيمة', inp(f, 'max', { type: 'number' }))); }
    if (['text', 'number'].includes(t)) out.push(lab('صيغة العرض في PDF', inp(f, 'pdfFormat', { placeholder: 'مثال: الأسبوع {{value}}' })));
    if (t === 'date') out.push(h('div', { style: { alignSelf: 'end' } }, check(f, 'showHijri', 'إظهار التاريخ الهجري مع الميلادي', { def: true })));
    if (t === 'day') out.push(lab('يُحدد تلقائيًا من حقل التاريخ', sel(f, 'autoFrom', allFields(st.schema).filter((x) => x.type === 'date').map((x) => [x.id, x.label]), { empty: '— بدون —' })));
    if (['select', 'radio', 'checkbox'].includes(t)) {
      out.push(lab('الخيارات (خيار في كل سطر) *', lines(f, 'options'), '.two'));
      out.push(h('div', { style: { alignSelf: 'end' } }, check(f, 'allowOther', 'إضافة خيار «أخرى» مع خانة كتابة')));
    }
    if (t === 'list') {
      out.push(lab('نص توضيحي للبند', inp(f, 'itemPlaceholder')));
      out.push(lab('نص زر الإضافة', inp(f, 'addLabel', { placeholder: 'إضافة بند' })));
      out.push(lab('عدد البنود الافتراضي', inp(f, 'defaultItems', { type: 'number' })));
      out.push(lab('أقل عدد بنود (عند الإلزام)', inp(f, 'minItems', { type: 'number' })));
      out.push(lab('أقصى عدد بنود', inp(f, 'maxItems', { type: 'number' })));
      out.push(lab('أقل عدد أسطر في PDF', inp(f, 'pdfMinRows', { type: 'number' })));
    }
    if (t === 'rating') {
      out.push(lab('العناصر المراد تقييمها (عنصر في كل سطر) *', lines(f, 'items', 'عنصر في كل سطر'), '.full'));
      out.push(lab('درجات التقييم (درجة في كل سطر) *', lines(f, 'scale', 'ممتاز\nجيد\nمقبول')));
      out.push(lab('عنوان عمود العناصر', inp(f, 'itemsHeader', { placeholder: 'العنصر' })));
      out.push(lab('عنوان أعمدة الدرجات', inp(f, 'scaleHeader', { placeholder: 'التقدير' })));
      out.push(h('div', { style: { alignSelf: 'end' } }, check(f, 'notes', 'عمود ملاحظات لكل عنصر', { def: true })));
    }
    if (t === 'signatureGrid') {
      out.push(lab('عدد الأشخاص في كل صف', sel(f, 'perRow', [[1, '1'], [2, '2'], [3, '3'], [4, '4']])));
      out.push(lab('عدد الصفوف الافتراضي', inp(f, 'defaultRows', { type: 'number' })));
      out.push(lab('أقل عدد صفوف في PDF (للتوقيع اليدوي)', inp(f, 'pdfMinRows', { type: 'number' })));
      out.push(lab('نص خانة الاسم', inp(f, 'nameLabel', { placeholder: 'اسم الحاضرة' })));
      out.push(lab('عنوان أول عمود في PDF', inp(f, 'firstHeader', { placeholder: 'الاسم' })));
      out.push(lab('عنوان باقي أعمدة الأسماء', inp(f, 'nameHeader', { placeholder: 'الاسم' })));
      out.push(lab('نص زر الإضافة', inp(f, 'addLabel', { placeholder: 'إضافة صف' })));
    }
    if (t === 'table') {
      const colsTa = h('textarea.inp', { rows: 4, value: (f.columns || []).map((c) => (c.width ? `${c.label} | ${c.width}` : c.label)).join('\n'), placeholder: 'عمود في كل سطر\nيمكن إضافة العرض بالنسبة المئوية: الاسم | 30',
        oninput: (e) => { f.columns = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [label, w] = l.split('|').map((x) => x.trim()); return w && Number(w) ? { label, width: Number(w) } : { label }; }); markDirty(); } });
      out.push(lab('أعمدة الجدول * (عمود في كل سطر)', colsTa, '.two'));
      out.push(lab('عناوين ثابتة للصفوف (اختياري، سطر لكل صف)', lines(f, 'rowLabels', 'مثال:\nالأحد\nالاثنين')));
      out.push(lab('عنوان عمود الصفوف الثابتة', inp(f, 'rowLabelHeader')));
      out.push(lab('عدد الصفوف الافتراضي', inp(f, 'defaultRows', { type: 'number' })));
      out.push(lab('أقصى عدد صفوف', inp(f, 'maxRows', { type: 'number' })));
      out.push(lab('أقل عدد صفوف في PDF', inp(f, 'pdfMinRows', { type: 'number' })));
      out.push(lab('نص زر الإضافة', inp(f, 'addLabel', { placeholder: 'إضافة صف' })));
      out.push(h('div', { style: { alignSelf: 'end' } }, check(f, 'numbered', 'عمود ترقيم (م)', { def: true })));
    }
    // conditions & flags
    if (t !== 'note') {
      f.showIf ||= {};
      const valSel = h('input.inp', { value: f.showIf.equals ?? '', placeholder: 'القيمة', oninput: (e) => { f.showIf.equals = e.target.value; markDirty(); } });
      out.push(lab('إظهار الحقل فقط عندما يكون الحقل', sel(f.showIf, 'field', others.map((x) => [x.id, x.label]), { empty: '— يظهر دائمًا —', onChange: () => { if (!f.showIf.field) delete f.showIf; } })));
      out.push(lab('يساوي القيمة', valSel));
      const flags = h('div.full', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap' } },
        check(f, 'required', 'حقل مطلوب', { onChange: () => paint() }),
        check(f, 'pdfHide', 'إخفاء من PDF'),
        FIELD_TYPES[t]?.simple ? check(f, 'pdfHideLabel', 'إخفاء العنوان في PDF') : null);
      out.push(flags);
    }
    return out;
  }

  // ---------- preview ----------
  function livePreview() {
    const errs = validateSchema(st.schema);
    if (errs.length) { showErrors(errs); return; }
    const schema = { ...clone(st.schema), title: st.title };
    const data = initialData(schema);
    const ui = renderForm(schema, data, () => {});
    const m = modal({
      title: `تجربة: ${st.title || 'نموذج'}`, wide: true,
      body: h('div', h('p.small.muted', 'هذه تجربة فقط — لا يُحفظ أي شيء. عبّئي بعض الحقول ثم اضغطي «معاينة PDF» لرؤية شكل الملف.'), ui.el),
      actions: [
        { label: 'معاينة PDF', kind: 'primary', icon: 'file', keepOpen: true, onClick: async (e) => {
          const b = e.currentTarget; b.classList.add('loading');
          const tab = openPdfTab();
          try {
            await tab.show(await generatePdf(schema, validate(schema, data, { requireAll: false }).clean, settings()));
          } catch (err) { tab.close(); toast(err.message, 'err'); } finally { b.classList.remove('loading'); }
        } },
        { label: 'إغلاق', kind: 'ghost' },
      ],
    });
    void m;
  }

  function showErrors(errs) {
    errBox.replaceChildren(errs.length ? h('div.banner.err', icon('alert'), h('div.grow', h('b', 'يرجى تصحيح ما يلي:'), h('ul', { style: { margin: '4px 0 0', paddingInlineStart: '18px' } }, errs.slice(0, 12).map((e) => h('li', e))))) : '');
    if (errs.length) errBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save({ publish = false } = {}) {
    if (publish) st.status = 'published';
    // clean empty conditions
    for (const f of allFields(st.schema)) if (f.showIf && !f.showIf.field) delete f.showIf;
    const errs = [];
    if (!String(st.title || '').trim()) errs.push('عنوان النموذج مطلوب (في تبويب الإعدادات العامة)');
    errs.push(...validateSchema(st.schema));
    if (errs.length) { showErrors(errs); return; }
    saveBtn.classList.add('loading');
    try {
      const saved = await onSave({ title: st.title, slug: st.slug, description: st.description, tags: st.tags, icon: st.icon, status: st.status, schema: st.schema });
      st.id = saved.id; st.slug = saved.slug; st.version = saved.version; st.status = saved.status;
      dirty = false; root.dataset.dirty = '0'; showErrors([]);
      publishBtn.hidden = st.status === 'published';
      if (publish) toast('تم النشر — أصبح النموذج متاحًا للمعلمات');
      if (tab === 'settings') paint();
    } catch (e) {
      if (publish) st.status = form.status || 'draft';
      showErrors(e.data?.errors || [e.message]);
    } finally { saveBtn.classList.remove('loading'); }
  }

  paint();
  return { el: root, isDirty: () => dirty };
}
