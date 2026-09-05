import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { revokeGoogleToken } from '../_shared/google-health-api.ts';
import { decryptSecret } from '../_shared/google-health-crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AdminClient = SupabaseClient<any, 'public', any>;

const sharedPurgeCountKeys = [
  'socialReactions',
  'socialComments',
  'safetyReportsFiled',
  'safetyReportsFiledRetained',
  'safetyReportsRedacted',
  'messages',
  'metricEntries',
  'photoUpdates',
  'groupTodos',
  'groupChallenges',
  'groupChallengeMembershipsScrubbed',
  'groupChallengesInvalidated',
  'templates',
  'pushDispatchAcceptances',
  'snapshotReferencesScrubbed',
] as const;

async function listFiles(
  admin: AdminClient,
  rootPrefix: string,
  assertLease: () => Promise<void>,
): Promise<string[]> {
  const output: string[] = [];
  const pendingPrefixes = [rootPrefix];
  const visitedPrefixes = new Set<string>();
  const pageSize = 1000;
  while (pendingPrefixes.length) {
    const prefix = pendingPrefixes.shift()!;
    if (visitedPrefixes.has(prefix)) continue;
    visitedPrefixes.add(prefix);
    for (let offset = 0; ; offset += pageSize) {
      await assertLease();
      const { data, error } = await admin.storage.from('paceboard-media').list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      const page = data ?? [];
      for (const item of page) {
        const path = `${prefix}/${item.name}`;
        if (item.id) output.push(path);
        else pendingPrefixes.push(path);
      }
      if (page.length < pageSize) break;
    }
  }
  return output;
}

async function deleteAllMedia(
  admin: AdminClient,
  userId: string,
  assertLease: () => Promise<void>,
) {
  const files = await listFiles(admin, userId, assertLease);
  for (let index = 0; index < files.length; index += 100) {
    await assertLease();
    const { error } = await admin.storage.from('paceboard-media').remove(files.slice(index, index + 100));
    if (error) throw error;
  }
  // The account-deletion guard blocks concurrent owner writes. A second full
  // paginated listing therefore proves the private prefix is empty before the
  // auth row can be removed.
  const remaining = await listFiles(admin, userId, assertLease);
  if (remaining.length) throw new Error('account_media_cleanup_incomplete');
}

async function assertDeletionLease(
  admin: AdminClient,
  userId: string,
  attemptId: string,
) {
  const renewed = await admin.rpc('renew_google_health_account_deletion', {
    p_user_id: userId,
    p_attempt_id: attemptId,
  });
  if (renewed.error || renewed.data !== true)
    throw renewed.error ?? new Error('account_deletion_attempt_lost');
}

async function deleteGoogleHealthData(
  admin: AdminClient,
  userId: string,
  attemptId: string,
) {
  // One database transaction invalidates generations/leases, stages durable
  // revocations, and purges every Google-owned snapshot/group projection.
  // Any database failure aborts account deletion rather than orphaning a grant.
  const { data, error } = await admin.rpc('begin_google_health_account_deletion', {
    p_user_id: userId,
    p_attempt_id: attemptId,
  });
  if (error) throw error;
  const revocations = data && typeof data === 'object' && Array.isArray(data.revocations)
    ? data.revocations
    : [];
  for (const credential of revocations) {
    try {
      const token = await decryptSecret({
        ciphertext: credential.refresh_token_ciphertext,
        iv: credential.refresh_token_iv,
        keyVersion: credential.encryption_key_version,
      }, { purpose: 'refresh-token', userId });
      await revokeGoogleToken(token);
      const purged = await admin.from('google_health_revocation_queue')
        .delete()
        .eq('id', credential.revocation_id);
      if (purged.error) throw purged.error;
    } catch {
      // The encrypted queued copy survives auth-user deletion and is retried
      // autonomously by the scheduled worker. Never log token material.
    }
  }
}

async function deleteUserAuthoredSharedContent(
  admin: AdminClient,
  userId: string,
  attemptId: string,
) {
  // The RPC owns one database transaction and the same durable attempt lease
  // as media/Google cleanup. Missing migrations, incomplete results, or any
  // table failure abort account deletion before the auth identity is removed.
  const purged = await admin.rpc('purge_account_authored_shared_content', {
    p_user_id: userId,
    p_attempt_id: attemptId,
  });
  if (purged.error) throw purged.error;
  if (
    !purged.data ||
    typeof purged.data !== 'object' ||
    !sharedPurgeCountKeys.every((key) =>
      Number.isSafeInteger(purged.data[key]) && purged.data[key] >= 0
    )
  ) throw new Error('account_shared_content_cleanup_incomplete');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let guardedUserId: string | undefined;
  let guardedAdmin: AdminClient | undefined;
  let guardedAttemptId: string | undefined;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return new Response('Missing server configuration or authorization', { status: 401, headers: corsHeaders });
    }

    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data, error } = await caller.auth.getUser();
    if (error || !data.user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    // The database guard is committed first. Storage write policies consult
    // it, so another still-authenticated tab cannot add or replace media while
    // the paginated, fail-closed cleanup is running.
    const attemptId = crypto.randomUUID();
    guardedUserId = data.user.id;
    guardedAdmin = admin;
    guardedAttemptId = attemptId;
    // Record this invocation's unique token before awaiting the RPC. If the
    // database commits but the response is lost, the catch path can cancel
    // only this attempt and can never clear another concurrent deletion guard.
    await deleteGoogleHealthData(admin, data.user.id, attemptId);
    await deleteUserAuthoredSharedContent(admin, data.user.id, attemptId);
    const heartbeat = () => assertDeletionLease(admin, data.user.id, attemptId);
    await deleteAllMedia(admin, data.user.id, heartbeat);
    const verified = await admin.rpc('verify_google_health_account_deletion', {
      p_user_id: data.user.id,
      p_attempt_id: attemptId,
    });
    if (verified.error || verified.data !== true)
      throw verified.error ?? new Error('account_deletion_attempt_lost');
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
    if (deleteError) {
      const cancelled = await admin.rpc('cancel_google_health_account_deletion', {
        p_user_id: data.user.id,
        p_attempt_id: attemptId,
      });
      if (cancelled.error) console.error('Account deletion guard cleanup failed');
      guardedUserId = undefined;
      guardedAttemptId = undefined;
      throw deleteError;
    }

    return new Response(JSON.stringify({ deleted: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    if (guardedUserId && guardedAdmin && guardedAttemptId) {
      const cancelled = await guardedAdmin.rpc('cancel_google_health_account_deletion', {
        p_user_id: guardedUserId,
        p_attempt_id: guardedAttemptId,
      });
      if (cancelled.error) console.error('Account deletion guard cleanup failed');
    }
    console.error('Account deletion failed');
    return new Response(JSON.stringify({ error: 'account_deletion_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
