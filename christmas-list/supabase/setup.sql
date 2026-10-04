-- =====================================================================
-- Christmas Wish Lists: database setup
--
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run again: it never deletes gifts or claims.
--
-- Tables (no browser can read or write any of them directly):
--   gifts         the wishlist items, edited by Clara and Cameron
--   claims        anonymous family claims, kept separate from gifts
--   list_owners   which login owns which list
--
-- Family page (no login), via these functions only:
--   get_list, claim_gift, release_claim, mark_purchased, mark_not_purchased
--
-- Owner page (logged in), via these functions only:
--   owner_list, owner_add_gift, owner_update_gift, owner_move_gift,
--   owner_archive_gift, owner_restore_gift
--   Each one works out the list from the login itself and never accepts
--   "which list" from the browser. None of them can see or touch claims.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Retire Round 1 objects (the old claims table used text gift ids).
-- The old table is renamed rather than deleted, just in case.
-- ---------------------------------------------------------------------
drop function if exists public.list_claims(text);
drop function if exists public.claim_gift(text, text);
drop function if exists public.unclaim_gift(text, text);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'claims'
      and column_name = 'gift_id' and data_type = 'text'
  ) then
    alter table public.claims rename to claims_round1_old;
    revoke all on table public.claims_round1_old from public, anon, authenticated;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.list_owners (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  recipient text not null unique check (recipient in ('clara', 'cameron'))
);

create table if not exists public.gifts (
  id          uuid primary key default gen_random_uuid(),
  recipient   text not null check (recipient in ('clara', 'cameron')),
  name        text not null check (char_length(name) between 1 and 120),
  details     text check (char_length(details) <= 1000),
  price       text check (char_length(price) <= 40),
  link        text check (link ~* '^https?://[^\s]+$' and char_length(link) <= 2000),
  image_url   text check (image_url ~* '^https?://[^\s]+$' and char_length(image_url) <= 2000),
  sort_order  integer not null default 0,
  revision    integer not null default 1,      -- goes up whenever the gift's wording/links change
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz                      -- set when the owner removes the gift (soft delete)
);
create index if not exists gifts_recipient_order on public.gifts (recipient, sort_order);

create table if not exists public.claims (
  gift_id       uuid primary key references public.gifts (id) on delete cascade, -- one claim per gift
  token_hash    text not null,          -- SHA-256 of the claiming browser's random token
  state         text not null default 'claimed' check (state in ('claimed', 'purchased')),
  gift_revision integer not null,       -- the gift's revision when it was claimed
  claimed_at    timestamptz not null default now(),
  purchased_at  timestamptz
);

-- Lock everything. RLS on with no policies = no direct access for browsers.
alter table public.list_owners enable row level security;
alter table public.gifts       enable row level security;
alter table public.claims      enable row level security;
revoke all on table public.list_owners, public.gifts, public.claims from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Private helpers (in a schema the API doesn't expose)
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
$$;

create or replace function private.check_token(p_token text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid browser token' using errcode = '22023';
  end if;
end;
$$;

-- The list the signed-in user owns, or an error if they don't own one.
create or replace function private.require_owner()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_recipient text;
begin
  select o.recipient into v_recipient
  from public.list_owners o
  where o.user_id = auth.uid();

  if v_recipient is null then
    raise exception 'This account is not linked to a wishlist' using errcode = '42501';
  end if;
  return v_recipient;
end;
$$;

-- Tidies and validates the owner form. Blank optional fields become null.
create or replace function private.clean_gift(
  p_name text, p_details text, p_price text, p_link text, p_image_url text,
  out name text, out details text, out price text, out link text, out image_url text)
language plpgsql
immutable
set search_path = ''
as $$
begin
  name      := nullif(btrim(p_name), '');
  details   := nullif(btrim(p_details), '');
  price     := nullif(btrim(p_price), '');
  link      := nullif(btrim(p_link), '');
  image_url := nullif(btrim(p_image_url), '');

  if name is null then
    raise exception 'Please give the gift a name' using errcode = '22023';
  elsif char_length(name) > 120 then
    raise exception 'The gift name is too long (120 characters max)' using errcode = '22023';
  elsif char_length(details) > 1000 then
    raise exception 'The details are too long (1000 characters max)' using errcode = '22023';
  elsif char_length(price) > 40 then
    raise exception 'The price is too long (40 characters max)' using errcode = '22023';
  elsif link is not null and (link !~* '^https?://[^\s]+$' or char_length(link) > 2000) then
    raise exception 'The shopping link must be a web address starting with http:// or https://' using errcode = '22023';
  elsif image_url is not null and (image_url !~* '^https?://[^\s]+$' or char_length(image_url) > 2000) then
    raise exception 'The image link must be a web address starting with http:// or https://' using errcode = '22023';
  end if;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;


-- =====================================================================
-- FAMILY FUNCTIONS (no login)
-- =====================================================================

-- Every gift on both lists with its anonymous status.
--   status  'available' | 'claimed' | 'purchased'
--   mine    true only for the browser that holds the claim
--   updated_since_claim   (mine only) the owner edited it after you claimed it
--   removed               (mine only) the owner removed it after you claimed it;
--                         removed gifts are only ever returned to their claimant
create or replace function public.get_list(p_token text)
returns table (
  id uuid, recipient text, name text, details text, price text, link text, image_url text,
  sort_order integer, status text, mine boolean, updated_since_claim boolean, removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select case when p_token ~ '^[0-9a-f]{64}$' then private.token_hash(p_token) end as hash
  )
  select g.id, g.recipient, g.name,
         case when g.archived_at is null then g.details end,
         case when g.archived_at is null then g.price end,
         case when g.archived_at is null then g.link end,
         case when g.archived_at is null then g.image_url end,
         g.sort_order,
         coalesce(c.state, 'available'),
         coalesce(c.token_hash = me.hash, false),
         coalesce(c.token_hash = me.hash and g.revision > c.gift_revision, false),
         g.archived_at is not null
  from public.gifts g
  cross join me
  left join public.claims c on c.gift_id = g.id
  where g.archived_at is null
     or (c.token_hash = me.hash)
  order by g.recipient, g.sort_order, g.created_at;
$$;

-- Claim a gift. Returns 'claimed', 'already_yours', 'taken' or 'gone'.
-- The primary key on claims.gift_id means two simultaneous claims can't both win.
create or replace function public.claim_gift(p_gift_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash     text;
  v_revision integer;
  v_existing text;
begin
  perform private.check_token(p_token);
  v_hash := private.token_hash(p_token);

  select g.revision into v_revision
  from public.gifts g
  where g.id = p_gift_id and g.archived_at is null;
  if not found then
    return 'gone';
  end if;

  insert into public.claims (gift_id, token_hash, gift_revision)
  values (p_gift_id, v_hash, v_revision)
  on conflict (gift_id) do nothing;
  if found then
    return 'claimed';
  end if;

  select c.token_hash into v_existing from public.claims c where c.gift_id = p_gift_id;
  return case when v_existing = v_hash then 'already_yours' else 'taken' end;
end;
$$;

-- Give up your own claim. Returns 'released', 'not_yours' or 'purchased'
-- (a purchased gift must be marked not purchased first, unless it was removed).
-- Releasing something that's no longer claimed counts as success, so retries are safe.
create or replace function public.release_claim(p_gift_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim   public.claims%rowtype;
  v_removed boolean;
begin
  perform private.check_token(p_token);

  select * into v_claim from public.claims c where c.gift_id = p_gift_id for update;
  if not found then
    return 'released';
  end if;
  if v_claim.token_hash <> private.token_hash(p_token) then
    return 'not_yours';
  end if;

  select g.archived_at is not null into v_removed from public.gifts g where g.id = p_gift_id;
  if v_claim.state = 'purchased' and not v_removed then
    return 'purchased';
  end if;

  delete from public.claims c where c.gift_id = p_gift_id;
  return 'released';
end;
$$;

-- Mark your claimed gift as bought. Returns 'purchased' or 'not_yours'. Safe to retry.
create or replace function public.mark_purchased(p_gift_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_token(p_token);

  update public.claims c
  set state = 'purchased', purchased_at = coalesce(c.purchased_at, now())
  where c.gift_id = p_gift_id
    and c.token_hash = private.token_hash(p_token)
    and exists (select 1 from public.gifts g where g.id = p_gift_id and g.archived_at is null);

  return case when found then 'purchased' else 'not_yours' end;
end;
$$;

-- Undo "purchased" (back to claimed by you). Returns 'claimed' or 'not_yours'. Safe to retry.
create or replace function public.mark_not_purchased(p_gift_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_token(p_token);

  update public.claims c
  set state = 'claimed', purchased_at = null
  where c.gift_id = p_gift_id
    and c.token_hash = private.token_hash(p_token)
    and exists (select 1 from public.gifts g where g.id = p_gift_id and g.archived_at is null);

  return case when found then 'claimed' else 'not_yours' end;
end;
$$;


-- =====================================================================
-- OWNER FUNCTIONS (signed in as Clara or Cameron)
-- Every function starts with private.require_owner(), which reads the list
-- from the login. Gift ids are always matched together with that list, so an
-- owner can never reach the other person's gifts. Nothing here reads claims.
-- =====================================================================

-- Which list this login owns ('clara' / 'cameron'), or null if none.
create or replace function public.owner_recipient()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.recipient from public.list_owners o where o.user_id = auth.uid();
$$;

-- The owner's own gifts (not removed ones), in display order. No claim info.
create or replace function public.owner_list()
returns table (id uuid, name text, details text, price text, link text, image_url text, sort_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_recipient text := private.require_owner();
begin
  return query
    select g.id, g.name, g.details, g.price, g.link, g.image_url, g.sort_order
    from public.gifts g
    where g.recipient = v_recipient and g.archived_at is null
    order by g.sort_order, g.created_at;
end;
$$;

-- Add a gift to the bottom of the owner's list. Returns the new id.
create or replace function public.owner_add_gift(
  p_name text, p_details text default null, p_price text default null,
  p_link text default null, p_image_url text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text := private.require_owner();
  v           record;
  v_id        uuid;
begin
  select * into v from private.clean_gift(p_name, p_details, p_price, p_link, p_image_url);

  insert into public.gifts (recipient, name, details, price, link, image_url, sort_order)
  values (v_recipient, v.name, v.details, v.price, v.link, v.image_url,
          coalesce((select max(g.sort_order) from public.gifts g where g.recipient = v_recipient), 0) + 1)
  returning gifts.id into v_id;
  return v_id;
end;
$$;

-- Edit a gift's wording/links. Claims are untouched; the revision only goes
-- up if something actually changed (that's what drives "Updated since you claimed it").
create or replace function public.owner_update_gift(
  p_id uuid, p_name text, p_details text default null, p_price text default null,
  p_link text default null, p_image_url text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text := private.require_owner();
  v           record;
begin
  select * into v from private.clean_gift(p_name, p_details, p_price, p_link, p_image_url);

  update public.gifts g
  set name = v.name, details = v.details, price = v.price, link = v.link, image_url = v.image_url,
      revision = g.revision + 1,
      updated_at = now()
  where g.id = p_id
    and g.recipient = v_recipient
    and g.archived_at is null
    and (g.name, g.details, g.price, g.link, g.image_url)
        is distinct from (v.name, v.details, v.price, v.link, v.image_url);

  if not found and not exists (
    select 1 from public.gifts g where g.id = p_id and g.recipient = v_recipient and g.archived_at is null
  ) then
    raise exception 'Gift not found on your list' using errcode = 'P0002';
  end if;
end;
$$;

-- Reorder: p_where is 'up', 'down', 'top' or 'bottom'.
create or replace function public.owner_move_gift(p_id uuid, p_where text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text := private.require_owner();
  v_ids       uuid[];
  v_pos       integer;
  v_n         integer;
begin
  if p_where is null or p_where not in ('up', 'down', 'top', 'bottom') then
    raise exception 'Unknown move' using errcode = '22023';
  end if;

  -- Lock this list's rows so two moves at once can't interleave.
  perform 1 from public.gifts g where g.recipient = v_recipient and g.archived_at is null for update;

  v_ids := array(
    select g.id from public.gifts g
    where g.recipient = v_recipient and g.archived_at is null
    order by g.sort_order, g.created_at
  );
  v_pos := array_position(v_ids, p_id);
  if v_pos is null then
    raise exception 'Gift not found on your list' using errcode = 'P0002';
  end if;
  v_n := cardinality(v_ids);

  if p_where = 'up' and v_pos > 1 then
    v_ids[v_pos] := v_ids[v_pos - 1];
    v_ids[v_pos - 1] := p_id;
  elsif p_where = 'down' and v_pos < v_n then
    v_ids[v_pos] := v_ids[v_pos + 1];
    v_ids[v_pos + 1] := p_id;
  elsif p_where = 'top' then
    v_ids := array_prepend(p_id, array_remove(v_ids, p_id));
  elsif p_where = 'bottom' then
    v_ids := array_append(array_remove(v_ids, p_id), p_id);
  end if;

  update public.gifts g
  set sort_order = u.ord
  from unnest(v_ids) with ordinality as u(id, ord)
  where g.id = u.id and g.recipient = v_recipient;
end;
$$;

-- Remove (soft delete). The gift disappears for family; any claim on it is kept,
-- so only its claimant sees a "removed after you claimed it" note.
create or replace function public.owner_archive_gift(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text := private.require_owner();
begin
  update public.gifts g
  set archived_at = now()
  where g.id = p_id and g.recipient = v_recipient and g.archived_at is null;
  if not found then
    raise exception 'Gift not found on your list' using errcode = 'P0002';
  end if;
end;
$$;

-- Undo a removal (used by the "Undo" button right after removing).
create or replace function public.owner_restore_gift(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text := private.require_owner();
begin
  update public.gifts g
  set archived_at = null
  where g.id = p_id and g.recipient = v_recipient and g.archived_at is not null;
  if not found then
    raise exception 'Gift not found on your list' using errcode = 'P0002';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- Who may call what. Postgres lets everyone run new functions by default,
-- so everything is revoked first and granted back narrowly.
-- ---------------------------------------------------------------------
revoke all on function
  public.get_list(text),
  public.claim_gift(uuid, text),
  public.release_claim(uuid, text),
  public.mark_purchased(uuid, text),
  public.mark_not_purchased(uuid, text),
  public.owner_recipient(),
  public.owner_list(),
  public.owner_add_gift(text, text, text, text, text),
  public.owner_update_gift(uuid, text, text, text, text, text),
  public.owner_move_gift(uuid, text),
  public.owner_archive_gift(uuid),
  public.owner_restore_gift(uuid)
from public, anon, authenticated;

-- Family functions: anyone with the page.
grant execute on function
  public.get_list(text),
  public.claim_gift(uuid, text),
  public.release_claim(uuid, text),
  public.mark_purchased(uuid, text),
  public.mark_not_purchased(uuid, text)
to anon, authenticated;

-- Owner functions: signed-in users only (and each one still checks list_owners).
grant execute on function
  public.owner_recipient(),
  public.owner_list(),
  public.owner_add_gift(text, text, text, text, text),
  public.owner_update_gift(uuid, text, text, text, text, text),
  public.owner_move_gift(uuid, text),
  public.owner_archive_gift(uuid),
  public.owner_restore_gift(uuid)
to authenticated;

-- Tell Supabase's API to pick up the changes right away.
notify pgrst, 'reload schema';
