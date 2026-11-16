import { h, icon, siteHeader } from './common.js';
import { getPublicSettings, isConfigured, errText, DEFAULT_SETTINGS } from './fb.js';

export const KEYS = { drafts: 'ef:drafts', auto: (slug) => `ef:auto:${slug}` };
export const formUrl = (slug) => `form.html?f=${encodeURIComponent(slug)}`;

export function shell(settings, main) {
  const app = document.getElementById('app');
  app.replaceChildren(
    siteHeader(settings, { nav: [h('a.nav-btn.active', { href: './' }, icon('home', 16), h('span', 'النماذج'))] }),
    h('main', main),
    h('footer.site-foot', h('b', settings.schoolName || ''),
      h('span', icon('shield', 14), 'بياناتك لا تُرسل إلى أي خادم: يُنشأ ملف PDF داخل متصفحك، وتُحفظ المسودات على جهازك فقط.')));
}

export async function loadSettings() {
  if (!isConfigured) return { ...DEFAULT_SETTINGS, error: 'الموقع قيد الإعداد: لم يتم ربطه بـ Firebase بعد.' };
  try { return await getPublicSettings(); } catch (e) { return { ...DEFAULT_SETTINGS, error: errText(e) }; }
}
