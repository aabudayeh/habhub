-- Preserve the exact union of each existing SELECT authorization while making
-- Postgres evaluate only one permissive SELECT policy per table.  Former ALL
-- policies are split by write command so they no longer overlap SELECT.

-- Group automation: every active member may read; only administrators write.
drop policy if exists automation_member_read on public.automation_rules;
drop policy if exists automation_admin_all on public.automation_rules;
drop policy if exists automation_authorized_read on public.automation_rules;
drop policy if exists automation_admin_insert on public.automation_rules;
drop policy if exists automation_admin_update on public.automation_rules;
drop policy if exists automation_admin_delete on public.automation_rules;

create policy automation_authorized_read
on public.automation_rules for select to authenticated
using (
  public.is_group_member(group_id)
  or public.is_group_admin(group_id)
);
create policy automation_admin_insert
on public.automation_rules for insert to authenticated
with check (public.is_group_admin(group_id));
create policy automation_admin_update
on public.automation_rules for update to authenticated
using (public.is_group_admin(group_id))
with check (public.is_group_admin(group_id));
create policy automation_admin_delete
on public.automation_rules for delete to authenticated
using (public.is_group_admin(group_id));

-- Badge showcases: owners retain their former owner-read access, while every
-- group member retains the existing group-read access.
drop policy if exists badge_showcases_group_read on public.badge_showcases;
drop policy if exists badge_showcases_owner_write on public.badge_showcases;
drop policy if exists badge_showcases_authorized_read on public.badge_showcases;
drop policy if exists badge_showcases_owner_insert on public.badge_showcases;
drop policy if exists badge_showcases_owner_update on public.badge_showcases;
drop policy if exists badge_showcases_owner_delete on public.badge_showcases;

create policy badge_showcases_authorized_read
on public.badge_showcases for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.group_members membership
    where membership.group_id = badge_showcases.group_id
      and membership.user_id = (select auth.uid())
  )
);
create policy badge_showcases_owner_insert
on public.badge_showcases for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.group_members membership
    where membership.group_id = badge_showcases.group_id
      and membership.user_id = (select auth.uid())
  )
);
create policy badge_showcases_owner_update
on public.badge_showcases for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.group_members membership
    where membership.group_id = badge_showcases.group_id
      and membership.user_id = (select auth.uid())
  )
);
create policy badge_showcases_owner_delete
on public.badge_showcases for delete to authenticated
using (user_id = (select auth.uid()));

-- Media assets: the owner and viewers of a group-visible photo keep access.
drop policy if exists media_owner_all on public.media_assets;
drop policy if exists media_group_read on public.media_assets;
drop policy if exists media_authorized_read on public.media_assets;
drop policy if exists media_owner_insert on public.media_assets;
drop policy if exists media_owner_update on public.media_assets;
drop policy if exists media_owner_delete on public.media_assets;

create policy media_authorized_read
on public.media_assets for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or exists (
    select 1 from public.photo_updates photo
    where photo.media_asset_id = media_assets.id
      and photo.visibility = 'group'
      and photo.group_id is not null
      and public.is_group_member(photo.group_id)
  )
);
create policy media_owner_insert
on public.media_assets for insert to authenticated
with check (owner_user_id = (select auth.uid()));
create policy media_owner_update
on public.media_assets for update to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));
create policy media_owner_delete
on public.media_assets for delete to authenticated
using (owner_user_id = (select auth.uid()));

-- Metric entries: a single SELECT policy covers owner and privacy-authorized
-- group reads. Revision-checked insert/update policies remain unchanged.
drop policy if exists entries_owner_select on public.metric_entries;
drop policy if exists entries_shared_read on public.metric_entries;
drop policy if exists entries_authorized_select on public.metric_entries;

create policy entries_authorized_select
on public.metric_entries for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    visibility::text = 'group'
    and exists (
      select 1 from public.metric_definitions definition
      where definition.id = metric_entries.metric_id
        and definition.group_id is not null
        and public.is_group_member(definition.group_id)
    )
  )
);

-- Goals: owners retain complete write control and group defaults stay readable.
drop policy if exists goals_owner_all on public.metric_goals;
drop policy if exists goals_group_read on public.metric_goals;
drop policy if exists goals_authorized_read on public.metric_goals;
drop policy if exists goals_owner_insert on public.metric_goals;
drop policy if exists goals_owner_update on public.metric_goals;
drop policy if exists goals_owner_delete on public.metric_goals;

create policy goals_authorized_read
on public.metric_goals for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    user_id is null
    and exists (
      select 1 from public.metric_definitions definition
      where definition.id = metric_goals.metric_id
        and public.is_group_member(definition.group_id)
    )
  )
);
create policy goals_owner_insert
on public.metric_goals for insert to authenticated
with check (user_id = (select auth.uid()));
create policy goals_owner_update
on public.metric_goals for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy goals_owner_delete
on public.metric_goals for delete to authenticated
using (user_id = (select auth.uid()));

-- Photo updates: combine owner and group visibility reads; guarded writes stay.
drop policy if exists photos_owner_select on public.photo_updates;
drop policy if exists photos_group_read on public.photo_updates;
drop policy if exists photos_authorized_select on public.photo_updates;

create policy photos_authorized_select
on public.photo_updates for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or (
    visibility = 'group'
    and group_id is not null
    and public.is_group_member(group_id)
  )
);

-- Profiles: self, shared-group, and membership-review visibility are an OR.
drop policy if exists profiles_self_read on public.profiles;
drop policy if exists profiles_group_read on public.profiles;
drop policy if exists profiles_membership_reviewer_read on public.profiles;
drop policy if exists profiles_authorized_read on public.profiles;

create policy profiles_authorized_read
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or public.shares_group_with(id)
  or public.can_review_membership(id)
);

-- Templates remain publicly readable when published and privately readable by
-- their authenticated creator. Creator writes are split out of the former ALL
-- policy to avoid overlapping the single public SELECT policy.
drop policy if exists templates_public_read on public.templates;
drop policy if exists templates_owner_all on public.templates;
drop policy if exists templates_authorized_read on public.templates;
drop policy if exists templates_owner_insert on public.templates;
drop policy if exists templates_owner_update on public.templates;
drop policy if exists templates_owner_delete on public.templates;

create policy templates_authorized_read
on public.templates for select to public
using (
  visibility = 'public'
  or creator_user_id = (select auth.uid())
);
create policy templates_owner_insert
on public.templates for insert to authenticated
with check (creator_user_id = (select auth.uid()));
create policy templates_owner_update
on public.templates for update to authenticated
using (creator_user_id = (select auth.uid()))
with check (creator_user_id = (select auth.uid()));
create policy templates_owner_delete
on public.templates for delete to authenticated
using (creator_user_id = (select auth.uid()));

drop policy if exists template_versions_public_read on public.template_versions;
drop policy if exists template_versions_owner_all on public.template_versions;
drop policy if exists template_versions_authorized_read on public.template_versions;
drop policy if exists template_versions_owner_insert on public.template_versions;
drop policy if exists template_versions_owner_update on public.template_versions;
drop policy if exists template_versions_owner_delete on public.template_versions;

create policy template_versions_authorized_read
on public.template_versions for select to public
using (
  exists (
    select 1 from public.templates template
    where template.id = template_versions.template_id
      and (
        template.visibility = 'public'
        or template.creator_user_id = (select auth.uid())
      )
  )
);
create policy template_versions_owner_insert
on public.template_versions for insert to authenticated
with check (
  exists (
    select 1 from public.templates template
    where template.id = template_versions.template_id
      and template.creator_user_id = (select auth.uid())
  )
);
create policy template_versions_owner_update
on public.template_versions for update to authenticated
using (
  exists (
    select 1 from public.templates template
    where template.id = template_versions.template_id
      and template.creator_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.templates template
    where template.id = template_versions.template_id
      and template.creator_user_id = (select auth.uid())
  )
);
create policy template_versions_owner_delete
on public.template_versions for delete to authenticated
using (
  exists (
    select 1 from public.templates template
    where template.id = template_versions.template_id
      and template.creator_user_id = (select auth.uid())
  )
);
