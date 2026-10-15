/**
 * Reading email: a saved .eml file, or text pasted out of Outlook.
 *
 * A pasted thread is several messages, newest first, each under a header block:
 *
 *   From: Sam Lee <sam.lee@example.com>
 *   Sent: Thursday, October 15, 2026 9:41 AM
 *   To: Alex Khoury <alex@example.com>
 *   Subject: RE: ATS test report
 *
 * Those blocks are what split it into messages. Nothing here needs the network or a
 * library, so it runs the same in the browser and in the tests.
 */
import { toDay } from './dates';
import { parseAddressList, type Address } from './people';
import type { Day } from './types';

export type Message = {
  from?: Address;
  to: Address[];
  cc: Address[];
  date?: Day;
  /** The sent time as written, for showing. */
  sentText?: string;
  subject?: string;
  body: string;
};

// ── Pasted text ─────────────────────────────────────────────────────────────

const HEADER = /^\s*(from|sent|date|to|cc|subject)\s*:\s*(.*)$/i;

/** Parse "Thursday, October 15, 2026 9:41 AM", "15 October 2026 09:41", ISO and RFC 2822. */
export function parseSentDate(text: string): Day | undefined {
  const t = text.replace(/\bat\b/i, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ms = Date.parse(t.replace(/^[A-Za-z]+,\s*/, ''));
  if (!Number.isNaN(ms)) return toDay(new Date(ms));
  const slash = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (slash) {
    const ms2 = Date.parse(`${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}T12:00:00`);
    if (!Number.isNaN(ms2)) return toDay(new Date(ms2));
  }
  return undefined;
}

/**
 * Split pasted text into messages. Text before the first header block is the newest
 * message when the paste began with its body (copying a reply as it is written);
 * otherwise every message starts at its own block.
 */
export function parsePasted(text: string): Message[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const msgs: Message[] = [];
  let cur: Message = { to: [], cc: [], body: '' };
  let body: string[] = [];
  let inHeader = false;
  let sawHeader = false;

  const flush = () => {
    cur.body = cleanBody(body.join('\n'));
    if (cur.body || cur.from || cur.subject) msgs.push(cur);
    cur = { to: [], cc: [], body: '' };
    body = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^>+\s?/, '');
    const h = HEADER.exec(line);
    // A header block starts at "From:" followed within a few lines by Sent/Date/Subject.
    const starts = h && h[1].toLowerCase() === 'from' && lines.slice(i + 1, i + 6).some((l) => /^\s*>*\s*(sent|date|subject|to)\s*:/i.test(l));
    if (starts) {
      if (sawHeader || body.join('').trim()) flush();
      sawHeader = true;
      inHeader = true;
    }
    if (inHeader && h) {
      const key = h[1].toLowerCase();
      const val = h[2].trim();
      if (key === 'from') cur.from = parseAddressList(val)[0];
      else if (key === 'sent' || key === 'date') {
        cur.sentText = val;
        cur.date = parseSentDate(val);
      } else if (key === 'to') cur.to = parseAddressList(val);
      else if (key === 'cc') cur.cc = parseAddressList(val);
      else if (key === 'subject') cur.subject = val;
      continue;
    }
    if (inHeader && line.trim() === '') {
      inHeader = false;
      continue;
    }
    // A wrapped address line under To: or Cc: in Outlook's own block.
    if (inHeader && !h && /[@;]/.test(line) && !cur.subject) {
      cur.to = [...cur.to, ...parseAddressList(line)];
      continue;
    }
    inHeader = false;
    body.push(line);
  }
  flush();
  return msgs;
}

/** Drop the quoted original Outlook appends and the signature block. */
export function cleanBody(body: string): string {
  let t = body.replace(/\r\n?/g, '\n');
  const cut = t.search(/^\s*-{2,}\s*Original Message\s*-{2,}|^\s*On .{5,80} wrote:\s*$|^_{20,}\s*$/im);
  if (cut >= 0) t = t.slice(0, cut);
  // Signature: "-- " on its own line.
  const sig = t.search(/^-- ?$/m);
  if (sig >= 0) t = t.slice(0, sig);
  t = t.replace(/^\s*(caution|external email|\[external\]).{0,200}$/gim, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// ── .eml files ──────────────────────────────────────────────────────────────

function decodeQP(s: string): Uint8Array {
  const clean = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(clean.slice(i + 1, i + 3))) {
      out.push(parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(clean.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function decodeB64(s: string): Uint8Array {
  const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToText(bytes: Uint8Array, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset.toLowerCase().replace(/^us-ascii$/, 'utf-8')).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Raw 8-bit text (as read from a file as latin1) back to bytes. */
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** =?UTF-8?B?…?= and =?iso-8859-1?Q?…?= in a header. */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, cs: string, enc: string, data: string) => {
    const bytes = enc.toUpperCase() === 'B' ? decodeB64(data) : decodeQP(data.replace(/_/g, ' '));
    return bytesToText(bytes, cs);
  });
}

type Part = { headers: Map<string, string>; body: string };

function splitHeaders(raw: string): Part {
  const idx = raw.search(/\r?\n\r?\n/);
  const head = idx < 0 ? raw : raw.slice(0, idx);
  const body = idx < 0 ? '' : raw.slice(idx).replace(/^\r?\n\r?\n/, '');
  const headers = new Map<string, string>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (m) headers.set(m[1].toLowerCase(), m[2]);
  }
  return { headers, body };
}

function param(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i').exec(header);
  return m ? (m[2] ?? m[1]) : undefined;
}

function decodePart(p: Part): string {
  const enc = (p.headers.get('content-transfer-encoding') ?? '').toLowerCase();
  const charset = param(p.headers.get('content-type'), 'charset') ?? 'utf-8';
  if (enc === 'base64') return bytesToText(decodeB64(p.body), charset);
  if (enc === 'quoted-printable') return bytesToText(decodeQP(p.body), charset);
  return bytesToText(latin1Bytes(p.body), charset);
}

/** The best text in a MIME tree: text/plain if there is one, else HTML made plain. */
function bestText(p: Part): { text: string; html: boolean } | null {
  const type = (p.headers.get('content-type') ?? 'text/plain').toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = param(p.headers.get('content-type'), 'boundary');
    if (!boundary) return null;
    const pieces = p.body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*\\r?\\n?`));
    let html: { text: string; html: boolean } | null = null;
    for (const piece of pieces) {
      if (!piece.trim()) continue;
      const sub = bestText(splitHeaders(piece));
      if (sub && !sub.html) return sub;
      if (sub && !html) html = sub;
    }
    return html;
  }
  if (/attachment/i.test(p.headers.get('content-disposition') ?? '')) return null;
  if (type.startsWith('text/html')) return { text: htmlToText(decodePart(p)), html: true };
  if (type.startsWith('text/')) return { text: decodePart(p), html: false };
  return null;
}

/** Plain text from HTML without running or loading anything in it. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse an .eml file. Pass the file's text read as latin1 (`readAsBinaryString`
 * semantics) so 8-bit bodies decode in their own charset.
 */
export function parseEml(raw: string): Message {
  const top = splitHeaders(raw);
  const h = top.headers;
  const best = bestText(top);
  const dateHeader = h.get('date');
  return {
    from: parseAddressList(decodeWords(h.get('from') ?? ''))[0],
    to: parseAddressList(decodeWords(h.get('to') ?? '')),
    cc: parseAddressList(decodeWords(h.get('cc') ?? '')),
    date: dateHeader ? parseSentDate(dateHeader) : undefined,
    sentText: dateHeader,
    subject: decodeWords(h.get('subject') ?? '') || undefined,
    body: cleanBody(best?.text ?? ''),
  };
}

/** Is this address me? By email when both have one, else by name. */
export function isMe(a: Address | undefined, me: { name: string; email: string }): boolean {
  if (!a) return false;
  if (me.email && a.email) return a.email.toLowerCase() === me.email.toLowerCase();
  return !!me.name && a.name.trim().toLowerCase() === me.name.trim().toLowerCase();
}

/** "RE: FW: ATS report" → "ATS report", for matching a thread to an item. */
export function baseSubject(s: string | undefined): string {
  return (s ?? '').replace(/^(\s*(re|fw|fwd|aw|wg)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();
}
