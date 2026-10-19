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

const DIR = process.argv[2], OUT = process.argv[3];
const SECRET = 'local-test-secret-local-test-secret-123';
const USERS = {
  'parent.a@example.com': '00000000-0000-0000-0000-00000000000a',
  'parent.b@example.com': '00000000-0000-0000-0000-00000000000b',
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

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
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
      if (resp.status() >= 400) problems.push(`${name} HTTP ${resp.status()} ${req.method()} ${url.split('/rest/v1')[1]}: ${(await resp.text()).slice(0, 200)}`);
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
await expectText(A, 'Wet', '.tile');

// Diaper with details
await tile(A, 'Diaper').click(); await wait(A);
await sheet(A).getByText('Add details or change time').click(); await wait(A, 300);
await sheet(A).locator('ion-chip', { hasText: 'yellow' }).click();
await sheet(A).locator('ion-chip', { hasText: 'seedy' }).click();
await sheet(A).locator('.big-btn', { hasText: 'Both' }).click(); await wait(A, 1000);

// Bottle
await tile(A, 'Bottle').click(); await wait(A);
await sheet(A).locator('ion-chip', { hasText: '3 oz' }).click();
await shot(A, 'bottle-sheet');
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await expectText(A, '3 oz', '.tile');

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
const medDoses = psql(`select med_doses from v_daily_summary where day = public.local_day(now())`);
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

// Pediatrician summary
await reports.locator('ion-item', { hasText: 'Pediatrician summary' }).click(); await wait(A, 1500);
await expectText(A, 'By day');
await expectText(A, 'Medicine given');
await A.screenshot({ path: `${OUT}/${String(++step).padStart(2, '0')}-print.png`, fullPage: true });
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

// The line charts with several days of data (sleep, feeds and nursing over the last days)
psql(`insert into events (baby_id, type, started_at, ended_at)
  select b.id, 'sleep'::event_type, now() - (d || ' days')::interval - interval '6 hours', now() - (d || ' days')::interval - interval '6 hours' + ((120 + d * 25) || ' minutes')::interval
    from babies b, generate_series(1, 5) d
  union all
  select b.id, 'sleep'::event_type, now() - (d || ' days')::interval - interval '2 hours', now() - (d || ' days')::interval - interval '2 hours' + interval '50 minutes'
    from babies b, generate_series(1, 5) d
  union all
  select b.id, 'bottle'::event_type, now() - (d || ' days')::interval - (h || ' hours')::interval, null
    from babies b, generate_series(1, 5) d, generate_series(1, 3) h`);
psql(`update events set bottle_ml = 60 where type = 'bottle' and bottle_ml is null`);
await refresh(A); await wait(A, 1500);
for (const t of ['Sleep per day', 'Longest sleep stretch', 'Feeds per day', 'Time between feeds', 'Bottle (oz) per day']) {
  const card = A.locator('.chart-card', { hasText: t });
  if (!(await card.count())) { problems.push(`chart missing: ${t}`); continue; }
  await card.scrollIntoViewIfNeeded(); await wait(A, 300);
  await card.screenshot({ path: `${OUT}/line-${t.replace(/[^a-z]+/gi, '-').toLowerCase()}.png` });
}

// Light-mode look of Home and a logging sheet
await A.emulateMedia({ colorScheme: 'light' });
await A.locator('ion-tab-button[tab="home"]').click(); await wait(A, 800);
await shot(A, 'home-light');
await tile(A, 'Sleep').click(); await wait(A); await shot(A, 'sleep-sheet-light'); await closeSheet(A);
if (await A.locator('.tile img.type-icon').count() < 6) problems.push('tile icons missing');

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'E2E OK');
await browser.close(); srv.close();
process.exitCode = problems.length ? 1 : 0;
