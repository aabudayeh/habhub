-- Optional shared challenge art. The relational row stores only a vetted icon
-- name and/or a private-bucket path; signed URLs never enter durable state.
alter table public.group_challenges
  add column if not exists visual_icon text,
  add column if not exists visual_image_path text;

alter table public.group_challenges
  drop constraint if exists group_challenges_visual_icon_valid,
  drop constraint if exists group_challenges_visual_image_path_valid;

alter table public.group_challenges
  add constraint group_challenges_visual_icon_valid check (
    visual_icon is null or visual_icon = any (array[
      'trophy-outline', 'flag-outline', 'ribbon-outline', 'star-outline',
      'flame-outline', 'flash-outline', 'walk-outline', 'fitness-outline',
      'bicycle-outline', 'nutrition-outline'
    ]::text[])
  ),
  add constraint group_challenges_visual_image_path_valid check (
    visual_image_path is null or (
      char_length(visual_image_path) between 20 and 240
      and visual_image_path !~ '[[:space:]]'
      and visual_image_path not like '%..%'
    )
  );

create unique index if not exists group_challenges_visual_image_path_uidx
  on public.group_challenges (visual_image_path)
  where visual_image_path is not null;

-- Discovery RPCs intentionally expose bounded metadata rather than the full
-- participant arrays. Fetch their visual fields with the same authorization
-- boundary instead of widening table RLS or duplicating both discovery RPCs.
create or replace function public.list_challenge_visuals(
  p_challenge_ids uuid[]
)
returns table (
  id uuid,
  visual_icon text,
  visual_image_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_challenge_ids is null
     or cardinality(p_challenge_ids) = 0
     or cardinality(p_challenge_ids) > 500 then
    raise exception 'Choose between 1 and 500 challenges.' using errcode = '22023';
  end if;

  return query
  select challenge.id,
         challenge.visual_icon,
         challenge.visual_image_path
    from public.group_challenges challenge
   where challenge.id = any(p_challenge_ids)
     and challenge.deleted_at is null
     and (
       challenge.audience = 'public'
       or public.is_group_member(challenge.group_id)
       or v_user_id = any(challenge.participant_ids)
     );
end;
$$;

revoke all on function public.list_challenge_visuals(uuid[])
  from public, anon, authenticated;
grant execute on function public.list_challenge_visuals(uuid[])
  to authenticated;

-- Old clients retain the established signatures. New clients select these
-- overloads by sending the two extra named arguments; the established save
-- function still performs every group/tracker/date/roster permission check.
create or replace function public.save_group_challenge(
  p_challenge_id uuid,
  p_group_id uuid,
  p_metric_slug text,
  p_title text,
  p_target_value numeric,
  p_local_date date,
  p_end_date date,
  p_participant_ids uuid[],
  p_recurrence jsonb,
  p_visual_icon text,
  p_visual_image_path text
)
returns public.group_challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_saved public.group_challenges;
  v_prefix text;
begin
  v_saved := public.save_group_challenge(
    p_challenge_id, p_group_id, p_metric_slug, p_title, p_target_value,
    p_local_date, p_end_date, p_participant_ids, p_recurrence
  );
  if p_visual_icon is not null and p_visual_icon <> all (array[
    'trophy-outline', 'flag-outline', 'ribbon-outline', 'star-outline',
    'flame-outline', 'flash-outline', 'walk-outline', 'fitness-outline',
    'bicycle-outline', 'nutrition-outline'
  ]::text[]) then
    raise exception 'Challenge icon is invalid.' using errcode = '22023';
  end if;
  if p_visual_image_path is not null
     and p_visual_image_path is distinct from v_saved.visual_image_path then
    v_prefix := v_user_id::text || '/account/challenge/';
    if p_visual_image_path not like (v_prefix || '%')
       or lower(p_visual_image_path) !~ '\.(jpg|jpeg|png|webp|heic)$'
       or not exists (
         select 1 from storage.objects object
          where object.bucket_id = 'paceboard-media'
            and object.name = p_visual_image_path
       )
       or exists (
         select 1 from public.group_challenges challenge
          where challenge.visual_image_path = p_visual_image_path
            and challenge.id <> v_saved.id
       ) then
      raise exception 'Challenge image path is invalid.' using errcode = '22023';
    end if;
  end if;
  update public.group_challenges
     set visual_icon = p_visual_icon,
         visual_image_path = p_visual_image_path
   where id = v_saved.id
   returning * into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, date, uuid[], jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, date, uuid[], jsonb, text, text
) to authenticated;

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
  p_participant_limit integer,
  p_visual_icon text,
  p_visual_image_path text
)
returns public.group_challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_saved public.group_challenges;
  v_prefix text;
begin
  v_saved := public.save_public_challenge(
    p_challenge_id, p_group_id, p_metric_slug, p_title, p_target_value,
    p_local_date, p_end_date, p_participant_ids, p_recurrence,
    p_participant_limit
  );
  if p_visual_icon is not null and p_visual_icon <> all (array[
    'trophy-outline', 'flag-outline', 'ribbon-outline', 'star-outline',
    'flame-outline', 'flash-outline', 'walk-outline', 'fitness-outline',
    'bicycle-outline', 'nutrition-outline'
  ]::text[]) then
    raise exception 'Challenge icon is invalid.' using errcode = '22023';
  end if;
  if p_visual_image_path is not null
     and p_visual_image_path is distinct from v_saved.visual_image_path then
    v_prefix := v_user_id::text || '/account/challenge/';
    if p_visual_image_path not like (v_prefix || '%')
       or lower(p_visual_image_path) !~ '\.(jpg|jpeg|png|webp|heic)$'
       or not exists (
         select 1 from storage.objects object
          where object.bucket_id = 'paceboard-media'
            and object.name = p_visual_image_path
       )
       or exists (
         select 1 from public.group_challenges challenge
          where challenge.visual_image_path = p_visual_image_path
            and challenge.id <> v_saved.id
       ) then
      raise exception 'Challenge image path is invalid.' using errcode = '22023';
    end if;
  end if;
  update public.group_challenges
     set visual_icon = p_visual_icon,
         visual_image_path = p_visual_image_path
   where id = v_saved.id
   returning * into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.save_public_challenge(
  uuid, uuid, text, text, numeric, date, date, uuid[], jsonb, integer,
  text, text
) from public, anon, authenticated;
grant execute on function public.save_public_challenge(
  uuid, uuid, text, text, numeric, date, date, uuid[], jsonb, integer,
  text, text
) to authenticated;

-- Challenge media remains in the existing private bucket. This predicate adds
-- only public-challenge or active-group challenge metadata to the established
-- owner/photo/entry/message/avatar authorization policy.
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
    );
$$;

revoke all on function public.can_read_challenge_media_object(text)
  from public, anon, authenticated;
grant execute on function public.can_read_challenge_media_object(text)
  to authenticated;

drop policy if exists media_storage_owner_read on storage.objects;
drop policy if exists media_storage_authorized_read on storage.objects;
create policy media_storage_authorized_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'paceboard-media'
  and (
    public.can_read_media_object(name)
    or public.can_read_challenge_media_object(name)
  )
);
