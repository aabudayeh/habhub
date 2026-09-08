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
  const oldTimestamps=(await db.query("select id,updated_at from metric_entries order by id")).rows;
  await db.exec(await source("202609080007_destination_scoped_group_publication.sql"));
  assert.deepEqual((await db.query("select id,updated_at from metric_entries order by id")).rows,oldTimestamps,"Namespace migration must not edit log timestamps");
  assert.equal(await scalar("select count(*) from realtime.test_events"),0,"Namespace migration must not send one broadcast per photo");
  assert.equal(await scalar("select count(*) from test_publish_markers"),0,"Namespace migration must not dirty group activity");
  assert.equal(await scalar("select count(*) from metric_privacy_cache_fences"),0,"Namespace migration must not create privacy changes");
  assert.match(await source("202608140002_activate_group_notification_events.sql"),/after insert on public\.metric_entries[\s\S]*?execute function public\.emit_group_metric_push_event/);

  assert.equal(await scalar("select client_generated_id from metric_entries where id=$1",[id(9001)]),scoped(0,"legacy%_source:one"));
  assert.equal(await scalar("select client_generated_id from photo_updates where id=$1",[id(9101)]),scoped(0,"photo-old"));
  assert.equal(await scalar("select target_id from group_social_reactions"),"photo-old","Photo social identity must remain stable");
  assert.equal(await scalar("select count(*) from metric_entries where client_generated_id='google-health-group-detail:stable'"),1);
  assert.equal(await scalar("select public.group_projection_source_id($1)",[scoped(0,"raw:with:colons%_")]),"raw:with:colons%_");
  assert.equal(await scalar("select public.group_projection_destination('habhub-group:not-a-uuid:id')"),null);
  assert.equal(await scalar("select public.group_projection_destination($1)",[scoped(0,"Line\nTwo").toUpperCase()]),groups[0]);
  assert.equal(await scalar("select public.group_projection_source_id($1)",[scoped(0,"Line\nTwo")]),"Line\nTwo");

  await asUser(owner);
  // Old clients still sending raw IDs get a new per-destination upsert, never
  // rebind the original relational UUID to the new group's definition.
  const upsert="insert into metric_entries(user_id,metric_id,client_generated_id,account_revision) values($1,$2,$3,10) on conflict(user_id,client_generated_id) do update set metric_id=excluded.metric_id,account_revision=excluded.account_revision";
  await db.query(upsert,[owner,metric(1),"legacy%_source:one"]);
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1 and public.group_projection_source_id(client_generated_id)='legacy%_source:one'",[owner]),2);
  assert.equal(await scalar("select metric_id from metric_entries where id=$1",[id(9001)]),metric(0));
  await throws("update metric_entries set metric_id=$1,account_revision=10 where id=$2",/destination_immutable/,[metric(1),id(9001)]);
  await throws(upsert,/identity_mismatch/,[owner,metric(1),scoped(0,"wrong-group")]);
  await throws(upsert,/active_group_publication_required/,[owner,metric(2),"pending-member-write"]);
  await throws(upsert,/account_revision_forbidden/,[other,metric(0),"forged-owner"]);
  await throws("insert into metric_entries(user_id,metric_id,client_generated_id,account_revision) values($1,$2,'stale',9)",/stale_group_publish/,[owner,metric(1)]);

  // Exact scoped cleanup, global source deletion, wildcard-safe matching,
  // already-absent retries, and owner isolation.
  await db.query(upsert,[owner,metric(1),"legacyXXsource:one"]);
  await db.query("select * from delete_group_metric_entries($1,10)",[[scoped(0,"legacy%_source:one")]]);
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1 and public.group_projection_source_id(client_generated_id)='legacy%_source:one'",[owner]),1);
  const deletion=await db.query("select * from delete_group_metric_entries($1,10)",[["legacy%_source:one"]]);
  assert.equal(deletion.rows.length,1); assert.equal(deletion.rows[0].deleted_client_generated_id,"legacy%_source:one");
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1 and public.group_projection_source_id(client_generated_id)='legacyXXsource:one'",[owner]),1);
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1 and public.group_projection_source_id(client_generated_id)='legacy%_source:one'",[other]),1);
  assert.equal((await db.query("select * from delete_group_metric_entries($1,10)",[["legacy%_source:one"]])).rows.length,1);
  await db.query("select clear_group_metric_entry_tombstones($1,10)",[["legacy%_source:one","legacy-deleted"]]);
  assert.equal(await scalar("select count(*) from metric_entry_tombstones where user_id=$1",[owner]),0);
  await throws("select * from delete_group_metric_entries(array_fill('x'::text,array[1001]),10)",/1000/);

  // Social uses original IDs within the requested group, canonical metric
  // UUIDs, and unchanged original photo targets for either caller form.
  await db.query(upsert,[owner,metric(0),"social-source"]);
  const socialId=await scalar("select id from metric_entries where user_id=$1 and client_generated_id=$2",[owner,scoped(0,"social-source")]);
  assert.equal(await scalar("select resolve_group_social_metric_entry_id($1,'social-source')",[groups[0]]),socialId);
  assert.equal(await scalar("select valid_group_social_target($1,'photo_update','photo-old')",[groups[0]]),true);
  assert.equal(await scalar("select valid_group_social_target($1,'photo_update',$2)",[groups[0],"HABHUB-GROUP:"+groups[0]+":photo-old"]),true);
  assert.equal(await scalar("select valid_group_social_target($1,'photo_update',$2)",[groups[1],scoped(0,"photo-old")]),false);
  await asUser(viewer);
  assert.equal(await scalar("select (set_group_social_reaction($1,'photo_update',$2,'cheer','feed')).target_id",[groups[0],scoped(0,"photo-old")]),"photo-old");
  assert.equal(await scalar("select count(*) from group_social_reactions"),1);
  await db.query("select set_group_social_reaction($1,'photo_update',$2,null,'feed')",[groups[0],scoped(0,"photo-old")]);
  assert.equal(await scalar("select count(*) from group_social_reactions"),0);

  await asUser(owner);
  for(const [g,group] of groups.entries()) {
    if(g===2) await db.exec("reset role; set request.jwt.claim.sub='';");
    await db.query(upsert,[owner,metric(g),"privacy-history-"+g]);
    await db.query("insert into daily_metric_status(group_id,metric_id,user_id,visibility,account_revision) values($1,$2,$3,$4,10)",[group,metric(g),owner,g===1?"status":"group"]);
    await db.query("insert into photo_updates(owner_user_id,group_id,client_generated_id,account_revision) values($1,$2,$3,10)",[owner,group,"shared-photo-"+g]);
  }
  await asUser(owner);
  // A legacy row-level trigger could already have raised this metadata fence
  // without revoking other days: explicit withdrawal must still happen once.
  await db.exec("reset role;");
  await db.query("select advance_metric_privacy_cache_fence_internal($1,$2,$3,10)",[groups[0],metric(0),owner]);
  await asUser(owner);
  await db.query("select advance_metric_privacy_cache_fences($1,$2,10)",[groups[0],[metric(0),metric(0,2)]]);
  assert.equal(await scalar("select count(*) from metric_privacy_cache_fences where user_id=$1",[owner]),4,"Same slugs in both active groups must be fenced");
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1 and metric_id=any($2::uuid[]) and visibility='group'",[owner,[metric(0),metric(1)]]),0);
  assert.equal(await scalar("select count(*) from daily_metric_status where user_id=$1 and group_id=any($2::uuid[]) and visibility<>'private'",[owner,groups.slice(0,2)]),0,"Status-only summaries must withdraw too");
  assert.equal(await scalar("select count(*) from photo_updates where owner_user_id=$1 and group_id=any($2::uuid[]) and visibility='group'",[owner,groups.slice(0,2)]),0);
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1 and metric_id=any($2::uuid[]) and visibility='group'",[owner,[metric(2),metric(3)]]),2,"Pending/removed memberships are not publication targets");
  assert.equal(await scalar("select visibility from metric_entries where id=$1",[id(9002)]),"group","Another owner's privacy is independent");
  await db.query("update metric_entries set visibility='group',account_revision=10 where id=$1",[socialId]);
  assert.equal(await scalar("select visibility from metric_entries where id=$1",[socialId]),"private","Same-fence mixed-entry re-share is acknowledged but remains private until the next normal revision");
  await db.query("update daily_metric_status set visibility='group',account_revision=10 where user_id=$1 and group_id=$2",[owner,groups[0]]);
  assert.equal(await scalar("select visibility from daily_metric_status where user_id=$1 and group_id=$2",[owner,groups[0]]),"private");
  await db.query("update photo_updates set visibility='group',account_revision=10 where id=$1",[id(9101)]);
  assert.equal(await scalar("select visibility from photo_updates where id=$1",[id(9101)]),"private");
  await throws("update daily_metric_status set visibility='group',account_revision=9 where user_id=$1",/stale_group_publish/,[owner]);
  await throws("select advance_metric_privacy_cache_fences($1,$2,9)",/stale_group_publish/,[groups[0],[metric(0)]]);
  await throws("select advance_metric_privacy_cache_fences($1,$2,10)",/metric_mismatch/,[groups[0],[metric(1)]]);
  // A permitted fresh status projection survives replaying the same fence.
  await db.query("update daily_metric_status set visibility='status',account_revision=10 where user_id=$1 and group_id=$2",[owner,groups[0]]);
  await db.query("select advance_metric_privacy_cache_fences($1,$2,10)",[groups[1],[metric(1)]]);
  assert.equal(await scalar("select visibility from daily_metric_status where user_id=$1 and group_id=$2",[owner,groups[0]]),"status");
  await asUser(viewer);
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1 and metric_id=any($2::uuid[])",[owner,[metric(0),metric(1)]]),0,"Raw access must be revoked before async republishing");
  assert.equal(await scalar("select count(*) from photo_updates where owner_user_id=$1 and group_id=any($2::uuid[])",[owner,groups.slice(0,2)]),0);
  await asUser(outsider);
  assert.equal(await scalar("select count(*) from metric_entries"),0);
  assert.equal(await scalar("select valid_group_social_target($1,'photo_update','photo-old')",[groups[0]]),false);
  await throws("select advance_metric_privacy_cache_fences($1,$2,10)",/forbidden/,[groups[0],[metric(0)]]);
  await asUser(null);
  await throws("select * from delete_group_metric_entries($1,10)",/forbidden/,[["social-source"]]);

  await db.exec("reset role; set request.jwt.claim.sub='';");
  await db.query("insert into user_blocks values($1,$2)",[viewer,other]);
  await asUser(viewer);
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1",[other]),0,"Blocked owner raw rows must remain hidden");
  assert.equal(await scalar("select count(*) from photo_updates where owner_user_id=$1",[other]),0);
  await db.exec("reset role; update user_snapshots set revision=11 where user_id='"+owner+"';");
  await asUser(owner);
  await db.query("update metric_entries set visibility='group',account_revision=11 where id=$1",[socialId]);
  assert.equal(await scalar("select visibility from metric_entries where id=$1",[socialId]),"group","The next queued committed revision repairs still-authorized historical entries without a new log");
  assert.equal(await scalar("select visibility from photo_updates where id=$1",[id(9101)]),"private","Repair of an allowed entry must not restore unrelated private photos");
  await db.query("insert into metric_entries(user_id,metric_id,client_generated_id,account_revision) values($1,$2,'fresh-reshare',11)",[owner,metric(1)]);
  assert.equal(await scalar("select visibility from metric_entries where user_id=$1 and client_generated_id=$2",[owner,scoped(1,"fresh-reshare")]),"group");
  await db.query("insert into photo_updates(owner_user_id,group_id,client_generated_id,account_revision) values($1,$2,'photo-delete',11),($1,$3,'photo-delete',11)",[owner,groups[0],groups[1]]);
  await db.query("select delete_group_photo_updates($1,$2,11)",[["photo-delete"],groups[0]]);
  assert.equal(await scalar("select count(*) from photo_updates where owner_user_id=$1 and public.group_projection_source_id(client_generated_id)='photo-delete'",[owner]),1);
  await db.query("select delete_group_photo_updates($1,null,11)",[["photo-delete"]]);
  assert.equal(await scalar("select count(*) from photo_updates where owner_user_id=$1 and public.group_projection_source_id(client_generated_id)='photo-delete'",[owner]),0);
  await db.exec("reset role; set request.jwt.claim.sub='';");
  await db.query("insert into metric_entries(user_id,metric_id,client_generated_id,account_revision) select $1,$2,'indexed-source-'||n,11 from generate_series(1,1205) n",[owner,metric(1)]);
  await db.exec("analyze metric_entries;");
  // Deletion and social-resolution RPCs use this predicate only after their
  // explicit authorization, inside SECURITY DEFINER; inspect that same plan.
  const sourcePlan=(await db.query("explain(costs off) select id from metric_entries where user_id=$1 and public.group_projection_source_id(client_generated_id)=$2",[owner,"indexed-source-1205"])).rows.map(row=>Object.values(row)[0]).join("\n");
  assert.match(sourcePlan,/metric_entries_owner_source_projection_idx/,"Owner/source resolution should use its expression index with a large history");
  assert.match(sourcePlan,/Index Cond:.*group_projection_source_id/,"The decoded source, not only owner, should be in the privileged RPC index condition");
  assert.equal(await scalar("select count(*) from metric_entries where user_id=$1 and public.group_projection_source_id(client_generated_id)='indexed-source-1205'",[owner]),1);
  console.log(sourcePlan);
  console.log("Group publication SQL: legacy UUIDs/social identity, two active destinations, strict namespace, wildcard-safe owner-only deletion/retry, all-group private/status withdrawal, stale fences, membership/block isolation passed.");
} catch (error) { console.error({message:error.message,detail:error.detail,where:error.where,query:error.query}); throw error; }
finally { await db.close(); }
