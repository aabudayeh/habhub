alter table public.group_members
  add column if not exists status text not null default 'active'
  check (status in ('pending', 'active'));

create or replace function public.is_group_member(target_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members
    where group_id = target_group_id and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_group_admin(target_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members
    where group_id = target_group_id and user_id = auth.uid()
      and status = 'active' and role in ('owner', 'admin'));
$$;

create or replace function public.shares_group_with(target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = target_user_id and theirs.status = 'active');
$$;

create or replace function public.can_review_membership(target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members pending
    join public.group_members reviewer on reviewer.group_id = pending.group_id
    where pending.user_id = target_user_id and pending.status = 'pending'
      and reviewer.user_id = auth.uid() and reviewer.status = 'active'
      and reviewer.role in ('owner', 'admin'));
$$;

drop policy if exists members_group_read on public.group_members;
create policy members_group_read on public.group_members for select to authenticated
using (user_id = auth.uid() or public.is_group_member(group_id) or public.is_group_admin(group_id));

create policy profiles_membership_reviewer_read on public.profiles for select to authenticated
using (public.can_review_membership(id));

create or replace function public.request_group_membership(code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.groups%rowtype; requested_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into target from public.groups where upper(invite_code) = upper(trim(code));
  if target.id is null then raise exception 'Invalid invite code'; end if;
  requested_status := case
    when coalesce((target.settings ->> 'requireMemberApproval')::boolean, false) then 'pending'
    else 'active'
  end;
  insert into public.group_members (group_id, user_id, role, status)
  values (target.id, auth.uid(), 'member', requested_status)
  on conflict (group_id, user_id) do update set
    status = case when public.group_members.status = 'active' then 'active' else excluded.status end;
  select status into requested_status from public.group_members
    where group_id = target.id and user_id = auth.uid();
  return jsonb_build_object('groupId', target.id, 'status', requested_status);
end;
$$;

revoke all on function public.request_group_membership(text) from public;
grant execute on function public.request_group_membership(text) to authenticated;
