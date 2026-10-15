import { describe, expect, it } from 'vitest';
import { baseSubject, decodeWords, htmlToText, parseEml, parsePasted } from '../src/engine/email';

const THREAD = `Thanks Sam, can you also send the cable schedule by Friday?

From: Sam Lee <sam.lee@example.com>
Sent: Wednesday, October 14, 2026 4:12 PM
To: Alex Khoury <alex@example.com>
Cc: Priya Shah <priya.shah@example.com>
Subject: RE: ATS test report

Alex, I'll send the revised ATS report next Tuesday.

-- 
Sam Lee | Systems Engineer

From: Alex Khoury <alex@example.com>
Sent: Monday, October 12, 2026 9:00 AM
To: Sam Lee <sam.lee@example.com>
Subject: ATS test report

Sam, could you send me the ATS test report?`;

describe('pasted threads', () => {
  it('splits into messages, newest first, with their headers', () => {
    const msgs = parsePasted(THREAD);
    expect(msgs.length).toBe(3);
    expect(msgs[0].from).toBeUndefined();
    expect(msgs[0].body).toContain('cable schedule');
    expect(msgs[1].from).toEqual({ name: 'Sam Lee', email: 'sam.lee@example.com' });
    expect(msgs[1].date).toBe('2026-10-14');
    expect(msgs[1].cc[0].name).toBe('Priya Shah');
    expect(msgs[1].subject).toBe('RE: ATS test report');
    expect(msgs[1].body).toBe("Alex, I'll send the revised ATS report next Tuesday.");
    expect(msgs[2].from!.name).toBe('Alex Khoury');
  });
  it('strips RE and FW to find the base subject', () => {
    expect(baseSubject('RE: FW: Re: ATS report')).toBe('ATS report');
  });
});

describe('.eml files', () => {
  it('reads a multipart message, preferring plain text', () => {
    const raw = [
      'From: =?UTF-8?B?U2FtIEzDqWU=?= <sam@example.com>',
      'To: Alex <alex@example.com>',
      'Subject: =?utf-8?Q?Caf=C3=A9_drawings?=',
      'Date: Thu, 15 Oct 2026 09:30:00 -0700',
      'Content-Type: multipart/alternative; boundary="XYZ"',
      '',
      '--XYZ',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Please review the caf=C3=A9 drawings by Monday.',
      '--XYZ',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Please review</p>',
      '--XYZ--',
    ].join('\r\n');
    const m = parseEml(Buffer.from(raw, 'utf8').toString('latin1'));
    expect(m.from).toEqual({ name: 'Sam Lée', email: 'sam@example.com' });
    expect(m.subject).toBe('Café drawings');
    expect(m.date).toBe('2026-10-15');
    expect(m.body).toBe('Please review the café drawings by Monday.');
  });
  it('reads HTML without running it', () => {
    expect(htmlToText('<p>Hi</p><script>alert(1)</script><img src=x onerror=alert(1)>Bye &amp; done')).toBe('Hi\nBye & done');
  });
  it('decodes encoded words', () => {
    expect(decodeWords('=?UTF-8?B?w6k=?= =?UTF-8?B?w6k=?=')).toBe('éé');
  });
});
