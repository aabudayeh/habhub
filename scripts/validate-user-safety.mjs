import assert from "node:assert/strict";
import fs from "node:fs";

import { CURRENT_TERMS_VERSION } from "../src/legal/policy.ts";
import { moderateChatContent } from "../src/safety/contentFilter.ts";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function includes(source, tokens, label) {
  for (const token of tokens)
    assert.ok(
      source.includes(token),
      `${label} is missing required token: ${token}`,
    );
}

function sqlFunction(source, signature, label) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${label} definition is missing`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${label} definition is unterminated`);
  return source.slice(start, end + 4);
}

const migrationPath =
  "supabase/migrations/202609040002_user_safety.sql";
const migration = read(migrationPath);
const safetyStore = read("src/safety/userSafety.ts");
const chat = read("app/(tabs)/chat.tsx");
const member = read("app/member-profile/[id].tsx");
const recap = read("app/recap.tsx");
const socialEngagement = read("src/cloud/useGroupSocialEngagement.ts");
const safetyCenter = read("app/safety.tsx");
const safetyReportSheet = read("src/components/SafetyReportSheet.tsx");
const communityGuidelines = read("app/community-guidelines.tsx");
const support = read("app/support.tsx");
const moderationRunbook = read("docs/MODERATION_OPERATIONS.md");
const storeReviewNotes = read("store/review-notes.md");
const banner = read("src/components/InAppChatBanner.tsx");
const tabs = read("app/(tabs)/_layout.tsx");
const alerts = read("src/domain/alerts.ts");
const push = read("supabase/functions/send-push/index.ts");

assert.equal(
  CURRENT_TERMS_VERSION,
  "2026-09-04",
  "the validator must be updated when the bundled Terms version changes",
);
assert.ok(
  migration.includes(`values (true, '${CURRENT_TERMS_VERSION}', false)`),
  "the server and bundled Terms versions must match",
);

for (const table of [
  "app_policy_versions",
  "user_terms_acceptances",
  "user_blocks",
  "user_safety_reports",
]) {
  assert.match(
    migration,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    `${table} must enable RLS in its creation migration`,
  );
}
includes(
  migration,
  [
    "revoke all on table public.user_safety_reports from anon, authenticated",
    "habhub_accept_current_terms",
    "habhub_block_user",
    "habhub_unblock_user",
    "habhub_report_message",
    "habhub_report_comment",
    "habhub_report_user",
    "habhub_get_user_safety_state",
    "habhub_list_group_safety_reports",
    "habhub_moderate_group_safety_report",
    "habhub_list_operator_safety_reports",
    "habhub_moderate_operator_safety_report",
    "habhub_operator_safety_queue_health",
    "habhub_has_current_terms_acceptance()",
    "ugc_terms_enforced boolean not null default false",
    "not policy.ugc_terms_enforced",
    "habhub_message_content_allowed(content)",
    "habhub_can_direct_message(group_id, recipient_id)",
    "char_length(normalized_details) > 500",
    "report.status = 'open'",
    "report.reported_user_id is distinct from (select auth.uid())",
    "Reports about your account require independent service-operator review",
    "Reports you filed require independent service-operator review",
    "operator_review_required boolean not null default true",
    "operator_review_state text not null default 'queued'",
    "user_safety_reports_operator_queue_idx",
    "user_safety_reports_operator_priority_idx",
    "group_social_comments_member_read",
    "public.habhub_message_visible_to_current_user(user_id, null)",
    "entries_authorized_select",
    "photos_authorized_select",
    "media_authorized_read",
    "can_read_media_object",
    "can_read_challenge_media_object",
    "public.habhub_message_visible_to_current_user(owner_user_id, null)",
    "photo.owner_user_id",
    "remove_comment",
    "comment_removed",
  ],
  "user safety migration",
);
const operatorPriority = sqlFunction(
  migration,
  "create or replace function public.habhub_report_requires_operator_review(",
  "operator-priority helper",
);
includes(
  operatorPriority,
  [
    "membership.role in ('owner', 'admin')",
    "membership.user_id is distinct from p_reported_user_id",
    "membership.user_id is distinct from p_reporter_id",
  ],
  "operator-priority helper",
);
const mediaReadAuthorization = sqlFunction(
  migration,
  "create or replace function public.can_read_media_object(",
  "storage-media authorization",
);
includes(
  mediaReadAuthorization,
  [
    "photo.owner_user_id",
    "entry.user_id",
    "message.sender_id",
    "message.recipient_id",
    "profile.id",
    "public.habhub_message_visible_to_current_user",
  ],
  "storage-media authorization",
);
const challengeMediaReadAuthorization = sqlFunction(
  migration,
  "create or replace function public.can_read_challenge_media_object(",
  "challenge-media authorization",
);
includes(
  challengeMediaReadAuthorization,
  [
    "challenge.creator_id",
    "public.habhub_message_visible_to_current_user",
  ],
  "challenge-media authorization",
);
const operatorQueue = sqlFunction(
  migration,
  "create or replace function public.habhub_list_operator_safety_reports(",
  "operator queue RPC",
);
includes(
  operatorQueue,
  [
    "'priority', 'queued', 'resolved', 'dismissed', 'all'",
    "p_limit not between 1 and 100",
    "report.operator_review_state = normalized_state",
    "normalized_state = 'priority'",
    "order by report.created_at desc, report.id desc",
  ],
  "operator queue RPC",
);
const operatorModeration = sqlFunction(
  migration,
  "create or replace function public.habhub_moderate_operator_safety_report(",
  "operator moderation RPC",
);
const operatorQueueHealth = sqlFunction(
  migration,
  "create or replace function public.habhub_operator_safety_queue_health()",
  "operator queue health RPC",
);
includes(
  operatorQueueHealth,
  ["'queuedCount'", "'priorityCount'", "'oldestQueuedAt'"],
  "operator queue health RPC",
);
includes(
  operatorModeration,
  [
    "char_length(normalized_reference) not between 1 and 120",
    "target.operator_review_state <> 'queued'",
    "'confirm_group_action' and target.status = 'open'",
    "Use confirm_group_action for a completed group decision",
    "target.report_type <> 'message' or target.message_id is null",
    "target.report_type <> 'comment' or target.comment_id is null",
    "operator_reference = normalized_reference",
    "operator_reviewed_at = clock_timestamp()",
  ],
  "operator moderation RPC",
);
assert.match(
  migration,
  /grant execute on function public\.habhub_list_operator_safety_reports\([\s\S]+?\) to service_role/i,
  "only trusted service tooling should receive the operator queue API",
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.habhub_(?:list|moderate)_operator_safety_report[s]?\([\s\S]*?\) to authenticated/i,
  "ordinary accounts must never receive operator queue or decision powers",
);
assert.match(
  migration,
  /grant execute on function public\.habhub_operator_safety_queue_health\(\)\s+to service_role/i,
  "only trusted service tooling should receive body-free queue health telemetry",
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.habhub_operator_safety_queue_health\(\)\s+to authenticated/i,
  "ordinary accounts must not see cross-account queue health telemetry",
);
const reactionTermsTrigger = sqlFunction(
  migration,
  "create or replace function public.habhub_enforce_group_social_reaction_terms()",
  "reaction Terms trigger",
);
includes(
  reactionTermsTrigger,
  [
    "caller_id uuid := (select auth.uid())",
    "if caller_id is null then",
    "not public.habhub_has_current_terms_acceptance()",
    "Accept the current Terms before reacting to shared items.",
  ],
  "reaction Terms trigger",
);
assert.match(
  migration,
  /create trigger group_social_reactions_require_current_terms\s+before insert or update on public\.group_social_reactions\s+for each row execute function\s+public\.habhub_enforce_group_social_reaction_terms\(\)/i,
  "every reaction definer writer must cross the current-Terms table trigger",
);
const reactionV2 = sqlFunction(
  migration,
  "create or replace function public.set_group_social_reaction_v2(",
  "v2 reaction RPC",
);
includes(
  reactionV2,
  [
    "v_actor_id uuid := (select auth.uid())",
    "if v_actor_id is null then",
    "if p_reaction is not null",
    "and not public.habhub_has_current_terms_acceptance() then",
    "public.set_group_social_reaction(",
  ],
  "v2 reaction RPC",
);
assert.match(
  migration,
  /revoke all on function public\.habhub_enforce_group_social_reaction_terms\(\)\s+from public, anon, authenticated/i,
  "the trigger helper must not be callable by clients",
);
assert.doesNotMatch(
  migration,
  /create policy[^;]+on public\.user_safety_reports/is,
  "durable reports must remain RPC-only, without a client table policy",
);
assert.doesNotMatch(
  migration,
  /drop policy if exists media_owner_(?:insert|update|delete)\s+on public\.media_assets/i,
  "shared-media read hardening must preserve owner write policies",
);

includes(
  safetyStore,
  [
    "CURRENT_TERMS_VERSION",
    'CACHE_PREFIX = "habhub-user-safety-v1:"',
    'supabase.rpc("habhub_block_user"',
    'supabase.rpc("habhub_unblock_user"',
    'supabase.rpc("habhub_report_message"',
    'supabase.rpc("habhub_report_comment"',
    'supabase.rpc("habhub_report_user"',
    '"habhub_can_direct_message"',
    'entry.mode === "demo"',
  ],
  "account safety store",
);
includes(
  recap,
  [
    "SafetyReportSheet",
    "onReportComment",
    "onReportItem",
    ".reportComment({",
    ".reportUser({",
    'title="Report comment"',
    'title="Report shared update"',
    "Shared ${selected.item.kind} update",
    "!safety.blockedUserIds.has(item.memberId)",
  ],
  "feed-comment safety UI",
);
includes(
  socialEngagement,
  [
    "moderateChatContent(content)",
    "safety.termsAccepted",
    "safety.blockedUserIds.has(comment.userId)",
    "safety.blockedUserIds.has(reaction.userId)",
  ],
  "feed-comment safety model",
);
includes(
  chat,
  [
    "SafetyReportSheet",
    "confirmMemberBlock",
    "openMessageSafety",
    "moderateChatContent",
    "cloudTermsRequired",
    'router.push("/terms" as never)',
    'router.push("/safety" as never)',
    "blockedUserIds.has(message.senderId)",
    "safety.canDirectMessage",
  ],
  "chat safety UI",
);
includes(
  member,
  [
    'label="Report member"',
    'label={blocked ? "Unblock" : "Block"}',
    'label="Safety Center"',
    "SafetyReportSheet",
  ],
  "member safety UI",
);
includes(
  safetyCenter,
  [
    "Demo safety preview",
    "Blocked members",
    "Your recent reports",
    "Group moderation",
    'router.push("/terms" as never)',
    'router.push("/support" as never)',
    "Protected operator review queued",
    "Reports about your own account or reports you filed never appear in your group queue.",
    "useTutorialSandboxActive",
  ],
  "Safety Center",
);
for (const [source, label] of [
  [chat, "chat report confirmation"],
  [member, "member report confirmation"],
  [recap, "comment report confirmation"],
  [safetyReportSheet, "report sheet"],
]) {
  assert.ok(
    source.includes("protected operator queue"),
    `${label} must truthfully describe the independent report path`,
  );
}
includes(
  communityGuidelines,
  ["Every cloud report", "reported account cannot", "moderator cannot decide a report they"],
  "public community guidelines",
);
includes(
  support,
  ["protected operator queue automatically", "sole group admin", "monitored moderation owner"],
  "public support policy",
);
includes(
  moderationRunbook,
  [
    "service_role",
    "habhub_list_operator_safety_reports",
    "habhub_moderate_operator_safety_report",
    "habhub_operator_safety_queue_health",
    "Public chat and shared-content launch remains blocked",
  ],
  "moderation operations runbook",
);
includes(
  storeReviewNotes,
  [
    "service-only operator queue",
    "sole admin",
    "final moderation owner/response commitment",
  ],
  "store review notes",
);
for (const [source, label] of [
  [banner, "in-app banner"],
  [tabs, "tab unread badge"],
  [alerts, "alerts domain"],
]) {
  assert.ok(
    source.includes("blockedUserIds"),
    `${label} must suppress blocked-member content`,
  );
}
includes(
  push,
  [
    "filterBlockedChatRecipients",
    '.from("user_blocks")',
    'event.eventType === "social_comment"',
    'event.eventType === "social_reaction"',
    "Failing closed",
  ],
  "push recipient enforcement",
);

for (const abusive of [
  "go kill yourself",
  "I will kill you",
  "underage nudes",
  "bring dich um",
  "mátate",
  "去死",
]) {
  assert.equal(
    moderateChatContent(abusive).allowed,
    false,
    `high-confidence abusive chat must be rejected: ${abusive}`,
  );
}
for (const normal of [
  "That interval nearly killed me 😅",
  "This workout is brutally good",
  "See you for the group run at 7?",
]) {
  assert.equal(
    moderateChatContent(normal).allowed,
    true,
    `ordinary fitness chat must remain available: ${normal}`,
  );
}

console.log("User safety source validation passed.");
