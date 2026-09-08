import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { revokeGoogleToken } from '../_shared/google-health-api.ts';
import { decryptSecret } from '../_shared/google-health-crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store',
};

type AdminClient = SupabaseClient<any, 'public', any>;

type ResetRequest = {
  payload?: unknown;
  deviceId?: unknown;
  schemaVersion?: unknown;
  resetAt?: unknown;
};

function validResetRequest(value: unknown): value is {
  payload: Record<string, unknown>;
  deviceId: string;
  schemaVersion: 27;
  resetAt: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as ResetRequest;
  if (!request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload)) return false;
  if (typeof request.deviceId !== 'string' || request.deviceId.length < 8 || request.deviceId.length > 200) return false;
  if (request.schemaVersion !== 27) return false;
  if (typeof request.resetAt !== 'string' || !Number.isFinite(Date.parse(request.resetAt))) return false;
  const settings = (request.payload as Record<string, unknown>).settings;
  return Boolean(
    settings &&
    typeof settings === 'object' &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>).accountDataResetAt === request.resetAt
  );
}

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

async function assertResetLease(
  admin: AdminClient,
  userId: string,
  attemptId: string,
) {
  const renewed = await admin.rpc('renew_google_health_account_deletion', {
    p_user_id: userId,
    p_attempt_id: attemptId,
  });
  if (renewed.error || renewed.data !== true)
    throw renewed.error ?? new Error('account_reset_attempt_lost');
}

async function beginResetLease(
  admin: AdminClient,
  userId: string,
  attemptId: string,
) {
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
      // The account-detached encrypted job remains queued for the worker.
    }
  }
}

async function removePrivateMedia(
  admin: AdminClient,
  userId: string,
  retainedPaths: string[],
  assertLease: () => Promise<void>,
) {
  const prefix = `${userId}/`;
  if (retainedPaths.length > 20_000 || retainedPaths.some((path) => !path.startsWith(prefix)))
    throw new Error('account_reset_media_manifest_invalid');
  const retained = new Set(retainedPaths);
  const files = await listFiles(admin, userId, assertLease);
  const removable = files.filter((path) => !retained.has(path));
  for (let index = 0; index < removable.length; index += 100) {
    await assertLease();
    const { error } = await admin.storage
      .from('paceboard-media')
      .remove(removable.slice(index, index + 100));
    if (error) throw error;
  }
  const remaining = await listFiles(admin, userId, assertLease);
  if (remaining.some((path) => !retained.has(path)))
    throw new Error('account_reset_media_cleanup_incomplete');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let guardedUserId: string | undefined;
  let guardedAdmin: AdminClient | undefined;
  let guardedAttemptId: string | undefined;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');
    const contentLength = Number(request.headers.get('Content-Length') ?? '0');
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return new Response('Missing server configuration or authorization', {
        status: 401,
        headers: corsHeaders,
      });
    }
    if (Number.isFinite(contentLength) && contentLength > 36 * 1024 * 1024)
      return new Response('Request too large', { status: 413, headers: corsHeaders });

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data, error } = await caller.auth.getUser();
    if (error || !data.user)
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    const body: unknown = await request.json();
    if (!validResetRequest(body))
      return new Response(JSON.stringify({ error: 'account_reset_request_invalid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const attemptId = crypto.randomUUID();
    guardedUserId = data.user.id;
    guardedAdmin = admin;
    guardedAttemptId = attemptId;
    await beginResetLease(admin, data.user.id, attemptId);

    const reset = await admin.rpc('reset_account_private_data', {
      p_user_id: data.user.id,
      p_attempt_id: attemptId,
      p_payload: body.payload,
      p_device_id: body.deviceId,
      p_schema_version: body.schemaVersion,
      p_reset_at: body.resetAt,
    });
    if (reset.error) throw reset.error;
    const result = reset.data && typeof reset.data === 'object' ? reset.data : null;
    if (
      !result ||
      !Number.isSafeInteger(result.revision) ||
      result.revision < 1 ||
      typeof result.updatedAt !== 'string' ||
      !Array.isArray(result.retainedMediaPaths) ||
      !result.retainedMediaPaths.every((path: unknown) => typeof path === 'string')
    ) throw new Error('account_reset_result_invalid');

    const heartbeat = () => assertResetLease(admin, data.user.id, attemptId);
    await removePrivateMedia(
      admin,
      data.user.id,
      result.retainedMediaPaths,
      heartbeat,
    );
    const verified = await admin.rpc('verify_google_health_account_deletion', {
      p_user_id: data.user.id,
      p_attempt_id: attemptId,
    });
    if (verified.error || verified.data !== true)
      throw verified.error ?? new Error('account_reset_attempt_lost');
    const cancelled = await admin.rpc('cancel_google_health_account_deletion', {
      p_user_id: data.user.id,
      p_attempt_id: attemptId,
    });
    if (cancelled.error || cancelled.data !== true)
      throw cancelled.error ?? new Error('account_reset_guard_cleanup_failed');
    guardedUserId = undefined;
    guardedAttemptId = undefined;

    return new Response(JSON.stringify({
      reset: true,
      revision: result.revision,
      updatedAt: result.updatedAt,
      resetAt: body.resetAt,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    if (guardedUserId && guardedAdmin && guardedAttemptId) {
      const cancelled = await guardedAdmin.rpc('cancel_google_health_account_deletion', {
        p_user_id: guardedUserId,
        p_attempt_id: guardedAttemptId,
      });
      if (cancelled.error) console.error('Account reset guard cleanup failed');
    }
    console.error('Account data reset failed');
    return new Response(JSON.stringify({ error: 'account_data_reset_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
