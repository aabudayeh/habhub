import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const db = new PGlite();
const root = new URL("../supabase/migrations/", import.meta.url);
const read = (file) => Deno.readTextFile(new URL(file, root));
async function loadFunction(file, name) {
  const text = await read(file);
  const start = text.indexOf("create or replace function public." + name + "(");
  assert(start >= 0, name);
  const body = text.indexOf("as $$", start), end = text.indexOf("$$;", body + 5);
  await db.exec(text.slice(start, end + 3));
}
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12,"0");
const owner=id(1), admin=id(2), member=id(3), outsider=id(4), removed=id(5);
const group=id(101), otherGroup=id(102);
const path=(user,name)=>`${user}/account/group-note/${name}.jpg`;
async function scalar(sql,params=[]) { return Object.values((await db.query(sql,params)).rows[0]??{})[0]; }
async function asUser(user) { await db.exec(`reset role; set request.jwt.claim.sub='${user??""}'; set role authenticated;`); }
const saveSql="select * from save_group_note($1,$2,$3,$4,$5,$6)";
const save=(note,revision,body,image,title="Shared plan",groupId=group)=>db.query(saveSql,[note,groupId,title,body,revision,image]);
const rejects=(promise,pattern)=>assert.rejects(promise,pattern);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    create table auth.users(id uuid primary key);
    create table profiles(id uuid primary key references auth.users(id) on delete cascade,avatar_path text);
    create table groups(id uuid primary key);
    create table group_members(group_id uuid,user_id uuid references profiles(id) on delete cascade,role text,status text,primary key(group_id,user_id));
    create table user_blocks(blocker_id uuid,blocked_user_id uuid);
    create table google_health_account_deletion_guards(user_id uuid);
    create table metric_definitions(id uuid primary key,group_id uuid);
    create table metric_entries(id uuid primary key default gen_random_uuid(),user_id uuid,metric_id uuid,image_path text,visibility text);
    create table messages(id uuid primary key default gen_random_uuid(),group_id uuid,sender_id uuid,recipient_id uuid,image_path text);
    create table group_challenges(id uuid primary key default gen_random_uuid(),visual_image_path text);
    create table group_schedule_items(id uuid primary key default gen_random_uuid(),group_id uuid,creator_id uuid,title text);
    create table media_assets(id uuid primary key,owner_user_id uuid,storage_path text,thumbnail_path text);
    create table photo_updates(id uuid primary key,group_id uuid,owner_user_id uuid,media_asset_id uuid,visibility text);
    create table group_social_comments(group_id uuid,target_type text,target_id text);
    create table group_social_reactions(group_id uuid,target_type text,target_id text);
    create table group_notification_events(group_id uuid,target_type text,target_id text);
    create table push_dispatch_events(group_id uuid,data jsonb);
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    create function is_group_member(uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.group_members where group_id=$1 and user_id=auth.uid() and status='active') $$;
    create function is_group_admin(uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.group_members where group_id=$1 and user_id=auth.uid() and status='active' and role in('admin','owner')) $$;
    create function shares_group_with(uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.group_members a join public.group_members b using(group_id) where a.user_id=auth.uid() and b.user_id=$1 and a.status='active' and b.status='active') $$;
    create function habhub_has_current_terms_acceptance() returns boolean language sql stable as $$ select coalesce(current_setting('test.terms',true),'yes') <> 'no' $$;
    create function habhub_message_content_allowed(text) returns boolean language sql stable as $$ select $1 not like '%prohibited-fixture%' $$;
    create function reset_account_private_data(uuid,uuid,jsonb,text,integer,timestamptz) returns jsonb language plpgsql security definer as $$
    declare p_user_id alias for $1; begin
      -- Keep media that still backs identity or retained group-visible content.
      return '{}'::jsonb;
    end $$;
    grant usage on schema public,auth,storage to authenticated,anon;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
  `);
  const hub=await read("202609080003_group_hub_social_productivity.sql");
  await db.exec(hub.slice(hub.indexOf("create table if not exists public.group_notes"),hub.indexOf("create index if not exists group_notes_group_updated_idx")));
  await db.exec("alter table group_notes enable row level security; grant select on group_notes to authenticated;");
  for(const name of ["habhub_users_blocked_either_way","habhub_message_visible_to_current_user","can_read_media_object"])
    await loadFunction("202609040002_user_safety.sql",name);
  await loadFunction("202609080009_attachment_namespace_ownership.sql","media_path_belongs_to");
  // Apply the existing 009 owner predicate used as the additive 011 anchor.
  const mediaBefore=await scalar("select pg_get_functiondef('can_read_media_object(text)'::regprocedure)");
  await db.exec(mediaBefore.replace("(storage.foldername(object_path))[1] = auth.uid()::text","public.media_path_belongs_to(object_path, auth.uid())"));
  const policyStart=hub.indexOf("create policy group_notes_member_read");
  await db.exec(hub.slice(policyStart,hub.indexOf(";",policyStart)+1));
  for(const name of ["save_group_note","delete_group_note"]) await loadFunction("202609080003_group_hub_social_productivity.sql",name);
  await db.exec("alter table storage.objects enable row level security; create policy objects_read on storage.objects for select to authenticated using(bucket_id='paceboard-media' and public.can_read_media_object(name));");
  await db.exec("create policy objects_owner_insert on storage.objects for insert to authenticated with check(public.media_path_belongs_to(name,auth.uid())); create policy objects_owner_update on storage.objects for update to authenticated using(public.media_path_belongs_to(name,auth.uid())) with check(public.media_path_belongs_to(name,auth.uid()));");
  await db.exec(await read("202609080011_group_note_images.sql"));
  const writableDefinition=await scalar("select pg_get_functiondef('assert_group_hub_accounts_writable(uuid[])'::regprocedure)");
  assert.match(writableDefinition,/if exists\(select 1 from public\.google_health_account_deletion_guards[\s\S]*raise exception[\s\S]*pg_advisory_xact_lock[\s\S]*if exists\(select 1 from public\.google_health_account_deletion_guards/,
    "A committed reset guard must fail before waiting for the account lock, with a post-lock race recheck");
  for(const user of [owner,admin,member,outsider,removed]) {
    await db.query("insert into auth.users values($1)",[user]); await db.query("insert into profiles(id) values($1)",[user]);
  }
  for(const value of [group,otherGroup]) await db.query("insert into groups values($1)",[value]);
  for(const [user,role,status] of [[owner,"owner","active"],[admin,"admin","active"],[member,"member","active"],[removed,"member","removed"]])
    await db.query("insert into group_members values($1,$2,$3,$4)",[group,user,role,status]);
  await db.query("insert into group_members values($1,$2,'owner','active'),($1,$3,'member','active')",[otherGroup,owner,outsider]);
  for(const [user,name] of [[owner,"one"],[owner,"two"],[owner,"shared"],[owner,"unpublished"],[admin,"admin-one"],[admin,"admin-two"]])
    await db.query("insert into storage.objects values('paceboard-media',$1)",[path(user,name)]);

  await asUser(owner);
  const first=(await save(null,null,"## Plan\n**Bring water**",path(owner,"one"))).rows[0];
  assert.equal(first.image_owner_id,owner); assert.equal(first.revision,1);
  await rejects(save(null,null,"",""),/group_note_image_owner_required/);
  await rejects(save(null,null,"",null),/Add text or an image/);
  await rejects(save(null,null,"x",path(admin,"admin-one")),/group_note_image_owner_required/);
  await rejects(save(null,null,"x",path(owner,"missing")),/group_note_image_owner_required/);
  await rejects(save(null,null,"x",path(owner,"one")),/group_note_image_already_used/);
  await rejects(save(null,null,"x",path(owner,"one"),"Other group",otherGroup),/group_note_image_already_used/);
  await assert.rejects(save(first.id,0,"stale",null),{code:"P0001",message:/changed on another device/});
  await db.exec("set test.terms='no'"); await rejects(save(null,null,"x",null),/Terms/); await db.exec("set test.terms='yes'");
  await rejects(save(null,null,"prohibited-fixture",null),/cannot be shared/);
  const stagedPath=path(owner,"staged-lost-response");
  await rejects(db.query("insert into storage.objects values('paceboard-media',$1)",[stagedPath]),/row-level security/);
  await db.query("select stage_group_note_image($1,$2)",[group,stagedPath]);
  await db.query("insert into storage.objects values('paceboard-media',$1)",[stagedPath]);
  // Simulate app death/lost response: no client retire call exists. Reservation
  // expiry still makes the uploaded object discoverable for cleanup.
  await db.exec("reset role");
  await db.query("update group_note_media_links set staged_until=now()-interval '1 second' where path=$1",[stagedPath]);
  await asUser(owner);
  assert.equal((await db.query("select * from list_retired_group_note_media($1)",[group])).rows.some((row)=>row.path===stagedPath),true);
  await rejects(save(null,null,"Delayed retry",stagedPath),/already_used/);
  assert.equal((await db.query("update storage.objects set name=name where name=$1 returning name",[stagedPath])).rows.length,0,"Published/retired paths cannot be overwritten");
  assert.equal(await scalar("select can_upload_staged_group_note_image($1)",[stagedPath]),false);
  const noBytes=path(owner,"staged-no-bytes");
  await db.query("select stage_group_note_image($1,$2)",[group,noBytes]);
  await db.exec("reset role");
  await db.query("update group_note_media_links set staged_until=now()-interval '1 second' where path=$1",[noBytes]);
  await asUser(owner);
  await db.query("select * from list_retired_group_note_media($1)",[group]);
  await rejects(db.query("insert into storage.objects values('paceboard-media',$1)",[noBytes]),/row-level security/);
  await db.query("insert into group_schedule_items(group_id,creator_id,title) values($1,$2,'Before reset')",[group,owner]);
  await db.exec("reset role"); await db.query("insert into google_health_account_deletion_guards values($1)",[owner]);
  await asUser(owner);
  await rejects(save(null,null,"During reset",null),/habhub_account_deleting/);
  await rejects(db.query("select * from save_group_note(null,$1,'Legacy','During reset',null)",[group]),/habhub_account_deleting/);
  await rejects(db.query("select stage_group_note_image($1,$2)",[group,path(owner,"guarded")]),/habhub_account_deleting/);
  await rejects(db.query("select can_upload_staged_group_note_image($1)",[noBytes]),/habhub_account_deleting/);
  await rejects(db.query("insert into group_schedule_items(group_id,creator_id,title) values($1,$2,'During reset')",[group,owner]),/habhub_account_deleting/);
  await asUser(admin);
  await rejects(db.query("update group_schedule_items set title='Admin edit' where creator_id=$1",[owner]),/habhub_account_deleting/);
  await save(null,null,"Another member remains usable",null);
  await db.query("insert into group_schedule_items(group_id,creator_id,title) values($1,$2,'Other member')",[group,admin]);
  await db.exec("reset role; delete from google_health_account_deletion_guards;");
  await asUser(owner);
  const legacy=(await db.query("select * from save_group_note($1,$2,'Old client','Plain update',1)",[first.id,group])).rows[0];
  assert.equal(legacy.image_path,path(owner,"one")); assert.equal(legacy.revision,2);

  await asUser(member);
  assert.equal(await scalar("select can_read_media_object($1)",[path(owner,"one")]),true);
  assert.equal(await scalar("select count(*) from storage.objects where name=$1",[path(owner,"one")]),1,"Storage SELECT authorizes an actual signed URL");
  await rejects(save(first.id,2,"Member edit",null),/Only the creator/);
  await rejects(db.query("select * from group_note_media_links"),/permission denied/);
  await asUser(outsider);
  assert.equal(await scalar("select can_read_media_object($1)",[path(owner,"one")]),false,"A different shared group is not enough");
  assert.equal(await scalar("select count(*) from group_notes where id=$1",[first.id]),0);
  await rejects(db.query("select * from list_retired_group_note_media($1)",[group]),/membership/);
  await asUser(removed);
  assert.equal(await scalar("select can_read_media_object($1)",[path(owner,"one")]),false);

  await asUser(admin);
  const replaced=(await save(first.id,2,"",path(admin,"admin-one"))).rows[0];
  assert.equal(replaced.creator_id,owner); assert.equal(replaced.image_owner_id,admin); assert.equal(replaced.revision,3);
  await db.exec("reset role"); await db.query("insert into google_health_account_deletion_guards values($1)",[admin]);
  await asUser(owner);
  await rejects(save(first.id,3,"Uploader resetting",path(admin,"admin-one")),/habhub_account_deleting/);
  await asUser(admin);
  await rejects(save(null,null,"Resetting actor",null),/habhub_account_deleting/);
  await db.exec("reset role; delete from google_health_account_deletion_guards;");
  await asUser(admin);
  assert.equal(await scalar("select can_delete_retired_group_note_media_object($1)",[path(owner,"one")]),true);
  assert.equal(await scalar("select count(*) from storage.objects where name=$1",[path(owner,"one")]),0,"Cleanup authority must NOT grant signed-URL read access");
  assert.equal(await scalar("select count(*) from list_retired_group_note_media($1)",[group]),1);
  // Service deletes only paths returned by the authenticated cleanup RPC.
  await db.exec("reset role"); await db.query("delete from storage.objects where name=$1",[path(owner,"one")]);
  await asUser(admin);
  assert.equal(await scalar("select count(*) from list_retired_group_note_media($1)",[group]),0);
  await db.exec("reset role"); await db.query("insert into user_blocks values($1,$2)",[member,admin]);
  await asUser(member);
  assert.equal(await scalar("select can_read_media_object($1)",[path(admin,"admin-one")]),false,"Uploader block applies even if creator remains visible");
  await db.exec("reset role; delete from user_blocks;");
  await db.query("insert into user_blocks values($1,$2)",[member,owner]);
  await asUser(member);
  assert.equal(await scalar("select can_read_media_object($1)",[path(admin,"admin-one")]),false,"Creator block also applies to admin-uploaded image");
  await db.exec("reset role; delete from user_blocks;");

  // An authorized cross-surface reference protects an image after note removal.
  await asUser(owner);
  const shared=(await save(null,null,"Linked image",path(owner,"shared"))).rows[0];
  await db.query("insert into messages(group_id,sender_id,image_path) values($1,$2,$3)",[group,owner,path(owner,"shared")]);
  await save(shared.id,1,"Image removed",null);
  assert.equal(await scalar("select can_delete_retired_group_note_media_object($1)",[path(owner,"shared")]),false);
  await rejects(db.query("insert into messages(group_id,sender_id,image_path) values($1,$2,$3)",[group,owner,path(owner,"shared")]),/group_note_image_retired/);
  await db.query("update messages set sender_id=sender_id where image_path=$1",[path(owner,"shared")]);
  await db.query("delete from messages where image_path=$1",[path(owner,"shared")]);
  assert.equal(await scalar("select can_delete_retired_group_note_media_object($1)",[path(owner,"shared")]),true);
  await rejects(save(null,null,"Try reattach",path(owner,"shared")),/group_note_image_already_used/);

  // Both no-registry interleavings are covered. PGlite is single-session, so
  // the lock call/order is asserted as well as each serialized outcome;
  // this is not a claim of a multi-backend stress test.
  const lateRef=path(owner,"reference-before-retire");
  await db.exec("reset role"); await db.query("insert into storage.objects values('paceboard-media',$1)",[lateRef]);
  await asUser(owner);
  await db.exec("begin");
  await db.query("insert into messages(group_id,sender_id,image_path) values($1,$2,$3)",[group,owner,lateRef]);
  assert.match(await scalar("select pg_get_functiondef('lock_group_note_media_paths(text[])'::regprocedure)"),/order by item[\s\S]*pg_advisory_xact_lock/);
  assert.match(await scalar("select pg_get_functiondef('fence_retired_group_note_attachment()'::regprocedure)"),/lock_group_note_media_paths\(v_paths\)[\s\S]*select retired_at/);
  await db.exec("commit");
  await db.query("select retire_unpublished_group_note_image($1,$2)",[group,lateRef]);
  assert.equal(await scalar("select can_delete_retired_group_note_media_object($1)",[lateRef]),false);
  const cleanupFirst=path(owner,"retire-before-reference");
  await db.exec("reset role"); await db.query("insert into storage.objects values('paceboard-media',$1)",[cleanupFirst]);
  await asUser(owner);
  await db.query("select retire_unpublished_group_note_image($1,$2)",[group,cleanupFirst]);
  await rejects(db.query("insert into messages(group_id,sender_id,image_path) values($1,$2,$3)",[group,owner,cleanupFirst]),/group_note_image_retired/);

  // Cleanup after a lost response never retires a committed publication.
  const active=(await save(null,null,"Active",path(owner,"two"))).rows[0];
  await db.query("select retire_unpublished_group_note_image($1,$2)",[group,path(owner,"two")]);
  assert.equal(await scalar("select can_read_media_object($1)",[path(owner,"two")]),true);
  assert.equal(await scalar("select can_delete_retired_group_note_media_object($1)",[path(owner,"two")]),false);
  await db.query("select retire_unpublished_group_note_image($1,$2)",[group,path(owner,"unpublished")]);
  assert.equal(await scalar("select can_delete_retired_group_note_media_object($1)",[path(owner,"unpublished")]),true);
  await rejects(save(null,null,"Delayed save",path(owner,"unpublished")),/group_note_image_already_used/);
  await db.query("select delete_group_note($1,1)",[active.id]);
  assert.equal(await scalar("select can_delete_retired_group_note_media_object($1)",[path(owner,"two")]),true);

  // Reset and actual uploader deletion preserve another creator's text/note,
  // while removing uploader access paths and private lifecycle metadata.
  await asUser(admin);
  await db.exec("reset role"); await db.query("insert into google_health_account_deletion_guards values($1)",[admin]);
  await asUser(admin);
  await db.exec("set request.jwt.claim.role='service_role';");
  await db.query("select reset_account_private_data($1,$2,'{}','device',27,now())",[admin,id(501)]);
  assert.equal(await scalar("select image_path from group_notes where id=$1",[first.id]),null);
  await db.exec("reset role; delete from google_health_account_deletion_guards; set request.jwt.claim.role='authenticated';");
  await asUser(admin);
  await save(first.id,3,"",path(admin,"admin-two"));
  await db.exec("reset role; set request.jwt.claim.sub='';");
  await db.query("delete from auth.users where id=$1",[admin]);
  assert.equal(await scalar("select image_path from group_notes where id=$1",[first.id]),null);
  assert.equal(await scalar("select count(*) from group_note_media_links where uploader_id=$1",[admin]),0);
  assert.equal(await scalar("select count(*) from group_notes where id=$1",[first.id]),1);

  // A dispatched cleanup path remains reserved after its original group dies.
  const deletedGroup=id(103), deletionPath=path(owner,"deleted-group");
  await db.query("insert into groups values($1)",[deletedGroup]);
  await db.query("insert into group_members values($1,$2,'owner','active')",[deletedGroup,owner]);
  await db.query("insert into storage.objects values('paceboard-media',$1)",[deletionPath]);
  await asUser(owner);
  const gone=(await save(null,null,"Group deletion",deletionPath,"Gone",deletedGroup)).rows[0];
  await db.query("select delete_group_note($1,1)",[gone.id]);
  assert.equal((await db.query("select * from list_retired_group_note_media($1)",[deletedGroup])).rows.some((row)=>row.path===deletionPath),true);
  await db.exec("reset role"); await db.query("delete from groups where id=$1",[deletedGroup]);
  assert.equal(await scalar("select group_id from group_note_media_links where path=$1",[deletionPath]),null);
  await asUser(owner);
  await rejects(save(null,null,"Reuse in other group",deletionPath,"No",otherGroup),/already_used/);
  await rejects(db.query("insert into messages(group_id,sender_id,image_path) values($1,$2,$3)",[otherGroup,owner,deletionPath]),/group_note_image_retired/);
  assert.equal(await scalar("select can_upload_staged_group_note_image($1)",[deletionPath]),false);
  assert.equal((await db.query("select * from list_retired_group_note_media($1)",[otherGroup])).rows.some((row)=>row.path===deletionPath),true);
  await db.exec("reset role");

  // Large backlogs are processed in bounded batches, never an unbounded array.
  await db.query("insert into group_note_media_links(path,note_id,group_id,uploader_id,retired_at,retired_by) select $1 || '/account/group-note/backlog-'||n||'.jpg',gen_random_uuid(),$2,$3,now(),$3 from generate_series(1,1205)n",[owner,group,owner]);
  await db.query("insert into storage.objects select 'paceboard-media',path from group_note_media_links where path like '%/backlog-%'");
  await asUser(owner);
  assert.equal(await scalar("select count(*) from list_retired_group_note_media($1)",[group]),100);
  await db.exec("reset role; set request.jwt.claim.sub=''; set role anon;");
  await rejects(db.query("select * from list_retired_group_note_media($1)",[group]),/permission denied/);
  await rejects(db.query("select * from group_note_media_links"),/permission denied/);
  console.log("Group note images: CAS/legacy compatibility, creator/admin uploader binding, signed-URL membership/block privacy, replacement/removal/deletion/reset, shared-reference fencing, safe ambiguous-save cleanup and 1,205-image bounded backlog passed.");
} finally { await db.close(); }
