import { describe, expect, it } from 'vitest';
import { cleanName, matchPerson, parseAddressList } from '../src/engine/people';
import { docWith } from './helpers';

describe('address lines', () => {
  it('reads an Outlook To: line', () => {
    expect(parseAddressList('To: Sam Lee <sam.lee@x.com>; "Doe, Jane" <JANE@x.com>; bob.smith@x.com; Priya Shah')).toEqual([
      { name: 'Sam Lee', email: 'sam.lee@x.com' },
      { name: 'Jane Doe', email: 'jane@x.com' },
      { name: 'Bob Smith', email: 'bob.smith@x.com' },
      { name: 'Priya Shah' },
    ]);
  });
  it('keeps "Last, First" together and splits real commas', () => {
    expect(parseAddressList('Lee, Sam')).toEqual([{ name: 'Sam Lee' }]);
    expect(parseAddressList('a@x.com, b@x.com').length).toBe(2);
  });
  it('cleans names', () => {
    expect(cleanName('"Shah, Priya (External)"')).toBe('Priya Shah');
  });
});

describe('matching people', () => {
  const doc = docWith(['Sam Lee', 'Sam Ortiz', 'Priya Shah']);
  it('matches by email first', () => {
    expect(matchPerson(doc.people, { name: 'Whoever', email: 'PRIYA.SHAH@example.com' })).toMatchObject({ kind: 'one', how: 'email' });
  });
  it('never picks between two of the same first name', () => {
    expect(matchPerson(doc.people, { name: 'Sam' }).kind).toBe('many');
    expect(matchPerson(doc.people, { name: 'Priya' })).toMatchObject({ kind: 'one', how: 'first' });
  });
  it('matches a full name regardless of case and accents', () => {
    expect(matchPerson(doc.people, { name: 'sám lee' })).toMatchObject({ kind: 'one', how: 'name' });
  });
  it('returns none for a stranger', () => {
    expect(matchPerson(doc.people, { name: 'Morgan' }).kind).toBe('none');
  });
});
