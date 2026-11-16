import { h, icon, modal } from './common.js';

/** Opens the signing dialog. Resolves with a PNG data URL, '' (cleared) or null (cancelled). */
export function openSignaturePad(title = 'التوقيع', existing = '') {
  return new Promise((resolve) => {
    const canvas = h('canvas', { 'aria-label': 'لوحة التوقيع', tabindex: '0' });
    const wrap = h('div.pad-wrap', canvas);
    let drawn = false; let settled = false;
    const strokes = [];
    let ctx; let ratio = 1;

    const setup = () => {
      ratio = Math.max(1, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * ratio);
      canvas.height = Math.round(r.height * ratio);
      ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1b1d5c'; ctx.lineWidth = 2.4;
      redraw();
    };
    const redraw = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of strokes) {
        ctx.beginPath();
        s.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y + 0.1);
        ctx.stroke();
      }
    };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let cur = null;
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); cur = [pos(e)]; strokes.push(cur); drawn = true; redraw(); });
    canvas.addEventListener('pointermove', (e) => { if (!cur) return; e.preventDefault(); cur.push(pos(e)); redraw(); });
    const end = () => { cur = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

    // load an existing signature as background stroke-less image
    let existingImg = null;
    if (existing) { existingImg = new Image(); existingImg.src = existing; }

    const exportPNG = () => {
      // crop to the drawn area, padded, and limit size
      const pts = strokes.flat();
      if (!pts.length) return '';
      const pad = 8;
      const minX = Math.max(0, Math.min(...pts.map((p) => p.x)) - pad);
      const minY = Math.max(0, Math.min(...pts.map((p) => p.y)) - pad);
      const maxX = Math.max(...pts.map((p) => p.x)) + pad;
      const maxY = Math.max(...pts.map((p) => p.y)) + pad;
      const w = maxX - minX; const hh = maxY - minY;
      const scale = Math.min(2, 600 / w, 240 / hh);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(w * scale)); out.height = Math.max(1, Math.round(hh * scale));
      const o = out.getContext('2d');
      o.scale(scale, scale); o.translate(-minX, -minY);
      o.lineCap = 'round'; o.lineJoin = 'round'; o.strokeStyle = '#1b1d5c'; o.lineWidth = 2.6;
      for (const s of strokes) {
        o.beginPath(); s.forEach((p, i) => (i ? o.lineTo(p.x, p.y) : o.moveTo(p.x, p.y)));
        if (s.length === 1) o.lineTo(s[0].x + 0.1, s[0].y + 0.1);
        o.stroke();
      }
      return out.toDataURL('image/png');
    };

    const body = h('div',
      h('p.small.muted', { style: { margin: '0 0 10px' } }, 'وقّعي بإصبعك أو بالقلم أو بالفأرة داخل المربع. يمكنك ترك التوقيع فارغًا لتوقيعه يدويًا على النسخة المطبوعة.'),
      wrap,
      existingImg ? h('div.small.muted', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' } }, 'التوقيع الحالي:', h('img', { src: existing, style: { height: '36px' }, alt: 'التوقيع الحالي' })) : null);

    const m = modal({
      title,
      body,
      onClose: () => { window.removeEventListener('resize', setup); if (!settled) resolve(null); },
      actions: [
        { label: 'اعتماد التوقيع', kind: 'primary', icon: 'check', onClick: () => { settled = true; resolve(drawn ? exportPNG() : (existing || '')); } },
        { label: 'مسح', icon: 'eraser', keepOpen: true, onClick: () => { strokes.length = 0; drawn = false; redraw(); } },
        { label: 'إلغاء', kind: 'ghost' },
      ],
    });
    m.box.querySelector('.modal-foot').append(
      h('button.btn.ghost', { type: 'button', style: { marginInlineStart: 'auto', color: 'var(--err)' }, hidden: !existing, onclick: () => { settled = true; resolve(''); m.close(); } }, icon('trash'), 'إزالة التوقيع'));
    requestAnimationFrame(setup);
    window.addEventListener('resize', setup);
  });
}

/** A button that shows the signature thumbnail once signed. */
export function signatureButton({ value, title, onChange, label = 'توقيع' }) {
  const btn = h('button.sig-btn', { type: 'button' });
  const paint = (v) => {
    btn.replaceChildren();
    btn.classList.toggle('signed', !!v);
    if (v) { btn.append(h('img', { src: v, alt: 'توقيع' })); btn.setAttribute('aria-label', `${title}: تم التوقيع، اضغطي للتعديل`); }
    else { btn.append(icon('pen', 16), label); btn.setAttribute('aria-label', title); }
  };
  paint(value);
  btn.addEventListener('click', async () => {
    const r = await openSignaturePad(title, value);
    if (r === null) return;
    value = r; paint(r); onChange(r);
  });
  return btn;
}
