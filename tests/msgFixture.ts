/**
 * Builds a small Outlook .msg file for the tests, with msgreader's own writer: the
 * subject, body, sender and one recipient, as Unicode property streams.
 */
import { burn } from '@kenjiuno/msgreader/lib/Burner.js';

const DIRECTORY = 1;
const DOCUMENT = 2;
const ROOT = 5;

function utf16(s: string): number[] {
  const out: number[] = [];
  for (const ch of `${s}\0`) {
    const c = ch.charCodeAt(0);
    out.push(c & 0xff, c >> 8);
  }
  return out;
}

export function makeMsg(m: { subject: string; body: string; senderName: string; senderEmail: string; toName: string; toEmail: string }): Uint8Array {
  const doc = (name: string, text: string) => {
    const bytes = utf16(text);
    return { name, type: DOCUMENT, length: bytes.length, binaryProvider: () => bytes };
  };
  const entries = [
    { name: 'Root Entry', type: ROOT, length: 0, children: [1, 2, 3, 4, 5, 6] },
    doc('__substg1.0_0037001F', m.subject),
    doc('__substg1.0_1000001F', m.body),
    doc('__substg1.0_0C1A001F', m.senderName),
    doc('__substg1.0_0C1F001F', m.senderEmail),
    { name: '__properties_version1.0', type: DOCUMENT, length: 32, binaryProvider: () => new Array(32).fill(0) },
    { name: '__recip_version1.0_#00000000', type: DIRECTORY, length: 0, children: [7, 8, 9] },
    doc('__substg1.0_3001001F', m.toName),
    doc('__substg1.0_3003001F', m.toEmail),
    { name: '__properties_version1.0', type: DOCUMENT, length: 8, binaryProvider: () => new Array(8).fill(0) },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return burn(entries as any);
}
