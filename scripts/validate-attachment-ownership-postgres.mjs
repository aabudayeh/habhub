/* global Deno */
import assert from "node:assert/strict";
// eslint-disable-next-line import/no-unresolved -- Pinned Deno npm specifier, resolved by the test runtime.
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const db = new PGlite();
const source = (name) => Deno.readTextFile(new URL("../supabase/migrations/" + name, import.meta.url));
async function loadFunction(file, name) {
  const text = await source(file);
  const start = text.indexOf("create or replace function public." + name + "(");
  const body = text.indexOf("as $$", start), end = text.indexOf("$$;", body + 5);
  assert(start >= 0 && body >= 0 && end >= 0, "Production function is available: " + name);
  await db.exec(text.slice(start, end + 3));
}
async function scalar(sql, values = []) {
  return Object.values((await db.query(sql, values)).rows[0] ?? {})[0];
}
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const owner = id(1), editor = id(2), viewer = id(3), outsider = id(4), privateRecipient = id(5);
const group = id(100), metric = id(101);
const own = (user, kind, name) => `${user}/account/${kind}/${name}.jpg`;
async function asUser(user) {
  await db.exec("reset role; set request.jwt.claim.sub = '" + (user ?? "") + "'; set role authenticated;");
}
async function rejected(sql, values = [], pattern = /attachment_namespace_ownership_required/) {
  await assert.rejects(db.query(sql, values), pattern);
}

try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    create table auth.users(id uuid primary key);
    create table profiles(id uuid primary key references auth.users(id) on delete cascade, avatar_path text);
    create table google_health_account_deletion_guards(user_id uuid primary key);
    create table user_blocks(blocker_id uuid, blocked_user_id uuid);
    create table group_members(group_id uuid,user_id uuid,status text default 'active',role text default 'member',primary key(group_id,user_id));
    create table metric_definitions(id uuid primary key,group_id uuid);
    create table metric_entries(id uuid primary key default gen_random_uuid(),user_id uuid,metric_id uuid,image_path text,visibility text default 'group');
    create table messages(id uuid primary key default gen_random_uuid(),group_id uuid,sender_id uuid,recipient_id uuid,image_path text);
    create table media_assets(id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,storage_path text not null unique,thumbnail_path text);
    create table photo_updates(id uuid primary key default gen_random_uuid(),owner_user_id uuid,media_asset_id uuid,group_id uuid,visibility text default 'group');
    create table group_challenges(id uuid primary key default gen_random_uuid(),group_id uuid,creator_id uuid references profiles(id) on delete cascade,audience text default 'group',participant_ids uuid[],deleted_at timestamptz,visual_image_path text,updated_at timestamptz default '2020-01-01');
    create function public.is_group_member(p_group uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.group_members where group_id=p_group and user_id=auth.uid() and status='active')
    $$;
    create function public.is_group_admin(p_group uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.group_members where group_id=p_group and user_id=auth.uid() and status='active' and role='admin')
    $$;
    create function public.shares_group_with(p_user uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.group_members a join public.group_members b using(group_id) where a.user_id=auth.uid() and b.user_id=p_user and a.status='active' and b.status='active')
    $$;
    grant usage on schema auth,storage,public to authenticated,anon;
    grant select,insert,update on all tables in schema public to authenticated;
    grant select on auth.users to authenticated;
    alter table metric_entries enable row level security;
    create policy entries_owner on metric_entries for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    alter table messages enable row level security;
    create policy messages_owner on messages for all to authenticated using(sender_id=auth.uid()) with check(sender_id=auth.uid());
    alter table profiles enable row level security;
    create policy profiles_owner on profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
    alter table media_assets enable row level security;
    create policy media_owner_all on media_assets for all to authenticated using(owner_user_id=auth.uid()) with check(owner_user_id=auth.uid());
    alter table group_challenges enable row level security;
    revoke insert,update on group_challenges from authenticated;
    create table test_challenge_events(value text);
    create function touch_challenge() returns trigger language plpgsql as $$ begin
      new.updated_at=now(); insert into public.test_challenge_events values('touch'); return new;
    end $$;
    create trigger challenge_touch before update on group_challenges for each row execute function touch_challenge();
    create trigger challenge_disabled before update on group_challenges for each row execute function touch_challenge();
    alter table group_challenges disable trigger challenge_disabled;
  `);
  for (const user of [owner, editor, viewer, outsider, privateRecipient]) {
    await db.query("insert into auth.users values($1);", [user]);
    await db.query("insert into profiles(id) values($1)", [user]);
    if (user !== outsider) await db.query("insert into group_members values($1,$2,'active',$3)", [group, user, user === editor ? "admin" : "member"]);
  }
  await db.query("insert into metric_definitions values($1,$2)", [metric, group]);
  const safety = "202609040002_user_safety.sql";
  for (const name of ["habhub_users_blocked_either_way", "habhub_message_visible_to_current_user", "can_read_media_object", "can_read_challenge_media_object"]) await loadFunction(safety, name);
  const m008 = await source("202609080008_photo_media_and_social_ownership.sql");
  await db.exec(m008.slice(0, m008.indexOf("-- Existing clients address photo engagement")));

  // Each forged reference uses an otherwise authorized row owned by the attacker.
  // Distinct paths ensure no other legitimate share can authorize the same image.
  const forged = {
    entry: own(owner, "entry", "private-entry"),
    message: own(owner, "message", "private-message"),
    avatar: own(owner, "avatar", "private-avatar"),
    asset: own(owner, "photo", "private-photo"),
    challenge: own(owner, "challenge", "private-challenge"),
  };
  await asUser(editor);
  await db.query("insert into metric_entries(user_id,metric_id,image_path) values($1,$2,$3)", [editor, metric, forged.entry]);
  await db.query("insert into messages(group_id,sender_id,image_path) values($1,$2,$3)", [group, editor, forged.message]);
  await db.query("update profiles set avatar_path=$1 where id=$2", [forged.avatar, editor]);
  const forgedAsset = await scalar("insert into media_assets(owner_user_id,storage_path) values($1,$2) returning id", [editor, forged.asset]);
  await db.query("insert into photo_updates(owner_user_id,media_asset_id,group_id) values($1,$2,$3)", [editor, forgedAsset, group]);
  await db.exec("reset role;");
  const legacyCreator = id(200), legacyAdmin = id(201), legacyForged = id(202);
  const creatorVisual = own(owner, "challenge", "creator-approved"), oldAdminVisual = own(editor, "challenge", "legacy-admin");
  for (const [challengeId, creator, path] of [[legacyCreator, owner, creatorVisual], [legacyAdmin, owner, oldAdminVisual], [legacyForged, editor, forged.challenge]]) {
    await db.query("insert into group_challenges(id,group_id,creator_id,participant_ids,visual_image_path) values($1,$2,$3,$4,$5)", [challengeId, group, creator, [owner, viewer], path]);
  }
  await asUser(viewer);
  for (const path of [forged.entry, forged.message, forged.avatar, forged.asset]) assert.equal(await scalar("select can_read_media_object($1)", [path]), true, "Pre009 reference-only authorization demonstrates the regression");
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [forged.challenge]), true);

  await db.exec("reset role; set request.jwt.claim.sub='';");
  await loadFunction("202609080004_reset_account_private_data.sql", "reset_account_private_data");
  await db.exec(await source("202609080009_attachment_namespace_ownership.sql"));
  await db.exec(await source("202609080010_challenge_visual_owner_index.sql"));
  const ownerIndex = await scalar("select indexdef from pg_indexes where schemaname='public' and indexname='group_challenges_visual_image_owner_idx'");
  assert.match(ownerIndex, /USING btree \(visual_image_owner_id\) WHERE \(visual_image_owner_id IS NOT NULL\)/);
  assert.equal(await scalar("select count(*) from test_challenge_events"), 0, "Backfill must not emit updates/notifications");
  assert.equal(await scalar("select count(*) from group_challenges where updated_at <> '2020-01-01'::timestamptz"), 0);
  assert.equal(await scalar("select tgenabled from pg_trigger where tgname='challenge_touch'"), "O");
  assert.equal(await scalar("select tgenabled from pg_trigger where tgname='challenge_disabled'"), "D");
  assert.equal(await scalar("select visual_image_owner_id from group_challenges where id=$1", [legacyCreator]), owner);
  for (const challengeId of [legacyAdmin, legacyForged]) assert.equal(await scalar("select visual_image_owner_id from group_challenges where id=$1", [challengeId]), null, "Unproven non-creator legacy image is not assigned an uploader");
  // Use realistic unrelated history and normal planner choices, not
  // enable_seqscan=off, to prove the owner cleanup predicate uses the index.
  await db.exec(`set request.jwt.claim.sub='${owner}';`);
  await db.query(`insert into group_challenges(group_id,creator_id,participant_ids,visual_image_path)
    select $1,$2,array[$2::uuid,$3::uuid],$2::text || '/account/challenge/index-fixture-' || item::text || '.jpg'
    from generate_series(1,2000) item`, [group, owner, viewer]);
  await db.exec(`set request.jwt.claim.sub='${editor}';`);
  await db.query("insert into group_challenges(group_id,creator_id,participant_ids,visual_image_path) values($1,$2,$3,$4)", [group, editor, [editor, viewer], own(editor, "challenge", "index-target")]);
  await db.exec("set request.jwt.claim.sub=''; analyze public.group_challenges;");
  const ownerPlan = await scalar("explain (format json) select id from public.group_challenges where visual_image_owner_id=$1", [editor]);
  const planText = JSON.stringify(ownerPlan);
  assert.match(planText, /group_challenges_visual_image_owner_idx/, "Selective owner cleanup lookup should use the partial index without planner overrides");
  assert.doesNotMatch(planText, /Seq Scan/, "Owner lookup must not scan 2,000 unrelated challenges");
  console.log("Challenge visual owner lookup uses the partial btree index across 2,000 unrelated challenge visuals.");
  assert.equal(await scalar("select visual_image_path from group_challenges where id=$1", [legacyAdmin]), oldAdminVisual, "Quarantine preserves the reference/file for owner recovery");
  await asUser(viewer);
  for (const path of [forged.entry, forged.message, forged.avatar, forged.asset]) assert.equal(await scalar("select can_read_media_object($1)", [path]), false, "Legacy forged references cannot authorize fresh signed URLs");
  for (const path of [forged.challenge, oldAdminVisual]) assert.equal(await scalar("select can_read_challenge_media_object($1)", [path]), false);
  assert.equal(await scalar("select count(*) from media_assets where id=$1", [forgedAsset]), 0, "Forged foreign path is not shared asset metadata either");
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [creatorVisual]), true, "Proven creator-owned legacy visual remains shared");

  await asUser(editor);
  for (const path of [forged.entry, "", owner + "-suffix/account/entry/f.jpg", editor + "/../" + owner + "/f.jpg", editor + "/account\\f.jpg"]) {
    await rejected("insert into metric_entries(user_id,metric_id,image_path) values($1,$2,$3)", [editor, metric, path]);
  }
  await rejected("insert into messages(group_id,sender_id,image_path) values($1,$2,$3)", [group, editor, forged.message]);
  await rejected("update profiles set avatar_path=$1 where id=$2", [forged.avatar, editor]);
  await rejected("insert into media_assets(owner_user_id,storage_path) values($1,$2)", [editor, own(owner, "photo", "another-private")]);
  await rejected("insert into media_assets(owner_user_id,storage_path,thumbnail_path) values($1,$2,$3)", [editor, own(editor, "photo", "own-with-bad-thumb"), own(owner, "photo", "foreign-thumb")]);
  await rejected("insert into media_assets(owner_user_id,storage_path) values($1,'')", [editor]);
  await db.query("update profiles set avatar_path=null where id=$1", [editor]);
  await db.query("insert into metric_entries(user_id,metric_id,image_path) values($1,$2,null)", [editor, metric]);
  await db.query("insert into messages(group_id,sender_id,image_path) values($1,$2,null)", [group, editor]);

  const entryPath = own(editor, "entry", "shared"), messagePath = own(editor, "message", "shared"), directPath = own(editor, "message", "private-dm"), avatarPath = own(editor, "avatar", "shared"), photoPath = own(editor, "photo", "shared");
  const entryId = await scalar("insert into metric_entries(user_id,metric_id,image_path) values($1,$2,$3) returning id", [editor, metric, entryPath]);
  await rejected("update metric_entries set image_path=$1 where id=$2", [forged.entry, entryId]);
  await db.query("insert into messages(group_id,sender_id,image_path) values($1,$2,$3)", [group, editor, messagePath]);
  await db.query("insert into messages(group_id,sender_id,recipient_id,image_path) values($1,$2,$3,$4)", [group, editor, privateRecipient, directPath]);
  await db.query("update profiles set avatar_path=$1 where id=$2", [avatarPath, editor]);
  const validAsset = await scalar("insert into media_assets(owner_user_id,storage_path,thumbnail_path) values($1,$2,$3) returning id", [editor, photoPath, own(editor, "photo", "thumb")]);
  await db.query("insert into photo_updates(owner_user_id,media_asset_id,group_id) values($1,$2,$3)", [editor, validAsset, group]);
  await asUser(viewer);
  for (const path of [entryPath, messagePath, avatarPath, photoPath]) assert.equal(await scalar("select can_read_media_object($1)", [path]), true, "Ordinary authorized sharing is preserved");
  assert.equal(await scalar("select can_read_media_object($1)", [directPath]), false, "Group membership alone does not reveal a private-message attachment");
  await asUser(privateRecipient);
  assert.equal(await scalar("select can_read_media_object($1)", [directPath]), true);
  await asUser(outsider);
  for (const path of [entryPath, messagePath, avatarPath, photoPath]) assert.equal(await scalar("select can_read_media_object($1)", [path]), false);

  // The production challenge RPC is the only write API. A small security-definer
  // fixture simulates its already-audited creator/admin authorization while the
  // actual new table trigger verifies attachment ownership and provenance.
  await db.exec(`reset role; create function test_set_visual(p_id uuid,p_path text,p_spoof uuid) returns void language plpgsql security definer as $$
    declare c group_challenges; begin
      select * into c from group_challenges where id=p_id;
      if c.creator_id <> auth.uid() and not is_group_admin(c.group_id) then raise exception 'editor_required'; end if;
      update group_challenges set visual_image_path=p_path,visual_image_owner_id=p_spoof where id=p_id;
    end $$; grant execute on function test_set_visual(uuid,text,uuid) to authenticated;`);
  await asUser(editor);
  const adminVisual = own(editor, "challenge", "new-explicit-upload");
  await db.query("select test_set_visual($1,$2,$3)", [legacyAdmin, adminVisual, owner]);
  await db.exec("reset role;");
  assert.equal(await scalar("select visual_image_owner_id from group_challenges where id=$1", [legacyAdmin]), editor, "Creator's administrator legitimately binds their own new upload, ignoring spoofed owner input");
  await asUser(owner);
  await db.query("select test_set_visual($1,$2,$3)", [legacyAdmin, adminVisual, owner]);
  await db.exec("reset role;");
  assert.equal(await scalar("select visual_image_owner_id from group_challenges where id=$1", [legacyAdmin]), editor, "Unchanged edits cannot clobber validated uploader provenance");
  await asUser(owner);
  await db.query("select test_set_visual($1,$2,null)", [legacyAdmin, adminVisual]);
  await db.exec("reset role;");
  assert.equal(await scalar("select visual_image_owner_id from group_challenges where id=$1", [legacyAdmin]), editor, "A client cannot imitate the deletion FK while the uploader still exists");
  await asUser(editor);
  await rejected("select test_set_visual($1,$2,$3)", [legacyAdmin, forged.challenge, owner], /challenge_visual_uploader_required/);
  await rejected("select test_set_visual($1,'',$2)", [legacyAdmin, editor], /challenge_visual_uploader_required/);
  await asUser(viewer);
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [adminVisual]), true);
  await db.exec("reset role;");
  await db.query("insert into user_blocks values($1,$2)", [viewer, editor]);
  await asUser(viewer);
  for (const path of [entryPath, messagePath, avatarPath, photoPath]) assert.equal(await scalar("select can_read_media_object($1)", [path]), false);
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [adminVisual]), false, "Blocking the actual visual uploader withdraws their image too");
  await db.exec("reset role; delete from user_blocks;");
  await db.query("update group_challenges set audience='public' where id=$1", [legacyAdmin]);
  await asUser(outsider);
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [adminVisual]), true, "Explicit public challenge remains visible to authenticated non-members");
  await asUser(editor);
  await rejected("select test_set_visual($1,$2,$3)", [legacyAdmin, own(editor, "challenge", "public-admin-disallowed"), editor], /challenge_visual_uploader_required/);
  await asUser(owner);
  await db.query("select test_set_visual($1,null,$2)", [legacyAdmin, editor]);
  await db.exec("reset role;");
  assert.equal(await scalar("select visual_image_owner_id from group_challenges where id=$1", [legacyAdmin]), null);
  // Execute the actual patched reset RPC with empty supporting account tables.
  // This proves cleanup happens before retainedMediaPaths is returned while the
  // uploader profile and all unrelated challenge artwork remain intact.
  await db.exec(`
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    alter table google_health_account_deletion_guards add column attempt_id uuid, add column lease_until timestamptz;
    create table user_snapshots(user_id uuid primary key,payload jsonb,revision bigint,device_id text,schema_version integer,updated_at timestamptz);
    alter table metric_entries add column source text default 'manual', add column source_provider text, add column client_generated_id text, add column local_date date default current_date;
    alter table metric_definitions add column owner_user_id uuid;
    alter table photo_updates add column client_generated_id text;
    create table metric_entry_tombstones(group_id uuid,user_id uuid,client_generated_id text,local_date date,visibility text,deleted_at timestamptz,unique(user_id,client_generated_id));
    create table group_social_reactions(target_type text,target_id text);
    create table group_social_comments(target_type text,target_id text);
    create table daily_metric_status(user_id uuid,visibility text,source_provider text);
    create table templates(creator_user_id uuid,visibility text);
    create table group_challenge_user_preferences(user_id uuid,hidden boolean,pinned boolean,updated_at timestamptz);
    create table push_token_dispatch_acceptances(user_id uuid,token text);
    create table device_push_tokens(user_id uuid,token text);
  `);
  for (const table of ["metric_goals", "tracked_goal_periods", "dashboard_layouts", "energy_profiles", "notification_preferences", "health_connections", "health_sync_cursors", "account_devices", "badge_showcases", "web_personal_notification_schedule", "web_push_subscriptions", "expo_push_receipts", "public_challenge_totals", "public_challenge_participant_syncs", "public_challenge_occurrence_syncs", "public_challenge_snapshot_daily_cache", "public_challenge_snapshot_cache_state", "public_challenge_projection_cursors"]) await db.exec(`create table public.${table}(user_id uuid)`);
  for (const table of ["member_aliases", "group_member_aliases"]) await db.exec(`create table public.${table}(owner_user_id uuid)`);
  for (const table of ["group_notification_events", "group_challenge_notification_state", "push_dispatch_events"]) await db.exec(`create table public.${table}(recipient_id uuid)`);
  const resetVisual = own(editor, "challenge", "account-reset");
  await asUser(editor);
  await db.query("select test_set_visual($1,$2,null)", [legacyCreator, resetVisual]);
  await asUser(owner);
  const retainedVisual = own(owner, "challenge", "other-owners-art");
  await db.query("select test_set_visual($1,$2,null)", [legacyAdmin, retainedVisual]);
  await db.exec("reset role; set request.jwt.claim.role='service_role';");
  const attempt = id(500), resetAt = "2026-09-08T12:00:00.000Z";
  await db.query("insert into google_health_account_deletion_guards(user_id,attempt_id) values($1,$2)", [editor, attempt]);
  const resetResult = await scalar("select reset_account_private_data($1,$2,$3,'fixture-device',27,$4)", [editor, attempt, { currentUserId: editor, version: 27, settings: { accountDataResetAt: resetAt } }, resetAt]);
  assert.equal(await scalar("select count(*) from profiles where id=$1", [editor]), 1, "Account reset preserves the uploader profile");
  assert.equal(await scalar("select count(*) from group_challenges where id=$1", [legacyCreator]), 1);
  assert.equal(await scalar("select visual_image_owner_id from group_challenges where id=$1", [legacyCreator]), null);
  assert.equal(await scalar("select visual_image_path from group_challenges where id=$1", [legacyCreator]), null);
  assert.ok(!resetResult.retainedMediaPaths.includes(resetVisual), "Cleared challenge visual cannot leak into the reset worker's retention list");
  assert.equal(await scalar("select visual_image_path from group_challenges where id=$1", [legacyAdmin]), retainedVisual, "Reset does not clear another uploader's artwork");
  await asUser(viewer);
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [resetVisual]), false);
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [retainedVisual]), true);
  await db.exec("reset role; delete from google_health_account_deletion_guards; set request.jwt.claim.role='authenticated';");
  await asUser(editor);
  const deletionVisual = own(editor, "challenge", "uploader-deletion");
  await db.query("select test_set_visual($1,$2,null)", [legacyCreator, deletionVisual]);
  await db.exec("reset role;");
  const deleteWorker = await Deno.readTextFile(new URL("../supabase/functions/delete-account/index.ts", import.meta.url));
  assert.match(deleteWorker, /admin\.auth\.admin\.deleteUser\(data\.user\.id\)/, "Account worker invokes auth deletion, which cascades through the production profile FK");
  assert.match(await source("202607160001_initial_paceboard.sql"), /id uuid primary key references auth\.users\(id\) on delete cascade/);
  await db.query("delete from auth.users where id=$1", [editor]);
  assert.equal(await scalar("select count(*) from profiles where id=$1", [editor]), 0);
  assert.equal(await scalar("select count(*) from group_challenges where id=$1", [legacyCreator]), 1, "Deleting a non-creator uploader must preserve the creator's challenge");
  assert.equal(await scalar("select visual_image_owner_id from group_challenges where id=$1", [legacyCreator]), null);
  assert.equal(await scalar("select visual_image_path from group_challenges where id=$1", [legacyCreator]), null, "Deletion clears the removed uploader's identifying path too");
  await asUser(viewer);
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [deletionVisual]), false);
  await db.exec("reset role;");
  await db.query("insert into google_health_account_deletion_guards(user_id) values($1)", [viewer]);
  await asUser(viewer);
  assert.equal(await scalar("select can_read_media_object($1)", [entryPath]), false, "Account-deletion fence remains authoritative");
  await asUser(null);
  assert.equal(await scalar("select can_read_media_object($1)", [entryPath]), false);
  assert.equal(await scalar("select can_read_challenge_media_object($1)", [creatorVisual]), false);
  for (const path of [null, "", owner, owner + "/"]) assert.equal(await scalar("select media_path_belongs_to($1,$2)", [path, owner]), false);
  console.log("Attachment ownership SQL passed: foreign/empty/traversal write guards, legacy fail-closed references, legitimate shared/DM/owner paths, challenge admin provenance, unchanged-spoof resistance, blocks, deletion and anonymous fences. No media files deleted.");
} finally {
  await db.close();
}
