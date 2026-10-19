// LakTrak push notifications (design doc §8a E5 Phase 2 and I). A Supabase Edge Function.
// Called every minute by pg_cron (supabase/push_schedule.sql). It decides which reminders
// are due and sends them as Web Push messages to the phones in push_subscriptions.
//   GET  ?vapid  → { publicKey } so the app can subscribe (404 until the keys are set)
//   POST         → one "tick": send whatever is due, at most once each (push_log)
// Self-contained on purpose (no imports) so it can be pasted into the Supabase dashboard
// editor. Web Push encryption follows RFC 8291 (aes128gcm) and VAPID RFC 8292, using
// only Web Crypto. The pure parts are exported and unit-tested in Node.

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  VAPID_PUBLIC_KEY?: string;  // base64url, 65-byte uncompressed P-256 point
  VAPID_PRIVATE_KEY?: string; // base64url, 32-byte private scalar
  VAPID_SUBJECT?: string;     // contact for push services (an https URL or mailto:)
}

export interface Ev {
  id: string; type: string; started_at: string; ended_at: string | null;
  created_by: string | null; pump_side: string | null;
}
export interface Sub {
  id: string; caregiver_id: string; endpoint: string; p256dh: string; auth: string;
  pump_every_min: number | null; still_running: boolean;
}
export interface Msg { key: string; subs: Sub[]; title: string; body: string; tag: string; url: string }

// ───────────── What is due (mirrors src/lib/longRunning.ts and src/lib/pump.ts) ─────────────

export const STILL_RUNNING_MIN: Record<string, number> = { sleep: 240, nursing: 60, pump: 30, tummy_time: 30 };
const LABEL: Record<string, string> = { sleep: 'Sleep', nursing: 'Nursing', pump: 'Pumping', tummy_time: 'Tummy time' };
const QUESTION: Record<string, string> = { sleep: 'Still asleep?', nursing: 'Still nursing?', pump: 'Still pumping?', tummy_time: 'Still going?' };
const PUMP_MIN_MINUTES = 15;
const SIDE: Record<string, string> = { left: ' (left side)', right: ' (right side)', both: '' };

export function duration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** Same rule as the app's pumpDue(): last 15+ minute session's start + interval. */
export function pumpDue(events: Ev[], now: Date, everyMin: number | null) {
  if (everyMin == null) return null;
  let left = 0, right = 0;
  for (const e of events) {
    if (e.type !== 'pump') continue;
    if (!e.ended_at) return null;
    const start = Date.parse(e.started_at);
    if (start > now.getTime() || Date.parse(e.ended_at) - start < PUMP_MIN_MINUTES * 60_000) continue;
    if (e.pump_side === 'left' || e.pump_side === 'both') left = Math.max(left, start);
    if (e.pump_side === 'right' || e.pump_side === 'both') right = Math.max(right, start);
  }
  if (!left && !right) return null;
  const l = left || right, r = right || left;
  const last = Math.min(l, r);
  const side = Math.abs(l - r) <= PUMP_MIN_MINUTES * 60_000 && left && right ? 'both' : l < r ? 'left' : 'right';
  return { due: new Date(last + everyMin * 60_000), last: new Date(last), side };
}

/**
 * Messages due at `now`. Keys make each one go out once:
 * - a timer past its threshold → its starter's phones, again each further threshold (4 h, 8 h…);
 *   if the starter has no phone signed up, everyone's;
 * - pumping due → each phone with a reminder interval, at the due time and once more 30 min later.
 */
export function decide(now: Date, events: Ev[], subs: Sub[]): Msg[] {
  const out: Msg[] = [];
  for (const e of events) {
    const limit = STILL_RUNNING_MIN[e.type];
    if (!limit || e.ended_at) continue;
    const ms = now.getTime() - Date.parse(e.started_at);
    const n = Math.floor(ms / (limit * 60_000));
    if (n < 1) continue;
    const want = subs.filter((s) => s.still_running);
    const own = want.filter((s) => s.caregiver_id === e.created_by);
    out.push({
      key: `still:${e.id}:${n}`, subs: own.length ? own : want, tag: `still-${e.id}`, url: '#/home',
      title: `${LABEL[e.type]} has been running ${duration(ms)}`,
      body: `${QUESTION[e.type]} Open LakTrak to keep it going or set when it ended.`,
    });
  }
  for (const s of subs) {
    const d = pumpDue(events, now, s.pump_every_min);
    if (!d) continue;
    const late = now.getTime() - d.due.getTime();
    if (late < 0 || late >= 60 * 60_000) continue; // remind at the due time and once 30 min later, then stop
    const stage = late < 30 * 60_000 ? 0 : 1;
    out.push({
      key: `pump:${s.id}:${d.last.toISOString()}:${stage}`, subs: [s], tag: 'pump', url: '#/home?log=pump',
      title: stage ? 'Pumping is overdue' : 'Time to pump',
      body: `Last session ${duration(now.getTime() - d.last.getTime())} ago${SIDE[d.side]}.`,
    });
  }
  return out.filter((m) => m.subs.length);
}

// ───────────── Web Push (RFC 8291 + RFC 8292) with Web Crypto ─────────────

type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();
export function b64u(bytes: Bytes): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Bytes {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** Encrypt `payload` for one subscription (RFC 8291, single aes128gcm record). */
export async function encryptPayload(payload: Bytes, p256dh: string, auth: string,
  salt: Bytes = crypto.getRandomValues(new Uint8Array(16))): Promise<Bytes> {
  const uaPublic = unb64u(p256dh);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(unb64u(auth), ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** `Authorization: vapid t=…, k=…` for the push service at `endpoint` (RFC 8292). */
export async function vapidAuth(endpoint: string, publicKey: string, privateKey: string, subject: string, now = Date.now()): Promise<string> {
  const pub = unb64u(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

async function sendOne(s: Sub, m: Msg, env: Env): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify({ title: m.title, body: m.body, tag: m.tag, url: m.url })), s.p256dh, s.auth);
  const res = await fetch(s.endpoint, {
    method: 'POST', body,
    headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high',
      Authorization: await vapidAuth(s.endpoint, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!, env.VAPID_SUBJECT ?? 'https://leftoverjacksons.github.io/kidTracker/'),
    },
  });
  await res.body?.cancel();
  return res.status;
}

// ───────────── Database (PostgREST with the service role key) ─────────────

async function rest(env: Env, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      // Legacy service_role JWTs go in both headers; new-style sb_secret_… keys only in apikey.
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      ...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }),
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function tick(env: Env, now = new Date()) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { error: 'VAPID keys not set' };
  const subs = await rest(env, 'push_subscriptions?select=id,caregiver_id,endpoint,p256dh,auth,pump_every_min,still_running') as Sub[];
  if (!subs.length) return { sent: 0, due: 0 };
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const events = await rest(env, `events?select=id,type,started_at,ended_at,created_by,pump_side&deleted_at=is.null&or=(ended_at.is.null,and(type.eq.pump,started_at.gte.${since}))`) as Ev[];
  const msgs = decide(now, events, subs);
  let sent = 0;
  for (const m of msgs) {
    // Claim the key first; a duplicate (already sent) comes back empty.
    const claimed = await rest(env, 'push_log', {
      method: 'POST', body: JSON.stringify([{ key: m.key }]),
      headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
    }) as unknown[];
    if (!claimed?.length) continue;
    for (const s of m.subs) {
      const status = await sendOne(s, m, env).catch(() => 0);
      if (status === 404 || status === 410) await rest(env, `push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }); // phone unsubscribed
      else if (status >= 200 && status < 300) sent++;
    }
  }
  return { sent, due: msgs.length };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

export async function handle(req: Request, env: Env): Promise<Response> {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method === 'GET') return env.VAPID_PUBLIC_KEY ? json({ publicKey: env.VAPID_PUBLIC_KEY }) : json({ error: 'not set up' }, 404);
  try { return json(await tick(env)); } catch (e) { return json({ error: String(e) }, 500); }
}

// deno-lint-ignore no-explicit-any
declare const Deno: any;
if (typeof Deno !== 'undefined') {
  // Projects with the newer API keys get SUPABASE_SECRET_KEYS (a JSON object) instead of the legacy key.
  const secret = (): string => {
    const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (legacy) return legacy;
    try { return Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { return ''; }
  };
  Deno.serve((req: Request) => handle(req, {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'), SUPABASE_SERVICE_ROLE_KEY: secret(),
    VAPID_PUBLIC_KEY: Deno.env.get('VAPID_PUBLIC_KEY'), VAPID_PRIVATE_KEY: Deno.env.get('VAPID_PRIVATE_KEY'),
    VAPID_SUBJECT: Deno.env.get('VAPID_SUBJECT') ?? undefined,
  }));
}
