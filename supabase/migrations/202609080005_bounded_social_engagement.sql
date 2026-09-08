-- Exact, viewer-authorized counts with a bounded comment preview. A busy
-- target must never consume a shared 1,000-row budget or hide another target.
-- Both functions deliberately run as the caller: existing membership, target
-- privacy, deletion fences and blocked-user RLS apply to counts and content.
create index if not exists group_social_comments_cursor_idx
  on public.group_social_comments (group_id, target_type, target_id, created_at desc, id desc);

create or replace function public.list_group_social_comments_page(
  p_group_id uuid,
  p_target_type text,
  p_target_id text,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_result jsonb;
begin
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Both comment cursor fields are required.' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.is_group_member(p_group_id)
     or not public.valid_group_social_target(p_group_id, p_target_type, p_target_id) then
    return jsonb_build_object('comments', '[]'::jsonb, 'has_more', false);
  end if;
  with page as materialized (
    select c.id, c.group_id, c.target_type, c.target_id, c.user_id,
           c.content, c.created_at, c.updated_at
      from public.group_social_comments c
     where c.group_id = p_group_id and c.target_type = p_target_type
       and c.target_id = p_target_id
       and (p_before_created_at is null or
            (c.created_at, c.id) < (p_before_created_at, p_before_id))
     order by c.created_at desc, c.id desc
     limit v_limit + 1
  ), visible_page as (
    select * from page order by created_at desc, id desc limit v_limit
  )
  select jsonb_build_object(
    'comments', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
                           from visible_page c), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from page)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_group_social_engagement(
  p_group_id uuid,
  p_targets jsonb,
  p_include_comments boolean default true
)
returns table (
  target_type text,
  target_id text,
  reaction_counts jsonb,
  own_reaction jsonb,
  comment_count bigint,
  comments jsonb,
  has_more_comments boolean
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if jsonb_typeof(p_targets) is distinct from 'array'
     or jsonb_array_length(p_targets) > 20 then
    raise exception 'Request between zero and twenty social targets.' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.is_group_member(p_group_id) then return; end if;
  return query
  with targets as materialized (
    select distinct t.type, t.id
      from jsonb_to_recordset(p_targets) as t(type text, id text)
     where char_length(t.id) between 1 and 240
       and public.valid_group_social_target(p_group_id, t.type, t.id)
  )
  select t.type, t.id,
         r.counts, r.mine,
         case when p_include_comments then
           (select count(*) from public.group_social_comments c
             where c.group_id = p_group_id and c.target_type = t.type and c.target_id = t.id)
           else 0::bigint end,
         coalesce(preview.value->'comments', '[]'::jsonb),
         coalesce((preview.value->>'has_more')::boolean, false)
    from targets t
    cross join lateral (
      select jsonb_build_object(
               'heart', count(*) filter (where rrow.reaction = 'heart'),
               'cheer', count(*) filter (where rrow.reaction = 'cheer'),
               'thumbs_up', count(*) filter (where rrow.reaction = 'thumbs_up'),
               'thumbs_down', count(*) filter (where rrow.reaction = 'thumbs_down')) as counts,
             (jsonb_agg(to_jsonb(rrow)) filter (where rrow.user_id = auth.uid()))->0 as mine
        from public.group_social_reactions rrow
       where rrow.group_id = p_group_id
         and rrow.target_type = t.type and rrow.target_id = t.id
    ) r
    left join lateral (
      select public.list_group_social_comments_page(p_group_id, t.type, t.id) as value
       where p_include_comments
    ) preview on true;
end;
$$;

revoke all on function public.list_group_social_comments_page(uuid, text, text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_group_social_engagement(uuid, jsonb, boolean) from public, anon;
grant execute on function public.list_group_social_comments_page(uuid, text, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_group_social_engagement(uuid, jsonb, boolean) to authenticated;
