import { useIonToast } from '@ionic/react';
import { useData } from './data';

/** Toast after logging, with an Undo that deletes the new entry. */
export function useLogged() {
  const [toast] = useIonToast();
  const { remove } = useData();
  return (message: string, id?: string) => {
    if (navigator.vibrate) navigator.vibrate(30);
    void toast({
      message, duration: 5000, position: 'bottom',
      buttons: id ? [{ text: 'Undo', handler: () => void remove(id) }] : [],
    });
  };
}

export function buzz() {
  if (navigator.vibrate) navigator.vibrate(30);
}
