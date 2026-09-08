import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = fs.readFileSync(new URL("../supabase/functions/send-push/index.ts", import.meta.url), "utf8");
const functionSource = (name) => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert(match, `Production function ${name} exists`);
  return match[0];
};
const compiled = stripTypeScriptTypes([
  source.slice(source.indexOf("const PUSH_QUERY_PAGE_SIZE"), source.indexOf("Deno.serve(")),
  functionSource("canonicalRecipients"), functionSource("filterBlockedChatRecipients"),
  functionSource("recipientChatNicknames"), functionSource("preferenceAllowed"),
  functionSource("objectRecord"), functionSource("normalizedUuid"), functionSource("normalizedString"),
  functionSource("isMissingWebPushSubscriptionsError"),
  "export { readPushRows, readPushRecipientChunks, canonicalRecipients, filterBlockedChatRecipients, discoverPushRegistrations, loadPushAcceptances, recipientChatNicknames, quotedPushCursor, assertPushDiscoveryBudget };",
].join("\n"));
const edge = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

// Emulate PostgREST's real 1,000-row ceiling, fluent filters and quoted compound
// cursor syntax. Every predicate is applied; no privileged fixture bypasses
// membership, recipient, opt-in or block checks in the production functions.
function terms(value) {
  let depth = 0; let quoted = false; let escaped = false; let start = 0;
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === "\\") { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { result.push(value.slice(start, i)); start = i + 1; }
  }
  result.push(value.slice(start));
  return result;
}
function matches(row, term) {
  if (term.startsWith("and(")) return terms(term.slice(4, -1)).every((part) => matches(row, part));
  const match = /^([^\.]+)\.(eq|gt)\.(.*)$/.exec(term);
  assert(match, `Supported filter ${term}`);
  const value = match[3].startsWith('"') ? JSON.parse(match[3]) : match[3];
  return match[2] === "eq" ? row[match[1]] === value : row[match[1]] > value;
}
function mockAdmin(tables, options = {}) {
  const calls = []; const counts = new Map();
  let active = 0; let peak = 0;
  return { calls, get peak() { return peak; }, from(table) {
    const filters = []; const orders = []; let limit = 1000; let cursor;
    const builder = {
      select() { return builder; },
      eq(key, value) { filters.push((row) => row[key] === value); return builder; },
      neq(key, value) { filters.push((row) => row[key] !== value); return builder; },
      is(key, value) { filters.push((row) => row[key] === value); return builder; },
      in(key, values) { assert(values.length <= 100, `${table}.${key} in-clause stays bounded`); filters.push((row) => values.includes(row[key])); return builder; },
      gt(key, value) { cursor = [key, value]; if (!options.stalled) filters.push((row) => row[key] > value); return builder; },
      or(expression) { filters.push((row) => terms(expression).some((term) => matches(row, term))); return builder; },
      order(key, settings) { assert.equal(settings.ascending, true); orders.push(key); return builder; },
      limit(value) { limit = value; return builder; },
      abortSignal(signal) { assert(signal instanceof AbortSignal); return builder; },
      async then(resolve, reject) {
        const count = (counts.get(table) ?? 0) + 1; counts.set(table, count);
        calls.push({ table, count, limit, cursor, orders }); active++; peak = Math.max(peak, active);
        await new Promise((done) => setTimeout(done, 0));
        active--;
        const failure = options.fail?.(table, count);
        if (failure) return Promise.resolve({ data: null, error: failure }).then(resolve, reject);
        assert.equal(limit, 250, `${table} requests bounded pages below the real server ceiling`);
        const rows = [...(tables[table] ?? [])].filter((row) => filters.every((filter) => filter(row))).sort((left, right) => {
          for (const key of orders) { if (left[key] < right[key]) return -1; if (left[key] > right[key]) return 1; }
          return 0;
        }).slice(0, Math.min(limit, 1000));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  } };
}

const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const users = Array.from({ length: 1205 }, (_, i) => id(i + 1));
const creator = users[0];
const policy = { groupPreferencesByGroup: { g1: { scheduleReminders: true } } };
const event = { category: "metric", eventType: "group_schedule_reminder", groupId: "g1", eventKey: "reminder", dispatcherId: creator, audience: "group_including_sender", data: {} };
const tables = {
  group_members: users.map((user_id) => ({ user_id, group_id: "g1", status: user_id === id(1205) ? "left" : "active", role: user_id === creator ? "owner" : "member" })),
  group_notification_events: users.filter((user) => user !== id(1203)).map((recipient_id) => ({ recipient_id, event_key: "reminder", group_id: "g1", event_type: "group_schedule_reminder" })),
  user_snapshots: users.filter((user) => user !== id(1199)).map((user_id) => ({ user_id, notifications: user_id === id(1204) ? { groupPreferencesByGroup: { g1: { scheduleReminders: false } } } : policy })),
  // More than a thousand unrelated relationships must not obscure a late
  // matching block in either direction when the sender has a large history.
  user_blocks: [
    ...Array.from({ length: 1400 }, (_, i) => ({ blocker_id: creator, blocked_user_id: id(10000 + i) })),
    { blocker_id: creator, blocked_user_id: id(1202) },
    { blocker_id: id(1201), blocked_user_id: creator },
  ],
  group_member_aliases: users.map((owner_user_id, i) => ({ owner_user_id, subject_user_id: creator, group_id: "g1", nickname: `Private alias ${i + 1}` })),
  device_push_tokens: [], web_push_subscriptions: [], push_token_dispatch_acceptances: [],
};
const expected = users.filter((user) => ![id(1205), id(1204), id(1203), id(1202), id(1201), id(1199)].includes(user));
const admin = mockAdmin(tables);
assert.deepEqual(await edge.canonicalRecipients(admin, event, creator), expected);
assert(admin.calls.filter((call) => call.table === "group_members").length >= 5, "later membership pages are included");
assert(expected.includes(id(1200)), "late eligible user must survive all filters");
assert(admin.peak <= 8, "two four-chunk branches bound database concurrency");

for (let i = 0; i < users.length; i++) {
  // First 100-user chunk has 1,200 registrations per provider, well within
  // the per-account browser device limit but above PostgREST's cap.
  const registrations = i < 100 ? 12 : 1;
  for (let j = 0; j < registrations; j++) {
    const suffix = `${String(i).padStart(5, "0")}-${String(j).padStart(2, "0")}`;
    tables.device_push_tokens.push({ user_id: users[i], token: `ExponentPushToken[${suffix}]`, preferences: policy, updated_at: "2026-09-08T12:00:00Z" });
    const endpoint = `https://fcm.googleapis.com/wp/${suffix}`;
    tables.web_push_subscriptions.push({ user_id: users[i], endpoint, p256dh: "key", auth: "auth", preferences: policy, updated_at: "2026-09-08T12:00:00Z", expiration_time: null });
    tables.push_token_dispatch_acceptances.push({ event_key: "reminder", user_id: users[i], token: endpoint });
  }
}
// Composite acceptance cursors must escape commas, parentheses, quotes and
// backslashes in capabilities; owner+token remains the idempotency identity.
tables.push_token_dispatch_acceptances.push({ event_key: "reminder", user_id: users[0], token: 'https://fcm.googleapis.com/wp/odd,(token)"\\end' });
tables.push_token_dispatch_acceptances.push({ event_key: "another-event", user_id: users[0], token: "wrong-event" });
const registrations = await edge.discoverPushRegistrations(admin, [...users, users[0]]);
assert.equal(registrations.tokens.length, 2305);
assert.equal(registrations.webSubscriptions.length, 2305);
assert.equal(new Set(registrations.tokens.map((row) => row.token)).size, 2305);
assert.equal(new Set(registrations.webSubscriptions.map((row) => row.endpoint)).size, 2305);
const acceptance = await edge.loadPushAcceptances(admin, "reminder", users);
assert.equal(acceptance.length, 2306);
assert(!acceptance.some((row) => row.token === "wrong-event"));
assert(acceptance.some((row) => row.user_id === id(1205)), "late-owner retry checkpoints must not be missed");
assert.equal(new Set(acceptance.map((row) => `${row.user_id}:${row.token}`)).size, 2306);
const aliases = await edge.recipientChatNicknames(admin, { ...event, category: "chat", data: { senderId: creator } }, users);
assert.equal(aliases.size, 1205);
assert.equal(aliases.get(id(1205)), "Private alias 1205");

const unavailable = { code: "PGRST000", message: "Backend temporarily unavailable" };
await assert.rejects(() => edge.canonicalRecipients(mockAdmin(tables, { fail: (table, count) => table === "group_members" && count === 2 ? unavailable : undefined }), event, creator), (error) => error === unavailable);
await assert.rejects(() => edge.discoverPushRegistrations(mockAdmin(tables, { fail: (table, count) => table === "device_push_tokens" && count === 2 ? unavailable : undefined }), users), (error) => error === unavailable);
await assert.rejects(() => edge.loadPushAcceptances(mockAdmin(tables, { fail: (table, count) => table === "push_token_dispatch_acceptances" && count === 2 ? unavailable : undefined }), "reminder", users), (error) => error === unavailable);
await assert.rejects(() => edge.filterBlockedChatRecipients(mockAdmin(tables, { fail: (table) => table === "user_blocks" ? unavailable : undefined }), event, creator, users), (error) => error === unavailable);
assert.deepEqual(await edge.filterBlockedChatRecipients(mockAdmin(tables, { fail: (table) => table === "user_blocks" ? { message: "relation user_blocks does not exist" } : undefined }), event, creator, users), [], "missing safety tables fail closed");
const legacyWeb = await edge.discoverPushRegistrations(mockAdmin(tables, { fail: (table) => table === "web_push_subscriptions" ? { code: "42P01", message: "relation web_push_subscriptions does not exist" } : undefined }), users);
assert.equal(legacyWeb.tokens.length, 2305); assert.equal(legacyWeb.webSubscriptions.length, 0);
await assert.rejects(() => edge.readPushRows(() => mockAdmin({ rows: Array.from({ length: 500 }, (_, i) => ({ id: String(i).padStart(4, "0") })) }, { stalled: true }).from("rows").select("id"), ["id"]), /cursor did not advance/);
assert.throws(() => edge.assertPushDiscoveryBudget(100001), /bounded discovery budget/);
assert.equal(edge.quotedPushCursor('a,"b\\c'), '"a,\\"b\\\\c"');
assert(source.indexOf("await discoverPushRegistrations(admin, recipientIds)") < source.indexOf('"gateway_accepted"'), "discovery must finish before accepting the canonical event");
assert.match(source, /catch \(error\)[\s\S]*await releaseClaim\(admin, claimedEvent\)/, "discovery errors release the claim for durable retries");
console.log("Push fan-out: 1,205-member audiences, 2,305 registrations per provider, 2,306 exact-owner checkpoints, private aliases, late bidirectional blocks, bounded queries/concurrency and retryable failures passed.");
