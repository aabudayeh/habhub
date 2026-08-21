-- Activate canonical social push emitters only after the expanded schema is
-- visible through PostgREST and the dual-stack send-push Edge function is live.
-- This separate transaction prevents old APK requests from being sent once by
-- the legacy Edge and then replayed from a newly-created outbox row.

drop trigger if exists group_challenges_emit_feed_events
  on public.group_challenges;
drop trigger if exists group_challenges_emit_notification_events
  on public.group_challenges;
create trigger group_challenges_emit_notification_events
after insert or update of accepted_participant_ids
on public.group_challenges
for each row
execute function public.emit_group_challenge_notification_events();

drop trigger if exists group_members_emit_push_event
  on public.group_members;
create trigger group_members_emit_push_event
after insert or update of status or delete
on public.group_members
for each row
execute function public.emit_group_membership_push_event();

drop trigger if exists metric_entries_emit_group_push_event
  on public.metric_entries;
create trigger metric_entries_emit_group_push_event
after insert on public.metric_entries
for each row
execute function public.emit_group_metric_push_event();

update public.push_dispatch_configuration
   set emitters_active = true,
       updated_at = clock_timestamp()
 where singleton = true;

notify pgrst, 'reload schema';
