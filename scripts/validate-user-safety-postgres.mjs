import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const migration = await Deno.readTextFile(
  new URL("supabase/migrations/202609040002_user_safety.sql", root),
);

const GROUP = "10000000-0000-4000-8000-000000000001";
const ALICE = "20000000-0000-4000-8000-000000000001";
const BOB = "20000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000003";
const ALICE_MESSAGE = "30000000-0000-4000-8000-000000000001";
const ALICE_COMMENT = "40000000-0000-4000-8000-000000000001";

const db = new PGlite();

async function first(sql) {
  return (await db.query(sql)).rows[0];
}

async function asUser(userId) {
  await db.exec(`
    reset role;
    set request.jwt.claim.sub = '${userId}';
    set role authenticated;
  `);
}

async function asService() {
  await db.exec(`
    reset role;
    reset request.jwt.claim.sub;
    set role service_role;
  `);
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema storage;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function storage.foldername(object_path text)
    returns text[] language sql immutable as $$
      select string_to_array(object_path, '/')
    $$;
    create table auth.users (id uuid primary key);

    create table public.profiles (
      id uuid primary key,
      display_name text,
      avatar_path text
    );
    create table public.groups (
      id uuid primary key
    );
    create table public.metric_definitions (
      id uuid primary key,
      group_id uuid references public.groups(id) on delete cascade
    );
    create table public.metric_entries (
      id uuid primary key,
      metric_id uuid not null references public.metric_definitions(id) on delete cascade,
      user_id uuid not null references public.profiles(id) on delete cascade,
      visibility text not null default 'group',
      image_path text
    );
    create table public.media_assets (
      id uuid primary key,
      owner_user_id uuid not null references public.profiles(id) on delete cascade,
      storage_path text
    );
    create table public.photo_updates (
      id uuid primary key,
      media_asset_id uuid not null references public.media_assets(id) on delete cascade,
      owner_user_id uuid not null references public.profiles(id) on delete cascade,
      group_id uuid references public.groups(id) on delete cascade,
      client_generated_id text,
      visibility text not null default 'group'
    );
    alter table public.metric_entries enable row level security;
    alter table public.media_assets enable row level security;
    alter table public.photo_updates enable row level security;
    create policy media_authorized_read on public.media_assets for select to authenticated
      using (owner_user_id = auth.uid());
    create policy media_owner_insert on public.media_assets for insert to authenticated
      with check (owner_user_id = auth.uid());
    create policy media_owner_update on public.media_assets for update to authenticated
      using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
    create policy media_owner_delete on public.media_assets for delete to authenticated
      using (owner_user_id = auth.uid());
    create table public.group_members (
      group_id uuid not null references public.groups(id) on delete cascade,
      user_id uuid not null references public.profiles(id) on delete cascade,
      status text not null default 'active',
      role text not null default 'member',
      primary key (group_id, user_id)
    );
    create table public.group_challenges (
      id uuid primary key,
      group_id uuid not null references public.groups(id) on delete cascade,
      creator_id uuid references public.profiles(id) on delete set null,
      participant_ids uuid[] not null default '{}',
      audience text not null default 'group',
      visual_image_path text,
      deleted_at timestamptz
    );
    create table public.google_health_account_deletion_guards (
      user_id uuid primary key
    );
    create table public.messages (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.groups(id) on delete cascade,
      sender_id uuid references public.profiles(id) on delete set null,
      client_generated_id text,
      recipient_id uuid references public.profiles(id) on delete cascade,
      content text not null check (char_length(content) between 1 and 4000),
      image_path text,
      created_at timestamptz not null default clock_timestamp(),
      unique (sender_id, client_generated_id)
    );
    alter table public.messages enable row level security;
    create table public.group_social_reactions (
      group_id uuid not null references public.groups(id) on delete cascade,
      target_type text not null,
      target_id text not null,
      user_id uuid not null references public.profiles(id) on delete cascade,
      reaction text not null,
      source_surface text not null default 'feed',
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      primary key (group_id, target_type, target_id, user_id)
    );
    create table public.group_social_comments (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.groups(id) on delete cascade,
      target_type text not null,
      target_id text not null,
      user_id uuid not null references public.profiles(id) on delete cascade,
      content text not null,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp()
    );
    alter table public.group_social_reactions enable row level security;
    alter table public.group_social_comments enable row level security;
    create table public.push_dispatch_events (
      event_key text not null,
      dispatcher_id uuid
    );

    create function public.is_group_member(p_group_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $$
      select exists (
        select 1 from public.group_members membership
        where membership.group_id = p_group_id
          and membership.user_id = (select auth.uid())
          and membership.status = 'active'
      )
    $$;
    create function public.is_group_admin(p_group_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $$
      select exists (
        select 1 from public.group_members membership
        where membership.group_id = p_group_id
          and membership.user_id = (select auth.uid())
          and membership.status = 'active'
          and membership.role in ('owner', 'admin')
      )
    $$;
    create function public.shares_group_with(p_target_user_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $$
      select exists (
        select 1
          from public.group_members mine
          join public.group_members theirs on theirs.group_id = mine.group_id
         where mine.user_id = (select auth.uid())
           and mine.status = 'active'
           and theirs.user_id = p_target_user_id
           and theirs.status = 'active'
      )
    $$;
    create function public.valid_group_social_target(
      p_group_id uuid,
      p_target_type text,
      p_target_id text
    ) returns boolean language sql stable security definer set search_path = '' as $$
      select exists (
        select 1 from public.groups target_group
        where target_group.id = p_group_id
      ) and char_length(coalesce(p_target_type, '')) > 0
        and char_length(coalesce(p_target_id, '')) > 0
    $$;

    -- Model the installed SECURITY DEFINER writer that the v2 RPC delegates
    -- to. The safety migration must protect this path without relying on RLS.
    create function public.set_group_social_reaction(
      p_group_id uuid,
      p_target_type text,
      p_target_id text,
      p_reaction text,
      p_surface text
    ) returns public.group_social_reactions
    language plpgsql security definer set search_path = '' as $$
    declare
      actor_id uuid := (select auth.uid());
      result public.group_social_reactions%rowtype;
    begin
      if actor_id is null then
        raise exception 'Sign in to react to a shared item.' using errcode = '42501';
      end if;
      if p_reaction is null then
        delete from public.group_social_reactions reaction
         where reaction.group_id = p_group_id
           and reaction.target_type = p_target_type
           and reaction.target_id = p_target_id
           and reaction.user_id = actor_id
        returning * into result;
        return result;
      end if;
      insert into public.group_social_reactions (
        group_id, target_type, target_id, user_id, reaction, source_surface
      ) values (
        p_group_id, p_target_type, p_target_id, actor_id, p_reaction, p_surface
      )
      on conflict (group_id, target_type, target_id, user_id)
      do update set reaction = excluded.reaction,
                    source_surface = excluded.source_surface,
                    updated_at = clock_timestamp()
      returning * into result;
      return result;
    end;
    $$;

    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select, insert, update, delete on public.messages to authenticated;
    grant select, insert, update, delete on public.group_social_reactions to authenticated;
    grant select, insert, update, delete on public.group_social_comments to authenticated;
    grant select on public.metric_entries to authenticated;
    grant select on public.metric_definitions to authenticated;
    grant select, insert, update, delete on public.media_assets to authenticated;
    grant select on public.photo_updates to authenticated;
    revoke all on function public.set_group_social_reaction(
      uuid, text, text, text, text
    ) from public, anon;
    grant execute on function public.set_group_social_reaction(
      uuid, text, text, text, text
    ) to authenticated;

    insert into public.groups (id) values ('${GROUP}');
    insert into public.metric_definitions (id, group_id)
    values ('50000000-0000-4000-8000-000000000001', '${GROUP}');
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}'), ('${ADMIN}');
    insert into public.profiles (id, display_name, avatar_path) values
      ('${ALICE}', 'Alice', '${ALICE}/avatar.jpg'),
      ('${BOB}', 'Bob', '${BOB}/avatar.jpg'),
      ('${ADMIN}', 'Group admin', '${ADMIN}/avatar.jpg');
    insert into public.group_members (group_id, user_id, role) values
      ('${GROUP}', '${ALICE}', 'member'),
      ('${GROUP}', '${BOB}', 'member'),
      ('${GROUP}', '${ADMIN}', 'admin');
    insert into public.metric_entries (id, metric_id, user_id, image_path) values
      ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '${ALICE}', '${ALICE}/entry.jpg'),
      ('51000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '${BOB}', '${BOB}/entry.jpg');
    insert into public.media_assets (id, owner_user_id, storage_path) values
      ('52000000-0000-4000-8000-000000000001', '${ALICE}', '${ALICE}/photo.jpg'),
      ('52000000-0000-4000-8000-000000000002', '${BOB}', '${BOB}/photo.jpg');
    insert into public.photo_updates (
      id, media_asset_id, owner_user_id, group_id, client_generated_id
    ) values
      ('53000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '${ALICE}', '${GROUP}', 'alice-photo'),
      ('53000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002', '${BOB}', '${GROUP}', 'bob-photo');
    insert into public.group_challenges (
      id, group_id, creator_id, participant_ids, audience, visual_image_path
    ) values (
      '54000000-0000-4000-8000-000000000001', '${GROUP}', '${ALICE}',
      array['${ALICE}'::uuid, '${BOB}'::uuid], 'group', '${ALICE}/challenge.jpg'
    );
  `);

  await db.exec(migration);

  const rls = await first(`
    select
      (select relrowsecurity from pg_class where oid = 'public.user_blocks'::regclass) as blocks,
      (select relrowsecurity from pg_class where oid = 'public.user_safety_reports'::regclass) as reports,
      (select relrowsecurity from pg_class where oid = 'public.user_terms_acceptances'::regclass) as acceptances
  `);
  assert.deepEqual(rls, { blocks: true, reports: true, acceptances: true });

  const privileges = await first(`
    select
      has_table_privilege('authenticated', 'public.user_safety_reports', 'select') as reports_read,
      has_table_privilege('authenticated', 'public.user_safety_reports', 'insert') as reports_insert,
      has_function_privilege('authenticated', 'public.habhub_report_message(uuid,text,uuid,text,text)', 'execute') as report_rpc,
      has_function_privilege('authenticated', 'public.habhub_report_comment(uuid,uuid,uuid,text,text)', 'execute') as report_comment_rpc,
      has_function_privilege('authenticated', 'public.habhub_users_blocked_either_way(uuid,uuid)', 'execute') as private_block_helper,
      has_function_privilege('authenticated', 'public.set_group_social_reaction_v2(uuid,text,text,text,text)', 'execute') as reaction_rpc,
      has_function_privilege('anon', 'public.set_group_social_reaction_v2(uuid,text,text,text,text)', 'execute') as anonymous_reaction_rpc,
      has_function_privilege('authenticated', 'public.habhub_enforce_group_social_reaction_terms()', 'execute') as private_reaction_guard
      ,has_function_privilege('authenticated', 'public.habhub_list_operator_safety_reports(text,timestamp with time zone,uuid,integer)', 'execute') as operator_queue_client
      ,has_function_privilege('authenticated', 'public.habhub_moderate_operator_safety_report(uuid,text,text,text)', 'execute') as operator_action_client
      ,has_function_privilege('service_role', 'public.habhub_list_operator_safety_reports(text,timestamp with time zone,uuid,integer)', 'execute') as operator_queue_service
      ,has_function_privilege('service_role', 'public.habhub_moderate_operator_safety_report(uuid,text,text,text)', 'execute') as operator_action_service
      ,has_function_privilege('authenticated', 'public.habhub_operator_safety_queue_health()', 'execute') as operator_health_client
      ,has_function_privilege('service_role', 'public.habhub_operator_safety_queue_health()', 'execute') as operator_health_service
  `);
  assert.deepEqual(privileges, {
    reports_read: false,
    reports_insert: false,
    report_rpc: true,
    report_comment_rpc: true,
    private_block_helper: false,
    reaction_rpc: true,
    anonymous_reaction_rpc: false,
    private_reaction_guard: false,
    operator_queue_client: false,
    operator_action_client: false,
    operator_queue_service: true,
    operator_action_service: true,
    operator_health_client: false,
    operator_health_service: true,
  });

  await assert.rejects(
    () =>
      db.query(`
        select public.set_group_social_reaction_v2(
          '${GROUP}', 'recap_feed', 'fixture', 'heart', 'feed'
        )
      `),
    /Sign in to react/i,
    "the v2 reaction RPC must fail closed when auth.uid() is absent",
  );

  await asUser(BOB);
  assert.equal(
    (await first(`select ugc_terms_enforced from public.app_policy_versions where singleton`)).ugc_terms_enforced,
    false,
    "the migration must remain compatible with the previous store client",
  );
  assert.equal(
    (await first(`select public.habhub_can_direct_message('${GROUP}', '${ALICE}') as allowed`)).allowed,
    true,
    "legacy clients remain usable until the staged Terms switch is activated",
  );
  await db.exec(`
    insert into public.messages (group_id, sender_id, client_generated_id, content)
    values ('${GROUP}', '${BOB}', 'bob-before-enforcement', 'Legacy rollout compatibility')
  `);
  await db.exec(`
    reset role;
    delete from public.messages where client_generated_id = 'bob-before-enforcement';
    update public.app_policy_versions
    set ugc_terms_enforced = true
    where singleton;
  `);
  await asUser(BOB);
  assert.equal(
    (await first(`select public.habhub_can_direct_message('${GROUP}', '${ALICE}') as allowed`)).allowed,
    false,
    "server UGC writes must require current Terms after staged activation",
  );
  await assert.rejects(
    () =>
      db.query(`
        select public.set_group_social_reaction_v2(
          '${GROUP}', 'recap_feed', 'fixture', 'heart', 'feed'
        )
      `),
    /Accept the current Terms/i,
    "the normal v2 reaction RPC must reject writes before current-Terms acceptance",
  );
  await assert.rejects(
    () =>
      db.query(`
        select public.set_group_social_reaction(
          '${GROUP}', 'recap_feed', 'fixture', 'heart', 'feed'
        )
      `),
    /Accept the current Terms/i,
    "the underlying SECURITY DEFINER writer must not bypass the Terms boundary",
  );
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.messages (group_id, sender_id, client_generated_id, content)
        values ('${GROUP}', '${BOB}', 'bob-before-terms', 'Hello before Terms')
      `),
    /row-level security/i,
  );

  const accepted = await first(`select public.habhub_accept_current_terms() as result`);
  assert.equal(accepted.result.termsVersion, "2026-09-04");
  const acceptedReaction = await first(`
    select public.set_group_social_reaction_v2(
      '${GROUP}', 'recap_feed', 'fixture', 'heart', 'feed'
    ) as result
  `);
  assert.equal(acceptedReaction.result.reaction.reaction, "heart");
  assert.equal(acceptedReaction.result.reaction.user_id, BOB);
  await db.exec(`
    insert into public.messages (group_id, sender_id, client_generated_id, content)
    values ('${GROUP}', '${BOB}', 'bob-safe', 'Nice workout today')
  `);
  await db.exec(`
    insert into public.group_social_comments (
      group_id, target_type, target_id, user_id, content
    ) values ('${GROUP}', 'recap_feed', 'fixture', '${BOB}', 'Great progress')
  `);
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.messages (group_id, sender_id, client_generated_id, content)
        values ('${GROUP}', '${BOB}', 'bob-abuse', 'go kill yourself')
      `),
    /row-level security/i,
  );
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.group_social_comments (
          group_id, target_type, target_id, user_id, content
        ) values ('${GROUP}', 'recap_feed', 'fixture', '${BOB}', 'go kill yourself')
      `),
    /row-level security/i,
    "feed comments must use the same server-side abuse filter as chat",
  );

  await asUser(ALICE);
  await db.exec(`select public.habhub_accept_current_terms()`);
  await db.exec(`
    insert into public.media_assets (id, owner_user_id)
    values ('52000000-0000-4000-8000-000000000003', '${ALICE}');
    update public.media_assets
       set owner_user_id = '${ALICE}'
     where id = '52000000-0000-4000-8000-000000000003';
    delete from public.media_assets
     where id = '52000000-0000-4000-8000-000000000003';
  `);
  assert.equal(
    Number(
      (
        await first(`
          select count(*)::integer as count
          from public.media_assets
          where id = '52000000-0000-4000-8000-000000000003'
        `)
      ).count,
    ),
    0,
    "safety read policies must preserve the owner's media write policy",
  );
  await db.exec(`
    insert into public.messages (
      id, group_id, sender_id, client_generated_id, content, image_path
    ) values (
      '${ALICE_MESSAGE}', '${GROUP}', '${ALICE}', 'alice-message',
      'Keep going, team', '${ALICE}/message.jpg'
    )
  `);
  await db.exec(`
    insert into public.group_social_comments (
      id, group_id, target_type, target_id, user_id, content
    ) values (
      '${ALICE_COMMENT}', '${GROUP}', 'recap_feed', 'fixture', '${ALICE}',
      'A reportable comment fixture'
    )
  `);

  await asUser(BOB);
  assert.equal(
    Number((await first(`select count(*)::integer as count from public.messages`)).count),
    2,
    "active group members should see safe messages before a block",
  );
  for (const table of ["metric_entries", "photo_updates", "media_assets"]) {
    assert.equal(
      Number(
        (
          await first(
            `select count(*)::integer as count from public.${table}`,
          )
        ).count,
      ),
      2,
      `active group members should see shared ${table} before a block`,
    );
  }
  for (const objectPath of [
    `${ALICE}/photo.jpg`,
    `${ALICE}/entry.jpg`,
    `${ALICE}/message.jpg`,
    `${ALICE}/avatar.jpg`,
  ]) {
    assert.equal(
      (
        await first(
          `select public.can_read_media_object('${objectPath}') as allowed`,
        )
      ).allowed,
      true,
      `shared media should be readable before a block: ${objectPath}`,
    );
  }
  assert.equal(
    (
      await first(
        `select public.can_read_challenge_media_object('${ALICE}/challenge.jpg') as allowed`,
      )
    ).allowed,
    true,
    "shared challenge media should be readable before a block",
  );
  await db.exec(`select public.habhub_block_user('${GROUP}', '${ALICE}')`);
  assert.equal(
    Number((await first(`select count(*)::integer as count from public.messages`)).count),
    1,
    "a block must hide the blocked member's remote group messages",
  );
  assert.equal(
    (await first(`select public.habhub_can_direct_message('${GROUP}', '${ALICE}') as allowed`)).allowed,
    false,
  );
  assert.equal(
    Number(
      (
        await first(`
          select count(*)::integer as count
          from public.group_social_comments
          where user_id = '${ALICE}'
        `)
      ).count,
    ),
    0,
    "a block must hide the blocked member's feed comments",
  );
  for (const table of ["metric_entries", "photo_updates", "media_assets"]) {
    assert.equal(
      Number(
        (
          await first(
            `select count(*)::integer as count from public.${table}`,
          )
        ).count,
      ),
      1,
      `a block must stop ${table} from reaching the blocker's main feed cache`,
    );
  }
  for (const objectPath of [
    `${ALICE}/photo.jpg`,
    `${ALICE}/entry.jpg`,
    `${ALICE}/message.jpg`,
    `${ALICE}/avatar.jpg`,
  ]) {
    assert.equal(
      (
        await first(
          `select public.can_read_media_object('${objectPath}') as allowed`,
        )
      ).allowed,
      false,
      `a cached shared-media path must not bypass a block: ${objectPath}`,
    );
  }
  assert.equal(
    (
      await first(
        `select public.can_read_challenge_media_object('${ALICE}/challenge.jpg') as allowed`,
      )
    ).allowed,
    false,
    "a cached challenge-media path must not bypass a block",
  );
  await assert.rejects(
    () =>
      db.exec(`
        insert into public.messages (
          group_id, sender_id, client_generated_id, recipient_id, content
        ) values ('${GROUP}', '${BOB}', 'bob-dm', '${ALICE}', 'Private hello')
      `),
    /row-level security/i,
  );

  const report = await first(`
    select public.habhub_report_message(
      '${GROUP}', 'alice-message', '${ALICE}', 'harassment', 'Unwelcome message'
    )::text as id
  `);
  assert.match(report.id, /^[0-9a-f-]{36}$/i);
  const commentReport = await first(`
    select public.habhub_report_comment(
      '${GROUP}', '${ALICE_COMMENT}', '${ALICE}', 'harassment', 'Unwelcome comment'
    )::text as id
  `);
  assert.match(commentReport.id, /^[0-9a-f-]{36}$/i);
  const safetyState = await first(`select public.habhub_get_user_safety_state() as state`);
  assert.equal(safetyState.state.blocks.length, 1);
  assert.equal(safetyState.state.reports.length, 2);
  await assert.rejects(
    () => db.query(`select * from public.user_safety_reports`),
    /permission denied/i,
    "durable report evidence must not be directly queryable by clients",
  );
  await assert.rejects(
    () =>
      db.query(`
        select public.habhub_report_user(
          '${GROUP}', '${ALICE}', 'other', repeat('x', 501)
        )
      `),
    /too long/i,
  );
  const adminReport = await first(`
    select public.habhub_report_user(
      '${GROUP}', '${ADMIN}', 'other', 'Concern about the group admin'
    )::text as id
  `);
  assert.match(adminReport.id, /^[0-9a-f-]{36}$/i);
  const reportRouting = await first(`
    select public.habhub_get_user_safety_state() as state
  `);
  assert.equal(reportRouting.state.reports.length, 3);
  assert.equal(
    reportRouting.state.reports.find((row) => row.reportedUserId === ADMIN)
      ?.operatorReviewRequired,
    true,
    "a report against the sole group admin must require independent operator review",
  );
  assert.equal(
    reportRouting.state.reports
      .filter((row) => row.reportedUserId === ALICE)
      .every((row) => row.operatorReviewRequired === false),
    true,
    "ordinary-member reports may also be handled by the independent admin",
  );
  assert.equal(
    reportRouting.state.reports.every(
      (row) => row.operatorReviewState === "queued",
    ),
    true,
    "every report must enter the operator queue, not only admin reports",
  );

  await asUser(ALICE);
  assert.equal(
    Number((await first(`select count(*)::integer as count from public.messages`)).count),
    2,
    "group blocking is asymmetric: the blocked member keeps ordinary group visibility",
  );
  for (const table of ["metric_entries", "photo_updates", "media_assets"]) {
    assert.equal(
      Number(
        (
          await first(
            `select count(*)::integer as count from public.${table}`,
          )
        ).count,
      ),
      2,
      `the blocked member keeps ordinary group visibility for ${table}`,
    );
  }
  assert.equal(
    (await first(`select public.habhub_can_direct_message('${GROUP}', '${BOB}') as allowed`)).allowed,
    false,
    "direct messaging must stop in both directions",
  );

  await asUser(ADMIN);
  const adminFiledReport = await first(`
    select public.habhub_report_user(
      '${GROUP}', '${ALICE}', 'spam', 'Admin-filed conflict fixture'
    )::text as id
  `);
  assert.match(adminFiledReport.id, /^[0-9a-f-]{36}$/i);
  const queue = await db.query(
    `select * from public.habhub_list_group_safety_reports('${GROUP}')`,
  );
  assert.equal(queue.rows.length, 2);
  assert.equal(
    queue.rows.every((row) => row.reported_user_id === ALICE),
    true,
    "a moderator must not receive a report about their own account",
  );
  assert.equal(
    queue.rows.find((row) => row.id === report.id)?.message_available,
    true,
  );
  assert.equal(
    queue.rows.find((row) => row.id === commentReport.id)?.comment_available,
    true,
  );
  await assert.rejects(
    () =>
      db.exec(`
        select public.habhub_moderate_group_safety_report(
          '${adminReport.id}', 'dismissed', ''
        )
      `),
    /independent service-operator review/i,
  );
  await assert.rejects(
    () =>
      db.exec(`
        select public.habhub_moderate_group_safety_report(
          '${adminFiledReport.id}', 'dismissed', ''
        )
      `),
    /reports you filed require independent/i,
    "a group admin must not decide a report they filed",
  );
  await assert.rejects(
    () =>
      db.query(`
        select *
        from public.habhub_list_operator_safety_reports(
          'queued', null, null, 100
        )
      `),
    /permission denied/i,
    "a group admin must not be able to enumerate the independent queue",
  );
  await assert.rejects(
    () =>
      db.query(`
        select public.habhub_moderate_operator_safety_report(
          '${adminReport.id}', 'dismissed', 'forged-client-reference', ''
        )
      `),
    /permission denied/i,
    "a group admin must not gain service-operator decision powers",
  );
  await db.exec(`
    select public.habhub_moderate_group_safety_report(
      '${report.id}', 'remove_message', 'Reviewed by group admin'
    )
  `);
  await db.exec(`
    select public.habhub_moderate_group_safety_report(
      '${commentReport.id}', 'remove_comment', 'Reviewed by group admin'
    )
  `);
  const emptyQueue = await db.query(
    `select * from public.habhub_list_group_safety_reports('${GROUP}')`,
  );
  assert.equal(emptyQueue.rows.length, 0);

  await asService();
  const operatorQueue = await db.query(`
    select *
    from public.habhub_list_operator_safety_reports(
      'queued', null, null, 100
    )
  `);
  assert.equal(
    operatorQueue.rows.length,
    4,
    "group actions must not make any report disappear before operator follow-up",
  );
  assert.equal(
    operatorQueue.rows.find((row) => row.id === adminReport.id)
      ?.operator_review_required,
    true,
  );
  assert.equal(
    operatorQueue.rows.find((row) => row.id === adminFiledReport.id)
      ?.operator_review_required,
    true,
    "a sole admin's own report must also require independent operator review",
  );
  const priorityQueue = await db.query(`
    select *
    from public.habhub_list_operator_safety_reports(
      'priority', null, null, 100
    )
  `);
  assert.deepEqual(
    new Set(priorityQueue.rows.map((row) => row.id)),
    new Set([adminReport.id, adminFiledReport.id]),
    "the operator can fetch conflict reports without ordinary reports burying them",
  );
  assert.equal(
    operatorQueue.rows.find((row) => row.id === report.id)?.status,
    "actioned",
    "operator tooling must see the completed group action",
  );
  const queueHealth = await first(`
    select public.habhub_operator_safety_queue_health() as health
  `);
  assert.deepEqual(queueHealth.health, {
    queuedCount: 4,
    priorityCount: 2,
    oldestQueuedAt: queueHealth.health.oldestQueuedAt,
  });
  assert.match(queueHealth.health.oldestQueuedAt, /^\d{4}-\d{2}-\d{2}T/);
  await assert.rejects(
    () =>
      db.query(`
        select *
        from public.habhub_list_operator_safety_reports(
          'queued', null, null, 101
        )
      `),
    /page size/i,
    "the service queue must remain bounded",
  );
  await assert.rejects(
    () =>
      db.query(`
        select public.habhub_moderate_operator_safety_report(
          '${adminReport.id}', 'remove_message', 'test-invalid-action', ''
        )
      `),
    /reported message is unavailable/i,
    "operator actions must match the report evidence type",
  );
  await assert.rejects(
    () =>
      db.query(`
        select public.habhub_moderate_operator_safety_report(
          '${report.id}', 'reviewed', 'test-invalid-confirmation', ''
        )
      `),
    /confirm_group_action/i,
    "a completed group action must be confirmed without rewriting its audit",
  );
  const adminDecision = await first(`
    select public.habhub_moderate_operator_safety_report(
      '${adminReport.id}', 'reviewed', 'test-case-admin-report',
      'Independent fixture review'
    ) as result
  `);
  assert.deepEqual(adminDecision.result, {
    id: adminReport.id,
    status: "reviewed",
    operatorReviewState: "resolved",
    alreadyHandled: false,
  });
  const repeatedDecision = await first(`
    select public.habhub_moderate_operator_safety_report(
      '${adminReport.id}', 'dismissed', 'test-case-admin-report-retry', ''
    ) as result
  `);
  assert.deepEqual(repeatedDecision.result, {
    id: adminReport.id,
    status: "reviewed",
    operatorReviewState: "resolved",
    alreadyHandled: true,
  });
  const adminFiledDecision = await first(`
    select public.habhub_moderate_operator_safety_report(
      '${adminFiledReport.id}', 'reviewed', 'test-case-admin-filed',
      'Independent review of reporter conflict'
    ) as result
  `);
  assert.equal(adminFiledDecision.result.operatorReviewState, "resolved");
  for (const reportId of [report.id, commentReport.id]) {
    const decision = await first(`
      select public.habhub_moderate_operator_safety_report(
        '${reportId}', 'confirm_group_action', 'test-case-group-action', ''
      ) as result
    `);
    assert.equal(decision.result.operatorReviewState, "resolved");
  }
  const settledOperatorQueue = await db.query(`
    select *
    from public.habhub_list_operator_safety_reports(
      'queued', null, null, 100
    )
  `);
  assert.equal(settledOperatorQueue.rows.length, 0);
  const settledQueueHealth = await first(`
    select public.habhub_operator_safety_queue_health() as health
  `);
  assert.deepEqual(settledQueueHealth.health, {
    queuedCount: 0,
    priorityCount: 0,
    oldestQueuedAt: null,
  });
  const completeOperatorAudit = await db.query(`
    select *
    from public.habhub_list_operator_safety_reports(
      'all', null, null, 100
    )
  `);
  assert.equal(completeOperatorAudit.rows.length, 4);
  assert.equal(
    completeOperatorAudit.rows.every(
      (row) =>
        row.operator_review_state === "resolved" &&
        typeof row.operator_reference === "string" &&
        row.operator_reference.startsWith("test-case-"),
    ),
    true,
    "the service audit must retain a non-secret decision reference",
  );

  await db.exec(`reset role;`);
  const moderated = await first(`
    select
      (select status from public.user_safety_reports where id = '${report.id}') as status,
      (select count(*)::integer from public.messages where id = '${ALICE_MESSAGE}') as messages,
      (select count(*)::integer from public.group_social_comments where id = '${ALICE_COMMENT}') as comments
  `);
  assert.deepEqual(moderated, { status: "actioned", messages: 0, comments: 0 });

  console.log("User safety PostgreSQL validation passed.");
} finally {
  await db.close();
}
