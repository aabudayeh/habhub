-- PostgreSQL does not define min(uuid). The challenge-result branch used that
-- unsupported aggregate even though HAVING count(*) = 1 already guarantees an
-- unambiguous winner. Use array_agg to retain the single canonical UUID while
-- preserving the tie-suppression rule.
create or replace function public.resolve_group_social_notification_target(
  p_group_id uuid,
  p_target_type text,
  p_target_id text
)
returns table (
  recipient_id uuid,
  metric_slug text,
  item_label text,
  occurrence_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target_uuid uuid;
  v_target_date date;
  v_target_event text;
begin
  if not public.valid_group_social_target(
    p_group_id,
    p_target_type,
    p_target_id
  ) then
    return;
  end if;

  if p_target_type = 'metric_entry' then
    return query
      select entry.user_id, definition.slug, definition.name, entry.local_date
        from public.metric_entries entry
        join public.metric_definitions definition
          on definition.id = entry.metric_id
       where definition.group_id = p_group_id
         and entry.id = public.resolve_group_social_metric_entry_id(
           p_group_id,
           p_target_id
         )
       limit 1;
  elsif p_target_type = 'photo_update' then
    return query
      select photo.owner_user_id, 'photos'::text, 'photo'::text,
             photo.local_date
        from public.photo_updates photo
       where photo.group_id = p_group_id
         and photo.client_generated_id = p_target_id
         and photo.visibility = 'group'
       order by photo.created_at desc
       limit 1;
  elsif p_target_type = 'badge' then
    -- Badges are derived on-device and do not have a canonical earned row.
    return;
  elsif p_target_type = 'group_challenge' then
    begin
      v_target_uuid := split_part(p_target_id, ':', 1)::uuid;
      v_target_date := split_part(p_target_id, ':', 2)::date;
      v_target_event := split_part(p_target_id, ':', 3);
    exception when others then
      return;
    end;
    if v_target_event = 'result' then
      -- Notify only one server-owned winner. Ties intentionally resolve to no
      -- recipient, matching the result card's unambiguous-winner rule.
      return query
        select (array_agg(placement.user_id))[1],
               challenge.metric_slug,
               coalesce(nullif(btrim(challenge.title), ''), 'challenge'),
               case
                 when challenge.recurrence is null
                      or coalesce(challenge.recurrence ->> 'mode', 'once') = 'once'
                   then challenge.end_date
                 else v_target_date
               end
          from public.group_challenges challenge
          join public.group_challenge_result_placements placement
            on placement.challenge_id = challenge.id
           and placement.occurrence_date = v_target_date
           and placement.winner = true
         where challenge.id = v_target_uuid
           and challenge.group_id = p_group_id
           and challenge.deleted_at is null
         group by challenge.metric_slug, challenge.title,
                  challenge.recurrence, challenge.end_date
        having count(*) = 1;
    else
      return query
        select challenge.creator_id,
               challenge.metric_slug,
               coalesce(nullif(btrim(challenge.title), ''), 'challenge'),
               v_target_date
          from public.group_challenges challenge
         where challenge.id = v_target_uuid
           and challenge.group_id = p_group_id
           and challenge.deleted_at is null
         limit 1;
    end if;
  elsif p_target_type = 'group_todo' then
    begin
      v_target_uuid := p_target_id::uuid;
    exception when others then
      return;
    end;
    return query
      select todo.creator_id, null::text, 'group to-do'::text,
             todo.created_at::date
        from public.group_todos todo
       where todo.id = v_target_uuid
         and todo.group_id = p_group_id
       limit 1;
  elsif p_target_type = 'recap_feed' then
    if p_target_id like 'leader:____-__-__' then return; end if;
    begin
      v_target_uuid := split_part(p_target_id, ':', 2)::uuid;
      v_target_date := split_part(p_target_id, ':', 3)::date;
    exception when others then
      return;
    end;
    if p_target_id <> (
         'leader:' || v_target_uuid::text || ':' || v_target_date::text
       )
       or public.resolve_group_social_daily_leader(
         p_group_id,
         v_target_date
       ) is distinct from v_target_uuid then
      return;
    end if;
    return query
      select v_target_uuid, null::text, 'daily-leader update'::text,
             v_target_date;
  end if;
end;
$$;

revoke all on function public.resolve_group_social_notification_target(
  uuid, text, text
) from public, anon, authenticated;

comment on function public.resolve_group_social_notification_target(
  uuid, text, text
) is
  'Resolves a shared social target to one server-owned notification recipient; challenge result ties intentionally return no recipient.';
