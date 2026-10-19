// Drives the real push-tick handler against local PostgREST and a fake push service.
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import ece from 'http_ece';
import { handle } from '../index.ts';

const SECRET = 'local-test-secret-local-test-secret-123';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};
const psql = (q) => execFileSync('psql', ['-qtA', '-d', process.env.DB, '-c', q], { encoding: 'utf8' }).trim();
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };

// VAPID keys, as the vapid.html page would make them.
const vk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
const env = {
  SUPABASE_URL: 'http://localhost:3002/..', // rest() appends /rest/v1/…; PostgREST serves at the root
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role' }),
  VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(vk.x, 'base64url'), Buffer.from(vk.y, 'base64url')]).toString('base64url'),
  VAPID_PRIVATE_KEY: vk.d,
};
// PostgREST has no /rest/v1 prefix locally: a tiny proxy strips it.
const proxy = http.createServer((req, res) => {
  const up = http.request({ host: 'localhost', port: 3002, path: req.url.replace(/^\/rest\/v1/, ''), method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  req.pipe(up);
}).listen(3003);
env.SUPABASE_URL = 'http://localhost:3003';

// Two phones: Mom's (A, accepts) and an old one of Dad's (B, gone → 410).
const phones = {};
for (const name of ['mom', 'dadOld']) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  phones[name] = { ecdh, auth: crypto.randomBytes(16), got: [] };
}
const push = http.createServer((req, res) => {
  const name = req.url.slice(1), chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const p = phones[name];
    try {
      check(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(req.headers.authorization ?? ''), 'missing VAPID authorization');
      check(req.headers['content-encoding'] === 'aes128gcm', 'wrong content-encoding');
      p.got.push(JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: p.ecdh, authSecret: p.auth }).toString()));
    } catch (e) { problems.push(`${name}: could not decrypt: ${e.message}`); }
    res.writeHead(name === 'dadOld' ? 410 : 201); res.end();
  });
}).listen(4100);

const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b';
psql(`insert into push_subscriptions (caregiver_id, endpoint, p256dh, auth, pump_every_min) values
  ('${A}', 'http://localhost:4100/mom', '${phones.mom.ecdh.getPublicKey().toString('base64url')}', '${phones.mom.auth.toString('base64url')}', 120),
  ('${B}', 'http://localhost:4100/dadOld', '${phones.dadOld.ecdh.getPublicKey().toString('base64url')}', '${phones.dadOld.auth.toString('base64url')}', null)`);
// Mom pumped 2h10m ago (due 10 min ago); Dad started a sleep 4h05m ago and forgot it.
psql(`insert into events (baby_id, type, started_at, ended_at, pump_side, created_by) values
  ('00000000-0000-0000-0000-0000000000b1', 'pump', now() - interval '130 minutes', now() - interval '110 minutes', 'both', '${A}'),
  ('00000000-0000-0000-0000-0000000000b1', 'sleep', now() - interval '245 minutes', null, null, '${B}')`);

const post = () => handle(new Request('http://fn/', { method: 'POST' }), env).then((r) => r.json());
const r1 = await post();
check(r1.due === 2, `first tick: expected 2 due, got ${JSON.stringify(r1)}`);
check(phones.mom.got.some((m) => m.title === 'Time to pump' && m.url === '#/home?log=pump'), `mom did not get the pump reminder: ${JSON.stringify(phones.mom.got)}`);
// The sleep was started by Dad; his only phone is gone (410), so its row is deleted.
check(phones.dadOld.got.some((m) => /^Sleep has been running 4h 5m$/.test(m.title)), `dad's phone did not get the sleep check: ${JSON.stringify(phones.dadOld.got)}`);
check(psql(`select count(*) from push_subscriptions where caregiver_id = '${B}'`) === '0', 'expired subscription not removed');
const r2 = await post();
check(r2.sent === 0, `second tick resent: ${JSON.stringify(r2)}`);
check(psql('select count(*) from push_log') === '2', 'push_log should hold two keys');

// GET returns the public key for the app; without keys it says "not set up".
const g = await (await handle(new Request('http://fn/?vapid'), env)).json();
check(g.publicKey === env.VAPID_PUBLIC_KEY, 'GET did not return the public key');
check((await handle(new Request('http://fn/?vapid'), { ...env, VAPID_PUBLIC_KEY: undefined })).status === 404, 'GET without keys should be 404');

// Row-level security: a signed-in parent sees only their own phones.
const asB = await fetch('http://localhost:3002/push_subscriptions?select=id', { headers: { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: B })}` } }).then((r) => r.json());
check(Array.isArray(asB) && asB.length === 0, `parent B can see other subscriptions: ${JSON.stringify(asB)}`);
const logAsA = await fetch('http://localhost:3002/push_log', { headers: { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: A })}` } });
// Either no grant (error) or row-level security with no policy (empty): app users read nothing.
check(logAsA.status >= 400 || (await logAsA.json()).length === 0, 'push_log should not be readable by app users');

push.close(); proxy.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'PUSH INTEGRATION OK');
process.exitCode = problems.length ? 1 : 0;
