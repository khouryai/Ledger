/**
 * People: reading them off an address line, and finding the one somebody meant.
 *
 * A name is matched exactly or not at all. "Sam" finds Sam Lee only when there is
 * exactly one Sam; with two, the answer is "which Sam?", and with none it is "a new
 * person called Sam?". Nothing here ever picks the likeliest of several.
 */
import type { Person } from './types';

export type Address = { name: string; email?: string };

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** "Lee, Sam" → "Sam Lee"; quotes and stray brackets go. */
export function cleanName(raw: string): string {
  let n = raw.trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').trim();
  n = n.replace(/\s*\((?:external|ext|guest)\)\s*$/i, '');
  const comma = /^([^,]+),\s*([^,]+)$/.exec(n);
  if (comma && !/\b(inc|ltd|llc|co)\b/i.test(n)) n = `${comma[2].trim()} ${comma[1].trim()}`;
  return n;
}

/** A display name from an email address: sam.lee@x.com → Sam Lee. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0].replace(/[0-9]+$/, '');
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Split an address line as Outlook writes it:
 *   Sam Lee <sam.lee@x.com>; "Doe, Jane" <jane@x.com>; bob@x.com; Priya Shah
 * Semicolons always separate. Commas separate only where they are clearly between
 * addresses, because "Lee, Sam" is one person.
 */
export function parseAddressList(line: string): Address[] {
  const text = line.replace(/^\s*(to|cc|from|bcc)\s*:\s*/i, '');
  const parts: string[] = [];
  let buf = '';
  let quoted = false;
  let angle = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (ch === '<') angle = true;
    if (ch === '>') angle = false;
    const sep = ch === ';' || ch === '\n' || (ch === ',' && !quoted && !angle && (EMAIL.test(buf) || buf.includes('>')));
    if (sep && !quoted && !angle) {
      if (buf.trim()) parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);

  const out: Address[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const email = EMAIL.exec(part)?.[0];
    let name = part.replace(/<[^>]*>/g, '').replace(email ?? '\u0000', '').replace(/[[\]]/g, '');
    name = cleanName(name.replace(/mailto:/gi, ''));
    if (!name && email) name = nameFromEmail(email);
    if (!name) continue;
    const key = (email ?? name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email ? { name, email: email.toLowerCase() } : { name });
  }
  return out;
}

export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function firstName(p: Pick<Person, 'name'>): string {
  return p.name.trim().split(/\s+/)[0] ?? p.name;
}

export type PersonMatch =
  | { kind: 'one'; person: Person; how: 'email' | 'name' | 'first' | 'handle' }
  | { kind: 'many'; people: Person[] }
  | { kind: 'none' };

/**
 * Find who a name or address means. Email is exact; a full name is exact (case and
 * accents aside); a first name or a handle such as `SamL` counts only when it points
 * at exactly one person.
 */
export function matchPerson(people: Person[], ref: { name?: string; email?: string }): PersonMatch {
  const email = ref.email?.trim().toLowerCase();
  if (email) {
    const hit = people.find((p) => p.email?.toLowerCase() === email);
    if (hit) return { kind: 'one', person: hit, how: 'email' };
  }
  const raw = ref.name?.trim();
  if (!raw) return { kind: 'none' };
  const n = normName(cleanName(raw.replace(/_/g, ' ')));
  if (!n) return { kind: 'none' };
  const full = people.filter((p) => normName(p.name) === n);
  if (full.length === 1) return { kind: 'one', person: full[0], how: 'name' };
  if (full.length > 1) return { kind: 'many', people: full };
  const compact = n.replace(/ /g, '');
  const handle = people.filter((p) => {
    const pn = normName(p.name);
    const parts = pn.split(' ');
    const local = p.email ? normName(p.email.split('@')[0]).replace(/ /g, '') : '';
    return pn.replace(/ /g, '') === compact || local === compact || (parts.length > 1 && parts[0] + parts[parts.length - 1][0] === compact);
  });
  if (handle.length === 1) return { kind: 'one', person: handle[0], how: 'handle' };
  if (!n.includes(' ')) {
    const first = people.filter((p) => normName(firstName(p)) === n);
    if (first.length === 1) return { kind: 'one', person: first[0], how: 'first' };
    if (first.length > 1) return { kind: 'many', people: first };
  }
  return { kind: 'none' };
}

/** Title-case a typed handle for a new person: "sam_lee" → "Sam Lee". */
export function nameFromHandle(handle: string): string {
  return handle
    .replace(/^@/, '')
    .replace(/["']/g, '')
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
