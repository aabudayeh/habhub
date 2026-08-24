import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const db = new PGlite();

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  const row = result.rows[0];
  return row ? Object.values(row)[0] : undefined;
}

const userId = "00000000-0000-4000-8000-000000000001";
const pendingUserId = "00000000-0000-4000-8000-000000000002";
const groupId = "00000000-0000-4000-8000-000000000101";
const metricId = "00000000-0000-4000-8000-000000001001";
const day = "2026-08-24";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.test_context (
      singleton boolean primary key default true,
      user_id uuid
    );
    insert into auth.test_context (singleton, user_id)
      values (true, '${userId}');
    create function auth.uid() returns uuid language sql stable as
      'select user_id from auth.test_context where singleton';

    create type public.entry_visibility as enum ('private', 'status', 'group');
    create table public.user_snapshots (
      user_id uuid primary key,
      revision bigint not null
    );
    create table public.group_members (
      group_id uuid not null,
      user_id uuid not null,
      status text not null,
      last_data_synced_at timestamptz,
      primary key (group_id, user_id)
    );
    create table public.metric_definitions (
      id uuid primary key,
      group_id uuid,
      archived_at timestamptz
    );
    create table public.metric_entries (
      id bigint generated always as identity primary key,
      client_generated_id text not null,
      metric_id uuid not null,
      user_id uuid not null,
      value jsonb not null,
      local_date date not null,
      recorded_at timestamptz not null,
      visibility public.entry_visibility not null,
      source text not null,
      note text,
      account_revision bigint,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, client_generated_id)
    );
    create table public.daily_metric_status (
      group_id uuid not null,
      metric_id uuid not null,
      user_id uuid not null,
      local_date date not null,
      goal_reached boolean not null,
      score_contribution numeric not null default 0,
      visibility text,
      exact_value numeric,
      account_revision bigint,
      updated_at timestamptz not null default now(),
      primary key (group_id, metric_id, user_id, local_date)
    );
    create table public.metric_entry_tombstones (
      group_id uuid not null,
      user_id uuid not null,
      client_generated_id text not null,
      local_date date not null,
      visibility public.entry_visibility not null,
      deleted_at timestamptz not null default now(),
      primary key (user_id, client_generated_id)
    );
    create table public.metric_privacy_cache_fences (
      group_id uuid not null,
      metric_id uuid not null,
      user_id uuid not null,
      revision bigint not null,
      primary key (group_id, metric_id, user_id)
    );
    create table public.group_activity_versions (
      group_id uuid primary key,
      version bigint not null,
      since_date date not null,
      updated_at timestamptz not null
    );

    create function public.assert_account_snapshot_revision(
      p_user_id uuid,
      p_expected_revision bigint
    ) returns void language plpgsql security definer set search_path = '' as $$
    declare
      v_revision bigint;
    begin
      if (select auth.uid()) is distinct from p_user_id then
        raise exception 'account_revision_forbidden' using errcode = '42501';
      end if;
      select revision into v_revision
        from public.user_snapshots
       where user_id = p_user_id
       for update;
      if v_revision is distinct from p_expected_revision then
        raise exception 'stale_group_publish' using errcode = '40001';
      end if;
    end;
    $$;

    create function public.touch_group_member_data_freshness(p_group_id uuid)
    returns timestamptz language plpgsql security definer set search_path = '' as $$
    declare
      v_now timestamptz := clock_timestamp();
    begin
      update public.group_members
         set last_data_synced_at = case
           when last_data_synced_at is null
             or last_data_synced_at < v_now - interval '1 minute'
           then v_now else last_data_synced_at end
       where group_id = p_group_id
         and user_id = (select auth.uid())
         and status = 'active';
      if not found then
        raise exception 'group_membership_required' using errcode = '42501';
      end if;
      return (
        select last_data_synced_at from public.group_members
         where group_id = p_group_id and user_id = (select auth.uid())
      );
    end;
    $$;

    create function public.commit_group_activity_version(
      p_group_id uuid,
      p_since_date date default (current_date - 120)
    ) returns bigint language plpgsql security definer set search_path = '' as $$
    declare
      v_version bigint;
      v_now timestamptz := clock_timestamp();
    begin
      if not exists (
        select 1 from public.group_members
         where group_id = p_group_id
           and user_id = (select auth.uid())
           and status = 'active'
      ) then
        raise exception 'Not authorized for this group' using errcode = '42501';
      end if;
      insert into public.group_activity_versions as checkpoint (
        group_id, version, since_date, updated_at
      ) values (p_group_id, 1, p_since_date, v_now)
      on conflict (group_id) do update
        set version = checkpoint.version + 1,
            since_date = excluded.since_date,
            updated_at = excluded.updated_at
      returning version into v_version;
      update public.group_members set last_data_synced_at = v_now
       where group_id = p_group_id and user_id = (select auth.uid());
      return v_version;
    end;
    $$;

    create function public.touch_updated_at() returns trigger
    language plpgsql set search_path = '' as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$;
    create trigger entries_touch_updated_at
      before update on public.metric_entries
      for each row execute function public.touch_updated_at();

    create function public.enforce_group_projection_revision() returns trigger
    language plpgsql security definer set search_path = '' as $$
    begin
      if (select auth.uid()) is null then return new; end if;
      if new.user_id <> (select auth.uid()) then
        raise exception 'account_revision_forbidden' using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and new.account_revision < old.account_revision then
        raise exception 'stale_group_publish' using errcode = '40001';
      end if;
      perform public.assert_account_snapshot_revision(
        new.user_id, new.account_revision
      );
      return new;
    end;
    $$;
    create trigger metric_entries_enforce_account_revision
      before insert or update on public.metric_entries
      for each row execute function public.enforce_group_projection_revision();

    create function public.touch_daily_metric_status_updated_at() returns trigger
    language plpgsql set search_path = '' as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$;
    create trigger daily_metric_status_touch_updated_at
      before update on public.daily_metric_status
      for each row execute function public.touch_daily_metric_status_updated_at();

    create function public.enforce_daily_metric_status_revision_row()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      if (select auth.uid()) is null then return new; end if;
      if new.user_id <> (select auth.uid()) then
        raise exception 'account_revision_forbidden' using errcode = '42501';
      end if;
      if new.account_revision is null then
        raise exception 'account_revision_required' using errcode = '40001';
      end if;
      if tg_op = 'UPDATE' and new.account_revision < old.account_revision then
        raise exception 'stale_group_publish' using errcode = '40001';
      end if;
      return new;
    end;
    $$;
    create trigger daily_metric_status_enforce_account_revision
      before insert or update on public.daily_metric_status
      for each row execute function public.enforce_daily_metric_status_revision_row();

    create function public.assert_daily_metric_status_insert_revisions()
    returns trigger language plpgsql security definer set search_path = '' as $$
    declare v_revision record;
    begin
      if (select auth.uid()) is null then return null; end if;
      for v_revision in
        select distinct user_id, account_revision from inserted_status_rows
      loop
        perform public.assert_account_snapshot_revision(
          v_revision.user_id, v_revision.account_revision
        );
      end loop;
      return null;
    end;
    $$;
    create trigger daily_metric_status_enforce_insert_revision_statement
      after insert on public.daily_metric_status
      referencing new table as inserted_status_rows
      for each statement execute function public.assert_daily_metric_status_insert_revisions();

    create function public.assert_daily_metric_status_update_revisions()
    returns trigger language plpgsql security definer set search_path = '' as $$
    declare v_revision record;
    begin
      if (select auth.uid()) is null then return null; end if;
      for v_revision in
        select distinct user_id, account_revision from updated_status_rows
      loop
        perform public.assert_account_snapshot_revision(
          v_revision.user_id, v_revision.account_revision
        );
      end loop;
      return null;
    end;
    $$;
    create trigger daily_metric_status_enforce_update_revision_statement
      after update on public.daily_metric_status
      referencing new table as updated_status_rows
      for each statement execute function public.assert_daily_metric_status_update_revisions();
  `);

  await db.exec(await Deno.readTextFile(
    "supabase/migrations/202608240009_legacy_workspace_publish_containment.sql",
  ));

  await db.exec(`
    insert into public.user_snapshots (user_id, revision)
      values ('${userId}', 5), ('${pendingUserId}', 5);
    insert into public.group_members (group_id, user_id, status)
      values
        ('${groupId}', '${userId}', 'active'),
        ('${groupId}', '${pendingUserId}', 'pending');
    insert into public.metric_definitions (id, group_id)
      values ('${metricId}', '${groupId}');
    insert into public.group_activity_versions (
      group_id, version, since_date, updated_at
    ) values ('${groupId}', 10, '${day}', '2026-08-24T00:00:00Z');
  `);

  await db.exec(`
    insert into public.daily_metric_status (
      group_id, metric_id, user_id, local_date, goal_reached,
      score_contribution, visibility, exact_value, account_revision
    ) values (
      '${groupId}', '${metricId}', '${userId}', '${day}', false,
      20, 'group', 20, 5
    );
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 5],
    )),
    11,
    "a material insert must advance the compact activity version",
  );

  const firstUpdatedAt = await scalar(`
    select updated_at from public.daily_metric_status
     where group_id = '${groupId}' and metric_id = '${metricId}'
       and user_id = '${userId}' and local_date = '${day}'
  `);
  await db.exec(`
    insert into public.daily_metric_status (
      group_id, metric_id, user_id, local_date, goal_reached,
      score_contribution, visibility, exact_value, account_revision
    ) values (
      '${groupId}', '${metricId}', '${userId}', '${day}', false,
      20, 'group', 20, 5
    ) on conflict (group_id, metric_id, user_id, local_date) do update
      set goal_reached = excluded.goal_reached,
          score_contribution = excluded.score_contribution,
          visibility = excluded.visibility,
          exact_value = excluded.exact_value,
          account_revision = excluded.account_revision;
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 5],
    )),
    11,
    "an exact legacy retry must return the existing version",
  );
  assert.equal(
    String(await scalar(`
      select updated_at from public.daily_metric_status
       where group_id = '${groupId}' and metric_id = '${metricId}'
         and user_id = '${userId}' and local_date = '${day}'
    `)),
    String(firstUpdatedAt),
    "an exact legacy retry must not rewrite the status tuple",
  );

  await db.exec(`
    update public.user_snapshots set revision = 6 where user_id = '${userId}';
    insert into public.daily_metric_status (
      group_id, metric_id, user_id, local_date, goal_reached,
      score_contribution, visibility, exact_value, account_revision
    ) values (
      '${groupId}', '${metricId}', '${userId}', '${day}', false,
      20, 'group', 20, 6
    ) on conflict (group_id, metric_id, user_id, local_date) do update
      set goal_reached = excluded.goal_reached,
          score_contribution = excluded.score_contribution,
          visibility = excluded.visibility,
          exact_value = excluded.exact_value,
          account_revision = excluded.account_revision;
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 6],
    )),
    11,
    "a newer private snapshot revision alone must not wake the group",
  );
  assert.equal(
    Number(await scalar(`
      select account_revision from public.daily_metric_status
       where group_id = '${groupId}' and metric_id = '${metricId}'
         and user_id = '${userId}' and local_date = '${day}'
    `)),
    5,
    "suppressed no-op projections retain their last material revision",
  );

  await db.exec(`
    insert into public.metric_privacy_cache_fences (
      group_id, metric_id, user_id, revision
    ) values ('${groupId}', '${metricId}', '${userId}', 6);
    update public.user_snapshots set revision = 7 where user_id = '${userId}';
    update public.daily_metric_status
       set account_revision = 7
     where group_id = '${groupId}' and metric_id = '${metricId}'
       and user_id = '${userId}' and local_date = '${day}';
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 7],
    )),
    12,
    "a revision-only exact re-share across a privacy fence must remain material",
  );
  assert.equal(
    Number(await scalar(`
      select account_revision from public.daily_metric_status
       where group_id = '${groupId}' and metric_id = '${metricId}'
         and user_id = '${userId}' and local_date = '${day}'
    `)),
    7,
  );

  await db.exec(`
    update public.daily_metric_status
       set score_contribution = 40, exact_value = 40
     where group_id = '${groupId}' and metric_id = '${metricId}'
       and user_id = '${userId}' and local_date = '${day}';
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 7],
    )),
    13,
  );
  await db.exec(`
    update public.daily_metric_status
       set score_contribution = 60, exact_value = 60
     where group_id = '${groupId}' and metric_id = '${metricId}'
       and user_id = '${userId}' and local_date = '${day}';
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 7],
    )),
    14,
    "two legitimate rapid edits at one revision must each advance",
  );

  await db.exec(`
    insert into public.metric_entries (
      client_generated_id, metric_id, user_id, value, local_date,
      recorded_at, visibility, source, note, account_revision
    ) values (
      'entry-1', '${metricId}', '${userId}', '10'::jsonb, '2026-08-20',
      '2026-08-20T12:00:00Z', 'group', 'manual', 'first', 7
    );
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 7],
    )),
    15,
  );
  assert.equal(
    String(await scalar(`
      select to_char(since_date, 'YYYY-MM-DD') from public.group_activity_versions
       where group_id = '${groupId}'
    `)),
    "2026-08-20",
    "the marker's earliest date must widen a legacy caller's recent window",
  );

  await db.exec(`
    update public.user_snapshots set revision = 8 where user_id = '${userId}';
    insert into public.metric_entries (
      client_generated_id, metric_id, user_id, value, local_date,
      recorded_at, visibility, source, note, account_revision
    ) values (
      'entry-1', '${metricId}', '${userId}', '10'::jsonb, '2026-08-20',
      '2026-08-20T12:00:00Z', 'group', 'manual', 'first', 8
    ) on conflict (user_id, client_generated_id) do update
      set metric_id = excluded.metric_id,
          value = excluded.value,
          local_date = excluded.local_date,
          recorded_at = excluded.recorded_at,
          visibility = excluded.visibility,
          source = excluded.source,
          note = excluded.note,
          account_revision = excluded.account_revision;
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 8],
    )),
    15,
    "a revision-only raw-entry retry must also be a no-op",
  );
  await db.exec(`
    update public.metric_entries set note = 'edited', account_revision = 8
     where user_id = '${userId}' and client_generated_id = 'entry-1';
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 8],
    )),
    16,
    "a detail-only entry edit must remain material",
  );

  await db.exec(`
    insert into public.metric_entry_tombstones (
      group_id, user_id, client_generated_id, local_date, visibility
    ) values ('${groupId}', '${userId}', 'entry-1', '2026-08-20', 'group');
    delete from public.metric_entries
     where user_id = '${userId}' and client_generated_id = 'entry-1';
  `);
  assert.equal(
    Number(await scalar(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 8],
    )),
    17,
    "entry deletion/tombstone changes must still publish once",
  );

  await db.exec(`
    update auth.test_context set user_id = '${pendingUserId}' where singleton;
  `);
  await assert.rejects(
    () => db.query(
      "select public.commit_group_activity_version($1, $2, $3)",
      [groupId, day, 5],
    ),
    /group_membership_required|Not authorized/,
    "a pending member must not use the no-op path",
  );
  await db.exec(`
    update auth.test_context set user_id = null where singleton;
    insert into public.daily_metric_status (
      group_id, metric_id, user_id, local_date, goal_reached,
      score_contribution, visibility, exact_value, account_revision
    ) values (
      '${groupId}', '${metricId}', '${userId}', '2026-08-23', false,
      1, 'group', 1, 8
    );
  `);
  assert.equal(
    Number(await scalar(`
      select count(*) from public.group_activity_publish_state
       where group_id = '${groupId}' and user_id = '${userId}'
         and change_sequence > committed_sequence
    `)),
    0,
    "service-owned projection writes must not leave a client dirty marker",
  );

  assert.equal(
    await scalar(
      "select has_table_privilege('authenticated', 'public.group_activity_publish_state', 'select')",
    ),
    false,
    "the marker ledger must remain inaccessible to authenticated clients",
  );

  console.log(
    "Legacy workspace publish PostgreSQL validation passed (no-op rows/commits, privacy re-share, rapid edits, earliest date, tombstones, membership, and private marker ACL).",
  );
} finally {
  await db.close();
}
