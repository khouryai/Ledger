/**
 * supabase/schema.sql against a real Postgres (PGlite, in-process), with Supabase's
 * auth schema stubbed: auth.jwt() reads the claims a request would carry, and
 * auth.uid() their subject. Every assertion runs as the `authenticated` role, so
 * row-level security applies exactly as it would through the API.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const IV = 'AAAAAAAAAAAAAAAA';
const C = (s: string) => `cipher-${s}-xxxxxxxxxxxx`;

let db: PGlite;

const STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
`;

/** Run SQL as a signed-in caller. `aal` is aal2 unless said otherwise. */
async function as<T = Record<string, unknown>>(who: { sub: string; email: string; aal?: string } | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const claims = who ? JSON.stringify({ sub: who.sub, email: who.email, aal: who.aal ?? 'aal2', role: 'authenticated' }) : '';
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${who ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

const me = { sub: ME, email: 'me@example.com' };
const other = { sub: OTHER, email: 'other@example.com' };
const save = (who: typeof me, expected: number, tag: string, day = 'current_date') =>
  as<{ v: number }>(who, `select public.save_ledger($1, $2, $3, 'test', ${day}) as v`, [expected, IV, C(tag)]).then((r) => Number(r[0].v));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
  // Re-runnable.
  await db.exec(schema);
  await db.exec(`insert into public.ledger_members (email) values ('me@example.com')`);
}, 60_000);

describe('the database', () => {
  it('lets only an invited address sign up', async () => {
    await db.exec(`insert into auth.users (id, email) values ('${ME}', 'Me@Example.com ')`);
    await expect(db.exec(`insert into auth.users (id, email) values ('${OTHER}', 'other@example.com')`)).rejects.toThrow(/invitation only/);
    // The other account exists for the remaining tests as if made before the gate.
    await db.exec(`alter table auth.users disable trigger ledger_gate; insert into auth.users (id, email) values ('${OTHER}', 'other@example.com'); alter table auth.users enable trigger ledger_gate;`);
  });

  it('keeps the member list out of reach of every caller', async () => {
    await expect(as(me, 'select * from public.ledger_members')).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select * from public.ledger_members')).rejects.toThrow(/permission denied/);
  });

  it('refuses everything without the second step', async () => {
    const half = { ...me, aal: 'aal1' };
    await expect(as(half, `insert into public.ledger_vaults (salt, iterations, check_iv, check_cipher) values ('${'s'.repeat(24)}', 600000, '${IV}', '${C('check')}')`)).rejects.toThrow(/row-level security/);
    await expect(save(half, 0, 'first')).rejects.toThrow(/authenticator code/);
    expect(await as(half, 'select * from public.ledgers')).toHaveLength(0);
  });

  it('creates a vault once, readable only by its owner', async () => {
    await as(me, `insert into public.ledger_vaults (salt, iterations, check_iv, check_cipher) values ('${'s'.repeat(24)}', 600000, '${IV}', '${C('check')}')`);
    expect(await as(me, 'select user_id from public.ledger_vaults')).toEqual([{ user_id: ME }]);
    await expect(as(me, `update public.ledger_vaults set iterations = 310000`)).rejects.toThrow(/permission denied/);
    await expect(as(me, `delete from public.ledger_vaults`)).rejects.toThrow(/permission denied/);
    await expect(as(me, `insert into public.ledger_vaults (salt, iterations, check_iv, check_cipher) values ('${'s'.repeat(24)}', 1000, '${IV}', '${C('check')}')`)).rejects.toThrow();
  });

  it('saves against the version read, and refuses a stale one', async () => {
    expect(await save(me, 0, 'v1')).toBe(1);
    expect(await save(me, 1, 'v2')).toBe(2);
    await expect(save(me, 1, 'stale')).rejects.toThrow(/ledger-conflict/);
    await expect(save(me, 0, 'again')).rejects.toThrow(/ledger-conflict/);
    expect(await as(me, 'select version, cipher from public.ledgers')).toEqual([{ version: 2, cipher: C('v2') }]);
  });

  it('keeps the start of the day as a backup, once', async () => {
    const rows = await as<{ version: number; cipher: string }>(me, 'select version, cipher from public.ledger_backups');
    // The second save found v1 and kept it; the stale tries kept nothing.
    expect(rows).toEqual([{ version: 1, cipher: C('v1') }]);
    expect(await save(me, 2, 'v3')).toBe(3);
    expect(await as(me, 'select count(*)::int as n from public.ledger_backups')).toEqual([{ n: 1 }]);
  });

  it('keeps thirty days of backups', async () => {
    await db.exec(`insert into public.ledger_backups (user_id, day, version, iv, cipher)
      select '${ME}', current_date - g, 0, '${IV}', 'old' from generate_series(1, 40) g`);
    await save(me, 3, 'v4', 'current_date + 1');
    const n = await as<{ n: number }>(me, 'select count(*)::int as n from public.ledger_backups');
    expect(n[0].n).toBe(30);
  });

  it('refuses a day that is not today', async () => {
    await expect(save(me, 4, 'v5', `'2020-01-01'::date`)).rejects.toThrow(/not today/);
  });

  it('shows another account nothing, and lets it change nothing', async () => {
    expect(await as(other, 'select * from public.ledgers')).toHaveLength(0);
    expect(await as(other, 'select * from public.ledger_vaults')).toHaveLength(0);
    expect(await as(other, 'select * from public.ledger_backups')).toHaveLength(0);
    // Not a member, so not even its own rows.
    await expect(save(other, 0, 'theirs')).rejects.toThrow(/authenticator code/);
    const n = await as<{ n: number }>(other, `with u as (update public.ledgers set cipher = 'x' returning 1) select count(*)::int as n from u`);
    expect(n[0].n).toBe(0);
  });

  it('shows the anonymous key nothing at all', async () => {
    await expect(as(null, 'select * from public.ledgers')).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.save_ledger(0, 'a', 'b', 'c', current_date)`)).rejects.toThrow(/permission denied/);
  });

  it('exposes no SECURITY DEFINER function to the API', async () => {
    // Everything in public is callable as /rest/v1/rpc/<name>; a definer function
    // there runs with the owner's rights on whatever a caller passes it.
    const rows = await db.query<{ name: string }>(`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
    expect(rows.rows).toEqual([]);
  });

  it('cuts off a member who is removed, at once', async () => {
    await db.exec(`delete from public.ledger_members where email = 'me@example.com'`);
    expect(await as(me, 'select * from public.ledgers')).toHaveLength(0);
    await db.exec(`insert into public.ledger_members (email) values ('me@example.com')`);
    expect(await as(me, 'select * from public.ledgers')).toHaveLength(1);
  });
});
