create table if not exists finance.truelayer_connections (
  id               uuid primary key default gen_random_uuid(),
  provider_id      text,
  provider_name    text,
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  scope            text,
  status           text not null default 'active',
  raw              jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table finance.truelayer_connections is
  'TrueLayer OAuth connections (access/refresh tokens). Service-role only; RLS denies all other access.';

alter table finance.truelayer_connections enable row level security;

alter table finance.accounts
  add column if not exists truelayer_account_id    text,
  add column if not exists truelayer_connection_id uuid
    references finance.truelayer_connections(id) on delete set null;

create index if not exists idx_accounts_tl_acct
  on finance.accounts(truelayer_account_id)
  where truelayer_account_id is not null;;
