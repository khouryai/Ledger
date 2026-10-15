/**
 * Meetings: the recurring ones you keep actions for. A session opens with the open
 * items raised at earlier sessions as its agenda; actions are typed as fast as they
 * are said, owners one click away; and the list goes out afterwards as a table or an
 * email.
 */
import { useMemo, useState } from 'react';
import { useAiStatus } from '../../ai/manager';
import { findAsks } from '../../engine/asks';
import { emlFile, emlName, mailtoFits, mailtoUrl } from '../../engine/chaser';
import { addMeeting, calendarOf, openSession, removeMeeting, setSessionNotes, updateMeeting } from '../../engine/ops';
import { agenda, sessionItems } from '../../engine/review';
import { rowsToHtml, rowsToText, toRows } from '../../engine/table';
import type { Meeting } from '../../engine/types';
import { useAi } from '../ai';
import { CommitInput } from '../components/fields';
import { Icon } from '../components/icons';
import { ItemRow } from '../components/ItemRow';
import { QuickAdd } from '../components/QuickAdd';
import { draftFromAsk, SuggestionList, type Draft } from '../components/Suggestions';
import { copyRich, downloadFile, Empty, Hero, Section } from '../components/ui';
import { makeFmt } from '../format';
import { href, navigate, type Route } from '../router';
import { useApp } from '../state';
import { OutlookToday } from './Outlook';

export function Meetings({ route }: { route: Route }) {
  const { state } = useApp();
  const id = route.params.get('id');
  const meeting = state.doc.meetings.find((m) => m.id === id);
  if (meeting) return <MeetingPage meeting={meeting} key={meeting.id} />;
  return <MeetingList />;
}

function MeetingList() {
  const { state, actions } = useApp();
  const doc = state.doc;
  const [name, setName] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const fmt = makeFmt(doc.settings.dateOrder, state.today, calendarOf(doc.settings));
  const people = [...doc.people].sort((a, b) => a.name.localeCompare(b.name));
  const meetings = [...doc.meetings].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <Hero eyebrow="Work" title="Meetings" sub="The meetings you keep actions for. Each one's open actions become the next session's agenda." />
      <div className="page page-narrow">
        {doc.settings.outlook.enabled && <OutlookToday />}
        <div className="list-card">
          {meetings.map((m) => {
            const open = agenda(m, doc).length;
            const last = [...m.sessions].sort((a, b) => b.date.localeCompare(a.date))[0];
            return (
              <a key={m.id} href={href('meetings', { id: m.id })} className="row" style={{ gridTemplateColumns: '22px minmax(0,1fr) auto', textDecoration: 'none' }}>
                <span className="dir-ico" style={{ color: 'var(--text-muted)', background: 'var(--surface-3)' }}>
                  <Icon name="calendar" size={14} />
                </span>
                <span>
                  <span className="row-title">{m.name}</span>
                  <span className="row-meta">
                    {m.attendees
                      .map((a) => doc.people.find((p) => p.id === a)?.name)
                      .filter(Boolean)
                      .join(', ') || 'No attendees yet'}
                    {last ? ` · last ${fmt.day(last.date)}` : ''}
                  </span>
                </span>
                <span className="hint">{open ? `${open} open` : ''}</span>
              </a>
            );
          })}
          {!meetings.length && <Empty title="No meetings yet.">Add the ones you keep an action list for.</Empty>}
        </div>
        <div className="card mt-4">
          <div className="card-title">Add a meeting</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className="input min-w-[260px] flex-1" placeholder="BART weekly progress" value={name} onChange={(e) => setName(e.target.value)} data-testid="meeting-name" />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim()}
              onClick={() => {
                let made: Meeting | null = null;
                actions.apply((d) => {
                  const r = addMeeting(d, { name, attendees, recurring: true }, new Date());
                  made = r.meeting;
                  return r.doc;
                }, `Added ${name.trim()}.`);
                setName('');
                setAttendees([]);
                if (made) navigate('meetings', { id: (made as Meeting).id });
              }}
              data-testid="meeting-add"
            >
              Add
            </button>
          </div>
          {people.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {people.map((p) => (
                <label key={p.id} className="check chip">
                  <input type="checkbox" checked={attendees.includes(p.id)} onChange={(e) => setAttendees((a) => (e.target.checked ? [...a, p.id] : a.filter((x) => x !== p.id)))} />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MeetingPage({ meeting }: { meeting: Meeting }) {
  const { state, ctx, actions } = useApp();
  const doc = state.doc;
  const s = doc.settings;
  const fmt = makeFmt(s.dateOrder, state.today, calendarOf(s));
  const ai = useAi();
  const aiStatus = useAiStatus();
  const todaySession = meeting.sessions.find((x) => x.date === state.today);
  const [sessionId, setSessionId] = useState<string | null>(todaySession?.id ?? null);
  const session = meeting.sessions.find((x) => x.id === sessionId);
  const attendees = meeting.attendees.map((a) => doc.people.find((p) => p.id === a)).filter((p): p is NonNullable<typeof p> => !!p);
  const ag = useMemo(() => agenda(meeting, doc, sessionId ?? undefined), [meeting, doc, sessionId]);
  const added = session ? sessionItems(meeting, session.id, doc) : [];
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const past = [...meeting.sessions].filter((x) => x.id !== sessionId).sort((a, b) => b.date.localeCompare(a.date));

  const start = () => {
    let sid = '';
    actions.apply((d) => {
      const r = openSession(d, meeting.id, state.today, new Date());
      sid = r.sessionId;
      return r.doc;
    });
    setSessionId(sid || meeting.sessions.find((x) => x.date === state.today)?.id || null);
  };

  const outList = [...ag, ...added];
  const rows = toRows(outList, ctx);
  const emailBody = `Actions from ${meeting.name}, ${fmt.day(session?.date ?? state.today)}:\n\n${rowsToText(rows, ['No', 'Action', 'With', 'Due', 'Status'])}\n\n${s.myName}`;
  const emailDraft = { to: attendees.filter((p) => p.email).map((p) => `${p.name} <${p.email}>`), cc: [], subject: `Actions: ${meeting.name} ${fmt.day(session?.date ?? state.today)}`, body: emailBody };

  const findInNotes = async (useAi: boolean) => {
    const notes = session?.notes ?? '';
    if (!notes.trim()) return;
    const src = { kind: 'meeting' as const, ref: meeting.name, meetingId: meeting.id, sessionId: session?.id, date: session?.date };
    if (useAi) {
      setAiBusy(true);
      try {
        const asks = await ai.extract(notes, { fromMe: true });
        setDrafts(asks.map((a, i) => ({ ...draftFromAsk(a, i, 'ai'), source: src })));
      } catch (err) {
        actions.toast(`The model could not read the notes: ${(err as Error).message}`, 'error');
      } finally {
        setAiBusy(false);
      }
    } else {
      const asks = findAsks(notes, { today: state.today, cal: ctx.cal, order: s.dateOrder, people: doc.people, fromMe: true, myName: s.myName });
      setDrafts(asks.map((a, i) => ({ ...draftFromAsk(a, i, 'rule'), source: src })));
    }
  };

  return (
    <div>
      <Hero
        eyebrow="Meeting"
        title={meeting.name}
        sub={attendees.length ? `With ${attendees.map((p) => p.name).join(', ')}` : 'Nobody added yet.'}
        actions={
          <>
            <a className="btn" href={href('meetings')}>
              All meetings
            </a>
            {!session && (
              <button type="button" className="btn btn-primary" onClick={start} data-testid="meeting-start">
                <Icon name="calendar" size={14} /> Start today's session
              </button>
            )}
          </>
        }
      />
      <div className="page page-narrow">
        <Section title={session ? 'Carried over from earlier sessions' : 'Agenda: open from earlier sessions'} count={ag.length}>
          <div className="list-card rows">
            {ag.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
            {!ag.length && <Empty title="Nothing carried over." />}
          </div>
        </Section>

        {session && (
          <>
            <Section title={`Today's actions, ${fmt.day(session.date)}`} count={added.length}>
              <div className="list-card overflow-visible">
                <QuickAdd
                  id="meeting"
                  autoFocus
                  source={{ kind: 'meeting', ref: meeting.name, meetingId: meeting.id, sessionId: session.id, date: session.date }}
                  offer={attendees}
                  placeholder="Type each action as it is agreed. Click a name below to make it theirs. Enter adds, and you can keep typing."
                />
                <div className="rows">
                  {added.map((i) => (
                    <ItemRow key={i.id} item={i} />
                  ))}
                </div>
              </div>
            </Section>
            <Section title="Notes">
              <CommitInput
                multiline
                className="textarea"
                value={session.notes ?? ''}
                placeholder={'Notes as you go. Lines like "Sam to send the cable schedule by Friday" can be turned into actions after.'}
                onCommit={(v) => actions.apply((d) => setSessionNotes(d, meeting.id, session.id, v))}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn btn-mini" disabled={!session.notes?.trim()} onClick={() => void findInNotes(false)}>
                  Find actions in the notes
                </button>
                {ai.on && (
                  <button type="button" className="btn btn-mini" disabled={!session.notes?.trim() || aiBusy} onClick={() => void findInNotes(true)}>
                    <Icon name="sparkle" size={12} /> {aiBusy ? (aiStatus.state === 'loading' ? `Loading ${Math.round(aiStatus.progress * 100)}%` : 'Reading…') : 'With the on-device model'}
                  </button>
                )}
              </div>
              {drafts && (
                <div className="mt-3">
                  <SuggestionList drafts={drafts} setDrafts={setDrafts} />
                </div>
              )}
            </Section>
            <Section title="Send the actions round">
              <div className="card flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={!outList.length}
                  onClick={() => void copyRich(rowsToText(rows), rowsToHtml(rows)).then((ok) => actions.toast(ok ? 'Copied as a table.' : 'Could not reach the clipboard.', ok ? 'info' : 'error'))}
                >
                  <Icon name="copy" size={14} /> Copy as table
                </button>
                {mailtoFits(emailDraft) ? (
                  <a className="btn" href={mailtoUrl(emailDraft)}>
                    <Icon name="mail" size={14} /> Email to attendees
                  </a>
                ) : (
                  <button type="button" className="btn" onClick={() => downloadFile(emlName(emailDraft), emlFile(emailDraft), 'message/rfc822')}>
                    <Icon name="mail" size={14} /> Email to attendees (.eml)
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={!outList.length}
                  onClick={async () => {
                    const { actionLogWorkbook } = await import('../../io/xlsx');
                    downloadFile(`${meeting.name} ${session.date}.xlsx`, actionLogWorkbook(rows, meeting.name), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    actions.toast('Downloaded the action log.', 'info');
                  }}
                >
                  <Icon name="download" size={14} /> Excel
                </button>
              </div>
            </Section>
          </>
        )}

        <Section title="Attendees">
          <div className="card flex flex-wrap gap-2">
            {[...doc.people]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <label key={p.id} className="check chip">
                  <input
                    type="checkbox"
                    checked={meeting.attendees.includes(p.id)}
                    onChange={(e) => actions.apply((d) => updateMeeting(d, meeting.id, { attendees: e.target.checked ? [...meeting.attendees, p.id] : meeting.attendees.filter((x) => x !== p.id) }))}
                  />
                  {p.name}
                </label>
              ))}
            {!doc.people.length && <span className="hint">Add people first, under People.</span>}
          </div>
        </Section>

        {past.length > 0 && (
          <Section title="Earlier sessions" count={past.length}>
            <div className="list-card">
              {past.map((x) => {
                const n = sessionItems(meeting, x.id, doc).length;
                return (
                  <button key={x.id} type="button" className="row w-full text-left" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }} onClick={() => setSessionId(x.id)}>
                    <span>
                      <span className="row-title">{fmt.day(x.date)}</span>
                      {x.notes && <span className="row-why block truncate">{x.notes.split('\n')[0]}</span>}
                    </span>
                    <span className="hint">
                      {n} action{n === 1 ? '' : 's'}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <div className="mt-8 flex items-center gap-3">
          <CommitInput className="input" value={meeting.name} onCommit={(v) => v.trim() && actions.apply((d) => updateMeeting(d, meeting.id, { name: v.trim() }))} ariaLabel="Rename the meeting" />
          <button
            type="button"
            className="btn btn-mini"
            onClick={() => {
              if (!window.confirm(`Remove ${meeting.name}? Its items stay in the ledger.`)) return;
              actions.apply((d) => removeMeeting(d, meeting.id), 'Removed the meeting.');
              navigate('meetings');
            }}
          >
            <Icon name="trash" size={13} /> Remove meeting
          </button>
        </div>
      </div>
    </div>
  );
}
