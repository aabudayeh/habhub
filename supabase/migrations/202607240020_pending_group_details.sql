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
    status = case
      when public.group_members.status = 'active' then 'active'
      else excluded.status
    end;
  select status into requested_status from public.group_members
    where group_id = target.id and user_id = auth.uid();
  return jsonb_build_object(
    'groupId', target.id,
    'groupName', target.name,
    'status', requested_status
  );
end;
$$;

revoke all on function public.request_group_membership(text) from public;
grant execute on function public.request_group_membership(text) to authenticated;
