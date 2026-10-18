/**
 * kidTracker nightly backup → Google Drive + Google Sheet.
 *
 * Lives in your own Google account (script.google.com). Every night it:
 *   1. signs in to Supabase as the backup user,
 *   2. saves a full JSON snapshot of every table to the "kidTracker backups" Drive folder,
 *   3. deletes snapshots older than KEEP_DAYS,
 *   4. rewrites the "kidTracker data" Google Sheet (one tab per category, in your display units).
 * The nightly sign-in also counts as activity, so the free Supabase project never pauses.
 *
 * Setup: see SETUP.md §6. In short: set the Script Properties below, then run `setup` once.
 *
 * Script Properties (Project Settings → Script Properties):
 *   SUPABASE_URL       https://lusbippzmyvukzpswxxr.supabase.co
 *   SUPABASE_KEY       the publishable / anon key (same one GitHub uses)
 *   BACKUP_EMAIL       the backup account's email
 *   BACKUP_PASSWORD    the backup account's password
 *   KEEP_DAYS          optional, default 365
 */

const FOLDER_NAME = 'kidTracker backups';
const SHEET_NAME = 'kidTracker data';
const SNAPSHOT_TABLES = ['caregivers', 'household_settings', 'babies', 'medications', 'events', 'nursing_segments'];
const PAGE = 1000;

/** Run once by hand: creates the folder and sheet, schedules the nightly run, and runs a first backup. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  config_(); // fails early with a clear message if a property is missing
  const folder = getFolder_();
  props.setProperty('FOLDER_ID', folder.getId());
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runBackup')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runBackup').timeBased().everyDays(1).atHour(3).create();
  const result = runBackup();
  Logger.log('Setup complete. ' + result);
}

/** The nightly job. */
function runBackup() {
  const cfg = config_();
  const token = signIn_(cfg);
  const fetchAll = (path) => fetchAll_(cfg, token, path);

  // 1. Snapshot every table (including soft-deleted rows).
  const tables = {};
  SNAPSHOT_TABLES.forEach((t) => { tables[t] = fetchAll(t + '?select=*&order=id'); }); // stable order for paging
  const now = new Date();
  const snapshot = { app: 'kidTracker', version: 1, created_at: now.toISOString(), tables: tables };
  const folder = getFolder_();
  const tz = (tables.household_settings[0] && tables.household_settings[0].timezone) || Session.getScriptTimeZone();
  const name = 'kidtracker-' + Utilities.formatDate(now, tz, 'yyyy-MM-dd') + '.json';
  folder.getFilesByName(name).hasNext() && trashAll_(folder.getFilesByName(name)); // one snapshot per day
  folder.createFile(name, JSON.stringify(snapshot), 'application/json');

  // 2. Prune old snapshots.
  const cutoff = now.getTime() - cfg.keepDays * 86400000;
  const files = folder.getFiles();
  let pruned = 0;
  while (files.hasNext()) {
    const f = files.next();
    if (/^kidtracker-\d{4}-\d{2}-\d{2}\.json$/.test(f.getName()) && f.getDateCreated().getTime() < cutoff) {
      f.setTrashed(true);
      pruned++;
    }
  }

  // 3. Refresh the Google Sheet.
  writeSheet_(cfg, token, folder, tables, tz, now);

  const counts = SNAPSHOT_TABLES.map((t) => t + '=' + tables[t].length).join(' ');
  return 'Saved ' + name + ' (' + counts + '), pruned ' + pruned + '.';
}

// ───────────────────────── Google Sheet ─────────────────────────

function writeSheet_(cfg, token, folder, tables, tz, now) {
  const settings = tables.household_settings[0] || {};
  const u = units_(settings);
  const names = {};
  tables.caregivers.forEach((c) => { names[c.id] = c.display_name; });
  const who = (r) => names[r.created_by] || '';
  const babyIds = tables.babies.map((b) => b.id);
  const babyId = babyIds[0];
  const get = (view, order) => (babyId ? fetchAll_(cfg, token, view + '?select=*&baby_id=eq.' + babyId + '&order=' + order) : []);
  const ts = (iso) => (iso ? new Date(iso) : '');

  const tabs = sheetTabs_(u, who, ts, {
    daily: get('v_daily_summary', 'day.desc'),
    sleep: get('v_sleep', 'started_at.desc'),
    feeds: get('v_feeds', 'started_at.desc'),
    diapers: get('v_diapers', 'started_at.desc'),
    pumps: get('v_pumps', 'started_at.desc'),
    meds: get('v_meds', 'started_at.desc'),
    temps: get('v_temps', 'started_at.desc'),
    growth: get('v_growth', 'started_at.desc'),
  });

  const ss = getSpreadsheet_(folder);
  ss.setSpreadsheetTimeZone(tz);
  tabs.forEach((tab) => {
    const sheet = ss.getSheetByName(tab.name) || ss.insertSheet(tab.name);
    sheet.clearContents();
    const values = [tab.header].concat(tab.rows);
    sheet.getRange(1, 1, values.length, tab.header.length).setValues(values);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, tab.header.length).setFontWeight('bold');
    tab.header.forEach((h, i) => {
      if (/^(start|end|time)$/.test(h)) sheet.getRange(2, i + 1, Math.max(1, tab.rows.length), 1).setNumberFormat('yyyy-mm-dd h:mm am/pm');
    });
  });
  const about = ss.getSheetByName('About') || ss.insertSheet('About');
  about.clearContents();
  about.getRange(1, 1, 3, 1).setValues([
    ['Updated ' + Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm') + ' (' + tz + ')'],
    ['This sheet is rewritten every night from the kidTracker database. Edits made here are overwritten; change data in the app.'],
    ['Full backups (JSON) are in the "' + FOLDER_NAME + '" folder.'],
  ]);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

/** Pure: build tab definitions from view rows. Kept free of Google services so it can be tested. */
function sheetTabs_(u, who, ts, d) {
  const h = (m) => Math.round((Number(m) / 60) * 10) / 10;
  return [
    { name: 'Daily', header: ['date', 'sleep_hours', 'night_hours', 'nap_hours', 'feeds', 'nursing_left_min', 'nursing_right_min',
        'bottles', 'bottle_' + u.vol, 'diapers', 'wet', 'dirty', 'pumped_' + u.vol, 'tummy_min', 'med_doses'],
      rows: d.daily.map((r) => [r.day, h(r.sleep_min), h(r.night_sleep_min), h(r.nap_sleep_min), r.feeds, r.nursing_left_min,
        r.nursing_right_min, r.bottles, u.v(r.bottle_ml), r.diapers, r.wet_diapers, r.dirty_diapers, u.v(r.pump_ml), r.tummy_min, r.med_doses]) },
    { name: 'Sleep', header: ['start', 'end', 'duration_min', 'kind', 'notes', 'logged_by'],
      rows: d.sleep.map((r) => [ts(r.started_at), ts(r.ended_at), r.duration_min, r.kind, r.notes || '', who(r)]) },
    { name: 'Feeds', header: ['start', 'type', 'left_min', 'right_min', 'bottle_' + u.vol, 'bottle_contents', 'notes', 'logged_by'],
      rows: d.feeds.map((r) => [ts(r.started_at), r.feed_type, num_(r.left_min), num_(r.right_min), u.v(r.bottle_ml),
        (r.bottle_contents || '').replace('_', ' '), r.notes || '', who(r)]) },
    { name: 'Diapers', header: ['time', 'wet', 'dirty', 'color', 'consistency', 'rash', 'notes', 'logged_by'],
      rows: d.diapers.map((r) => [ts(r.started_at), r.wet ? 'yes' : 'no', r.dirty ? 'yes' : 'no', r.poop_color || '',
        r.poop_consistency || '', r.rash ? 'yes' : '', r.notes || '', who(r)]) },
    { name: 'Pumping', header: ['start', 'end', 'duration_min', 'side', 'left_' + u.vol, 'right_' + u.vol, 'total_' + u.vol, 'notes', 'logged_by'],
      rows: d.pumps.map((r) => [ts(r.started_at), ts(r.ended_at), r.duration_min, r.pump_side || '', u.v(r.pump_left_ml),
        u.v(r.pump_right_ml), u.v(r.total_ml), r.notes || '', who(r)]) },
    { name: 'Medicine', header: ['time', 'medication', 'for', 'dose', 'unit', 'notes', 'logged_by'],
      rows: d.meds.map((r) => [ts(r.started_at), r.medication || '', r.for_whom || 'baby', num_(r.dose_amount), r.dose_unit || '', r.notes || '', who(r)]) },
    { name: 'Temperature', header: ['time', 'temp_' + u.temp, 'method', 'notes', 'logged_by'],
      rows: d.temps.map((r) => [ts(r.started_at), u.t(r.temp_c), r.temp_method || '', r.notes || '', who(r)]) },
    { name: 'Growth', header: ['date'].concat(u.wHeader, ['length_' + u.len, 'head_' + u.len, 'notes', 'logged_by']),
      rows: d.growth.map((r) => [r.measured_on].concat(u.w(r.weight_g), [u.l(r.length_cm), u.l(r.head_cm), r.notes || '', who(r)])) },
  ];
}

function units_(s) {
  const r1 = (n) => Math.round(n * 10) / 10;
  const oz = (s.volume_unit || 'oz') === 'oz';
  const f = (s.temp_unit || 'F') === 'F';
  const inch = (s.length_unit || 'in') === 'in';
  const lb = (s.weight_unit || 'lb_oz') === 'lb_oz';
  const blank = (x) => x === null || x === undefined || x === '';
  return {
    vol: oz ? 'oz' : 'ml', temp: f ? 'F' : 'C', len: inch ? 'in' : 'cm',
    wHeader: lb ? ['weight_lb', 'weight_oz'] : ['weight_kg'],
    v: (ml) => (blank(ml) ? '' : r1(oz ? Number(ml) / 29.5735 : Number(ml))),
    t: (c) => (blank(c) ? '' : r1(f ? Number(c) * 9 / 5 + 32 : Number(c))),
    l: (cm) => (blank(cm) ? '' : r1(inch ? Number(cm) / 2.54 : Number(cm))),
    w: (g) => {
      if (blank(g)) return lb ? ['', ''] : [''];
      if (!lb) return [Math.round(Number(g)) / 1000];
      const totalOz = Math.round((Number(g) / 453.59237) * 16 * 10) / 10;
      const pounds = Math.floor(totalOz / 16);
      return [pounds, Math.round((totalOz - pounds * 16) * 10) / 10];
    },
  };
}

function num_(x) { return x === null || x === undefined ? '' : Number(x); }

// ───────────────────────── Supabase ─────────────────────────

function config_() {
  const p = PropertiesService.getScriptProperties();
  const need = ['SUPABASE_URL', 'SUPABASE_KEY', 'BACKUP_EMAIL', 'BACKUP_PASSWORD'];
  const missing = need.filter((k) => !p.getProperty(k));
  if (missing.length) throw new Error('Missing Script Properties: ' + missing.join(', ') + ' (Project Settings → Script Properties).');
  return {
    url: p.getProperty('SUPABASE_URL').replace(/\/+$/, ''),
    key: p.getProperty('SUPABASE_KEY'),
    email: p.getProperty('BACKUP_EMAIL'),
    password: p.getProperty('BACKUP_PASSWORD'),
    keepDays: Number(p.getProperty('KEEP_DAYS') || 365),
  };
}

function signIn_(cfg) {
  const res = UrlFetchApp.fetch(cfg.url + '/auth/v1/token?grant_type=password', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: cfg.key },
    payload: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Supabase sign-in failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300) +
      '. If the project was paused, restore it in the Supabase dashboard.');
  }
  return JSON.parse(res.getContentText()).access_token;
}

function fetchAll_(cfg, token, path) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + path + '&limit=' + PAGE + '&offset=' + offset, {
      muteHttpExceptions: true,
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + token },
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Reading ' + path.split('?')[0] + ' failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
    }
    const rows = JSON.parse(res.getContentText());
    rows.forEach((r) => out.push(r));
    if (rows.length < PAGE) return out;
  }
}

// ───────────────────────── Drive ─────────────────────────

function getFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: recreate */ } }
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function getSpreadsheet_(folder) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted: recreate */ } }
  const ss = SpreadsheetApp.create(SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function trashAll_(it) { while (it.hasNext()) it.next().setTrashed(true); }
