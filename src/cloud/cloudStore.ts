/**
 * The ledger in the account: the same DocStore the folder gives, over a CloudApi.
 *
 * Every save is encrypted here, then saved against the version this device last
 * read. When the other device saved in between, the server refuses; this store
 * reads what is there, merges it with this device's ledger three ways (the base is
 * the copy both started from), and saves the merge, all before the app hears back.
 * The app is handed the merged ledger to show.
 */
import { readDoc } from '../engine/doc';
import { mergeDocs } from '../engine/merge';
import type { LedgerDoc } from '../engine/types';
import type { DocStore, LoadResult, Saved } from '../storage/ledgerStore';
import { ConflictError, type CloudApi, type LedgerRow } from './api';

/** Where this device keeps the last ledger it read, still encrypted, for opening with no signal. */
export type RowCache = { get(): Promise<LedgerRow | undefined>; put(row: LedgerRow): Promise<void> };

export const OFFLINE_NOTE = 'No connection, so this is the copy kept on this device. Changes are saved, and merged, when the connection is back.';

export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || /failed to fetch|network|load failed|fetch failed|timed? ?out/i.test(err instanceof Error ? err.message : String(err));
}
import { seal, unseal } from './vault';

const BACKUP = /^account:(\d{4}-\d{2}-\d{2})$/;
/** Merging and trying again more than this means two devices saving in a tight loop. */
const TRIES = 5;

export class CloudStore implements DocStore {
  private version = 0;
  /** The ledger as last read from or saved to the server: the merge's common base. */
  private base: LedgerDoc | null = null;

  constructor(
    private readonly api: CloudApi,
    private readonly key: CryptoKey,
    private readonly userId: string,
    private readonly device: string,
    private readonly cache?: RowCache,
  ) {}

  describe(): string {
    return this.api.describe();
  }

  private serialize(doc: LedgerDoc): string {
    return JSON.stringify(doc);
  }

  private async open(row: { iv: string; cipher: string }): Promise<LedgerDoc> {
    const text = await unseal(this.key, row, this.userId, 'ledger');
    return readDoc(JSON.parse(text)).doc;
  }

  async load(): Promise<LoadResult> {
    let row: LedgerRow | null;
    const problems: string[] = [];
    try {
      row = await this.api.getLedger();
      if (row) await this.cache?.put(row);
    } catch (err) {
      const kept = isNetworkError(err) ? await this.cache?.get() : undefined;
      if (!kept) throw err;
      row = kept;
      problems.push(OFFLINE_NOTE);
    }
    if (!row) {
      this.version = 0;
      this.base = null;
      return { kind: 'empty' };
    }
    let text: string;
    try {
      text = await unseal(this.key, row, this.userId, 'ledger');
    } catch {
      return { kind: 'broken', text: '', error: 'the saved ledger did not decrypt with this passphrase, or was altered' };
    }
    try {
      const r = readDoc(JSON.parse(text));
      this.version = row.version;
      this.base = r.doc;
      return { kind: 'ok', doc: r.doc, text, problems: [...problems, ...r.problems] };
    } catch (err) {
      return { kind: 'broken', text, error: (err as Error).message };
    }
  }

  async save(doc: LedgerDoc, today: string): Promise<Saved | void> {
    let mine = doc;
    let clashes = 0;
    let renumbered = 0;
    for (let i = 0; i < TRIES; i++) {
      const sealed = await seal(this.key, this.serialize(mine), this.userId, 'ledger');
      try {
        this.version = await this.api.saveLedger(this.version, sealed, this.device, today);
        this.base = mine;
        await this.cache?.put({ ...sealed, version: this.version, updatedAt: new Date().toISOString(), device: this.device });
        return mine === doc ? undefined : { doc: mine, clashes, renumbered };
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
      }
      const row = await this.api.getLedger();
      if (!row) {
        // Deleted on the server since it was read: this device's copy becomes the ledger.
        this.version = 0;
        this.base = null;
        continue;
      }
      const theirs = await this.open(row);
      const r = mergeDocs(this.base ?? theirs, mine, theirs, new Date());
      mine = r.doc;
      clashes += r.clashes;
      renumbered += r.renumbered.length;
      this.version = row.version;
      this.base = theirs;
    }
    throw new Error('The other device kept saving at the same moment. Your changes are still here; they will be saved on the next change.');
  }

  async listBackups(): Promise<{ path: string; day: string }[]> {
    return (await this.api.listBackups()).map((b) => ({ path: `account:${b.day}`, day: b.day }));
  }

  async readBackup(path: string): Promise<LedgerDoc> {
    const m = BACKUP.exec(path);
    if (!m) throw new Error('Not a backup.');
    return this.open(await this.api.getBackup(m[1]));
  }

  /** True when the other device has saved since this one last read or saved. */
  async changedOutside(): Promise<boolean> {
    return (await this.api.getVersion()) !== this.version;
  }
}
