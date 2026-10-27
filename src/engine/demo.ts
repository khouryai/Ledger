/**
 * Sample data for looking around without saving anything: a handful of people and a
 * fortnight's worth of the kind of items a commissioning manager carries. Built
 * relative to today so it always reads as current.
 */
import { addDays, addMonths, addWorkingDays, toDay, type Calendar } from './dates';
import { emptyDoc, newId } from './doc';
import { addItem, addMeeting, addPerson, chase, complete, link, openSession, recordPromise, skip, type ItemDraft } from './ops';
import { firstOccurrence, fullRule } from './recur';
import type { Day, LedgerDoc, Recurrence } from './types';

function at(day: string, hour = 10): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0);
}

export function demoDoc(now = new Date()): LedgerDoc {
  const today = toDay(now);
  const cal: Calendar = { workDays: [1, 2, 3, 4, 5], holidays: [] };
  const wd = (n: number) => addWorkingDays(today, n, cal);
  let doc = emptyDoc(now);
  doc = { ...doc, settings: { ...doc.settings, myName: 'Alex Khoury', myEmail: 'alex.khoury@example.com' } };

  const people: Record<string, string> = {};
  for (const [key, name, company, role] of [
    ['sam', 'Sam Lee', 'Hitachi Rail', 'Systems engineer'],
    ['priya', 'Priya Shah', 'BART', 'Signals reviewer'],
    ['jordan', 'Jordan Wu', 'Hitachi Rail', 'IXL lead'],
    ['maria', 'Maria Lopez', 'BART', 'Operations'],
    ['dev', 'Dev Patel', 'Hitachi Rail', 'Radio engineer'],
  ] as const) {
    const r = addPerson(doc, { name, email: `${name.toLowerCase().replace(' ', '.')}@example.com`, company, role }, now);
    doc = r.doc;
    people[key] = r.person.id;
  }

  // Five closed items with Sam, so his record has something to say.
  for (let i = 0; i < 5; i++) {
    const asked = wd(-40 + i * 6);
    const r = addItem(doc, { title: `Weekly regression results ${i + 1}`, direction: 'wait', personId: people.sam, askedOn: asked, due: addWorkingDays(asked, 3, cal) }, at(asked));
    doc = chase(r.doc, [r.item.id], 'nudge', 'email', at(addWorkingDays(asked, 4, cal)));
    doc = complete(doc, r.item.id, undefined, at(addWorkingDays(asked, 5, cal))).doc;
  }

  const add = (title: string, direction: 'owe' | 'wait', opts: Partial<Parameters<typeof addItem>[1]> = {}, when = now) => {
    const r = addItem(doc, { title, direction, ...opts }, when);
    doc = r.doc;
    return r.item;
  };

  const input = add('Revised ATS test report, rev C', 'wait', { personId: people.sam, askedOn: wd(-6), due: wd(1), source: { kind: 'email', ref: 'ATS test report rev C' }, tags: ['ATS'] }, at(wd(-6)));
  const report = add('Phase 2 test summary to BART', 'owe', { personId: people.priya, askedOn: wd(-5), due: wd(3), tags: ['BART'] }, at(wd(-5)));
  doc = link(doc, report.id, input.id, now);
  add('Cable schedule for HTT interlocking', 'wait', { personId: people.jordan, askedOn: wd(-9), tags: ['IXL'] }, at(wd(-9)));
  const old = add('Radio survey results', 'wait', { personId: people.dev, askedOn: wd(-22), tags: ['Radio'] }, at(wd(-22)));
  doc = chase(doc, [old.id], 'nudge', 'email', at(wd(-15)));
  doc = chase(doc, [old.id], 'firm', 'email', at(wd(-8)));
  add('Comments on the possession plan', 'owe', { personId: people.maria, askedOn: wd(-3), due: wd(-1), tags: ['BART'] }, at(wd(-3)));
  const promised = add('Signed TAWR for Saturday', 'wait', { personId: people.maria, askedOn: wd(-4) }, at(wd(-4)));
  doc = recordPromise(doc, promised.id, wd(-1), 'Said she would sign it Monday', at(wd(-2)));
  /**
   * A recurring item with some weeks behind it: an occurrence from `start`, each one
   * closed as `hows` says (on time, two working days late, or skipped), then the one
   * in hand. Nothing is closed after today, and the one in hand is never left overdue,
   * so the sample reads the same whatever day it is opened.
   */
  const routine = (draft: Omit<ItemDraft, 'recur'>, recur: Recurrence, start: Day, hows: ('done' | 'late' | 'skip')[]) => {
    const rule = fullRule(recur, start);
    const r = addItem(doc, { ...draft, recur: rule, due: firstOccurrence(rule, start, cal)! }, at(start, 8));
    doc = r.doc;
    let cur = r.item;
    const close = (how: 'done' | 'late' | 'skip') => {
      const when = how === 'late' ? addWorkingDays(cur.due!, 2, cal) : cur.due!;
      if (when > today) return false;
      const c = how === 'skip' ? skip(doc, cur.id, at(when, 8)) : complete(doc, cur.id, undefined, at(when, 8));
      doc = c.doc;
      if (c.spawned) cur = c.spawned;
      return !!c.spawned;
    };
    for (const how of hows) if (!close(how)) break;
    for (let i = 0; i < 20 && cur.due! < today && close('done'); i++);
  };
  const steps = (...texts: string[]) => texts.map((text) => ({ id: newId('st', now.getTime()), text, done: false }));
  routine({ title: 'Timesheet', direction: 'owe', notes: 'Cost code 4410 for BART, 4420 for everything else.' }, { every: 1, unit: 'week', days: [5] }, addDays(today, -21), ['done', 'late', 'done']);
  add('Review IXL test procedure comments', 'owe', { personId: people.jordan, askedOn: wd(-2), due: wd(6), tags: ['IXL'] }, at(wd(-2)));

  const m = addMeeting(doc, { name: 'BART weekly progress', attendees: [people.priya, people.maria, people.sam], recurring: true }, now);
  doc = m.doc;
  const s = openSession(doc, m.meeting.id, wd(-5), at(wd(-5)));
  doc = s.doc;
  add('Confirm the possession dates for November', 'wait', { personId: people.maria, askedOn: wd(-5), source: { kind: 'meeting', ref: 'BART weekly progress', meetingId: m.meeting.id, sessionId: s.sessionId } }, at(wd(-5)));

  routine({ title: 'Site diary', direction: 'owe' }, { every: 1, unit: 'day' }, wd(-5), ['done', 'done', 'done', 'skip', 'done']);
  routine(
    { title: 'Weekly progress report to BART', direction: 'owe', personId: people.priya, tags: ['BART'], steps: steps('Collect the test results', 'Update the look-ahead', 'Send to Priya') },
    { every: 1, unit: 'week', days: [1] },
    addDays(today, -21),
    ['done', 'done', 'late'],
  );
  routine({ title: 'Radio test log', direction: 'wait', personId: people.dev, tags: ['Radio'] }, { every: 1, unit: 'week', days: [4] }, addDays(today, -21), ['done', 'late', 'done']);
  routine(
    { title: 'Monthly progress report', direction: 'owe', personId: people.maria, steps: steps("Pull the month's figures", 'Draft', 'Send to Maria') },
    { every: 1, unit: 'month', monthDay: -1 },
    addMonths(today, -2),
    ['done', 'done'],
  );
  routine({ title: 'Two-week look-ahead', direction: 'owe', personId: people.jordan, tags: ['IXL'] }, { every: 2, unit: 'week', days: [3] }, addDays(today, -28), ['done', 'late']);
  return doc;
}
