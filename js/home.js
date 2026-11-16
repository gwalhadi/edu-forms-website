import { h, icon, store, fmtDateTime, toast, confirmDialog, setTitle } from './common.js';
import { shell, loadSettings, KEYS, formUrl } from './teacher-shell.js';
import { listPublishedForms, errText } from './fb.js';

const settings = await loadSettings();
setTitle(settings.siteTitle || 'النماذج');

let forms = [];
let loadError = settings.error || '';
if (!loadError) { try { forms = await listPublishedForms(); } catch (e) { loadError = errText(e); } }

const q = h('input', { type: 'search', placeholder: 'ابحثي عن نموذج أو مسودة...', 'aria-label': 'بحث', oninput: () => paint() });
const formsBox = h('div');
const draftsBox = h('div');

shell(settings, [
  h('section.hero', h('h1', settings.heroTitle || settings.siteTitle), h('p', settings.heroSubtitle || ''), h('div.search', icon('search'), q)),
  h('div.wrap.lift',
    formsBox,
    h('div.section-head', h('h2', 'المسودات المحفوظة على هذا الجهاز')), draftsBox),
]);

const match = (s) => !q.value.trim() || String(s).toLowerCase().includes(q.value.trim().toLowerCase());

function paint() {
  const list = forms.filter((f) => match(f.title + ' ' + f.description + ' ' + f.tags.join(' ')));
  formsBox.replaceChildren(
    loadError ? h('div.banner.err', icon('alert'), loadError)
      : list.length ? h('div.cards', list.map((f) => h('article.card.form-card',
        h('div.fc-head', h('span.badge-ic', icon(f.icon || 'clipboard', 20)), h('h3', f.title)),
        h('p', f.description),
        f.tags.length ? h('div.tags', f.tags.map((t) => h('span.tag', t))) : null,
        h('a.btn.primary.block', { href: formUrl(f.slug) }, 'فتح النموذج', icon('arrowLeft', 16)))))
        : h('div.empty', forms.length ? 'لا توجد نماذج مطابقة للبحث.' : 'لا توجد نماذج متاحة حاليًا.'));

  const drafts = (store.get(KEYS.drafts, []) || []).filter((d) => match(d.formTitle + ' ' + (d.label || ''))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  draftsBox.replaceChildren(drafts.length ? h('div.list-rows', drafts.map((d) => h('div.row-item',
    h('span.badge-ic', icon('save', 18)),
    h('div.grow', h('b', d.formTitle), h('span.small.muted', `${d.label ? d.label + ' · ' : ''}آخر تعديل ${fmtDateTime(d.updatedAt)}`)),
    h('a.btn.sm.soft', { href: `${formUrl(d.slug)}&draft=${encodeURIComponent(d.id)}` }, icon('edit', 15), 'متابعة'),
    h('button.icon-btn.danger', {
      type: 'button', 'aria-label': 'حذف المسودة', title: 'حذف المسودة',
      onclick: async () => {
        if (!await confirmDialog('حذف المسودة', 'هل تريدين حذف هذه المسودة نهائيًا من جهازك؟', { okLabel: 'حذف', danger: true })) return;
        store.set(KEYS.drafts, (store.get(KEYS.drafts, []) || []).filter((x) => x.id !== d.id));
        toast('تم حذف المسودة'); paint();
      },
    }, icon('trash')))))
    : h('div.empty', 'لا توجد مسودات بعد. عند تعبئة نموذج اضغطي «حفظ كمسودة» لتجديه هنا (على هذا الجهاز فقط).'));
}
paint();
