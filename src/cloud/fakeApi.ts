/**
 * The CloudApi from memory: the same answers Supabase and schema.sql give, for the
 * Node tests (two devices on one server) and the browser tests (`?cloud=fake`).
 *
 * It keeps the rules that matter to the app: only a member may sign up, nothing is
 * readable before the second step, and a save against an old version is refused.
 * The authenticator code is always 123456.
 */
import { ConflictError, type AuthState, type CloudApi, type LedgerRow } from './api';
import type { Sealed, VaultRecord } from './vault';

export const FAKE_CODE = '123456';
export const FAKE_EMAIL = 'me@example.com';

type User = { id: string; email: string; password: string; factor?: { id: string; verified: boolean } };
type Data = {
  users: User[];
  vaults: Record<string, VaultRecord>;
  ledgers: Record<string, LedgerRow>;
  backups: Record<string, Record<string, Sealed & { version: number }>>;
};

export class FakeServer {
  data: Data = { users: [], vaults: {}, ledgers: {}, backups: {} };
  members = [FAKE_EMAIL];
  /** Saves seen, for tests that count round trips. */
  saves = 0;

  constructor(private persist?: Storage) {
    const raw = persist?.getItem('ledger-fake-server');
    if (raw) this.data = JSON.parse(raw) as Data;
  }

  commit() {
    this.persist?.setItem('ledger-fake-server', JSON.stringify(this.data));
  }
}

type Session = { userId: string; aal: 'aal1' | 'aal2'; recovery?: boolean };

export function fakeApi(server: FakeServer, persist?: Storage): CloudApi {
  const KEY = 'ledger-fake-session';
  let session: Session | null = persist ? (JSON.parse(persist.getItem(KEY) ?? 'null') as Session | null) : null;
  const listeners = new Set<() => void>();
  const setSession = (s: Session | null) => {
    session = s;
    if (persist) {
      if (s) persist.setItem(KEY, JSON.stringify(s));
      else persist.removeItem(KEY);
    }
    for (const l of listeners) l();
  };
  const user = () => server.data.users.find((u) => u.id === session?.userId);
  /** What row-level security would allow: a member, past the second step. */
  const may = () => {
    const u = user();
    if (!u || session?.aal !== 'aal2' || !server.members.includes(u.email)) throw new Error('new row violates row-level security policy');
    return u;
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  return {
    describe: () => 'Your account (test server)',
    async state(): Promise<AuthState> {
      await tick();
      const u = user();
      if (!u || !session) return { kind: 'signed-out' };
      if (session.recovery) return { kind: 'recovery', email: u.email, userId: u.id };
      if (session.aal === 'aal2') return { kind: 'ready', email: u.email, userId: u.id };
      if (u.factor?.verified) return { kind: 'challenge', email: u.email, userId: u.id, factorId: u.factor.id };
      return { kind: 'enrol', email: u.email, userId: u.id };
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signIn(email, password) {
      await tick();
      const u = server.data.users.find((x) => x.email === email.trim().toLowerCase());
      if (!u || u.password !== password) throw new Error('Invalid login credentials');
      setSession({ userId: u.id, aal: 'aal1' });
    },
    async signUp(email, password) {
      await tick();
      const e = email.trim().toLowerCase();
      if (!server.members.includes(e)) throw new Error('Sign-up is by invitation only.');
      if (server.data.users.some((u) => u.email === e)) throw new Error('User already registered');
      const u: User = { id: crypto.randomUUID(), email: e, password };
      server.data.users.push(u);
      server.commit();
      setSession({ userId: u.id, aal: 'aal1' });
      return 'signed-in';
    },
    async sendReset() {
      await tick();
    },
    async setPassword(password) {
      const u = user();
      if (!u) throw new Error('Not signed in.');
      u.password = password;
      server.commit();
      if (session) setSession({ ...session, recovery: false });
    },
    async enrolTotp() {
      const u = user();
      if (!u) throw new Error('Not signed in.');
      u.factor = { id: crypto.randomUUID(), verified: false };
      server.commit();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#fff"/><rect x="20" y="20" width="80" height="80" fill="#000"/></svg>`;
      return { factorId: u.factor.id, qr: `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`, secret: 'JBSWY3DPEHPK3PXP' };
    },
    async verifyTotp(factorId, code) {
      await tick();
      const u = user();
      if (!u || u.factor?.id !== factorId) throw new Error('Factor not found');
      if (code.replace(/\s+/g, '') !== FAKE_CODE) throw new Error('Invalid TOTP code entered');
      u.factor.verified = true;
      server.commit();
      setSession({ userId: u.id, aal: 'aal2' });
    },
    async signOut() {
      setSession(null);
    },
    async getVault() {
      await tick();
      return server.data.vaults[may().id] ?? null;
    },
    async createVault(v) {
      await tick();
      const u = may();
      if (server.data.vaults[u.id]) throw new Error('duplicate key value violates unique constraint "ledger_vaults_pkey"');
      server.data.vaults[u.id] = v;
      server.commit();
    },
    async getLedger() {
      await tick();
      return server.data.ledgers[may().id] ?? null;
    },
    async getVersion() {
      await tick();
      return server.data.ledgers[may().id]?.version ?? 0;
    },
    async saveLedger(expected, s, device, day) {
      await tick();
      const u = may();
      server.saves++;
      const cur = server.data.ledgers[u.id];
      if ((cur?.version ?? 0) !== expected) throw new ConflictError();
      if (cur) {
        const b = (server.data.backups[u.id] ??= {});
        b[day] ??= { iv: cur.iv, cipher: cur.cipher, version: cur.version };
        for (const d of Object.keys(b).sort().reverse().slice(30)) delete b[d];
      }
      const version = expected + 1;
      server.data.ledgers[u.id] = { ...s, version, updatedAt: new Date().toISOString(), device };
      server.commit();
      return version;
    },
    async listBackups() {
      await tick();
      const b = server.data.backups[may().id] ?? {};
      return Object.keys(b)
        .sort()
        .reverse()
        .map((day) => ({ day, version: b[day].version }));
    },
    async getBackup(day) {
      await tick();
      const b = server.data.backups[may().id]?.[day];
      if (!b) throw new Error('No backup for that day.');
      return { iv: b.iv, cipher: b.cipher };
    },
  };
}
