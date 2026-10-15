/**
 * Items as a table: rows for an Excel action log, HTML for pasting into Outlook or
 * Word, and plain text for anywhere else. One row shape feeds all three, so they can
 * never disagree about what an item says.
 */
import { fmtDay } from './dates';
import { age, chasePlan, type Ctx } from './decide';
import type { Item } from './types';

export type Row = {
  No: number;
  Raised: string;
  Action: string;
  Type: string;
  With: string;
  Company: string;
  Due: string;
  Status: string;
  'Next chase': string;
  'Last update': string;
  Tags: string;
  Notes: string;
};

export const COLUMNS: (keyof Row)[] = ['No', 'Raised', 'Action', 'Type', 'With', 'Company', 'Due', 'Status', 'Next chase', 'Last update', 'Tags', 'Notes'];

function lastUpdate(it: Item): string {
  const e = [...it.history].reverse().find((h) => h.kind !== 'reviewed');
  if (!e) return '';
  const what = e.kind === 'chased' ? 'Chased' : e.kind === 'promise' ? 'New date given' : e.kind.charAt(0).toUpperCase() + e.kind.slice(1);
  return `${e.at.slice(0, 10)} ${what}${e.text ? `: ${e.text}` : ''}`;
}

export function toRows(items: Item[], ctx: Ctx): Row[] {
  const o = ctx.doc.settings.dateOrder;
  return items.map((it) => {
    const p = ctx.doc.people.find((x) => x.id === it.personId);
    const plan = chasePlan(it, ctx);
    return {
      No: it.num,
      Raised: fmtDay(it.askedOn, o),
      Action: it.title,
      Type: it.direction === 'owe' ? 'I owe' : 'Waiting on',
      With: p?.name ?? '',
      Company: p?.company ?? '',
      Due: fmtDay(it.due, o),
      Status: age(it, ctx).label,
      'Next chase': plan ? fmtDay(plan.day, o) : '',
      'Last update': lastUpdate(it),
      Tags: it.tags.join(', '),
      Notes: [it.notes, it.closeNote].filter(Boolean).join(' / '),
    };
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** An HTML table with inline styles, because Outlook drops stylesheets. */
export function rowsToHtml(rows: Row[], cols: (keyof Row)[] = ['No', 'Action', 'With', 'Due', 'Status']): string {
  const th = 'style="text-align:left;padding:4px 8px;border-bottom:1px solid #999;font:600 12px Segoe UI,Arial,sans-serif"';
  const td = 'style="padding:4px 8px;border-bottom:1px solid #ddd;font:12px Segoe UI,Arial,sans-serif;vertical-align:top"';
  const head = cols.map((c) => `<th ${th}>${esc(c)}</th>`).join('');
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td ${td}>${esc(String(r[c]))}</td>`).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function rowsToText(rows: Row[], cols: (keyof Row)[] = ['No', 'Action', 'With', 'Due', 'Status']): string {
  return rows.map((r) => cols.map((c) => (c === 'No' ? `#${r[c]}` : String(r[c]))).filter((v) => v && v !== '#').join(' | ')).join('\n');
}

/** A cell starting =, +, - or @ is a formula to Excel; write it as text. */
export function csvField(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: Row[]): string {
  return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(','))].join('\r\n');
}
