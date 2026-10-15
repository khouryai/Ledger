import { describe, expect, it } from 'vitest';
import { findAsks } from '../src/engine/asks';
import { docWith, TODAY } from './helpers';

const doc = docWith(['Sam Lee', 'Priya Shah']);
const base = { today: TODAY, cal: { workDays: [1, 2, 3, 4, 5], holidays: [] }, order: 'MDY' as const, people: doc.people, myName: 'Alex Khoury' };

describe('finding asks', () => {
  it('reads a request from someone else as something I owe them', () => {
    const asks = findAsks('Hi Alex,\n\nCould you please send the IXL test plan by Friday? Thanks for yesterday.\n\nRegards,\nSam', {
      ...base,
      fromMe: false,
      sender: { name: 'Sam Lee', email: 'sam.lee@example.com' },
    });
    expect(asks.length).toBe(1);
    expect(asks[0]).toMatchObject({ kind: 'request', direction: 'owe', title: 'Send the IXL test plan', due: '2026-10-16', personName: 'Sam Lee' });
    expect(asks[0].match).toMatchObject({ kind: 'one', how: 'email' });
  });
  it('reads a promise from someone else as something I wait on', () => {
    const asks = findAsks("I'll send the revised ATS report next Tuesday.", { ...base, fromMe: false, sender: { name: 'Sam Lee' } });
    expect(asks[0]).toMatchObject({ kind: 'promise', direction: 'wait', due: '2026-10-20' });
    expect(asks[0].title).toBe('Send the revised ATS report');
  });
  it('reverses both when I wrote it', () => {
    const asks = findAsks('Priya, can you confirm the possession times by 10/20? I will update the look-ahead tomorrow.', {
      ...base,
      fromMe: true,
      recipient: { name: 'Priya Shah' },
    });
    expect(asks.map((a) => [a.kind, a.direction])).toEqual([
      ['request', 'wait'],
      ['promise', 'owe'],
    ]);
  });
  it('reads meeting-note action lines with their owners', () => {
    const notes = ['Attendees: Sam, Priya', '- Sam to send the cable schedule by 10/22', 'Action: Priya - update the ICD', 'AP me: book the possession', 'Need to confirm the radio survey'].join('\n');
    const asks = findAsks(notes, { ...base, fromMe: true });
    expect(asks.map((a) => [a.title, a.direction, a.personName])).toEqual([
      ['Send the cable schedule', 'wait', 'Sam'],
      ['Update the ICD', 'wait', 'Priya'],
      ['Book the possession', 'owe', undefined],
    ]);
    expect(asks[0].due).toBe('2026-10-22');
  });
  it('ignores pleasantries and the signature', () => {
    expect(findAsks('Thanks for the update.\n\nRegards,\nSam\nPlease consider the environment before printing', { ...base, fromMe: false, sender: { name: 'Sam Lee' } })).toEqual([]);
  });
});
