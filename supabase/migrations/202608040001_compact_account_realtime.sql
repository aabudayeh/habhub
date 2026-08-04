-- Compact private account invalidation.
--
-- Postgres Changes on user_snapshots includes the full JSONB payload on every
-- UPDATE. A second device then fetched the same snapshot again, doubling
-- database/realtime egress. Broadcast only the revision metadata; authorized
-- clients fetch the snapshot once and continue rendering their local cache.

drop policy if exists habhub_account_broadcast_read on realtime.messages;
create policy habhub_account_broadcast_read
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) =
    'account:' || (select auth.uid())::text || ':snapshot'
);

create or replace function public.broadcast_account_snapshot_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'revision', new.revision,
        'device_id', new.device_id,
        'updated_at', new.updated_at
      ),
      'snapshot_updated',
      'account:' || new.user_id::text || ':snapshot',
      true
    );
  exception when others then
    raise warning 'HabHub account snapshot broadcast failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists account_snapshot_revision_broadcast
on public.user_snapshots;
create trigger account_snapshot_revision_broadcast
after insert or update on public.user_snapshots
for each row execute function public.broadcast_account_snapshot_revision();
