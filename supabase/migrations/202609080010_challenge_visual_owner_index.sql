-- Scope account reset and profile-deletion FK cleanup to the uploader's
-- challenge visuals without scanning unrelated challenges or null bindings.
create index group_challenges_visual_image_owner_idx
  on public.group_challenges using btree (visual_image_owner_id)
  where visual_image_owner_id is not null;
