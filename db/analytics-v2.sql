-- Analytics v2 canonical store. Safe to run repeatedly.
-- Raw source payloads remain in Blob; PostgreSQL holds queryable facts only.

create extension if not exists pg_trgm;

create table if not exists analytics_datasets (
  id text primary key,
  scope_mode text not null check (scope_mode in ('monitoring', 'expanded')),
  filter_definition jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null,
  source_updated_at timestamptz,
  source_name text not null,
  status text not null check (status in ('building', 'ready', 'failed')),
  failure_count integer not null default 0,
  coverage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists analytics_organizations (
  id text primary key,
  scheme text,
  identifier text,
  legal_name text not null,
  normalized_name text not null,
  region text,
  locality text,
  address jsonb,
  is_own_company boolean not null default false,
  source jsonb not null default '{}'::jsonb,
  unique nulls not distinct (scheme, identifier)
);

create index if not exists analytics_org_identifier_idx on analytics_organizations (identifier);
create index if not exists analytics_org_name_trgm_idx on analytics_organizations using gin (normalized_name gin_trgm_ops);

create table if not exists analytics_procurements (
  id text primary key,
  tender_id text not null,
  title text not null,
  description text,
  buyer_id text references analytics_organizations(id),
  procurement_method text,
  procurement_method_type text,
  main_category text,
  status text,
  cpv_code text,
  department text,
  relevance jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  expected_amount numeric,
  expected_currency text,
  expected_vat_included boolean,
  submission_start_at timestamptz,
  submission_end_at timestamptz,
  auction_start_at timestamptz,
  auction_end_at timestamptz,
  guarantee_amount numeric,
  guarantee_currency text,
  payment_terms jsonb not null default '[]'::jsonb,
  prozorro_url text not null,
  source_modified_at timestamptz,
  source jsonb not null default '{}'::jsonb,
  unique (tender_id)
);

create table if not exists analytics_dataset_procurements (
  dataset_id text not null references analytics_datasets(id) on delete cascade,
  procurement_id text not null references analytics_procurements(id) on delete cascade,
  primary key (dataset_id, procurement_id)
);

create index if not exists analytics_procurement_publication_idx on analytics_procurements (published_at);
create index if not exists analytics_procurement_filter_idx on analytics_procurements (department, cpv_code, main_category, procurement_method_type, status);
create index if not exists analytics_procurement_title_trgm_idx on analytics_procurements using gin (title gin_trgm_ops);

create table if not exists analytics_lots (
  id text primary key,
  procurement_id text not null references analytics_procurements(id) on delete cascade,
  source_lot_id text,
  title text,
  description text,
  status text,
  expected_amount numeric,
  expected_currency text,
  expected_vat_included boolean,
  is_synthetic_root boolean not null default false,
  source jsonb not null default '{}'::jsonb,
  unique nulls not distinct (procurement_id, source_lot_id)
);

create table if not exists analytics_items (
  id text primary key,
  procurement_id text not null references analytics_procurements(id) on delete cascade,
  lot_id text references analytics_lots(id) on delete cascade,
  description text,
  cpv_code text,
  quantity numeric,
  unit_code text,
  delivery_start_at timestamptz,
  delivery_end_at timestamptz,
  delivery_address jsonb,
  delivery_region text,
  delivery_locality text,
  delivery_text text,
  source jsonb not null default '{}'::jsonb
);

create index if not exists analytics_item_location_idx on analytics_items (delivery_region, delivery_locality);
create index if not exists analytics_item_delivery_trgm_idx on analytics_items using gin (delivery_text gin_trgm_ops);

alter table analytics_procurements add column if not exists submission_start_at timestamptz;
alter table analytics_procurements add column if not exists submission_end_at timestamptz;
alter table analytics_procurements add column if not exists auction_start_at timestamptz;
alter table analytics_procurements add column if not exists auction_end_at timestamptz;
alter table analytics_procurements add column if not exists guarantee_amount numeric;
alter table analytics_procurements add column if not exists guarantee_currency text;
alter table analytics_procurements add column if not exists payment_terms jsonb not null default '[]'::jsonb;
alter table analytics_items add column if not exists delivery_start_at timestamptz;
alter table analytics_items add column if not exists delivery_end_at timestamptz;

create table if not exists analytics_bids (
  id text primary key,
  procurement_id text not null references analytics_procurements(id) on delete cascade,
  lot_id text not null references analytics_lots(id) on delete cascade,
  source_bid_id text not null,
  supplier_id text not null references analytics_organizations(id),
  status text,
  submitted_at timestamptz,
  value_at timestamptz,
  latest_amount numeric,
  initial_amount numeric,
  currency text,
  vat_included boolean,
  is_published boolean not null default true,
  source jsonb not null default '{}'::jsonb,
  unique (lot_id, source_bid_id, supplier_id)
);

create index if not exists analytics_bid_supplier_idx on analytics_bids (supplier_id, value_at);
create index if not exists analytics_bid_lot_amount_idx on analytics_bids (lot_id, latest_amount);

create table if not exists analytics_awards (
  id text primary key,
  procurement_id text not null references analytics_procurements(id) on delete cascade,
  lot_id text not null references analytics_lots(id) on delete cascade,
  source_award_id text not null,
  bid_id text references analytics_bids(id),
  supplier_id text not null references analytics_organizations(id),
  status text not null,
  decision_at timestamptz,
  amount numeric,
  currency text,
  vat_included boolean,
  qualified boolean,
  eligible boolean,
  reason_title text,
  reason_description text,
  source jsonb not null default '{}'::jsonb,
  unique (procurement_id, source_award_id)
);

create index if not exists analytics_award_supplier_idx on analytics_awards (supplier_id, decision_at, status);

create table if not exists analytics_contracts (
  id text primary key,
  procurement_id text not null references analytics_procurements(id) on delete cascade,
  lot_id text references analytics_lots(id) on delete set null,
  award_id text references analytics_awards(id) on delete set null,
  source_contract_id text not null,
  contract_id text,
  contract_number text,
  supplier_id text not null references analytics_organizations(id),
  buyer_id text not null references analytics_organizations(id),
  status text not null,
  signed_at timestamptz,
  initial_amount numeric,
  current_amount numeric,
  amount_paid numeric,
  currency text,
  vat_included boolean,
  termination_details text,
  completion_class text check (completion_class in ('active', 'completed', 'terminated_with_reason', 'cancelled', 'unknown')),
  source_modified_at timestamptz,
  source jsonb not null default '{}'::jsonb,
  unique (procurement_id, source_contract_id)
);

create index if not exists analytics_contract_supplier_idx on analytics_contracts (supplier_id, signed_at, status);
create index if not exists analytics_contract_buyer_idx on analytics_contracts (buyer_id, signed_at, status);

create table if not exists analytics_contract_changes (
  id text primary key,
  contract_id text not null references analytics_contracts(id) on delete cascade,
  source_change_id text not null,
  changed_at timestamptz,
  signed_at timestamptz,
  rationale text,
  rationale_types text[] not null default '{}',
  status text,
  source jsonb not null default '{}'::jsonb,
  unique (contract_id, source_change_id)
);

create table if not exists analytics_payments (
  id text primary key,
  contract_id text references analytics_contracts(id) on delete cascade,
  source_name text not null,
  source_payment_id text not null,
  paid_at date,
  amount numeric not null,
  currency text not null,
  payer_identifier text,
  recipient_identifier text,
  purpose text,
  match_confidence text not null check (match_confidence in ('confirmed', 'probable', 'unmatched')),
  match_evidence jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  unique (source_name, source_payment_id)
);

create index if not exists analytics_payment_contract_idx on analytics_payments (contract_id, match_confidence, paid_at);

create table if not exists analytics_filter_presets (
  id text primary key,
  owner_account_id text not null,
  name text not null,
  schema_version integer not null default 1,
  filters jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_account_id, name)
);

create index if not exists analytics_filter_presets_owner_idx on analytics_filter_presets (owner_account_id, updated_at desc);

create table if not exists analytics_our_status (
  procurement_id text primary key references analytics_procurements(id) on delete cascade,
  source_name text not null check (source_name in ('prozorro', 'crm')),
  status text,
  reason text,
  updated_at timestamptz,
  source jsonb not null default '{}'::jsonb
);

-- Durable cursors and leases make cron runs resumable and prevent two instances
-- from publishing the same stream concurrently.
create table if not exists analytics_sync_state (
  stream_key text primary key,
  cursor_value text,
  lease_token text,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  processed_count bigint not null default 0,
  imported_count bigint not null default 0,
  failure_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists analytics_sync_lease_idx on analytics_sync_state (lease_expires_at);

-- Expanded searches are durable requests. A cron worker can progressively fill
-- them without making an API request wait for a long Prozorro backfill.
create table if not exists analytics_sync_requests (
  id text primary key,
  owner_account_id text not null,
  dataset_id text not null references analytics_datasets(id) on delete cascade,
  filter_definition jsonb not null,
  status text not null check (status in ('pending', 'syncing', 'ready', 'failed')),
  requested_at timestamptz not null default now(),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  failure_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists analytics_sync_requests_status_idx on analytics_sync_requests (status, requested_at);

create table if not exists analytics_sync_queue (
  dataset_id text not null,
  tender_id text not null,
  scope_mode text not null check (scope_mode in ('monitoring', 'expanded')),
  direction text,
  source_name text not null,
  filter_definition jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  attempts integer not null default 0,
  last_error text,
  available_at timestamptz not null default now(),
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dataset_id, tender_id)
);

create index if not exists analytics_sync_queue_available_idx on analytics_sync_queue (available_at, priority desc, discovered_at);

-- Operational tender workspace. Source facts stay normalized in analytics_*;
-- this table stores only workflow state entered by the team.
create table if not exists tender_work_items (
  id text primary key,
  procurement_id text not null unique references analytics_procurements(id) on delete cascade,
  direction text not null,
  participation_decision text not null default 'undecided'
    check (participation_decision in ('undecided', 'participate', 'skip', 'partner')),
  workflow_status text not null default 'new'
    check (workflow_status in ('new', 'review', 'preparing', 'submitted', 'qualification', 'won', 'lost', 'contract', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  assigned_account_id text,
  decision_reason text,
  action_note text,
  manager_note text,
  next_action_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text,
  version integer not null default 1
);

alter table tender_work_items add column if not exists workbook_tracked boolean not null default false;
alter table tender_work_items add column if not exists workbook_snapshot jsonb not null default '{}'::jsonb;

create index if not exists tender_work_direction_idx on tender_work_items (direction, workflow_status, participation_decision);
create index if not exists tender_work_assignee_idx on tender_work_items (assigned_account_id, next_action_at);
create index if not exists tender_work_deadline_idx on tender_work_items (direction, next_action_at);

create table if not exists tender_work_events (
  id text primary key,
  work_item_id text not null references tender_work_items(id) on delete cascade,
  actor_account_id text not null,
  event_type text not null check (event_type in ('created', 'updated', 'source-refresh')),
  changed_fields text[] not null default '{}',
  previous_state jsonb not null default '{}'::jsonb,
  next_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tender_work_events_item_idx on tender_work_events (work_item_id, created_at desc);
