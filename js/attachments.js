// Temporary per-tab attachments: actual bytes never enter Firestore/localStorage.
const filesByField = new Map();
export function setAttachments(id, files) { filesByField.set(id, [...files]); }
export function getAttachments(id) { return filesByField.get(id) || []; }
export function clearAttachments() { filesByField.clear(); }
export function allAttachments(schema) { return (schema.sections || []).flatMap(s => (s.fields || []).filter(f => f.type === 'file').map(f => ({ field: f, files: getAttachments(f.id) }))); }
