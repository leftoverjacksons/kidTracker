// Unit tests for the push Edge Function's pure parts, run by vitest in Node.
import crypto from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it } from 'vitest';
import { alignedPump, b64u, decide, encryptPayload, pumpDue, readPlan, unb64u, vapidAuth, type Ev, type Sub } from './index';
import { feeds as appFeeds, nextFeed as appNextFeed, readPlan as appReadPlan, schedule as appSchedule } from '../../../src/lib/feeding';
import { pumpDue as appPumpDue } from '../../../src/lib/pump';
import { STILL_RUNNING_MIN as APP_LIMITS } from '../../../src/lib/longRunning';
import { STILL_RUNNING_MIN } from './index';
import type { EventRow } from '../../../src/lib/types';

describe('web push encryption (RFC 8291)', () => {
  it('produces a message the reference implementation decrypts', async () => {
    // A phone's subscription keys.
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const text = JSON.stringify({ title: 'Time to pump', body: 'Last session 2h ago.' });
    const body = await encryptPayload(new TextEncoder().encode(text), b64u(ua.getPublicKey()), b64u(auth));
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
    expect(plain.toString()).toBe(text);
  });
  it('signs a VAPID token that verifies with the public key', async () => {
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = kp.privateKey.export({ format: 'jwk' }) as { x: string; y: string; d: string };
    const pub = b64u(new Uint8Array([4, ...unb64u(jwk.x), ...unb64u(jwk.y)]));
    const header = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', pub, jwk.d, 'https://example.org/', 1_700_000_000_000);
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(pub);
    const [h, c, sig] = token.split('.');
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 12 * 3600, sub: 'https://example.org/' });
    const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: kp.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    expect(ok).toBe(true);
  });
});

const now = new Date('2026-10-20T12:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const sub = (id: string, caregiver: string, pump: number | null = 120): Sub =>
  ({ id, caregiver_id: caregiver, endpoint: `https://push.example/${id}`, p256dh: 'x', auth: 'y', pump_every_min: pump, still_running: true });
const pump = (startMin: number, minutes: number, side = 'both'): Ev =>
  ({ id: `p${startMin}`, type: 'pump', started_at: ago(startMin), ended_at: ago(startMin - minutes), created_by: 'mom', pump_side: side });

describe('decide', () => {
  it('still-running goes to the starter, once per threshold', () => {
    const sleep: Ev = { id: 's1', type: 'sleep', started_at: ago(250), ended_at: null, created_by: 'dad', pump_side: null };
    const m = decide(now, [sleep], [sub('a', 'dad', null), sub('b', 'mom', null)]);
    expect(m).toHaveLength(1);
    expect(m[0].key).toBe('still:s1:1');
    expect(m[0].subs.map((s) => s.id)).toEqual(['a']);
    expect(m[0].title).toBe('Sleep has been running 4h 10m');
    expect(decide(new Date(now.getTime() + 240 * 60_000), [sleep], [sub('a', 'dad', null)])[0].key).toBe('still:s1:2');
    expect(decide(now, [{ ...sleep, started_at: ago(200) }], [sub('a', 'dad', null)])).toEqual([]);
  });
  it('falls back to everyone when the starter has no phone signed up', () => {
    const t: Ev = { id: 't1', type: 'tummy_time', started_at: ago(31), ended_at: null, created_by: 'grandma', pump_side: null };
    expect(decide(now, [t], [sub('a', 'dad', null), sub('b', 'mom', null)])[0].subs).toHaveLength(2);
  });
  it('pump reminder at the due time, again 30 min later, then stops; per phone interval', () => {
    const subs = [sub('m', 'mom', 120), sub('d', 'dad', null)];
    const at = (min: number) => decide(new Date(now.getTime() + min * 60_000), [pump(110, 20)], subs);
    expect(at(0)).toEqual([]);                      // due at +10 min
    expect(at(10)[0].key).toMatch(/^pump:m:.*:0$/);
    expect(at(10)[0].subs.map((s) => s.id)).toEqual(['m']);
    expect(at(45)[0].key).toMatch(/:1$/);
    expect(at(45)[0].title).toBe('Pumping is overdue');
    expect(at(75)).toEqual([]);
  });
  it('no pump reminder while pumping', () => {
    const running: Ev = { ...pump(5, 0), ended_at: null };
    expect(decide(now, [pump(300, 20), running], [sub('m', 'mom')]).filter((m) => m.key.startsWith('pump'))).toEqual([]);
  });
});

describe('stays in step with the app', () => {
  it('same still-running thresholds', () => expect(STILL_RUNNING_MIN).toEqual(APP_LIMITS));
  it('same pump due rule', () => {
    const cases: Ev[][] = [[pump(90, 20)], [pump(200, 20, 'left'), pump(60, 20, 'right'), pump(20, 5, 'left')], [pump(400, 16, 'right')]];
    for (const evs of cases) {
      const a = pumpDue(evs, now, 120), b = appPumpDue(evs.map((e) => ({ ...e, deleted_at: null })) as unknown as EventRow[], now, 120);
      expect({ due: a?.due.toISOString(), side: a?.side }).toEqual({ due: b?.due.toISOString(), side: b?.side });
    }
  });
});

describe('lines pumping up with feeds exactly like the app', () => {
  // A day of made-up feeds (nursing with segments, bottles) and pump sessions, checked at
  // many moments and with several plans: the pump due time must match the app's schedule().
  const base = Date.parse('2026-10-24T06:00:00Z');
  const iso = (min: number) => new Date(base + min * 60_000).toISOString();
  const evs: Ev[] = [];
  let k = 0;
  for (let m = 0; m < 20 * 60; m += 150 + (k % 3) * 25) {
    k++;
    if (k % 2) {
      evs.push({ id: `n${k}`, type: 'nursing', started_at: iso(m), ended_at: iso(m + 12), created_by: null, pump_side: null, bottle_ml: null,
        nursing_segments: [{ side: 'left', started_at: iso(m), ended_at: iso(m + 7) }, { side: 'right', started_at: iso(m + 7), ended_at: iso(m + 12) }] });
      evs.push({ id: `b${k}`, type: 'bottle', started_at: iso(m + 20), ended_at: iso(m + 20), created_by: null, pump_side: null, bottle_ml: 30 + k * 4 });
    } else {
      evs.push({ id: `b${k}`, type: 'bottle', started_at: iso(m), ended_at: iso(m + 15), created_by: null, pump_side: null, bottle_ml: 50 + k * 5 });
    }
    evs.push({ id: `p${k}`, type: 'pump', started_at: iso(m + 40 + (k % 4) * 20), ended_at: iso(m + 60 + (k % 4) * 20), created_by: null, pump_side: 'both' });
  }
  const plans = [
    { feeding_plan: null, birth: '2026-10-14' },
    { feeding_plan: { target: { min_ml: 75, max_ml: 90 }, nursing_ml_per_min: 3, every_min: 180 }, birth: null },
    { feeding_plan: { target: 'age', nursing_ml_per_min: 2, every_min: 150 }, birth: '2026-10-10' },
    { feeding_plan: { target: 'age', nursing_ml_per_min: 2.1, every_min: 'age' }, birth: '2026-09-28' },
    { feeding_plan: { target: { min_ml: 75, max_ml: 90 }, nursing_ml_per_min: 2.1, every_min: 'age' }, birth: '2026-10-14' },
  ];
  it('same due times at every 7 minutes through the day', () => {
    let lined = 0;
    for (const p of plans) {
      for (let m = 60; m < 22 * 60; m += 7) {
        const now = new Date(base + m * 60_000);
        const past = evs.filter((e) => Date.parse(e.started_at) <= now.getTime())
          .map((e) => (e.ended_at && Date.parse(e.ended_at) > now.getTime() ? { ...e, ended_at: null } : e))
          .sort((a, b) => b.started_at.localeCompare(a.started_at));
        const appPlan = appReadPlan(p.feeding_plan);
        const fd = appFeeds(past as unknown as EventRow[], appPlan);
        const app = appSchedule(appNextFeed(fd, appPlan, p.birth, now), appPumpDue(past as unknown as EventRow[], now, 120),
          [...fd.slice(-1).map((f) => f.start), ...past.filter((e) => (e.type === 'bottle' || e.type === 'nursing') && !e.ended_at).map((e) => new Date(e.started_at))], now);
        const fn = alignedPump(past, { plan: readPlan(p.feeding_plan), birthDate: p.birth }, pumpDue(past, now, 120), now);
        expect(fn?.due.getTime(), `${now.toISOString()} ${JSON.stringify(p.feeding_plan)}`).toBe(app.pump?.due.getTime());
        expect(fn?.withFeed).toBe(app.pump?.withFeed);
        if (fn?.withFeed) lined++;
      }
    }
    expect(lined).toBeGreaterThan(10); // the fixture really exercises the lining-up
  });
});
