-- Return the exact trigger-created social push event to the actor. Current
-- clients can dispatch that one canonical row immediately, like chat, instead
-- of waiting behind a broad foreground outbox scan. Older clients keep using
-- the existing functions and the durable worker remains the retry backstop.

create or replace function public.set_group_social_reaction_v2(
  p_group_id uuid,
  p_target_type text,
  p_target_id text,
  p_reaction text,
  p_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.group_social_reactions%rowtype;
  v_event_key text;
begin
  v_row := public.set_group_social_reaction(
    p_group_id,
    p_target_type,
    p_target_id,
    p_reaction,
    p_surface
  );
  if p_reaction is not null and v_row.user_id = auth.uid() then
    v_event_key := 'social-reaction:' || v_row.group_id::text || ':' ||
      pg_catalog.md5(v_row.target_type || ':' || v_row.target_id) || ':' ||
      v_row.user_id::text || ':' ||
      floor(extract(epoch from v_row.updated_at) * 1000000)::bigint::text;
    if not exists (
      select 1
        from public.push_dispatch_events event
       where event.event_key = v_event_key
         and event.dispatcher_id = auth.uid()
    ) then
      v_event_key := null;
    end if;
  end if;
  return jsonb_build_object(
    'reaction', case when v_row is null then null else to_jsonb(v_row) end,
    'push_event_key', v_event_key
  );
end;
$$;

revoke all on function public.set_group_social_reaction_v2(
  uuid, text, text, text, text
) from public, anon;
grant execute on function public.set_group_social_reaction_v2(
  uuid, text, text, text, text
) to authenticated;

create or replace function public.add_group_social_comment_v2(
  p_group_id uuid,
  p_target_type text,
  p_target_id text,
  p_content text,
  p_surface text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_row public.group_social_comments%rowtype;
  v_event_key text;
begin
  if v_actor_id is null then
    raise exception 'Sign in to comment on a shared item.'
      using errcode = '42501';
  end if;
  if p_surface not in ('feed', 'leaderboard_log') then
    raise exception 'That interaction surface is invalid.'
      using errcode = '22023';
  end if;
  if not (char_length(btrim(coalesce(p_content, ''))) between 1 and 1000) then
    raise exception 'Comments must be between 1 and 1000 characters.'
      using errcode = '22023';
  end if;

  -- Existing table RLS and constraints remain the authorization boundary.
  insert into public.group_social_comments (
    group_id, target_type, target_id, user_id, content, source_surface
  ) values (
    p_group_id, p_target_type, p_target_id, v_actor_id,
    btrim(p_content), p_surface
  ) returning * into v_row;

  v_event_key := 'social-comment:' || v_row.id::text;
  if not exists (
    select 1
      from public.push_dispatch_events event
     where event.event_key = v_event_key
       and event.dispatcher_id = v_actor_id
  ) then
    v_event_key := null;
  end if;
  return jsonb_build_object(
    'comment', to_jsonb(v_row),
    'push_event_key', v_event_key
  );
end;
$$;

revoke all on function public.add_group_social_comment_v2(
  uuid, text, text, text, text
) from public, anon;
grant execute on function public.add_group_social_comment_v2(
  uuid, text, text, text, text
) to authenticated;

-- Surface-only changes are rare, but they still change the requested return
-- destination and therefore need the same canonical trigger path.
drop trigger if exists group_social_reactions_emit_notification
  on public.group_social_reactions;
create trigger group_social_reactions_emit_notification
after insert or update of reaction, source_surface on public.group_social_reactions
for each row execute function public.emit_group_social_reaction_notification();

notify pgrst, 'reload schema';
