import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemAdapter } from '../src/storage/fileSystemAdapter';
import { MemoryAdapter } from '../src/storage/memoryAdapter';
import { NodeDirectory } from '../src/storage/nodeDirectory';
import { LedgerStore, KEEP_BACKUPS } from '../src/storage/ledgerStore';
import { makeCtx } from '../src/engine/decide';
import { toRows } from '../src/engine/table';
import { actionLogWorkbook, readActionLog } from '../src/io/xlsx';
import { add, docWith, TODAY } from './helpers';

describe('the ledger file', () => {
  it('saves, loads and backs up once a day', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const store = new LedgerStore(new FileSystemAdapter(new NodeDirectory(dir), 'test', { attempts: 1, baseDelayMs: 0 }));
    expect((await store.load()).kind).toBe('empty');
    let doc = add(docWith(), { title: 'one' }).doc;
    await store.save(doc, '2026-10-14');
    expect(await store.listBackups()).toEqual([]);
    doc = add(doc, { title: 'two' }).doc;
    await store.save(doc, '2026-10-15');
    await store.save(doc, '2026-10-15');
    const backups = await store.listBackups();
    expect(backups.map((b) => b.day)).toEqual(['2026-10-15']);
    expect((await store.readBackup(backups[0].path)).items.map((i) => i.title)).toEqual(['one']);
    const loaded = await store.load();
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') expect(loaded.doc.items.map((i) => i.title)).toEqual(['one', 'two']);
  });
  it('keeps thirty backups and never touches other files', async () => {
    const mem = new MemoryAdapter();
    const store = new LedgerStore(mem);
    for (let i = 1; i <= 35; i++) await mem.write(`backups/ledger-2026-09-${String(i).padStart(2, '0')}.json`, '{}');
    await mem.write('backups/keep-me.json', '{}');
    await store.prune();
    expect((await store.listBackups()).length).toBe(KEEP_BACKUPS);
    expect(await mem.exists('backups/keep-me.json')).toBe(true);
  });
  it('reports a broken file instead of replacing it', async () => {
    const mem = new MemoryAdapter();
    await mem.write('ledger.json', '{ not json');
    const r = await new LedgerStore(mem).load();
    expect(r.kind).toBe('broken');
  });
  it('notices a change made outside the app', async () => {
    const mem = new MemoryAdapter();
    const store = new LedgerStore(mem);
    await store.save(docWith(), TODAY);
    expect(await store.changedOutside()).toBe(false);
    await mem.write('ledger.json', '{}');
    expect(await store.changedOutside()).toBe(true);
  });
});

describe('the Excel action log', () => {
  it('writes rows that read back, formulas as text', async () => {
    let doc = add(docWith(), { title: '=SUM(A1) is not a formula', direction: 'owe', due: '2026-10-20' }).doc;
    doc = add(doc, { title: 'Second' }).doc;
    const rows = toRows(doc.items, makeCtx(doc, TODAY));
    const back = readActionLog(actionLogWorkbook(rows));
    expect(back.length).toBe(2);
    expect(back[0]).toMatchObject({ No: 1, Action: '=SUM(A1) is not a formula', Type: 'I owe', Due: 'Tue 10/20' });
  });
});
