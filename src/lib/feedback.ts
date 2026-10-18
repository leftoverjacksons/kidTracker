import { useIonToast } from '@ionic/react';
import { useData } from './data';
import { META } from './describe';
import type { EventRow } from './types';

/** "Sleep ended" / "Sleep and pumping ended" for timers ended automatically. */
export function endedText(stopped: EventRow[]): string {
  if (!stopped.length) return '';
  const names = stopped.map((e) => (e.type === 'pump' ? 'Pumping' : META[e.type].label));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1].toLowerCase()}`;
  return `${list} ended`;
}

/**
 * Toast after logging, with an Undo that deletes the new entry and reopens
 * any timers that were ended automatically because of it.
 */
export function useLogged() {
  const [toast] = useIonToast();
  const { remove, reopen } = useData();
  return (message: string, id?: string, stopped: EventRow[] = []) => {
    if (navigator.vibrate) navigator.vibrate(30);
    const full = stopped.length ? `${message} · ${endedText(stopped)}` : message;
    const canUndo = !!id || stopped.length > 0;
    void toast({
      message: full, duration: 5000, position: 'bottom',
      buttons: canUndo ? [{ text: 'Undo', handler: () => { if (id) void remove(id); if (stopped.length) void reopen(stopped); } }] : [],
    });
  };
}

export function buzz() {
  if (navigator.vibrate) navigator.vibrate(30);
}
