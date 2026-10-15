import { fmtDay, relDay, type Calendar } from '../engine/dates';
import type { Day, DateOrder } from '../engine/types';

export function makeFmt(order: DateOrder, today: Day, cal: Calendar) {
  return {
    day: (d?: Day | null) => fmtDay(d, order, today),
    rel: (d: Day) => relDay(d, today, cal),
    /** "Fri 10/30 (in 3 working days)" */
    both: (d?: Day | null) => (d ? `${fmtDay(d, order, today)} (${relDay(d, today, cal)})` : ''),
  };
}

export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
