begin;

-- One authoritative policy version keeps UGC consent enforcement on the
-- server. A client can display its bundled copy, but cannot choose which
-- version counts as current when it accepts.
create table if not exists public.app_policy_versions (
  singleton boolean primary key default true check (singleton),
  terms_version text not null
    check (char_length(terms_version) between 1 and 40),
  -- Keep legacy clients working during the staged rollout. The current app
  -- still asks for acceptance before enabling community writes; operators can
  -- flip this only after the previous store build has been retired.
  ugc_terms_enforced boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.app_policy_versions (
  singleton, terms_version, ugc_terms_enforced
)
values (true, '2026-09-04', false)
on conflict (singleton) do nothing;

create table if not exists public.user_terms_acceptances (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  terms_version text not null
    check (char_length(terms_version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  source text not null default 'app'
    check (source in ('app', 'web'))
);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

create index if not exists user_blocks_blocked_user_idx
  on public.user_blocks (blocked_user_id, blocker_id);

create table if not exists public.user_safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reported_display_name text not null default 'Member'
    check (char_length(reported_display_name) between 1 and 80),
  group_id uuid references public.groups(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  comment_id uuid references public.group_social_comments(id) on delete set null,
  message_client_generated_id text
    check (
      message_client_generated_id is null
      or char_length(message_client_generated_id) between 1 and 200
    ),
  report_type text not null check (report_type in ('message', 'comment', 'user')),
  reason text not null
    check (reason in ('harassment', 'hate', 'sexual', 'violence', 'spam', 'privacy', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  message_excerpt text not null default ''
    check (char_length(message_excerpt) <= 600),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  moderator_id uuid references public.profiles(id) on delete set null,
  moderation_action text
    check (
      moderation_action is null
      or moderation_action in (
        'reviewed', 'message_removed', 'comment_removed', 'dismissed'
      )
    ),
  moderator_note text not null default '' check (char_length(moderator_note) <= 500),
  moderated_at timestamptz,
  -- Every report enters a service-operator queue, even when a group admin can
  -- act first. `operator_review_required` raises the priority when there was no
  -- independent active group moderator at submission time (for example, when
  -- the reported member is the group's only admin).
  operator_review_required boolean not null default true,
  operator_review_state text not null default 'queued'
    check (operator_review_state in ('queued', 'resolved', 'dismissed')),
  operator_action text
    check (
      operator_action is null
      or operator_action in (
        'reviewed', 'message_removed', 'comment_removed',
        'group_action_confirmed', 'dismissed'
      )
    ),
  operator_note text not null default '' check (char_length(operator_note) <= 500),
  operator_reference text
    check (
      operator_reference is null
      or char_length(operator_reference) between 1 and 120
    ),
  operator_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reported_user_id is null or reporter_id <> reported_user_id),
  -- A retained abuse report may be irreversibly de-identified when its subject
  -- deletes their account. Live message reports still require the immutable
  -- client id used to find and moderate their evidence.
  check (
    report_type <> 'message'
    or message_client_generated_id is not null
    or reported_user_id is null
  ),
  check (
    (
      operator_review_state = 'queued'
      and operator_action is null
      and operator_reference is null
      and operator_reviewed_at is null
    )
    or (
      operator_review_state in ('resolved', 'dismissed')
      and operator_action is not null
      and operator_reference is not null
      and operator_reviewed_at is not null
    )
  ),
  unique (reporter_id, group_id, reported_user_id, message_id)
);

create index if not exists user_safety_reports_group_status_idx
  on public.user_safety_reports (group_id, status, created_at desc);
create index if not exists user_safety_reports_reporter_idx
  on public.user_safety_reports (reporter_id, created_at desc);
create unique index if not exists user_safety_reports_comment_once_idx
  on public.user_safety_reports (reporter_id, comment_id)
  where comment_id is not null;
create index if not exists user_safety_reports_operator_queue_idx
  on public.user_safety_reports (
    operator_review_state,
    created_at desc,
    id desc
  );
create index if not exists user_safety_reports_operator_priority_idx
  on public.user_safety_reports (created_at desc, id desc)
  where operator_review_state = 'queued'
    and operator_review_required;

alter table public.app_policy_versions enable row level security;
alter table public.user_terms_acceptances enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_safety_reports enable row level security;

drop policy if exists app_policy_versions_authenticated_read on public.app_policy_versions;
create policy app_policy_versions_authenticated_read
  on public.app_policy_versions for select to authenticated
  using (singleton);

drop policy if exists user_terms_acceptances_owner_read on public.user_terms_acceptances;
create policy user_terms_acceptances_owner_read
  on public.user_terms_acceptances for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_blocks_owner_read on public.user_blocks;
create policy user_blocks_owner_read
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

-- Reports deliberately have no client table policy. Every durable read/write
-- passes through a bounded security-definer RPC below, which prevents clients
-- from editing evidence or enumerating reports outside their authorization.
revoke all on table public.app_policy_versions from anon, authenticated;
revoke all on table public.user_terms_acceptances from anon, authenticated;
revoke all on table public.user_blocks from anon, authenticated;
revoke all on table public.user_safety_reports from anon, authenticated;
grant select on table public.app_policy_versions to authenticated;
grant select on table public.user_terms_acceptances to authenticated;
grant select on table public.user_blocks to authenticated;

create or replace function public.habhub_users_blocked_either_way(
  p_first_user_id uuid,
  p_second_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_first_user_id is not null
    and p_second_user_id is not null
    and exists (
      select 1
      from public.user_blocks block
      where
        (block.blocker_id = p_first_user_id and block.blocked_user_id = p_second_user_id)
        or
        (block.blocker_id = p_second_user_id and block.blocked_user_id = p_first_user_id)
    );
$$;

create or replace function public.habhub_has_current_terms_acceptance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      not policy.ugc_terms_enforced
      or exists (
        select 1
        from public.user_terms_acceptances acceptance
        where acceptance.user_id = (select auth.uid())
          and acceptance.terms_version = policy.terms_version
      )
    from public.app_policy_versions policy
    where policy.singleton
  ), false);
$$;

create or replace function public.habhub_message_content_allowed(p_content text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized text := trim(
    regexp_replace(lower(coalesce(p_content, '')), '[^[:alnum:]]+', ' ', 'g')
  );
begin
  -- HabHub groups are private and invitation-only. This intentionally narrow
  -- deny list catches high-confidence threats, severe slurs, self-harm abuse,
  -- and sexual exploitation while leaving nuanced cases to report/moderation.
  return not (
    normalized ~ '(^| )(kys|kill yourself|go kill yourself|i will kill you|i ll kill you|i am going to kill you|rape you|child porn|underage nudes)( |$)'
    or normalized ~ '(^| )(nigger|faggot)(s| |$)'
    or position('bring dich um' in normalized) > 0
    or position('mátate' in normalized) > 0
    or position('matate' in normalized) > 0
    or position('tue toi' in normalized) > 0
    or position('убей себя' in normalized) > 0
    or position('ta livet av dig' in normalized) > 0
    or position('去死' in normalized) > 0
    or position('اقتل نفسك' in normalized) > 0
  );
end;
$$;

create or replace function public.habhub_message_visible_to_current_user(
  p_sender_id uuid,
  p_recipient_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then return false; end if;
  if p_sender_id is null then return true; end if;
  if p_recipient_id is null then
    return p_sender_id = caller_id
      or not exists (
        select 1
        from public.user_blocks block
        where block.blocker_id = caller_id
          and block.blocked_user_id = p_sender_id
      );
  end if;
  -- Keep a sender's own archival row queryable so append-only sync does not
  -- repeatedly attempt to recreate it. The other person's inbound copy is
  -- hidden whenever either side blocks contact.
  if caller_id = p_sender_id then return true; end if;
  return caller_id = p_recipient_id
    and not public.habhub_users_blocked_either_way(p_sender_id, p_recipient_id);
end;
$$;

create or replace function public.habhub_can_direct_message(
  p_group_id uuid,
  p_recipient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and p_recipient_id is not null
    and p_recipient_id <> (select auth.uid())
    and public.habhub_has_current_terms_acceptance()
    and exists (
      select 1
      from public.group_members sender
      join public.group_members recipient
        on recipient.group_id = sender.group_id
      where sender.group_id = p_group_id
        and sender.user_id = (select auth.uid())
        and sender.status = 'active'
        and recipient.user_id = p_recipient_id
        and recipient.status = 'active'
    )
    and not public.habhub_users_blocked_either_way(
      (select auth.uid()),
      p_recipient_id
    );
$$;

drop policy if exists messages_authorized_read on public.messages;
create policy messages_authorized_read
  on public.messages for select to authenticated
  using (
    public.is_group_member(group_id)
    and (
      recipient_id is null
      or sender_id = (select auth.uid())
      or recipient_id = (select auth.uid())
    )
    and public.habhub_message_visible_to_current_user(sender_id, recipient_id)
  );

drop policy if exists messages_authorized_insert on public.messages;
create policy messages_authorized_insert
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_group_member(group_id)
    and public.habhub_has_current_terms_acceptance()
    and public.habhub_message_content_allowed(content)
    and (
      recipient_id is null
      or public.habhub_can_direct_message(group_id, recipient_id)
    )
  );

drop policy if exists messages_sender_update on public.messages;
create policy messages_sender_update
  on public.messages for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (
    sender_id = (select auth.uid())
    and public.is_group_member(group_id)
    and public.habhub_has_current_terms_acceptance()
    and public.habhub_message_content_allowed(content)
    and (
      recipient_id is null
      or public.habhub_can_direct_message(group_id, recipient_id)
    )
  );

-- Blocking is a data-access rule for the main shared feed too. Keep owners'
-- archival rows queryable for sync, but do not send a blocker's client another
-- member's shared logs, progress photos, or underlying media.
drop policy if exists entries_owner_select on public.metric_entries;
drop policy if exists entries_shared_read on public.metric_entries;
drop policy if exists entries_authorized_select on public.metric_entries;
create policy entries_authorized_select
  on public.metric_entries for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      visibility::text = 'group'
      and public.habhub_message_visible_to_current_user(user_id, null)
      and exists (
        select 1
        from public.metric_definitions definition
        where definition.id = metric_entries.metric_id
          and definition.group_id is not null
          and public.is_group_member(definition.group_id)
      )
    )
  );

drop policy if exists photos_owner_select on public.photo_updates;
drop policy if exists photos_group_read on public.photo_updates;
drop policy if exists photos_authorized_select on public.photo_updates;
create policy photos_authorized_select
  on public.photo_updates for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or (
      visibility::text = 'group'
      and group_id is not null
      and public.is_group_member(group_id)
      and public.habhub_message_visible_to_current_user(owner_user_id, null)
    )
  );

drop policy if exists media_group_read on public.media_assets;
drop policy if exists media_authorized_read on public.media_assets;
create policy media_authorized_read
  on public.media_assets for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or exists (
      select 1
      from public.photo_updates photo
      where photo.media_asset_id = media_assets.id
        and photo.visibility::text = 'group'
        and photo.group_id is not null
        and public.is_group_member(photo.group_id)
        and public.habhub_message_visible_to_current_user(
          photo.owner_user_id,
          null
        )
    )
  );

-- The private storage bucket still authorizes signed URL creation through
-- these predicates. Rebuild them with the same blocked-member rule so a
-- previously cached object path cannot bypass the relational feed policies.
create or replace function public.can_read_media_object(object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1 from auth.users account where account.id = auth.uid()
    )
    and not exists (
      select 1
        from public.google_health_account_deletion_guards guard
       where guard.user_id = auth.uid()
    )
    and (
      (storage.foldername(object_path))[1] = auth.uid()::text
      or exists (
        select 1
          from public.media_assets asset
          join public.photo_updates photo on photo.media_asset_id = asset.id
         where asset.storage_path = object_path
           and photo.visibility = 'group'
           and photo.group_id is not null
           and public.is_group_member(photo.group_id)
           and public.habhub_message_visible_to_current_user(
             photo.owner_user_id,
             null
           )
      )
      or exists (
        select 1
          from public.metric_entries entry
          join public.metric_definitions metric on metric.id = entry.metric_id
         where entry.image_path = object_path
           and entry.visibility = 'group'
           and metric.group_id is not null
           and public.is_group_member(metric.group_id)
           and public.habhub_message_visible_to_current_user(
             entry.user_id,
             null
           )
      )
      or exists (
        select 1
          from public.messages message
         where message.image_path = object_path
           and public.is_group_member(message.group_id)
           and (
             message.recipient_id is null
             or message.sender_id = auth.uid()
             or message.recipient_id = auth.uid()
           )
           and public.habhub_message_visible_to_current_user(
             message.sender_id,
             message.recipient_id
           )
      )
      or exists (
        select 1
          from public.profiles profile
         where profile.avatar_path = object_path
           and public.shares_group_with(profile.id)
           and public.habhub_message_visible_to_current_user(profile.id, null)
      )
    );
$$;

create or replace function public.can_read_challenge_media_object(
  object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1 from auth.users account where account.id = auth.uid()
    )
    and not exists (
      select 1
        from public.google_health_account_deletion_guards guard
       where guard.user_id = auth.uid()
    )
    and exists (
      select 1
        from public.group_challenges challenge
       where challenge.visual_image_path = object_path
         and challenge.deleted_at is null
         and (
           challenge.audience = 'public'
           or public.is_group_member(challenge.group_id)
           or auth.uid() = any(challenge.participant_ids)
         )
         and public.habhub_message_visible_to_current_user(
           challenge.creator_id,
           null
         )
    );
$$;

revoke all on function public.can_read_media_object(text)
  from public, anon;
revoke all on function public.can_read_challenge_media_object(text)
  from public, anon;
grant execute on function public.can_read_media_object(text)
  to authenticated;
grant execute on function public.can_read_challenge_media_object(text)
  to authenticated;

-- Feed comments and reactions are user-generated content too. Apply the same
-- membership, blocked-member visibility, staged Terms gate, and content rules
-- used by chat rather than leaving the older permissive policies in place.
drop policy if exists group_social_reactions_member_read
  on public.group_social_reactions;
create policy group_social_reactions_member_read
  on public.group_social_reactions for select to authenticated
  using (
    public.is_group_member(group_id)
    and public.valid_group_social_target(group_id, target_type, target_id)
    and public.habhub_message_visible_to_current_user(user_id, null)
  );

drop policy if exists group_social_reactions_owner_insert
  on public.group_social_reactions;
create policy group_social_reactions_owner_insert
  on public.group_social_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_group_member(group_id)
    and public.valid_group_social_target(group_id, target_type, target_id)
    and public.habhub_has_current_terms_acceptance()
  );

drop policy if exists group_social_reactions_owner_update
  on public.group_social_reactions;
create policy group_social_reactions_owner_update
  on public.group_social_reactions for update to authenticated
  using (user_id = (select auth.uid()) and public.is_group_member(group_id))
  with check (
    user_id = (select auth.uid())
    and public.is_group_member(group_id)
    and public.valid_group_social_target(group_id, target_type, target_id)
    and public.habhub_has_current_terms_acceptance()
  );

drop policy if exists group_social_comments_member_read
  on public.group_social_comments;
create policy group_social_comments_member_read
  on public.group_social_comments for select to authenticated
  using (
    public.is_group_member(group_id)
    and public.valid_group_social_target(group_id, target_type, target_id)
    and public.habhub_message_visible_to_current_user(user_id, null)
  );

drop policy if exists group_social_comments_owner_insert
  on public.group_social_comments;
create policy group_social_comments_owner_insert
  on public.group_social_comments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_group_member(group_id)
    and public.valid_group_social_target(group_id, target_type, target_id)
    and public.habhub_has_current_terms_acceptance()
    and public.habhub_message_content_allowed(content)
  );

drop policy if exists group_social_comments_owner_update
  on public.group_social_comments;
create policy group_social_comments_owner_update
  on public.group_social_comments for update to authenticated
  using (user_id = (select auth.uid()) and public.is_group_member(group_id))
  with check (
    user_id = (select auth.uid())
    and public.is_group_member(group_id)
    and public.valid_group_social_target(group_id, target_type, target_id)
    and public.habhub_has_current_terms_acceptance()
    and public.habhub_message_content_allowed(content)
  );

drop policy if exists group_social_comments_owner_delete
  on public.group_social_comments;
create policy group_social_comments_owner_delete
  on public.group_social_comments for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_group_member(group_id));

-- Reaction writers are SECURITY DEFINER functions retained for installed
-- clients. Their table mutations can bypass caller RLS, so enforce the staged
-- Terms boundary again at the table and at the current v2 RPC entry point.
-- Removing an existing reaction remains allowed without accepting a newer
-- Terms version, matching the owner-delete policy above.
create or replace function public.habhub_enforce_group_social_reaction_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.habhub_has_current_terms_acceptance() then
    raise exception 'Accept the current Terms before reacting to shared items.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists group_social_reactions_require_current_terms
  on public.group_social_reactions;
create trigger group_social_reactions_require_current_terms
before insert or update on public.group_social_reactions
for each row execute function
  public.habhub_enforce_group_social_reaction_terms();

create or replace function public.set_group_social_reaction_v2(
  p_group_id uuid,
  p_target_type text,
  p_target_id text,
  p_reaction text,
  p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_row public.group_social_reactions%rowtype;
  v_event_key text;
begin
  if v_actor_id is null then
    raise exception 'Sign in to react to a shared item.' using errcode = '42501';
  end if;
  if p_reaction is not null
     and not public.habhub_has_current_terms_acceptance() then
    raise exception 'Accept the current Terms before reacting to shared items.'
      using errcode = '42501';
  end if;

  v_row := public.set_group_social_reaction(
    p_group_id,
    p_target_type,
    p_target_id,
    p_reaction,
    p_surface
  );
  if p_reaction is not null and v_row.user_id = v_actor_id then
    v_event_key := 'social-reaction:' || v_row.group_id::text || ':' ||
      pg_catalog.md5(v_row.target_type || ':' || v_row.target_id) || ':' ||
      v_row.user_id::text || ':' ||
      floor(extract(epoch from v_row.updated_at) * 1000000)::bigint::text;
    if not exists (
      select 1
        from public.push_dispatch_events event
       where event.event_key = v_event_key
         and event.dispatcher_id = v_actor_id
    ) then
      v_event_key := null;
    end if;
  end if;
  return jsonb_build_object(
    'reaction', case when v_row is null then null else to_jsonb(v_row) end,
    'push_event_key', v_event_key
  );
end;
$$;

create or replace function public.habhub_accept_current_terms()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_version text;
  accepted_time timestamptz := clock_timestamp();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select terms_version into current_version
  from public.app_policy_versions where singleton;
  if current_version is null then
    raise exception 'Terms version is not configured' using errcode = '55000';
  end if;
  insert into public.user_terms_acceptances (
    user_id, terms_version, accepted_at, source
  ) values (
    caller_id, current_version, accepted_time, 'app'
  )
  on conflict (user_id) do update set
    terms_version = excluded.terms_version,
    accepted_at = excluded.accepted_at,
    source = excluded.source;
  return jsonb_build_object(
    'termsVersion', current_version,
    'acceptedAt', accepted_time
  );
end;
$$;

create or replace function public.habhub_block_user(
  p_group_id uuid,
  p_blocked_user_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  blocked_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_blocked_user_id is null or p_blocked_user_id = caller_id then
    raise exception 'Choose another member to block' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.group_id = p_group_id
      and mine.user_id = caller_id
      and mine.status = 'active'
      and theirs.user_id = p_blocked_user_id
      and theirs.status = 'active'
  ) then
    raise exception 'Active shared-group membership required' using errcode = '42501';
  end if;
  insert into public.user_blocks (blocker_id, blocked_user_id)
  values (caller_id, p_blocked_user_id)
  on conflict (blocker_id, blocked_user_id) do update set
    created_at = public.user_blocks.created_at
  returning created_at into blocked_at;
  return blocked_at;
end;
$$;

create or replace function public.habhub_unblock_user(p_blocked_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  delete from public.user_blocks
  where blocker_id = caller_id and blocked_user_id = p_blocked_user_id;
  return found;
end;
$$;

create or replace function public.habhub_valid_report_reason(p_reason text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select lower(trim(coalesce(p_reason, ''))) = any (
    array['harassment', 'hate', 'sexual', 'violence', 'spam', 'privacy', 'other']
  );
$$;

-- This is captured at submission time for durable prioritization. The operator
-- queue still receives every report; this flag distinguishes reports that had
-- no independent group admin who could safely review the reported account.
create or replace function public.habhub_report_requires_operator_review(
  p_group_id uuid,
  p_reported_user_id uuid,
  p_reporter_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_group_id is null or not exists (
    select 1
    from public.group_members membership
    where membership.group_id = p_group_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
      and membership.user_id is distinct from p_reported_user_id
      and membership.user_id is distinct from p_reporter_id
  );
$$;

create or replace function public.habhub_report_message(
  p_group_id uuid,
  p_message_client_generated_id text,
  p_message_sender_id uuid,
  p_reason text,
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  reported_message public.messages%rowtype;
  report_id uuid;
  reported_name text;
  normalized_reason text := lower(trim(coalesce(p_reason, '')));
  normalized_details text := trim(coalesce(p_details, ''));
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.habhub_valid_report_reason(normalized_reason) then
    raise exception 'Invalid report reason' using errcode = '22023';
  end if;
  if char_length(normalized_details) > 500 then
    raise exception 'Report details are too long' using errcode = '22001';
  end if;
  if char_length(trim(coalesce(p_message_client_generated_id, ''))) not between 1 and 200 then
    raise exception 'Invalid message identifier' using errcode = '22023';
  end if;
  if p_message_sender_id is null or p_message_sender_id = caller_id then
    raise exception 'You cannot report your own message' using errcode = '22023';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;
  if (
    select count(*)
    from public.user_safety_reports report
    where report.reporter_id = caller_id
      and report.created_at > clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many recent reports; try again later' using errcode = '54000';
  end if;
  select message.* into reported_message
  from public.messages message
  where message.group_id = p_group_id
    and message.sender_id = p_message_sender_id
    and message.client_generated_id = trim(p_message_client_generated_id)
    and (
      message.recipient_id is null
      or message.sender_id = caller_id
      or message.recipient_id = caller_id
    )
  order by message.created_at desc
  limit 1;
  if reported_message.id is null then
    raise exception 'Message is unavailable' using errcode = 'P0002';
  end if;
  select coalesce(nullif(trim(profile.display_name), ''), 'Member')
  into reported_name
  from public.profiles profile
  where profile.id = p_message_sender_id;
  insert into public.user_safety_reports (
    reporter_id,
    reported_user_id,
    reported_display_name,
    group_id,
    message_id,
    message_client_generated_id,
    report_type,
    reason,
    details,
    message_excerpt,
    operator_review_required
  ) values (
    caller_id,
    p_message_sender_id,
    coalesce(reported_name, 'Member'),
    p_group_id,
    reported_message.id,
    trim(p_message_client_generated_id),
    'message',
    normalized_reason,
    normalized_details,
    left(reported_message.content, 600),
    public.habhub_report_requires_operator_review(
      p_group_id,
      p_message_sender_id,
      caller_id
    )
  )
  on conflict (reporter_id, group_id, reported_user_id, message_id)
  do update set
    reason = case
      when public.user_safety_reports.status = 'open'
        and public.user_safety_reports.operator_review_state = 'queued'
      then excluded.reason
      else public.user_safety_reports.reason
    end,
    details = case
      when public.user_safety_reports.status = 'open'
        and public.user_safety_reports.operator_review_state = 'queued'
      then excluded.details
      else public.user_safety_reports.details
    end,
    updated_at = case
      when public.user_safety_reports.status = 'open'
        and public.user_safety_reports.operator_review_state = 'queued'
      then clock_timestamp()
      else public.user_safety_reports.updated_at
    end
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.habhub_report_comment(
  p_group_id uuid,
  p_comment_id uuid,
  p_comment_author_id uuid,
  p_reason text,
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  reported_comment public.group_social_comments%rowtype;
  report_id uuid;
  reported_name text;
  normalized_reason text := lower(trim(coalesce(p_reason, '')));
  normalized_details text := trim(coalesce(p_details, ''));
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.habhub_valid_report_reason(normalized_reason) then
    raise exception 'Invalid report reason' using errcode = '22023';
  end if;
  if char_length(normalized_details) > 500 then
    raise exception 'Report details are too long' using errcode = '22001';
  end if;
  if p_comment_id is null then
    raise exception 'Invalid comment identifier' using errcode = '22023';
  end if;
  if p_comment_author_id is null or p_comment_author_id = caller_id then
    raise exception 'You cannot report your own comment' using errcode = '22023';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;
  if (
    select count(*)
    from public.user_safety_reports report
    where report.reporter_id = caller_id
      and report.created_at > clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many recent reports; try again later' using errcode = '54000';
  end if;
  select comment.* into reported_comment
  from public.group_social_comments comment
  where comment.id = p_comment_id
    and comment.group_id = p_group_id
    and comment.user_id = p_comment_author_id
    and public.valid_group_social_target(
      comment.group_id,
      comment.target_type,
      comment.target_id
    )
  limit 1;
  if reported_comment.id is null then
    raise exception 'Comment is unavailable' using errcode = 'P0002';
  end if;
  select coalesce(nullif(trim(profile.display_name), ''), 'Member')
  into reported_name
  from public.profiles profile
  where profile.id = p_comment_author_id;
  insert into public.user_safety_reports (
    reporter_id,
    reported_user_id,
    reported_display_name,
    group_id,
    comment_id,
    report_type,
    reason,
    details,
    message_excerpt,
    operator_review_required
  ) values (
    caller_id,
    p_comment_author_id,
    coalesce(reported_name, 'Member'),
    p_group_id,
    reported_comment.id,
    'comment',
    normalized_reason,
    normalized_details,
    left(reported_comment.content, 600),
    public.habhub_report_requires_operator_review(
      p_group_id,
      p_comment_author_id,
      caller_id
    )
  )
  on conflict (reporter_id, comment_id) where comment_id is not null
  do update set
    reason = case
      when public.user_safety_reports.status = 'open'
        and public.user_safety_reports.operator_review_state = 'queued'
      then excluded.reason
      else public.user_safety_reports.reason
    end,
    details = case
      when public.user_safety_reports.status = 'open'
        and public.user_safety_reports.operator_review_state = 'queued'
      then excluded.details
      else public.user_safety_reports.details
    end,
    updated_at = case
      when public.user_safety_reports.status = 'open'
        and public.user_safety_reports.operator_review_state = 'queued'
      then clock_timestamp()
      else public.user_safety_reports.updated_at
    end
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.habhub_report_user(
  p_group_id uuid,
  p_reported_user_id uuid,
  p_reason text,
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  report_id uuid;
  reported_name text;
  normalized_reason text := lower(trim(coalesce(p_reason, '')));
  normalized_details text := trim(coalesce(p_details, ''));
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_reported_user_id is null or p_reported_user_id = caller_id then
    raise exception 'Choose another member to report' using errcode = '22023';
  end if;
  if not public.habhub_valid_report_reason(normalized_reason) then
    raise exception 'Invalid report reason' using errcode = '22023';
  end if;
  if char_length(normalized_details) > 500 then
    raise exception 'Report details are too long' using errcode = '22001';
  end if;
  if not exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.group_id = p_group_id
      and mine.user_id = caller_id
      and mine.status = 'active'
      and theirs.user_id = p_reported_user_id
      and theirs.status = 'active'
  ) then
    raise exception 'Active shared-group membership required' using errcode = '42501';
  end if;
  if (
    select count(*)
    from public.user_safety_reports report
    where report.reporter_id = caller_id
      and report.created_at > clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many recent reports; try again later' using errcode = '54000';
  end if;
  select coalesce(nullif(trim(profile.display_name), ''), 'Member')
  into reported_name
  from public.profiles profile
  where profile.id = p_reported_user_id;
  insert into public.user_safety_reports (
    reporter_id,
    reported_user_id,
    reported_display_name,
    group_id,
    report_type,
    reason,
    details,
    operator_review_required
  ) values (
    caller_id,
    p_reported_user_id,
    coalesce(reported_name, 'Member'),
    p_group_id,
    'user',
    normalized_reason,
    normalized_details,
    public.habhub_report_requires_operator_review(
      p_group_id,
      p_reported_user_id,
      caller_id
    )
  )
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.habhub_get_user_safety_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'currentTermsVersion', policy.terms_version,
    'acceptedTermsVersion', (
      select acceptance.terms_version
      from public.user_terms_acceptances acceptance
      where acceptance.user_id = (select auth.uid())
    ),
    'blocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', block.blocked_user_id,
          'displayName', coalesce(nullif(trim(profile.display_name), ''), 'Member'),
          'createdAt', block.created_at
        ) order by block.created_at desc
      )
      from public.user_blocks block
      left join public.profiles profile on profile.id = block.blocked_user_id
      where block.blocker_id = (select auth.uid())
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', report.id,
          'reportType', report.report_type,
          'reportedUserId', report.reported_user_id,
          'reportedDisplayName', report.reported_display_name,
          'reason', report.reason,
          'status', report.status,
          'operatorReviewRequired', report.operator_review_required,
          'operatorReviewState', report.operator_review_state,
          'createdAt', report.created_at
        ) order by report.created_at desc
      )
      from (
        select *
        from public.user_safety_reports own_report
        where own_report.reporter_id = (select auth.uid())
        order by own_report.created_at desc
        limit 50
      ) report
    ), '[]'::jsonb)
  )
  from public.app_policy_versions policy
  where policy.singleton;
$$;

create or replace function public.habhub_list_group_safety_reports(p_group_id uuid)
returns table (
  id uuid,
  report_type text,
  reporter_id uuid,
  reporter_display_name text,
  reported_user_id uuid,
  reported_display_name text,
  reason text,
  details text,
  message_excerpt text,
  message_available boolean,
  comment_available boolean,
  operator_review_required boolean,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Group admin access required' using errcode = '42501';
  end if;
  return query
  select
    report.id,
    report.report_type,
    report.reporter_id,
    coalesce(nullif(trim(reporter.display_name), ''), 'Member'),
    report.reported_user_id,
    report.reported_display_name,
    report.reason,
    report.details,
    report.message_excerpt,
    report.message_id is not null,
    report.comment_id is not null,
    report.operator_review_required,
    report.status,
    report.created_at
  from public.user_safety_reports report
  left join public.profiles reporter on reporter.id = report.reporter_id
  where report.group_id = p_group_id
    and report.status = 'open'
    and report.reported_user_id is distinct from (select auth.uid())
    and report.reporter_id is distinct from (select auth.uid())
  order by report.created_at desc
  limit 100;
end;
$$;

create or replace function public.habhub_moderate_group_safety_report(
  p_report_id uuid,
  p_action text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target public.user_safety_reports%rowtype;
  normalized_action text := lower(trim(coalesce(p_action, '')));
  normalized_note text := trim(coalesce(p_note, ''));
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if normalized_action not in (
    'reviewed', 'remove_message', 'remove_comment', 'dismissed'
  ) then
    raise exception 'Invalid moderation action' using errcode = '22023';
  end if;
  if char_length(normalized_note) > 500 then
    raise exception 'Moderator note is too long' using errcode = '22001';
  end if;
  select * into target
  from public.user_safety_reports report
  where report.id = p_report_id
  for update;
  if target.id is null then
    raise exception 'Report is unavailable' using errcode = 'P0002';
  end if;
  if target.group_id is null or not public.is_group_admin(target.group_id) then
    raise exception 'Group admin access required' using errcode = '42501';
  end if;
  if target.reported_user_id = caller_id then
    raise exception 'Reports about your account require independent service-operator review'
      using errcode = '42501';
  end if;
  if target.reporter_id = caller_id then
    raise exception 'Reports you filed require independent service-operator review'
      using errcode = '42501';
  end if;
  if target.status <> 'open' then
    raise exception 'Report was already handled' using errcode = '40001';
  end if;
  if normalized_action = 'remove_message' then
    if target.message_id is null then
      raise exception 'Reported message is no longer available' using errcode = 'P0002';
    end if;
    delete from public.messages message
    where message.id = target.message_id and message.group_id = target.group_id;
  end if;
  if normalized_action = 'remove_comment' then
    if target.comment_id is null then
      raise exception 'Reported comment is no longer available' using errcode = 'P0002';
    end if;
    delete from public.group_social_comments comment
    where comment.id = target.comment_id
      and comment.group_id = target.group_id;
  end if;
  update public.user_safety_reports report set
    status = case
      when normalized_action = 'reviewed' then 'reviewed'
      when normalized_action = 'dismissed' then 'dismissed'
      else 'actioned'
    end,
    moderation_action = case
      when normalized_action = 'remove_message' then 'message_removed'
      when normalized_action = 'remove_comment' then 'comment_removed'
      else normalized_action
    end,
    moderator_id = caller_id,
    moderator_note = normalized_note,
    moderated_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where report.id = target.id;
  return jsonb_build_object(
    'id', target.id,
    'status', case
      when normalized_action = 'reviewed' then 'reviewed'
      when normalized_action = 'dismissed' then 'dismissed'
      else 'actioned'
    end
  );
end;
$$;

-- A durable, bounded queue for trusted operations tooling. Only the database
-- service role receives EXECUTE. The mobile/web clients and ordinary group
-- admins cannot enumerate it, including reports about themselves.
create or replace function public.habhub_list_operator_safety_reports(
  p_operator_state text default 'queued',
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  report_type text,
  reporter_id uuid,
  reporter_display_name text,
  reported_user_id uuid,
  reported_display_name text,
  group_id uuid,
  reason text,
  details text,
  message_excerpt text,
  message_available boolean,
  comment_available boolean,
  status text,
  group_moderation_action text,
  group_moderated_at timestamptz,
  operator_review_required boolean,
  operator_review_state text,
  operator_action text,
  operator_note text,
  operator_reference text,
  operator_reviewed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_state text := lower(trim(coalesce(p_operator_state, 'queued')));
begin
  if normalized_state not in (
    'priority', 'queued', 'resolved', 'dismissed', 'all'
  ) then
    raise exception 'Invalid operator queue state' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Operator queue page size must be between 1 and 100'
      using errcode = '22023';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Operator queue cursor is incomplete' using errcode = '22023';
  end if;
  return query
  select
    report.id,
    report.report_type,
    report.reporter_id,
    coalesce(nullif(trim(reporter.display_name), ''), 'Deleted member'),
    report.reported_user_id,
    report.reported_display_name,
    report.group_id,
    report.reason,
    report.details,
    report.message_excerpt,
    report.message_id is not null,
    report.comment_id is not null,
    report.status,
    report.moderation_action,
    report.moderated_at,
    report.operator_review_required,
    report.operator_review_state,
    report.operator_action,
    report.operator_note,
    report.operator_reference,
    report.operator_reviewed_at,
    report.created_at,
    report.updated_at
  from public.user_safety_reports report
  left join public.profiles reporter on reporter.id = report.reporter_id
  where (
      normalized_state = 'all'
      or (
        normalized_state = 'priority'
        and report.operator_review_state = 'queued'
        and report.operator_review_required
      )
      or report.operator_review_state = normalized_state
    )
    and (
      p_before_created_at is null
      or report.created_at < p_before_created_at
      or (
        report.created_at = p_before_created_at
        and report.id < p_before_id
      )
    )
  order by report.created_at desc, report.id desc
  limit p_limit;
end;
$$;

-- Service-operator decisions are recorded separately from group-admin actions
-- so an operator can verify a group action without erasing who performed it.
create or replace function public.habhub_moderate_operator_safety_report(
  p_report_id uuid,
  p_action text,
  p_operator_reference text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.user_safety_reports%rowtype;
  normalized_action text := lower(trim(coalesce(p_action, '')));
  normalized_reference text := trim(coalesce(p_operator_reference, ''));
  normalized_note text := trim(coalesce(p_note, ''));
  result_status text;
  result_operator_state text;
  result_operator_action text;
begin
  if normalized_action not in (
    'reviewed', 'remove_message', 'remove_comment',
    'confirm_group_action', 'dismissed'
  ) then
    raise exception 'Invalid operator moderation action' using errcode = '22023';
  end if;
  if char_length(normalized_reference) not between 1 and 120 then
    raise exception 'A bounded operator reference is required' using errcode = '22023';
  end if;
  if char_length(normalized_note) > 500 then
    raise exception 'Operator note is too long' using errcode = '22001';
  end if;

  select * into target
  from public.user_safety_reports report
  where report.id = p_report_id
  for update;
  if target.id is null then
    raise exception 'Report is unavailable' using errcode = 'P0002';
  end if;
  if target.operator_review_state <> 'queued' then
    return jsonb_build_object(
      'id', target.id,
      'status', target.status,
      'operatorReviewState', target.operator_review_state,
      'alreadyHandled', true
    );
  end if;
  if normalized_action = 'confirm_group_action' and target.status = 'open' then
    raise exception 'There is no completed group action to confirm'
      using errcode = '22023';
  end if;
  if normalized_action in ('reviewed', 'dismissed') and target.status <> 'open' then
    raise exception 'Use confirm_group_action for a completed group decision'
      using errcode = '22023';
  end if;
  if normalized_action = 'remove_message'
     and (target.report_type <> 'message' or target.message_id is null) then
    raise exception 'The reported message is unavailable; review the retained evidence instead'
      using errcode = 'P0002';
  end if;
  if normalized_action = 'remove_comment'
     and (target.report_type <> 'comment' or target.comment_id is null) then
    raise exception 'The reported comment is unavailable; review the retained evidence instead'
      using errcode = 'P0002';
  end if;

  if normalized_action = 'remove_message' then
    delete from public.messages message
    where message.id = target.message_id and message.group_id = target.group_id;
  end if;
  if normalized_action = 'remove_comment' then
    delete from public.group_social_comments comment
    where comment.id = target.comment_id and comment.group_id = target.group_id;
  end if;

  result_status := case
    when normalized_action in ('remove_message', 'remove_comment') then 'actioned'
    when normalized_action = 'dismissed' and target.status <> 'actioned' then 'dismissed'
    when normalized_action = 'reviewed' and target.status = 'open' then 'reviewed'
    else target.status
  end;
  result_operator_state := case
    when normalized_action = 'dismissed' then 'dismissed'
    else 'resolved'
  end;
  result_operator_action := case
    when normalized_action = 'remove_message' then 'message_removed'
    when normalized_action = 'remove_comment' then 'comment_removed'
    when normalized_action = 'confirm_group_action' then 'group_action_confirmed'
    else normalized_action
  end;

  update public.user_safety_reports report set
    status = result_status,
    operator_review_state = result_operator_state,
    operator_action = result_operator_action,
    operator_note = normalized_note,
    operator_reference = normalized_reference,
    operator_reviewed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where report.id = target.id;

  return jsonb_build_object(
    'id', target.id,
    'status', result_status,
    'operatorReviewState', result_operator_state,
    'alreadyHandled', false
  );
end;
$$;

-- Body-free operational telemetry can be polled without copying report
-- evidence into general monitoring systems.
create or replace function public.habhub_operator_safety_queue_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'queuedCount', count(*) filter (
      where report.operator_review_state = 'queued'
    ),
    'priorityCount', count(*) filter (
      where report.operator_review_state = 'queued'
        and report.operator_review_required
    ),
    'oldestQueuedAt', min(report.created_at) filter (
      where report.operator_review_state = 'queued'
    )
  )
  from public.user_safety_reports report;
$$;

revoke all on function public.habhub_users_blocked_either_way(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.habhub_has_current_terms_acceptance()
  from public, anon;
revoke all on function public.habhub_message_content_allowed(text)
  from public, anon;
revoke all on function public.habhub_message_visible_to_current_user(uuid, uuid)
  from public, anon;
revoke all on function public.habhub_can_direct_message(uuid, uuid)
  from public, anon;
revoke all on function public.habhub_enforce_group_social_reaction_terms()
  from public, anon, authenticated;
revoke all on function public.set_group_social_reaction_v2(
  uuid, text, text, text, text
) from public, anon;
revoke all on function public.habhub_accept_current_terms()
  from public, anon;
revoke all on function public.habhub_block_user(uuid, uuid)
  from public, anon;
revoke all on function public.habhub_unblock_user(uuid)
  from public, anon;
revoke all on function public.habhub_valid_report_reason(text)
  from public, anon, authenticated;
revoke all on function public.habhub_report_requires_operator_review(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.habhub_report_message(uuid, text, uuid, text, text)
  from public, anon;
revoke all on function public.habhub_report_comment(uuid, uuid, uuid, text, text)
  from public, anon;
revoke all on function public.habhub_report_user(uuid, uuid, text, text)
  from public, anon;
revoke all on function public.habhub_get_user_safety_state()
  from public, anon;
revoke all on function public.habhub_list_group_safety_reports(uuid)
  from public, anon;
revoke all on function public.habhub_moderate_group_safety_report(uuid, text, text)
  from public, anon;
revoke all on function public.habhub_list_operator_safety_reports(
  text, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke all on function public.habhub_moderate_operator_safety_report(
  uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.habhub_operator_safety_queue_health()
  from public, anon, authenticated;

grant execute on function public.habhub_has_current_terms_acceptance()
  to authenticated;
grant execute on function public.habhub_message_content_allowed(text)
  to authenticated;
grant execute on function public.habhub_message_visible_to_current_user(uuid, uuid)
  to authenticated;
grant execute on function public.habhub_can_direct_message(uuid, uuid)
  to authenticated;
grant execute on function public.set_group_social_reaction_v2(
  uuid, text, text, text, text
) to authenticated;
grant execute on function public.habhub_accept_current_terms()
  to authenticated;
grant execute on function public.habhub_block_user(uuid, uuid)
  to authenticated;
grant execute on function public.habhub_unblock_user(uuid)
  to authenticated;
grant execute on function public.habhub_report_message(uuid, text, uuid, text, text)
  to authenticated;
grant execute on function public.habhub_report_comment(uuid, uuid, uuid, text, text)
  to authenticated;
grant execute on function public.habhub_report_user(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.habhub_get_user_safety_state()
  to authenticated;
grant execute on function public.habhub_list_group_safety_reports(uuid)
  to authenticated;
grant execute on function public.habhub_moderate_group_safety_report(uuid, text, text)
  to authenticated;
grant execute on function public.habhub_list_operator_safety_reports(
  text, timestamptz, uuid, integer
) to service_role;
grant execute on function public.habhub_moderate_operator_safety_report(
  uuid, text, text, text
) to service_role;
grant execute on function public.habhub_operator_safety_queue_health()
  to service_role;

commit;
