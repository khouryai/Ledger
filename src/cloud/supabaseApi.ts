/**
 * The CloudApi against Supabase. The only file that knows supabase-js, table names
 * or the shape of its errors.
 *
 * Sign-in uses the PKCE flow: links in emails (confirm the address, reset the
 * password) come back as `?code=`, which this client exchanges itself. That keeps
 * tokens out of the URL's hash, which is the router's, and means a link only works
 * in the browser that asked for it.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConflictError, type AuthState, type CloudApi, type Enrolment, type LedgerRow } from './api';
import type { CloudConfig } from './config';
import type { Sealed, VaultRecord } from './vault';

export function supabaseApi(cfg: CloudConfig): CloudApi {
  const sb: SupabaseClient = createClient(cfg.url, cfg.key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ledger-auth' },
  });
  let recovering = false;
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    if (event === 'SIGNED_OUT') recovering = false;
  });
  const back = () => `${location.origin}${location.pathname}`;
  const fail = (e: { message: string } | null) => {
    if (e) throw new Error(e.message);
  };
  // Supabase puts ?code= on the address it returns to; once used, it is noise.
  const tidyUrl = () => {
    const u = new URL(location.href);
    if (u.searchParams.has('code') || u.searchParams.has('error_description')) {
      u.searchParams.delete('code');
      u.searchParams.delete('error');
      u.searchParams.delete('error_code');
      u.searchParams.delete('error_description');
      history.replaceState(null, '', u.toString());
    }
  };

  return {
    describe: () => `Your account, ${new URL(cfg.url).host}`,

    async state(): Promise<AuthState> {
      await sb.auth.initialize();
      tidyUrl();
      const { data } = await sb.auth.getSession();
      const s = data.session;
      if (!s) return { kind: 'signed-out' };
      const email = s.user.email ?? '';
      const userId = s.user.id;
      if (recovering) return { kind: 'recovery', email, userId };
      const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      fail(aal.error);
      if (aal.data?.currentLevel === 'aal2') return { kind: 'ready', email, userId };
      const f = await sb.auth.mfa.listFactors();
      fail(f.error);
      const totp = f.data?.totp.find((x) => x.status === 'verified');
      return totp ? { kind: 'challenge', email, userId, factorId: totp.id } : { kind: 'enrol', email, userId };
    },

    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event) => {
        if (event !== 'TOKEN_REFRESHED') cb();
      });
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      fail((await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })).error);
    },
    async signUp(email, password) {
      const r = await sb.auth.signUp({ email: email.trim().toLowerCase(), password, options: { emailRedirectTo: back() } });
      fail(r.error);
      return r.data.session ? 'signed-in' : 'confirm';
    },
    async sendReset(email) {
      fail((await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: back() })).error);
    },
    async setPassword(password) {
      fail((await sb.auth.updateUser({ password })).error);
      recovering = false;
    },

    async enrolTotp(): Promise<Enrolment> {
      // A setup abandoned half way leaves an unverified factor that blocks a new one.
      const f = await sb.auth.mfa.listFactors();
      fail(f.error);
      for (const x of f.data?.all ?? []) if (x.factor_type === 'totp' && x.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: x.id });
      const r = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Ledger ${new Date().toISOString().slice(0, 10)}` });
      fail(r.error);
      return { factorId: r.data!.id, qr: r.data!.totp.qr_code, secret: r.data!.totp.secret };
    },
    async verifyTotp(factorId, code) {
      fail((await sb.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s+/g, '') })).error);
    },
    async signOut(everywhere) {
      fail((await sb.auth.signOut({ scope: everywhere ? 'global' : 'local' })).error);
    },

    async getVault() {
      const r = await sb.from('ledger_vaults').select('salt, iterations, check_iv, check_cipher').maybeSingle();
      fail(r.error);
      return (r.data as VaultRecord | null) ?? null;
    },
    async createVault(v) {
      fail((await sb.from('ledger_vaults').insert(v)).error);
    },
    async getLedger(): Promise<LedgerRow | null> {
      const r = await sb.from('ledgers').select('version, iv, cipher, updated_at, device').maybeSingle();
      fail(r.error);
      if (!r.data) return null;
      const d = r.data as { version: number; iv: string; cipher: string; updated_at: string; device: string | null };
      return { version: Number(d.version), iv: d.iv, cipher: d.cipher, updatedAt: d.updated_at, device: d.device ?? undefined };
    },
    async getVersion() {
      const r = await sb.from('ledgers').select('version').maybeSingle();
      fail(r.error);
      return r.data ? Number((r.data as { version: number }).version) : 0;
    },
    async saveLedger(expected, s, device, day) {
      const r = await sb.rpc('save_ledger', { expected, p_iv: s.iv, p_cipher: s.cipher, p_device: device, p_day: day });
      if (r.error && /ledger-conflict/.test(r.error.message)) throw new ConflictError();
      fail(r.error);
      return Number(r.data);
    },
    async listBackups() {
      const r = await sb.from('ledger_backups').select('day, version').order('day', { ascending: false });
      fail(r.error);
      return ((r.data ?? []) as { day: string; version: number }[]).map((b) => ({ day: b.day, version: Number(b.version) }));
    },
    async getBackup(day): Promise<Sealed> {
      const r = await sb.from('ledger_backups').select('iv, cipher').eq('day', day).single();
      fail(r.error);
      return r.data as Sealed;
    },
  };
}
