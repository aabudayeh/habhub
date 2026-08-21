alter table public.messages
  add column if not exists push_dispatched_at timestamptz;

create index if not exists messages_pending_push_idx
  on public.messages (group_id, sender_id, created_at)
  where push_dispatched_at is null;

-- Existing message RLS remains authoritative. The service-role push function
-- alone writes delivery state, so no additional client policy is required.
