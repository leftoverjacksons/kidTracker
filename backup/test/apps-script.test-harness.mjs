// Runs backup/Code.gs in Node with stubbed Google services (Drive, Sheets, triggers)
// against a local Postgres + PostgREST, then checks the snapshot and sheet tabs.
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const props = { SUPABASE_URL: 'http://localhost:3002/', SUPABASE_KEY: 'test-anon', BACKUP_EMAIL: 'backup@example.com', BACKUP_PASSWORD: process.argv[2] || 'pw', KEEP_DAYS: '30' };
const files = []; const sheets = {}; const triggers = [];
let fetches = 0;
const mkFile = (name, content, date = new Date()) => ({ name, content, trashed: false, date,
  getName() { return this.name; }, getDateCreated() { return this.date; }, setTrashed(v) { this.trashed = v; }, getId() { return 'f' + name; }, moveTo() {} });
// a stale snapshot that must be pruned, and an unrelated file that must survive
files.push(mkFile('kidtracker-2025-01-01.json', '{}', new Date('2025-01-01')));
files.push(mkFile('notes.txt', 'keep me', new Date('2020-01-01')));
const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const folder = { getId: () => 'folder1',
  createFile: (name, content) => { const f = mkFile(name, content); files.push(f); return f; },
  getFiles: () => iter(files.filter((f) => !f.trashed)),
  getFilesByName: (n) => iter(files.filter((f) => !f.trashed && f.name === n)) };
const mkSheet = (name) => ({ name, values: null, frozen: 0,
  clearContents() { this.values = null; }, setFrozenRows(n) { this.frozen = n; },
  getRange(r, c, nr, nc) { const s = this; return {
    setValues(v) { if (v.length !== nr || v.some((row) => row.length !== nc)) throw new Error(`setValues shape mismatch on ${s.name}: ${nr}x${nc}`); s.values = v; return this; },
    setFontWeight() { return this; }, setNumberFormat() { return this; } }; } });
const ss = { tz: null, getId: () => 'ss1', setSpreadsheetTimeZone(t) { this.tz = t; },
  getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mkSheet(n)),
  getSheets: () => Object.values(sheets), deleteSheet: (s) => delete sheets[s.name] };
sheets.Sheet1 = mkSheet('Sheet1');

const ctx = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  UrlFetchApp: { fetch(url, o = {}) {
    fetches++;
    const args = ['-s', '-w', '\n%{http_code}', '-X', (o.method || 'get').toUpperCase(), url];
    for (const [k, v] of Object.entries(o.headers || {})) args.push('-H', `${k}: ${v}`);
    if (o.contentType) args.push('-H', `Content-Type: ${o.contentType}`);
    if (o.payload) args.push('--data', o.payload);
    const out = execFileSync('curl', args, { maxBuffer: 64 * 1024 * 1024 }).toString();
    const i = out.lastIndexOf('\n');
    const text = out.slice(0, i), code = Number(out.slice(i + 1));
    return { getResponseCode: () => code, getContentText: () => text };
  } },
  DriveApp: { getFolderById: (id) => { if (id !== 'folder1') throw new Error('nf'); return folder; },
    getFoldersByName: () => iter([]), createFolder: () => folder, getFileById: () => ({ moveTo() {} }) },
  SpreadsheetApp: { create: () => ss, openById: () => ss },
  ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger() {},
    newTrigger: (fn) => ({ timeBased: () => ({ everyDays: () => ({ atHour: (h) => ({ create: () => triggers.push({ fn, h, getHandlerFunction: () => fn }) }) }) }) }) },
  Utilities: { formatDate: (d, tz, f) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
    return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute); } },
  Session: { getScriptTimeZone: () => 'UTC' },
  Logger: { log: (m) => console.log('[Logger]', m) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8'), ctx);
try {
  vm.runInContext('setup()', ctx);
} catch (e) { console.log('THREW:', e.message); process.exit(2); }

// Checks
const problems = [];
const snapFiles = files.filter((f) => !f.trashed && /^kidtracker-\d{4}/.test(f.name));
if (snapFiles.length !== 1) problems.push(`expected 1 live snapshot, got ${snapFiles.map((f) => f.name)}`);
if (!files.find((f) => f.name === 'kidtracker-2025-01-01.json').trashed) problems.push('old snapshot not pruned');
if (files.find((f) => f.name === 'notes.txt').trashed) problems.push('unrelated file was trashed');
const snap = JSON.parse(snapFiles[0].content);
const ev = snap.tables.events;
if (ev.length !== 1508) problems.push(`events in snapshot: ${ev.length} (expected 1508 incl. deleted, across pages)`);
if (!ev.some((e) => e.deleted_at)) problems.push('soft-deleted row missing from snapshot');
if (snap.tables.nursing_segments.length !== 2) problems.push('segments missing');
if (triggers.length !== 1 || triggers[0].h !== 3) problems.push('trigger not created at 3am');
if (sheets.Sheet1) problems.push('blank Sheet1 not removed');
if (ss.tz !== 'America/Chicago') problems.push(`sheet tz ${ss.tz}`);
const tab = (n) => sheets[n]?.values;
const feeds = tab('Feeds');
const bottle = feeds?.find((r) => r[1] === 'bottle');
if (!bottle || bottle[4] !== 4 || bottle[5] !== 'formula') problems.push(`bottle row wrong: ${JSON.stringify(bottle)}`);
const nurse = feeds?.find((r) => r[1] === 'nursing');
if (!nurse || nurse[2] !== 10 || nurse[3] !== 5) problems.push(`nursing row wrong: ${JSON.stringify(nurse)}`);
const sleep = tab('Sleep')?.[1];
if (!sleep || Object.prototype.toString.call(sleep[0]) !== '[object Date]' || sleep[2] !== 570 || sleep[3] !== 'night' || sleep[5] !== 'Parent A') problems.push(`sleep row wrong: ${JSON.stringify(sleep)}`);
const temp = tab('Temperature')?.[1];
if (!temp || temp[1] !== 99) problems.push(`temp row wrong: ${JSON.stringify(temp)}`);
const growth = tab('Growth')?.[1];
if (!growth || growth[1] !== 7 || growth[2] !== 8 || growth[3] !== 20) problems.push(`growth row wrong: ${JSON.stringify(growth)}`);
if ((tab('Diapers')?.length ?? 0) !== 1 + 1501) problems.push(`diaper rows ${tab('Diapers')?.length} (expected header + 1501, deleted excluded)`);
const daily = tab('Daily');
const d11 = daily?.find((r) => r[0] === '2026-10-11');
if (!d11 || d11[1] !== 6.5 + 0 || d11[8] !== 4) problems.push(`daily 10/11 wrong: ${JSON.stringify(d11)}`);
if (!tab('About')?.[0][0].startsWith('Updated ')) problems.push('About tab missing');
fs.writeFileSync(process.env.SNAPSHOT_OUT || '/tmp/kidtracker-snapshot.json', snapFiles[0].content);
console.log('tabs:', Object.keys(sheets).join(', '), '| fetches:', fetches);
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'APPS SCRIPT OK');
process.exitCode = problems.length ? 1 : 0;
