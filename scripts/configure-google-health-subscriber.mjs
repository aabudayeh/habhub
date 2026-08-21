import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";

const API_ROOT = "https://health.googleapis.com/v4";
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DATA_TYPES = [
  "steps",
  "exercise",
  "body-fat",
  "heart-rate",
  "blood-glucose",
  "sleep",
  "hydration-log",
  "nutrition-log",
  "weight",
];
const checkOnly = process.argv.includes("--check");

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const projectNumber = required("GOOGLE_HEALTH_PROJECT_NUMBER");
const subscriberId = process.env.GOOGLE_HEALTH_SUBSCRIBER_ID?.trim() || "habhub-web";
const webhookUrl = required("GOOGLE_HEALTH_WEBHOOK_URL");
const credentialsPath = required("GOOGLE_APPLICATION_CREDENTIALS");
assert.match(projectNumber, /^\d+$/, "use the numeric Google Cloud project number, not project ID");
assert.match(subscriberId, /^[a-z](?:[a-z0-9-]{2,34}[a-z0-9])$/, "invalid 4-36 character subscriber ID");
const endpoint = new URL(webhookUrl);
assert.equal(endpoint.protocol, "https:");
assert.equal(endpoint.username || endpoint.password || endpoint.search || endpoint.hash, "");

const encoded = (value) => Buffer.from(value).toString("base64url");
const serviceAccount = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
assert.equal(serviceAccount.type, "service_account");
assert.equal(typeof serviceAccount.client_email, "string");
assert.equal(typeof serviceAccount.private_key, "string");
const tokenUri = new URL(serviceAccount.token_uri || "https://oauth2.googleapis.com/token");
assert.equal(tokenUri.protocol, "https:");

const issuedAt = Math.floor(Date.now() / 1000);
const jwtHeader = encoded(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const jwtPayload = encoded(JSON.stringify({
  iss: serviceAccount.client_email,
  scope: CLOUD_SCOPE,
  aud: tokenUri.toString(),
  iat: issuedAt,
  exp: issuedAt + 3600,
}));
const unsigned = `${jwtHeader}.${jwtPayload}`;
const assertion = `${unsigned}.${crypto.sign("RSA-SHA256", Buffer.from(unsigned), serviceAccount.private_key).toString("base64url")}`;
const tokenResponse = await fetch(tokenUri, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }),
});
if (!tokenResponse.ok) throw new Error(`service-account token request failed (${tokenResponse.status})`);
const token = await tokenResponse.json();
if (!token.access_token) throw new Error("service-account token response contained no access token");

async function request(path, init = {}) {
  const response = await fetch(`${API_ROOT}/${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token.access_token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const status = payload?.error?.status || "GOOGLE_HEALTH_ERROR";
    throw new Error(`${status} (${response.status})`);
  }
  return payload;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function awaitOperation(payload) {
  const operationName = typeof payload?.name === "string" &&
      (payload.name.includes("/operations/") || payload.name.startsWith("operations/"))
    ? payload.name
    : undefined;
  if (!operationName) return payload;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const operation = await request(operationName);
    if (operation.done) {
      if (operation.error)
        throw new Error(`${operation.error.status || "GOOGLE_HEALTH_OPERATION_FAILED"}`);
      return operation.response ?? operation;
    }
    await delay(2_000);
  }
  throw new Error("Google Health subscriber operation timed out");
}

async function activeSubscriber(parent, name) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const listed = await request(`${parent}/subscribers`);
    const candidate = (listed.subscribers || []).find((item) => item.name === name);
    if (candidate?.state === "ACTIVE") return candidate;
    if (attempt < 14) await delay(1_000);
  }
  return undefined;
}

const parent = `projects/${projectNumber}`;
const name = `${parent}/subscribers/${subscriberId}`;
const listed = await request(`${parent}/subscribers`);
let subscriber = (listed.subscribers || []).find((candidate) => candidate.name === name);
const expectedConfig = [{ dataTypes: DATA_TYPES, subscriptionCreatePolicy: "AUTOMATIC" }];

if (!checkOnly) {
  const authorization = required("GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION");
  if (!/^(?:Bearer|Basic)\s+\S+$/i.test(authorization))
    throw new Error("GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION must be a full Bearer or Basic header value");
  const body = {
    endpointUri: endpoint.toString(),
    subscriberConfigs: expectedConfig,
    endpointAuthorization: { secret: authorization },
  };
  if (subscriber) {
    const operation = await request(`${name}?updateMask=endpointUri,subscriberConfigs,endpointAuthorization`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await awaitOperation(operation);
  } else {
    const operation = await request(`${parent}/subscribers?subscriberId=${encodeURIComponent(subscriberId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    await awaitOperation(operation);
  }
  subscriber = await activeSubscriber(parent, name);
}

if (!subscriber) throw new Error(`${name} is not registered`);
assert.equal(subscriber.endpointUri, endpoint.toString(), "subscriber endpoint differs from expected URL");
assert.equal(subscriber.state, "ACTIVE", "subscriber is not ACTIVE");
assert.equal(subscriber.endpointAuthorization?.secretSet ?? subscriber.endpointAuthorization?.authorizationTokenSet, true);
const automaticTypes = new Set((subscriber.subscriberConfigs || [])
  .filter((config) => config.subscriptionCreatePolicy === "AUTOMATIC")
  .flatMap((config) => config.dataTypes || []));
assert.deepEqual([...automaticTypes].sort(), [...DATA_TYPES].sort());
console.log(`Verified ACTIVE AUTOMATIC subscriber ${name} for ${DATA_TYPES.length} supported data types.`);
