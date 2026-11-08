import { useState, type ReactNode } from 'react';
import type { EventType } from '../lib/types';
import TypeIcon from './TypeIcon';

const KEY = 'kt.reportsOpen';
function loadOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}

/**
 * A collapsible group of charts on Reports → Overview (design doc §8a U). The header shows
 * a one-line summary; open/closed is remembered per phone. Charts are only drawn while open.
 */
export default function ReportSection({ id, title, icon, summary, defaultOpen = false, children }: {
  id: string; title: string; icon: EventType; summary?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => loadOpen()[id] ?? defaultOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(KEY, JSON.stringify({ ...loadOpen(), [id]: next })); } catch { /* private mode */ }
  };
  return (
    <section className={`report-section ${open ? 'open' : ''}`} data-section={id}>
      <button className="report-section-head" onClick={toggle} aria-expanded={open}>
        <TypeIcon type={icon} />
        <span className="report-section-title">{title}</span>
        {summary && <span className="report-section-summary">{summary}</span>}
        <span className="report-section-state">{open ? 'Hide' : 'Show'}</span>
        <span className="report-section-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </button>
      {open && <div className="report-section-body">{children}</div>}
    </section>
  );
}
