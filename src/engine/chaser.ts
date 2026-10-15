/**
 * Chasers: the email that asks where something is.
 *
 * The application never sends anything. It writes a draft and hands it to Outlook,
 * either as a mailto: link (one click, short bodies) or as an .eml file with
 * `X-Unsent: 1`, which classic Outlook opens as a new message ready to send.
 *
 * Templates use {placeholders}. A line whose placeholders all came out empty is
 * dropped, so "You mentioned you would have it by {promised}." disappears when there
 * was no promise instead of reading "by ." in front of somebody.
 */
import { fmtDayLong, plural, workingDaysBetween, type Calendar } from './dates';
import { firstName } from './people';
import { promiseAtClose } from './stats';
import type { ChaseLevel, Day, Item, Person, Settings, Template } from './types';

export type Draft = { to: string[]; cc: string[]; subject: string; body: string };

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  const lines = tpl.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const filled = line.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
    if (keys.length && keys.every((k) => !vars[k])) continue;
    out.push(filled);
  }
  // Two blank lines left where a dropped line sat between them collapse to one.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function addr(p?: { name: string; email?: string }): string {
  if (!p?.email) return '';
  return p.name ? `${p.name} <${p.email}>` : p.email;
}

/** The subject a chase goes under: a reply to the email it came from, when there was one. */
export function chaseSubject(it: Item): string {
  if (it.source?.kind === 'email' || it.source?.kind === 'outlook') {
    const ref = it.source.ref?.trim();
    if (ref) return /^re:/i.test(ref) ? ref : `RE: ${ref}`;
  }
  return it.title;
}

export type ChaseInput = {
  items: Item[];
  person?: Person;
  level: ChaseLevel;
  settings: Settings;
  today: Day;
  cal: Calendar;
};

function itemVars(it: Item, today: Day, cal: Calendar): Record<string, string> {
  const waited = Math.max(0, workingDaysBetween(it.askedOn, today, cal));
  const promise = it.due ?? promiseAtClose(it);
  return {
    title: it.title,
    asked: fmtDayLong(it.askedOn),
    waited: plural(waited, 'working day'),
    promised: promise ? fmtDayLong(promise) : '',
    subject: chaseSubject(it),
    num: String(it.num),
  };
}

/** One line per item for a round-up: "- ATS report (asked 2 Oct, promised 9 Oct)". */
export function listLine(it: Item, today: Day, cal: Calendar): string {
  const v = itemVars(it, today, cal);
  const bits = [`asked ${v.asked}`];
  if (v.promised) bits.push(`promised ${v.promised}`);
  return `- ${it.title} (${bits.join(', ')})`;
}

export function draftChase(input: ChaseInput): Draft {
  const { items, person, level, settings, today, cal } = input;
  if (!items.length) throw new Error('Nothing to chase.');
  const batch = items.length > 1;
  const tpl: Template = batch ? settings.templates.batch : settings.templates[level];
  const base = itemVars(items[0], today, cal);
  const escalateTo = level === 'escalate' && person?.escalateTo ? person.escalateTo : undefined;
  const vars: Record<string, string> = {
    ...base,
    first: person ? firstName(person) : 'there',
    name: person?.name ?? '',
    me: settings.myName,
    count: String(items.length),
    list: items.map((it) => listLine(it, today, cal)).join('\n'),
    escalateTo: escalateTo?.name ?? '',
  };
  const subject = renderTemplate(tpl.subject, vars).replace(/\n/g, ' ') || (batch ? `Open items: ${items.length} waiting` : items[0].title);
  return {
    to: person?.email ? [addr(person)] : [],
    cc: escalateTo?.email ? [addr(escalateTo)] : [],
    subject,
    body: renderTemplate(tpl.body, vars),
  };
}

/**
 * A mailto: link. Outlook takes the subject and body from it; the body is limited by
 * how long a URL Windows will hand over, so a long round-up goes as an .eml instead.
 */
export function mailtoUrl(d: Draft): string {
  const to = d.to.map(stripName).join(';');
  const q: string[] = [];
  if (d.cc.length) q.push(`cc=${encodeURIComponent(d.cc.map(stripName).join(';'))}`);
  q.push(`subject=${encodeURIComponent(d.subject)}`);
  q.push(`body=${encodeURIComponent(d.body.replace(/\r?\n/g, '\r\n'))}`);
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@').replace(/%3B/g, ';')}?${q.join('&')}`;
}

/** Windows hands a URL of about 2,000 characters to the mail program; past that, use .eml. */
export const MAILTO_LIMIT = 1900;

export function mailtoFits(d: Draft): boolean {
  return mailtoUrl(d).length <= MAILTO_LIMIT;
}

function stripName(a: string): string {
  return /<([^>]+)>/.exec(a)?.[1] ?? a;
}

function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function encodeHeader(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`;
}

/**
 * An unsent message. `X-Unsent: 1` is what makes Outlook open it as a draft with a
 * Send button rather than as a received message. The body is base64 so any character
 * survives, and lines are folded at 76 as the format requires.
 */
export function emlFile(d: Draft): string {
  // A line break in a header value would start a new header; none survives.
  const one = (v: string) => v.replace(/[\r\n]+/g, ' ');
  d = { ...d, to: d.to.map(one), cc: d.cc.map(one), subject: one(d.subject) };
  const headers = [
    d.to.length ? `To: ${d.to.map(encodeAddr).join(', ')}` : 'To: ',
    ...(d.cc.length ? [`Cc: ${d.cc.map(encodeAddr).join(', ')}`] : []),
    `Subject: ${encodeHeader(d.subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = b64utf8(d.body.replace(/\r?\n/g, '\r\n'))
    .match(/.{1,76}/g)!
    .join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

function encodeAddr(a: string): string {
  const m = /^(.*)<([^>]+)>$/.exec(a);
  if (!m) return a;
  const name = m[1].trim();
  return name ? `${encodeHeader(/[,;"]/.test(name) ? `"${name.replace(/"/g, '')}"` : name)} <${m[2]}>` : m[2];
}

/** Plain text of a draft, for the clipboard. */
export function draftText(d: Draft): string {
  return [d.to.length ? `To: ${d.to.join('; ')}` : '', d.cc.length ? `Cc: ${d.cc.join('; ')}` : '', `Subject: ${d.subject}`, '', d.body].filter((l, i) => l || i > 1).join('\n');
}

/** A safe file name for a draft. */
export function emlName(d: Draft): string {
  const base = d.subject.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'chase';
  return `${base}.eml`;
}
