-- Ledger's database. Apply to a project of its own, in the SQL editor or as a
-- migration, then add the one address allowed in (see the end of this file).
-- Re-runnable: every statement replaces or skips what is already there.
--
-- What the server holds, and what it can see:
--   ledger_members   the addresses allowed an account. Nobody else can sign up.
--   ledger_vaults    per account: the passphrase's salt and a sealed check value.
--                    Not the passphrase, not the key.
--   ledgers          per account: the ledger, encrypted on the device (AES-256-GCM),
--                    and its version. The server never sees it readable.
--   ledger_backups   the ledger as it stood at the start of each day, 30 kept,
--                    copied server-side from the ciphertext (still encrypted).
--
-- Who can read and write it: row-level security, on every table, allows only the
-- account the row belongs to, only once that account has passed the second step
-- (an authenticator-app code: the session's `aal` is `aal2`), and only while the
-- address is still a member. The interface explains this; it does not enforce it.
--
-- Two things about Postgres that this file is written around:
--  * A refused UPDATE is not an error: the row is filtered out and the statement
--    reports success having changed nothing. save_ledger() checks the row count and
--    raises, so a save that did not happen is never reported as one that did.
--  * auth.uid() and auth.jwt() are wrapped in (select ...) in policies so Postgres
--    evaluates them once per statement instead of once per row.

-- Members ---------------------------------------------------------------------

create table if not exists public.ledger_members (
  email text primary key check (email = lower(btrim(email))),
  added_at timestamptz not null default now()
);
alter table public.ledger_members enable row level security;
-- No policies: nothing in the app reads or writes this table. It is changed in the
-- SQL editor, by the project's owner.
revoke all on public.ledger_members from anon, authenticated;

-- Sign-up is by invitation only. Supabase's "Allow new users to sign up" stays ON:
-- turning it off would refuse the invited address too. This trigger is the control.
create or replace function public.ledger_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or not exists (select 1 from public.ledger_members m where m.email = lower(btrim(new.email))) then
    raise exception 'Sign-up is by invitation only.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.ledger_gate() from public, anon, authenticated;

drop trigger if exists ledger_gate on auth.users;
create trigger ledger_gate before insert on auth.users
  for each row execute function public.ledger_gate();

-- Whether the caller may touch their own rows at all: a member, past the second step.
-- SECURITY DEFINER so it can read ledger_members, which no caller can. It lives in a
-- schema the API does not expose, so policies can call it but nobody can call it as
-- /rest/v1/rpc/... (Supabase's advisor flags a definer function that can be).
create schema if not exists ledger_private;
revoke all on schema ledger_private from public, anon;
grant usage on schema ledger_private to authenticated;

create or replace function ledger_private.may() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (
       select 1 from public.ledger_members m
       where m.email = lower(btrim(coalesce((select auth.jwt() ->> 'email'), '')))
     );
$$;
revoke all on function ledger_private.may() from public, anon;
grant execute on function ledger_private.may() to authenticated;

-- The vault: how to derive the key, never the key -------------------------------

create table if not exists public.ledger_vaults (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  salt text not null check (length(salt) between 16 and 64),
  iterations integer not null check (iterations >= 310000),
  check_iv text not null check (length(check_iv) between 12 and 32),
  check_cipher text not null check (length(check_cipher) between 16 and 256),
  created_at timestamptz not null default now()
);
alter table public.ledger_vaults enable row level security;
revoke all on public.ledger_vaults from anon;
grant select, insert on public.ledger_vaults to authenticated;

drop policy if exists "own vault: read" on public.ledger_vaults;
create policy "own vault: read" on public.ledger_vaults for select to authenticated
  using (user_id = (select auth.uid()) and (select ledger_private.may()));
drop policy if exists "own vault: create once" on public.ledger_vaults;
create policy "own vault: create once" on public.ledger_vaults for insert to authenticated
  with check (user_id = (select auth.uid()) and (select ledger_private.may()));
-- No update and no delete: changing the passphrase would strand every backup sealed
-- under the old key. A new passphrase is a new account's worth of setting up.

-- The ledger ----------------------------------------------------------------------

create table if not exists public.ledgers (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null check (version >= 1),
  iv text not null check (length(iv) between 12 and 32),
  cipher text not null check (length(cipher) between 16 and 20000000),
  device text check (length(device) <= 80),
  updated_at timestamptz not null default now()
);
alter table public.ledgers enable row level security;
revoke all on public.ledgers from anon;
grant select, insert, update on public.ledgers to authenticated;

drop policy if exists "own ledger: read" on public.ledgers;
create policy "own ledger: read" on public.ledgers for select to authenticated
  using (user_id = (select auth.uid()) and (select ledger_private.may()));
drop policy if exists "own ledger: create" on public.ledgers;
create policy "own ledger: create" on public.ledgers for insert to authenticated
  with check (user_id = (select auth.uid()) and (select ledger_private.may()));
drop policy if exists "own ledger: save" on public.ledgers;
create policy "own ledger: save" on public.ledgers for update to authenticated
  using (user_id = (select auth.uid()) and (select ledger_private.may()))
  with check (user_id = (select auth.uid()) and (select ledger_private.may()));

-- Backups: the start of each day, kept 30 days ---------------------------------------

create table if not exists public.ledger_backups (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  version bigint not null,
  iv text not null,
  cipher text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.ledger_backups enable row level security;
revoke all on public.ledger_backups from anon;
grant select, insert, delete on public.ledger_backups to authenticated;

drop policy if exists "own backups: read" on public.ledger_backups;
create policy "own backups: read" on public.ledger_backups for select to authenticated
  using (user_id = (select auth.uid()) and (select ledger_private.may()));
drop policy if exists "own backups: keep" on public.ledger_backups;
create policy "own backups: keep" on public.ledger_backups for insert to authenticated
  with check (user_id = (select auth.uid()) and (select ledger_private.may()));
drop policy if exists "own backups: prune" on public.ledger_backups;
create policy "own backups: prune" on public.ledger_backups for delete to authenticated
  using (user_id = (select auth.uid()) and (select ledger_private.may()));

-- Saving --------------------------------------------------------------------------------
--
-- One function, so the version check, the day's backup and the write happen together.
-- SECURITY INVOKER: it runs as the caller, under the policies above, and can do
-- nothing the caller could not do one statement at a time.

create or replace function public.save_ledger(expected bigint, p_iv text, p_cipher text, p_device text, p_day date)
returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  cur record;
  next_v bigint;
  n integer;
begin
  if uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;
  if not (select ledger_private.may()) then
    raise exception 'The authenticator code is needed before saving.' using errcode = '42501';
  end if;
  if p_day < current_date - 2 or p_day > current_date + 2 then
    raise exception 'The day given is not today.' using errcode = '22023';
  end if;

  select l.version, l.iv, l.cipher into cur from public.ledgers l where l.user_id = uid for update;

  if not found then
    if expected <> 0 then
      raise exception 'ledger-conflict' using errcode = '40001';
    end if;
    insert into public.ledgers (user_id, version, iv, cipher, device) values (uid, 1, p_iv, p_cipher, p_device);
    return 1;
  end if;

  if cur.version <> expected then
    raise exception 'ledger-conflict' using errcode = '40001';
  end if;

  -- The first save of a day keeps the ledger as it stood, still encrypted.
  insert into public.ledger_backups (user_id, day, version, iv, cipher)
    values (uid, p_day, cur.version, cur.iv, cur.cipher)
    on conflict (user_id, day) do nothing;
  delete from public.ledger_backups b
    where b.user_id = uid
      and b.day < (select min(k.day) from (select x.day from public.ledger_backups x where x.user_id = uid order by x.day desc limit 30) k);

  next_v := cur.version + 1;
  update public.ledgers
     set version = next_v, iv = p_iv, cipher = p_cipher, device = p_device, updated_at = now()
   where user_id = uid and version = expected;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'The ledger was not saved.' using errcode = '42501';
  end if;
  return next_v;
end $$;
revoke all on function public.save_ledger(bigint, text, text, text, date) from public, anon;
grant execute on function public.save_ledger(bigint, text, text, text, date) to authenticated;

-- The one address allowed in. Run this once, with yours, in the SQL editor:
--   insert into public.ledger_members (email) values ('you@example.com') on conflict do nothing;

-- An earlier version kept the check above in public, where the API could reach it.
drop function if exists public.ledger_may();
