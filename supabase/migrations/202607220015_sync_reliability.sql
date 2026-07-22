-- Allow idempotent client message upserts. Earlier policies permitted inserts
-- but rejected the UPDATE branch of ON CONFLICT, which made chat failures
-- cascade into workspace-sync warnings.
drop policy if exists messages_sender_update on public.messages;
create policy messages_sender_update on public.messages
for update to authenticated
using (sender_id = auth.uid())
with check (
  sender_id = auth.uid()
  and public.is_group_member(group_id)
  and (
    recipient_id is null
    or exists (
      select 1
      from public.group_members recipient
      where recipient.group_id = messages.group_id
        and recipient.user_id = messages.recipient_id
        and coalesce(recipient.status, 'active') = 'active'
    )
  )
);

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
