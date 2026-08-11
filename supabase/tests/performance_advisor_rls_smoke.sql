-- Transaction-only smoke test for migrations 202608110003 and 202608110004.
-- This script intentionally leaves no users, rows, functions, or settings.
-- Run with ON_ERROR_STOP through an authenticated PostgreSQL/management SQL
-- connection; the outer transaction always rolls back its fixture rows.

begin;

create function pg_temp.assert_equal(
  assertion_name text,
  actual_value bigint,
  expected_value bigint
)
returns void
language plpgsql
as $$
begin
  if actual_value is distinct from expected_value then
    raise exception '%: expected %, received %',
      assertion_name,
      expected_value,
      actual_value;
  end if;
end;
$$;
grant execute on function pg_temp.assert_equal(text, bigint, bigint) to public;

create function pg_temp.expect_insufficient_privilege(
  assertion_name text,
  attempted_statement text
)
returns void
language plpgsql
as $$
declare
  was_blocked boolean := false;
begin
  begin
    execute attempted_statement;
  exception when insufficient_privilege then
    was_blocked := true;
  end;
  if not was_blocked then
    raise exception '%: statement unexpectedly succeeded', assertion_name;
  end if;
end;
$$;
grant execute on function pg_temp.expect_insufficient_privilege(text, text)
  to public;

-- Catalog-level checks catch omissions before the behavioral matrix runs.
select pg_temp.assert_equal(
  'all nineteen foreign-key indexes exist',
  (
    select count(*)
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = any(array[
        'automation_rules_group_id_idx',
        'badge_showcases_group_id_idx',
        'daily_metric_status_metric_id_idx',
        'daily_metric_status_user_id_idx',
        'dashboard_layouts_group_id_idx',
        'group_challenges_creator_id_idx',
        'group_member_aliases_subject_user_id_idx',
        'groups_owner_id_idx',
        'media_assets_owner_user_id_idx',
        'member_aliases_subject_user_id_idx',
        'metric_definitions_owner_user_id_idx',
        'metric_goals_metric_id_idx',
        'metric_goals_user_id_idx',
        'photo_updates_media_asset_id_idx',
        'photo_updates_group_id_idx',
        'push_events_sender_id_idx',
        'templates_creator_user_id_idx',
        'templates_creator_group_id_idx',
        'tracked_goal_periods_metric_id_idx'
      ])
  ),
  19
);

select pg_temp.assert_equal(
  'redundant client-id indexes were removed',
  (
    select count(*)
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = any(array[
        'messages_sender_client_id_idx',
        'photos_owner_client_id_idx'
      ])
  ),
  0
);

select pg_temp.assert_equal(
  'one permissive read path remains per consolidated table',
  (
    select count(*)
    from (
      select policy.tablename
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = any(array[
          'automation_rules',
          'badge_showcases',
          'media_assets',
          'metric_entries',
          'metric_goals',
          'photo_updates',
          'profiles',
          'templates',
          'template_versions'
        ])
        and policy.cmd in ('SELECT', 'ALL')
      group by policy.tablename
      having count(*) = 1
    ) consolidated
  ),
  9
);

select pg_temp.assert_equal(
  'auth uid calls use initPlans on advisor tables',
  (
    select count(*)
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = any(array[
        'profiles', 'groups', 'metric_definitions', 'metric_goals',
        'dashboard_layouts', 'media_assets', 'templates',
        'template_versions', 'user_snapshots', 'messages',
        'daily_metric_status', 'member_aliases',
        'notification_preferences', 'tracked_goal_periods',
        'badge_showcases', 'account_devices', 'health_connections',
        'health_sync_cursors', 'device_push_tokens', 'group_members',
        'group_challenges'
      ])
      and (
        (
          coalesce(policy.qual, '') ~* 'auth\.uid\(\)'
          and coalesce(policy.qual, '') !~* 'select[[:space:]]+auth\.uid\(\)'
        )
        or (
          coalesce(policy.with_check, '') ~* 'auth\.uid\(\)'
          and coalesce(policy.with_check, '') !~* 'select[[:space:]]+auth\.uid\(\)'
        )
      )
  ),
  0
);

-- Generate collision-proof fixture identifiers and keep them transaction local.
select set_config('metricrally.smoke.owner_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.admin_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.member_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.pending_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.former_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.outsider_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.group_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.automation_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.metric_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.group_asset_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.private_asset_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.public_template_id', gen_random_uuid()::text, true);
select set_config('metricrally.smoke.private_template_id', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', '{}'::text, true);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    current_setting('metricrally.smoke.owner_id')::uuid,
    'rls-owner-' || current_setting('metricrally.smoke.owner_id') || '@example.invalid',
    '{"display_name":"RLS owner"}'::jsonb
  ),
  (
    current_setting('metricrally.smoke.admin_id')::uuid,
    'rls-admin-' || current_setting('metricrally.smoke.admin_id') || '@example.invalid',
    '{"display_name":"RLS admin"}'::jsonb
  ),
  (
    current_setting('metricrally.smoke.member_id')::uuid,
    'rls-member-' || current_setting('metricrally.smoke.member_id') || '@example.invalid',
    '{"display_name":"RLS member"}'::jsonb
  ),
  (
    current_setting('metricrally.smoke.pending_id')::uuid,
    'rls-pending-' || current_setting('metricrally.smoke.pending_id') || '@example.invalid',
    '{"display_name":"RLS pending"}'::jsonb
  ),
  (
    current_setting('metricrally.smoke.former_id')::uuid,
    'rls-former-' || current_setting('metricrally.smoke.former_id') || '@example.invalid',
    '{"display_name":"RLS former"}'::jsonb
  ),
  (
    current_setting('metricrally.smoke.outsider_id')::uuid,
    'rls-outsider-' || current_setting('metricrally.smoke.outsider_id') || '@example.invalid',
    '{"display_name":"RLS outsider"}'::jsonb
  );

insert into public.groups (id, owner_id, name, invite_code)
values (
  current_setting('metricrally.smoke.group_id')::uuid,
  current_setting('metricrally.smoke.owner_id')::uuid,
  'Performance advisor RLS smoke',
  'RLS-' || left(replace(current_setting('metricrally.smoke.group_id'), '-', ''), 20)
);

insert into public.group_members (group_id, user_id, role, status)
values
  (
    current_setting('metricrally.smoke.group_id')::uuid,
    current_setting('metricrally.smoke.admin_id')::uuid,
    'admin',
    'active'
  ),
  (
    current_setting('metricrally.smoke.group_id')::uuid,
    current_setting('metricrally.smoke.member_id')::uuid,
    'member',
    'active'
  ),
  (
    current_setting('metricrally.smoke.group_id')::uuid,
    current_setting('metricrally.smoke.pending_id')::uuid,
    'member',
    'pending'
  );

-- Structural tracker writes deliberately require the same configuration fence
-- marker used by the atomic workspace RPCs, even for a rollback-only fixture.
select set_config(
  'habhub.group_configuration_id',
  current_setting('metricrally.smoke.group_id'),
  true
);

insert into public.automation_rules (
  id, group_id, name, trigger_type, message_template
)
values (
  current_setting('metricrally.smoke.automation_id')::uuid,
  current_setting('metricrally.smoke.group_id')::uuid,
  'RLS smoke automation',
  'manual',
  'Smoke'
);

insert into public.badge_showcases (user_id, group_id, badge_ids)
values
  (
    current_setting('metricrally.smoke.owner_id')::uuid,
    current_setting('metricrally.smoke.group_id')::uuid,
    array['owner-badge']
  ),
  (
    current_setting('metricrally.smoke.former_id')::uuid,
    current_setting('metricrally.smoke.group_id')::uuid,
    array['former-badge']
  );

insert into public.media_assets (id, owner_user_id, storage_path)
values
  (
    current_setting('metricrally.smoke.group_asset_id')::uuid,
    current_setting('metricrally.smoke.former_id')::uuid,
    current_setting('metricrally.smoke.former_id') || '/rls-group.jpg'
  ),
  (
    current_setting('metricrally.smoke.private_asset_id')::uuid,
    current_setting('metricrally.smoke.former_id')::uuid,
    current_setting('metricrally.smoke.former_id') || '/rls-private.jpg'
  );

insert into public.photo_updates (
  media_asset_id, owner_user_id, group_id, local_date, visibility,
  client_generated_id
)
values
  (
    current_setting('metricrally.smoke.group_asset_id')::uuid,
    current_setting('metricrally.smoke.former_id')::uuid,
    current_setting('metricrally.smoke.group_id')::uuid,
    current_date,
    'group',
    'rls-group-photo-' || current_setting('metricrally.smoke.group_id')
  ),
  (
    current_setting('metricrally.smoke.private_asset_id')::uuid,
    current_setting('metricrally.smoke.former_id')::uuid,
    current_setting('metricrally.smoke.group_id')::uuid,
    current_date,
    'private',
    'rls-private-photo-' || current_setting('metricrally.smoke.group_id')
  );

insert into public.metric_definitions (id, group_id, slug, name)
values (
  current_setting('metricrally.smoke.metric_id')::uuid,
  current_setting('metricrally.smoke.group_id')::uuid,
  'rls-smoke',
  'RLS smoke metric'
);

insert into public.metric_entries (
  client_generated_id, metric_id, user_id, value, local_date, recorded_at,
  visibility
)
values
  (
    'rls-group-entry-' || current_setting('metricrally.smoke.group_id'),
    current_setting('metricrally.smoke.metric_id')::uuid,
    current_setting('metricrally.smoke.former_id')::uuid,
    '10'::jsonb,
    current_date,
    now(),
    'group'
  ),
  (
    'rls-private-entry-' || current_setting('metricrally.smoke.group_id'),
    current_setting('metricrally.smoke.metric_id')::uuid,
    current_setting('metricrally.smoke.former_id')::uuid,
    '20'::jsonb,
    current_date,
    now(),
    'private'
  );

insert into public.metric_goals (metric_id, user_id, target_value)
values
  (
    current_setting('metricrally.smoke.metric_id')::uuid,
    null,
    10
  ),
  (
    current_setting('metricrally.smoke.metric_id')::uuid,
    current_setting('metricrally.smoke.former_id')::uuid,
    20
  );

insert into public.templates (
  id, creator_user_id, creator_group_id, name, visibility
)
values
  (
    current_setting('metricrally.smoke.public_template_id')::uuid,
    current_setting('metricrally.smoke.owner_id')::uuid,
    current_setting('metricrally.smoke.group_id')::uuid,
    'RLS public template',
    'public'
  ),
  (
    current_setting('metricrally.smoke.private_template_id')::uuid,
    current_setting('metricrally.smoke.former_id')::uuid,
    null,
    'RLS private template',
    'private'
  );

insert into public.template_versions (template_id, version, configuration)
values
  (
    current_setting('metricrally.smoke.public_template_id')::uuid,
    1,
    '{}'::jsonb
  ),
  (
    current_setting('metricrally.smoke.private_template_id')::uuid,
    1,
    '{}'::jsonb
  );

insert into public.group_challenges (
  group_id, creator_id, metric_slug, target_value, local_date,
  participant_ids
)
values (
  current_setting('metricrally.smoke.group_id')::uuid,
  current_setting('metricrally.smoke.owner_id')::uuid,
  'rls-smoke',
  10,
  current_date,
  array[
    current_setting('metricrally.smoke.owner_id')::uuid,
    current_setting('metricrally.smoke.member_id')::uuid
  ]
);

-- Group owner: active member, administrator, challenge invitee, and reviewer.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('metricrally.smoke.owner_id'),
    'role', 'authenticated'
  )::text,
  true
);
select pg_temp.assert_equal('owner automation read', (select count(*) from public.automation_rules), 1);
select pg_temp.assert_equal('owner badge read', (select count(*) from public.badge_showcases), 2);
select pg_temp.assert_equal('owner media read', (select count(*) from public.media_assets), 1);
select pg_temp.assert_equal('owner entry read', (select count(*) from public.metric_entries), 1);
select pg_temp.assert_equal('owner goal read', (select count(*) from public.metric_goals), 1);
select pg_temp.assert_equal('owner photo read', (select count(*) from public.photo_updates), 1);
select pg_temp.assert_equal('owner profile read', (select count(*) from public.profiles), 4);
select pg_temp.assert_equal('owner template read', (select count(*) from public.templates), 1);
select pg_temp.assert_equal('owner template version read', (select count(*) from public.template_versions), 1);
select pg_temp.assert_equal('owner challenge read', (select count(*) from public.group_challenges), 1);
reset role;

-- Administrator: same group visibility and pending-member review, but not an
-- invited challenge participant.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('metricrally.smoke.admin_id'),
    'role', 'authenticated'
  )::text,
  true
);
select pg_temp.assert_equal('admin automation read', (select count(*) from public.automation_rules), 1);
select pg_temp.assert_equal('admin badge read', (select count(*) from public.badge_showcases), 2);
select pg_temp.assert_equal('admin media read', (select count(*) from public.media_assets), 1);
select pg_temp.assert_equal('admin entry read', (select count(*) from public.metric_entries), 1);
select pg_temp.assert_equal('admin goal read', (select count(*) from public.metric_goals), 1);
select pg_temp.assert_equal('admin photo read', (select count(*) from public.photo_updates), 1);
select pg_temp.assert_equal('admin profile read', (select count(*) from public.profiles), 4);
select pg_temp.assert_equal('admin template read', (select count(*) from public.templates), 1);
select pg_temp.assert_equal('admin template version read', (select count(*) from public.template_versions), 1);
select pg_temp.assert_equal('admin uninvited challenge read', (select count(*) from public.group_challenges), 0);
with changed as (
  update public.automation_rules set enabled = false
  where id = current_setting('metricrally.smoke.automation_id')::uuid
  returning 1
)
select pg_temp.assert_equal('admin automation update', (select count(*) from changed), 1);
with inserted as (
  insert into public.automation_rules (
    group_id, name, trigger_type, message_template
  ) values (
    current_setting('metricrally.smoke.group_id')::uuid,
    'Admin-created smoke rule',
    'manual',
    'Smoke'
  ) returning 1
)
select pg_temp.assert_equal('admin automation insert', (select count(*) from inserted), 1);
reset role;

-- Ordinary member: group reads and explicit challenge invite work; admin writes
-- do not.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('metricrally.smoke.member_id'),
    'role', 'authenticated'
  )::text,
  true
);
select pg_temp.assert_equal('member automation read', (select count(*) from public.automation_rules), 2);
select pg_temp.assert_equal('member badge read', (select count(*) from public.badge_showcases), 2);
select pg_temp.assert_equal('member media read', (select count(*) from public.media_assets), 1);
select pg_temp.assert_equal('member entry read', (select count(*) from public.metric_entries), 1);
select pg_temp.assert_equal('member goal read', (select count(*) from public.metric_goals), 1);
select pg_temp.assert_equal('member photo read', (select count(*) from public.photo_updates), 1);
select pg_temp.assert_equal('member profile read', (select count(*) from public.profiles), 3);
select pg_temp.assert_equal('member template read', (select count(*) from public.templates), 1);
select pg_temp.assert_equal('member template version read', (select count(*) from public.template_versions), 1);
select pg_temp.assert_equal('member invited challenge read', (select count(*) from public.group_challenges), 1);
with changed as (
  update public.automation_rules set enabled = true
  where id = current_setting('metricrally.smoke.automation_id')::uuid
  returning 1
)
select pg_temp.assert_equal('member automation update blocked', (select count(*) from changed), 0);
select pg_temp.expect_insufficient_privilege(
  'member automation insert blocked',
  format(
    $statement$insert into public.automation_rules (
      group_id, name, trigger_type, message_template
    ) values (%L::uuid, 'Blocked member rule', 'manual', 'Smoke')$statement$,
    current_setting('metricrally.smoke.group_id')
  )
);
reset role;

-- Former member: ownership remains readable exactly as before, but group-only
-- rows disappear. Existing owner DELETE semantics remain intact even after the
-- user leaves the group; owner UPDATE checks that require membership still fail.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('metricrally.smoke.former_id'),
    'role', 'authenticated'
  )::text,
  true
);
select pg_temp.assert_equal('former automation read', (select count(*) from public.automation_rules), 0);
select pg_temp.assert_equal('former owned badge read', (select count(*) from public.badge_showcases), 1);
select pg_temp.assert_equal('former owned media read', (select count(*) from public.media_assets), 2);
select pg_temp.assert_equal('former owned entries read', (select count(*) from public.metric_entries), 2);
select pg_temp.assert_equal('former owned goal read', (select count(*) from public.metric_goals), 1);
select pg_temp.assert_equal('former owned photos read', (select count(*) from public.photo_updates), 2);
select pg_temp.assert_equal('former self profile read', (select count(*) from public.profiles), 1);
select pg_temp.assert_equal('former templates read', (select count(*) from public.templates), 2);
select pg_temp.assert_equal('former template versions read', (select count(*) from public.template_versions), 2);
select pg_temp.assert_equal('former challenge read', (select count(*) from public.group_challenges), 0);
select pg_temp.expect_insufficient_privilege(
  'former badge update still requires membership',
  format(
    $statement$update public.badge_showcases
      set badge_ids = array['blocked']
      where user_id = %L::uuid and group_id = %L::uuid$statement$,
    current_setting('metricrally.smoke.former_id'),
    current_setting('metricrally.smoke.group_id')
  )
);
with deleted as (
  delete from public.badge_showcases
  where user_id = current_setting('metricrally.smoke.former_id')::uuid
    and group_id = current_setting('metricrally.smoke.group_id')::uuid
  returning 1
)
select pg_temp.assert_equal('former badge delete preserved', (select count(*) from deleted), 1);
with changed as (
  update public.media_assets set thumbnail_path = 'smoke-thumb.jpg'
  where id = current_setting('metricrally.smoke.private_asset_id')::uuid
  returning 1
)
select pg_temp.assert_equal('former media update preserved', (select count(*) from changed), 1);
with changed as (
  update public.metric_goals set target_value = 21
  where user_id = current_setting('metricrally.smoke.former_id')::uuid
  returning 1
)
select pg_temp.assert_equal('former goal update preserved', (select count(*) from changed), 1);
with changed as (
  update public.templates set description = 'owner update'
  where id = current_setting('metricrally.smoke.private_template_id')::uuid
  returning 1
)
select pg_temp.assert_equal('former template update preserved', (select count(*) from changed), 1);
with changed as (
  update public.template_versions set change_notes = 'owner update'
  where template_id = current_setting('metricrally.smoke.private_template_id')::uuid
  returning 1
)
select pg_temp.assert_equal('former template version update preserved', (select count(*) from changed), 1);
reset role;

-- Unrelated authenticated user: only self and genuinely public templates show.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('metricrally.smoke.outsider_id'),
    'role', 'authenticated'
  )::text,
  true
);
select pg_temp.assert_equal('outsider automation hidden', (select count(*) from public.automation_rules), 0);
select pg_temp.assert_equal('outsider badges hidden', (select count(*) from public.badge_showcases), 0);
select pg_temp.assert_equal('outsider media hidden', (select count(*) from public.media_assets), 0);
select pg_temp.assert_equal('outsider entries hidden', (select count(*) from public.metric_entries), 0);
select pg_temp.assert_equal('outsider goals hidden', (select count(*) from public.metric_goals), 0);
select pg_temp.assert_equal('outsider photos hidden', (select count(*) from public.photo_updates), 0);
select pg_temp.assert_equal('outsider self profile visible', (select count(*) from public.profiles), 1);
select pg_temp.assert_equal('outsider public template visible', (select count(*) from public.templates), 1);
select pg_temp.assert_equal('outsider public template version visible', (select count(*) from public.template_versions), 1);
select pg_temp.assert_equal('outsider challenge hidden', (select count(*) from public.group_challenges), 0);
with changed as (
  update public.media_assets set thumbnail_path = 'blocked.jpg'
  where id = current_setting('metricrally.smoke.private_asset_id')::uuid
  returning 1
)
select pg_temp.assert_equal('outsider media update blocked', (select count(*) from changed), 0);
with changed as (
  update public.templates set description = 'blocked'
  where id = current_setting('metricrally.smoke.private_template_id')::uuid
  returning 1
)
select pg_temp.assert_equal('outsider template update blocked', (select count(*) from changed), 0);
with changed as (
  update public.template_versions set change_notes = 'blocked'
  where template_id = current_setting('metricrally.smoke.private_template_id')::uuid
  returning 1
)
select pg_temp.assert_equal('outsider template version update blocked', (select count(*) from changed), 0);
reset role;

-- Anonymous role: only published templates and their versions remain readable;
-- write attempts have neither a write policy nor an authenticated role grant.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.assert_equal('anon public template visible', (select count(*) from public.templates), 1);
select pg_temp.assert_equal('anon public template version visible', (select count(*) from public.template_versions), 1);
select pg_temp.expect_insufficient_privilege(
  'anon template insert blocked',
  $statement$insert into public.templates (name, visibility)
    values ('Blocked anon template', 'public')$statement$
);
reset role;

rollback;
