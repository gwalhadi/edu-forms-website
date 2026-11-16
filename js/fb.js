// Data layer: Firebase (Firestore Lite + Auth). Everything that talks to Firebase lives here.
//
// Firestore layout
//   forms/{slug}        { slug, title, description, tags[], icon, status, sortOrder, version, schema (JSON string), createdAt, updatedAt }
//   site/settings       school identity texts and options (public)
//   images/{key}        { dataUrl, public, updatedAt }   key = logo | logo2 | principalSig | stamp
//   pdfFiles/{fileId}   { name, size, chunks, createdAt }  original PDF of a "PDF form" (blank template, no answers)
//   pdfFiles/{fileId}/chunks/{n}  { data }  base64 pieces (≤ 900 KB each; Firestore documents are limited to 1 MiB)
//
// Teachers' answers and PDFs are never sent anywhere: they stay in the browser.
import { initializeApp } from '../vendor/firebase/firebase-app.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, collection, query, where, writeBatch, serverTimestamp,
} from '../vendor/firebase/firebase-firestore-lite.js';
import { firebaseConfig, adminUid } from './firebase-config.js';

export const DEFAULT_SETTINGS = {
  siteTitle: 'منصة النماذج',
  heroTitle: 'النماذج',
  heroSubtitle: 'اختاري النموذج، عبّئيه، ووقّعيه، ثم نزّلي ملف PDF بنفس تصميم النموذج الرسمي.',
  line1: 'المملكة العربية السعودية',
  line2: 'وزارة التعليم',
  department: '',
  schoolName: '',
  principalTitle: 'مديرة المدرسة',
  principalName: '',
  logoSize: 46,
  logo2Size: 46,
  headerAlign: 'right',
  logoBox: true,
  logo2Box: true,
  sigSize: 50,
  stampSize: 80,
  principalAlign: 'center',
  stampMode: 'beside',
  marksPublic: false, // principal signature + stamp visible to teachers (and inserted in their PDFs)
  footerNote: '',
};
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
export const IMAGE_KEYS = ['logo', 'logo2', 'principalSig', 'stamp'];
export const MARK_KEYS = ['principalSig', 'stamp'];
export const MAX_IMAGE_CHARS = 900_000; // a Firestore document is limited to 1 MiB
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export const isConfigured = !Object.values(firebaseConfig).some((v) => String(v).includes('PASTE_'));
export const ADMIN_UID = String(adminUid || '').includes('PASTE_') ? '' : String(adminUid || '');

let app; let db;
function fs() {
  if (!isConfigured) throw Object.assign(new Error('لم يتم ربط الموقع بـ Firebase بعد (js/firebase-config.js).'), { code: 'not-configured' });
  app ||= initializeApp(firebaseConfig);
  db ||= getFirestore(app);
  return db;
}

/** Arabic message for a Firebase error. */
export function errText(e) {
  const c = String(e?.code || '');
  if (c === 'not-configured') return e.message;
  if (c.includes('permission-denied')) return 'ليست لديك صلاحية لهذه العملية. تأكدي من تسجيل الدخول بحساب المالكة ومن قواعد الأمان.';
  if (c.includes('unavailable') || c.includes('network') || /fetch|network|offline/i.test(String(e?.message || ''))) return 'تعذر الاتصال. تحققي من الاتصال بالإنترنت ثم حاولي مجددًا.';
  if (c.includes('resource-exhausted') || c.includes('quota')) return 'تم تجاوز الحد اليومي المجاني مؤقتًا. حاولي لاحقًا.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) return 'البريد أو كلمة المرور غير صحيحة';
  if (c.includes('too-many-requests')) return 'محاولات كثيرة، حاولي بعد قليل';
  if (c.includes('weak-password')) return 'كلمة المرور ضعيفة (٦ أحرف على الأقل، ويُفضّل ١٠ أو أكثر)';
  if (c.includes('requires-recent-login')) return 'لأمان حسابك سجّلي الخروج ثم الدخول مرة أخرى وأعيدي المحاولة';
  return e?.message || 'حدث خطأ غير متوقع';
}

// ---------- shape conversion ----------
function toForm(snap) {
  const d = snap.data();
  let schema = null;
  try { schema = JSON.parse(d.schema || 'null'); } catch { schema = null; }
  return {
    id: snap.id, slug: snap.id, title: d.title || '', description: d.description || '', tags: Array.isArray(d.tags) ? d.tags : [],
    icon: d.icon || 'clipboard', status: d.status || 'draft', sortOrder: Number(d.sortOrder) || 0, version: Number(d.version) || 1,
    updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : (d.updatedAt || ''), schema,
  };
}
const bySort = (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ar');
function cleanSettings(s) {
  const out = {};
  for (const k of SETTING_KEYS) {
    const v = s?.[k];
    const d = DEFAULT_SETTINGS[k];
    if (v === undefined || v === null) out[k] = d;
    else if (typeof d === 'number') out[k] = Number.isFinite(Number(v)) ? Number(v) : d;
    else if (typeof d === 'boolean') out[k] = v === true;
    else out[k] = String(v).slice(0, 400);
  }
  return out;
}

// ================= PUBLIC (teachers) =================
async function readImage(key) {
  try {
    const s = await getDoc(doc(fs(), 'images', key));
    return s.exists() ? String(s.data().dataUrl || '') : '';
  } catch { return ''; } // missing or private image → not shown
}

/** School identity with images (data URLs). Signature/stamp only when the owner made them public. */
export async function getPublicSettings() {
  const snap = await getDoc(doc(fs(), 'site', 'settings'));
  const s = cleanSettings(snap.exists() ? snap.data() : {});
  const keys = s.marksPublic ? IMAGE_KEYS : IMAGE_KEYS.filter((k) => !MARK_KEYS.includes(k));
  const imgs = await Promise.all(keys.map(readImage));
  for (const k of IMAGE_KEYS) s[k] = '';
  keys.forEach((k, i) => { s[k] = imgs[i]; });
  s.initialized = snap.exists();
  return s;
}

export async function listPublishedForms() {
  const snap = await getDocs(query(collection(fs(), 'forms'), where('status', '==', 'published')));
  return snap.docs.map(toForm).sort(bySort);
}

/** A published form (or any form for the signed-in owner). Returns null when unavailable. */
export async function getForm(slug) {
  if (!SLUG_RE.test(slug)) return null;
  try {
    const s = await getDoc(doc(fs(), 'forms', slug));
    return s.exists() ? toForm(s) : null;
  } catch (e) {
    if (String(e?.code || '').includes('permission-denied')) return null; // unpublished or deleted
    throw e;
  }
}

// ================= AUTH (owner) =================
let authMod; let auth;
async function authApi() {
  fs();
  authMod ||= await import('../vendor/firebase/firebase-auth.js');
  auth ||= authMod.getAuth(app);
  return { m: authMod, auth };
}
export async function onAuth(cb) { const { m, auth: a } = await authApi(); return m.onAuthStateChanged(a, cb); }
export async function waitForUser() {
  const { m, auth: a } = await authApi();
  await a.authStateReady?.();
  return new Promise((resolve) => { const off = m.onAuthStateChanged(a, (u) => { off(); resolve(u); }); });
}
export async function login(email, password) { const { m, auth: a } = await authApi(); return (await m.signInWithEmailAndPassword(a, email, password)).user; }
export async function logout() { const { m, auth: a } = await authApi(); await m.signOut(a); }
export async function resetPassword(email) { const { m, auth: a } = await authApi(); a.languageCode = 'ar'; await m.sendPasswordResetEmail(a, email); }
export async function changePassword(current, next) {
  const { m, auth: a } = await authApi();
  const u = a.currentUser;
  if (!u) throw new Error('سجّلي الدخول أولًا');
  await m.reauthenticateWithCredential(u, m.EmailAuthProvider.credential(u.email, current));
  await m.updatePassword(u, next);
}
export async function currentUser() { const { auth: a } = await authApi(); return a.currentUser; }

// ================= ADMIN (owner) =================
export async function adminListForms() {
  const snap = await getDocs(collection(fs(), 'forms'));
  return snap.docs.map(toForm).sort(bySort);
}
export async function adminGetForm(slug) {
  const s = await getDoc(doc(fs(), 'forms', slug));
  return s.exists() ? toForm(s) : null;
}
export async function slugExists(slug) { return (await getDoc(doc(fs(), 'forms', slug))).exists(); }

function formDoc(f, extra = {}) {
  return {
    slug: f.slug,
    title: String(f.title || '').trim().slice(0, 200),
    description: String(f.description || '').slice(0, 1000),
    tags: (Array.isArray(f.tags) ? f.tags : []).map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 10),
    icon: String(f.icon || 'clipboard').slice(0, 30),
    status: ['draft', 'published', 'inactive'].includes(f.status) ? f.status : 'draft',
    sortOrder: Number(f.sortOrder) || 0,
    version: Number(f.version) || 1,
    schema: JSON.stringify(f.schema),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

/** Creates or updates a form. oldSlug = current document id (null for a new form). Handles slug renames. */
export async function adminSaveForm(oldSlug, f) {
  const d = fs();
  if (!SLUG_RE.test(f.slug)) throw new Error('الرابط المختصر يقبل الحروف الإنجليزية الصغيرة والأرقام والشرطة فقط');
  if (oldSlug === f.slug) {
    const cur = await adminGetForm(oldSlug);
    const changed = JSON.stringify(cur?.schema) !== JSON.stringify(f.schema);
    await setDoc(doc(d, 'forms', f.slug), formDoc({ ...f, sortOrder: cur?.sortOrder ?? f.sortOrder, version: (cur?.version || 1) + (changed ? 1 : 0) }));
  } else {
    if (await slugExists(f.slug)) throw new Error('الرابط المختصر مستخدم لنموذج آخر');
    const b = writeBatch(d);
    let sortOrder = f.sortOrder;
    let version = 1;
    if (oldSlug) {
      const cur = await adminGetForm(oldSlug);
      sortOrder = cur?.sortOrder ?? sortOrder; version = cur?.version || 1;
      b.delete(doc(d, 'forms', oldSlug));
    } else if (sortOrder == null) {
      sortOrder = (await adminListForms()).reduce((m, x) => Math.max(m, x.sortOrder + 1), 0);
    }
    b.set(doc(d, 'forms', f.slug), formDoc({ ...f, sortOrder, version }, { createdAt: serverTimestamp() }));
    await b.commit();
  }
  return adminGetForm(f.slug);
}
export async function adminSetStatus(slug, status) { await updateDoc(doc(fs(), 'forms', slug), { status, updatedAt: serverTimestamp() }); }
export async function adminDeleteForm(slug) { await deleteDoc(doc(fs(), 'forms', slug)); }
export async function adminReorder(slugs) {
  const b = writeBatch(fs());
  slugs.forEach((s, i) => b.update(doc(fs(), 'forms', s), { sortOrder: i }));
  await b.commit();
}
export async function freeSlug(base) {
  let s = base.slice(0, 50).replace(/-+$/, '') || 'form';
  if (!(await slugExists(s))) return s;
  for (let i = 2; i < 100; i++) { const c = `${s}-${i}`; if (!(await slugExists(c))) return c; }
  return `${s}-${Date.now().toString(36)}`;
}

/** All settings + every image (the owner may read private images). */
export async function adminGetSettings() {
  const d = fs();
  const snap = await getDoc(doc(d, 'site', 'settings'));
  const s = cleanSettings(snap.exists() ? snap.data() : {});
  const imgs = await Promise.all(IMAGE_KEYS.map(async (k) => {
    const x = await getDoc(doc(d, 'images', k));
    return x.exists() ? String(x.data().dataUrl || '') : '';
  }));
  IMAGE_KEYS.forEach((k, i) => { s[k] = imgs[i]; });
  s.initialized = snap.exists();
  return s;
}

/** Saves settings; images are written only when changed (prev = settings as loaded). */
export async function adminSaveSettings(next, prev = {}) {
  const d = fs();
  const clean = cleanSettings(next);
  const b = writeBatch(d);
  b.set(doc(d, 'site', 'settings'), { ...clean, updatedAt: serverTimestamp() });
  for (const k of IMAGE_KEYS) {
    const v = String(next[k] || '');
    const pub = MARK_KEYS.includes(k) ? clean.marksPublic : true;
    if (v && v.length > MAX_IMAGE_CHARS) throw new Error('إحدى الصور كبيرة جدًا، استخدمي صورة أصغر');
    if (v && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v)) throw new Error('صيغة صورة غير صالحة');
    const changed = v !== String(prev[k] || '') || (MARK_KEYS.includes(k) && clean.marksPublic !== prev.marksPublic);
    if (!changed && prev.initialized) continue;
    if (v) b.set(doc(d, 'images', k), { dataUrl: v, public: pub, updatedAt: serverTimestamp() });
    else b.delete(doc(d, 'images', k));
  }
  await b.commit();
  return adminGetSettings();
}

// ---------- backup ----------
export async function exportBackup() {
  const [settings, forms] = await Promise.all([adminGetSettings(), adminListForms()]);
  const images = {};
  for (const k of IMAGE_KEYS) { if (settings[k]) images[k] = settings[k]; delete settings[k]; }
  delete settings.initialized;
  const pdfFiles = {};
  for (const id of new Set(forms.map(pdfFileIdOf).filter(Boolean))) {
    try { pdfFiles[id] = await exportPdfFile(id); } catch (e) { console.warn('pdf file missing', id, e); }
  }
  return {
    format: 'edu-forms-backup', version: 1, exportedAt: new Date().toISOString(), settings, images,
    forms: forms.map(({ slug, title, description, tags, icon, status, sortOrder, schema }) => ({ slug, title, description, tags, icon, status, sortOrder, schema })),
    ...(Object.keys(pdfFiles).length ? { pdfFiles } : {}),
  };
}

/**
 * Restores a backup. mode 'merge' keeps forms not in the file; 'replace' deletes them.
 * validateSchema is passed in to avoid a circular import.
 */
export async function importBackup(obj, { mode = 'merge', withSettings = true, validateSchema }) {
  if (!obj || obj.format !== 'edu-forms-backup' || !Array.isArray(obj.forms)) throw new Error('الملف ليس نسخة احتياطية صالحة لهذه المنصة');
  for (const f of obj.forms) {
    if (!SLUG_RE.test(String(f.slug || ''))) throw new Error(`رابط مختصر غير صالح: ${f.slug}`);
    const errs = validateSchema(f.schema);
    if (errs.length) throw new Error(`«${f.title}»: ${errs[0]}`);
  }
  const d = fs();
  // original PDFs of "PDF forms" first, so that a restored form never points at a missing file
  for (const [id, f] of Object.entries(obj.pdfFiles || {})) await importPdfFile(id, f);
  const existing = await adminListForms();
  const b = writeBatch(d);
  if (mode === 'replace') for (const f of existing) if (!obj.forms.some((x) => x.slug === f.slug)) b.delete(doc(d, 'forms', f.slug));
  obj.forms.forEach((f, i) => b.set(doc(d, 'forms', f.slug), formDoc({ ...f, sortOrder: f.sortOrder ?? i }, { createdAt: serverTimestamp() })));
  await b.commit();
  if (withSettings && obj.settings) {
    await adminSaveSettings({ ...obj.settings, ...(obj.images || {}) }, {});
  }
  return obj.forms.length;
}


// ================= ORIGINAL PDF FILES ("PDF forms") =================
// The blank PDF uploaded by the owner is stored in Firestore in base64 pieces, because Cloud Storage is not
// available on the free Spark plan for new projects. Teachers only read it; their answers are never sent.
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PDF_CHUNK = 900_000; // base64 characters per document
export const PDF_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
export const pdfFileIdOf = (form) => (form?.schema?.mode === 'pdf' ? form.schema.pdfTemplate?.fileId || '' : '');

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const newPdfId = () => 'p' + Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

/** Reads an original PDF (public read; used by teachers and the owner). */
export async function getPdfFile(id) {
  if (!PDF_ID_RE.test(String(id || ''))) throw new Error('ملف PDF غير صالح');
  const d = fs();
  const meta = await getDoc(doc(d, 'pdfFiles', id));
  if (!meta.exists()) throw Object.assign(new Error('ملف PDF الأصلي لهذا النموذج غير موجود'), { code: 'pdf-missing' });
  const n = Number(meta.data().chunks) || 0;
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(doc(d, 'pdfFiles', id, 'chunks', String(i)))));
  if (parts.some((x) => !x.exists())) throw Object.assign(new Error('ملف PDF الأصلي غير مكتمل'), { code: 'pdf-missing' });
  const bytes = b64ToBytes(parts.map((x) => String(x.data().data || '')).join(''));
  if (meta.data().size && bytes.length !== Number(meta.data().size)) throw new Error('ملف PDF الأصلي تالف');
  return bytes;
}

async function writePdfB64(id, b64, { name = '', size = 0, onProgress } = {}) {
  const d = fs();
  const n = Math.max(1, Math.ceil(b64.length / PDF_CHUNK));
  for (let i = 0; i < n; i += 4) { // ≤ 4 pieces (~3.6 MB) per request
    const b = writeBatch(d);
    for (let j = i; j < Math.min(n, i + 4); j++) b.set(doc(d, 'pdfFiles', id, 'chunks', String(j)), { data: b64.slice(j * PDF_CHUNK, (j + 1) * PDF_CHUNK) });
    await b.commit();
    onProgress?.(Math.min(n, i + 4), n);
  }
  // the description is written last: a file is only "complete" when it exists
  await setDoc(doc(d, 'pdfFiles', id), { name: String(name).slice(0, 200), size: Number(size) || 0, chunks: n, createdAt: serverTimestamp() });
}

/** Uploads a new original PDF and returns its id. */
export async function adminSavePdfFile(bytes, { name = '', onProgress } = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('الملف فارغ');
  if (bytes.length > MAX_PDF_BYTES) throw new Error('حجم ملف PDF أكبر من ١٠ ميجابايت');
  const id = newPdfId();
  await writePdfB64(id, bytesToB64(bytes), { name, size: bytes.length, onProgress });
  return id;
}

/** Deletes an original PDF (only call it when no form uses it any more). */
export async function adminDeletePdfFile(id) {
  if (!PDF_ID_RE.test(String(id || ''))) return;
  const d = fs();
  const chunks = await getDocs(collection(d, 'pdfFiles', id, 'chunks'));
  const b = writeBatch(d);
  chunks.docs.forEach((c) => b.delete(c.ref));
  b.delete(doc(d, 'pdfFiles', id));
  await b.commit();
}

/** Deletes the original PDF of a deleted/changed form when no other form still uses it. */
export async function adminCleanupPdfFile(id) {
  if (!id) return;
  const forms = await adminListForms();
  if (forms.some((f) => pdfFileIdOf(f) === id)) return;
  await adminDeletePdfFile(id);
}

async function exportPdfFile(id) {
  const d = fs();
  const meta = await getDoc(doc(d, 'pdfFiles', id));
  const bytes = await getPdfFile(id);
  return { name: meta.data()?.name || '', size: bytes.length, data: bytesToB64(bytes) };
}
export { exportPdfFile as adminExportPdfFile };

/** Restores an original PDF from a backup / exported form (kept as is when it already exists). */
export async function importPdfFile(id, f) {
  if (!PDF_ID_RE.test(String(id || '')) || !f || typeof f.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(f.data)) throw new Error('ملف PDF في النسخة الاحتياطية غير صالح');
  if ((await getDoc(doc(fs(), 'pdfFiles', id))).exists()) return;
  if (f.data.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4) throw new Error('ملف PDF في النسخة الاحتياطية كبير جدًا');
  await writePdfB64(id, f.data, { name: f.name || '', size: Math.floor(f.data.length * 3 / 4) - (f.data.endsWith('==') ? 2 : f.data.endsWith('=') ? 1 : 0) });
}
