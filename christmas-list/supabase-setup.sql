-- =====================================================================
-- Christmas List: database setup
--
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It's safe to run again; it won't delete existing claims.
--
-- What this creates:
--   * one table, "claims": which gifts are taken (gift id, a hash of the
--     claimer's device token, and when). No names, no personal data.
--   * three functions the web page is allowed to call:
--       list_claims   which gifts are claimed, and which ones are "yours"
--       claim_gift    claim a gift (only if nobody has it yet)
--       unclaim_gift  undo a claim (only from the device that made it)
--
-- Visitors can't read or change the table directly. Everything goes
-- through those three functions, so nobody can overwrite or delete
-- someone else's claim or wipe the list.
-- =====================================================================

create table if not exists public.claims (
  gift_id    text primary key,                 -- one claim per gift, enforced by the database
  token_hash text not null,                    -- SHA-256 of the claimer's device token (never the token itself)
  claimed_at timestamptz not null default now()
);

-- Lock the table. Row Level Security with no policies means "no direct access".
alter table public.claims enable row level security;
revoke all on table public.claims from public, anon, authenticated;


-- Which gifts are claimed, and whether each claim belongs to the caller's device.
-- Returns only gift ids and a yes/no; hashes and times are never sent out.
create or replace function public.list_claims(p_token text)
returns table (gift_id text, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.gift_id,
         coalesce(c.token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex'), false)
  from public.claims c;
$$;


-- Claim a gift. Returns 'claimed', 'already_yours', or 'taken'.
-- If two people click at the same moment, the primary key guarantees exactly
-- one insert succeeds; the other person gets 'taken'.
create or replace function public.claim_gift(p_gift_id text, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash     text;
  v_existing text;
begin
  if p_gift_id is null or p_gift_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'Invalid gift id' using errcode = '22023';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid claim token' using errcode = '22023';
  end if;

  -- Safety cap so the table can't be flooded with junk ids.
  if (select count(*) from public.claims) >= 500 then
    raise exception 'Claim limit reached' using errcode = '54000';
  end if;

  v_hash := encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');

  insert into public.claims (gift_id, token_hash)
  values (p_gift_id, v_hash)
  on conflict (gift_id) do nothing;

  if found then
    return 'claimed';
  end if;

  select c.token_hash into v_existing from public.claims c where c.gift_id = p_gift_id;
  if v_existing = v_hash then
    return 'already_yours';
  end if;
  return 'taken';
end;
$$;


-- Undo a claim. Only works with the same device token that made it.
-- Returns true if a claim was removed.
create or replace function public.unclaim_gift(p_gift_id text, p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_gift_id is null or p_token is null then
    return false;
  end if;

  delete from public.claims c
  where c.gift_id = p_gift_id
    and c.token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');

  return found;
end;
$$;


-- Only these three functions are callable from the browser.
revoke all on function public.list_claims(text)        from public, anon, authenticated;
revoke all on function public.claim_gift(text, text)   from public, anon, authenticated;
revoke all on function public.unclaim_gift(text, text) from public, anon, authenticated;
grant execute on function public.list_claims(text)        to anon, authenticated;
grant execute on function public.claim_gift(text, text)   to anon, authenticated;
grant execute on function public.unclaim_gift(text, text) to anon, authenticated;

-- Tell Supabase's API to pick up the new functions right away.
notify pgrst, 'reload schema';
