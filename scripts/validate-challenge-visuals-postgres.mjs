import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const root = new URL("../", import.meta.url);
const migration = await Deno.readTextFile(
  new URL(
    "supabase/migrations/202608280002_shared_challenge_visuals.sql",
    root,
  ),
);

const CREATOR = "00000000-0000-4000-8000-000000000001";
const FRIEND = "00000000-0000-4000-8000-000000000002";
const OUTSIDER = "00000000-0000-4000-8000-000000000003";
const GROUP = "00000000-0000-4000-8000-000000000010";
const IMAGE = `${CREATOR}/account/challenge/1234-art.jpg`;

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create schema storage;

  create table auth.users (id uuid primary key);
  create table public.google_health_account_deletion_guards (
    user_id uuid primary key
  );
  create table public.group_members (
    group_id uuid not null,
    user_id uuid not null,
    status text not null,
    primary key (group_id, user_id)
  );
  create table public.group_challenges (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null,
    creator_id uuid not null,
    metric_slug text not null,
    title text,
    audience text not null default 'group',
    participant_limit integer,
    target_value numeric,
    local_date date not null,
    end_date date not null,
    participant_ids uuid[] not null default array[]::uuid[],
    accepted_participant_ids uuid[] not null default array[]::uuid[],
    declined_participant_ids uuid[] not null default array[]::uuid[],
    recurrence jsonb,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table storage.objects (
    bucket_id text not null,
    name text not null,
    primary key (bucket_id, name)
  );
  alter table storage.objects enable row level security;

  create or replace function auth.uid()
  returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create or replace function storage.foldername(object_path text)
  returns text[] language sql immutable as $$
    select string_to_array(object_path, '/')
  $$;
  create or replace function public.is_group_member(p_group_id uuid)
  returns boolean language sql stable as $$
    select exists (
      select 1 from public.group_members member
       where member.group_id = p_group_id
         and member.user_id = auth.uid()
         and member.status = 'active'
    )
  $$;
  create or replace function public.can_read_media_object(object_path text)
  returns boolean language sql stable as $$
    select (storage.foldername(object_path))[1] = auth.uid()::text
  $$;

  create or replace function public.save_group_challenge(
    p_challenge_id uuid,
    p_group_id uuid,
    p_metric_slug text,
    p_title text,
    p_target_value numeric,
    p_local_date date,
    p_end_date date,
    p_participant_ids uuid[],
    p_recurrence jsonb
  ) returns public.group_challenges
  language plpgsql security definer set search_path = '' as $$
  declare v_saved public.group_challenges;
  begin
    if p_challenge_id is null then
      insert into public.group_challenges (
        group_id, creator_id, metric_slug, title, target_value,
        local_date, end_date, participant_ids, accepted_participant_ids,
        recurrence
      ) values (
        p_group_id, auth.uid(), p_metric_slug, p_title, p_target_value,
        p_local_date, p_end_date,
        array_append(coalesce(p_participant_ids, array[]::uuid[]), auth.uid()),
        array[auth.uid()], p_recurrence
      ) returning * into v_saved;
    else
      update public.group_challenges
         set title = p_title,
             target_value = p_target_value,
             updated_at = now()
       where id = p_challenge_id
       returning * into v_saved;
    end if;
    return v_saved;
  end;
  $$;

  create or replace function public.save_public_challenge(
    p_challenge_id uuid,
    p_group_id uuid,
    p_metric_slug text,
    p_title text,
    p_target_value numeric,
    p_local_date date,
    p_end_date date,
    p_participant_ids uuid[],
    p_recurrence jsonb,
    p_participant_limit integer
  ) returns public.group_challenges
  language plpgsql security definer set search_path = '' as $$
  declare v_saved public.group_challenges;
  begin
    v_saved := public.save_group_challenge(
      p_challenge_id, p_group_id, p_metric_slug, p_title, p_target_value,
      p_local_date, p_end_date, p_participant_ids, p_recurrence
    );
    update public.group_challenges
       set audience = 'public', participant_limit = p_participant_limit
     where id = v_saved.id
     returning * into v_saved;
    return v_saved;
  end;
  $$;

  insert into auth.users (id) values
    ('${CREATOR}'), ('${FRIEND}'), ('${OUTSIDER}');
  insert into public.group_members (group_id, user_id, status) values
    ('${GROUP}', '${CREATOR}', 'active'),
    ('${GROUP}', '${FRIEND}', 'active');
  insert into storage.objects (bucket_id, name)
  values ('paceboard-media', '${IMAGE}');
  set request.jwt.claim.sub = '${CREATOR}';
`);

await db.exec(migration);

const saved = await db.query(`
  select (saved.row).id,
         (saved.row).visual_icon,
         (saved.row).visual_image_path
    from (
      select public.save_group_challenge(
        null::uuid, '${GROUP}'::uuid, 'steps', 'Morning walk', 10000,
        current_date, current_date, array['${FRIEND}'::uuid], null::jsonb,
        'walk-outline', '${IMAGE}'
      ) as row
    ) saved
`);
const challengeId = String(saved.rows[0]?.id ?? "");
if (!challengeId) throw new Error("The visual save overload did not create a row.");
if (saved.rows[0]?.visual_icon !== "walk-outline")
  throw new Error("The selected challenge icon did not persist.");
if (saved.rows[0]?.visual_image_path !== IMAGE)
  throw new Error("The private challenge image path did not persist.");

const oldClient = await db.query(`
  select (public.save_group_challenge(
    null::uuid, '${GROUP}'::uuid, 'steps', 'Old client', 5000,
    current_date, current_date, array['${FRIEND}'::uuid], null::jsonb
  )).visual_image_path as visual_image_path
`);
if (oldClient.rows[0]?.visual_image_path !== null)
  throw new Error("The established save signature lost its null visual default.");

const visible = await db.query(`
  select * from public.list_challenge_visuals(array['${challengeId}'::uuid])
`);
if (visible.rows.length !== 1)
  throw new Error("An authorized group member could not discover challenge art.");

await db.exec(`set request.jwt.claim.sub = '${OUTSIDER}';`);
const hidden = await db.query(`
  select * from public.list_challenge_visuals(array['${challengeId}'::uuid])
`);
if (hidden.rows.length !== 0)
  throw new Error("Challenge art leaked to an unauthorized account.");

await db.exec(`set request.jwt.claim.sub = '${CREATOR}';`);
const readable = await db.query(`
  select public.can_read_challenge_media_object('${IMAGE}') as allowed
`);
if (readable.rows[0]?.allowed !== true)
  throw new Error("The creator could not sign the saved challenge image.");
await db.exec(`
  insert into public.google_health_account_deletion_guards (user_id)
  values ('${CREATOR}')
`);
const guarded = await db.query(`
  select public.can_read_challenge_media_object('${IMAGE}') as allowed
`);
if (guarded.rows[0]?.allowed !== false)
  throw new Error("Account deletion did not fail closed for challenge media.");

console.log(
  "Challenge visual PostgreSQL validation passed: compatible RPCs, private path binding, bounded discovery, and fail-closed media reads.",
);
