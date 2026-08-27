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
  is_branch boolean not null default false,
  branch_name text,
  parent_identifier text,
  is_own_company boolean not null default false,
  source jsonb not null default '{}'::jsonb,
  unique nulls not distinct (scheme, identifier)
);

alter table analytics_organizations add column if not exists is_branch boolean not null default false;
alter table analytics_organizations add column if not exists branch_name text;
alter table analytics_organizations add column if not exists parent_identifier text;
alter table analytics_organizations drop constraint if exists analytics_organizations_scheme_identifier_key;
create unique index if not exists analytics_org_legal_entity_identifier_idx
  on analytics_organizations (scheme, identifier) where is_branch = false;

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

create index if not exists analytics_dataset_procurement_reverse_idx on analytics_dataset_procurements (procurement_id, dataset_id);
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
  cpv_name text,
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

create index if not exists analytics_lot_procurement_idx on analytics_lots (procurement_id);
create index if not exists analytics_item_procurement_idx on analytics_items (procurement_id);
create index if not exists analytics_item_lot_idx on analytics_items (lot_id) where lot_id is not null;
create index if not exists analytics_item_root_procurement_idx on analytics_items (procurement_id) where lot_id is null;
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
alter table analytics_items add column if not exists cpv_name text;

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
create index if not exists analytics_bid_procurement_amount_idx
  on analytics_bids (procurement_id, latest_amount, value_at desc) where latest_amount is not null;
create index if not exists analytics_bid_procurement_published_idx
  on analytics_bids (procurement_id) where is_published;
create index if not exists analytics_bid_published_lot_supplier_idx
  on analytics_bids (lot_id, supplier_id) where is_published;

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
create index if not exists analytics_award_procurement_idx on analytics_awards (procurement_id, decision_at);

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
  spending_checked_at timestamptz,
  currency text,
  vat_included boolean,
  termination_details text,
  completion_class text check (completion_class in ('active', 'completed', 'terminated_with_reason', 'cancelled', 'unknown')),
  source_modified_at timestamptz,
  source jsonb not null default '{}'::jsonb,
  unique (procurement_id, source_contract_id)
);

alter table analytics_contracts add column if not exists spending_checked_at timestamptz;

create index if not exists analytics_contract_supplier_idx on analytics_contracts (supplier_id, signed_at, status);
create index if not exists analytics_contract_buyer_idx on analytics_contracts (buyer_id, signed_at, status);
create index if not exists analytics_contract_procurement_idx on analytics_contracts (procurement_id, signed_at);

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

create index if not exists analytics_contract_change_contract_idx on analytics_contract_changes (contract_id);

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

create table if not exists analytics_tender_subscriptions (
  id text primary key,
  name text not null,
  recipients text[] not null,
  filters jsonb not null default '{}'::jsonb,
  preset_id text references analytics_filter_presets(id) on delete set null,
  owner_account_id text,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analytics_tender_subscriptions_active_idx
  on analytics_tender_subscriptions (active, updated_at desc);

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

-- Versioned monitoring rules. Directions are stable business entities, while
-- each rule set captures the exact CPV/term dictionary used for a decision.
create table if not exists analytics_monitoring_directions (
  id text primary key,
  slug text not null unique,
  label text not null,
  priority integer not null default 0,
  enabled_for_monitoring boolean not null default true,
  analysis_only boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into analytics_monitoring_directions (
  id, slug, label, priority, enabled_for_monitoring, analysis_only
) values
  ('conditioning', 'conditioning', 'Кондиціонування', 500, true, false),
  ('ventilation', 'ventilation', 'Вентиляція', 490, true, false),
  ('heating', 'heating', 'Опалення', 480, false, true),
  ('design', 'design', 'Проєктування та кошториси', 300, true, false),
  ('construction', 'construction', 'Будівництво та ремонти', 200, true, false)
on conflict (id) do nothing;

create table if not exists analytics_monitoring_rule_sets (
  id text primary key,
  version text not null unique,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  definition jsonb not null default '{}'::jsonb,
  checksum text,
  created_by text,
  published_by text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists analytics_monitoring_one_active_rule_set_idx
  on analytics_monitoring_rule_sets ((status)) where status = 'active';

insert into analytics_monitoring_rule_sets (
  id, version, title, status, definition, published_at
) select
  'monitoring-default',
  '2026.08.25.1',
  'Базові правила моніторингу',
  case when exists (
    select 1 from analytics_monitoring_rule_sets where status = 'active'
  ) then 'draft' else 'active' end,
  '{"normalization":"uk-ru-translit-wordforms-v1","primaryPriority":"climate-before-construction"}'::jsonb,
  now()
on conflict (id) do nothing;

create table if not exists analytics_monitoring_rule_directions (
  rule_set_id text not null references analytics_monitoring_rule_sets(id) on delete cascade,
  direction_id text not null references analytics_monitoring_directions(id),
  priority integer not null,
  enabled_for_monitoring boolean not null,
  analysis_only boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  primary key (rule_set_id, direction_id)
);

insert into analytics_monitoring_rule_directions (
  rule_set_id, direction_id, priority, enabled_for_monitoring, analysis_only
) values
  ('monitoring-default', 'conditioning', 500, true, false),
  ('monitoring-default', 'ventilation', 490, true, false),
  ('monitoring-default', 'heating', 480, false, true),
  ('monitoring-default', 'design', 300, true, false),
  ('monitoring-default', 'construction', 200, true, false)
on conflict (rule_set_id, direction_id) do nothing;

create table if not exists analytics_monitoring_rule_entries (
  id text primary key,
  rule_set_id text not null references analytics_monitoring_rule_sets(id) on delete cascade,
  direction_id text not null references analytics_monitoring_directions(id),
  entry_kind text not null check (entry_kind in ('cpv_include', 'cpv_exclude', 'term', 'brand', 'exclusion')),
  value text not null,
  normalized_value text not null,
  include_descendants boolean not null default false,
  field_scope text[] not null default '{procurement_title,procurement_description,lot_title,lot_description,item_description}',
  variants text[] not null default '{}',
  priority integer not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_set_id, direction_id, entry_kind, normalized_value)
);

create index if not exists analytics_monitoring_rule_entries_lookup_idx
  on analytics_monitoring_rule_entries (rule_set_id, direction_id, entry_kind, active);
create index if not exists analytics_monitoring_rule_entries_value_trgm_idx
  on analytics_monitoring_rule_entries using gin (normalized_value gin_trgm_ops);

insert into analytics_monitoring_rule_entries (
  id, rule_set_id, direction_id, entry_kind, value, normalized_value,
  include_descendants, variants, priority, metadata
) values
  ('mr-conditioning-cpv-3971', 'monitoring-default', 'conditioning', 'cpv_include', '39710000', '39710000', true, '{}', 100, '{"broad":true}'),
  ('mr-conditioning-cpv-4251', 'monitoring-default', 'conditioning', 'cpv_include', '42510000', '42510000', true, '{}', 100, '{}'),
  ('mr-conditioning-cpv-425130', 'monitoring-default', 'conditioning', 'cpv_include', '42513000', '42513000', true, '{}', 100, '{}'),
  ('mr-conditioning-cpv-4252', 'monitoring-default', 'conditioning', 'cpv_include', '42520000', '42520000', true, '{}', 100, '{}'),
  ('mr-conditioning-cpv-45331220', 'monitoring-default', 'conditioning', 'cpv_include', '45331220', '45331220', true, '{}', 100, '{}'),
  ('mr-conditioning-term-conditioner', 'monitoring-default', 'conditioning', 'term', 'кондиціонер', 'кондиціонер', false, '{кондиционер,conditioner}', 80, '{}'),
  ('mr-conditioning-term-split', 'monitoring-default', 'conditioning', 'term', 'спліт система', 'спліт система', false, '{"сплит система","split system"}', 80, '{}'),
  ('mr-conditioning-term-chiller', 'monitoring-default', 'conditioning', 'term', 'чилер', 'чилер', false, '{чиллер,chiller}', 80, '{}'),
  ('mr-conditioning-term-fancoil', 'monitoring-default', 'conditioning', 'term', 'фанкойл', 'фанкойл', false, '{fancoil,"fan coil"}', 80, '{}'),
  ('mr-conditioning-term-cooling', 'monitoring-default', 'conditioning', 'term', 'холодильне обладнання', 'холодильне обладнання', false, '{"холодильное оборудование"}', 80, '{}'),
  ('mr-conditioning-term-heat-pump', 'monitoring-default', 'conditioning', 'term', 'тепловий насос', 'тепловий насос', false, '{"тепловой насос"}', 80, '{}'),
  ('mr-conditioning-brand-daikin', 'monitoring-default', 'conditioning', 'brand', 'Daikin', 'daikin', false, '{}', 60, '{}'),
  ('mr-conditioning-brand-mitsubishi', 'monitoring-default', 'conditioning', 'brand', 'Mitsubishi', 'mitsubishi', false, '{}', 60, '{}'),
  ('mr-conditioning-brand-cooper', 'monitoring-default', 'conditioning', 'brand', 'Cooper&Hunter', 'cooper hunter', false, '{}', 60, '{}'),
  ('mr-conditioning-brand-gree', 'monitoring-default', 'conditioning', 'brand', 'Gree', 'gree', false, '{}', 60, '{}'),
  ('mr-conditioning-brand-midea', 'monitoring-default', 'conditioning', 'brand', 'Midea', 'midea', false, '{}', 60, '{}'),
  ('mr-conditioning-brand-tosot', 'monitoring-default', 'conditioning', 'brand', 'Tosot', 'tosot', false, '{}', 60, '{}'),
  ('mr-conditioning-brand-neoclima', 'monitoring-default', 'conditioning', 'brand', 'Neoclima', 'neoclima', false, '{}', 60, '{}'),
  ('mr-conditioning-brand-haier', 'monitoring-default', 'conditioning', 'brand', 'Haier', 'haier', false, '{}', 60, '{}'),
  ('mr-conditioning-excl-medical', 'monitoring-default', 'conditioning', 'exclusion', 'апарат штучної вентиляції легень', 'апарат штучної вентиляції легень', false, '{"аппарат искусственной вентиляции легких"}', 200, '{}'),
  ('mr-conditioning-excl-fan', 'monitoring-default', 'conditioning', 'exclusion', 'побутовий вентилятор', 'побутовий вентилятор', false, '{}', 200, '{}'),

  ('mr-ventilation-cpv-4252', 'monitoring-default', 'ventilation', 'cpv_include', '42520000', '42520000', true, '{}', 100, '{}'),
  ('mr-ventilation-cpv-45331210', 'monitoring-default', 'ventilation', 'cpv_include', '45331210', '45331210', true, '{}', 100, '{}'),
  ('mr-ventilation-cpv-45331220', 'monitoring-default', 'ventilation', 'cpv_include', '45331220', '45331220', true, '{}', 100, '{}'),
  ('mr-ventilation-term-main', 'monitoring-default', 'ventilation', 'term', 'вентиляція', 'вентиляція', false, '{вентиляция}', 80, '{}'),
  ('mr-ventilation-term-duct', 'monitoring-default', 'ventilation', 'term', 'повітровід', 'повітровід', false, '{воздуховод}', 80, '{}'),
  ('mr-ventilation-term-recuperator', 'monitoring-default', 'ventilation', 'term', 'рекуператор', 'рекуператор', false, '{}', 80, '{}'),
  ('mr-ventilation-term-supply', 'monitoring-default', 'ventilation', 'term', 'припливно витяжна', 'припливно витяжна', false, '{"приточно вытяжная"}', 80, '{}'),
  ('mr-ventilation-term-smoke', 'monitoring-default', 'ventilation', 'term', 'димовидалення', 'димовидалення', false, '{дымоудаление}', 80, '{}'),
  ('mr-ventilation-excl-medical', 'monitoring-default', 'ventilation', 'exclusion', 'апарат штучної вентиляції легень', 'апарат штучної вентиляції легень', false, '{"аппарат искусственной вентиляции легких"}', 200, '{}'),
  ('mr-ventilation-excl-floor', 'monitoring-default', 'ventilation', 'exclusion', 'вентилятор підлоговий', 'вентилятор підлоговий', false, '{}', 200, '{}'),

  ('mr-heating-cpv-397150', 'monitoring-default', 'heating', 'cpv_include', '39715000', '39715000', true, '{}', 100, '{}'),
  ('mr-heating-cpv-4216', 'monitoring-default', 'heating', 'cpv_include', '42160000', '42160000', true, '{}', 100, '{}'),
  ('mr-heating-cpv-4462', 'monitoring-default', 'heating', 'cpv_include', '44620000', '44620000', true, '{}', 100, '{}'),
  ('mr-heating-cpv-45331', 'monitoring-default', 'heating', 'cpv_include', '45331000', '45331000', true, '{}', 100, '{"broad":true}'),
  ('mr-heating-cpv-5072', 'monitoring-default', 'heating', 'cpv_include', '50720000', '50720000', true, '{}', 100, '{}'),
  ('mr-heating-term-system', 'monitoring-default', 'heating', 'term', 'система опалення', 'система опалення', false, '{"система отопления"}', 80, '{}'),
  ('mr-heating-term-supply', 'monitoring-default', 'heating', 'term', 'теплопостачання', 'теплопостачання', false, '{теплоснабжение}', 80, '{}'),
  ('mr-heating-term-boiler', 'monitoring-default', 'heating', 'term', 'котельня', 'котельня', false, '{котельная}', 80, '{}'),
  ('mr-heating-term-radiator', 'monitoring-default', 'heating', 'term', 'радіатор опалення', 'радіатор опалення', false, '{"радиатор отопления"}', 80, '{}'),

  ('mr-design-cpv-712', 'monitoring-default', 'design', 'cpv_include', '71200000', '71200000', true, '{}', 100, '{}'),
  ('mr-design-cpv-713', 'monitoring-default', 'design', 'cpv_include', '71300000', '71300000', true, '{}', 100, '{}'),
  ('mr-design-excl-cpv-road', 'monitoring-default', 'design', 'cpv_exclude', '71322500', '71322500', true, '{}', 200, '{}'),
  ('mr-design-term-pcd', 'monitoring-default', 'design', 'term', 'проєктно кошторисна документація', 'проєктно кошторисна документація', false, '{"проектно сметная документация","проектно кошторисна документація"}', 80, '{}'),
  ('mr-design-term-project', 'monitoring-default', 'design', 'term', 'розроблення проєкту', 'розроблення проєкту', false, '{"разработка проекта"}', 80, '{}'),
  ('mr-design-term-estimate', 'monitoring-default', 'design', 'term', 'кошторис', 'кошторис', false, '{смета,"сметный расчет"}', 80, '{}'),
  ('mr-design-excl-road', 'monitoring-default', 'design', 'exclusion', 'автомобільна дорога', 'автомобільна дорога', false, '{"автомобильная дорога"}', 200, '{}'),
  ('mr-design-excl-bridge', 'monitoring-default', 'design', 'exclusion', 'міст через', 'міст через', false, '{"мост через"}', 200, '{}'),

  ('mr-construction-cpv-450', 'monitoring-default', 'construction', 'cpv_include', '45000000', '45000000', true, '{}', 100, '{}'),
  ('mr-construction-cpv-451', 'monitoring-default', 'construction', 'cpv_include', '45100000', '45100000', true, '{}', 100, '{}'),
  ('mr-construction-cpv-452', 'monitoring-default', 'construction', 'cpv_include', '45200000', '45200000', true, '{}', 100, '{}'),
  ('mr-construction-cpv-453', 'monitoring-default', 'construction', 'cpv_include', '45300000', '45300000', true, '{}', 100, '{}'),
  ('mr-construction-cpv-454', 'monitoring-default', 'construction', 'cpv_include', '45400000', '45400000', true, '{}', 100, '{}'),
  ('mr-construction-excl-cpv-bridge', 'monitoring-default', 'construction', 'cpv_exclude', '45221000', '45221000', true, '{}', 200, '{}'),
  ('mr-construction-excl-cpv-road', 'monitoring-default', 'construction', 'cpv_exclude', '45233000', '45233000', true, '{}', 200, '{}'),
  ('mr-construction-excl-cpv-roadwork', 'monitoring-default', 'construction', 'cpv_exclude', '45233100', '45233100', true, '{}', 200, '{}'),
  ('mr-construction-term-capital', 'monitoring-default', 'construction', 'term', 'капітальний ремонт', 'капітальний ремонт', false, '{"капитальный ремонт"}', 80, '{}'),
  ('mr-construction-term-current', 'monitoring-default', 'construction', 'term', 'поточний ремонт', 'поточний ремонт', false, '{"текущий ремонт"}', 80, '{}'),
  ('mr-construction-term-reconstruction', 'monitoring-default', 'construction', 'term', 'реконструкція', 'реконструкція', false, '{реконструкция}', 80, '{}'),
  ('mr-construction-term-build', 'monitoring-default', 'construction', 'term', 'будівництво', 'будівництво', false, '{строительство}', 80, '{}'),
  ('mr-construction-term-restoration', 'monitoring-default', 'construction', 'term', 'реставрація', 'реставрація', false, '{реставрация}', 80, '{}'),
  ('mr-construction-excl-road', 'monitoring-default', 'construction', 'exclusion', 'автомобільна дорога', 'автомобільна дорога', false, '{"автомобильная дорога"}', 200, '{}'),
  ('mr-construction-excl-surface', 'monitoring-default', 'construction', 'exclusion', 'дорожнє покриття', 'дорожнє покриття', false, '{"дорожное покрытие"}', 200, '{}'),
  ('mr-construction-excl-cycle', 'monitoring-default', 'construction', 'exclusion', 'велосипедна доріжка', 'велосипедна доріжка', false, '{}', 200, '{}'),
  ('mr-construction-excl-rail', 'monitoring-default', 'construction', 'exclusion', 'залізнична дорога', 'залізнична дорога', false, '{}', 200, '{}'),
  ('mr-construction-excl-bridge', 'monitoring-default', 'construction', 'exclusion', 'міст через', 'міст через', false, '{"мост через"}', 200, '{}')
on conflict (id) do nothing;

-- A lot may match several directions and several reasons in the same rule
-- version. One row per direction keeps filtering simple; reasons preserve all
-- contributing fields and terms without inflating lot counts.
create table if not exists analytics_monitoring_matches (
  id text primary key,
  procurement_id text not null references analytics_procurements(id) on delete cascade,
  lot_id text not null references analytics_lots(id) on delete cascade,
  direction_id text not null references analytics_monitoring_directions(id),
  rule_set_id text not null references analytics_monitoring_rule_sets(id),
  rule_version text not null,
  confidence text not null check (confidence in ('high', 'medium', 'review')),
  is_primary boolean not null default false,
  reasons jsonb not null default '[]'::jsonb,
  matched_fields text[] not null default '{}',
  matched_cpv_codes text[] not null default '{}',
  matched_terms text[] not null default '{}',
  geography_basis text check (geography_basis in ('delivery', 'buyer_fallback', 'nationwide', 'unspecified')),
  needs_geography_review boolean not null default false,
  classified_at timestamptz not null default now(),
  source_modified_at timestamptz,
  unique (lot_id, direction_id, rule_set_id)
);

create index if not exists analytics_monitoring_matches_filter_idx
  on analytics_monitoring_matches (direction_id, confidence, is_primary, classified_at desc);
create index if not exists analytics_monitoring_matches_procurement_idx
  on analytics_monitoring_matches (procurement_id, lot_id);
create index if not exists analytics_monitoring_matches_lot_latest_idx
  on analytics_monitoring_matches (lot_id, classified_at desc);
create unique index if not exists analytics_monitoring_one_primary_match_idx
  on analytics_monitoring_matches (lot_id, rule_set_id) where is_primary;

create table if not exists analytics_relevance_reviews (
  id text primary key,
  procurement_id text not null references analytics_procurements(id) on delete cascade,
  lot_id text not null references analytics_lots(id) on delete cascade,
  direction_id text references analytics_monitoring_directions(id),
  status text not null check (status in ('relevant', 'not_relevant', 'needs_review', 'missed')),
  comment text,
  suggested_rule_change jsonb not null default '{}'::jsonb,
  reviewed_by text not null,
  reviewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (lot_id, direction_id)
);

create index if not exists analytics_relevance_reviews_status_idx
  on analytics_relevance_reviews (status, reviewed_at desc);
create index if not exists analytics_relevance_reviews_lot_latest_idx
  on analytics_relevance_reviews (lot_id, updated_at desc);

-- Preserve legal-name changes instead of overwriting the only visible name.
create table if not exists analytics_organization_name_history (
  id text primary key,
  organization_id text not null references analytics_organizations(id) on delete cascade,
  legal_name text not null,
  normalized_name text not null,
  source_name text not null default 'prozorro',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source jsonb not null default '{}'::jsonb,
  unique (organization_id, normalized_name)
);

create index if not exists analytics_organization_name_history_org_idx
  on analytics_organization_name_history (organization_id, last_seen_at desc);
create index if not exists analytics_organization_name_history_name_trgm_idx
  on analytics_organization_name_history using gin (normalized_name gin_trgm_ops);

-- Delivery channels are intentionally configured separately from read-only
-- source access. The worker can remain disabled until explicit write/send
-- credentials are provided.
create table if not exists analytics_notification_subscriptions (
  id text primary key,
  owner_account_id text not null,
  name text not null,
  channel text not null check (channel in ('email', 'webhook')),
  destination text not null,
  event_types text[] not null default '{new_match}',
  filter_definition jsonb not null default '{}'::jsonb,
  frequency text not null default 'immediate' check (frequency in ('immediate', 'hourly', 'daily')),
  active boolean not null default true,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_account_id, name)
);

create table if not exists analytics_notification_outbox (
  id text primary key,
  subscription_id text not null references analytics_notification_subscriptions(id) on delete cascade,
  event_type text not null,
  event_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, event_type, event_key)
);

create index if not exists analytics_notification_outbox_delivery_idx
  on analytics_notification_outbox (status, available_at, created_at);

create table if not exists analytics_table_sync_configs (
  id text primary key,
  owner_account_id text not null,
  name text not null,
  provider text not null check (provider in ('microsoft_excel', 'google_sheets', 'webhook')),
  target_reference jsonb not null,
  filter_definition jsonb not null default '{}'::jsonb,
  column_mapping jsonb not null default '{}'::jsonb,
  mode text not null default 'upsert' check (mode in ('append', 'upsert', 'replace')),
  active boolean not null default true,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_account_id, name)
);

create table if not exists analytics_table_sync_runs (
  id text primary key,
  config_id text not null references analytics_table_sync_configs(id) on delete cascade,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  rows_written integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists analytics_table_sync_runs_config_idx
  on analytics_table_sync_runs (config_id, started_at desc);
