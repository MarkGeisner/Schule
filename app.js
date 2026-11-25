'use strict';
/* Lehrer-Assistent – alle Daten bleiben lokal auf dem Gerät (localStorage + IndexedDB). */

// ====================================================================
// Grundlagen
// ====================================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const byId = (arr, id) => arr.find(x => x.id === id);

const CATS = ['Unterricht', 'Vorbereitung', 'Korrektur', 'Konferenz / Besprechung', 'Elternarbeit', 'Projekte', 'Verwaltung', 'Fortbildung', 'Sonstiges'];
const CAT_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#64748b', '#ca8a04', '#a8a29e'];
const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#ca8a04', '#4f46e5', '#0d9488', '#64748b', '#7c2d12'];
const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const DAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const PROJECT_TYPES = ['Erasmus+', 'Fachschaft', 'AG', 'Klassenfahrt', 'Schulentwicklung', 'Wettbewerb', 'Sonstiges'];
const MAT_STATUS = { vorhanden: 'Vorhanden', arbeit: 'In Arbeit', geplant: 'Noch erstellen' };
const MAT_STATUS_CLS = { vorhanden: 'ok', arbeit: 'warn', geplant: 'bad' };

// ---------- Datum & Zeit ----------
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseIso = iso => new Date(iso + 'T00:00:00');
const addDays = (iso, n) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const weekday = iso => (parseIso(iso).getDay() + 6) % 7; // 0 = Montag
const weekStart = iso => addDays(iso, -weekday(iso));
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const fmtDateShort = iso => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${DAYS_SHORT[weekday(iso)]}, ${d}.${m}.`; };
const fmtTime = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}:${pad(m % 60)} h`; };
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const kw = iso => { const d = parseIso(iso); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7); };

// ====================================================================
// Speicher
// ====================================================================
const KEY = 'lehrerassistent.v1';
function emptyState() {
  return {
    version: 1, subjects: [], units: [], materials: [], tasks: [], projects: [], timeEntries: [], timetable: [], timer: null,
    settings: { name: '', logineoUrl: '', periods: 8, weeklyHours: 41 },
  };
}
function migrate(d) {
  const e = emptyState();
  for (const k in e) if (d[k] === undefined) d[k] = e[k];
  d.settings = { ...e.settings, ...d.settings };
  return d;
}
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.version) return migrate(d); } catch (e) { /* leer starten */ }
  return emptyState();
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); }
}

// Dateien (Arbeitsblätter, PDFs …) liegen in IndexedDB
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('lehrerassistent-dateien', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('files', mode); const st = t.objectStore('files');
      const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  };
  return {
    put: (k, v) => tx('readwrite', s => s.put(v, k)),
    get: k => tx('readonly', s => s.get(k)),
    del: k => tx('readwrite', s => s.delete(k)),
    keys: () => tx('readonly', s => s.getAllKeys()),
    clear: () => tx('readwrite', s => s.clear()),
  };
})();

// ====================================================================
// Abfragen
// ====================================================================
const subj = id => byId(S.subjects, id);
const proj = id => byId(S.projects, id);
const unitsOf = sid => S.units.filter(u => u.subjectId === sid);
const allLessons = () => S.units.flatMap(u => u.lessons.map(l => ({ ...l, unit: u })));

function lessonStatus(l) {
  if (l.noMaterial) return 'ok';
  const ms = (l.materialIds || []).map(id => byId(S.materials, id)).filter(Boolean);
  if (!ms.length) return 'fehlt';
  return ms.every(m => m.status === 'vorhanden') ? 'ok' : 'teil';
}
const STATUS_LABEL = { ok: ['ok', 'Material da'], teil: ['warn', 'Teilweise'], fehlt: ['bad', 'Material fehlt'] };
const statusChip = st => `<span class="chip ${STATUS_LABEL[st][0]}">${STATUS_LABEL[st][1]}</span>`;
function coverage(lessons) {
  if (!lessons.length) return null;
  return lessons.filter(l => lessonStatus(l) === 'ok').length / lessons.length;
}
function sortLessons(u) {
  // Datierte Stunden chronologisch, undatierte behalten ihre Reihenfolge am Ende
  const dated = u.lessons.filter(l => l.date).sort((a, b) => a.date.localeCompare(b.date));
  u.lessons = [...dated, ...u.lessons.filter(l => !l.date)];
}
function materialUses(mid) {
  return allLessons().filter(l => (l.materialIds || []).includes(mid));
}
function nextLessonFor(subjectId, klasse) {
  const t = today();
  const cands = S.units
    .filter(u => u.subjectId === subjectId && (!klasse || !u.klasse || u.klasse.trim().toLowerCase() === klasse.trim().toLowerCase()))
    .flatMap(u => u.lessons.filter(l => !l.done && (!l.date || l.date >= t)).map(l => ({ l, u })));
  cands.sort((a, b) => (a.l.date || '9999').localeCompare(b.l.date || '9999'));
  return cands[0] || null;
}
function upcomingMissing(days) {
  const t = today(), until = addDays(t, days);
  return allLessons().filter(l => !l.done && l.date && l.date >= t && l.date <= until && lessonStatus(l) !== 'ok')
    .sort((a, b) => a.date.localeCompare(b.date));
}
function entriesBetween(fromIso, toIso) {
  const from = parseIso(fromIso).getTime(), to = parseIso(toIso).getTime();
  return S.timeEntries.filter(e => e.start >= from && e.start < to).sort((a, b) => a.start - b.start);
}
function sumBetween(fromIso, toIso, filter = () => true) {
  let ms = entriesBetween(fromIso, toIso).filter(filter).reduce((a, e) => a + (e.end - e.start), 0);
  const from = parseIso(fromIso).getTime(), to = parseIso(toIso).getTime();
  if (S.timer && S.timer.start >= from && S.timer.start < to && filter(S.timer)) ms += Date.now() - S.timer.start;
  return ms;
}
const openTasks = () => S.tasks.filter(t => !t.done);

// ====================================================================
// UI-Helfer
// ====================================================================
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}
const subjectOpts = (none = '— kein Fach —') => [{ value: '', label: none }, ...S.subjects.map(s => ({ value: s.id, label: s.name }))];
const projectOpts = (none = '— kein Projekt —') => [{ value: '', label: none }, ...S.projects.map(p => ({ value: p.id, label: p.name }))];
const catOpts = () => CATS.map(c => ({ value: c, label: c }));
const subjectDot = s => s ? `<span class="dot" style="--c:${esc(s.color)}"></span>` : '';
const pct = x => x == null ? '–' : Math.round(x * 100) + ' %';
const bar = (x, c) => `<div class="bar"><span style="width:${Math.round((x || 0) * 100)}%;${c ? `--c:${c}` : ''}"></span></div>`;
const matIcon = m => m.fileId ? '📄' : m.url ? '🔗' : '📝';
const matChip = m => `<button type="button" class="chip ${MAT_STATUS_CLS[m.status] || ''}" data-act="openMat" data-id="${m.id}" title="${esc(MAT_STATUS[m.status])}">${matIcon(m)} ${esc(m.title)}</button>`;

function fieldHtml(f, v) {
  const id = 'f_' + f.name;
  const lab = `<label for="${id}">${esc(f.label)}</label>`;
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  const attrs = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
  switch (f.type) {
    case 'textarea':
      return `<div class="field">${lab}<textarea ${attrs} rows="${f.rows || 3}">${esc(v)}</textarea>${hint}</div>`;
    case 'select':
      return `<div class="field">${lab}<select ${attrs}>${f.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${hint}</div>`;
    case 'checkbox':
      return `<div class="field check"><label><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>${hint}</div>`;
    case 'checks':
      return `<div class="field"><span class="label">${esc(f.label)}</span><div class="checks">${f.options.length
        ? f.options.map(o => `<label class="chk"><input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${(v || []).includes(o.value) ? 'checked' : ''}> <span>${o.html || esc(o.label)}</span></label>`).join('')
        : `<p class="muted small" style="padding:6px">${esc(f.empty || 'Keine Einträge vorhanden.')}</p>`}</div>${hint}</div>`;
    case 'color':
      return `<div class="field"><span class="label">${esc(f.label)}</span><div class="swatches">${COLORS.map(c => `<label class="swatch" style="--c:${c}"><input type="radio" name="${f.name}" value="${c}" ${c === v ? 'checked' : ''} aria-label="Farbe ${c}"></label>`).join('')}</div></div>`;
    case 'file':
      return `<div class="field">${lab}<input type="file" id="${id}" name="${f.name}">${hint}</div>`;
    default:
      return `<div class="field">${lab}<input type="${f.type || 'text'}" ${attrs} value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''}>${hint}</div>`;
  }
}
function readForm(form, fields) {
  const o = {};
  for (const f of fields) {
    const els = $$(`[name="${f.name}"]`, form);
    if (f.type === 'checkbox') o[f.name] = els[0].checked;
    else if (f.type === 'checks') o[f.name] = els.filter(e => e.checked).map(e => e.value);
    else if (f.type === 'color') o[f.name] = (els.find(e => e.checked) || {}).value || COLORS[0];
    else if (f.type === 'file') o[f.name] = els[0].files[0] || null;
    else if (f.type === 'number') o[f.name] = els[0].value === '' ? null : Number(els[0].value);
    else o[f.name] = els[0].value.trim();
  }
  return o;
}
function openForm({ title, fields, values = {}, submitLabel = 'Speichern', onSubmit, onDelete, deleteLabel = 'Löschen', intro = '' }) {
  const dlg = $('#modal');
  dlg.innerHTML = `<form class="modal-form" novalidate>
    <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></header>
    <div class="modal-body">${intro}${fields.map(f => fieldHtml(f, values[f.name])).join('')}</div>
    <footer>${onDelete ? `<button type="button" class="btn danger" data-del>${esc(deleteLabel)}</button>` : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></footer>
  </form>`;
  const form = $('form', dlg);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const missing = fields.find(f => f.required && !$(`[name="${f.name}"]`, form).value.trim());
    if (missing) { toast(`Bitte „${missing.label}“ ausfüllen`); $(`[name="${missing.name}"]`, form).focus(); return; }
    const r = await onSubmit(readForm(form, fields));
    if (r !== false) { dlg.close(); save(); render(); }
  });
  $$('[data-close]', dlg).forEach(b => b.onclick = () => dlg.close());
  if (onDelete) $('[data-del]', dlg).onclick = async () => {
    if (confirm('Wirklich löschen?')) { await onDelete(); dlg.close(); save(); render(); }
  };
  dlg.showModal();
  const first = $('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea', dlg);
  if (first && !('ontouchstart' in window)) first.focus();
}

// ====================================================================
// Bearbeiten-Dialoge
// ====================================================================
function editSubject(id) {
  const s = id ? subj(id) : null;
  openForm({
    title: s ? 'Fach bearbeiten' : 'Neues Fach',
    values: s || { color: COLORS[S.subjects.length % COLORS.length] },
    fields: [
      { name: 'name', label: 'Fach', required: true, placeholder: 'z. B. Mathematik' },
      { name: 'classes', label: 'Lerngruppen', placeholder: 'z. B. 5a, 7b, Q1-GK', hint: 'Mit Komma trennen' },
      { name: 'color', label: 'Farbe', type: 'color' },
      { name: 'logineoUrl', label: 'Link zum Logineo-Kurs', type: 'url', placeholder: 'https://…logineonrw-lms.de/course/view.php?id=…', hint: 'Im Logineo-Kurs die Adresse aus der Safari-Adressleiste kopieren.' },
      { name: 'notes', label: 'Notizen (Lehrplan, Lehrwerk, Absprachen …)', type: 'textarea' },
    ],
    onSubmit: d => { if (s) Object.assign(s, d); else S.subjects.push({ id: uid(), ...d }); },
    onDelete: s && (async () => {
      for (const m of S.materials.filter(m => m.subjectId === s.id)) await deleteMaterialData(m);
      S.units = S.units.filter(u => u.subjectId !== s.id);
      S.timetable = S.timetable.filter(t => t.subjectId !== s.id);
      S.tasks.forEach(t => { if (t.subjectId === s.id) t.subjectId = ''; });
      S.subjects = S.subjects.filter(x => x !== s);
      location.hash = '#/faecher';
    }),
  });
}

function editUnit(id, subjectId) {
  const u = id ? byId(S.units, id) : null;
  const sid = u ? u.subjectId : subjectId;
  const fields = [
    { name: 'title', label: 'Titel der Unterrichtsreihe', required: true, placeholder: 'z. B. Bruchrechnung' },
    { name: 'klasse', label: 'Lerngruppe', placeholder: 'z. B. 7b' },
    { name: 'start', label: 'Beginn', type: 'date' },
    { name: 'end', label: 'Ende (geplant)', type: 'date' },
    { name: 'goals', label: 'Kompetenzen / Ziele', type: 'textarea', hint: 'z. B. aus dem Kernlehrplan oder schulinternen Curriculum' },
    { name: 'notes', label: 'Notizen', type: 'textarea' },
  ];
  if (!u) fields.splice(4, 0, { name: 'count', label: 'Anzahl Stunden direkt anlegen', type: 'number', min: 0, hint: 'Leere Stunden, die du danach benennst. Termine kannst du aus dem Stundenplan füllen lassen.' });
  openForm({
    title: u ? 'Reihe bearbeiten' : 'Neue Unterrichtsreihe',
    values: u || { klasse: (subj(sid)?.classes || '').split(',')[0]?.trim(), start: today() },
    fields,
    onSubmit: d => {
      if (u) { Object.assign(u, d); return; }
      const n = Math.min(Number(d.count) || 0, 60); delete d.count;
      const nu = { id: uid(), subjectId: sid, ...d, lessons: [] };
      for (let i = 1; i <= n; i++) nu.lessons.push({ id: uid(), title: `Stunde ${i}`, date: '', materialIds: [], done: false });
      S.units.push(nu);
      location.hash = '#/reihe/' + nu.id;
    },
    onDelete: u && (() => { S.units = S.units.filter(x => x !== u); location.hash = '#/fach/' + sid; }),
  });
}

function editLesson(unitId, lessonId) {
  const u = byId(S.units, unitId); const l = lessonId ? byId(u.lessons, lessonId) : null;
  const mats = S.materials.filter(m => m.subjectId === u.subjectId);
  openForm({
    title: l ? 'Stunde bearbeiten' : 'Neue Stunde',
    values: l || { materialIds: [] },
    fields: [
      { name: 'title', label: 'Thema der Stunde', required: true },
      { name: 'date', label: 'Datum', type: 'date' },
      { name: 'notes', label: 'Verlauf / Notizen', type: 'textarea', rows: 4 },
      { name: 'materialIds', label: 'Verknüpftes Material', type: 'checks', empty: 'Für dieses Fach gibt es noch kein Material. Lege es über „+ Material“ an der Stunde an.',
        options: mats.map(m => ({ value: m.id, html: `${matIcon(m)} ${esc(m.title)} <span class="chip ${MAT_STATUS_CLS[m.status]}">${MAT_STATUS[m.status]}</span>` })) },
      { name: 'noMaterial', label: 'Für diese Stunde wird kein Material benötigt', type: 'checkbox' },
      { name: 'done', label: 'Stunde ist gehalten', type: 'checkbox' },
    ],
    onSubmit: d => {
      if (l) Object.assign(l, d); else u.lessons.push({ id: uid(), ...d });
      sortLessons(u);
    },
    onDelete: l && (() => { u.lessons = u.lessons.filter(x => x !== l); }),
  });
}

async function deleteMaterialData(m) {
  if (m.fileId) { try { await idb.del(m.fileId); } catch (e) { /* ignorieren */ } }
  S.materials = S.materials.filter(x => x !== m);
  S.units.forEach(u => u.lessons.forEach(l => { l.materialIds = (l.materialIds || []).filter(id => id !== m.id); }));
}

function editMaterial(id, ctx = {}) {
  const m = id ? byId(S.materials, id) : null;
  openForm({
    title: m ? 'Material bearbeiten' : 'Neues Material',
    values: m || { status: 'vorhanden', subjectId: ctx.subjectId || '', projectId: ctx.projectId || '' },
    intro: m && m.fileName ? `<p class="small muted">Gespeicherte Datei: <strong>${esc(m.fileName)}</strong>. Eine neue Datei ersetzt sie.</p>` : '',
    fields: [
      { name: 'title', label: 'Bezeichnung', required: true, placeholder: 'z. B. AB Brüche erweitern' },
      { name: 'status', label: 'Status', type: 'select', options: Object.entries(MAT_STATUS).map(([value, label]) => ({ value, label })) },
      { name: 'file', label: 'Datei vom iPad (optional)', type: 'file', hint: 'PDF, Bild, Word … wird nur auf diesem Gerät gespeichert.' },
      { name: 'url', label: 'Link (optional)', type: 'url', placeholder: 'https://…', hint: 'z. B. Logineo-Kursmaterial, OneDrive-/iCloud-Freigabe, Website, Video' },
      { name: 'note', label: 'Notiz', type: 'textarea' },
      { name: 'subjectId', label: 'Fach', type: 'select', options: subjectOpts() },
      { name: 'projectId', label: 'Projekt', type: 'select', options: projectOpts() },
    ],
    onSubmit: async d => {
      const file = d.file; delete d.file;
      const target = m || { id: uid(), createdAt: Date.now() };
      Object.assign(target, d);
      if (file) {
        if (target.fileId) await idb.del(target.fileId).catch(() => {});
        target.fileId = uid(); target.fileName = file.name;
        await idb.put(target.fileId, file);
      }
      if (!m) {
        S.materials.push(target);
        if (ctx.unitId && ctx.lessonId) {
          const l = byId(byId(S.units, ctx.unitId).lessons, ctx.lessonId);
          l.materialIds = [...(l.materialIds || []), target.id];
        }
      }
    },
    onDelete: m && (() => deleteMaterialData(m)),
  });
}

async function openMaterial(id) {
  const m = byId(S.materials, id); if (!m) return;
  if (m.fileId) {
    const f = await idb.get(m.fileId);
    if (!f) { toast('Datei nicht gefunden'); return; }
    const url = URL.createObjectURL(f);
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
    if (!/^(application\/pdf|image\/|text\/)/.test(f.type)) a.download = m.fileName || 'datei';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else if (m.url) {
    window.open(m.url, '_blank', 'noopener');
  } else {
    editMaterial(id);
  }
}

function editTask(id, ctx = {}) {
  const t = id ? byId(S.tasks, id) : null;
  openForm({
    title: t ? 'Aufgabe bearbeiten' : 'Neue Aufgabe',
    values: t || { subjectId: ctx.subjectId || '', projectId: ctx.projectId || '', due: ctx.due || '' },
    fields: [
      { name: 'title', label: 'Aufgabe', required: true, placeholder: 'z. B. Klassenarbeit 7b korrigieren' },
      { name: 'due', label: 'Fällig am', type: 'date' },
      { name: 'priority', label: 'Wichtig', type: 'checkbox' },
      { name: 'subjectId', label: 'Fach', type: 'select', options: subjectOpts() },
      { name: 'projectId', label: 'Projekt', type: 'select', options: projectOpts() },
      { name: 'notes', label: 'Notizen', type: 'textarea' },
      { name: 'done', label: 'Erledigt', type: 'checkbox' },
    ],
    onSubmit: d => { if (t) Object.assign(t, d); else S.tasks.push({ id: uid(), createdAt: Date.now(), ...d }); },
    onDelete: t && (() => { S.tasks = S.tasks.filter(x => x !== t); }),
  });
}

function editProject(id) {
  const p = id ? proj(id) : null;
  openForm({
    title: p ? 'Projekt bearbeiten' : 'Neues Projekt',
    values: p || { type: 'Erasmus+', status: 'aktiv', color: COLORS[(S.projects.length + 5) % COLORS.length] },
    fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'z. B. Erasmus+ Austausch Spanien' },
      { name: 'type', label: 'Art', type: 'select', options: PROJECT_TYPES.map(x => ({ value: x, label: x })) },
      { name: 'color', label: 'Farbe', type: 'color' },
      { name: 'start', label: 'Beginn', type: 'date' },
      { name: 'end', label: 'Ende', type: 'date' },
      { name: 'description', label: 'Beschreibung / Ziele', type: 'textarea' },
      { name: 'contacts', label: 'Beteiligte & Kontakte', type: 'textarea', placeholder: 'Kolleg:innen, Partnerschulen, Ansprechpersonen …' },
      { name: 'status', label: 'Status', type: 'select', options: [{ value: 'aktiv', label: 'Aktiv' }, { value: 'abgeschlossen', label: 'Abgeschlossen' }] },
    ],
    onSubmit: d => { if (p) Object.assign(p, d); else { const np = { id: uid(), notes: '', ...d }; S.projects.push(np); location.hash = '#/projekt/' + np.id; } },
    onDelete: p && (async () => {
      for (const m of S.materials.filter(m => m.projectId === p.id && !m.subjectId)) await deleteMaterialData(m);
      S.materials.forEach(m => { if (m.projectId === p.id) m.projectId = ''; });
      S.tasks = S.tasks.filter(t => t.projectId !== p.id);
      S.timeEntries.forEach(e => { if (e.projectId === p.id) e.projectId = ''; });
      S.projects = S.projects.filter(x => x !== p);
      location.hash = '#/projekte';
    }),
  });
}

function editEntry(id) {
  const e = id ? byId(S.timeEntries, id) : null;
  const now = new Date();
  const v = e ? {
    date: isoDate(new Date(e.start)), from: fmtTime(e.start), to: fmtTime(e.end), category: e.category, subjectId: e.subjectId, projectId: e.projectId, note: e.note,
  } : { date: today(), from: `${pad(Math.max(0, now.getHours() - 1))}:00`, to: `${pad(now.getHours())}:00`, category: 'Vorbereitung' };
  openForm({
    title: e ? 'Zeiteintrag bearbeiten' : 'Zeit nachtragen',
    values: v,
    fields: [
      { name: 'date', label: 'Datum', type: 'date', required: true },
      { name: 'from', label: 'Von', type: 'time', required: true },
      { name: 'to', label: 'Bis', type: 'time', required: true },
      { name: 'category', label: 'Tätigkeit', type: 'select', options: catOpts() },
      { name: 'subjectId', label: 'Fach', type: 'select', options: subjectOpts() },
      { name: 'projectId', label: 'Projekt', type: 'select', options: projectOpts() },
      { name: 'note', label: 'Notiz', type: 'text' },
    ],
    onSubmit: d => {
      const start = new Date(`${d.date}T${d.from}`).getTime();
      let end = new Date(`${d.date}T${d.to}`).getTime();
      if (end <= start) end += 864e5; // über Mitternacht
      const rec = { start, end, category: d.category, subjectId: d.subjectId, projectId: d.projectId, note: d.note };
      if (e) Object.assign(e, rec); else S.timeEntries.push({ id: uid(), ...rec });
    },
    onDelete: e && (() => { S.timeEntries = S.timeEntries.filter(x => x !== e); }),
  });
}

function editSlot(day, period) {
  const s = S.timetable.find(t => t.day === day && t.period === period);
  if (!S.subjects.length) { toast('Lege zuerst ein Fach an'); location.hash = '#/faecher'; return; }
  openForm({
    title: `${DAYS[day]}, ${period}. Stunde`,
    values: s || { subjectId: S.subjects[0].id },
    fields: [
      { name: 'subjectId', label: 'Fach', type: 'select', options: S.subjects.map(x => ({ value: x.id, label: x.name })) },
      { name: 'klasse', label: 'Lerngruppe', placeholder: 'z. B. 7b' },
      { name: 'room', label: 'Raum', placeholder: 'z. B. A204' },
    ],
    onSubmit: d => { if (s) Object.assign(s, d); else S.timetable.push({ id: uid(), day, period, ...d }); },
    onDelete: s && (() => { S.timetable = S.timetable.filter(x => x !== s); }),
    deleteLabel: 'Stunde entfernen',
  });
}

// Termine einer Reihe aus dem Stundenplan ableiten
function scheduleUnit(u) {
  const slots = S.timetable.filter(t => t.subjectId === u.subjectId &&
    (!u.klasse || !t.klasse || t.klasse.trim().toLowerCase() === u.klasse.trim().toLowerCase()));
  if (!slots.length) { toast('Keine passenden Stunden im Stundenplan gefunden'); return; }
  const open = u.lessons.filter(l => !l.date);
  if (!open.length) { toast('Alle Stunden haben bereits ein Datum'); return; }
  const lastDated = u.lessons.filter(l => l.date).map(l => l.date).sort().pop();
  let d = lastDated ? addDays(lastDated, 1) : (u.start || today());
  let i = 0, guard = 0;
  while (i < open.length && guard++ < 400) {
    const wd = weekday(d);
    const n = slots.filter(s => s.day === wd).length;
    for (let k = 0; k < n && i < open.length; k++) open[i++].date = d;
    d = addDays(d, 1);
  }
  sortLessons(u); save(); render();
  toast(`${open.length} Termine eingetragen – bitte Ferien & Feiertage prüfen`);
}

function duplicateUnit(u) {
  const klasse = prompt('Für welche Lerngruppe soll die Reihe kopiert werden?', u.klasse || '');
  if (klasse === null) return;
  const copy = JSON.parse(JSON.stringify(u));
  copy.id = uid(); copy.klasse = klasse; copy.title = u.title; copy.start = '';
  copy.lessons.forEach(l => { l.id = uid(); l.date = ''; l.done = false; });
  S.units.push(copy); save();
  location.hash = '#/reihe/' + copy.id;
  toast('Reihe kopiert – Material ist weiterhin verknüpft');
}

// ====================================================================
// Ansichten
// ====================================================================
const V = {};
let ui = { week: weekStart(today()), taskFilter: 'offen' };

function timerCard() {
  const t = S.timer;
  if (t) {
    const label = [t.category, subj(t.subjectId)?.name, proj(t.projectId)?.name].filter(Boolean).join(' · ');
    return `<section class="card timer-card running">
      <div class="card-head"><h2>⏱️ Zeiterfassung läuft</h2></div>
      <div class="timer-clock" data-timer>${fmtClock(Date.now() - t.start)}</div>
      <p class="muted">${esc(label)} · seit ${fmtTime(t.start)} Uhr</p>
      <div class="actions" style="margin-top:12px"><button class="btn primary" data-act="stopTimer">■ Stoppen</button><button class="btn" data-act="discardTimer">Verwerfen</button></div>
    </section>`;
  }
  return `<section class="card timer-card">
    <div class="card-head"><h2>⏱️ Arbeitszeit erfassen</h2></div>
    <div class="inline-form"><select id="timerSubject" aria-label="Fach oder Projekt (optional)">
      <option value="">Fach / Projekt (optional)</option>
      ${S.subjects.map(s => `<option value="s:${s.id}">${esc(s.name)}</option>`).join('')}
      ${S.projects.filter(p => p.status !== 'abgeschlossen').map(p => `<option value="p:${p.id}">${esc(p.name)}</option>`).join('')}
    </select></div>
    <div class="quick-cats">${CATS.map((c, i) => `<button class="chip" style="min-height:38px;padding:0 14px" data-act="startTimer" data-cat="${esc(c)}"><span class="dot" style="--c:${CAT_COLORS[i]}"></span>${esc(c)}</button>`).join('')}</div>
  </section>`;
}

V.heute = () => {
  const t = today(), wd = weekday(t);
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const slots = wd < 5 ? S.timetable.filter(s => s.day === wd).sort((a, b) => a.period - b.period) : [];
  const ot = openTasks();
  const overdue = ot.filter(x => x.due && x.due < t);
  const soon = ot.filter(x => x.due && x.due >= t && x.due <= addDays(t, 7)).sort((a, b) => a.due.localeCompare(b.due));
  const missing = upcomingMissing(14);
  const ws = weekStart(t);
  const worked = sumBetween(ws, addDays(ws, 7));
  const target = (S.settings.weeklyHours || 41) * 3600e3;
  const activeProjects = S.projects.filter(p => p.status !== 'abgeschlossen');
  const isEmpty = !S.subjects.length && !S.tasks.length && !S.projects.length;

  return `<div class="page">
    <div class="page-head"><div><h1>${greet}${S.settings.name ? ', ' + esc(S.settings.name) : ''}!</h1>
      <div class="sub">${DAYS_SHORT[wd]}, ${fmtDate(t)} · KW ${kw(t)}</div></div>
      <div class="actions"><button class="btn" data-act="newTask">+ Aufgabe</button></div></div>
    ${isEmpty ? `<div class="notice" style="margin-bottom:16px"><h3>Willkommen! 👋</h3>
      <p>Lege zuerst deine <a href="#/faecher">Fächer</a> an und trage deinen <a href="#/stundenplan">Stundenplan</a> ein. Danach siehst du hier jeden Tag deine Stunden, fehlendes Material, fällige Aufgaben und deine Arbeitszeit.</p>
      <div class="actions" style="margin-top:10px"><button class="btn primary" data-act="newSubject">+ Erstes Fach anlegen</button><button class="btn" data-act="loadDemo">Beispieldaten ansehen</button></div></div>` : ''}
    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>📅 Heute im Unterricht</h2><a href="#/stundenplan" class="small">Stundenplan</a></div>
        ${slots.length ? `<ul class="list">${slots.map(s => {
          const su = subj(s.subjectId); const nx = nextLessonFor(s.subjectId, s.klasse);
          return `<li><strong style="width:28px">${s.period}.</strong>${subjectDot(su)}<div class="grow">
            <div class="title">${esc(su?.name)} ${s.klasse ? '· ' + esc(s.klasse) : ''}</div>
            <div class="meta">${s.room ? 'Raum ' + esc(s.room) + ' · ' : ''}${nx ? `<a href="#/reihe/${nx.u.id}">${esc(nx.l.title)}</a>` : 'Keine Reihe geplant'}</div></div>
            ${nx ? statusChip(lessonStatus(nx.l)) : ''}</li>`;
        }).join('')}</ul>` : `<p class="empty">${wd >= 5 ? 'Wochenende – genieß die freie Zeit! ☀️' : S.timetable.length ? 'Heute hast du keinen Unterricht.' : 'Trage deinen Stundenplan ein, dann erscheinen hier deine Stunden.'}</p>`}
      </section>
      ${timerCard()}
      <section class="card">
        <div class="card-head"><h2>✅ Aufgaben</h2><a href="#/aufgaben" class="small">Alle (${ot.length})</a></div>
        <form class="inline-form" data-form="quickTask" style="margin-bottom:6px"><input name="title" placeholder="Neue Aufgabe … (Enter)" aria-label="Neue Aufgabe"><button class="btn">+</button></form>
        ${overdue.length + soon.length ? `<ul class="list">${[...overdue, ...soon].slice(0, 8).map(taskRow).join('')}</ul>` : '<p class="empty">Nichts fällig in den nächsten 7 Tagen.</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>📎 Material fehlt (nächste 14 Tage)</h2></div>
        ${missing.length ? `<ul class="list">${missing.slice(0, 8).map(l => `<li>${subjectDot(subj(l.unit.subjectId))}<div class="grow">
          <a class="title" href="#/reihe/${l.unit.id}">${esc(l.title)}</a><div class="meta">${fmtDateShort(l.date)} · ${esc(subj(l.unit.subjectId)?.name)} ${esc(l.unit.klasse || '')}</div></div>${statusChip(lessonStatus(l))}</li>`).join('')}</ul>`
          : `<p class="empty">${S.units.length ? 'Für alle anstehenden Stunden ist Material da. 👍' : 'Sobald du Unterrichtsreihen planst, siehst du hier, wo noch Material fehlt.'}</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>⏱️ Diese Woche</h2><a href="#/zeit" class="small">Details</a></div>
        <div class="stat">${fmtDur(worked)}</div><p class="muted">von ${S.settings.weeklyHours} h Soll · ${pct(worked / target)}</p>${bar(Math.min(1, worked / target))}
      </section>
      <section class="card">
        <div class="card-head"><h2>🌍 Projekte</h2><a href="#/projekte" class="small">Alle</a></div>
        ${activeProjects.length ? `<ul class="list">${activeProjects.map(p => {
          const n = S.tasks.filter(x => x.projectId === p.id && !x.done).length;
          return `<li><span class="dot" style="--c:${esc(p.color)}"></span><div class="grow"><a class="title" href="#/projekt/${p.id}">${esc(p.name)}</a><div class="meta">${esc(p.type)}</div></div><span class="chip">${n} offen</span></li>`;
        }).join('')}</ul>` : '<p class="empty">Noch keine Projekte, z. B. Erasmus+ oder Fachschaft.</p>'}
      </section>
    </div></div>`;
};

function taskRow(x) {
  const t = today();
  const su = subj(x.subjectId), pr = proj(x.projectId);
  const dueCls = x.done ? '' : x.due && x.due < t ? 'bad' : x.due === t ? 'warn' : '';
  return `<li class="${x.done ? 'done' : ''}"><input type="checkbox" data-chg="taskDone" data-id="${x.id}" ${x.done ? 'checked' : ''} aria-label="Erledigt">
    <div class="grow clickable" data-act="editTask" data-id="${x.id}"><div class="title">${x.priority ? '❗ ' : ''}${esc(x.title)}</div>
    <div class="meta">${[su && su.name, pr && pr.name].filter(Boolean).map(esc).join(' · ')}</div></div>
    ${x.due ? `<span class="chip ${dueCls}">${x.due === t ? 'Heute' : x.due === addDays(t, 1) ? 'Morgen' : fmtDateShort(x.due)}</span>` : ''}</li>`;
}

V.stundenplan = () => {
  const n = S.settings.periods || 8; const wdToday = weekday(today());
  return `<div class="page">
    <div class="page-head"><div><h1>Stundenplan</h1><div class="sub">Tippe auf ein Feld, um eine Stunde einzutragen. Daraus werden Termine für deine Reihen berechnet.</div></div></div>
    <div class="card" style="overflow-x:auto"><table class="tt"><thead><tr><th class="per"></th>${DAYS.map((d, i) => `<th>${i === wdToday ? '● ' : ''}${d}</th>`).join('')}</tr></thead><tbody>
    ${Array.from({ length: n }, (_, p) => `<tr><th class="per">${p + 1}.</th>${DAYS.map((_, d) => {
      const s = S.timetable.find(t => t.day === d && t.period === p + 1); const su = s && subj(s.subjectId);
      return `<td><button class="slot ${su ? 'filled' : ''} ${d === wdToday && su ? 'today' : ''}" style="--c:${esc(su?.color || '')}" data-act="editSlot" data-day="${d}" data-period="${p + 1}">
        ${su ? `<span class="s-name">${esc(su.name)}</span><span class="s-meta">${esc([s.klasse, s.room].filter(Boolean).join(' · '))}</span>` : '<span class="s-meta">+</span>'}</button></td>`;
    }).join('')}</tr>`).join('')}
    </tbody></table></div></div>`;
};

V.faecher = () => `<div class="page">
  <div class="page-head"><div><h1>Fächer</h1><div class="sub">Übersicht über deine Fächer, Unterrichtsreihen und den Materialstand</div></div>
    <div class="actions"><button class="btn primary" data-act="newSubject">+ Fach</button></div></div>
  ${S.subjects.length ? `<div class="cards">${S.subjects.map(s => {
    const units = unitsOf(s.id); const lessons = units.flatMap(u => u.lessons); const cov = coverage(lessons);
    const mats = S.materials.filter(m => m.subjectId === s.id).length;
    return `<a class="card subject-card" style="--c:${esc(s.color)}" href="#/fach/${s.id}">
      <h2 style="margin-bottom:2px">${esc(s.name)}</h2><p class="muted small">${esc(s.classes || 'Keine Lerngruppen eingetragen')}</p>
      <p class="small" style="margin-top:10px">${units.length} Reihe${units.length === 1 ? '' : 'n'} · ${lessons.length} Stunden · ${mats} Materialien</p>
      <div style="display:flex;justify-content:space-between" class="small"><span>Material vorhanden</span><strong>${pct(cov)}</strong></div>${bar(cov, s.color)}
    </a>`;
  }).join('')}</div>` : `<div class="card"><p class="empty">Noch keine Fächer angelegt.</p><button class="btn primary" data-act="newSubject">+ Erstes Fach anlegen</button></div>`}
</div>`;

V.fach = id => {
  const s = subj(id); if (!s) return notFound();
  const units = unitsOf(id).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const mats = S.materials.filter(m => m.subjectId === id).sort((a, b) => a.title.localeCompare(b.title));
  const tasks = S.tasks.filter(t => t.subjectId === id && !t.done);
  const ws = weekStart(today());
  const timeWeek = sumBetween(ws, addDays(ws, 7), e => e.subjectId === id);
  return `<div class="page">
    <div class="crumbs"><a href="#/faecher">← Fächer</a></div>
    <div class="page-head"><div><h1>${subjectDot(s)} ${esc(s.name)}</h1><div class="sub">${esc(s.classes || '')}</div></div>
      <div class="actions">
        ${s.logineoUrl || S.settings.logineoUrl ? `<button class="btn" data-act="openUrl" data-url="${esc(s.logineoUrl || S.settings.logineoUrl)}">Logineo-Kurs ↗</button>` : ''}
        <button class="btn" data-act="editSubject" data-id="${id}">Bearbeiten</button>
        <button class="btn primary" data-act="newUnit" data-id="${id}">+ Reihe</button></div></div>
    <div class="grid grid-2">
      <section class="card span-2"><div class="card-head"><h2>Unterrichtsreihen</h2></div>
        ${units.length ? `<div class="cards">${units.map(u => {
          const done = u.lessons.filter(l => l.done).length; const cov = coverage(u.lessons);
          return `<a class="card" href="#/reihe/${u.id}" style="box-shadow:none">
            <h3>${esc(u.title)}</h3><p class="muted small">${esc(u.klasse || '')} ${u.start ? '· ' + fmtDate(u.start) : ''}${u.end ? ' – ' + fmtDate(u.end) : ''}</p>
            <div class="timeline">${u.lessons.map(l => `<span class="${lessonStatus(l)} ${l.done ? 'isdone' : ''}"></span>`).join('') || '<span></span>'}</div>
            <p class="small muted">${done}/${u.lessons.length} gehalten · Material ${pct(cov)}</p></a>`;
        }).join('')}</div>` : '<p class="empty">Noch keine Unterrichtsreihe. Lege eine an, um deine Stunden zu planen.</p>'}
      </section>
      <section class="card"><div class="card-head"><h2>Material</h2><button class="btn sm" data-act="newMaterial" data-subject="${id}">+ Material</button></div>
        ${mats.length ? `<ul class="list">${mats.map(m => {
          const uses = materialUses(m.id).length;
          return `<li><span style="font-size:1.2rem">${matIcon(m)}</span><div class="grow clickable" data-act="openMat" data-id="${m.id}"><div class="title">${esc(m.title)}</div>
            <div class="meta">${uses ? `in ${uses} Stunde${uses === 1 ? '' : 'n'} verwendet` : 'noch nicht verknüpft'}</div></div>
            <span class="chip ${MAT_STATUS_CLS[m.status]}">${MAT_STATUS[m.status]}</span><button class="icon-btn" data-act="editMaterial" data-id="${m.id}" aria-label="Bearbeiten">✎</button></li>`;
        }).join('')}</ul>` : '<p class="empty">Noch kein Material.</p>'}
      </section>
      <div class="grid" style="align-content:start">
        <section class="card"><div class="card-head"><h2>Offene Aufgaben</h2><button class="btn sm" data-act="newTask" data-subject="${id}">+ Aufgabe</button></div>
          ${tasks.length ? `<ul class="list">${tasks.map(taskRow).join('')}</ul>` : '<p class="empty">Keine offenen Aufgaben.</p>'}</section>
        <section class="card"><div class="card-head"><h2>Zeit diese Woche</h2></div><div class="stat">${fmtDur(timeWeek)}</div></section>
        ${s.notes ? `<section class="card"><h2>Notizen</h2><p style="white-space:pre-wrap">${esc(s.notes)}</p></section>` : ''}
      </div>
    </div></div>`;
};

V.reihe = id => {
  const u = byId(S.units, id); if (!u) return notFound();
  const s = subj(u.subjectId);
  const done = u.lessons.filter(l => l.done).length; const cov = coverage(u.lessons);
  return `<div class="page">
    <div class="crumbs"><a href="#/faecher">Fächer</a> › <a href="#/fach/${s.id}">${esc(s.name)}</a></div>
    <div class="page-head"><div><h1>${esc(u.title)}</h1>
      <div class="sub">${subjectDot(s)} ${esc(s.name)} ${u.klasse ? '· ' + esc(u.klasse) : ''} ${u.start ? '· ' + fmtDate(u.start) : ''}${u.end ? ' – ' + fmtDate(u.end) : ''}</div></div>
      <div class="actions">
        <button class="btn" data-act="scheduleUnit" data-id="${id}" title="Freie Termine aus dem Stundenplan eintragen">📅 Termine füllen</button>
        <button class="btn" data-act="duplicateUnit" data-id="${id}">Kopieren</button>
        <button class="btn" data-act="editUnit" data-id="${id}">Bearbeiten</button>
        <button class="btn primary" data-act="newLesson" data-id="${id}">+ Stunde</button></div></div>
    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="card"><p class="muted small">Fortschritt</p><div class="stat">${done}/${u.lessons.length}</div>${bar(u.lessons.length ? done / u.lessons.length : 0, s.color)}</div>
      <div class="card"><p class="muted small">Material vorhanden</p><div class="stat">${pct(cov)}</div>${bar(cov, 'var(--ok)')}</div>
      <div class="card"><p class="muted small">Kompetenzen / Ziele</p><p class="small" style="white-space:pre-wrap">${esc(u.goals || '–')}</p></div>
    </div>
    <section class="card" style="overflow-x:auto"><div class="card-head"><h2>Reihenplanung</h2></div>
      ${u.lessons.length ? `<table class="lessons"><thead><tr><th class="num">#</th><th class="date">Datum</th><th>Thema & Material</th><th class="status">Status</th><th class="ops"></th></tr></thead><tbody>
      ${u.lessons.map((l, i) => {
        const ms = (l.materialIds || []).map(mid => byId(S.materials, mid)).filter(Boolean);
        return `<tr class="${l.done ? 'done' : ''}"><td class="num">${i + 1}</td><td class="date">${l.date ? fmtDateShort(l.date) : '<span class="muted">–</span>'}</td>
          <td><div class="clickable" data-act="editLesson" data-unit="${id}" data-id="${l.id}"><strong>${esc(l.title)}</strong>${l.notes ? `<div class="small muted" style="white-space:pre-wrap">${esc(l.notes)}</div>` : ''}</div>
            <div class="chips" style="margin-top:6px">${ms.map(matChip).join('')}<button class="chip accent" data-act="newMaterial" data-subject="${s.id}" data-unit="${id}" data-lesson="${l.id}">+ Material</button></div></td>
          <td class="status">${statusChip(lessonStatus(l))}</td>
          <td class="ops"><label class="chk" title="Gehalten"><input type="checkbox" data-chg="lessonDone" data-unit="${id}" data-id="${l.id}" ${l.done ? 'checked' : ''} aria-label="Gehalten"></label></td></tr>`;
      }).join('')}</tbody></table>` : '<p class="empty">Noch keine Stunden in dieser Reihe.</p>'}
    </section>
    ${u.notes ? `<section class="card" style="margin-top:16px"><h2>Notizen</h2><p style="white-space:pre-wrap">${esc(u.notes)}</p></section>` : ''}
  </div>`;
};

V.aufgaben = () => {
  const t = today(); const f = ui.taskFilter;
  const list = S.tasks.filter(x => f === 'erledigt' ? x.done : !x.done);
  const groups = f === 'erledigt'
    ? [['Erledigt', list.sort((a, b) => (b.due || '').localeCompare(a.due || ''))]]
    : [
      ['Überfällig', list.filter(x => x.due && x.due < t)],
      ['Heute', list.filter(x => x.due === t)],
      ['Nächste 7 Tage', list.filter(x => x.due > t && x.due <= addDays(t, 7))],
      ['Später', list.filter(x => x.due > addDays(t, 7))],
      ['Ohne Datum', list.filter(x => !x.due)],
    ].map(([n, l]) => [n, l.sort((a, b) => (a.due || '').localeCompare(b.due || '') || (b.priority ? 1 : 0) - (a.priority ? 1 : 0))]);
  return `<div class="page">
    <div class="page-head"><div><h1>Aufgaben</h1><div class="sub">${openTasks().length} offen</div></div>
      <div class="actions"><button class="btn ${f === 'offen' ? 'primary' : ''}" data-act="taskFilter" data-f="offen">Offen</button>
      <button class="btn ${f === 'erledigt' ? 'primary' : ''}" data-act="taskFilter" data-f="erledigt">Erledigt</button>
      <button class="btn" data-act="newTask">+ Aufgabe</button></div></div>
    <section class="card" style="margin-bottom:16px"><form class="inline-form" data-form="quickTask">
      <input name="title" placeholder="Schnell erfassen … z. B. „Elternbrief Klassenfahrt“" aria-label="Neue Aufgabe">
      <input name="due" type="date" aria-label="Fällig am"><button class="btn primary">Hinzufügen</button></form></section>
    <div class="grid">${groups.filter(([, l]) => l.length).map(([n, l]) => `<section class="card"><div class="card-head"><h2>${n} <span class="muted">(${l.length})</span></h2></div><ul class="list">${l.map(taskRow).join('')}</ul></section>`).join('')
      || '<div class="card"><p class="empty">Keine Aufgaben. 🎉</p></div>'}</div></div>`;
};

V.projekte = () => {
  const act = S.projects.filter(p => p.status !== 'abgeschlossen'), fin = S.projects.filter(p => p.status === 'abgeschlossen');
  const card = p => {
    const tasks = S.tasks.filter(t => t.projectId === p.id); const open = tasks.filter(t => !t.done).length;
    const ms = S.timeEntries.filter(e => e.projectId === p.id).reduce((a, e) => a + e.end - e.start, 0);
    return `<a class="card subject-card" style="--c:${esc(p.color)}" href="#/projekt/${p.id}"><span class="chip">${esc(p.type)}</span>
      <h2 style="margin:8px 0 2px">${esc(p.name)}</h2><p class="muted small">${p.start ? fmtDate(p.start) : ''}${p.end ? ' – ' + fmtDate(p.end) : ''}</p>
      <p class="small" style="margin-top:8px">${open} offene Aufgaben · ${fmtDur(ms)} investiert</p>${bar(tasks.length ? (tasks.length - open) / tasks.length : 0, p.color)}</a>`;
  };
  return `<div class="page">
    <div class="page-head"><div><h1>Projekte</h1><div class="sub">Außerunterrichtliches: Erasmus+, Fachschaft, AGs, Fahrten …</div></div>
      <div class="actions"><button class="btn primary" data-act="newProject">+ Projekt</button></div></div>
    ${act.length ? `<div class="cards">${act.map(card).join('')}</div>` : '<div class="card"><p class="empty">Noch keine aktiven Projekte.</p></div>'}
    ${fin.length ? `<h2 style="margin-top:28px">Abgeschlossen</h2><div class="cards">${fin.map(card).join('')}</div>` : ''}</div>`;
};

V.projekt = id => {
  const p = proj(id); if (!p) return notFound();
  const tasks = S.tasks.filter(t => t.projectId === id).sort((a, b) => (a.done - b.done) || (a.due || '9').localeCompare(b.due || '9'));
  const mats = S.materials.filter(m => m.projectId === id);
  const ms = S.timeEntries.filter(e => e.projectId === id).reduce((a, e) => a + e.end - e.start, 0);
  return `<div class="page">
    <div class="crumbs"><a href="#/projekte">← Projekte</a></div>
    <div class="page-head"><div><span class="chip">${esc(p.type)}</span><h1 style="margin-top:6px">${esc(p.name)}</h1>
      <div class="sub">${p.start ? fmtDate(p.start) : ''}${p.end ? ' – ' + fmtDate(p.end) : ''}${p.status === 'abgeschlossen' ? ' · abgeschlossen' : ''}</div></div>
      <div class="actions"><button class="btn" data-act="startProjectTimer" data-id="${id}">⏱️ Zeit erfassen</button><button class="btn" data-act="editProject" data-id="${id}">Bearbeiten</button></div></div>
    <div class="grid grid-2">
      <section class="card"><h2>Beschreibung</h2><p style="white-space:pre-wrap">${esc(p.description || '–')}</p>
        ${p.contacts ? `<h3 style="margin-top:14px">Beteiligte & Kontakte</h3><p style="white-space:pre-wrap">${esc(p.contacts)}</p>` : ''}
        <p class="muted small" style="margin-top:14px">Investierte Zeit: <strong>${fmtDur(ms)}</strong></p></section>
      <section class="card"><div class="card-head"><h2>Aufgaben</h2><button class="btn sm" data-act="newTask" data-project="${id}">+ Aufgabe</button></div>
        ${tasks.length ? `<ul class="list">${tasks.map(taskRow).join('')}</ul>` : '<p class="empty">Noch keine Aufgaben.</p>'}</section>
      <section class="card"><div class="card-head"><h2>Dokumente & Links</h2><button class="btn sm" data-act="newMaterial" data-project="${id}">+ Hinzufügen</button></div>
        ${mats.length ? `<ul class="list">${mats.map(m => `<li><span style="font-size:1.2rem">${matIcon(m)}</span><div class="grow clickable" data-act="openMat" data-id="${m.id}"><div class="title">${esc(m.title)}</div>${m.note ? `<div class="meta">${esc(m.note)}</div>` : ''}</div><button class="icon-btn" data-act="editMaterial" data-id="${m.id}" aria-label="Bearbeiten">✎</button></li>`).join('')}</ul>`
          : '<p class="empty">Anträge, Protokolle, Partnerschul-Infos …</p>'}</section>
      <section class="card"><div class="card-head"><h2>Notizen / Protokoll</h2></div>
        <textarea rows="8" data-chg="projectNotes" data-id="${id}" placeholder="Wird automatisch gespeichert …">${esc(p.notes)}</textarea></section>
    </div></div>`;
};

V.zeit = () => {
  const ws = ui.week, we = addDays(ws, 7);
  const entries = entriesBetween(ws, we);
  const total = sumBetween(ws, we);
  const target = (S.settings.weeklyHours || 41) * 3600e3;
  const byCat = CATS.map((c, i) => ({ c, color: CAT_COLORS[i], ms: sumBetween(ws, we, e => e.category === c) })).filter(x => x.ms > 0);
  const max = Math.max(1, ...byCat.map(x => x.ms));
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const isCurrent = ws === weekStart(today());
  return `<div class="page">
    <div class="page-head"><div><h1>Arbeitszeit</h1><div class="sub">KW ${kw(ws)} · ${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}</div></div>
      <div class="actions week-nav"><button class="btn" data-act="week" data-d="-7" aria-label="Vorige Woche">‹</button>
        ${isCurrent ? '' : '<button class="btn" data-act="week" data-d="0">Heute</button>'}
        <button class="btn" data-act="week" data-d="7" aria-label="Nächste Woche">›</button>
        <button class="btn" data-act="newEntry">+ Nachtragen</button><button class="btn" data-act="exportCsv">CSV-Export</button></div></div>
    <div class="grid grid-2">
      ${timerCard()}
      <section class="card"><h2>Wochensumme</h2><div class="stat">${fmtDur(total)}</div>
        <p class="muted">Soll ${S.settings.weeklyHours} h · ${total >= target ? 'Mehrarbeit ' + fmtDur(total - target) : 'noch ' + fmtDur(target - total)}</p>${bar(Math.min(1, total / target))}
        <div style="margin-top:14px">${byCat.map(x => `<div class="cat-row"><span class="small">${esc(x.c)}</span>${bar(x.ms / max, x.color)}<span class="small" style="text-align:right">${fmtDur(x.ms)}</span></div>`).join('') || '<p class="empty">Noch keine Einträge in dieser Woche.</p>'}</div></section>
      <section class="card span-2"><h2>Einträge</h2>
        ${days.map(d => {
          const es = entries.filter(e => isoDate(new Date(e.start)) === d); if (!es.length) return '';
          return `<h3 style="margin-top:12px">${fmtDateShort(d)} <span class="muted">· ${fmtDur(es.reduce((a, e) => a + e.end - e.start, 0))}</span></h3><ul class="list">${es.map(e => {
            const ci = CATS.indexOf(e.category);
            return `<li class="clickable" data-act="editEntry" data-id="${e.id}"><span class="dot" style="--c:${CAT_COLORS[ci] || '#999'}"></span><div class="grow"><div class="title">${esc(e.category)}</div>
              <div class="meta">${fmtTime(e.start)}–${fmtTime(e.end)} ${[subj(e.subjectId)?.name, proj(e.projectId)?.name, e.note].filter(Boolean).map(x => '· ' + esc(x)).join(' ')}</div></div><strong>${fmtDur(e.end - e.start)}</strong></li>`;
          }).join('')}</ul>`;
        }).join('') || '<p class="empty">Keine Einträge.</p>'}</section>
    </div></div>`;
};

V.einstellungen = () => `<div class="page">
  <div class="page-head"><div><h1>Einstellungen</h1></div></div>
  <div class="grid grid-2">
    <section class="card"><h2>Allgemein</h2>
      <form class="grid" data-form="settings" style="gap:14px">
        ${fieldHtml({ name: 'name', label: 'Dein Name (für die Begrüßung)' }, S.settings.name)}
        ${fieldHtml({ name: 'weeklyHours', label: 'Soll-Arbeitszeit pro Woche (Stunden)', type: 'number', step: '0.5', hint: 'NRW-Beamte: 41 h; bei Teilzeit anteilig' }, S.settings.weeklyHours)}
        ${fieldHtml({ name: 'periods', label: 'Unterrichtsstunden pro Tag im Stundenplan', type: 'number', min: 1 }, S.settings.periods)}
        ${fieldHtml({ name: 'logineoUrl', label: 'Adresse deines Logineo NRW LMS', type: 'url', placeholder: 'https://deine-schule.logineonrw-lms.de', hint: 'Wird für den Logineo-Button in der Navigation genutzt.' }, S.settings.logineoUrl)}
        <div><button class="btn primary">Speichern</button></div></form></section>
    <section class="card"><h2>Datensicherung</h2>
      <p>Alle Daten liegen <strong>nur auf diesem iPad</strong>. Nichts wird an einen Server übertragen.</p>
      <p class="muted small">Erstelle regelmäßig eine Sicherung und lege sie z. B. in der Dateien-App ab. Damit kannst du die Daten auch auf ein anderes Gerät übertragen.</p>
      <div class="actions" style="margin-top:12px"><button class="btn primary" data-act="exportBackup">Sicherung exportieren</button>
        <label class="btn">Sicherung importieren<input type="file" accept="application/json,.json" data-chg="importBackup" hidden></label></div>
      <div class="notice warn small" style="margin-top:14px"><strong>Datenschutz:</strong> Speichere hier keine personenbezogenen Daten von Schüler:innen (Noten, Namen, Förderbedarfe). Dafür sind in NRW die dienstlichen Systeme vorgesehen.</div></section>
    <section class="card"><h2>Logineo NRW LMS</h2>
      <p class="small">Logineo NRW LMS basiert auf Moodle. Aktuell verknüpft der Assistent deine Kurse über Direktlinks: pro Fach in den Fach-Einstellungen, pro Material als Link.</p>
      <p class="small muted">Eine automatische Anbindung, etwa das Laden von Abgaben oder Terminen, bräuchte die Moodle-Webservice-Schnittstelle. Die muss die Schul-Administration freigeben.</p></section>
    <section class="card"><h2>Weiteres</h2>
      <div class="actions"><button class="btn" data-act="loadDemo">Beispieldaten laden</button><button class="btn danger" data-act="resetAll">Alle Daten löschen</button></div>
      <p class="muted small" style="margin-top:12px">Tipp: In Safari „Teilen → Zum Home-Bildschirm“ wählen. Dann läuft der Assistent wie eine App im Vollbild, auch offline.</p></section>
  </div></div>`;

const notFound = () => `<div class="page"><div class="card"><p>Nicht gefunden.</p><a href="#/heute">Zur Startseite</a></div></div>`;

// ====================================================================
// Render & Routing
// ====================================================================
const NAV_OF = { fach: 'faecher', reihe: 'faecher', projekt: 'projekte' };
let lastRoute = '';
function render() {
  const h = location.hash.replace(/^#\/?/, '') || 'heute';
  const [view, id] = h.split('/');
  const fn = V[view] || V.heute;
  const main = $('#main');
  const keepScroll = lastRoute === h ? window.scrollY : 0;
  // Fokus/Eingaben in Formularen nicht durch Neuzeichnen verlieren
  main.innerHTML = fn(id);
  window.scrollTo(0, keepScroll);
  lastRoute = h;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (NAV_OF[view] || view)));
  updateTimerPill();
}
function updateTimerPill() {
  const pill = $('#timerPill');
  if (S.timer) { pill.hidden = false; pill.textContent = '⏱ ' + fmtClock(Date.now() - S.timer.start); } else pill.hidden = true;
}
window.addEventListener('hashchange', render);
setInterval(() => {
  if (!S.timer) return;
  const txt = fmtClock(Date.now() - S.timer.start);
  $$('[data-timer]').forEach(el => { el.textContent = txt; });
  updateTimerPill();
}, 1000);

// ====================================================================
// Aktionen
// ====================================================================
function startTimer(category, subjectId = '', projectId = '') {
  if (S.timer) stopTimer(true);
  S.timer = { start: Date.now(), category, subjectId, projectId };
  save(); render(); toast(`Zeiterfassung gestartet: ${category}`);
}
function stopTimer(silent) {
  const t = S.timer; if (!t) return;
  const end = Date.now();
  if (end - t.start >= 60000) S.timeEntries.push({ id: uid(), start: t.start, end, category: t.category, subjectId: t.subjectId || '', projectId: t.projectId || '', note: '' });
  else if (!silent) toast('Weniger als 1 Minute – nicht gespeichert');
  S.timer = null; save();
  if (!silent) { render(); if (end - t.start >= 60000) toast(`${fmtDur(end - t.start)} gespeichert`); }
}

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });

const ACT = {
  gotoTime: () => { location.hash = '#/zeit'; },
  openLogineo: () => {
    if (S.settings.logineoUrl) window.open(S.settings.logineoUrl, '_blank', 'noopener');
    else { toast('Trage zuerst die Logineo-Adresse ein'); location.hash = '#/einstellungen'; }
  },
  openUrl: d => window.open(d.url, '_blank', 'noopener'),
  newSubject: () => editSubject(),
  editSubject: d => editSubject(d.id),
  newUnit: d => editUnit(null, d.id),
  editUnit: d => editUnit(d.id),
  newLesson: d => editLesson(d.id),
  editLesson: d => editLesson(d.unit, d.id),
  scheduleUnit: d => scheduleUnit(byId(S.units, d.id)),
  duplicateUnit: d => duplicateUnit(byId(S.units, d.id)),
  newMaterial: d => editMaterial(null, { subjectId: d.subject, projectId: d.project, unitId: d.unit, lessonId: d.lesson }),
  editMaterial: d => editMaterial(d.id),
  openMat: d => openMaterial(d.id),
  newTask: d => editTask(null, { subjectId: d.subject, projectId: d.project }),
  editTask: d => editTask(d.id),
  taskFilter: d => { ui.taskFilter = d.f; render(); },
  newProject: () => editProject(),
  editProject: d => editProject(d.id),
  editSlot: d => editSlot(Number(d.day), Number(d.period)),
  startTimer: d => {
    const sel = ($('#timerSubject') || {}).value || '';
    startTimer(d.cat, sel.startsWith('s:') ? sel.slice(2) : '', sel.startsWith('p:') ? sel.slice(2) : '');
  },
  startProjectTimer: d => startTimer('Projekte', '', d.id),
  stopTimer: () => stopTimer(),
  discardTimer: () => { if (confirm('Laufende Zeiterfassung verwerfen?')) { S.timer = null; save(); render(); } },
  week: d => { ui.week = Number(d.d) === 0 ? weekStart(today()) : addDays(ui.week, Number(d.d)); render(); },
  newEntry: () => editEntry(),
  editEntry: d => editEntry(d.id),
  exportCsv: () => {
    const num = ms => (ms / 3600e3).toFixed(2).replace('.', ',');
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Datum', 'Beginn', 'Ende', 'Dauer (h)', 'Tätigkeit', 'Fach', 'Projekt', 'Notiz'].join(';')];
    [...S.timeEntries].sort((a, b) => a.start - b.start).forEach(e => rows.push([
      fmtDate(isoDate(new Date(e.start))), fmtTime(e.start), fmtTime(e.end), num(e.end - e.start),
      q(e.category), q(subj(e.subjectId)?.name), q(proj(e.projectId)?.name), q(e.note)].join(';')));
    download(`arbeitszeit-${today()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  },
  exportBackup: async () => {
    const files = {};
    try {
      for (const k of await idb.keys()) {
        const f = await idb.get(k);
        if (f) files[k] = { name: f.name || '', type: f.type || '', data: await blobToDataUrl(f) };
      }
    } catch (e) { toast('Dateien konnten nicht gesichert werden'); }
    download(`lehrer-assistent-sicherung-${today()}.json`, JSON.stringify({ app: 'lehrer-assistent', exportedAt: new Date().toISOString(), state: S, files }), 'application/json');
  },
  loadDemo: () => {
    if ((S.subjects.length || S.tasks.length) && !confirm('Beispieldaten zu deinen vorhandenen Daten hinzufügen?')) return;
    addDemo(); save(); location.hash = '#/heute'; render(); toast('Beispieldaten geladen');
  },
  resetAll: async () => {
    if (!confirm('Wirklich ALLE Daten auf diesem Gerät löschen? Das kann nicht rückgängig gemacht werden.')) return;
    S = emptyState(); save(); await idb.clear().catch(() => {}); location.hash = '#/heute'; render(); toast('Alle Daten gelöscht');
  },
};

const CHG = {
  taskDone: (d, el) => { const t = byId(S.tasks, d.id); t.done = el.checked; t.doneAt = el.checked ? Date.now() : null; save(); setTimeout(render, 250); },
  lessonDone: (d, el) => { const l = byId(byId(S.units, d.unit).lessons, d.id); l.done = el.checked; save(); render(); },
  projectNotes: (d, el) => { proj(d.id).notes = el.value; save(); toast('Notizen gespeichert'); },
  importBackup: async (d, el) => {
    const file = el.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const st = data.state || data;
      if (!st.version) throw new Error('Keine gültige Sicherung');
      if (!confirm('Aktuelle Daten durch die Sicherung ersetzen?')) return;
      S = migrate(st); save();
      if (data.files) {
        await idb.clear();
        for (const [k, f] of Object.entries(data.files)) {
          const blob = await (await fetch(f.data)).blob();
          await idb.put(k, new File([blob], f.name, { type: f.type }));
        }
      }
      render(); toast('Sicherung wiederhergestellt');
    } catch (e) { toast('Import fehlgeschlagen: ' + e.message); }
    el.value = '';
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('dialog')) return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (el && CHG[el.dataset.chg]) CHG[el.dataset.chg](el.dataset, el);
});
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'quickTask') {
    const fe = form.elements; const title = fe.namedItem('title').value.trim(); if (!title) return;
    S.tasks.push({ id: uid(), createdAt: Date.now(), title, due: fe.namedItem('due') ? fe.namedItem('due').value : '', done: false, subjectId: '', projectId: '' });
    save(); render(); toast('Aufgabe hinzugefügt');
    const inp = $('[data-form="quickTask"] input[name="title"]'); if (inp) inp.focus();
  } else if (form.dataset.form === 'settings') {
    const v = n => form.elements.namedItem(n).value.trim();
    S.settings.name = v('name');
    S.settings.weeklyHours = Number(v('weeklyHours')) || 41;
    S.settings.periods = Math.min(14, Math.max(1, Number(v('periods')) || 8));
    S.settings.logineoUrl = v('logineoUrl');
    save(); render(); toast('Gespeichert');
  }
});

// ====================================================================
// Beispieldaten
// ====================================================================
function addDemo() {
  const t = today(), ws = weekStart(t);
  const ma = { id: uid(), name: 'Mathematik', classes: '5a, 7b', color: '#2563eb', logineoUrl: '', notes: 'Lehrwerk: Lambacher Schweizer' };
  const en = { id: uid(), name: 'Englisch', classes: '8c, EF', color: '#dc2626', logineoUrl: '', notes: '' };
  S.subjects.push(ma, en);
  const m1 = { id: uid(), title: 'Einstieg: Pizza-Brüche (Folie)', status: 'vorhanden', subjectId: ma.id, projectId: '', url: '', note: '' };
  const m2 = { id: uid(), title: 'AB Brüche erweitern & kürzen', status: 'vorhanden', subjectId: ma.id, projectId: '', url: '', note: '' };
  const m3 = { id: uid(), title: 'Lernvideo Bruchteile', status: 'vorhanden', subjectId: ma.id, projectId: '', url: 'https://www.example.org', note: '' };
  const m4 = { id: uid(), title: 'Stationenlernen Brüche', status: 'arbeit', subjectId: ma.id, projectId: '', url: '', note: 'Station 4 fehlt noch' };
  const m5 = { id: uid(), title: 'Short story: "The Test"', status: 'vorhanden', subjectId: en.id, projectId: '', url: '', note: '' };
  S.materials.push(m1, m2, m3, m4, m5);
  const L = (title, date, mats = [], done = false) => ({ id: uid(), title, date, materialIds: mats, done, notes: '' });
  S.units.push({
    id: uid(), subjectId: ma.id, title: 'Bruchrechnung', klasse: '7b', start: addDays(ws, -7), end: addDays(ws, 21),
    goals: 'Brüche darstellen, erweitern, kürzen und vergleichen\nBruchteile von Größen bestimmen', notes: '',
    lessons: [
      L('Was sind Brüche? Einstieg', addDays(ws, -7), [m1.id], true),
      L('Bruchteile bestimmen', addDays(ws, -5), [m3.id], true),
      L('Brüche erweitern', addDays(ws, 0), [m2.id], ws <= t),
      L('Brüche kürzen', addDays(ws, 2), [m2.id]),
      L('Stationenlernen', addDays(ws, 7), [m4.id]),
      L('Brüche vergleichen', addDays(ws, 9)),
      L('Übung & Wiederholung', addDays(ws, 14)),
      L('Klassenarbeit', ''),
    ],
  });
  S.units.push({ id: uid(), subjectId: en.id, title: 'Short Stories', klasse: '8c', start: ws, end: addDays(ws, 28), goals: 'Analyse narrativer Texte', notes: '',
    lessons: [L('Introduction: What makes a good story?', addDays(ws, 1), [m5.id]), L('Characterisation', addDays(ws, 3)), L('Point of view', addDays(ws, 8))] });
  S.timetable.push(
    { id: uid(), day: 0, period: 1, subjectId: ma.id, klasse: '7b', room: 'A204' }, { id: uid(), day: 0, period: 3, subjectId: en.id, klasse: '8c', room: 'B101' },
    { id: uid(), day: 1, period: 2, subjectId: ma.id, klasse: '5a', room: 'A110' }, { id: uid(), day: 2, period: 1, subjectId: ma.id, klasse: '7b', room: 'A204' },
    { id: uid(), day: 3, period: 4, subjectId: en.id, klasse: '8c', room: 'B101' }, { id: uid(), day: 4, period: 2, subjectId: ma.id, klasse: '5a', room: 'A110' },
  );
  const er = { id: uid(), name: 'Erasmus+ Austausch Valencia', type: 'Erasmus+', color: '#ca8a04', start: addDays(t, -60), end: addDays(t, 200), status: 'aktiv',
    description: 'Schüleraustausch Jg. 9 mit Partnerschule in Valencia. Mobilität im Frühjahr.', contacts: 'Partnerschule: IES Valencia\nKoordination: Kollegin K.', notes: '' };
  const fs = { id: uid(), name: 'Fachschaft Mathematik', type: 'Fachschaft', color: '#0d9488', start: '', end: '', status: 'aktiv',
    description: 'Fachvorsitz: schulinternes Curriculum überarbeiten, Fachkonferenzen vorbereiten.', contacts: '', notes: '' };
  S.projects.push(er, fs);
  S.materials.push({ id: uid(), title: 'Antrag KA1 (Entwurf)', status: 'arbeit', subjectId: '', projectId: er.id, url: '', note: 'Frist beachten' });
  S.tasks.push(
    { id: uid(), title: 'Klassenarbeit 7b vorbereiten', due: addDays(t, 3), subjectId: ma.id, projectId: '', priority: true, done: false },
    { id: uid(), title: 'Elternbrief Austausch verschicken', due: addDays(t, 1), subjectId: '', projectId: er.id, priority: false, done: false },
    { id: uid(), title: 'Tagesordnung Fachkonferenz', due: addDays(t, 6), subjectId: '', projectId: fs.id, priority: false, done: false },
    { id: uid(), title: 'Vokabeltest 8c korrigieren', due: addDays(t, -1), subjectId: en.id, projectId: '', priority: false, done: false },
  );
  const at = (dayOff, h, m, dur, cat, sid = '', pid = '') => {
    const s = new Date(parseIso(addDays(ws, dayOff))); s.setHours(h, m, 0, 0);
    if (s.getTime() + dur * 60000 < Date.now()) S.timeEntries.push({ id: uid(), start: s.getTime(), end: s.getTime() + dur * 60000, category: cat, subjectId: sid, projectId: pid, note: '' });
  };
  at(0, 8, 0, 270, 'Unterricht'); at(0, 15, 0, 120, 'Vorbereitung', ma.id); at(1, 8, 0, 225, 'Unterricht'); at(1, 16, 0, 150, 'Korrektur', en.id);
  at(2, 8, 0, 270, 'Unterricht'); at(2, 15, 0, 90, 'Konferenz / Besprechung'); at(2, 19, 0, 60, 'Projekte', '', er.id);
}

// ====================================================================
// Start
// ====================================================================
render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
