begin;

-- Account-scoped cleanup must not scan every group's social history. Existing
-- target/feed indexes lead with group_id, so add narrow author indexes for the
-- deletion path and the reported-user redaction lookup.
create index if not exists group_social_reactions_user_id_idx
  on public.group_social_reactions (user_id);
create index if not exists group_social_comments_user_id_idx
  on public.group_social_comments (user_id);
create index if not exists messages_sender_id_idx
  on public.messages (sender_id)
  where sender_id is not null;
create index if not exists photo_updates_owner_user_id_idx
  on public.photo_updates (owner_user_id);
create index if not exists group_todos_creator_id_idx
  on public.group_todos (creator_id);
create index if not exists user_safety_reports_reported_user_id_idx
  on public.user_safety_reports (reported_user_id)
  where reported_user_id is not null;

-- A deleting reporter must not be able to erase an unresolved abuse report
-- before the service operator has reviewed it. The report table is service-only
-- under RLS; detach the reporter identity while retaining the queued evidence.
alter table public.user_safety_reports
  alter column reporter_id drop not null;
alter table public.user_safety_reports
  drop constraint if exists user_safety_reports_reporter_id_fkey;
alter table public.user_safety_reports
  add constraint user_safety_reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles(id) on delete set null;

-- Account deletion starts by committing a durable, attempt-owned guard. Keep
-- every attributed shared-content write behind that same guard so a valid JWT,
-- a legacy client, or a privileged asynchronous writer cannot recreate content
-- between the explicit purge and auth.users deletion.
create or replace function public.habhub_reject_guarded_shared_content_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attribution_column text;
  attributed_user_id uuid;
  previous_attributed_user_id uuid;
begin
  attribution_column := case tg_table_name
    when 'messages' then 'sender_id'
    when 'group_social_reactions' then 'user_id'
    when 'group_social_comments' then 'user_id'
    when 'metric_entries' then 'user_id'
    when 'photo_updates' then 'owner_user_id'
    when 'group_todos' then 'creator_id'
    when 'group_challenges' then 'creator_id'
    when 'templates' then 'creator_user_id'
    else null
  end;
  attributed_user_id := nullif(
    pg_catalog.to_jsonb(new) ->> attribution_column,
    ''
  )::uuid;
  if tg_op = 'UPDATE' then
    previous_attributed_user_id := nullif(
      pg_catalog.to_jsonb(old) ->> attribution_column,
      ''
    )::uuid;
  end if;
  if exists (
    select 1
    from public.google_health_account_deletion_guards guard
    where guard.user_id in (
      attributed_user_id,
      previous_attributed_user_id
    )
  ) then
    raise exception 'habhub_account_deleting' using errcode = '55000';
  end if;

  -- Challenge rosters are UUID arrays rather than attributed scalar columns.
  -- Reject only a newly introduced guarded identity: an existing challenge can
  -- still be updated by the purge transaction while it removes one account,
  -- including when another participant is also deleting their account.
  if tg_table_name = 'group_challenges' then
    if tg_op = 'INSERT' then
      if exists (
        select 1
        from public.google_health_account_deletion_guards guard
        where guard.user_id = any(coalesce(new.participant_ids, array[]::uuid[]))
           or guard.user_id = any(coalesce(new.accepted_participant_ids, array[]::uuid[]))
           or guard.user_id = any(coalesce(new.declined_participant_ids, array[]::uuid[]))
      ) then
        raise exception 'habhub_account_deleting' using errcode = '55000';
      end if;
    elsif exists (
      select 1
      from public.google_health_account_deletion_guards guard
      where (
          guard.user_id = any(coalesce(new.participant_ids, array[]::uuid[]))
          and not (
            guard.user_id = any(coalesce(old.participant_ids, array[]::uuid[]))
          )
        )
        or (
          guard.user_id = any(coalesce(new.accepted_participant_ids, array[]::uuid[]))
          and not (
            guard.user_id = any(coalesce(old.accepted_participant_ids, array[]::uuid[]))
          )
        )
        or (
          guard.user_id = any(coalesce(new.declined_participant_ids, array[]::uuid[]))
          and not (
            guard.user_id = any(coalesce(old.declined_participant_ids, array[]::uuid[]))
          )
        )
    ) then
      raise exception 'habhub_account_deleting' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.habhub_reject_guarded_shared_content_write()
  from public, anon, authenticated;

-- Private account snapshots cache relational group shells so they can open
-- offline.  Remove an account identifier at every JSON depth without deleting
-- another person's unrelated private state.  Array objects directly attributed
-- to the account (members, authored cached rows, notifications, and plans) are
-- removed as a unit; nested group objects are retained and recursively cleaned.
create or replace function public.habhub_scrub_snapshot_account_identifier(
  p_value jsonb,
  p_user_id uuid
)
returns jsonb
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  value_type text := pg_catalog.jsonb_typeof(p_value);
  user_text text := p_user_id::text;
  result jsonb;
  item record;
begin
  if value_type = 'object' then
    result := '{}'::jsonb;
    for item in
      select entry.key, entry.value
      from pg_catalog.jsonb_each(p_value) entry
    loop
      if pg_catalog.strpos(item.key, user_text) > 0 then
        continue;
      end if;
      if pg_catalog.jsonb_typeof(item.value) = 'string'
         and pg_catalog.strpos(item.value #>> '{}', user_text) > 0 then
        continue;
      end if;
      result := result || pg_catalog.jsonb_build_object(
        item.key,
        public.habhub_scrub_snapshot_account_identifier(
          item.value,
          p_user_id
        )
      );
    end loop;
    return result;
  end if;

  if value_type = 'array' then
    result := '[]'::jsonb;
    for item in
      select element.value
      from pg_catalog.jsonb_array_elements(p_value) element
    loop
      if pg_catalog.jsonb_typeof(item.value) = 'string'
         and pg_catalog.strpos(item.value #>> '{}', user_text) > 0 then
        continue;
      end if;
      if pg_catalog.jsonb_typeof(item.value) = 'object'
         and (
           item.value ->> 'id' = user_text
           or item.value ->> 'userId' = user_text
           or item.value ->> 'user_id' = user_text
           or item.value ->> 'memberId' = user_text
           or item.value ->> 'member_id' = user_text
           or item.value ->> 'senderId' = user_text
           or item.value ->> 'sender_id' = user_text
           or item.value ->> 'ownerUserId' = user_text
           or item.value ->> 'owner_user_id' = user_text
           or item.value ->> 'creatorId' = user_text
           or item.value ->> 'creator_id' = user_text
           or item.value ->> 'subjectUserId' = user_text
           or item.value ->> 'subject_user_id' = user_text
           or item.value ->> 'recipientId' = user_text
           or item.value ->> 'recipient_id' = user_text
           or item.value ->> 'actorId' = user_text
           or item.value ->> 'actor_id' = user_text
           or item.value ->> 'reportedUserId' = user_text
           or item.value ->> 'reported_user_id' = user_text
         ) then
        continue;
      end if;
      result := result || pg_catalog.jsonb_build_array(
        public.habhub_scrub_snapshot_account_identifier(
          item.value,
          p_user_id
        )
      );
    end loop;
    return result;
  end if;

  return p_value;
end;
$$;

revoke all on function public.habhub_scrub_snapshot_account_identifier(jsonb, uuid)
  from public, anon, authenticated;

-- A concurrent co-member snapshot write must not restore identity that the
-- deletion transaction is removing.  Existing affected rows are revision-
-- invalidated by the purge below; this trigger closes the in-flight write gap
-- while the durable deletion guard is present.
create or replace function public.habhub_reject_guarded_snapshot_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.google_health_account_deletion_guards guard
    where pg_catalog.strpos(new.payload::text, guard.user_id::text) > 0
  ) then
    raise exception 'habhub_account_deleting' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.habhub_reject_guarded_snapshot_reference()
  from public, anon, authenticated;

drop trigger if exists habhub_reject_guarded_snapshot_reference
  on public.user_snapshots;
create trigger habhub_reject_guarded_snapshot_reference
before insert or update of payload on public.user_snapshots
for each row execute function public.habhub_reject_guarded_snapshot_reference();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'messages',
    'group_social_reactions',
    'group_social_comments',
    'metric_entries',
    'photo_updates',
    'group_todos',
    'group_challenges',
    'templates'
  ] loop
    execute format(
      'drop trigger if exists habhub_reject_guarded_shared_content_write on public.%I',
      table_name
    );
    execute format(
      'create trigger habhub_reject_guarded_shared_content_write before insert or update on public.%I for each row execute function public.habhub_reject_guarded_shared_content_write()',
      table_name
    );
  end loop;
end;
$$;

-- Run the shared-content purge in one server-only transaction. The attempt ID
-- must still own the durable deletion guard; any missing table, constraint,
-- trigger, or delete failure rolls the entire purge back and the Edge Function
-- must not proceed to auth deletion.
create or replace function public.purge_account_authored_shared_content(
  p_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  guard_count bigint := 0;
  social_reaction_count bigint := 0;
  social_comment_count bigint := 0;
  safety_report_filed_count bigint := 0;
  safety_report_filed_retained_count bigint := 0;
  safety_report_redacted_count bigint := 0;
  message_count bigint := 0;
  metric_entry_count bigint := 0;
  photo_update_count bigint := 0;
  group_todo_count bigint := 0;
  group_challenge_count bigint := 0;
  group_challenge_membership_count bigint := 0;
  group_challenge_invalidated_count bigint := 0;
  template_count bigint := 0;
  push_acceptance_count bigint := 0;
  snapshot_reference_count bigint := 0;
  snapshot_candidate_count bigint := 0;
  snapshot_candidate_bytes bigint := 0;
  snapshot_owner_ids uuid[] := array[]::uuid[];
  active_challenge_ids uuid[] := array[]::uuid[];
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'habhub_service_role_required' using errcode = '42501';
  end if;
  if p_user_id is null or p_attempt_id is null then
    raise exception 'habhub_account_deletion_attempt_lost' using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 744218)
  );
  update public.google_health_account_deletion_guards guard
  set lease_until = now() + interval '10 minutes'
  where guard.user_id = p_user_id
    and guard.attempt_id = p_attempt_id;
  get diagnostics guard_count = row_count;
  if guard_count <> 1 then
    raise exception 'habhub_account_deletion_attempt_lost' using errcode = '55000';
  end if;

  -- Fence every current co-member snapshot plus any older snapshot that still
  -- contains the identifier.  The revision bump makes stale offline writes
  -- conflict instead of restoring the pre-deletion group shell.  Explicit
  -- limits keep this in-app transaction bounded; larger exceptional accounts
  -- fail closed for operator-assisted deletion rather than timing out midway.
  select
    coalesce(pg_catalog.array_agg(candidate.user_id order by candidate.user_id), array[]::uuid[]),
    count(*),
    coalesce(sum(pg_catalog.pg_column_size(candidate.payload)), 0)
  into snapshot_owner_ids, snapshot_candidate_count, snapshot_candidate_bytes
  from (
    select snapshot.user_id, snapshot.payload
    from public.user_snapshots snapshot
    where snapshot.user_id <> p_user_id
      and (
        pg_catalog.strpos(snapshot.payload::text, p_user_id::text) > 0
        or exists (
          select 1
          from public.group_members mine
          join public.group_members peer on peer.group_id = mine.group_id
          where mine.user_id = p_user_id
            and peer.user_id = snapshot.user_id
        )
      )
  ) candidate;
  if snapshot_candidate_count > 2000
     or snapshot_candidate_bytes > 134217728 then
    raise exception 'habhub_account_snapshot_cleanup_requires_support'
      using errcode = '54000';
  end if;

  update public.user_snapshots snapshot
  set payload = public.habhub_scrub_snapshot_account_identifier(
        snapshot.payload,
        p_user_id
      ),
      revision = snapshot.revision + 1,
      device_id = null,
      updated_at = clock_timestamp()
  where snapshot.user_id = any(snapshot_owner_ids);
  get diagnostics snapshot_reference_count = row_count;

  if snapshot_reference_count <> snapshot_candidate_count
     or exists (
       select 1
       from public.user_snapshots snapshot
       where snapshot.user_id <> p_user_id
         and pg_catalog.strpos(snapshot.payload::text, p_user_id::text) > 0
     ) then
    raise exception 'habhub_account_snapshot_cleanup_incomplete'
      using errcode = '55000';
  end if;

  -- Remove the deleting member's reactions/comments and interactions attached
  -- to their soon-to-be-deleted shared logs, photos, to-dos, challenges, and
  -- badge cards. Generic social targets have no foreign key to those records.
  delete from public.group_social_reactions reaction
  where reaction.user_id = p_user_id
    or (
      reaction.target_type = 'metric_entry'
      and exists (
        select 1 from public.metric_entries entry
        where entry.user_id = p_user_id
          and entry.id::text = reaction.target_id
      )
    )
    or (
      reaction.target_type = 'photo_update'
      and exists (
        select 1 from public.photo_updates photo
        where photo.owner_user_id = p_user_id
          and photo.client_generated_id = reaction.target_id
      )
    )
    or (
      reaction.target_type = 'group_todo'
      and exists (
        select 1 from public.group_todos todo
        where todo.creator_id = p_user_id
          and todo.id::text = reaction.target_id
      )
    )
    or (
      reaction.target_type = 'group_challenge'
      and exists (
        select 1 from public.group_challenges challenge
        where challenge.id::text = pg_catalog.split_part(reaction.target_id, ':', 1)
          and (
            challenge.creator_id = p_user_id
            or (
              p_user_id = any(challenge.participant_ids)
              and challenge.audience = 'group'
              and cardinality(
                pg_catalog.array_remove(challenge.participant_ids, p_user_id)
              ) < 2
            )
          )
      )
    )
    or (
      reaction.target_type = 'badge'
      and p_user_id::text = pg_catalog.split_part(reaction.target_id, ':', 1)
    )
    or (
      reaction.target_type = 'recap_feed'
      and pg_catalog.split_part(reaction.target_id, ':', 1) = 'leader'
      and p_user_id::text = pg_catalog.split_part(reaction.target_id, ':', 2)
    );
  get diagnostics social_reaction_count = row_count;

  delete from public.group_social_comments comment
  where comment.user_id = p_user_id
    or (
      comment.target_type = 'metric_entry'
      and exists (
        select 1 from public.metric_entries entry
        where entry.user_id = p_user_id
          and entry.id::text = comment.target_id
      )
    )
    or (
      comment.target_type = 'photo_update'
      and exists (
        select 1 from public.photo_updates photo
        where photo.owner_user_id = p_user_id
          and photo.client_generated_id = comment.target_id
      )
    )
    or (
      comment.target_type = 'group_todo'
      and exists (
        select 1 from public.group_todos todo
        where todo.creator_id = p_user_id
          and todo.id::text = comment.target_id
      )
    )
    or (
      comment.target_type = 'group_challenge'
      and exists (
        select 1 from public.group_challenges challenge
        where challenge.id::text = pg_catalog.split_part(comment.target_id, ':', 1)
          and (
            challenge.creator_id = p_user_id
            or (
              p_user_id = any(challenge.participant_ids)
              and challenge.audience = 'group'
              and cardinality(
                pg_catalog.array_remove(challenge.participant_ids, p_user_id)
              ) < 2
            )
          )
      )
    )
    or (
      comment.target_type = 'badge'
      and p_user_id::text = pg_catalog.split_part(comment.target_id, ':', 1)
    )
    or (
      comment.target_type = 'recap_feed'
      and pg_catalog.split_part(comment.target_id, ':', 1) = 'leader'
      and p_user_id::text = pg_catalog.split_part(comment.target_id, ':', 2)
    );
  get diagnostics social_comment_count = row_count;

  -- Preserve unresolved safety evidence so deleting a reporter account cannot
  -- erase abuse before service-operator review. The nullable/set-null FK and
  -- this explicit update de-identify the reporter before auth deletion. Reports
  -- that already completed operator review no longer need that exception and
  -- are deleted with the reporter's other authored content.
  update public.user_safety_reports report
  set reporter_id = null,
      updated_at = clock_timestamp()
  where report.reporter_id = p_user_id
    and report.operator_review_state = 'queued';
  get diagnostics safety_report_filed_retained_count = row_count;

  delete from public.user_safety_reports report
  where report.reporter_id = p_user_id;
  get diagnostics safety_report_filed_count = row_count;

  -- Reports filed by others are retained for abuse handling but identifying
  -- snapshots and copies of the deleting subject's message text are
  -- irreversibly redacted.
  update public.user_safety_reports report
  set reported_user_id = null,
      reported_display_name = 'Deleted member',
      message_id = null,
      message_client_generated_id = null,
      message_excerpt = '',
      updated_at = clock_timestamp()
  where report.reported_user_id = p_user_id;
  get diagnostics safety_report_redacted_count = row_count;

  delete from public.messages message
  where message.sender_id = p_user_id;
  get diagnostics message_count = row_count;

  delete from public.metric_entries entry
  where entry.user_id = p_user_id;
  get diagnostics metric_entry_count = row_count;

  delete from public.photo_updates photo
  where photo.owner_user_id = p_user_id;
  get diagnostics photo_update_count = row_count;

  delete from public.group_todos todo
  where todo.creator_id = p_user_id;
  get diagnostics group_todo_count = row_count;

  -- A private group challenge cannot remain valid with only its creator. Delete
  -- that now-invalid row (dependent rows cascade), then remove the account from
  -- every surviving invited/accepted/declined roster. Temporarily soft-delete
  -- active survivors during the array rewrite so the historical acceptance
  -- triggers cannot emit a false "Everyone accepted" event merely because a
  -- deleting invitee disappeared.
  delete from public.group_challenges challenge
  where challenge.creator_id <> p_user_id
    and p_user_id = any(challenge.participant_ids)
    and challenge.audience = 'group'
    and cardinality(
      pg_catalog.array_remove(challenge.participant_ids, p_user_id)
    ) < 2;
  get diagnostics group_challenge_invalidated_count = row_count;

  select coalesce(
    pg_catalog.array_agg(challenge.id order by challenge.id),
    array[]::uuid[]
  )
  into active_challenge_ids
  from public.group_challenges challenge
  where challenge.creator_id <> p_user_id
    and p_user_id = any(challenge.participant_ids)
    and challenge.deleted_at is null;

  update public.group_challenges challenge
  set participant_ids = pg_catalog.array_remove(
        challenge.participant_ids,
        p_user_id
      ),
      accepted_participant_ids = pg_catalog.array_remove(
        challenge.accepted_participant_ids,
        p_user_id
      ),
      declined_participant_ids = pg_catalog.array_remove(
        challenge.declined_participant_ids,
        p_user_id
      ),
      deleted_at = coalesce(challenge.deleted_at, clock_timestamp())
  where challenge.creator_id <> p_user_id
    and p_user_id = any(challenge.participant_ids);
  get diagnostics group_challenge_membership_count = row_count;

  update public.group_challenges challenge
  set deleted_at = null
  where challenge.id = any(active_challenge_ids);

  delete from public.group_challenges challenge
  where challenge.creator_id = p_user_id;
  get diagnostics group_challenge_count = row_count;

  -- Templates intentionally use ON DELETE SET NULL so public templates could
  -- otherwise outlive their author. Delete every authored visibility class and
  -- let template_versions cascade.
  delete from public.templates template
  where template.creator_user_id = p_user_id;
  get diagnostics template_count = row_count;

  delete from public.push_token_dispatch_acceptances acceptance
  where acceptance.user_id = p_user_id;
  get diagnostics push_acceptance_count = row_count;

  update public.google_health_account_deletion_guards guard
  set lease_until = now() + interval '10 minutes'
  where guard.user_id = p_user_id
    and guard.attempt_id = p_attempt_id;
  get diagnostics guard_count = row_count;
  if guard_count <> 1 then
    raise exception 'habhub_account_deletion_attempt_lost' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'socialReactions', social_reaction_count,
    'socialComments', social_comment_count,
    'safetyReportsFiled', safety_report_filed_count,
    'safetyReportsFiledRetained', safety_report_filed_retained_count,
    'safetyReportsRedacted', safety_report_redacted_count,
    'messages', message_count,
    'metricEntries', metric_entry_count,
    'photoUpdates', photo_update_count,
    'groupTodos', group_todo_count,
    'groupChallenges', group_challenge_count,
    'groupChallengeMembershipsScrubbed', group_challenge_membership_count,
    'groupChallengesInvalidated', group_challenge_invalidated_count,
    'templates', template_count,
    'pushDispatchAcceptances', push_acceptance_count,
    'snapshotReferencesScrubbed', snapshot_reference_count
  );
end;
$$;

revoke all on function public.purge_account_authored_shared_content(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.purge_account_authored_shared_content(uuid, uuid)
  to service_role;

comment on function public.purge_account_authored_shared_content(uuid, uuid) is
  'Server-only, deletion-lease-owned purge of account-authored and dependent shared content before auth user deletion.';

commit;
