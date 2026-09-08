import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const db = new PGlite();
const migrationRoot = new URL("../supabase/migrations/", import.meta.url);
const sources = new Map();
async function source(name) {
  if (!sources.has(name)) sources.set(name, await Deno.readTextFile(new URL(name, migrationRoot)));
  return sources.get(name);
}
async function loadFunction(file, name) {
  const sql = await source(file);
  const marker = "create or replace function public." + name + "(";
  const start = sql.indexOf(marker);
  assert(start >= 0, "Missing fixture function " + name);
  const body = sql.indexOf("as $$", start);
  const end = sql.indexOf("$$;", body + 5);
  assert(body >= 0 && end >= 0);
  await db.exec(sql.slice(start, end + 3));
}
async function scalar(sql, params = []) {
  return Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
}
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const owner = id(1), other = id(2), viewer = id(3), outsider = id(4);
const groups = [101,102,103,104].map(id);
const metric = (g, slug = 1) => id(1000 + g * 10 + slug);
const scoped = (g, value) => "habhub-group:" + groups[g] + ":" + value;
async function asUser(user) {
  await db.exec("reset role; set request.jwt.claim.sub = '" + (user ?? "") + "'; set role authenticated;");
}
async function throws(sql, pattern, params = []) {
  await assert.rejects(db.query(sql, params), pattern);
}
try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create schema realtime;
    create table realtime.test_events(payload jsonb);
    create table public.test_publish_markers(group_id uuid);
    create function realtime.send(p_payload jsonb,p_event text,p_topic text,p_private boolean)
    returns void language sql as $$ insert into realtime.test_events values(p_payload) $$;
    create function public.mark_group_activity_publish_change(p_group uuid,p_user uuid,p_since date)
    returns void language sql as $$ insert into public.test_publish_markers values(p_group) $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table public.profiles(id uuid primary key, display_name text);
    create table public.groups(id uuid primary key, created_at timestamptz default now());
    create table public.group_members(group_id uuid, user_id uuid, status text default 'active', primary key(group_id,user_id));
    create table public.user_snapshots(user_id uuid primary key, revision bigint);
    create table public.user_blocks(blocker_id uuid, blocked_user_id uuid);
    create table public.metric_definitions(id uuid primary key, group_id uuid, slug text, name text, archived_at timestamptz);
    create table public.metric_entries(
      id uuid primary key default gen_random_uuid(), user_id uuid, metric_id uuid,
      client_generated_id text, local_date date default current_date, value numeric default 1,
      visibility text default 'group', source text default 'manual', source_provider text,
      label text, account_revision bigint, updated_at timestamptz default now(),
      recorded_at timestamptz default now(), unique(user_id,client_generated_id)
    );
    create table public.photo_updates(
      id uuid primary key default gen_random_uuid(), owner_user_id uuid, group_id uuid,
      client_generated_id text, visibility text default 'group', account_revision bigint,
      local_date date default current_date, created_at timestamptz default now(), unique(owner_user_id,client_generated_id)
    );
    create table public.metric_entry_tombstones(
      group_id uuid, user_id uuid, client_generated_id text, local_date date, visibility text, deleted_at timestamptz,
      primary key(user_id,client_generated_id)
    );
    create table public.daily_metric_status(
      group_id uuid, metric_id uuid, user_id uuid, local_date date default current_date,
      visibility text default 'group', account_revision bigint,
      primary key(group_id,metric_id,user_id,local_date)
    );
    create table public.metric_privacy_cache_fences(group_id uuid,metric_id uuid,user_id uuid,revision bigint,primary key(group_id,metric_id,user_id));
    create table public.group_activity_versions(group_id uuid primary key,version bigint,since_date date,updated_at timestamptz);
    create table public.group_social_reactions(
      group_id uuid,target_type text,target_id text,user_id uuid,reaction text,source_surface text,
      created_at timestamptz default now(),updated_at timestamptz default now(),primary key(group_id,target_type,target_id,user_id)
    );
    create table public.group_social_comments(id uuid primary key default gen_random_uuid(),group_id uuid,target_type text,target_id text,user_id uuid,content text);
    create function public.is_group_member(p_group_id uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.group_members where group_id=p_group_id and user_id=auth.uid() and status='active')
    $$;
    grant usage on schema auth,public to authenticated,anon;
    grant select,insert,update on all tables in schema public to authenticated;
    grant select on all tables in schema public to anon;
    insert into public.profiles values ('${owner}','Owner'),('${other}','Other'),('${viewer}','Viewer'),('${outsider}','Outsider');
    insert into public.user_snapshots values ('${owner}',10),('${other}',10),('${viewer}',10);
  `);
  for (const [index, group] of groups.entries()) {
    await db.query("insert into groups(id) values($1)",[group]);
    await db.query("insert into group_members values($1,$2,$3),($1,$4,'active')",[group,owner,index<2?"active":index===2?"pending":"removed",viewer]);
    for (const [slugIndex,slug] of [[1,"food"],[2,"progress_photo"],[3,"steps"]]) {
      await db.query("insert into metric_definitions(id,group_id,slug,name) values($1,$2,$3,$3)",[metric(index,slugIndex),group,slug]);
    }
  }
  await db.query("insert into group_members values($1,$2,'active')",[groups[0],other]);
  for (const [user,rowId] of [[owner,id(9001)],[other,id(9002)]]) {
    await db.query("insert into metric_entries(id,user_id,metric_id,client_generated_id,account_revision) values($1,$2,$3,'legacy%_source:one',9)",[rowId,user,metric(0)]);
    await db.query("insert into photo_updates(id,owner_user_id,group_id,client_generated_id,account_revision) values($1,$2,$3,'photo-old',9)",[id(user===owner?9101:9102),user,groups[0]]);
  }
  await db.query("insert into metric_entries(user_id,metric_id,client_generated_id,source_provider,account_revision) values($1,$2,'google-health-group-detail:stable','google_health',9)",[owner,metric(0)]);
  await db.query("insert into metric_entry_tombstones values($1,$2,'legacy-deleted',current_date,'group',now())",[groups[0],owner]);
  await db.query("insert into group_social_reactions(group_id,target_type,target_id,user_id,reaction,source_surface) values($1,'photo_update','photo-old',$2,'heart','feed')",[groups[0],viewer]);

  const atomic="202608040003_atomic_workspace_metadata.sql";
  const social="202609080003_group_hub_social_productivity.sql";
  await loadFunction(atomic,"assert_account_snapshot_revision");
  await loadFunction("202608100003_fix_revision_trigger_dispatch.sql","enforce_group_projection_revision");
  await loadFunction("202607270001_group_activity_read_model.sql","delete_group_metric_entries");
  await loadFunction("202608130006_metric_privacy_cache_fences.sql","advance_metric_privacy_cache_fence_internal");
  for(const name of ["metric_privacy_event_revision","fence_nonexact_metric_entry_updates","fence_nonexact_daily_status_updates","fence_nonexact_photo_updates"]) await loadFunction("202608130006_metric_privacy_cache_fences.sql",name);
  await loadFunction("202608240009_legacy_workspace_publish_containment.sql","touch_metric_entry_updated_at_if_changed");
  await loadFunction("202608240009_legacy_workspace_publish_containment.sql","mark_metric_entry_publish_change");
  await loadFunction("202608250001_compact_group_realtime.sql","broadcast_group_workspace_change");
  await loadFunction("202608280001_durable_group_log_social_identity.sql","resolve_group_social_metric_entry_id");
  await loadFunction("202608280001_durable_group_log_social_identity.sql","canonicalize_group_social_metric_target");
  for(const name of ["valid_group_social_target","resolve_group_social_notification_target","set_group_social_reaction"]) await loadFunction(social,name);
  await loadFunction("202608260001_suppress_passive_walking_push.sql","enqueue_group_lead_push_event");
  for(const name of ["habhub_users_blocked_either_way","habhub_message_visible_to_current_user"]) await loadFunction("202609040002_user_safety.sql",name);
  await db.exec(`
    create trigger entries_revision before insert or update on metric_entries for each row execute function enforce_group_projection_revision();
    create trigger photos_revision before insert or update on photo_updates for each row execute function enforce_group_projection_revision();
    create trigger statuses_revision before insert or update on daily_metric_status for each row execute function enforce_group_projection_revision();
    create trigger metric_entries_z_touch_updated_at before update on metric_entries for each row execute function touch_metric_entry_updated_at_if_changed();
    create trigger photo_updates_workspace_broadcast after insert or update or delete on photo_updates for each row execute function broadcast_group_workspace_change();
    create trigger metric_entries_mark_publish_update after update on metric_entries referencing old table as old_entry_rows new table as new_entry_rows for each statement execute function mark_metric_entry_publish_change();
    create trigger metric_entries_fence_nonexact_update after update on metric_entries referencing old table as old_rows new table as new_rows for each statement execute function fence_nonexact_metric_entry_updates();
    create trigger daily_status_fence_nonexact_update after update on daily_metric_status referencing old table as old_rows new table as new_rows for each statement execute function fence_nonexact_daily_status_updates();
    create trigger photo_updates_fence_nonexact_update after update on photo_updates referencing old table as old_rows new table as new_rows for each statement execute function fence_nonexact_photo_updates();
    create trigger social_canonical before insert or update on group_social_reactions for each row execute function canonicalize_group_social_metric_target();
    alter table metric_entries enable row level security;
    alter table photo_updates enable row level security;
    create policy entries_owner_write on metric_entries for insert to authenticated with check(user_id=auth.uid());
    create policy entries_owner_update on metric_entries for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy photos_owner_write on photo_updates for insert to authenticated with check(owner_user_id=auth.uid());
    create policy photos_owner_update on photo_updates for update to authenticated using(owner_user_id=auth.uid()) with check(owner_user_id=auth.uid());
  `);
  // Use the current production raw-content policies (including block fences).
  const safety=await source("202609040002_user_safety.sql");
  for(const name of ["entries_authorized_select","photos_authorized_select"]) {
    const start=safety.indexOf("create policy "+name);
    await db.exec(safety.slice(start,safety.indexOf(";",start)+1));
  }

  await db.exec(await source("202609080007_destination_scoped_group_publication.sql"));
  assert.equal(await scalar("select count(*) from realtime.test_events"),0,"Namespace migration must not send one broadcast per photo");
  assert.equal(await scalar("select count(*) from test_publish_markers"),0,"Namespace migration must not dirty group activity");
  assert.equal(await scalar("select count(*) from metric_privacy_cache_fences"),0,"Namespace migration must not create privacy changes");
  assert.match(await source("202608140002_activate_group_notification_events.sql"),/after insert on public\.metric_entries[\s\S]*?execute function public\.emit_group_metric_push_event/);


  const victimAsset=id(9301), attackerAsset=id(9302), legitimateAsset=id(9303);
  const victimPath=owner+"/withdrawn-photo.jpg", legitimatePath=owner+"/legitimate-share.jpg";
  await db.exec(`
    create schema storage;
    create table auth.users(id uuid primary key);
    insert into auth.users select id from profiles;
    create table google_health_account_deletion_guards(user_id uuid primary key);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    create function public.shares_group_with(uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.group_members a join public.group_members b using(group_id) where a.user_id=auth.uid() and b.user_id=$1 and a.status='active' and b.status='active')
    $$;
    alter table profiles add column avatar_path text;
    alter table metric_entries add column image_path text;
    create table messages(group_id uuid,sender_id uuid,recipient_id uuid,image_path text);
    create table media_assets(id uuid primary key,owner_user_id uuid not null,storage_path text not null unique);
    alter table photo_updates add column media_asset_id uuid references media_assets(id);
    alter table media_assets enable row level security;
    grant select,insert,update on media_assets to authenticated;
    create policy media_owner_all on media_assets for all to authenticated using(owner_user_id=auth.uid()) with check(owner_user_id=auth.uid());
    alter table group_social_comments enable row level security;
  `);
  await db.query("insert into media_assets values($1,$2,$3),($4,$5,$6),($7,$2,$8)",[victimAsset,owner,victimPath,attackerAsset,other,other+"/own-photo.jpg",legitimateAsset,legitimatePath]);
  await db.query("update photo_updates set media_asset_id=case when owner_user_id=$1 then $2::uuid else $3::uuid end",[owner,victimAsset,attackerAsset]);
  await db.exec("alter table photo_updates alter column media_asset_id set not null;");
  await db.query("insert into group_members values($1,$2,'active')",[groups[1],other]);
  for(const name of ["media_authorized_read","group_social_comments_member_read"]) {
    const start=safety.indexOf("create policy "+name);
    await db.exec(safety.slice(start,safety.indexOf(";",start)+1));
  }
  await loadFunction("202609040002_user_safety.sql","can_read_media_object");
  const insertPhoto="insert into photo_updates(owner_user_id,group_id,client_generated_id,media_asset_id,account_revision) values($1,$2,$3,$4,$5) returning id";
  await asUser(owner);
  const victimPhoto=(await db.query(insertPhoto,[owner,groups[0],"victim-social",victimAsset,10])).rows[0].id;
  await db.exec("reset role;");
  await db.query("insert into group_social_comments(group_id,target_type,target_id,user_id,content) values($1,'photo_update','victim-social',$2,'Victim historical photo discussion')",[groups[0],viewer]);
  await asUser(owner);
  await db.query("update photo_updates set visibility='private',account_revision=10 where owner_user_id=$1",[owner]);
  await asUser(viewer);
  assert.equal(await scalar("select can_read_media_object($1)",[victimPath]),false,"Withdrawal originally blocks new signed-URL authorization");
  assert.equal(await scalar("select count(*) from group_social_comments where target_id='victim-social'"),0);

  // Reproduce both defects with an ordinary active member, its current
  // account revision, and a victim asset UUID learned while it was shared.
  await asUser(other);
  const forgedPhoto=(await db.query(insertPhoto,[other,groups[1],"cached-foreign-asset",victimAsset,10])).rows[0].id;
  await db.query(insertPhoto,[other,groups[0],"victim-social",attackerAsset,10]);
  await asUser(viewer);
  assert.equal(await scalar("select can_read_media_object($1)",[victimPath]),true,"PRE008: forged photo re-enables victim image access in another group");
  assert.equal(await scalar("select count(*) from group_social_comments where target_id='victim-social'"),1,"PRE008: collision resurrects withdrawn discussion");
  assert.equal(await scalar("select recipient_id from resolve_group_social_notification_target($1,'photo_update','victim-social')",[groups[0]]),other,"PRE008: collision spoofs notification ownership");
  assert.equal(await scalar("select count(*) from photo_updates where id=$1",[victimPhoto]),0,"Victim's real private photo row stays hidden; forged link bypasses it");
  console.log("Reproduced pre008: cached foreign-asset re-sharing, withdrawn-comment resurrection and recipient spoofing.");

  // Retain an unambiguous legitimate legacy target and its discussion.
  await db.exec("reset role; update user_snapshots set revision=11 where user_id='"+owner+"';");
  await asUser(owner);
  const legitimatePhoto=(await db.query(insertPhoto,[owner,groups[0],"unique-legacy",legitimateAsset,11])).rows[0].id;
  await db.exec("reset role; set request.jwt.claim.sub='';");
  await db.query("insert into group_social_comments(group_id,target_type,target_id,user_id,content) values($1,'photo_update','unique-legacy',$2,'Keep this existing discussion')",[groups[0],viewer]);
  const readerBefore=await scalar("select pg_get_functiondef('public.can_read_media_object(text)'::regprocedure)");
  await db.exec(await source("202609080008_photo_media_and_social_ownership.sql"));
  const readerAfter=await scalar("select pg_get_functiondef('public.can_read_media_object(text)'::regprocedure)");
  assert.equal(readerAfter,readerBefore.replace("where asset.storage_path = object_path","where asset.storage_path = object_path and asset.owner_user_id = photo.owner_user_id"),"Only the photo storage branch should change");
  assert.equal(await scalar("select visibility from photo_updates where id=$1",[forgedPhoto]),"private","Legacy foreign references are quarantined, not deleted");
  assert.equal(await scalar("select count(*) from media_assets where id=$1",[victimAsset]),1,"Owner media asset is preserved");
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.group_photo_social_identities'::regclass"),true);
  assert.equal(await scalar("select has_table_privilege('authenticated','public.group_photo_social_identities','SELECT')"),false);

  await asUser(viewer);
  assert.equal(await scalar("select can_read_media_object($1)",[victimPath]),false,"POST008: fresh signed URLs remain forbidden");
  assert.equal(await scalar("select count(*) from media_assets where id=$1",[victimAsset]),0);
  assert.equal(await scalar("select count(*) from group_social_comments where target_id='victim-social'"),0,"Ambiguous alias is fail-closed across all visibility states");
  assert.equal(await scalar("select count(*) from resolve_group_social_notification_target($1,'photo_update','victim-social')",[groups[0]]),0);
  assert.equal(await scalar("select count(*) from group_social_comments where target_id='unique-legacy'"),1,"Existing unambiguous discussions are preserved");
  assert.equal(await scalar("select recipient_id from resolve_group_social_notification_target($1,'photo_update','unique-legacy')",[groups[0]]),owner);
  assert.equal(await scalar("select (set_group_social_reaction($1,'photo_update','unique-legacy','heart','feed')).target_id",[groups[0]]),"unique-legacy");
  await throws("select * from group_photo_social_identities",/permission denied/);

  await asUser(other);
  for(const group of groups.slice(0,2)) await throws(insertPhoto,/photo_media_ownership_required/,[other,group,"foreign-write-"+group,victimAsset,10]);
  await throws("update photo_updates set media_asset_id=$1,account_revision=10 where owner_user_id=$2 and client_generated_id=$3",/photo_media_ownership_required/,[victimAsset,other,scoped(0,"photo-old")]);
  await throws(insertPhoto,/photo_social_source_id_reserved/,[other,groups[0],"unique-legacy",attackerAsset,10]);
  // A third active owner avoids the original attacker's existing unique row,
  // proving the ambiguous-alias binding itself rejects a new claim.
  await asUser(viewer);
  const viewerAsset=id(9304);
  await db.query("insert into media_assets values($1,$2,$3)",[viewerAsset,viewer,viewer+"/own-photo.jpg"]);
  await throws(insertPhoto,/photo_social_source_id_reserved/,[viewer,groups[0],"victim-social",viewerAsset,10]);

  // Same-owner media can still be shared independently into several groups,
  // and normal upserts preserve its existing social binding.
  await asUser(owner);
  for(const group of groups.slice(0,2)) await db.query(insertPhoto,[owner,group,"multi-group-legitimate",legitimateAsset,11]);
  await db.query("insert into photo_updates(owner_user_id,group_id,client_generated_id,media_asset_id,account_revision) values($1,$2,'multi-group-legitimate',$3,11) on conflict(owner_user_id,client_generated_id) do update set client_generated_id=excluded.client_generated_id,media_asset_id=excluded.media_asset_id,account_revision=excluded.account_revision",[owner,groups[0],legitimateAsset]);
  await asUser(viewer);
  assert.equal(await scalar("select can_read_media_object($1)",[legitimatePath]),true);
  assert.equal(await scalar("select count(*) from photo_updates where owner_user_id=$1 and public.group_projection_source_id(client_generated_id)='multi-group-legitimate'",[owner]),2);

  // Deletion never frees someone else's alias. Its original owner can restore
  // the same source identity (e.g. an intentional backup restore) safely.
  await asUser(owner);
  await db.query("select delete_group_photo_updates($1,$2,11)",[["unique-legacy"],groups[0]]);
  await asUser(viewer);
  assert.equal(await scalar("select count(*) from group_social_comments where target_id='unique-legacy'"),0);
  await asUser(other);
  await throws(insertPhoto,/photo_social_source_id_reserved/,[other,groups[0],"unique-legacy",attackerAsset,10]);
  await asUser(owner);
  const restored=(await db.query(insertPhoto,[owner,groups[0],"unique-legacy",legitimateAsset,11])).rows[0].id;
  assert.notEqual(restored,legitimatePhoto);
  await asUser(viewer);
  assert.equal(await scalar("select count(*) from group_social_comments where target_id='unique-legacy'"),1);
  assert.equal(await scalar("select recipient_id from resolve_group_social_notification_target($1,'photo_update','unique-legacy')",[groups[0]]),owner);
  await asUser(outsider);
  assert.equal(await scalar("select can_read_media_object($1)",[legitimatePath]),false);
  assert.equal(await scalar("select valid_group_social_target($1,'photo_update','unique-legacy')",[groups[0]]),false);
  await db.exec("reset role; set request.jwt.claim.sub=''; set role anon;");
  await throws("select * from group_photo_social_identities",/permission denied/);
  console.log("Photo publication security: ownership writes/updates, legacy quarantine, signed-URL authorization, private/ambiguous/deleted social targets, owner binding, unchanged legitimate discussions, multi-group shares and owner restore passed.");
} catch(error) { console.error({message:error.message,detail:error.detail,where:error.where,query:error.query}); throw error; }
finally { await db.close(); }
