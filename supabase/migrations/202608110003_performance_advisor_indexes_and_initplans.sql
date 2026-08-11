-- Low-risk Performance Advisor remediations.
--
-- Foreign-key indexes improve joins and parent-row deletes as these tables
-- grow.  The policy changes are intentionally semantic no-ops: wrapping the
-- request-stable auth.uid() helper in SELECT lets Postgres evaluate it once as
-- an initPlan instead of once per candidate row.

create index if not exists automation_rules_group_id_idx
  on public.automation_rules (group_id);
create index if not exists badge_showcases_group_id_idx
  on public.badge_showcases (group_id);
create index if not exists daily_metric_status_metric_id_idx
  on public.daily_metric_status (metric_id);
create index if not exists daily_metric_status_user_id_idx
  on public.daily_metric_status (user_id);
create index if not exists dashboard_layouts_group_id_idx
  on public.dashboard_layouts (group_id);
create index if not exists group_challenges_creator_id_idx
  on public.group_challenges (creator_id);
create index if not exists group_member_aliases_subject_user_id_idx
  on public.group_member_aliases (subject_user_id);
create index if not exists groups_owner_id_idx
  on public.groups (owner_id);
create index if not exists media_assets_owner_user_id_idx
  on public.media_assets (owner_user_id);
create index if not exists member_aliases_subject_user_id_idx
  on public.member_aliases (subject_user_id);
create index if not exists metric_definitions_owner_user_id_idx
  on public.metric_definitions (owner_user_id);
create index if not exists metric_goals_metric_id_idx
  on public.metric_goals (metric_id);
create index if not exists metric_goals_user_id_idx
  on public.metric_goals (user_id);
create index if not exists photo_updates_media_asset_id_idx
  on public.photo_updates (media_asset_id);
create index if not exists photo_updates_group_id_idx
  on public.photo_updates (group_id);
create index if not exists push_events_sender_id_idx
  on public.push_events (sender_id);
create index if not exists templates_creator_user_id_idx
  on public.templates (creator_user_id);
create index if not exists templates_creator_group_id_idx
  on public.templates (creator_group_id);
create index if not exists tracked_goal_periods_metric_id_idx
  on public.tracked_goal_periods (metric_id);

-- These older partial unique indexes duplicate the later named UNIQUE
-- constraints on the same two columns.  The constraint-backed indexes serve
-- both conflict detection and ordinary lookups, so retaining both only doubles
-- write amplification.
drop index if exists public.messages_sender_client_id_idx;
drop index if exists public.photos_owner_client_id_idx;

-- ALTER POLICY has no IF EXISTS form.  The catalog guard makes this migration
-- safe to rehearse more than once and also safe after the follow-up migration
-- has replaced overlapping policies with consolidated equivalents.
do $migration$
declare
  policy_definition record;
  alteration text;
begin
  for policy_definition in
    select *
    from (values
      ('public', 'profiles', 'profiles_self_read',
        $expression$id = (select auth.uid())$expression$, null::text),
      ('public', 'profiles', 'profiles_self_update',
        $expression$id = (select auth.uid())$expression$,
        $expression$id = (select auth.uid())$expression$),
      ('public', 'groups', 'groups_create', null::text,
        $expression$owner_id = (select auth.uid())$expression$),
      ('public', 'metric_definitions', 'metrics_read',
        $expression$owner_user_id = (select auth.uid()) or (group_id is not null and public.is_group_member(group_id))$expression$,
        null::text),
      ('public', 'metric_definitions', 'metrics_create', null::text,
        $expression$owner_user_id = (select auth.uid()) or (group_id is not null and public.is_group_admin(group_id))$expression$),
      ('public', 'metric_definitions', 'metrics_update',
        $expression$owner_user_id = (select auth.uid()) or (group_id is not null and public.is_group_admin(group_id))$expression$,
        null::text),
      ('public', 'metric_definitions', 'metrics_delete',
        $expression$owner_user_id = (select auth.uid()) or (group_id is not null and public.is_group_admin(group_id))$expression$,
        null::text),
      ('public', 'metric_goals', 'goals_owner_all',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'dashboard_layouts', 'layouts_owner_all',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid()) and public.is_group_member(group_id)$expression$),
      ('public', 'media_assets', 'media_owner_all',
        $expression$owner_user_id = (select auth.uid())$expression$,
        $expression$owner_user_id = (select auth.uid())$expression$),
      ('public', 'templates', 'templates_owner_all',
        $expression$creator_user_id = (select auth.uid())$expression$,
        $expression$creator_user_id = (select auth.uid())$expression$),
      ('public', 'template_versions', 'template_versions_owner_all',
        $expression$exists (
          select 1 from public.templates template
          where template.id = template_id
            and template.creator_user_id = (select auth.uid())
        )$expression$,
        $expression$exists (
          select 1 from public.templates template
          where template.id = template_id
            and template.creator_user_id = (select auth.uid())
        )$expression$),
      ('public', 'user_snapshots', 'snapshots_owner_all',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'messages', 'messages_authorized_read',
        $expression$public.is_group_member(group_id)
          and (
            recipient_id is null
            or sender_id = (select auth.uid())
            or recipient_id = (select auth.uid())
          )$expression$,
        null::text),
      ('public', 'messages', 'messages_authorized_insert', null::text,
        $expression$sender_id = (select auth.uid())
          and public.is_group_member(group_id)
          and (
            recipient_id is null
            or exists (
              select 1 from public.group_members recipient
              where recipient.group_id = messages.group_id
                and recipient.user_id = messages.recipient_id
            )
          )$expression$),
      ('public', 'messages', 'messages_sender_delete',
        $expression$sender_id = (select auth.uid())$expression$, null::text),
      ('public', 'messages', 'messages_sender_update',
        $expression$sender_id = (select auth.uid())$expression$,
        $expression$sender_id = (select auth.uid()) and public.is_group_member(group_id)$expression$),
      ('public', 'daily_metric_status', 'daily_status_owner_write', null::text,
        $expression$user_id = (select auth.uid()) and public.is_group_member(group_id)$expression$),
      ('public', 'daily_metric_status', 'daily_status_owner_update',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid()) and public.is_group_member(group_id)$expression$),
      ('public', 'member_aliases', 'member_aliases_owner_all',
        $expression$owner_user_id = (select auth.uid())$expression$,
        $expression$owner_user_id = (select auth.uid())$expression$),
      ('public', 'notification_preferences', 'notification_preferences_owner_all',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'tracked_goal_periods', 'tracked_goal_periods_owner_all',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'badge_showcases', 'badge_showcases_group_read',
        $expression$exists (
          select 1 from public.group_members membership
          where membership.group_id = badge_showcases.group_id
            and membership.user_id = (select auth.uid())
        )$expression$,
        null::text),
      ('public', 'badge_showcases', 'badge_showcases_owner_write',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())
          and exists (
            select 1 from public.group_members membership
            where membership.group_id = badge_showcases.group_id
              and membership.user_id = (select auth.uid())
          )$expression$),
      ('public', 'account_devices', 'account_devices_owner_read',
        $expression$user_id = (select auth.uid())$expression$, null::text),
      ('public', 'account_devices', 'account_devices_owner_insert', null::text,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'account_devices', 'account_devices_owner_update',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'account_devices', 'account_devices_owner_delete',
        $expression$user_id = (select auth.uid())$expression$, null::text),
      ('public', 'health_connections', 'health_connections_owner_all',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'health_sync_cursors', 'health_sync_cursors_owner_all',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'device_push_tokens', 'push_tokens_owner_read',
        $expression$user_id = (select auth.uid())$expression$, null::text),
      ('public', 'device_push_tokens', 'push_tokens_owner_insert', null::text,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'device_push_tokens', 'push_tokens_owner_update',
        $expression$user_id = (select auth.uid())$expression$,
        $expression$user_id = (select auth.uid())$expression$),
      ('public', 'device_push_tokens', 'push_tokens_owner_delete',
        $expression$user_id = (select auth.uid())$expression$, null::text),
      ('public', 'group_members', 'members_group_read',
        $expression$user_id = (select auth.uid())
          or public.is_group_member(group_id)
          or public.is_group_admin(group_id)$expression$,
        null::text),
      ('public', 'group_challenges', 'group_challenges_invited_read',
        $expression$(select auth.uid()) = any(participant_ids)
          and public.is_group_member(group_id)$expression$,
        null::text)
    ) as definitions(
      schema_name,
      table_name,
      policy_name,
      using_expression,
      check_expression
    )
  loop
    if exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = policy_definition.schema_name
        and policy.tablename = policy_definition.table_name
        and policy.policyname = policy_definition.policy_name
    ) then
      alteration := format(
        'alter policy %I on %I.%I',
        policy_definition.policy_name,
        policy_definition.schema_name,
        policy_definition.table_name
      );
      if policy_definition.using_expression is not null then
        alteration := alteration || ' using (' || policy_definition.using_expression || ')';
      end if;
      if policy_definition.check_expression is not null then
        alteration := alteration || ' with check (' || policy_definition.check_expression || ')';
      end if;
      execute alteration;
    end if;
  end loop;
end;
$migration$;
