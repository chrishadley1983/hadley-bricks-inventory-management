-- Migration 007: Enable Banking integration (additive/non-destructive)

create table if not exists finance.enable_banking_sessions (
  id            uuid primary key default gen_random_uuid(),
  session_id    text not null unique,
  aspsp_name    text,
  aspsp_country text,
  psu_type      text default 'personal',
  status        text not null default 'active',
  valid_until   timestamptz not null,
  raw           jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table finance.enable_banking_sessions is
  'Enable Banking consent sessions. Stores only the session id + expiry, never tokens or credentials.';

alter table finance.accounts
  add column if not exists enable_banking_account_uid text,
  add column if not exists enable_banking_session_id  uuid
    references finance.enable_banking_sessions(id) on delete set null,
  add column if not exists sync_enabled boolean not null default false,
  add column if not exists last_sync_at timestamptz;

create index if not exists idx_accounts_eb_uid
  on finance.accounts(enable_banking_account_uid)
  where enable_banking_account_uid is not null;

create unique index if not exists uq_transactions_eb_ref
  on finance.transactions(account_id, hsbc_transaction_id)
  where hsbc_transaction_id is not null;;
