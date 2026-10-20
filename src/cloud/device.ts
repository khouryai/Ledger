/**
 * What this device keeps, in IndexedDB, for an account:
 *
 * - the ledger key, when "Remember on this device" was ticked. It is stored as the
 *   non-extractable CryptoKey itself, which IndexedDB can hold: script on this page
 *   can use it to decrypt, but nothing can read the key's bytes out to send them
 *   anywhere. Signing out, or "Forget the passphrase here", deletes it.
 * - the last ledger row read or saved, still encrypted, so the app opens with no
 *   signal (underground, on a train) and saves when the connection comes back.
 */
import type { LedgerRow } from './api';

const DB = 'ledger-account';
const STORE = 'kv';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result as T);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    d.close();
  }
}

export const device = {
  getKey: (userId: string) => run<CryptoKey | undefined>('readonly', (s) => s.get(`key:${userId}`)).catch(() => undefined),
  putKey: (userId: string, key: CryptoKey) => run<void>('readwrite', (s) => s.put(key, `key:${userId}`)),
  getRow: (userId: string) => run<LedgerRow | undefined>('readonly', (s) => s.get(`ledger:${userId}`)).catch(() => undefined),
  putRow: (userId: string, row: LedgerRow) => run<void>('readwrite', (s) => s.put(row, `ledger:${userId}`)).catch(() => undefined),
  /** Everything this device kept, for every account: signing out leaves nothing. */
  clear: () => run<void>('readwrite', (s) => s.clear()).catch(() => undefined),
};

/** A word for the device a save came from, shown on the other one. */
export function deviceName(): string {
  if (typeof navigator === 'undefined') return 'device';
  const ua = navigator.userAgent;
  if (/iPhone|Android.+Mobile|Mobile/i.test(ua)) return 'phone';
  if (/iPad|Android|Tablet/i.test(ua)) return 'tablet';
  return 'computer';
}
