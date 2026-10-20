/**
 * The ledger on disk.
 *
 *   ledger.json                     the whole ledger, written after every change
 *   backups/ledger-YYYY-MM-DD.json  yesterday's file, kept once a day for 30 days
 *   exports/                        Excel action logs and drafts the user asked for
 *
 * Writes are atomic (a temp file renamed over the target, in FileSystemAdapter), so a
 * crash or a OneDrive sync mid-write leaves the previous file whole. A file that will
 * not parse is never overwritten: the app opens read-only and offers the backups.
 */
import { readDoc } from '../engine/doc';
import type { LedgerDoc } from '../engine/types';
import type { StorageAdapter } from './adapter';

export const LEDGER_FILE = 'ledger.json';
export const BACKUP_DIR = 'backups';
export const EXPORT_DIR = 'exports';
export const KEEP_BACKUPS = 30;

const BACKUP_NAME = /^ledger-(\d{4}-\d{2}-\d{2})\.json$/;

export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'ok'; doc: LedgerDoc; text: string; problems: string[] }
  | { kind: 'broken'; text: string; error: string };

/** What a save that had to merge with another device's ledger came back with. */
export type Saved = { doc: LedgerDoc; clashes: number; renumbered: number };

/**
 * What the app needs of wherever the ledger lives: this folder-backed store, or the
 * account (cloud/cloudStore.ts). A save may come back with a merged ledger.
 */
export interface DocStore {
  describe(): string;
  load(): Promise<LoadResult>;
  save(doc: LedgerDoc, today: string): Promise<Saved | void>;
  listBackups(): Promise<{ path: string; day: string }[]>;
  readBackup(path: string): Promise<LedgerDoc>;
  changedOutside(): Promise<boolean>;
}

export class LedgerStore implements DocStore {
  /** The text last read or written, to notice a change made from outside. */
  private lastText: string | null = null;

  constructor(public readonly adapter: StorageAdapter) {}

  describe(): string {
    return this.adapter.describe();
  }

  async load(): Promise<LoadResult> {
    const text = await this.adapter.read(LEDGER_FILE);
    if (text === null || text.trim() === '') {
      this.lastText = text;
      return { kind: 'empty' };
    }
    try {
      const raw = JSON.parse(text) as unknown;
      const { doc, problems } = readDoc(raw);
      this.lastText = text;
      return { kind: 'ok', doc, text, problems };
    } catch (err) {
      return { kind: 'broken', text, error: (err as Error).message };
    }
  }

  serialize(doc: LedgerDoc): string {
    return `${JSON.stringify(doc, null, 1)}\n`;
  }

  /**
   * Save the ledger. The first save of each day first copies the file as it stood
   * into backups/, so a bad day can always be walked back from.
   */
  async save(doc: LedgerDoc, today: string): Promise<void> {
    const text = this.serialize(doc);
    await this.backupOnce(today);
    await this.adapter.write(LEDGER_FILE, text);
    this.lastText = text;
  }

  private async backupOnce(today: string): Promise<void> {
    const name = `${BACKUP_DIR}/ledger-${today}.json`;
    if (await this.adapter.exists(name)) return;
    const current = await this.adapter.read(LEDGER_FILE);
    if (!current || !current.trim()) return;
    await this.adapter.write(name, current);
    await this.prune();
  }

  async listBackups(): Promise<{ path: string; day: string }[]> {
    const files = await this.adapter.list(BACKUP_DIR);
    return files
      .map((path) => ({ path, m: BACKUP_NAME.exec(path.split('/').pop() ?? '') }))
      .filter((x): x is { path: string; m: RegExpExecArray } => !!x.m)
      .map((x) => ({ path: x.path, day: x.m[1] }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  /** Remove backups beyond the newest thirty. Only files this store named are touched. */
  async prune(): Promise<void> {
    const all = await this.listBackups();
    for (const b of all.slice(KEEP_BACKUPS)) {
      if (!BACKUP_NAME.test(b.path.split('/').pop() ?? '')) continue;
      await this.adapter.remove(b.path);
    }
  }

  async readBackup(path: string): Promise<LedgerDoc> {
    if (!path.startsWith(`${BACKUP_DIR}/`) || !BACKUP_NAME.test(path.split('/').pop() ?? '')) throw new Error('Not a backup file.');
    const text = await this.adapter.read(path);
    if (!text) throw new Error('That backup is empty.');
    return readDoc(JSON.parse(text)).doc;
  }

  /** True when the file on disk is no longer what this window last read or wrote. */
  async changedOutside(): Promise<boolean> {
    if (this.lastText === null) return false;
    const now = await this.adapter.read(LEDGER_FILE);
    return now !== null && now !== this.lastText;
  }

  async writeExport(name: string, bytes: Uint8Array): Promise<string> {
    const safe = name.replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const path = `${EXPORT_DIR}/${safe}`;
    await this.adapter.writeBinary(path, bytes);
    return path;
  }
}
