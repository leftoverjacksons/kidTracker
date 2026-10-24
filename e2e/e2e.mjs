// Two-phone end-to-end test: drives the built app in headless Chromium against
// a local Postgres + PostgREST (standing in for Supabase), as Parent A and B.
// Run via e2e/run.sh. Realtime is not emulated; the test triggers the app's
// refresh-on-wake instead.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { vapidAuth } from '../supabase/functions/push-tick/index.ts';

const DIR = process.argv[2], OUT = process.argv[3];
const SECRET = 'local-test-secret-local-test-secret-123';
const USERS = {
  'parent.a@example.com': '00000000-0000-0000-0000-00000000000a',
  'parent.b@example.com': '00000000-0000-0000-0000-00000000000b',
  'grandma@example.com': '00000000-0000-0000-0000-00000000000c',
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub, email) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

const srv = http.createServer((req, res) => {
  let p = path.join(DIR, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIR, 'index.html');
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };
  res.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(4174);

const psql = (q) => execFileSync('psql', ['-qtA', '-d', 'kidtracker_e2e', '-c', q], { encoding: 'utf8' }).trim();
// Same, but as signed-in Parent A (report views only show data to people on the caregiver list).
const psqlAsA = (q) => execFileSync('psql', ['-qtA', '-d', 'kidtracker_e2e', '-c', 'set role authenticated',
  '-c', "select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false)", '-c', q], { encoding: 'utf8' }).trim().split('\n').at(-1);

// The full Chromium build (not the headless shell), which has Push and Notifications.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' });
const problems = [];
let step = 0;

async function phone(name) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  await ctx.routeWebSocket(/realtime/, (ws) => ws.close());
  await ctx.route('https://abcdefgh.supabase.co/**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes('/auth/v1/token')) {
      const body = JSON.parse(req.postData() || '{}');
      const id = USERS[body.email];
      if (!id || body.password !== 'pw') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' }) });
      const user = { id, email: body.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: jwt(id, body.email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user }) });
    }
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 204, body: '' });
    if (url.includes('/rest/v1/')) {
      const resp = await route.fetch({ url: url.replace('https://abcdefgh.supabase.co/rest/v1', 'http://localhost:3001') });
      const expected = name === 'C' && req.method() === 'POST' && url.includes('/rest/v1/events'); // the guest write test
      if (resp.status() >= 400 && !expected) problems.push(`${name} HTTP ${resp.status()} ${req.method()} ${url.split('/rest/v1')[1]}: ${(await resp.text()).slice(0, 200)}`);
      return route.fulfill({ response: resp });
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
  // HTTP failures are reported by the route handler above, so resource-load console noise is skipped.
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource/i.test(m.text())) problems.push(`${name} console: ${m.text().slice(0, 200)}`); });
  await page.goto('http://localhost:4174/');
  return page;
}

const shot = async (page, label) => page.screenshot({ path: `${OUT}/${String(++step).padStart(2, '0')}-${label}.png` });
const wait = (page, ms = 600) => page.waitForTimeout(ms);
async function signIn(page, email) {
  await page.locator('ion-input[type="email"] input').fill(email);
  await page.locator('ion-input[type="password"] input').fill('pw');
  await page.getByRole('button', { name: /sign in/i }).click();
  await wait(page, 1200);
}
const tile = (page, label) => page.locator('.tile', { hasText: label }).first();
const sheet = (page) => page.locator('ion-modal.show-modal');
async function closeSheet(page) {
  if (await sheet(page).count()) { await sheet(page).getByRole('button', { name: 'Close' }).click(); await wait(page, 500); }
}
async function expectText(page, text, where = 'body') {
  const ok = await page.locator(where).getByText(text, { exact: false }).first().isVisible().catch(() => false);
  if (!ok) problems.push(`expected to see "${text}" at step ${step}`);
}
const refresh = async (page) => { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(page, 900); };

// ── Phone A: wrong password, then sign in and onboard
const A = await phone('A');
await wait(A, 800);
await A.locator('ion-input[type="email"] input').fill('parent.a@example.com');
await A.locator('ion-input[type="password"] input').fill('nope');
await A.getByRole('button', { name: /sign in/i }).click();
await wait(A, 800);
await expectText(A, 'Wrong email or password');
await A.locator('ion-input[type="password"] input').fill('pw');
await A.getByRole('button', { name: /sign in/i }).click();
await wait(A, 1500);
await shot(A, 'onboarding');
await A.locator('ion-input').first().locator('input').fill('Test Baby');
await A.locator('ion-input[type="date"] input').fill('2026-10-01');
await A.getByRole('button', { name: 'Save' }).click();
await wait(A, 1500);
await shot(A, 'home-empty');

// Diaper: one tap
await tile(A, 'Diaper').click(); await wait(A);
await shot(A, 'diaper-sheet');
await sheet(A).locator('.big-btn', { hasText: 'Wet' }).click(); await wait(A, 1000);
await expectText(A, 'Diaper logged');
await expectText(A, 'Saved:', '.diaper-saved'); // the sheet stays open for details
await sheet(A).getByRole('button', { name: 'Done' }).click(); await wait(A, 500);
await expectText(A, 'Wet', '.tile');

// Diaper with details: log first, then add details to the same diaper (one row, not two)
const diapersBefore = Number(psql(`select count(*) from events where type = 'diaper' and deleted_at is null`));
await tile(A, 'Diaper').click(); await wait(A);
await sheet(A).locator('.big-btn', { hasText: 'Dirty' }).click(); await wait(A, 1000);
await sheet(A).locator('.big-btn', { hasText: 'Both' }).click(); await wait(A, 800); // corrects it, no second diaper
await sheet(A).locator('ion-chip', { hasText: 'yellow' }).click(); await wait(A, 500);
await sheet(A).locator('ion-chip', { hasText: 'seedy' }).click(); await wait(A, 500);
await sheet(A).locator('ion-textarea textarea').fill('blowout'); await wait(A, 1200);
await sheet(A).getByRole('button', { name: 'Done' }).click(); await wait(A, 800);
const diaperRow = psql(`select diaper_wet, diaper_dirty, poop_color, poop_consistency, notes from events
  where type = 'diaper' and deleted_at is null order by started_at desc limit 1`);
const diapersAfter = Number(psql(`select count(*) from events where type = 'diaper' and deleted_at is null`));
if (diapersAfter !== diapersBefore + 1) problems.push(`diaper details: expected one new diaper, got ${diapersAfter - diapersBefore}`);
if (!/^t\|t\|yellow\|seedy\|blowout$/.test(diaperRow)) problems.push(`diaper details not saved to the logged diaper: ${diaperRow}`);

// Bottle, untimed: "Forgot to time it?" → type the amount drunk
await tile(A, 'Bottle').click(); await wait(A);
await sheet(A).getByRole('button', { name: /Forgot to time it/ }).click(); await wait(A, 300);
await sheet(A).locator('ion-segment-button[value="drank"]').click(); await wait(A, 300);
await sheet(A).locator('ion-input').nth(0).locator('input').fill('3'); await wait(A, 200);
await shot(A, 'bottle-sheet');
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await expectText(A, '3 oz', '.tile');

// Bottle, timed: type what's in the bottle → Start → Stop → type what's left → drank + flow rate
await tile(A, 'Bottle').click(); await wait(A);
await sheet(A).locator('ion-input').nth(0).locator('input').fill('3'); await wait(A, 200);
await sheet(A).locator('ion-select', { hasText: 'Bottle' }).click(); await wait(A, 500);
await A.locator('ion-action-sheet button', { hasText: 'Comotomo' }).click(); await wait(A, 500);
await sheet(A).locator('.big-btn-start', { hasText: 'Start' }).click(); await wait(A, 1200);
await closeSheet(A);
await expectText(A, 'Feeding', '.tile');
psql(`update events set started_at = now() - interval '12 minutes' where type = 'bottle' and ended_at is null`);
await refresh(A);
await tile(A, 'Bottle').click(); await wait(A);
await expectText(A, 'In the bottle: 3 oz · Comotomo');
// Pause for a burp: the paused minutes don't count toward the feed.
await sheet(A).locator('.big-btn', { hasText: 'Pause' }).click(); await wait(A, 1000);
await expectText(A, 'Paused');
psql(`update events set paused_at = now() - interval '3 minutes' where type = 'bottle' and ended_at is null`);
await refresh(A);
await closeSheet(A);
await expectText(A, 'Paused', '.tile');
await tile(A, 'Bottle').click(); await wait(A);
await shot(A, 'bottle-paused');
await sheet(A).locator('.big-btn', { hasText: 'Resume' }).click(); await wait(A, 1000);
await sheet(A).locator('.big-btn-stop', { hasText: 'Stop' }).click(); await wait(A, 1200);
// Closing before typing the left-over amount: reopening picks the bottle up again.
await closeSheet(A);
await tile(A, 'Bottle').click(); await wait(A);
await expectText(A, 'Bottle stopped');
await sheet(A).locator('ion-input').nth(0).locator('input').fill('1'); await wait(A, 300);
await expectText(A, 'Drank 2 oz', '.bottle-drank');
await expectText(A, 'oz/min', '.bottle-drank');
await shot(A, 'bottle-timer-finish');
await sheet(A).locator('.big-btn-start', { hasText: 'Save' }).click(); await wait(A, 1200);
const timed = psql(`select round(extract(epoch from ended_at - started_at) / 60) || ' ' || round(paused_s / 60.0) || ' ' || round(bottle_ml) || ' ' || round(bottle_start_ml) || ' ' || bottle_brand from events where type = 'bottle' and ended_at > started_at`);
if (!/^1[12] 3 59 89 Comotomo$/.test(timed)) problems.push(`timed bottle saved as "${timed}" (expected ~12 min with 3 paused, drank 59 ml of 89 ml)`);
await expectText(A, 'oz/min');  // the entry in Today's list shows its flow rate

// Sleep start on A
await tile(A, 'Sleep').click(); await wait(A);
await sheet(A).locator('.big-btn-start').click(); await wait(A, 1200);
await shot(A, 'sleep-running');
await closeSheet(A);
await expectText(A, 'Asleep', '.tile');

// ── Phone B signs in, sees the running sleep, stops it
const B = await phone('B');
await wait(B, 800);
await signIn(B, 'parent.b@example.com');
await wait(B, 800);
await shot(B, 'phoneB-home');
await expectText(B, 'Asleep', '.tile');
await tile(B, 'Sleep').click(); await wait(B);
await expectText(B, 'by Parent A');
await sheet(B).locator('.big-btn-stop').click(); await wait(B, 1000);
await expectText(B, 'Awake', '.tile');

// A refreshes (simulates realtime/wake) and sees it stopped
await refresh(A);
await expectText(A, 'Awake', '.tile');

// Both press Start at nearly the same time → one sleep
await tile(A, 'Sleep').click(); await tile(B, 'Sleep').click(); await wait(A);
await Promise.all([sheet(A).locator('.big-btn-start').click(), sheet(B).locator('.big-btn-start').click()]);
await wait(A, 1500);
await closeSheet(A); await closeSheet(B);
await refresh(A); await refresh(B);
const sleepsA = await A.locator('ion-item', { hasText: 'Sleep' }).filter({ hasText: 'in progress' }).count();
if (sleepsA !== 1) problems.push(`expected exactly 1 running sleep after simultaneous start, saw ${sleepsA}`);
await tile(A, 'Sleep').click(); await wait(A);
await sheet(A).locator('.big-btn-stop').click(); await wait(A, 1000);

// Nursing: start L on A, switch R on B, finish on A
await tile(A, 'Nurse').click(); await wait(A);
await sheet(A).locator('.side-btn', { hasText: 'start left' }).click(); await wait(A, 1500);
await shot(A, 'nursing-running');
await closeSheet(A);
await refresh(B);
await tile(B, 'Nurse').click(); await wait(B);
await sheet(B).locator('.side-btn').nth(1).click(); await wait(B, 1200);
await closeSheet(B);
await refresh(A);
await expectText(A, 'R ·', '.tile');
await tile(A, 'Nurse').click(); await wait(A);
await sheet(A).locator('.big-btn-stop').click(); await wait(A, 1000);
await expectText(A, 'last R', '.tile');

// Manual nursing entry
await tile(A, 'Nurse').click(); await wait(A);
await sheet(A).locator('ion-segment-button[value="manual"]').click(); await wait(A, 400);
const mins = sheet(A).locator('ion-input[type="number"] input');
await mins.nth(0).fill('10'); await mins.nth(1).fill('5');
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await expectText(A, 'L 10m · R 5m');

// ── Auto-stop (design doc §8a E1): a diaper ends a running sleep; Undo reopens it
await tile(A, 'Sleep').click(); await wait(A);
await sheet(A).locator('.big-btn-start').click(); await wait(A, 1200);
await closeSheet(A);
await tile(A, 'Diaper').click(); await wait(A);
await sheet(A).locator('.big-btn', { hasText: 'Wet' }).click(); await wait(A, 1500);
await closeSheet(A);
const autoToast = await A.locator('ion-toast').last().evaluate((t) => t.message);
if (!/Sleep ended/.test(autoToast)) problems.push(`diaper did not end the running sleep (toast: ${autoToast})`);
await expectText(A, 'Awake', '.tile');
await A.locator('ion-toast').last().evaluate((t) => t.shadowRoot.querySelector('button').click()); await wait(A, 1500);
await expectText(A, 'Asleep', '.tile'); // sleep reopened by Undo
await tile(A, 'Sleep').click(); await wait(A);
await sheet(A).locator('.big-btn-stop').click(); await wait(A, 1000);

// Nursing on the right ends pumping on the right
await tile(A, 'Pump').click(); await wait(A);
if ((await sheet(A).locator('.gauge-btn').count()) !== 2) problems.push('pump sheet has no L/R gauges');
await sheet(A).locator('ion-segment-button[value="right"]').click(); await wait(A, 300);
await sheet(A).locator('.big-btn-start').click(); await wait(A, 1200);
await closeSheet(A);
await tile(A, 'Nurse').click(); await wait(A);
await sheet(A).locator('.side-btn', { hasText: 'start right' }).click(); await wait(A, 1500);
const nurseToast = await A.locator('ion-toast').last().evaluate((t) => t.message);
if (!/Pumping ended/.test(nurseToast)) problems.push(`right nursing did not end right pumping (toast: ${nurseToast})`);
await sheet(A).locator('.big-btn-stop').click(); await wait(A, 1000);
if (await A.locator('.tile.tile-live', { hasText: 'Pump' }).count()) problems.push('pump still running after right-side nursing');

// Pump timer with amounts
await tile(A, 'Pump').click(); await wait(A);
await sheet(A).locator('ion-segment-button[value="both"]').click(); await wait(A, 300); // defaults to the last side used
await sheet(A).locator('.big-btn-start').click(); await wait(A, 1200);
const amt = sheet(A).locator('ion-input[type="number"] input');
await amt.nth(0).fill('2'); await amt.nth(1).fill('1.5');
await sheet(A).locator('.big-btn-stop').click(); await wait(A, 1500);
await expectText(A, '3.5 oz', '.tile');

// Meds, Temp, Tummy and Bath live under More
if (await A.locator('.tile', { hasText: 'Bath' }).count()) problems.push('Bath tile visible before More was opened');
await A.locator('.more-toggle').click(); await wait(A, 400);
// Meds: a baby medicine typed in, a Mom medicine from the presets; buttons grey out until allowed
await tile(A, 'Meds').click(); await wait(A);
await sheet(A).getByRole('button', { name: 'Add medication' }).click(); await wait(A, 300);
await sheet(A).locator('ion-segment-button[value="baby"]').click(); await wait(A, 200);
await sheet(A).locator('ion-input').nth(0).locator('input').fill('Vitamin D');
await sheet(A).locator('ion-input').nth(1).locator('input').fill('1');
await sheet(A).locator('ion-input').nth(2).locator('input').fill('drop');
await sheet(A).locator('ion-input').nth(3).locator('input').fill('24');
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await sheet(A).getByRole('button', { name: 'Add medication' }).click(); await wait(A, 300);
await sheet(A).locator('ion-select').click(); await wait(A, 400);
await A.locator('ion-popover ion-item', { hasText: 'Ibuprofen' }).click(); await wait(A, 400);
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
const medBtn = (name) => sheet(A).locator(`.med-row[data-med="${name}"] ion-button`);
const greyed = (name) => medBtn(name).evaluate((el) => el.disabled === true);
if (!(await sheet(A).getByText('Mom', { exact: true }).count())) problems.push('no Mom section in meds');
if (await greyed('Ibuprofen')) problems.push('Ibuprofen greyed out before any dose');
await medBtn('Vitamin D').click(); await wait(A, 1000);
await tile(A, 'Meds').click(); await wait(A);
await medBtn('Ibuprofen').click(); await wait(A, 1000);
await tile(A, 'Meds').click(); await wait(A);
await shot(A, 'meds-sheet');
for (const n of ['Ibuprofen', 'Vitamin D']) if (!(await greyed(n))) problems.push(`${n} button not greyed out after a dose`);
await expectText(A, 'in 6h', '.med-row[data-med="Ibuprofen"]');
await closeSheet(A);
await expectText(A, 'Ibuprofen', '.tile'); // the Meds tile shows when the soonest one is next available
const medDoses = psqlAsA(`select med_doses from v_daily_summary where day = public.local_day(now())`);
if (medDoses !== '1') problems.push(`baby's daily med_doses is ${medDoses}; Mom's ibuprofen must not count`);

// Pump tile shows two gauges (L/R); the short test sessions don't count (need 15+ min)
const gauges = await A.locator('.tile', { hasText: 'Pump' }).locator('.pump-gauge').count();
if (gauges !== 2) problems.push(`pump tile shows ${gauges} gauges`);
// Rare tiles live under More
// Temperature, growth, bath, tummy manual
await tile(A, 'Temp').click(); await wait(A);
await sheet(A).locator('ion-input[type="number"] input').fill('98'); // 98.0 °F must not come back as 98.1
await sheet(A).locator('ion-chip', { hasText: 'axillary' }).click();
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await expectText(A, '98 °F', '.tile');
if (await A.locator('.tile', { hasText: '98.1' }).count()) problems.push('98 °F was stored as 98.1 °F');

await tile(A, 'Growth').click(); await wait(A);
const g = sheet(A).locator('ion-input[type="number"] input');
await g.nth(0).fill('7'); await g.nth(1).fill('8'); await g.nth(2).fill('20');
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await expectText(A, '7 lb 8 oz', '.tile');

await tile(A, 'Bath').click(); await wait(A);
await sheet(A).locator('.big-btn', { hasText: 'Bath now' }).click(); await wait(A, 1000);

await tile(A, 'Tummy').click(); await wait(A);
await sheet(A).locator('ion-segment-button[value="manual"]').click(); await wait(A, 400);
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await expectText(A, '10m today', '.tile');

await A.evaluate(() => window.scrollTo(0, 0));
await shot(A, 'home-full');
await A.locator('ion-content').evaluate((el) => el.scrollToBottom(0));
await wait(A, 400);
await shot(A, 'home-today-list');

// Edit an entry from the Today list: bottle 3 → 4 oz
await A.locator('ion-item', { hasText: 'Bottle' }).first().click(); await wait(A);
await shot(A, 'edit-bottle');
await sheet(A).locator('ion-input[type="number"] input').fill('4');
await sheet(A).getByRole('button', { name: 'Save changes' }).click(); await wait(A, 1000);
await expectText(A, '4 oz', '.tile');

// Delete with undo
await A.locator('ion-item', { hasText: 'Bath' }).first().click(); await wait(A);
await sheet(A).getByRole('button', { name: 'Delete' }).click(); await wait(A, 800);
await A.locator('ion-toast').last().evaluate((t) => t.shadowRoot.querySelector('button').click());
await wait(A, 1200);
const baths = await A.locator('ion-item', { hasText: 'Bath' }).count();
if (baths < 1) problems.push('undo delete did not restore the bath');

// History tab with filter
await A.getByRole('tab', { name: /history/i }).click().catch(async () => A.locator('ion-tab-button[tab="history"]').click());
await wait(A, 1000);
await shot(A, 'history');
await A.locator('.filter-row ion-chip', { hasText: 'Diaper' }).click(); await wait(A, 800);
await shot(A, 'history-filtered');
const nonDiaper = await A.locator('.ion-page:not(.ion-page-hidden)').last().locator('ion-item').filter({ hasNotText: 'Diaper' }).count();
if (nonDiaper) problems.push(`history filter shows ${nonDiaper} non-diaper rows`);

// ── History → Timeline: select a nursing block, nudge its end +5 min, then undo
await A.locator('ion-segment-button[value="timeline"]').click(); await wait(A, 1200);
const tl = A.locator('.ion-page:not(.ion-page-hidden)').last();
const blocks = await tl.locator('.tl-block').count();
if (blocks < 3) problems.push(`timeline shows ${blocks} blocks (expected sleeps + feeds)`);
if (!(await tl.locator('.tl-now').count())) problems.push('timeline has no now line');
// The 15-minute manual feed is the tallest nursing block; tap its left edge (bottle dots sit centred).
const nurseBlocks = tl.locator('.tl-block[aria-label^="Nurse"]');
let nurseBlock = nurseBlocks.first(), tallest = -1;
for (let i = 0; i < await nurseBlocks.count(); i++) {
  const h = (await nurseBlocks.nth(i).boundingBox())?.height ?? 0;
  if (h > tallest) { tallest = h; nurseBlock = nurseBlocks.nth(i); }
}
await nurseBlock.click({ position: { x: 3, y: Math.max(1, Math.floor(tallest / 2)) } }); await wait(A, 400);
const before = await tl.locator('.tl-card-detail').textContent();
if (!/\(15m\)/.test(before ?? '')) problems.push(`timeline card before nudge: ${before}`);
await tl.locator('.tl-card ion-button', { hasText: '+5' }).nth(1).click(); await wait(A, 1200);
const after = await tl.locator('.tl-card-detail').textContent();
if (!/\(20m\)/.test(after ?? '')) problems.push(`timeline card after +5 end: ${after}`);
await A.locator('ion-toast').last().evaluate((t) => t.shadowRoot.querySelector('button').click()); await wait(A, 1200);
const undone = await tl.locator('.tl-card-detail').textContent();
if (!/\(15m\)/.test(undone ?? '')) problems.push(`timeline undo did not restore: ${undone}`);
await shot(A, 'history-timeline');
// Zoom stretches only the time axis
const tlBody = tl.locator('.tl-body');
const hBefore = (await tlBody.boundingBox()).height, colsBefore = await tl.locator('.tl-col').count();
await tl.locator('.tl-card-head ion-button').click(); await wait(A, 300);
await tl.locator('.tl-zoom ion-button').nth(1).click(); await wait(A, 500);
const hAfter = (await tlBody.boundingBox()).height;
if (!(hAfter > hBefore * 1.4) || (await tl.locator('.tl-col').count()) !== colsBefore) problems.push(`zoom: height ${hBefore}→${hAfter}, cols ${colsBefore}→${await tl.locator('.tl-col').count()}`);
await tl.locator('.tl-zoom-label').click(); await wait(A, 400);
// Two-finger pinch zooms the time axis and must not select or move a block
{
  const bb = await tlBody.boundingBox();
  const cx = bb.x + bb.width / 2, cy = bb.y + Math.min(bb.height, 500) / 2;
  const cdp = await A.context().newCDPSession(A);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[cx, cy - 30]]);
  await touch('touchStart', [[cx, cy - 30], [cx, cy + 30]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx, cy - 30 - i * 12], [cx, cy + 30 + i * 12]]);
  await touch('touchEnd', []);
  await wait(A, 500);
  const z = Number(await tlBody.getAttribute('data-zoom'));
  if (!(z > 2)) problems.push(`pinch did not zoom (zoom=${z})`);
  if (await tl.locator('.tl-card').count()) problems.push('pinch selected a block');
  await tl.locator('.tl-zoom-label').click(); await wait(A, 400);
}
await A.locator('ion-segment-button[value="list"]').click(); await wait(A, 500);

// ── Home-screen shortcut deep link opens the logging sheet
await A.locator('ion-tab-button[tab="home"]').click(); await wait(A, 600);
await A.evaluate(() => { location.hash = '#/home?log=bottle'; }); await wait(A, 1200);
if (!(await sheet(A).locator('ion-title', { hasText: 'Bottle' }).count())) problems.push('shortcut #/home?log=bottle did not open the Bottle sheet');
await closeSheet(A);

// ── "Still running?" check: a tummy timer Parent B started 45 min ago (threshold 30)
psql(`insert into events (baby_id, type, started_at, created_by) select id, 'tummy_time', now() - interval '45 minutes',
  '00000000-0000-0000-0000-00000000000b' from babies limit 1`);
await refresh(A); await wait(A, 600);
await expectText(A, 'Tummy time has been running 45m');
await expectText(A, 'by Parent B', '.still-running');
await A.locator('.ion-page:not(.ion-page-hidden) ion-content').first().evaluate((el) => el.scrollToTop(0)); await wait(A, 300);
await shot(A, 'still-running');
await A.locator('.still-running ion-button', { hasText: 'Yes, still going' }).click(); await wait(A, 400);
if (await A.locator('.still-running').count()) problems.push('"Yes, still going" did not hide the check');
await B.locator('ion-tab-button[tab="home"]').click(); await refresh(B);
await expectText(B, 'Still going?', '.still-running'); // snoozing is per phone
await B.locator('.still-running ion-button', { hasText: 'It ended at' }).click(); await wait(B, 300);
const endLocal = await B.evaluate(() => {
  const d = new Date(Date.now() - 25 * 60_000), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
});
await B.locator('.still-running ion-input input').fill(endLocal); await wait(B, 300);
await B.locator('.still-running ion-button', { hasText: 'Save end time' }).click(); await wait(B, 1200);
const tummyMin = psql(`select round(extract(epoch from ended_at - started_at) / 60) from events where type = 'tummy_time' and started_at between now() - interval '50 minutes' and now() - interval '40 minutes'`);
if (!['19', '20', '21'].includes(tummyMin)) problems.push(`"It ended at" saved ${tummyMin} min of tummy time, expected ~20`);
if (await B.locator('.still-running').count()) problems.push('check still showing after saving an end time');

// ── Settings: set sex for growth percentiles
await A.locator('ion-tab-button[tab="settings"]').click(); await wait(A, 800);
await A.locator('ion-select', { hasText: 'Sex' }).click(); await wait(A, 600);
await A.locator('ion-action-sheet button', { hasText: 'Female' }).click(); await wait(A, 1200);
// Notifications: the push-tick function isn't deployed here, so Settings says so and nothing breaks
await expectText(A, 'Not set up in Supabase yet');
// The service worker turns a push message into a notification (delivered via DevTools, as a push service would).
{
  await A.context().grantPermissions(['notifications'], { origin: 'http://localhost:4174' });
  const cdp = await A.context().newCDPSession(A);
  const regId = new Promise((ok) => cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
    const r = e.registrations.find((x) => x.scopeURL.startsWith('http://localhost:4174') && !x.isDeleted);
    if (r) ok(r.registrationId);
  }));
  await cdp.send('ServiceWorker.enable');
  const id = await Promise.race([regId, new Promise((ok) => setTimeout(() => ok(null), 5000))]);
  if (!id) problems.push('no service worker registration to deliver a push to');
  else {
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: 'http://localhost:4174', registrationId: id,
      data: JSON.stringify({ title: 'Time to pump', body: 'Last session 2h ago.', tag: 'pump', url: '#/home?log=pump' }) });
    await wait(A, 1000);
    const titles = await A.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.title));
    if (!titles.includes('Time to pump')) problems.push(`push did not show a notification: ${JSON.stringify(titles)}`);
  }
}

// ── Reports
await A.locator('ion-tab-button[tab="reports"]').click(); await wait(A, 2000);
const reports = A.locator('.ion-page:not(.ion-page-hidden)').last();
await expectText(A, 'Daily average');
if (await reports.getByText('Sleep map').count()) problems.push('sleep map should have moved to History → Timeline');
const canvases = await reports.locator('canvas').count();
if (canvases < 5) problems.push(`expected >= 5 charts on Reports, saw ${canvases}`);
await expectText(A, 'th pct');
await expectText(A, 'Weight vs.');
await expectText(A, 'Longest sleep stretch');
await expectText(A, 'today so far'); // the only day with data is today → partial
await expectText(A, 'Log another weight to see the change.'); // e2e logs a single weight
await shot(A, 'reports-top');
await reports.locator('ion-content').evaluate((el) => el.scrollToPoint(0, 1400, 0));
await wait(A, 500);
await shot(A, 'reports-growth');

// CSV export
const [dl] = await Promise.all([
  A.waitForEvent('download', { timeout: 5000 }),
  reports.locator('ion-item', { hasText: 'Daily summary (CSV)' }).click(),
]);
const csv = fs.readFileSync(await dl.path(), 'utf8');
const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
if (!csv.startsWith('date,sleep_hours')) problems.push(`daily CSV header wrong: ${csv.slice(0, 60)}`);
if (!csv.includes(todayIso)) problems.push('daily CSV has no row for today');
const [dl2] = await Promise.all([
  A.waitForEvent('download', { timeout: 5000 }),
  reports.locator('ion-item', { hasText: 'Feeds (CSV)' }).click(),
]);
const feeds = fs.readFileSync(await dl2.path(), 'utf8');
if (!/,bottle,,,4,breast milk,/.test(feeds)) problems.push(`feeds CSV missing 4 oz bottle row:\n${feeds}`);

// Pediatrician summary: earlier weights and a few past days, so page 1 has a weight chart and lines
psql(`insert into events (baby_id, type, started_at, weight_g)
  select b.id, 'growth', now() - (d || ' days')::interval, w from babies b, (values (12, 3500), (9, 3250), (5, 3330)) v(d, w)`);
psql(`insert into events (baby_id, type, started_at, ended_at, diaper_wet, diaper_dirty)
  select b.id, 'diaper', now() - (d || ' days')::interval - (k || ' hours')::interval, now() - (d || ' days')::interval - (k || ' hours')::interval,
         true, k % 3 = 0 from babies b, generate_series(1, 6) d, generate_series(1, 5 + d % 3) k`);
psql(`insert into events (baby_id, type, started_at, ended_at, bottle_ml, bottle_contents)
  select b.id, 'bottle', now() - (d || ' days')::interval - (k * 3 || ' hours')::interval, now() - (d || ' days')::interval - (k * 3 || ' hours')::interval,
         60 + d * 5, case when k % 2 = 0 then 'formula' else 'breast_milk' end from babies b, generate_series(1, 6) d, generate_series(1, 6) k`);
await reports.locator('ion-item', { hasText: 'Pediatrician summary' }).click(); await wait(A, 1500);
await expectText(A, 'Day by day');
await expectText(A, 'Medicine given');
await expectText(A, 'Feeds per day');
const printCharts = await A.locator('.print-charts canvas').count();
if (printCharts < 3) problems.push(`pediatrician summary: expected its charts on page 1, found ${printCharts}`);
await A.screenshot({ path: `${OUT}/${String(++step).padStart(2, '0')}-print.png`, fullPage: true });
await A.pdf({ path: `${OUT}/pediatrician-summary.pdf`, format: 'Letter', printBackground: true }).catch((e) => problems.push(`summary PDF: ${e.message}`));
await A.getByRole('button', { name: /back/i }).click(); await wait(A, 1000);
await expectText(A, 'Daily average');

// Milk pumped per breast: add five earlier days of pumping, then look at the line chart
psql(`insert into events (baby_id, type, started_at, ended_at, pump_side, pump_left_ml, pump_right_ml)
  select b.id, 'pump', now() - (d || ' days')::interval, now() - (d || ' days')::interval + interval '20 minutes', 'both',
         40 + d * 6, 30 + d * 4 from babies b, generate_series(1, 5) d`);
await A.locator('ion-tab-button[tab="reports"]').click(); await wait(A, 600);
await refresh(A); await wait(A, 1500);
const pumpCard = A.locator('.chart-card', { hasText: 'Milk pumped per day' });
if (!(await pumpCard.count())) problems.push('no milk-pumped chart on Reports');
if (await A.locator('.chart-card', { hasText: 'Pumped (oz) per day' }).count()) problems.push('old pumped bar chart still shown');
if (await pumpCard.count()) { await pumpCard.scrollIntoViewIfNeeded(); await wait(A, 400); await pumpCard.screenshot({ path: `${OUT}/${String(++step).padStart(2, '0')}-pump-per-breast.png` }); }

// Pumping reminder: the seeded sessions are days old, so Home says it's time to pump
await A.locator('ion-tab-button[tab="home"]').click(); await wait(A, 800);
await expectText(A, 'Time to pump', '.pump-reminder');
await expectText(A, 'Due now', '.tile');
await A.locator('.ion-page:not(.ion-page-hidden) ion-content').first().evaluate((el) => el.scrollToTop(0)); await wait(A, 300);
await shot(A, 'pump-reminder');
await A.locator('.pump-reminder ion-button', { hasText: 'In 30 min' }).click(); await wait(A, 400);
if (await A.locator('.pump-reminder').count()) problems.push('pump reminder still shown after "In 30 min"');
await A.locator('ion-tab-button[tab="reports"]').click(); await wait(A, 600);

// The line charts with several days of data (sleep, feeds and nursing over the last days)
psql(`insert into events (baby_id, type, started_at, ended_at)
  select b.id, 'sleep'::event_type, now() - (d || ' days')::interval - interval '6 hours', now() - (d || ' days')::interval - interval '6 hours' + ((120 + d * 25) || ' minutes')::interval
    from babies b, generate_series(1, 5) d
  union all
  select b.id, 'sleep'::event_type, now() - (d || ' days')::interval - interval '2 hours', now() - (d || ' days')::interval - interval '2 hours' + interval '50 minutes'
    from babies b, generate_series(1, 5) d
  union all
  select b.id, 'bottle'::event_type, now() - (d || ' days')::interval - (h || ' hours')::interval, now() - (d || ' days')::interval - (h || ' hours')::interval
    from babies b, generate_series(1, 5) d, generate_series(1, 3) h`);
psql(`update events set bottle_ml = 60 where type = 'bottle' and bottle_ml is null`);
await refresh(A); await wait(A, 1500);
for (const t of ['Sleep per day', 'Longest sleep stretch', 'Feeds per day', 'Time between feeds', 'Bottle (oz) per day']) {
  const card = A.locator('.chart-card', { hasText: t });
  if (!(await card.count())) { problems.push(`chart missing: ${t}`); continue; }
  await card.scrollIntoViewIfNeeded(); await wait(A, 300);
  await card.screenshot({ path: `${OUT}/line-${t.replace(/[^a-z]+/gi, '-').toLowerCase()}.png` });
}

// Reports → Bottles: compare bottle brands (seed a few more timed feeds)
psql(`insert into events (baby_id, type, started_at, ended_at, bottle_ml, bottle_start_ml, bottle_contents, bottle_brand)
  select b.id, 'bottle'::event_type, now() - (k || ' hours')::interval, now() - (k || ' hours')::interval + ((8 + k * 2) || ' minutes')::interval,
         50 + k * 3, 90, case when k % 3 = 0 then 'formula' else 'breast_milk' end,
         (array['Comotomo', 'Philips Avent', 'MAM', 'Dr. Brown''s'])[1 + k % 4]
    from babies b, generate_series(20, 31) k`);
await A.locator('ion-tab-button[tab="reports"]').click(); await wait(A, 800);
await refresh(A);
await A.locator('.reports-tabs ion-segment-button[value="bottles"]').click(); await wait(A, 1200);
for (const t of ['Comotomo', 'Philips Avent', 'MAM', "Dr. Brown's"]) await expectText(A, t, '.brand-table');
if (await A.locator('.chart-card', { hasText: 'Bottle flow rate' }).count()) problems.push('old daily flow chart still shown');
const bottlesPage = A.locator('.ion-page:not(.ion-page-hidden)').last();
await shot(A, 'reports-bottles');
const flowCard = bottlesPage.locator('.chart-card', { hasText: 'Flow per feed' });
if (!(await flowCard.count())) problems.push('no flow-per-feed chart'); else { await flowCard.scrollIntoViewIfNeeded(); await flowCard.screenshot({ path: `${OUT}/bottles-flow.png` }); }
const lenCard = bottlesPage.locator('.chart-card', { hasText: 'Feed length' });
if (await lenCard.count()) { await lenCard.scrollIntoViewIfNeeded(); await lenCard.screenshot({ path: `${OUT}/bottles-length.png` }); }
await A.locator('.reports-tabs ion-segment-button[value="overview"]').click(); await wait(A, 500);

// ── Guest (viewer) phone: sees the data, can't change anything, no notes, no Mom's medicines
psql(`insert into events (baby_id, type, started_at, ended_at, diaper_wet, notes) select id, 'diaper', now() - interval '3 minutes', now() - interval '3 minutes', true, 'secret note' from babies limit 1`);
await A.locator('ion-tab-button[tab="home"]').click(); await wait(A, 600);
await refresh(A);
await expectText(A, 'secret note');                       // a caregiver sees notes
const C = await phone('C');
await wait(C, 800);
await signIn(C, 'grandma@example.com');
await wait(C, 1500);
await expectText(C, 'Sleep', '.tile');
await tile(C, 'Diaper').click(); await wait(C, 600);
if (await sheet(C).count()) problems.push('guest could open a logging sheet');
if (await C.getByText('secret note').count()) problems.push('guest can see notes');
if (await C.getByText('Mom ·').count()) problems.push("guest can see Mom's medicines");
if (await C.locator('.still-running, .pump-reminder').count()) problems.push('guest sees action cards');
await C.locator('ion-item', { hasText: 'Diaper' }).first().click(); await wait(C, 600);
if (await C.locator('ion-modal.show-modal').count()) problems.push('guest could open the edit sheet');
await shot(C, 'guest-home');
await C.locator('ion-tab-button[tab="reports"]').click(); await wait(C, 1500);
await expectText(C, 'Daily average');
if (await C.getByText('Daily summary (CSV)').count()) problems.push('guest sees exports');
await C.locator('ion-tab-button[tab="settings"]').click(); await wait(C, 800);
await expectText(C, 'Guest account');
// The database itself refuses a guest's write, whatever the app shows.
const guestWrite = await C.evaluate(async () => {
  const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
  const tok = k ? JSON.parse(localStorage.getItem(k)).access_token : '';
  const r = await fetch('https://abcdefgh.supabase.co/rest/v1/events', { method: 'POST', headers: { apikey: 'e2e', Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baby_id: '00000000-0000-0000-0000-000000000000', type: 'diaper', started_at: new Date().toISOString() }) });
  return r.status;
});
if (guestWrite < 400) problems.push(`guest write was accepted (${guestWrite})`);

// Light-mode look of Home and a logging sheet
await A.emulateMedia({ colorScheme: 'light' });
await A.locator('ion-tab-button[tab="home"]').click(); await wait(A, 800);
await shot(A, 'home-light');
await tile(A, 'Sleep').click(); await wait(A); await shot(A, 'sleep-sheet-light'); await closeSheet(A);
if (await A.locator('.tile img.type-icon').count() < 6) problems.push('tile icons missing');

// The notification-keys page makes keys the push-tick function can sign with.
{
  const kp = await browser.newPage();
  await kp.goto('http://localhost:4174/vapid.html'); await kp.waitForTimeout(800);
  const pub = (await kp.locator('#pub').textContent()).trim(), priv = (await kp.locator('#priv').textContent()).trim();
  const hdr = await vapidAuth('https://fcm.googleapis.com/fcm/send/x', pub, priv, 'https://example.org/');
  const [, t] = /t=([^,]+),/.exec(hdr); const [h, c, sig] = t.split('.');
  const pk = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(pub, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(pub, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
  if (!crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pk, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))) problems.push('keys from vapid.html do not work with push-tick');
  await kp.close();
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'E2E OK');
await browser.close(); srv.close();
process.exitCode = problems.length ? 1 : 0;
