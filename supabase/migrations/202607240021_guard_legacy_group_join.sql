create or replace function public.join_group_with_code(code text)
returns uuid language plpgsql security definer set search_path = '' as $$
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
  return target.id;
end;
$$;

revoke all on function public.join_group_with_code(text) from public;
grant execute on function public.join_group_with_code(text) to authenticated;
