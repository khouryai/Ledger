import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/engine/quickadd';
import { docWith, TODAY } from './helpers';

const doc = docWith(['Sam Lee', 'Priya Shah', 'Sam Ortiz', 'Jordan Wu']);
const ctx = { today: TODAY, cal: { workDays: [1, 2, 3, 4, 5], holidays: [] }, order: 'MDY' as const, people: doc.people, direction: 'wait' as const };

describe('quick-add', () => {
  it('reads person, title, date and tag', () => {
    const q = parseQuickAdd('@Priya ATS report rev B fri #BART', ctx);
    expect(q.title).toBe('ATS report rev B');
    expect(q.person).toMatchObject({ kind: 'one', person: { name: 'Priya Shah' } });
    expect(q.due).toBe('2026-10-16');
    expect(q.tags).toEqual(['BART']);
    expect(q.direction).toBe('wait');
  });
  it('asks which Sam when there are two', () => {
    const q = parseQuickAdd('@Sam cable schedule', ctx);
    expect(q.person?.kind).toBe('many');
  });
  it('matches a full name in quotes and a handle', () => {
    expect(parseQuickAdd('@"Sam Ortiz" x', ctx).person).toMatchObject({ kind: 'one', person: { name: 'Sam Ortiz' } });
    expect(parseQuickAdd('@sam_lee x', ctx).person).toMatchObject({ kind: 'one', person: { name: 'Sam Lee' } });
  });
  it('offers a new person for an unknown name', () => {
    expect(parseQuickAdd('@morgan_hale drawings', ctx).person).toEqual({ kind: 'new', name: 'Morgan Hale' });
  });
  it('takes "by" off with the date', () => {
    const q = parseQuickAdd('Send IXL test plan to BART by next tue', ctx);
    expect(q.title).toBe('Send IXL test plan to BART');
    expect(q.due).toBe('2026-10-20');
  });
  it('reads when it was asked', () => {
    const q = parseQuickAdd('@Jordan possession times since monday', ctx);
    expect(q.askedOn).toBe('2026-10-12');
    expect(q.title).toBe('Possession times');
  });
  it('reads a date in the past for asked, not next year', () => {
    expect(parseQuickAdd('@Jordan thing asked 9/1', ctx).askedOn).toBe('2026-09-01');
  });
  it('reads direction prefixes', () => {
    expect(parseQuickAdd('owe: monthly report', ctx).direction).toBe('owe');
    expect(parseQuickAdd('wait: drawings', { ...ctx, direction: 'owe' }).direction).toBe('wait');
  });
  it('reads recurrence', () => {
    const q = parseQuickAdd('owe: timesheet every friday', ctx);
    expect(q.recur).toEqual({ every: 1, unit: 'week' });
    expect(q.due).toBe('2026-10-16');
    expect(q.title).toBe('Timesheet');
    expect(parseQuickAdd('monthly report every month by 11/5', ctx).recur).toEqual({ every: 1, unit: 'month' });
  });
  it('returns every token it read, for the chips', () => {
    const q = parseQuickAdd('@Priya ATS report fri #BART', ctx);
    expect(q.tokens.map((t) => t.kind).sort()).toEqual(['due', 'person', 'tag']);
  });
});
