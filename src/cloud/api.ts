/**
 * Everything Ledger asks of its backend, as one interface. `supabaseApi.ts` is the
 * real one and the only file that knows Supabase; `fakeApi.ts` answers the same
 * questions from memory, for the Node tests and the browser tests.
 */
import type { Sealed, VaultRecord } from './vault';

/** Where a sign-in has got to. Every step must be done before the ledger opens. */
export type AuthState =
  | { kind: 'signed-out' }
  /** Arrived from a password-reset link: a new password is needed before anything else. */
  | { kind: 'recovery'; email: string; userId: string }
  /** Signed in with the password, but no authenticator app set up yet. */
  | { kind: 'enrol'; email: string; userId: string }
  /** Signed in with the password; the authenticator code is needed. */
  | { kind: 'challenge'; email: string; userId: string; factorId: string }
  /** Both steps done. */
  | { kind: 'ready'; email: string; userId: string };

export type Enrolment = { factorId: string; qr: string; secret: string };

export type LedgerRow = Sealed & { version: number; updatedAt: string; device?: string };

export class ConflictError extends Error {
  constructor() {
    super('The other device saved first.');
    this.name = 'ConflictError';
  }
}

export interface CloudApi {
  /** For the status line: where the ledger is kept. */
  describe(): string;
  state(): Promise<AuthState>;
  /** Called whenever the sign-in changes (signed in, out, token refreshed elsewhere). */
  onChange(cb: () => void): () => void;

  signIn(email: string, password: string): Promise<void>;
  /** 'confirm' when Supabase sent a link to confirm the address first. */
  signUp(email: string, password: string): Promise<'confirm' | 'signed-in'>;
  sendReset(email: string): Promise<void>;
  setPassword(password: string): Promise<void>;
  enrolTotp(): Promise<Enrolment>;
  verifyTotp(factorId: string, code: string): Promise<void>;
  signOut(everywhere: boolean): Promise<void>;

  getVault(): Promise<VaultRecord | null>;
  createVault(v: VaultRecord): Promise<void>;
  getLedger(): Promise<LedgerRow | null>;
  /** The saved version only, to notice cheaply that the other device saved. 0 when none. */
  getVersion(): Promise<number>;
  /**
   * Save against the version this device last read; the new version, or
   * ConflictError when another device saved in between. The first save of a day
   * keeps the ledger as it stood as that day's backup, on the server.
   */
  saveLedger(expected: number, s: Sealed, device: string, day: string): Promise<number>;
  listBackups(): Promise<{ day: string; version: number }[]>;
  getBackup(day: string): Promise<Sealed>;
}

export const MIN_PASSWORD = 12;

export function passwordProblem(p: string): string | null {
  if (p.length < MIN_PASSWORD) return `At least ${MIN_PASSWORD} characters.`;
  if (p.length > 72) return 'At most 72 characters.';
  return null;
}

/** Errors from the backend, in words a person can act on. */
export function friendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/invalid login credentials/i.test(m)) return 'That email and password do not match.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link Supabase sent you.';
  if (/invalid totp|invalid mfa|code.*(invalid|expired)/i.test(m)) return 'That code is not right. Codes change every 30 seconds; use the current one.';
  // The database's invitation trigger refusing a sign-up reaches the app as Supabase's
  // generic wrapper, so both are read as the same answer.
  if (/invitation only|not allowed|signups not allowed|database error saving new user/i.test(m)) return 'This address cannot have an account here.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute, then try again.';
  if (/failed to fetch|network/i.test(m)) return 'No connection. Check the network and try again.';
  return m;
}
