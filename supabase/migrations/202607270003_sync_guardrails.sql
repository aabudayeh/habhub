-- Goal progress uses layered shading for values beyond the first completed
-- target. The mobile client intentionally publishes up to three goal layers.
alter table public.daily_metric_status
  drop constraint if exists daily_metric_status_goal_progress_check;

alter table public.daily_metric_status
  add constraint daily_metric_status_goal_progress_check
  check (goal_progress >= 0 and goal_progress <= 300);

-- Existing direct messages remain editable by their sender after a recipient
-- leaves a group. Inserts still use the stricter recipient-membership policy.
drop policy if exists messages_sender_update on public.messages;
create policy messages_sender_update
  on public.messages
  for update
  to authenticated
  using (sender_id = auth.uid())
  with check (
    sender_id = auth.uid()
    and public.is_group_member(group_id)
  );
