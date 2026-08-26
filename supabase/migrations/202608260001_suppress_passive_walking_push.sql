-- Calculated step-difference energy changes continuously as health data lands.
-- It remains visible as an exact shared entry, but it is not a user-authored
-- log and must not create a group push or a lead-change alert on every refresh.
create or replace function public.emit_group_metric_push_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_metric_slug text;
  v_metric_name text;
  v_member_name text;
  v_event_key text;
  v_data jsonb;
begin
  -- These high-frequency passive rows must leave before even looking up the
  -- metric definition. Besides preventing alerts, this keeps the trigger
  -- effectively constant-cost while the calculated value changes all day.
  if new.source_provider = 'google_health'
     or (
       new.source = 'calculated'
       and new.label = 'Estimated unrecorded walking from steps'
     ) then
    return new;
  end if;

  select definition.group_id, definition.slug, definition.name
    into v_group_id, v_metric_slug, v_metric_name
    from public.metric_definitions definition
   where definition.id = new.metric_id
     and definition.group_id is not null;
  if v_group_id is null
     or new.visibility = 'private'
     or new.recorded_at < now() - interval '15 minutes'
     or not exists (
       select 1 from public.group_members membership
        where membership.group_id = v_group_id
          and membership.user_id = new.user_id
          and membership.status = 'active'
     ) then
    return new;
  end if;
  select profile.display_name into v_member_name
    from public.profiles profile where profile.id = new.user_id;

  v_event_key := case
    when char_length(
      'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
        new.client_generated_id
    ) <= 240 then
      'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
        new.client_generated_id
    else
      'entry:' || v_group_id::text || ':' || new.user_id::text || ':' ||
        pg_catalog.md5(new.client_generated_id)
  end;
  v_data := jsonb_build_object(
    'route', '/day/' || new.local_date::text,
    'groupId', v_group_id,
    'metricId', v_metric_slug,
    'entryId', new.client_generated_id
  );

  insert into public.push_dispatch_events (
    event_key,
    group_id,
    dispatcher_id,
    category,
    event_type,
    audience,
    metric_slug,
    title,
    body,
    data,
    expires_at
  ) values (
    v_event_key,
    v_group_id,
    new.user_id,
    'metric',
    'metric_entry',
    'group',
    v_metric_slug,
    left(coalesce(v_member_name, 'A member') || ' logged ' || v_metric_name, 120),
    'A shared ' || v_metric_name || ' update was added.',
    v_data,
    now() + interval '30 minutes'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.emit_group_metric_push_event()
  from public, anon, authenticated;

create or replace function public.enqueue_group_lead_push_event(
  p_group_id uuid,
  p_metric_slug text,
  p_source_entry_ids text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_metric_id uuid;
  v_metric_name text;
  v_ids text[];
  v_entry_id uuid;
  v_source text;
  v_source_provider text;
  v_label text;
  v_latest timestamptz;
  v_event_key text;
begin
  if v_user_id is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  select array_agg(distinct source_id order by source_id)
    into v_ids
    from unnest(coalesce(p_source_entry_ids, array[]::text[]))
      source(source_id)
   where nullif(source_id, '') is not null;
  if cardinality(coalesce(v_ids, array[]::text[])) <> 1 then
    raise exception 'Exactly one committed source entry is required.'
      using errcode = '22023';
  end if;
  select definition.id, definition.name
    into v_metric_id, v_metric_name
    from public.metric_definitions definition
   where definition.group_id = p_group_id
     and definition.slug = p_metric_slug
     and definition.archived_at is null;
  if v_metric_id is null then
    raise exception 'Group tracker not found.' using errcode = 'P0002';
  end if;
  select entry.id, entry.source, entry.source_provider, entry.label,
         entry.updated_at
    into v_entry_id, v_source, v_source_provider, v_label, v_latest
    from public.metric_entries entry
   where entry.metric_id = v_metric_id
     and entry.user_id = v_user_id
     and entry.visibility = 'group'
     and entry.client_generated_id = any(v_ids)
     and entry.updated_at >= now() - interval '30 minutes';
  if v_source_provider = 'google_health'
     or (
       v_source = 'calculated'
       and v_label = 'Estimated unrecorded walking from steps'
     ) then
    return null;
  end if;
  if v_entry_id is null then
    raise exception 'Every source entry must be a fresh committed shared row.'
      using errcode = '42501';
  end if;
  v_event_key := 'lead:' || p_group_id::text || ':' || v_user_id::text || ':' ||
    v_entry_id::text || ':' ||
    floor(extract(epoch from v_latest) * 1000)::bigint::text;

  insert into public.push_dispatch_events (
    event_key, group_id, dispatcher_id, category, event_type, audience,
    metric_slug, title, body, data, expires_at
  ) values (
    v_event_key,
    p_group_id,
    v_user_id,
    'lead',
    'leaderboard_activity',
    'group_including_sender',
    p_metric_slug,
    'Lead changed',
    left(
      'New ' || v_metric_name ||
        ' activity changed first place. Open the Leaderboard for the latest standings.',
      500
    ),
    jsonb_build_object(
      'route', '/group',
      'groupId', p_group_id,
      'metricId', p_metric_slug
    ),
    now() + interval '30 minutes'
  ) on conflict (event_key) do nothing;
  return v_event_key;
end;
$$;

revoke all on function public.enqueue_group_lead_push_event(uuid, text, text[])
  from public, anon;
grant execute on function public.enqueue_group_lead_push_event(uuid, text, text[])
  to authenticated;

-- Bootstrap the small set of imported rows that were intentionally published
-- with item-level detail. The client calls this once per account/group process,
-- then reconciles only these ids when a note, photo, nutrition payload, or named
-- workout is removed. This avoids both stale shared detail and repeated scans of
-- high-frequency compact sensor rows.
create or replace function public.list_owned_detailed_imported_metric_entry_ids(
  p_group_id uuid
)
returns table(client_generated_id text)
language sql
stable
security invoker
set search_path = ''
as $$
  select entry.client_generated_id
    from public.metric_entries entry
    join public.metric_definitions definition
      on definition.id = entry.metric_id
   where entry.user_id = (select auth.uid())
     and definition.group_id = p_group_id
     and entry.source = 'imported'
     and entry.visibility = 'group'
     and (
       entry.image_path is not null
       or entry.nutrition is not null
       or (
         entry.note is not null
         and not (
           entry.source_origin is not null
           and entry.note like 'Synced from %'
           and entry.note not like '% · %'
         )
       )
       or (
         entry.label is not null
         and (
           definition.slug in (
             'food', 'workout', 'workout_duration', 'workout_distance', 'exercise'
           )
           or definition.configuration ->> 'category' = 'gym'
         )
       )
     );
$$;

revoke all on function public.list_owned_detailed_imported_metric_entry_ids(uuid)
  from public, anon;
grant execute on function public.list_owned_detailed_imported_metric_entry_ids(uuid)
  to authenticated;

-- Remove only still-pending passive alerts emitted by older trigger versions.
-- Successfully dispatched history is retained as an audit trail.
delete from public.push_dispatch_events event
using public.metric_entries entry
where event.dispatched_at is null
  and event.event_type = 'metric_entry'
  and entry.user_id = event.dispatcher_id
  and entry.source = 'calculated'
  and entry.label = 'Estimated unrecorded walking from steps'
  and event.data ->> 'entryId' = entry.client_generated_id;

delete from public.push_dispatch_events event
using public.metric_entries entry, public.metric_definitions definition
where event.dispatched_at is null
  and event.category = 'lead'
  and event.event_type = 'leaderboard_activity'
  and entry.metric_id = definition.id
  and definition.group_id = event.group_id
  and definition.slug = event.metric_slug
  and entry.user_id = event.dispatcher_id
  and entry.source = 'calculated'
  and entry.label = 'Estimated unrecorded walking from steps'
  and event.event_key like (
    'lead:' || event.group_id::text || ':' || entry.user_id::text || ':' ||
      entry.id::text || ':%'
  );
