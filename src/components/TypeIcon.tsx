import bath from '../assets/icons/bath.webp';
import bottle from '../assets/icons/bottle.webp';
import diaper from '../assets/icons/diaper.webp';
import growth from '../assets/icons/growth.webp';
import medicine from '../assets/icons/medicine.webp';
import note from '../assets/icons/note.svg';
import nursing from '../assets/icons/nursing.webp';
import pump from '../assets/icons/pump.svg';
import sleep from '../assets/icons/sleep.webp';
import temperature from '../assets/icons/temperature.webp';
import tummy_time from '../assets/icons/tummy_time.webp';
import type { EventType } from '../lib/types';

const SRC: Record<EventType, string> = { bath, bottle, diaper, growth, medicine, note, nursing, pump, sleep, temperature, tummy_time };

/** The illustrated icon for an entry type (sized by CSS through `className`). */
export default function TypeIcon({ type, className = '' }: { type: EventType; className?: string }) {
  return <img className={`type-icon ${className}`} src={SRC[type]} alt="" aria-hidden="true" draggable={false} />;
}
