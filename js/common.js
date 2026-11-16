// Shared browser helpers: DOM builder, icons, toasts, modals, local storage.
export { esc } from '../shared/core.js';

// Let append()/replaceChildren() accept optional (null/false) children and arrays.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const orig = proto[m];
    proto[m] = function (...nodes) { return orig.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false)); };
  }
}

/** h('div.cls#id', {attrs}, ...children) */
export function h(tag, attrs, ...children) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  (m?.[2] || '').replace(/([.#])([\w-]+)/g, (_, t, n) => { if (t === '.') el.classList.add(n); else el.id = n; });
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v; // only used with trusted/static markup (icons)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') queueMicrotask(() => { el.value = v; }) || (el.value = v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 11h6M9 15h4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  save: '<path d="M5 3h11l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7"/>',
  send: '<path d="m22 2-11 11M22 2l-7 20-4-9-9-4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  eraser: '<path d="m7 21-4-4L14 6l7 7-8 8zM10 10l7 7M7 21h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  external: '<path d="M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.classList.add('ic');
  s.innerHTML = P[name] || P.file;
  return s;
}
export const ICON_NAMES = ['clipboard', 'eye', 'calendar', 'file', 'layers', 'user', 'inbox', 'shield'];

// ---------- toast ----------
let toastWrap;
export function toast(msg, type = 'ok', ms = 3500) {
  toastWrap ||= document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
  const t = h('div.toast.' + type, icon(type === 'err' ? 'alert' : type === 'info' ? 'info' : 'checkCircle'), h('span', msg));
  toastWrap.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); prevFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', h('h3', title), h('button.icon-btn.light', { type: 'button', 'aria-label': 'إغلاق', onclick: close }, icon('x'))),
    h('div.modal-body', body),
    actions.length ? h('div.modal-foot', actions.map((a) => h('button.btn' + (a.kind ? '.' + a.kind : ''), {
      type: 'button', onclick: async (e) => { const r = await a.onClick?.(e, close); if (r !== false && !a.keepOpen) close(); },
    }, a.icon ? icon(a.icon) : null, a.label))) : null);
  const back = h('div.modal-back', { onmousedown: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  setTimeout(() => (box.querySelector('input,textarea,select,canvas') || box.querySelector('.modal-foot .btn'))?.focus(), 30);
  return { close, box };
}
export function confirmDialog(title, message, { okLabel = 'تأكيد', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: h('p.confirm-text', message),
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
        { label: 'إلغاء', kind: 'ghost' },
      ],
    });
  });
}

// ---------- storage (teacher device) ----------
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' }).format(d);
}

export function siteHeader(settings, { admin = false, nav = [] } = {}) {
  const logos = [[settings.logo, settings.logoBox], [settings.logo2, settings.logo2Box]].filter(([l]) => l);
  const clear = logos.length && logos.every(([, b]) => b === false);
  return h('header.topbar', h('div.topbar-in',
    h('a.brand', { href: admin ? 'admin.html' : './' },
      h('span.brand-logos' + (clear ? '.clear' : ''), logos.length ? logos.map(([l]) => h('img', { src: l, alt: '' })) : icon('layers', 22)),
      h('span.brand-title', settings.siteTitle || 'منصة النماذج')),
    h('nav.top-nav', nav)));
}

export function setTitle(t) { document.title = t; }

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const toLatinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
