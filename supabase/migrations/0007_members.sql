-- People who signed in (email link) to use the refund calculator. Supabase Auth holds the login
-- itself; this table records marketing consent, which must be a separate, explicit opt-in.

create table if not exists members (
  user_id uuid primary key,
  email text not null,
  marketing_opt_in boolean not null default false,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);
create index if not exists members_email_idx on members (email);

alter table members enable row level security;
