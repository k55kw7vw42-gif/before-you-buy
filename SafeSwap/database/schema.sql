-- SafeSwap MVP schema
-- Target: Supabase (Postgres). Paste into Supabase SQL Editor and run once.
-- Cost: $0 — well within the Supabase free tier (500 MB DB, 50k MAU auth).
--
-- Design notes (see chat for full rationale):
--   * Users live in Supabase's built-in `auth.users`; `profiles` extends it.
--   * Status model: pending -> funded -> confirmed -> released, with
--     `cancelled` as an off-ramp. This is 2 states beyond the literal
--     pending/confirmed/released ask — flagged, adjust if you disagree.
--   * The deal creator is always the seller (only sellers need a Stripe
--     Connect account). Buyers join an existing deal via join_code.
--   * There is NO client-side UPDATE policy on `deals`. Every state
--     transition (join, fund, confirm, release, cancel) must go through a
--     Supabase Edge Function using the service-role key. The anon key used
--     by the Swift app can only INSERT its own deal and SELECT deals it's
--     party to. This is what stops a modified client from just marking
--     itself "released" without paying.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profiles: one row per auth.users row, holds app-specific fields
-- ---------------------------------------------------------------------
create table public.profiles (
  id                        uuid primary key references auth.users(id) on delete cascade,
  email                     text not null,
  display_name              text,
  stripe_account_id         text,               -- Stripe Connect account id (sellers only, set in step 3)
  stripe_onboarding_complete boolean not null default false,
  created_at                timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------

-- Short human-typeable code for the "join a deal via link/code" screen.
-- 6 chars from a 32-char alphabet (~1 billion combos) is fine for MVP
-- volumes; the unique constraint below makes a collision fail loudly
-- rather than silently overwrite someone else's deal.
create or replace function public.generate_join_code()
returns text
language sql
volatile
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

create table public.deals (
  id                     uuid primary key default gen_random_uuid(),
  join_code              text not null unique default public.generate_join_code(),

  seller_id              uuid not null references public.profiles(id),
  buyer_id               uuid references public.profiles(id),  -- null until someone joins

  item_description       text not null,
  price_cents            integer not null check (price_cents > 0),
  currency               text not null default 'usd',

  status                 text not null default 'pending'
                           check (status in ('pending', 'funded', 'confirmed', 'released', 'cancelled')),

  qr_secret              text not null default encode(gen_random_bytes(16), 'hex'),

  stripe_payment_intent_id text,   -- set once buyer pays (step 3)
  stripe_transfer_id       text,   -- set once funds are released to seller (step 3)

  created_at             timestamptz not null default now(),
  funded_at              timestamptz,
  confirmed_at           timestamptz,
  released_at            timestamptz,
  cancelled_at           timestamptz
);

create index deals_seller_id_idx on public.deals(seller_id);
create index deals_buyer_id_idx on public.deals(buyer_id);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.deals enable row level security;

-- profiles: you can only read/update your own row. Inserts happen only
-- via the trigger above (security definer), never directly from a client.
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- deals: you can see a deal only if you're the seller or the buyer.
create policy "deals: select if party to it"
  on public.deals for select
  using (auth.uid() = seller_id or auth.uid() = buyer_id);

-- deals: creating a deal is allowed directly from the client, but only
-- as yourself, as the seller, in the initial pending/unpaid state.
create policy "deals: insert own as seller"
  on public.deals for insert
  with check (
    auth.uid() = seller_id
    and buyer_id is null
    and status = 'pending'
  );

-- Deliberately no UPDATE or DELETE policy for deals. All transitions
-- (join by code, fund, confirm via QR, release, cancel) go through
-- Edge Functions using the service-role key — see step 3.
