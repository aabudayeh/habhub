import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const response = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return response(401, { error: "authentication_required" });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return response(503, { error: "cleanup_unavailable" });
  try {
    if (Number(request.headers.get("Content-Length") ?? 0) > 2048) return response(413, { error: "request_too_large" });
    const raw = await request.text();
    if (raw.length > 2048) return response(413, { error: "request_too_large" });
    const input = JSON.parse(raw) as { groupId?: unknown };
    if (typeof input?.groupId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.groupId))
      return response(400, { error: "invalid_group" });
    const user = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const verified = await user.auth.getUser();
    if (verified.error || !verified.data.user) return response(401, { error: "authentication_required" });
    // Only the caller-context RPC chooses paths. Input never supplies a file,
    // owner, prefix or bucket, and retired paths cannot acquire new references.
    const allowed = await user.rpc("list_retired_group_note_media", { p_group_id: input.groupId });
    if (allowed.error) return response(403, { error: "cleanup_not_authorized" });
    const rows = allowed.data as { path?: unknown }[] | null;
    if (!Array.isArray(rows) || rows.length > 100 || rows.some((row) => typeof row.path !== "string" || !/^[0-9a-f-]{36}\/account\/group-note\//i.test(row.path)))
      return response(503, { error: "invalid_cleanup_result" });
    const paths = [...new Set(rows.map((row) => row.path as string))];
    if (!paths.length) return response(200, { removed: 0 });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const removed = await admin.storage.from("paceboard-media").remove(paths);
    if (removed.error) return response(503, { error: "cleanup_pending" });
    return response(200, { removed: paths.length });
  } catch {
    // Never log image paths, group content, bearer tokens or health details.
    return response(400, { error: "cleanup_request_failed" });
  }
});
