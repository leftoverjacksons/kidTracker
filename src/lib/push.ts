import { supabase } from './supabase';

/**
 * Phone notifications via Web Push (design doc §8a E5 Phase 2 and I). Everything here
 * fails soft: until migration 0006 and the push-tick function are set up in Supabase,
 * the state is 'not-set-up' and the rest of the app is unaffected.
 */
export type PushState = 'unsupported' | 'not-set-up' | 'blocked' | 'off' | 'on';

const fnUrl = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-tick`;

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The server's public VAPID key, or null if the function isn't deployed / keys not set. */
export async function vapidKey(): Promise<string | null> {
  try {
    const res = await fetch(`${fnUrl()}?vapid`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''}` } });
    if (!res.ok) return null;
    return ((await res.json()) as { publicKey?: string }).publicKey ?? null;
  } catch { return null; }
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (!(await vapidKey())) return 'not-set-up';
  return (await currentSub()) && Notification.permission === 'granted' ? 'on' : 'off';
}

const toBytes = (b64u: string) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Ask permission, subscribe this phone and save it. Returns an error message or null. */
export async function enablePush(prefs: { pumpEveryMin: number | null; stillRunning: boolean }): Promise<string | null> {
  if (!supabase) return 'Not connected.';
  const key = await vapidKey();
  if (!key) return 'Notifications are not set up in Supabase yet.';
  if ((await Notification.requestPermission()) !== 'granted') return 'Notifications were not allowed on this phone.';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    pump_every_min: prefs.pumpEveryMin, still_running: prefs.stillRunning,
  }, { onConflict: 'endpoint' });
  return error ? error.message : null;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSub();
  if (!sub) return;
  await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Keep this phone's server-side preferences in step with Settings (no-op if notifications are off). */
export async function syncPushPrefs(prefs: { pumpEveryMin?: number | null; stillRunning?: boolean }): Promise<void> {
  if (!pushSupported() || !supabase) return;
  const sub = await currentSub().catch(() => null);
  if (!sub) return;
  const patch: Record<string, unknown> = {};
  if (prefs.pumpEveryMin !== undefined) patch.pump_every_min = prefs.pumpEveryMin;
  if (prefs.stillRunning !== undefined) patch.still_running = prefs.stillRunning;
  await supabase.from('push_subscriptions').update(patch).eq('endpoint', sub.endpoint);
}

const STILL_KEY = 'kt.pushStill';
export function stillRunningPref(): boolean {
  try { return localStorage.getItem(STILL_KEY) !== '0'; } catch { return true; }
}
export function setStillRunningPref(v: boolean) {
  try { localStorage.setItem(STILL_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}
