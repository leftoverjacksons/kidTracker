import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { DEFAULT_SETTINGS, type Baby, type Caregiver, type HouseholdSettings } from './types';

interface Household {
  loading: boolean;
  session: Session | null;
  me: Caregiver | null;
  /** True when signed in but the account is not on the caregiver list. */
  notAllowed: boolean;
  /** Set when the database couldn't be reached (network), so 'not allowed' isn't claimed wrongly. */
  unreachable: string | null;
  baby: Baby | null;
  settings: HouseholdSettings;
  reload: () => Promise<void>;
}

const Ctx = createContext<Household | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [me, setMe] = useState<Caregiver | null>(null);
  const [baby, setBaby] = useState<Baby | null>(null);
  const [settings, setSettings] = useState<HouseholdSettings>(DEFAULT_SETTINGS);
  const [unreachable, setUnreachable] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  const reload = useCallback(async () => {
    if (!supabase || !userId) return;
    const [meRes, babyRes, settingsRes] = await Promise.all([
      supabase.from('caregivers').select('id,email,display_name').eq('id', userId).maybeSingle(),
      supabase.from('babies').select('*').order('created_at').limit(1).maybeSingle(),
      supabase.from('household_settings').select('*').maybeSingle(),
    ]);
    setUnreachable(meRes.error ? meRes.error.message || 'network error' : null);
    setMe(meRes.data ?? null);
    setBaby(babyRes.data ?? null);
    setSettings(settingsRes.data ?? DEFAULT_SETTINGS);
    setDataReady(true);
    // Report views split days in the household's time zone; keep it in step with the phone.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (settingsRes.data && 'timezone' in settingsRes.data && tz && settingsRes.data.timezone !== tz) {
      await supabase.from('household_settings').update({ timezone: tz }).eq('id', true);
    }
  }, [userId]);

  useEffect(() => {
    setDataReady(false);
    if (userId) void reload();
  }, [userId, reload]);

  // Keep both phones in step when the other one changes shared settings.
  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    const channel = client
      .channel('household')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'babies' }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_settings' }, () => void reload())
      .subscribe();
    return () => void client.removeChannel(channel);
  }, [userId, reload]);

  const value: Household = {
    loading: !authReady || (!!userId && !dataReady),
    session,
    me,
    notAllowed: !!userId && dataReady && !me && !unreachable,
    unreachable,
    baby,
    settings,
    reload,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): Household {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHousehold outside HouseholdProvider');
  return v;
}
