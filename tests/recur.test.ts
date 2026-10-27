import { describe, expect, it } from 'vitest';
import type { Calendar } from '../src/engine/dates';
import { describeRecurrence, findRecurrence, firstOccurrence, fullRule, nextOccurrence, occurrencesAfter, readRecurrence, ruleOf, shortRecurrence, upcomingDates } from '../src/engine/recur';
import type { Recurrence } from '../src/engine/types';

const CAL: Calendar = { workDays: [1, 2, 3, 4, 5], holidays: [] };
const week = (days: number[], every = 1, from?: string): Recurrence => ({ every, unit: 'week', days, ...(from ? { from } : {}) });

describe('the next occurrence', () => {
  it('comes a week on for a weekly schedule', () => {
    expect(nextOccurrence(week([5]), '2026-10-16', CAL)).toBe('2026-10-23');
  });
  it('keeps to its own day across a holiday instead of drifting to the day before', () => {
    const cal = { ...CAL, holidays: ['2026-11-26', '2026-11-27'] };
    // Thanksgiving: Friday 27 off, and Thursday 26, so that one is due on the Wednesday.
    expect(nextOccurrence(week([5]), '2026-11-20', cal)).toBe('2026-11-25');
    // And the one after it is a Friday again, not a Wednesday.
    expect(nextOccurrence(week([5]), '2026-11-25', cal)).toBe('2026-12-04');
  });
  it('falls on several days of the week', () => {
    expect(nextOccurrence(week([1, 4]), '2026-10-19', CAL)).toBe('2026-10-22');
    expect(nextOccurrence(week([1, 4]), '2026-10-22', CAL)).toBe('2026-10-26');
  });
  it('keeps every other week to its own weeks, even when one was moved', () => {
    const fortnight = week([2], 2, '2026-10-13');
    expect(nextOccurrence(fortnight, '2026-10-13', CAL)).toBe('2026-10-27');
    // That one was put off to the Thursday; the next is still a fortnight from its Tuesday.
    expect(nextOccurrence(fortnight, '2026-10-29', CAL)).toBe('2026-11-10');
  });
  it('holds a monthly day, short months and weekends included', () => {
    const r: Recurrence = { every: 1, unit: 'month', monthDay: 31 };
    // 31 October is a Saturday: due Friday 30. Then 30 November, 31 December, and
    // 31 January 2027 is a Sunday: Friday 29.
    expect(firstOccurrence(r, '2026-10-15', CAL)).toBe('2026-10-30');
    expect(occurrencesAfter(r, '2026-10-30', '2027-02-28', CAL)).toEqual(['2026-11-30', '2026-12-31', '2027-01-29', '2027-02-26']);
  });
  it('finds the last working day of the month', () => {
    const r: Recurrence = { every: 1, unit: 'month', monthDay: -1 };
    expect(firstOccurrence(r, '2026-10-15', CAL)).toBe('2026-10-30');
    expect(occurrencesAfter(r, '2026-10-30', '2027-01-31', CAL)).toEqual(['2026-11-30', '2026-12-31', '2027-01-29']);
    expect(firstOccurrence(r, '2026-12-01', { ...CAL, holidays: ['2026-12-31'] })).toBe('2026-12-30');
  });
  it('finds the first Monday and the last Friday', () => {
    expect(occurrencesAfter({ every: 1, unit: 'month', nth: 1, days: [1] }, '2026-10-15', '2026-12-31', CAL)).toEqual(['2026-11-02', '2026-12-07']);
    expect(occurrencesAfter({ every: 1, unit: 'month', nth: -1, days: [5] }, '2026-10-15', '2026-11-30', CAL)).toEqual(['2026-10-30', '2026-11-27']);
  });
  it('counts every few months from where it started', () => {
    expect(nextOccurrence({ every: 3, unit: 'month', monthDay: 15, from: '2026-10-15' }, '2026-10-15', CAL)).toBe('2027-01-15');
  });
  it('steps over weekends and holidays when it counts working days', () => {
    const daily: Recurrence = { every: 1, unit: 'day' };
    expect(nextOccurrence(daily, '2026-10-16', CAL)).toBe('2026-10-19');
    expect(nextOccurrence(daily, '2026-10-16', { ...CAL, holidays: ['2026-10-19'] })).toBe('2026-10-20');
    // Catching up to today keeps the beat of every second working day.
    expect(nextOccurrence({ every: 2, unit: 'day' }, '2026-10-12', CAL, '2026-10-15')).toBe('2026-10-16');
  });
  it('ends on its last day', () => {
    const r: Recurrence = { ...week([5]), until: '2026-10-30' };
    expect(nextOccurrence(r, '2026-10-23', CAL)).toBe('2026-10-30');
    expect(nextOccurrence(r, '2026-10-30', CAL)).toBeNull();
  });
  it('after a late one, skips to the first still to come', () => {
    expect(nextOccurrence(week([5]), '2026-10-02', CAL, '2026-10-15')).toBe('2026-10-16');
    // On the day itself, that day's is still to do.
    expect(nextOccurrence(week([5]), '2026-10-09', CAL, '2026-10-16')).toBe('2026-10-16');
  });
  it('starts on the first day of the schedule from a given day, that day included', () => {
    expect(firstOccurrence(week([5]), '2026-10-15', CAL)).toBe('2026-10-16');
    expect(firstOccurrence(week([5]), '2026-10-16', CAL)).toBe('2026-10-16');
    // A Monday that is a holiday is due the Friday before, which has gone: the next Monday.
    expect(firstOccurrence(week([1]), '2026-10-19', { ...CAL, holidays: ['2026-10-19'] })).toBe('2026-10-26');
    expect(upcomingDates(week([5], 2, '2026-10-15'), '2026-10-15', CAL, 3)).toEqual(['2026-10-16', '2026-10-30', '2026-11-13']);
  });
  it('reads an old file\'s schedule from the date it was due', () => {
    const rule = ruleOf({ recur: { every: 1, unit: 'week' }, due: '2026-10-16', askedOn: '2026-10-01' })!;
    expect(rule).toMatchObject({ days: [5], from: '2026-10-16' });
    expect(fullRule({ every: 1, unit: 'month' }, '2026-10-05')).toMatchObject({ monthDay: 5 });
  });
});

describe('a schedule in words', () => {
  const say = (r: Recurrence) => describeRecurrence(r);
  it('says it the way a person would', () => {
    expect(say({ every: 1, unit: 'day' })).toBe('Every working day');
    expect(say({ every: 3, unit: 'day' })).toBe('Every 3 working days');
    expect(say(week([5]))).toBe('Every Friday');
    expect(say(week([1, 4]))).toBe('Every Monday and Thursday');
    expect(say(week([5, 1, 3]))).toBe('Every Mon, Wed and Fri');
    expect(say(week([1, 2, 3, 4, 5]))).toBe('Every weekday');
    expect(say(week([2], 2))).toBe('Every other Tuesday');
    expect(say(week([1], 3))).toBe('Every 3 weeks on Monday');
    expect(say({ every: 1, unit: 'week' })).toBe('Every week');
    expect(say({ every: 1, unit: 'month', monthDay: 15 })).toBe('Monthly on the 15th');
    expect(say({ every: 1, unit: 'month', monthDay: -1 })).toBe('Monthly on the last working day');
    expect(say({ every: 1, unit: 'month', nth: 1, days: [1] })).toBe('Monthly on the first Monday');
    expect(say({ every: 3, unit: 'month', monthDay: 1 })).toBe('Every 3 months on the 1st');
    expect(say({ every: 12, unit: 'month', monthDay: 22, from: '2026-10-22' })).toBe('Every year on the 22nd of October');
    expect(describeRecurrence({ ...week([5]), until: '2026-12-18' }, { order: 'MDY', today: '2026-10-15' })).toBe('Every Friday, until Fri 12/18');
  });
  it('and in a few characters for a row', () => {
    expect(shortRecurrence(week([5]))).toBe('Every Fri');
    expect(shortRecurrence(week([1, 3, 5]))).toBe('Every Mon, Wed, Fri');
    expect(shortRecurrence({ every: 1, unit: 'month', monthDay: -1 })).toBe('Monthly, last working day');
    expect(shortRecurrence({ every: 1, unit: 'month', nth: 2, days: [2] })).toBe('Monthly, 2nd Tue');
  });
});

describe('a schedule read from what was typed', () => {
  const read = (text: string) => findRecurrence(text);
  it.each([
    ['timesheet every friday', { every: 1, unit: 'week', days: [5] }, 'every friday'],
    ['status each Mon and Thu', { every: 1, unit: 'week', days: [1, 4] }, 'each Mon and Thu'],
    ['standup every mon, wed & fri', { every: 1, unit: 'week', days: [1, 3, 5] }, 'every mon, wed & fri'],
    ['catch-up every other tuesday', { every: 2, unit: 'week', days: [2] }, 'every other tuesday'],
    ['look-ahead every 2 weeks on thursdays', { every: 2, unit: 'week', days: [4] }, 'every 2 weeks on thursdays'],
    ['report every second week', { every: 2, unit: 'week' }, 'every second week'],
    ['site diary every working day', { every: 1, unit: 'day' }, 'every working day'],
    ['notes every weekday', { every: 1, unit: 'day' }, 'every weekday'],
    ['backup every 3 days', { every: 3, unit: 'day' }, 'every 3 days'],
    ['invoice every month on the 15th', { every: 1, unit: 'month', monthDay: 15 }, 'every month on the 15th'],
    ['invoice every 15th of the month', { every: 1, unit: 'month', monthDay: 15 }, 'every 15th of the month'],
    ['return every month end', { every: 1, unit: 'month', monthDay: -1 }, 'every month end'],
    ['return every month-end', { every: 1, unit: 'month', monthDay: -1 }, 'every month-end'],
    ['report every last working day', { every: 1, unit: 'month', monthDay: -1 }, 'every last working day'],
    ['meeting every first monday', { every: 1, unit: 'month', nth: 1, days: [1] }, 'every first monday'],
    ['patch every 2nd tuesday', { every: 1, unit: 'month', nth: 2, days: [2] }, 'every 2nd tuesday'],
    ['review the last friday of every month', { every: 1, unit: 'month', nth: -1, days: [5] }, 'the last friday of every month'],
    ['pay rent on the 1st of each month', { every: 1, unit: 'month', monthDay: 1 }, 'on the 1st of each month'],
    ['audit every quarter', { every: 3, unit: 'month' }, 'every quarter'],
    ['audit every 3 months on the 1st', { every: 3, unit: 'month', monthDay: 1 }, 'every 3 months on the 1st'],
    ['renewal every year', { every: 12, unit: 'month' }, 'every year'],
  ])('%s', (text, recur, words) => {
    const m = read(text)!;
    expect(m.recur).toEqual(recur);
    expect(m.text).toBe(words);
    expect(text.slice(m.index, m.index + m.text.length)).toBe(words);
  });
  it('leaves a title alone', () => {
    for (const t of ['Weekly report to BART', 'Monthly invoice', 'Check each drawing', 'Every time Sam calls', 'every 2', 'every first']) expect(read(t)).toBeNull();
  });
});

describe('a schedule read from a file', () => {
  it('keeps what makes sense and drops the rest', () => {
    expect(readRecurrence({ every: 1, unit: 'week' })).toEqual({ every: 1, unit: 'week' });
    expect(readRecurrence({ every: 2, unit: 'week', days: [5, 1, 9, 'x'], until: '2026-12-18', from: 'soon' })).toEqual({ every: 2, unit: 'week', days: [1, 5], until: '2026-12-18' });
    expect(readRecurrence({ every: 1, unit: 'month', nth: 7, monthDay: -1, catchUp: 'yes' })).toEqual({ every: 1, unit: 'month', monthDay: -1 });
    expect(readRecurrence({ every: 0, unit: 'month', nth: -1, days: [5] })).toEqual({ every: 1, unit: 'month', nth: -1, days: [5] });
    expect(readRecurrence({ every: 1, unit: 'fortnight' })).toBeUndefined();
    expect(readRecurrence('weekly')).toBeUndefined();
  });
});
