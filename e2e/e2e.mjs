// Two-phone end-to-end test: drives the built app in headless Chromium against
// a local Postgres + PostgREST (standing in for Supabase), as Parent A and B.
// Run via e2e/run.sh. Realtime is not emulated; the test triggers the app's
// refresh-on-wake instead.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

// Pump timer with amounts
await tile(A, 'Pump').click(); await wait(A);
await sheet(A).locator('.big-btn-start').click(); await wait(A, 1200);
const amt = sheet(A).locator('ion-input[type="number"] input');
await amt.nth(0).fill('2'); await amt.nth(1).fill('1.5');
await sheet(A).locator('.big-btn-stop').click(); await wait(A, 1500);
await expectText(A, '3.5 oz', '.tile');

// Meds: add, give
await tile(A, 'Meds').click(); await wait(A);
await sheet(A).getByRole('button', { name: 'Add medication' }).click(); await wait(A, 300);
await sheet(A).locator('ion-input').nth(0).locator('input').fill('Vitamin D');
await sheet(A).locator('ion-input').nth(1).locator('input').fill('1');
await sheet(A).locator('ion-input').nth(2).locator('input').fill('drop');
await sheet(A).locator('ion-input').nth(3).locator('input').fill('24');
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await sheet(A).getByRole('button', { name: 'Give' }).click(); await wait(A, 1000);
await tile(A, 'Meds').click(); await wait(A);
await shot(A, 'meds-sheet');
await expectText(A, 'Next allowed tomorrow');
await closeSheet(A);

// Temperature, growth, bath, tummy manual
await tile(A, 'Temp').click(); await wait(A);
await sheet(A).locator('ion-input[type="number"] input').fill('98.6');
await sheet(A).locator('ion-chip', { hasText: 'axillary' }).click();
await sheet(A).getByRole('button', { name: 'Save' }).click(); await wait(A, 1000);
await expectText(A, '98.6 °F', '.tile');

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

// ── Home-screen shortcut deep link opens the logging sheet
await A.locator('ion-tab-button[tab="home"]').click(); await wait(A, 600);
await A.evaluate(() => { location.hash = '#/home?log=bottle'; }); await wait(A, 1200);
if (!(await sheet(A).locator('ion-title', { hasText: 'Bottle' }).count())) problems.push('shortcut #/home?log=bottle did not open the Bottle sheet');
await closeSheet(A);

// ── Settings: set sex for growth percentiles
await A.locator('ion-tab-button[tab="settings"]').click(); await wait(A, 800);
await A.locator('ion-select', { hasText: 'Sex' }).click(); await wait(A, 600);
await A.locator('ion-action-sheet button', { hasText: 'Female' }).click(); await wait(A, 1200);

// ── Reports
await A.locator('ion-tab-button[tab="reports"]').click(); await wait(A, 2000);
const reports = A.locator('.ion-page:not(.ion-page-hidden)').last();
await expectText(A, 'Daily average');
await expectText(A, 'Sleep map');
const canvases = await reports.locator('canvas').count();
if (canvases < 5) problems.push(`expected >= 5 charts on Reports, saw ${canvases}`);
await expectText(A, 'th pct');
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

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'E2E OK');
await browser.close(); srv.close();
