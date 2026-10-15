import { describe, expect, it } from 'vitest';
import { flaggedToDo, meetingsToday, unansweredAsks, type GraphMessage } from '../src/graph/suggest';
import { docWith, TODAY } from './helpers';

const doc = docWith(['Sam Lee']);
const ctx = {
  me: { name: 'Alex Khoury', email: 'alex@example.com' },
  today: TODAY,
  cal: { workDays: [1, 2, 3, 4, 5], holidays: [] },
  order: 'MDY' as const,
  people: doc.people,
  noReplyAfter: 3,
  skip: new Set<string>(),
};
const sam = { emailAddress: { name: 'Sam Lee', address: 'sam.lee@example.com' } };
const me = { emailAddress: { name: 'Alex Khoury', address: 'alex@example.com' } };

function sent(id: string, day: string, body: string, conv = id): GraphMessage {
  return { id, conversationId: conv, subject: 'ATS report', sentDateTime: `${day}T15:00:00Z`, toRecipients: [sam], body: { contentType: 'text', content: body } };
}

describe('sent mail with no reply', () => {
  it('suggests an ask nobody answered', () => {
    const s = unansweredAsks([sent('m1', '2026-10-08', 'Sam, could you send the ATS report by Friday?')], new Map(), ctx);
    expect(s).toMatchObject([{ messageId: 'm1', direction: 'wait', personName: 'Sam Lee', askedOn: '2026-10-08', title: 'Send the ATS report' }]);
    expect(s[0].reason).toContain('5 working days ago');
  });
  it('skips one that was answered, one too recent, one that asked nothing, and one dismissed', () => {
    const msgs = [
      sent('a', '2026-10-08', 'Could you send the report?', 'c1'),
      sent('b', '2026-10-14', 'Could you send the plan?'),
      sent('c', '2026-10-01', 'Thanks for the update, all good.'),
      sent('d', '2026-10-01', 'Can you confirm the possession?'),
    ];
    const thread = new Map([['c1', [{ id: 'r', from: sam, receivedDateTime: '2026-10-09T09:00:00Z' }, { id: 'x', from: me, sentDateTime: '2026-10-08T15:00:00Z' }]]]);
    expect(unansweredAsks(msgs, thread, { ...ctx, skip: new Set(['d']) })).toEqual([]);
  });
});

describe('flags and meetings', () => {
  it('turns a flagged email into something I owe', () => {
    const s = flaggedToDo(
      [{ id: 'f', subject: 'RE: IXL plan', from: sam, receivedDateTime: '2026-10-13T10:00:00Z', flag: { flagStatus: 'flagged', dueDateTime: { dateTime: '2026-10-20T00:00:00' } }, body: { contentType: 'text', content: 'Can you review the IXL plan?' } }],
      ctx,
    );
    expect(s).toMatchObject([{ direction: 'owe', title: 'Review the IXL plan', due: '2026-10-20', personName: 'Sam Lee' }]);
  });
  it('lists today’s meetings without me in the attendees', () => {
    const m = meetingsToday(
      [
        { id: 'e2', subject: 'Later', start: { dateTime: '2026-10-15T15:00:00' }, attendees: [] },
        { id: 'e1', subject: 'BART weekly', start: { dateTime: '2026-10-15T09:00:00' }, attendees: [sam, me] },
        { id: 'e3', subject: 'Cancelled', isCancelled: true },
      ],
      'alex@example.com',
    );
    expect(m.map((x) => x.subject)).toEqual(['BART weekly', 'Later']);
    expect(m[0].attendees).toEqual([{ name: 'Sam Lee', email: 'sam.lee@example.com' }]);
  });
});
