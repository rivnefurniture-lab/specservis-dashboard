-- Restricted executive turnover store. Safe to run repeatedly.
create schema if not exists confidential;
revoke all on schema confidential from public;

create table if not exists confidential.turnover_sources (
  id text primary key,
  schema_version integer not null,
  source_filename text not null,
  source_sha256 text not null unique check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_modified_at timestamptz not null,
  imported_at timestamptz not null,
  sheet_name text not null,
  row_count integer not null check (row_count > 0),
  warnings jsonb not null default '[]'::jsonb,
  status text not null check (status in ('building', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists confidential.turnover_months (
  source_id text not null references confidential.turnover_sources(id) on delete cascade,
  period date not null,
  source_row integer not null,
  promtech_gross numeric,
  promtech_core numeric,
  refkey_bank numeric,
  specservis_bank numeric,
  fop_naryshkov numeric,
  fop_pashkov numeric,
  fop_danilenko numeric,
  refkey_cash numeric,
  specservis_cash numeric,
  base_turnover numeric,
  fte numeric,
  payroll numeric,
  source_turnover_per_fte numeric,
  coca_cola_promtech numeric,
  coca_cola_specservis numeric,
  abinbev numeric,
  primary key (source_id, period)
);

create index if not exists confidential_turnover_month_period_idx on confidential.turnover_months (period);

create table if not exists confidential.settings (
  key text primary key,
  source_id text not null references confidential.turnover_sources(id),
  updated_at timestamptz not null default now()
);
