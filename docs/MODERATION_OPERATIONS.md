# HabHub moderation operations

This runbook describes the code-backed moderation boundary. It does not name a
human operator, promise a response time, or prove that the queue is monitored.
Public chat and shared-content launch remains blocked until the product owner
assigns a trained queue owner, defines an achievable response commitment, and
tests the complete process with the production environment.

## Architecture guarantees

- Every signed-in cloud report is written to `user_safety_reports` through a
  bounded RPC and starts in `operator_review_state = 'queued'`.
- The Feed's report control attaches a bounded shared-target/date context to a
  member-conduct report, so photo/log/challenge concerns are not stranded on a
  screen without a safety action. The operator must verify that context against
  the server-owned shared row before taking content-level action.
- `operator_review_required` is true when no independent active group admin
  existed at submission. A report against the group's sole admin therefore
  remains an explicit priority item instead of disappearing from moderation.
- Group admins can review eligible reports and remove group messages/comments,
  but cannot list or decide a report about their own account or a report they
  filed.
- Blocking is enforced both in the immediate Feed render and in the database
  read policies for shared metric entries, progress photos, underlying media,
  chat, reactions, and comments. A blocker's client therefore does not keep
  receiving another member's Feed content after the block. Private-bucket
  authorization applies the same rule, so a previously cached object path
  cannot be exchanged for a new signed URL after the block.
- A group-admin decision never removes the report from the operator queue. The
  operator must independently close or dismiss that queue item.
- Ordinary authenticated and anonymous clients have no table access and cannot
  execute the operator list or decision RPCs. Those RPCs are granted only to
  the database `service_role`.
- Operator decisions use separate fields from group-admin decisions so the
  independent audit record does not overwrite the group action.

The service-role key must never be shipped in the app, web bundle, screenshots,
support email, logs, or store-review notes. Run the commands below only from the
trusted Supabase SQL editor or a separately secured operations service.

## Queue review

List the newest unresolved operator items in bounded pages:

```sql
select *
from public.habhub_list_operator_safety_reports(
  'queued',
  null,
  null,
  100
);
```

Review state `priority` first; it returns queued reports that had no safe
group-level reviewer. Then use state `queued` for the remaining queue. To load
the next page, pass the final row's `created_at` and `id` as the two cursor
arguments. Use state `all` for an audit that includes resolved and dismissed
items.

Poll body-free queue health from protected monitoring without exporting report
text:

```sql
select public.habhub_operator_safety_queue_health();
```

This returns only queued count, priority count, and the oldest queued timestamp.
An external alert still has to be configured and owned before public launch.

Close a queue item with a stable internal case or ticket reference that contains
no secret and no unnecessary personal data:

```sql
select public.habhub_moderate_operator_safety_report(
  'REPORT_UUID',
  'reviewed',
  'CASE_REFERENCE',
  'Bounded internal note'
);
```

Allowed actions are:

- `reviewed`: record independent review without removing content.
- `remove_message`: remove the reported group message and resolve the item.
- `remove_comment`: remove the reported shared comment and resolve the item.
- `confirm_group_action`: verify an already completed group-admin decision
  without overwriting its audit fields.
- `dismissed`: dismiss the report at operator level. This cannot undo content
  already removed by a group admin.

Repeated operator calls are idempotent: a resolved/dismissed queue item returns
`alreadyHandled = true` and is not rewritten.

## Required human process before launch

Before enabling public UGC, the operator must complete and evidence all of the
following outside this repository:

1. Assign primary and backup people who can access the protected queue.
2. Define coverage hours, severity levels, an achievable response target, and
   an escalation/appeal process in the actual availability regions.
3. Train reviewers to minimize access to health and identity data and to avoid
   copying report evidence into ordinary logs or email.
4. Test report, block, self-admin-report, content-removal, appeal, and emergency
   paths with dedicated production review accounts.
5. Confirm the support mailbox is monitored and connect each operator decision
   to a stable case reference.
6. Obtain qualified legal review for retention, account deletion, minors,
   credible threats, unlawful content, and authority referrals.
7. Monitor queue age and failures without exporting report bodies. Alert on the
   oldest queued item and on any error that prevents listing or resolution.

If those steps are incomplete, disable public chat/shared-content surfaces for
the store release. The existence of this queue alone is not moderation
operations and must not be represented to reviewers as such.

## Verification

Run the policy and PostgreSQL simulations before deployment:

```powershell
pnpm.cmd validate:safety
```

After applying the migration, use non-personal test accounts to submit reports
against an ordinary member and the group's sole admin. Confirm the ordinary
client cannot call either operator RPC, the service role can page both reports,
the sole-admin report has `operator_review_required = true`, and a group action
does not remove its report from the operator queue.
