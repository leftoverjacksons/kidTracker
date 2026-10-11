// Builds SQL that restores a kidTracker backup snapshot (JSON from Google Drive).
// Used by restore.html in the browser and by the unit tests; no network access.

const DATA_TABLES = ['babies', 'medications', 'events', 'nursing_segments'];

function dollarQuote(json) {
  let tag = 'kt';
  while (json.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${json}$${tag}$`;
}

/** @param {{app?: string, created_at?: string, tables: Record<string, object[]>}} snap */
export function buildRestoreSql(snap) {
  if (!snap || snap.app !== 'kidTracker' || !snap.tables) throw new Error('This is not a kidTracker backup file.');
  for (const t of DATA_TABLES) {
    if (!Array.isArray(snap.tables[t])) throw new Error(`Backup is missing table "${t}".`);
  }
  const j = (rows) => dollarQuote(JSON.stringify(rows));
  const settings = (snap.tables.household_settings || [])[0];
  const count = (t) => snap.tables[t].length;
  const lines = [
    `-- kidTracker restore from backup taken ${snap.created_at ?? '(unknown time)'}`,
    `-- ${DATA_TABLES.map((t) => `${t}: ${count(t)}`).join(', ')}`,
    '-- REPLACES all babies, medications, events and nursing segments currently in the database.',
    '-- Sign-in accounts are not touched. Entries logged by accounts that no longer exist keep their data',
    '-- but lose the "logged by" name.',
    'begin;',
    'delete from public.nursing_segments;',
    'delete from public.events;',
    'delete from public.medications;',
    'delete from public.babies;',
  ];
  if (settings) {
    lines.push(
      'update public.household_settings hs set',
      '  volume_unit = coalesce(s.volume_unit, hs.volume_unit), temp_unit = coalesce(s.temp_unit, hs.temp_unit),',
      '  weight_unit = coalesce(s.weight_unit, hs.weight_unit), length_unit = coalesce(s.length_unit, hs.length_unit),',
      '  timezone = coalesce(s.timezone, hs.timezone)',
      `  from json_populate_record(null::public.household_settings, ${dollarQuote(JSON.stringify(settings))}) s;`,
    );
  }
  if (Array.isArray(snap.tables.caregivers) && snap.tables.caregivers.length) {
    lines.push(
      'update public.caregivers c set display_name = s.display_name',
      `  from json_populate_recordset(null::public.caregivers, ${j(snap.tables.caregivers)}) s where s.id = c.id;`,
    );
  }
  lines.push(
    `insert into public.babies select * from json_populate_recordset(null::public.babies, ${j(snap.tables.babies)});`,
    `insert into public.medications select * from json_populate_recordset(null::public.medications, ${j(snap.tables.medications)});`,
    `create temp table _kt_events on commit drop as select * from json_populate_recordset(null::public.events, ${j(snap.tables.events)});`,
    'update _kt_events set created_by = null where created_by is not null and created_by not in (select id from public.caregivers);',
    'update _kt_events set updated_by = null where updated_by is not null and updated_by not in (select id from public.caregivers);',
    'insert into public.events select * from _kt_events;',
    `insert into public.nursing_segments select * from json_populate_recordset(null::public.nursing_segments, ${j(snap.tables.nursing_segments)});`,
    'commit;',
    `select (select count(*) from public.events) as events_restored, (select count(*) from public.babies) as babies_restored;`,
  );
  return lines.join('\n') + '\n';
}
