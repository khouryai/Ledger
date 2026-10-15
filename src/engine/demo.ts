/**
 * Sample data for looking around without saving anything: a handful of people and a
 * fortnight's worth of the kind of items a commissioning manager carries. Built
 * relative to today so it always reads as current.
 */
import { addWorkingDays, toDay, type Calendar } from './dates';
import { emptyDoc } from './doc';
import { addItem, addMeeting, addPerson, chase, complete, link, openSession, recordPromise } from './ops';
import type { LedgerDoc } from './types';

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
  add('Timesheet', 'owe', { due: wd(1), recur: { every: 1, unit: 'week' } }, at(wd(-1)));
  add('Review IXL test procedure comments', 'owe', { personId: people.jordan, askedOn: wd(-2), due: wd(6), tags: ['IXL'] }, at(wd(-2)));

  const m = addMeeting(doc, { name: 'BART weekly progress', attendees: [people.priya, people.maria, people.sam], recurring: true }, now);
  doc = m.doc;
  const s = openSession(doc, m.meeting.id, wd(-5), at(wd(-5)));
  doc = s.doc;
  add('Confirm the possession dates for November', 'wait', { personId: people.maria, askedOn: wd(-5), source: { kind: 'meeting', ref: 'BART weekly progress', meetingId: m.meeting.id, sessionId: s.sessionId } }, at(wd(-5)));
  return doc;
}
