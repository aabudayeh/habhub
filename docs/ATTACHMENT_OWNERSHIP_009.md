# Attachment ownership boundary

Migration `202609080009_attachment_namespace_ownership.sql` follows migrations
007 and 008. Deploy the migrations in order before the corresponding release.
Follow-up migration `202609080010_challenge_visual_owner_index.sql` adds a partial
btree index on non-null uploader bindings. Account reset and profile-deletion
cleanup can then locate one uploader's visuals without scanning unrelated
challenges. Migration 009 remains unchanged after deployment.

A shared database row does not grant permission to a different account's
private storage namespace. New entry/chat attachments, avatars, media-asset
paths and thumbnails must belong to the row's user. Fresh signed-URL checks
enforce the same rule on existing rows. Membership, direct-message recipients,
blocks, challenge audience, and account-deletion fences remain in force.

Challenge administrators may still upload their own image for another creator's
group challenge. The database records the actual authenticated uploader in
`visual_image_owner_id`; clients cannot supply or change that binding on an
unchanged image. Public challenge editing remains creator-only.
Deleting an uploader's account clears their uploader binding and identifying
image path from surviving challenges created by somebody else. The challenge
itself is retained. This follows the existing auth-user/profile deletion cascade;
an ordinary client cannot impersonate that cleanup while the uploader exists.
Account-data reset also clears that account's proven challenge-image bindings
before calculating which uploads to retain, while preserving the profile,
challenge, and images uploaded by other users.

## Legacy references

No storage files or content rows are deleted by this migration. Creator-owned
legacy challenge images retain access. Legacy non-creator images without
independent uploader provenance become unavailable, even when the original
upload may have been a legitimate administrator's image. An authorized editor
must select and upload a replacement; the app generates a new owned path.
Forged or malformed entry/chat/avatar/asset references cannot grant new image
access and must be cleared or replaced before those rows can be republished.

Already-issued signed URLs are not retrospectively revoked by a database
predicate change; they remain subject to their existing expiration. No image
contents or production object paths are recorded by this migration or validator.

## Verification

`pnpm.cmd validate:group-history` includes the local PostgreSQL regression in
`scripts/validate-attachment-ownership-postgres.mjs`. It reproduces the pre-fix
reference-only leak, then checks owner/foreign/empty/traversal paths, genuine
group sharing, private-message recipients, blocked users, anonymous access,
account deletion, and server-managed administrator visual provenance. The
backfill preserves timestamps and pre-existing trigger enablement states.
The runner applies migration 010 and verifies a representative owner lookup
uses its partial index across 2,000 unrelated challenge visuals with normal
query-planner settings.

These are isolated local SQL tests, not tests against external users or live
production media. Device-level upload/display QA and server migration parity
remain separate release checks.
