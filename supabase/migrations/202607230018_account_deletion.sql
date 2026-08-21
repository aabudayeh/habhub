-- Auth user deletion cascades through profiles, but an owned group previously
-- blocked that cascade through groups.owner_id. Transfer an owned group to its
-- oldest active member, or remove the empty group, before the profile vanishes.
create or replace function public.prepare_profile_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owned_group record;
  successor_id uuid;
begin
  for owned_group in
    select id from public.groups where owner_id = old.id
  loop
    select member.user_id
      into successor_id
      from public.group_members as member
      where member.group_id = owned_group.id
        and member.user_id <> old.id
        and member.status = 'active'
      order by
        case when member.role = 'admin' then 0 else 1 end,
        member.joined_at
      limit 1;

    if successor_id is null then
      delete from public.groups where id = owned_group.id;
    else
      update public.groups
        set owner_id = successor_id, updated_at = now()
        where id = owned_group.id;
      update public.group_members
        set role = 'owner'
        where group_id = owned_group.id and user_id = successor_id;
    end if;
    successor_id := null;
  end loop;

  return old;
end;
$$;

drop trigger if exists profiles_prepare_deletion on public.profiles;
create trigger profiles_prepare_deletion
before delete on public.profiles
for each row execute function public.prepare_profile_deletion();
