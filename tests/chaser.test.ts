import { describe, expect, it } from 'vitest';
import { draftChase, emlFile, mailtoFits, mailtoUrl, renderTemplate } from '../src/engine/chaser';
import { updatePerson } from '../src/engine/ops';
import { add, docWith, pid, TODAY } from './helpers';

const cal = { workDays: [1, 2, 3, 4, 5], holidays: [] };

describe('templates', () => {
  it('drops a line whose placeholders are all empty', () => {
    expect(renderTemplate('Hi {first},\nDue {promised}.\nThanks', { first: 'Sam', promised: '' })).toBe('Hi Sam,\nThanks');
  });
  it('keeps literal braces-free lines', () => {
    expect(renderTemplate('Hello\n\n\n\nBye', {})).toBe('Hello\n\nBye');
  });
});

describe('chasers', () => {
  it('drafts a nudge with the original subject and the promise', () => {
    const doc = docWith();
    const { item, doc: d2 } = add(doc, { title: 'ATS test report', personId: pid(doc, 'Sam'), askedOn: '2026-10-05', due: '2026-10-12', source: { kind: 'email', ref: 'ATS test report rev B' } });
    const p = d2.people.find((x) => x.id === item.personId)!;
    const d = draftChase({ items: [item], person: p, level: 'nudge', settings: d2.settings, today: TODAY, cal });
    expect(d.to).toEqual(['Sam Lee <sam.lee@example.com>']);
    expect(d.subject).toBe('RE: ATS test report rev B');
    expect(d.body).toContain('Hi Sam,');
    expect(d.body).toContain('ATS test report, which I asked about on 5 Oct 2026');
    expect(d.body).toContain('by 12 Oct 2026');
    expect(d.body).toContain('Alex Khoury');
  });
  it('copies the escalation contact and drops the line when there is none', () => {
    let doc = docWith();
    const { item, doc: d2 } = add(doc, { title: 'Cable schedule', personId: pid(doc, 'Sam') });
    let p = d2.people.find((x) => x.id === item.personId)!;
    let d = draftChase({ items: [item], person: p, level: 'escalate', settings: d2.settings, today: TODAY, cal });
    expect(d.cc).toEqual([]);
    expect(d.body).not.toContain('copied');
    doc = updatePerson(d2, p.id, { escalateTo: { name: 'Jo Manager', email: 'jo@example.com' } });
    p = doc.people.find((x) => x.id === item.personId)!;
    d = draftChase({ items: [item], person: p, level: 'escalate', settings: doc.settings, today: TODAY, cal });
    expect(d.cc).toEqual(['Jo Manager <jo@example.com>']);
    expect(d.body).toContain('I have copied Jo Manager');
  });
  it('rounds up several items into one email', () => {
    const doc = docWith();
    const a = add(doc, { title: 'One', personId: pid(doc, 'Sam'), askedOn: '2026-10-01' });
    const b = add(a.doc, { title: 'Two', personId: pid(doc, 'Sam'), askedOn: '2026-10-02', due: '2026-10-09' });
    const p = b.doc.people.find((x) => x.id === a.item.personId)!;
    const d = draftChase({ items: [a.item, b.item], person: p, level: 'nudge', settings: b.doc.settings, today: TODAY, cal });
    expect(d.subject).toBe('Open items: 2 waiting');
    expect(d.body).toContain('- One (asked 1 Oct 2026)');
    expect(d.body).toContain('- Two (asked 2 Oct 2026, promised 9 Oct 2026)');
  });
  it('builds a mailto link with CRLF line breaks', () => {
    const url = mailtoUrl({ to: ['Sam <s@x.com>'], cc: [], subject: 'Hi & bye', body: 'a\nb' });
    expect(url).toBe('mailto:s@x.com?subject=Hi%20%26%20bye&body=a%0D%0Ab');
    expect(mailtoFits({ to: [], cc: [], subject: 's', body: 'x'.repeat(3000) })).toBe(false);
  });
  it('builds an unsent .eml Outlook opens as a draft', () => {
    const eml = emlFile({ to: ['Sam Lee <s@x.com>'], cc: ['"Doe, Jo" <j@x.com>'], subject: 'Café', body: 'Hello\nWorld' });
    expect(eml).toContain('X-Unsent: 1');
    expect(eml).toContain('To: Sam Lee <s@x.com>');
    expect(eml).toContain('Subject: =?UTF-8?B?');
    const body = eml.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Hello\r\nWorld');
  });
  it('never lets a line break into a header', () => {
    const eml = emlFile({ to: ['a@x.com\r\nBcc: evil@x.com'], cc: [], subject: 'Hi\nBcc: evil@x.com', body: 'x' });
    expect(eml.split('\r\n\r\n')[0]).not.toMatch(/^Bcc:/m);
  });
});
