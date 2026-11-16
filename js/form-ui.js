import { h, icon, toLatinDigits } from './common.js';
import { DAYS, dateInfo, isVisible, allFields } from '../shared/core.js';
import { signatureButton } from './signature.js';

let uid = 0;
const nid = (p) => `${p}-${++uid}`;

export function initialData(schema) {
  const d = {};
  for (const f of allFields(schema)) {
    if (f.type === 'list') d[f.id] = Array.from({ length: Math.max(1, Number(f.defaultItems) || 1) }, () => '');
    else if (f.type === 'signatureGrid') d[f.id] = Array.from({ length: (Number(f.perRow) || 3) * Math.max(1, Number(f.defaultRows) || 1) }, () => ({ name: '', sig: '' }));
    else if (f.type === 'rating') d[f.id] = (f.items || []).map(() => ({ r: '', n: '' }));
    else if (f.type === 'table') d[f.id] = Array.from({ length: f.rowLabels?.length || Math.max(1, Number(f.defaultRows) || 3) }, () => (f.columns || []).map(() => ''));
    else if (f.type === 'checkbox') d[f.id] = [];
    else if (f.default != null) d[f.id] = f.default;
  }
  return d;
}

/**
 * Renders a schema as an interactive form.
 * @returns {{ el: HTMLElement, setErrors(errs:Object):void, firstError():HTMLElement|null }}
 */
export function renderForm(schema, data, onChange) {
  const root = h('div.form-ui');
  const fieldEls = new Map();
  const changed = (structural = false) => { refreshVisibility(); onChange?.(structural); };

  for (const sec of schema.sections || []) {
    const body = h('div.fsec-body');
    root.append(h('section.fsec', { 'data-sec': sec.id },
      h('div.fsec-head', h('h2', sec.title), sec.note ? h('span.note', sec.note) : null),
      body));
    for (const f of sec.fields || []) {
      const wrap = renderField(f, data, changed, fieldEls, sec);
      fieldEls.set(f.id, wrap);
      body.append(wrap);
    }
  }

  function refreshVisibility() {
    for (const f of allFields(schema)) {
      const el = fieldEls.get(f.id);
      if (el) el.hidden = !isVisible(f, data);
    }
    for (const s of root.querySelectorAll('.fsec')) {
      s.hidden = ![...s.querySelectorAll('.fld')].some((x) => !x.hidden);
    }
  }
  refreshVisibility();

  return {
    el: root,
    setErrors(errs = {}) {
      for (const [id, el] of fieldEls) {
        const m = errs[id];
        el.classList.toggle('has-err', !!m);
        const e = el.querySelector(':scope > .err-msg');
        if (e) e.textContent = m || '';
        if (m) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      }
    },
    firstError() { return root.querySelector('.fld.has-err:not([hidden])'); },
    refresh: refreshVisibility,
  };
}

function labelFor(f, forId) {
  return h(forId ? 'label' : 'div.lbl', forId ? { for: forId } : null, f.label, f.required ? h('span.req', { 'aria-hidden': 'true' }, '*') : null);
}

function renderField(f, data, changed, fieldEls, sec) {
  const blockLabel = () => ((f.label || '').trim() && f.label.trim() !== (sec?.title || '').trim() ? labelFor(f) : null);
  const w = f.width === 'half' ? '.w-half' : f.width === 'third' ? '.w-third' : '';
  const wrap = h('div.fld' + w, { 'data-field': f.id });
  const id = nid('f');
  const help = f.help ? h('div.help', f.help) : null;
  const err = h('div.err-msg', { role: 'alert' });
  const set = (v, structural) => { data[f.id] = v; wrap.classList.remove('has-err'); changed(structural); };

  switch (f.type) {
    case 'text': case 'number': {
      const inp = h('input.inp', {
        id, type: 'text', value: data[f.id] ?? '', placeholder: f.placeholder || '', maxLength: f.maxLength || (f.type === 'number' ? 12 : 300),
        inputMode: f.type === 'number' ? 'numeric' : null, autocomplete: 'off', required: !!f.required,
        oninput: (e) => {
          let v = e.target.value;
          if (f.type === 'number') { v = toLatinDigits(v).replace(/[^\d.-]/g, ''); if (v !== e.target.value) e.target.value = v; }
          set(v);
        },
      });
      wrap.append(labelFor(f, id), inp, help, err);
      break;
    }
    case 'textarea': {
      const ta = h('textarea.inp', { id, rows: f.rows || 3, placeholder: f.placeholder || '', maxLength: f.maxLength || 5000, value: data[f.id] ?? '', oninput: (e) => set(e.target.value) });
      wrap.append(labelFor(f, id), ta, help, err);
      break;
    }
    case 'date': {
      const hint = h('div.help');
      const paint = () => {
        const i = dateInfo(data[f.id]);
        hint.textContent = i ? (f.showHijri !== false ? `${i.hijri} هـ · الموافق ${i.greg} م · ${i.day}` : `${i.greg} م · ${i.day}`) : (f.help || '');
      };
      const inp = h('input.inp', {
        id, type: 'date', value: data[f.id] ?? '', required: !!f.required,
        onchange: (e) => {
          data[f.id] = e.target.value; wrap.classList.remove('has-err'); paint();
          // update linked "day" fields
          const i = dateInfo(e.target.value);
          for (const [fid, el] of fieldEls) {
            const sel = el.querySelector('select[data-auto-from="' + f.id + '"]');
            if (sel && i) { sel.value = i.day; data[fid] = i.day; el.classList.remove('has-err'); }
          }
          changed();
        },
      });
      paint();
      wrap.append(labelFor(f, id), inp, hint, err);
      break;
    }
    case 'day': case 'select': {
      const opts = f.type === 'day' ? DAYS : (f.options || []);
      const sel = h('select.inp', { id, required: !!f.required, 'data-auto-from': f.type === 'day' ? (f.autoFrom || null) : null, onchange: (e) => { set(e.target.value); paintOther(); } },
        h('option', { value: '' }, f.placeholder || (f.type === 'day' ? 'اختاري اليوم...' : 'اختاري...')),
        opts.map((o) => h('option', { value: o }, o)),
        f.allowOther ? h('option', { value: '__other' }, 'أخرى') : null);
      sel.value = data[f.id] ?? '';
      const other = otherInput(f, data, changed);
      const paintOther = () => { if (other) other.hidden = data[f.id] !== '__other'; };
      paintOther();
      wrap.append(labelFor(f, id), sel, other, help, err);
      break;
    }
    case 'radio': case 'checkbox': {
      const multi = f.type === 'checkbox';
      const grp = h('div.choice-group', { role: multi ? 'group' : 'radiogroup', 'aria-labelledby': id });
      const name = nid('g');
      const cur = () => (multi ? (Array.isArray(data[f.id]) ? data[f.id] : []) : data[f.id]);
      const opts = [...(f.options || []).map((o) => [o, o]), ...(f.allowOther ? [['__other', 'أخرى']] : [])];
      const other = otherInput(f, data, changed);
      const paintOther = () => { if (other) other.hidden = multi ? !cur().includes('__other') : cur() !== '__other'; };
      for (const [val, text] of opts) {
        const checked = multi ? cur().includes(val) : cur() === val;
        grp.append(h('label.choice' + (multi ? '.cb' : ''),
          h('input', {
            type: multi ? 'checkbox' : 'radio', name, value: val, checked,
            onchange: (e) => {
              if (multi) {
                const s = new Set(cur());
                if (e.target.checked) s.add(val); else s.delete(val);
                // keep option order
                set(opts.map((o) => o[0]).filter((x) => s.has(x)));
              } else set(val);
              paintOther();
            },
          }), h('span', text)));
      }
      paintOther();
      wrap.append(h('div.lbl', { id }, f.label, f.required ? h('span.req', '*') : null), grp, other, help, err);
      break;
    }
    case 'signature': {
      wrap.append(h('div.lbl', f.label, f.required ? h('span.req', '*') : null),
        signatureButton({ value: data[f.id] || '', title: f.label || 'التوقيع', onChange: (v) => set(v) }), help || h('div.help', f.required ? '' : 'اختياري'), err);
      break;
    }
    case 'list': {
      const box = h('div.lst');
      const paint = () => {
        const arr = Array.isArray(data[f.id]) ? data[f.id] : (data[f.id] = ['']);
        box.replaceChildren(...arr.map((v, i) => h('div.lst-row',
          h('span.lst-num', String(i + 1)),
          h('textarea.inp', { rows: 2, value: v, placeholder: f.itemPlaceholder || '', maxLength: 2000, 'aria-label': `${f.label} ${i + 1}`, oninput: (e) => { arr[i] = e.target.value; wrap.classList.remove('has-err'); changed(); } }),
          h('button.icon-btn.danger', { type: 'button', 'aria-label': 'حذف البند', title: 'حذف', disabled: arr.length <= 1, onclick: () => { arr.splice(i, 1); paint(); changed(true); } }, icon('trash')))),
        h('button.btn.sm.add-btn', { type: 'button', disabled: arr.length >= (f.maxItems || 60), onclick: () => { arr.push(''); paint(); changed(true); box.querySelectorAll('textarea')[arr.length - 1]?.focus(); } }, icon('plus', 16), f.addLabel || 'إضافة بند'));
      };
      paint();
      wrap.append(blockLabel(), box, help, err);
      break;
    }
    case 'rating': {
      const list = h('div.rate-list');
      if (!Array.isArray(data[f.id])) data[f.id] = [];
      const arr = data[f.id];
      (f.items || []).forEach((it, i) => {
        arr[i] ||= { r: '', n: '' };
        const name = nid('r');
        const row = h('div.rate-row',
          h('span.rate-n', String(i + 1)),
          h('div', it),
          h('div.choice-group', { role: 'radiogroup', 'aria-label': it },
            (f.scale || []).map((s) => h('label.choice', h('input', { type: 'radio', name, value: s, checked: arr[i].r === s, onchange: () => { arr[i].r = s; row.classList.remove('missing'); wrap.classList.remove('has-err'); changed(); } }), h('span', s)))),
          f.notes !== false ? h('div.rate-note', h('input.inp', { type: 'text', placeholder: 'ملاحظات (اختياري)', value: arr[i].n || '', maxLength: 500, 'aria-label': `ملاحظات: ${it}`, oninput: (e) => { arr[i].n = e.target.value; changed(); } })) : null);
        list.append(row);
      });
      wrap.markMissing = () => list.querySelectorAll('.rate-row').forEach((r, i) => r.classList.toggle('missing', !arr[i]?.r));
      wrap.append(blockLabel(), list, help, err);
      break;
    }
    case 'signatureGrid': {
      const per = Math.max(1, Math.min(4, Number(f.perRow) || 3));
      const box = h('div.sg-rows');
      const paint = () => {
        if (!Array.isArray(data[f.id])) data[f.id] = [];
        const arr = data[f.id];
        while (arr.length % per) arr.push({ name: '', sig: '' });
        if (!arr.length) for (let i = 0; i < per; i++) arr.push({ name: '', sig: '' });
        const rows = arr.length / per;
        box.replaceChildren();
        for (let r = 0; r < rows; r++) {
          const people = h('div.sg-people', { style: { '--per': per } });
          for (let c = 0; c < per; c++) {
            const idx = r * per + c; const p = arr[idx];
            people.append(h('div.sg-person',
              h('input.inp', { type: 'text', value: p.name, maxLength: 120, placeholder: `${f.nameLabel || 'الاسم'} ${idx + 1}`, 'aria-label': `${f.nameLabel || 'الاسم'} ${idx + 1}`, oninput: (e) => { p.name = e.target.value; wrap.classList.remove('has-err'); changed(); } }),
              signatureButton({ value: p.sig, title: `توقيع ${p.name || (f.nameLabel || 'الحاضرة') + ' ' + (idx + 1)}`, onChange: (v) => { p.sig = v; changed(); } })));
          }
          box.append(h('div.sg-row',
            h('div.sg-row-head', h('span', `الصف ${r + 1}`),
              h('button.icon-btn.danger', { type: 'button', 'aria-label': `حذف الصف ${r + 1}`, disabled: rows <= 1, onclick: () => { arr.splice(r * per, per); paint(); changed(true); } }, icon('trash'))),
            people));
        }
        box.append(h('button.btn.sm.add-btn', { type: 'button', disabled: arr.length + per > 150, onclick: () => { for (let i = 0; i < per; i++) arr.push({ name: '', sig: '' }); paint(); changed(true); } }, icon('plus', 16), f.addLabel || 'إضافة صف'));
      };
      paint();
      wrap.append(blockLabel(), box, help, err);
      break;
    }
    case 'table': {
      const cols = f.columns || [];
      const fixed = Array.isArray(f.rowLabels) && f.rowLabels.length ? f.rowLabels : null;
      const num = !fixed && f.numbered !== false;
      const box = h('div.ft-wrap');
      const paint = () => {
        if (!Array.isArray(data[f.id])) data[f.id] = [];
        const arr = data[f.id];
        if (fixed) while (arr.length < fixed.length) arr.push(cols.map(() => ''));
        if (!arr.length) arr.push(cols.map(() => ''));
        const tbl = h('table.ft',
          h('thead', h('tr', num ? h('th.n', 'م') : null, fixed ? h('th', f.rowLabelHeader || '') : null, cols.map((c) => h('th', c.label)), fixed ? null : h('th.n', ''))),
          h('tbody', arr.map((row, i) => h('tr',
            num ? h('td.n', { 'data-label': 'م' }, String(i + 1)) : null,
            fixed ? h('th.rl', fixed[i]) : null,
            cols.map((c, j) => h('td', { 'data-label': c.label },
              h('textarea.inp', { rows: 1, value: row[j] || '', maxLength: 1000, 'aria-label': `${c.label} ${fixed ? fixed[i] : i + 1}`,
                oninput: (e) => { row[j] = e.target.value; wrap.classList.remove('has-err'); changed(); } }))),
            fixed ? null : h('td.n', h('button.icon-btn.danger', { type: 'button', 'aria-label': `حذف الصف ${i + 1}`, disabled: arr.length <= 1, onclick: () => { arr.splice(i, 1); paint(); changed(true); } }, icon('trash')))))));
        box.replaceChildren(tbl, fixed ? null : h('button.btn.sm.add-btn', { type: 'button', disabled: arr.length >= (Number(f.maxRows) || 60), onclick: () => { arr.push(cols.map(() => '')); paint(); changed(true); } }, icon('plus', 16), f.addLabel || 'إضافة صف'));
      };
      paint();
      wrap.append(blockLabel(), box, help, err);
      break;
    }
    case 'note':
      wrap.append(h('div.note-box', icon('info'), h('div', { style: { whiteSpace: 'pre-line' } }, f.text || f.label || '')));
      break;
    default:
      wrap.append(h('div.muted', `نوع غير مدعوم: ${f.type}`));
  }
  return wrap;
}

function otherInput(f, data, changed) {
  if (!f.allowOther) return null;
  return h('input.inp.other-inp', { type: 'text', placeholder: 'اكتبي الخيار الآخر...', value: data[f.id + '__other'] || '', maxLength: 300, oninput: (e) => { data[f.id + '__other'] = e.target.value; changed(); } });
}
