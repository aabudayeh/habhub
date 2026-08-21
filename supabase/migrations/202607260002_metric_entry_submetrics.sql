alter table public.metric_entries
  add column if not exists submetric_values jsonb;

comment on column public.metric_entries.submetric_values is
  'Named values recorded for compound trackers such as blood pressure and nutrition.';

-- metric_entries already has row-level security. This additive column inherits
-- the same owner/group access policies as the rest of each entry.
