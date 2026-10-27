import { IonChip, IonItem, IonLabel, IonList, IonNote } from '@ionic/react';
import { useMemo, useState } from 'react';
import { byBrand, MAX_FLOW_ML_PER_MIN, minPerOz, timedBottles } from '../lib/bottle';
import { useData } from '../lib/data';
import { formatDuration, formatFlow, formatVolume, formatWhen } from '../lib/format';
import { useHousehold } from '../lib/household';
import type { EventRow } from '../lib/types';
import { mlToOz } from '../lib/units';
import StripChart, { type StripPoint } from './charts/StripChart';
import Chips from './Chips';
import EditSheet from './EditSheet';

const GROUPS = [
  { label: 'Breast milk', hue: 'blue' as const },
  { label: 'Formula', hue: 'coral' as const },
  { label: 'Mixed / not set', hue: 'teal' as const },
];
// Bottles hidden with the selector at the top, per phone.
const HIDDEN_KEY = 'kt.bottlesHidden';
const loadHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]'); } catch { return []; } };

const groupOf = (e: EventRow) => (e.bottle_contents === 'breast_milk' ? 0 : e.bottle_contents === 'formula' ? 1 : 2);

/**
 * Reports → Bottles (design doc §8a L): compare timed bottle feeds by bottle brand.
 * Flow and feed length per brand (one dot per feed, median line), a per-brand table,
 * and the feeds themselves (tap to edit).
 */
export default function BottleReport({ days }: { days: number }) {
  const { settings, viewer } = useHousehold();
  const data = useData();
  const [brand, setBrand] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  const saveHidden = (h: string[]) => { setHidden(h); try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(h)); } catch { /* private mode */ } };
  const toggleBrand = (b: string) => saveHidden(hidden.includes(b) ? hidden.filter((x) => x !== b) : [...hidden, b]);
  const oz = settings.volume_unit === 'oz';
  const unit = oz ? 'oz' : 'ml';
  const toRate = (mlPerMin: number) => (oz ? mlToOz(mlPerMin) : mlPerMin);

  const view = useMemo(() => {
    const since = new Date(Date.now() - days * 86_400_000);
    const all = timedBottles(data.events, since);
    const allBrands = byBrand(all).map((b) => b.brand); // every bottle in the range, for the selector
    const feeds = all.filter((f) => !hidden.includes(f.brand));
    const brands = byBrand(feeds);
    const cats = brands.map((b) => b.brand);
    const tip = (f: (typeof feeds)[number]) => [
      `${f.brand} · ${formatWhen(new Date(f.e.started_at))}`,
      `Drank ${formatVolume(f.ml, settings)}${f.e.bottle_start_ml ? ` of ${formatVolume(f.e.bottle_start_ml, settings)}` : ''}`,
      `${formatDuration(f.minutes * 60_000)} · ${formatFlow(f.rate, settings)} · ${minPerOz(f.rate).toFixed(1)} min/oz`,
    ];
    const flow: StripPoint[] = feeds.map((f) => ({ cat: cats.indexOf(f.brand), y: toRate(f.rate), group: groupOf(f.e), tip: tip(f) }));
    const length: StripPoint[] = feeds.map((f) => ({ cat: cats.indexOf(f.brand), y: f.minutes, group: groupOf(f.e), tip: tip(f) }));
    const usedGroups = GROUPS.filter((_, gi) => feeds.some((f) => groupOf(f.e) === gi));
    const remap = (pts: StripPoint[]) => pts.map((p) => ({ ...p, group: usedGroups.indexOf(GROUPS[p.group]) }));
    return {
      all, allBrands, feeds, brands, cats, groups: usedGroups, flow: remap(flow), length: remap(length),
      flowMedians: brands.map((b) => toRate(b.rate)), lengthMedians: brands.map((b) => b.minutes),
    };
  }, [data.events, days, settings, hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtRate = useMemo(() => (v: number) => (oz ? v.toFixed(2) : v.toFixed(1)), [oz]);
  const fmtMin = useMemo(() => (v: number) => `${Math.round(v)}m`, []);
  const band = useMemo(() => ({ from: 10, to: 20, label: '10–20 min: often suggested for a paced feed' }), []);
  // The consultant's pace: no faster than 5 minutes per ounce (design doc §8a L). No lower limit.
  const flowBand = useMemo(() => ({
    from: 0, to: oz ? mlToOz(MAX_FLOW_ML_PER_MIN) : MAX_FLOW_ML_PER_MIN,
    label: `Her pace: 5 min per oz or slower (up to ${oz ? `${mlToOz(MAX_FLOW_ML_PER_MIN).toFixed(2)} oz/min` : `${MAX_FLOW_ML_PER_MIN.toFixed(1)} ml/min`})`,
  }), [oz]);
  const list = brand && view.cats.includes(brand) ? view.feeds.filter((f) => f.brand === brand) : view.feeds;

  if (!view.all.length) {
    return (
      <div className="empty">
        <p><b>No timed bottles in the last {days} days.</b></p>
        <p>Use the Bottle screen: type what's in the bottle, Start, Stop, then type what's left. Pick the bottle brand to compare them here.</p>
      </div>
    );
  }

  const selector = view.allBrands.length > 1 && (
    <div className="chips bottle-selector" role="group" aria-label="Bottles to show">
      <IonChip outline={hidden.length > 0} color={hidden.length ? undefined : 'primary'} onClick={() => saveHidden([])}><IonLabel>All</IonLabel></IonChip>
      {view.allBrands.map((b) => {
        const on = !hidden.includes(b);
        return (
          <IonChip key={b} outline={!on} color={on ? 'primary' : undefined} onClick={() => toggleBrand(b)} aria-pressed={on}>
            <IonLabel>{b}</IonLabel>
          </IonChip>
        );
      })}
    </div>
  );

  if (!view.feeds.length) {
    return (
      <>
        {selector}
        <div className="empty"><p>All bottles are hidden. Tap one above (or All) to show it.</p></div>
      </>
    );
  }

  return (
    <>
      {selector}
      <h2 className="section-title">By bottle <span className="subtle">(last {days} days, timed feeds)</span></h2>
      <div className="table-wrap">
        <table className="brand-table">
          <thead><tr><th>Bottle</th><th>Feeds</th><th>Flow</th><th>min/oz</th><th>Length</th><th>Drank</th></tr></thead>
          <tbody>
            {view.brands.map((b) => (
              <tr key={b.brand}>
                <td>{b.brand}</td><td>{b.feeds}</td><td>{formatFlow(b.rate, settings)}</td>
                <td className={b.rate > MAX_FLOW_ML_PER_MIN ? 'too-fast' : undefined}>{minPerOz(b.rate).toFixed(1)}</td>
                <td>{formatDuration(b.minutes * 60_000)}</td><td>{formatVolume(b.ml, settings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Middle (median) values per bottle. min/oz is the pace: minutes per ounce over the whole feed, pauses included; her guidance is 5 or more (slower is fine early on). Faster than that is shown in red.</p>

      <StripChart title={`Flow per feed (${unit}/min)`} categories={view.cats} points={view.flow} groups={view.groups}
        format={fmtRate} medians={view.flowMedians} band={flowBand} />
      <StripChart title="Feed length (minutes)" categories={view.cats} points={view.length} groups={view.groups}
        format={fmtMin} medians={view.lengthMedians} band={band} />

      <h2 className="section-title">Feeds</h2>
      <Chips options={view.cats.map((c) => ({ value: c, label: c }))} value={brand} onChange={setBrand} clearable />
      <IonList inset>
        {list.map((f) => (
          <IonItem key={f.e.id} button={!viewer} detail={false} onClick={() => !viewer && setEditing(f.e)}>
            <IonLabel>
              <h3>{f.brand} · {formatFlow(f.rate, settings)}</h3>
              <p>Drank {formatVolume(f.ml, settings)}{f.e.bottle_start_ml ? ` of ${formatVolume(f.e.bottle_start_ml, settings)}` : ''} · {formatDuration(f.minutes * 60_000)}</p>
            </IonLabel>
            <IonNote slot="end">{formatWhen(new Date(f.e.started_at))}</IonNote>
          </IonItem>
        ))}
      </IonList>
      <EditSheet event={editing} onClose={() => setEditing(null)} />
    </>
  );
}
