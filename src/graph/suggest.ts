/**
 * Suggestions from Outlook, worked out from what Microsoft Graph returns. Pure, so it
 * is tested without a mailbox.
 *
 *   - A sent email that asked for something and has had no reply from anyone else
 *     in the thread for N working days: something I am probably waiting on.
 *   - A flagged email: something I have marked to do.
 *   - Today's meetings: so meeting mode can open with the right attendees.
 *
 * Every suggestion has to be accepted by hand. A message dismissed once is never
 * suggested again, and one already tracked (by its message id) is skipped.
 */
import { findAsks } from '../engine/asks';
import { toDay, workingDaysBetween, type Calendar } from '../engine/dates';
import { htmlToText } from '../engine/email';
import type { DateOrder, Day, Person } from '../engine/types';

export type GraphAddress = { emailAddress?: { name?: string; address?: string } };

export type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  sentDateTime?: string;
  receivedDateTime?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  flag?: { flagStatus?: string; dueDateTime?: { dateTime?: string } };
  webLink?: string;
};

export type GraphEvent = {
  id: string;
  subject?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  attendees?: { emailAddress?: { name?: string; address?: string }; type?: string }[];
  organizer?: GraphAddress;
  isCancelled?: boolean;
};

export type OutlookSuggestion = {
  messageId: string;
  direction: 'owe' | 'wait';
  title: string;
  quote: string;
  personName?: string;
  personEmail?: string;
  askedOn: Day;
  due?: Day;
  subject: string;
  reason: string;
  webLink?: string;
};

function addr(a?: GraphAddress): { name: string; email?: string } | undefined {
  const e = a?.emailAddress;
  if (!e) return undefined;
  return { name: e.name || e.address || '', email: e.address?.toLowerCase() };
}

function text(m: GraphMessage): string {
  if (m.body?.content) return m.body.contentType?.toLowerCase() === 'html' ? htmlToText(m.body.content) : m.body.content;
  return m.bodyPreview ?? '';
}

export type SuggestContext = {
  me: { name: string; email: string };
  today: Day;
  cal: Calendar;
  order: DateOrder;
  people: Person[];
  noReplyAfter: number;
  /** Message ids already tracked or dismissed. */
  skip: Set<string>;
};

/**
 * Sent asks with no reply. `thread` holds, for each conversation, the messages in it
 * that the mailbox can see; a reply is any of them from somebody other than me, sent
 * after my message.
 */
export function unansweredAsks(sent: GraphMessage[], thread: Map<string, GraphMessage[]>, ctx: SuggestContext): OutlookSuggestion[] {
  const out: OutlookSuggestion[] = [];
  const myEmail = ctx.me.email.toLowerCase();
  for (const m of sent) {
    if (ctx.skip.has(m.id) || !m.sentDateTime) continue;
    const sentDay = toDay(new Date(m.sentDateTime));
    const waited = workingDaysBetween(sentDay, ctx.today, ctx.cal);
    if (waited < ctx.noReplyAfter) continue;
    const to = (m.toRecipients ?? []).map(addr).filter((a): a is { name: string; email?: string } => !!a && a.email !== myEmail);
    if (!to.length) continue;
    const replies = (m.conversationId ? thread.get(m.conversationId) ?? [] : []).filter((r) => {
      const from = addr(r.from)?.email;
      const when = r.receivedDateTime ?? r.sentDateTime;
      return from && from !== myEmail && when && when > m.sentDateTime!;
    });
    if (replies.length) continue;
    const body = text(m);
    const asks = findAsks(body, { today: ctx.today, cal: ctx.cal, order: ctx.order, people: ctx.people, fromMe: true, recipient: to[0], myName: ctx.me.name }).filter(
      (a) => a.direction === 'wait',
    );
    const question = /\?/.test(body.split(/\n\s*\n/)[0] ?? '');
    if (!asks.length && !question) continue;
    const first = asks[0];
    out.push({
      messageId: m.id,
      direction: 'wait',
      title: first?.title ?? (m.subject?.replace(/^(re|fw|fwd):\s*/i, '') || 'Reply to my email'),
      quote: first?.quote ?? body.split('\n').find((l) => l.includes('?'))?.trim() ?? '',
      personName: to[0].name,
      personEmail: to[0].email,
      askedOn: sentDay,
      due: first?.due,
      subject: m.subject ?? '',
      reason: `Sent ${waited} working day${waited === 1 ? '' : 's'} ago to ${to.map((t) => t.name).join(', ')}, no reply`,
      webLink: m.webLink,
    });
  }
  return out;
}

/** Flagged emails as things I owe, the flag's due date as the deadline. */
export function flaggedToDo(flagged: GraphMessage[], ctx: SuggestContext): OutlookSuggestion[] {
  return flagged
    .filter((m) => m.flag?.flagStatus === 'flagged' && !ctx.skip.has(m.id))
    .map((m) => {
      const from = addr(m.from);
      const received = m.receivedDateTime ? toDay(new Date(m.receivedDateTime)) : ctx.today;
      const due = m.flag?.dueDateTime?.dateTime?.slice(0, 10);
      const ask = findAsks(text(m), { today: ctx.today, cal: ctx.cal, order: ctx.order, people: ctx.people, fromMe: false, sender: from, myName: ctx.me.name }).find((a) => a.direction === 'owe');
      return {
        messageId: m.id,
        direction: 'owe' as const,
        title: ask?.title ?? (m.subject?.replace(/^(re|fw|fwd):\s*/i, '') || 'Flagged email'),
        quote: ask?.quote ?? m.bodyPreview?.slice(0, 200) ?? '',
        personName: from?.name,
        personEmail: from?.email,
        askedOn: received,
        due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : ask?.due,
        subject: m.subject ?? '',
        reason: `Flagged in Outlook${from ? `, from ${from.name}` : ''}`,
        webLink: m.webLink,
      };
    });
}

export type TodayMeeting = { id: string; subject: string; start: string; end: string; attendees: { name: string; email?: string }[] };

export function meetingsToday(events: GraphEvent[], myEmail: string): TodayMeeting[] {
  return events
    .filter((e) => !e.isCancelled && e.subject)
    .map((e) => ({
      id: e.id,
      subject: e.subject!,
      start: e.start?.dateTime ?? '',
      end: e.end?.dateTime ?? '',
      attendees: (e.attendees ?? [])
        .map((a) => ({ name: a.emailAddress?.name || a.emailAddress?.address || '', email: a.emailAddress?.address?.toLowerCase() }))
        .filter((a) => a.name && a.email !== myEmail.toLowerCase()),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}
