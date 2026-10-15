/**
 * Outlook, through Microsoft Graph: sent emails nobody answered, flagged emails, and
 * today's meetings. Read-only, off by default, and every suggestion is accepted by
 * hand. Needs an app registration from IT; see docs/OUTLOOK.md.
 */
import { useState } from 'react';
import { addPerson, addMeeting, calendarOf, dismissMessage, openSession } from '../../engine/ops';
import { matchPerson } from '../../engine/people';
import { canUseOutlook, graphClient } from '../../graph/client';
import { flaggedToDo, meetingsToday, unansweredAsks, type GraphMessage, type OutlookSuggestion, type TodayMeeting } from '../../graph/suggest';
import { Icon } from '../components/icons';
import { SuggestionList, type Draft } from '../components/Suggestions';
import { Empty, Hero, Section } from '../components/ui';
import { href, navigate } from '../router';
import { useApp } from '../state';

function toDraft(s: OutlookSuggestion, people: ReturnType<typeof useApp>['state']['doc']['people']): Draft {
  const m = matchPerson(people, { name: s.personName, email: s.personEmail });
  return {
    key: s.messageId,
    on: true,
    added: false,
    direction: s.direction,
    title: s.title,
    personId: m.kind === 'one' ? m.person.id : undefined,
    newPerson: m.kind === 'none' ? s.personName : undefined,
    due: s.due,
    askedOn: s.askedOn,
    quote: s.quote,
    from: 'outlook',
    note: s.reason,
    messageId: s.messageId,
    source: { kind: 'outlook', ref: s.subject, messageId: s.messageId, date: s.askedOn },
  };
}

export function Outlook() {
  const { state, actions } = useApp();
  const doc = state.doc;
  const o = doc.settings.outlook;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Draft[] | null>(null);
  const [flagged, setFlagged] = useState<Draft[] | null>(null);
  const can = canUseOutlook();

  const tracked = new Set([...doc.dismissed, ...doc.items.map((i) => i.source?.messageId).filter((x): x is string => !!x)]);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await graphClient(o.clientId, o.tenantId);
      const me = await g.me();
      const myEmail = (doc.settings.myEmail || me.mail || me.userPrincipalName || '').toLowerCase();
      const since = new Date(Date.now() - o.lookback * 86_400_000).toISOString();
      const mail = await g.sent(since);
      const thread = new Map<string, GraphMessage[]>();
      for (const m of mail.slice(0, 60)) if (m.conversationId && !thread.has(m.conversationId)) thread.set(m.conversationId, await g.conversation(m.conversationId));
      const ctx = { me: { name: doc.settings.myName || me.displayName || '', email: myEmail }, today: state.today, cal: calendarOf(doc.settings), order: doc.settings.dateOrder, people: doc.people, noReplyAfter: o.noReplyAfter, skip: tracked };
      setSent(unansweredAsks(mail, thread, ctx).map((x) => toDraft(x, doc.people)));
      setFlagged(flaggedToDo(await g.flagged(), ctx).map((x) => toDraft(x, doc.people)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dismissAll = (list: Draft[] | null, set: (d: Draft[]) => void) => {
    if (!list) return;
    const ids = list.filter((d) => !d.added && d.messageId).map((d) => d.messageId!);
    actions.apply((d) => ids.reduce((doc2, id) => dismissMessage(doc2, id), d), `Dismissed ${ids.length}. They will not be suggested again.`);
    set(list.filter((d) => d.added));
  };

  return (
    <div>
      <Hero
        eyebrow="Keep it honest"
        title="Outlook"
        sub="Emails you sent that nobody answered, emails you flagged, and today's meetings, read from your mailbox. Ledger only reads; every suggestion waits for you."
        actions={
          <button type="button" className="btn btn-primary" disabled={!o.clientId || !can.ok || busy} onClick={() => void check()} data-testid="outlook-check">
            <Icon name="outlook" size={14} /> {busy ? 'Reading your mailbox…' : 'Check Outlook'}
          </button>
        }
      />
      <div className="page page-narrow">
        {!o.clientId && (
          <div className="notice notice-info mb-4">
            Outlook needs an app registration from IT before it can be read. Put its client id in <a href={href('settings')}>Settings</a>; the steps for IT are in docs/OUTLOOK.md.
          </div>
        )}
        {!can.ok && <div className="notice notice-warn mb-4">{can.reason}</div>}
        {error && <div className="notice notice-error mb-4">{error}</div>}
        {sent && (
          <Section title="Sent, with no reply" count={sent.filter((d) => !d.added).length} aside={sent.some((d) => !d.added) ? <button type="button" className="btn btn-mini" onClick={() => dismissAll(sent, setSent)}>Dismiss the rest</button> : undefined}>
            <SuggestionList drafts={sent} setDrafts={setSent} emptyText={`Everything you sent in the last ${o.lookback} days that asked for something has had a reply.`} />
          </Section>
        )}
        {flagged && (
          <Section title="Flagged" count={flagged.filter((d) => !d.added).length} aside={flagged.some((d) => !d.added) ? <button type="button" className="btn btn-mini" onClick={() => dismissAll(flagged, setFlagged)}>Dismiss the rest</button> : undefined}>
            <SuggestionList drafts={flagged} setDrafts={setFlagged} emptyText="No flagged emails that are not already in the ledger." />
          </Section>
        )}
        <OutlookToday />
      </div>
    </div>
  );
}

/** Today's meetings from the calendar, each one click from meeting mode. */
export function OutlookToday() {
  const { state, actions } = useApp();
  const doc = state.doc;
  const o = doc.settings.outlook;
  const [meetings, setMeetings] = useState<TodayMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!o.enabled || !o.clientId || !canUseOutlook().ok) return null;

  const load = async () => {
    setError(null);
    try {
      const g = await graphClient(o.clientId, o.tenantId);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86_400_000);
      setMeetings(meetingsToday(await g.events(start.toISOString(), end.toISOString()), doc.settings.myEmail));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openMeeting = (m: TodayMeeting) => {
    let meetingId = doc.meetings.find((x) => x.name.toLowerCase() === m.subject.toLowerCase())?.id;
    actions.apply((d) => {
      let out = d;
      const ids: string[] = [];
      for (const a of m.attendees) {
        const hit = matchPerson(out.people, a);
        if (hit.kind === 'one') ids.push(hit.person.id);
        else if (hit.kind === 'none') {
          const r = addPerson(out, { name: a.name, email: a.email }, new Date());
          out = r.doc;
          ids.push(r.person.id);
        }
      }
      if (!meetingId) {
        const r = addMeeting(out, { name: m.subject, attendees: ids, recurring: true }, new Date());
        out = r.doc;
        meetingId = r.meeting.id;
      }
      return openSession(out, meetingId, state.today, new Date()).doc;
    });
    if (meetingId) navigate('meetings', { id: meetingId });
  };

  return (
    <Section title="Today's meetings" aside={<button type="button" className="btn btn-mini" onClick={() => void load()}>{meetings ? 'Refresh' : 'Read my calendar'}</button>}>
      {error && <div className="notice notice-error mb-2">{error}</div>}
      {meetings && (
        <div className="list-card">
          {meetings.map((m) => (
            <button key={m.id} type="button" className="row w-full text-left" style={{ gridTemplateColumns: '64px minmax(0,1fr) auto' }} onClick={() => openMeeting(m)}>
              <span className="mono">{m.start.slice(11, 16)}</span>
              <span>
                <span className="row-title">{m.subject}</span>
                <span className="row-meta">{m.attendees.map((a) => a.name).join(', ')}</span>
              </span>
              <span className="hint">Open in meeting mode</span>
            </button>
          ))}
          {!meetings.length && <Empty title="No meetings today." />}
        </div>
      )}
    </Section>
  );
}
