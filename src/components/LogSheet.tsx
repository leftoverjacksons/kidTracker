import { META } from '../lib/describe';
import type { EventType } from '../lib/types';
import BathLog from './log/BathLog';
import BottleLog from './log/BottleLog';
import DiaperLog from './log/DiaperLog';
import GrowthLog from './log/GrowthLog';
import MedsLog from './log/MedsLog';
import NursingLog from './log/NursingLog';
import PumpLog from './log/PumpLog';
import TempLog from './log/TempLog';
import TimerLog from './log/TimerLog';
import Sheet from './Sheet';

export default function LogSheet({ type, onClose }: { type: EventType | null; onClose: () => void }) {
  return (
    <Sheet open={type != null} title={type ? `${META[type].emoji} ${META[type].label}` : ''} onClose={onClose}>
      {type && <Body type={type} onDone={onClose} />}
    </Sheet>
  );
}

function Body({ type, onDone }: { type: EventType; onDone: () => void }) {
  switch (type) {
    case 'sleep': return <TimerLog type="sleep" onDone={onDone} />;
    case 'tummy_time': return <TimerLog type="tummy_time" onDone={onDone} />;
    case 'nursing': return <NursingLog onDone={onDone} />;
    case 'pump': return <PumpLog onDone={onDone} />;
    case 'bottle': return <BottleLog onDone={onDone} />;
    case 'diaper': return <DiaperLog onDone={onDone} />;
    case 'medicine': return <MedsLog onDone={onDone} />;
    case 'temperature': return <TempLog onDone={onDone} />;
    case 'growth': return <GrowthLog onDone={onDone} />;
    case 'bath': return <BathLog onDone={onDone} />;
    default: return null;
  }
}
