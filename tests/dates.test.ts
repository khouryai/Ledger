import { describe, expect, it } from 'vitest';
import { addWorkingDays, endOfWeek, findDate, fmtDay, parseDateInput, weekday, workingDaysBetween, type Calendar } from '../src/engine/dates';

const cal: Calendar = { workDays: [1, 2, 3, 4, 5], holidays: ['2026-11-26'] };
const THU = '2026-10-15';

describe('working days', () => {
  it('knows the weekday', () => {
    expect(weekday('2026-10-15')).toBe(4);
    expect(weekday('2026-10-18')).toBe(0);
  });
  it('counts the working days after the start, up to and including the end', () => {
    expect(workingDaysBetween('2026-10-12', '2026-10-13', cal)).toBe(1);
    expect(workingDaysBetween('2026-10-16', '2026-10-19', cal)).toBe(1);
    expect(workingDaysBetween('2026-10-12', '2026-10-19', cal)).toBe(5);
    expect(workingDaysBetween('2026-10-19', '2026-10-12', cal)).toBe(-5);
    expect(workingDaysBetween(THU, THU, cal)).toBe(0);
  });
  it('skips weekends and holidays when adding', () => {
    expect(addWorkingDays('2026-10-16', 1, cal)).toBe('2026-10-19');
    expect(addWorkingDays('2026-11-25', 1, cal)).toBe('2026-11-27');
    expect(addWorkingDays('2026-10-19', -1, cal)).toBe('2026-10-16');
    expect(addWorkingDays('2026-10-17', 0, cal)).toBe('2026-10-19');
  });
  it('finds the end of the week', () => {
    expect(endOfWeek(THU, cal)).toBe('2026-10-16');
  });
});

describe('date phrases', () => {
  const f = (s: string) => findDate(s, THU, cal, 'MDY')?.day;
  it('reads weekdays as the next one', () => {
    expect(f('report fri')).toBe('2026-10-16');
    expect(f('by monday')).toBe('2026-10-19');
    expect(f('thursday')).toBe('2026-10-22');
  });
  it('reads "next Friday" on a Thursday as the Friday of next week', () => {
    expect(f('next fri')).toBe('2026-10-23');
    expect(f('next monday')).toBe('2026-10-19');
  });
  it('reads relative phrases', () => {
    expect(f('tomorrow')).toBe('2026-10-16');
    expect(f('eod')).toBe(THU);
    expect(f('end of next week')).toBe('2026-10-23');
    expect(f('eow')).toBe('2026-10-16');
    expect(f('in 3 days')).toBe('2026-10-18');
    expect(f('in 3 working days')).toBe('2026-10-20');
    expect(f('+2w')).toBe('2026-10-29');
    expect(f('end of month')).toBe('2026-10-30');
  });
  it('reads numeric dates in the configured order', () => {
    expect(f('due 11/14')).toBe('2026-11-14');
    expect(findDate('due 14/11', THU, cal, 'DMY')?.day).toBe('2026-11-14');
    expect(f('2026-12-01')).toBe('2026-12-01');
    expect(f('on 1/5')).toBe('2027-01-05');
  });
  it('does not read a version number as a date', () => {
    expect(f('rev 1.5 of the procedure')).toBeUndefined();
    expect(f('14.11.2026')).toBe('2026-11-14');
  });
  it('reads month names', () => {
    expect(f('Nov 14')).toBe('2026-11-14');
    expect(f('14th November')).toBe('2026-11-14');
    expect(f('by sept 3 2027')).toBe('2027-09-03');
  });
  it('does not see weekdays inside other words', () => {
    expect(f('monitor the wedding satisfied')).toBeUndefined();
  });
  it('parses a whole input or nothing', () => {
    expect(parseDateInput('fri', THU, cal)).toBe('2026-10-16');
    expect(parseDateInput('by 11/2', THU, cal)).toBe('2026-11-02');
    expect(parseDateInput('the report', THU, cal)).toBeNull();
  });
  it('formats in the user order', () => {
    expect(fmtDay('2026-10-30', 'MDY', THU)).toBe('Fri 10/30');
    expect(fmtDay('2026-10-30', 'DMY', THU)).toBe('Fri 30/10');
    expect(fmtDay('2027-01-04', 'MDY', THU)).toBe('Mon 1/4/27');
  });
});
