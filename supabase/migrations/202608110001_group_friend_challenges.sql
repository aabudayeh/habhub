-- Explicitly invited, dated group challenges. Progress remains in the existing
-- privacy-aware activity read model; this table stores no health measurements.
create table if not exists public.group_challenges (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  metric_slug text not null,
  title text,
  target_value numeric not null check (target_value > 0 and target_value <= 1000000000000),
  local_date date not null,
  participant_ids uuid[] not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (title is null or char_length(btrim(title)) between 1 and 80),
  check (cardinality(participant_ids) >= 2),
  check (creator_id = any(participant_ids))
);

create index if not exists group_challenges_group_date_idx
  on public.group_challenges (group_id, local_date desc, created_at desc)
  where deleted_at is null;
create index if not exists group_challenges_participants_idx
  on public.group_challenges using gin (participant_ids);

drop trigger if exists group_challenges_touch_updated_at
  on public.group_challenges;
create trigger group_challenges_touch_updated_at
before update on public.group_challenges
for each row execute function public.touch_updated_at();

alter table public.group_challenges enable row level security;

drop policy if exists group_challenges_invited_read
  on public.group_challenges;
create policy group_challenges_invited_read
on public.group_challenges
for select
to authenticated
using (
  auth.uid() = any(participant_ids)
  and public.is_group_member(group_id)
);

-- Clients deliberately have no direct write grant. The functions below keep
-- member lists, tracker eligibility, and creator/admin permissions atomic.
revoke all on table public.group_challenges from public, anon, authenticated;
grant select on table public.group_challenges to authenticated;

create or replace function public.save_group_challenge(
  p_challenge_id uuid,
  p_group_id uuid,
  p_metric_slug text,
  p_title text,
  p_target_value numeric,
  p_local_date date,
  p_participant_ids uuid[]
)
returns public.group_challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_participants uuid[];
  v_existing public.group_challenges;
  v_saved public.group_challenges;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if p_challenge_id is not null then
    select * into v_existing
      from public.group_challenges challenge
     where challenge.id = p_challenge_id
       and challenge.deleted_at is null
     for update;
    if not found or v_existing.group_id <> p_group_id then
      raise exception 'Challenge not found.' using errcode = 'P0002';
    end if;
    if v_existing.creator_id <> v_user_id and not public.is_group_admin(p_group_id) then
      raise exception 'Only the creator or a group administrator can edit this challenge.'
        using errcode = '42501';
    end if;
  end if;
  if p_target_value is null or p_target_value <= 0 or p_target_value > 1000000000000 then
    raise exception 'Challenge target must be greater than zero.' using errcode = '22023';
  end if;
  if p_local_date is null then
    raise exception 'Challenge date is required.' using errcode = '22023';
  end if;
  if p_title is not null and (char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 80) then
    raise exception 'Challenge title must contain 1 to 80 characters.' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.metric_definitions definition
     where definition.group_id = p_group_id
       and definition.slug = p_metric_slug
       and definition.archived_at is null
       and definition.data_type in ('number', 'calculated')
       and coalesce(definition.configuration #>> '{sections,group}', 'true') = 'true'
  ) then
    raise exception 'Choose an active numerical group tracker.' using errcode = '22023';
  end if;

  if p_challenge_id is not null then
    -- Keep the invited audience immutable. Removing a participant would also
    -- remove their RLS visibility before Realtime could invalidate the card.
    -- A different audience is represented by a new challenge instead.
    v_participants := v_existing.participant_ids;
  else
    select coalesce(array_agg(candidate.user_id order by candidate.user_id), array[]::uuid[])
      into v_participants
      from (
        select distinct requested.user_id
          from unnest(coalesce(p_participant_ids, array[]::uuid[]) || array[v_user_id])
            as requested(user_id)
         where requested.user_id is not null
      ) candidate;

    if cardinality(v_participants) < 2 or cardinality(v_participants) > 50 then
      raise exception 'Choose between 1 and 49 friends.' using errcode = '22023';
    end if;

    select count(*)
      into v_active_count
      from public.group_members member
     where member.group_id = p_group_id
       and member.status = 'active'
       and member.user_id = any(v_participants);
    if v_active_count <> cardinality(v_participants) then
      raise exception 'Every invited person must be an active group member.' using errcode = '22023';
    end if;
  end if;

  if p_challenge_id is not null then
    update public.group_challenges
       set metric_slug = p_metric_slug,
           title = nullif(btrim(p_title), ''),
           target_value = p_target_value,
           local_date = p_local_date,
           participant_ids = v_participants
     where id = p_challenge_id
     returning * into v_saved;
  else
    insert into public.group_challenges (
      group_id, creator_id, metric_slug, title, target_value, local_date,
      participant_ids
    ) values (
      p_group_id, v_user_id, p_metric_slug, nullif(btrim(p_title), ''),
      p_target_value, p_local_date, v_participants
    ) returning * into v_saved;
  end if;
  return v_saved;
end;
$$;

create or replace function public.delete_group_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_challenge public.group_challenges;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_challenge
    from public.group_challenges challenge
   where challenge.id = p_challenge_id
     and challenge.deleted_at is null
   for update;
  if not found then return; end if;
  if not public.is_group_member(v_challenge.group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if v_challenge.creator_id <> v_user_id
     and not public.is_group_admin(v_challenge.group_id) then
    raise exception 'Only the creator or a group administrator can delete this challenge.'
      using errcode = '42501';
  end if;
  -- A soft delete gives every invited device a policy-authorized UPDATE
  -- invalidation. It avoids relying on filtered DELETE payload behavior.
  update public.group_challenges
     set deleted_at = now()
   where id = p_challenge_id;
end;
$$;

revoke all on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, uuid[]
) from public, anon;
grant execute on function public.save_group_challenge(
  uuid, uuid, text, text, numeric, date, uuid[]
) to authenticated;
revoke all on function public.delete_group_challenge(uuid) from public, anon;
grant execute on function public.delete_group_challenge(uuid) to authenticated;

-- Postgres Changes applies the policy above per subscriber, so members never
-- receive invalidations for challenges to which they were not invited.
do $$
begin
  alter publication supabase_realtime add table public.group_challenges;
exception when duplicate_object then null;
end;
$$;
