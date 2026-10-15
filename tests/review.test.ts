import { describe, expect, it } from 'vitest';
import { makeCtx } from '../src/engine/decide';
import { complete } from '../src/engine/ops';
import { agenda, filterItems, reviewDue, reviewQueue, weekSummary, weekSummaryText } from '../src/engine/review';
import { add, at, docWith, pid, TODAY } from './helpers';
import { addMeeting } from '../src/engine/ops';

describe('weekly review', () => {
  it('queues items untouched for a week, oldest first', () => {
    let doc = docWith();
    doc = add(doc, { title: 'old', askedOn: '2026-09-20' }, at('2026-09-20')).doc;
    doc = add(doc, { title: 'older', askedOn: '2026-09-01' }, at('2026-09-01')).doc;
    doc = add(doc, { title: 'fresh' }).doc;
    expect(reviewQueue(makeCtx(doc, TODAY)).map((i) => i.title)).toEqual(['older', 'old']);
  });
  it('is due on Friday until it is done that week', () => {
    const doc = docWith();
    expect(reviewDue(doc, '2026-10-15')).toBe(false);
    expect(reviewDue(doc, '2026-10-16')).toBe(true);
    expect(reviewDue({ ...doc, settings: { ...doc.settings, review: { ...doc.settings.review, lastDone: '2026-10-16' } } }, '2026-10-16')).toBe(false);
  });
  it('summarises the week', () => {
    let doc = docWith();
    const a = add(doc, { title: 'Report', direction: 'owe', due: '2026-10-14' }, at('2026-10-12'));
    const b = add(a.doc, { title: 'Drawings', personId: pid(doc, 'Sam'), askedOn: '2026-09-01' }, at('2026-09-01'));
    const c = add(b.doc, { title: 'Quote', personId: pid(doc, 'Priya') }, at('2026-10-13'));
    doc = complete(c.doc, c.item.id, undefined, at('2026-10-14')).doc;
    const s = weekSummary(makeCtx(doc, TODAY));
    expect(s.opened.map((i) => i.title).sort()).toEqual(['Quote', 'Report']);
    expect(s.received.map((i) => i.title)).toEqual(['Quote']);
    expect(s.overdue.map((i) => i.title)).toEqual(['Report']);
    expect(s.oldestWaiting!.item.title).toBe('Drawings');
    const text = weekSummaryText(s, makeCtx(doc, TODAY));
    expect(text).toContain('Most outstanding: Sam Lee (1)');
  });
});

describe('meetings and filters', () => {
  it('builds the next agenda from earlier sessions', () => {
    let doc = docWith();
    const m = addMeeting(doc, { name: 'BART weekly', attendees: [pid(doc, 'Sam')], recurring: true }, at(TODAY));
    doc = m.doc;
    doc = add(doc, { title: 'From last week', source: { kind: 'meeting', meetingId: m.meeting.id, sessionId: 's1' } }).doc;
    doc = add(doc, { title: 'From today', source: { kind: 'meeting', meetingId: m.meeting.id, sessionId: 's2' } }).doc;
    expect(agenda(m.meeting, doc, 's2').map((i) => i.title)).toEqual(['From last week']);
  });
  it('filters by direction, person and words', () => {
    let doc = docWith();
    doc = add(doc, { title: 'ATS report', personId: pid(doc, 'Sam'), tags: ['BART'] }).doc;
    doc = add(doc, { title: 'IXL plan', direction: 'owe' }).doc;
    const ctx = makeCtx(doc, TODAY);
    expect(filterItems(ctx, { direction: 'wait' }).map((i) => i.title)).toEqual(['ATS report']);
    expect(filterItems(ctx, { query: 'sam bart' }).map((i) => i.title)).toEqual(['ATS report']);
    expect(filterItems(ctx, { query: '#2' }).map((i) => i.title)).toEqual(['IXL plan']);
  });
});
