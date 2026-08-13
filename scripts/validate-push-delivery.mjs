import assert from "node:assert/strict";
import fs from "node:fs";

import {
  assertPushDeliveryComplete,
  dispatchPushWithBoundedRetry,
} from "../src/domain/pushDelivery.ts";

const read = (file) => fs.readFileSync(file, "utf8");
const push = read("src/notifications/push.ts");
const layout = read("app/_layout.tsx");
const cloud = read("src/cloud/groupCloud.ts");
const challenges = read("src/cloud/groupChallenges.ts");
const edge = read("supabase/functions/send-push/index.ts");

assert.doesNotThrow(() => assertPushDeliveryComplete({ sent: 2 }));
assert.doesNotThrow(() =>
  assertPushDeliveryComplete({ sent: 0, deduplicated: true }),
);
assert.throws(
  () => assertPushDeliveryComplete({ sent: 0, retryable: true }),
  /temporarily unavailable/,
);

let retryAttempts = 0;
const scheduled = [];
await dispatchPushWithBoundedRetry(
  async () => {
    retryAttempts += 1;
    if (retryAttempts === 1)
      assertPushDeliveryComplete({ sent: 0, retryable: true });
  },
  {
    retryDelaysMs: [7, 13],
    schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
  },
);
assert.equal(retryAttempts, 1, "the committed user action must not wait for retries");
assert.deepEqual(scheduled.map(({ delayMs }) => delayMs), [7]);
scheduled.shift().callback();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(retryAttempts, 2, "an explicit retryable response should retry once scheduled");
assert.equal(scheduled.length, 0, "a successful retry must stop the bounded schedule");

assert.match(push, /const registrationExists = await registeredTokenExists/);
assert.match(push, /registerPushToken\([\s\S]{0,220}!registrationExists/);
assert.match(
  push,
  /fetchExpoPushToken\(projectId\)[\s\S]{0,300}registerPushToken\([\s\S]{0,180}language,[\s\S]{0,40}true/,
);
assert.match(
  push,
  /recoverPushRegistrationOnForeground[\s\S]{0,420}notificationPermissionGranted\(\)[\s\S]{0,180}refreshPushTokenRegistration/,
);
assert.match(push, /PUSH_TOKEN_FOREGROUND_REFRESH_MS = 15 \* 60 \* 1000/);
assert.match(layout, /const recover = \(\) =>[\s\S]{0,300}recoverPushRegistrationOnForeground/);
assert.equal(
  (layout.match(/void recover\(\)/g) ?? []).length >= 2,
  true,
  "push recovery must run at cold effect mount and foreground resume",
);
assert.match(layout, /NativeAppState\.addEventListener\([\s\S]{0,220}void recover\(\)/);
assert.match(layout, /foregroundSubscription\.remove\(\)/);
assert.match(cloud, /sendMembershipPush[\s\S]{0,650}dispatchPushWithBoundedRetry/);
assert.equal(
  (cloud.match(/assertPushDeliveryComplete\(result\.data\)/g) ?? []).length >= 4,
  true,
  "membership and chat push paths must retain retryable events",
);
assert.match(challenges, /sendChallengePush[\s\S]{0,650}dispatchPushWithBoundedRetry/);
assert.match(challenges, /assertPushDeliveryComplete\(data\)/);
assert.match(edge, /const eligible=\(tokens\?\?\[\]\)\.filter\(\(item\)=>allowed\(item\.preferences\?\?\{\},payload\)\)/);
assert.match(
  edge,
  /if\(messages\.length\)\{[\s\S]{0,1800}staleTokens\.length===messages\.length[\s\S]{0,240}retryable:true/,
  "only attempted Expo tickets may produce the missing-token retry response",
);
assert.match(edge, /acceptedTicketCount=tickets\.filter\(\(ticket\)=>ticket\.status==='ok'\)\.length/);
assert.match(edge, /tickets\.length!==messages\.length/);
assert.match(
  edge,
  /staleTokens\.length===messages\.length[\s\S]{0,180}push_events[\s\S]{0,180}retryable:true/,
);
assert.match(edge, /return json\(\{sent:acceptedTicketCount\}\)/);

console.log("Push registration recovery and retry semantics validated.");
