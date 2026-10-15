import { describe, expect, it } from 'vitest';
import { parseMsg } from '../src/io/msg';
import { makeMsg } from './msgFixture';

describe('.msg files', () => {
  it('reads subject, body, sender and recipient', () => {
    const bytes = makeMsg({ subject: 'RE: Cable schedule', body: 'Could you send the IXL procedure by Friday?\r\n\r\nThanks', senderName: 'Sam Lee', senderEmail: 'sam.lee@example.com', toName: 'Alex Khoury', toEmail: 'alex@example.com' });
    const m = parseMsg(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(m.subject).toBe('RE: Cable schedule');
    expect(m.from).toEqual({ name: 'Sam Lee', email: 'sam.lee@example.com' });
    expect(m.to[0]).toMatchObject({ name: 'Alex Khoury' });
    expect(m.body).toContain('IXL procedure by Friday');
  });
});
