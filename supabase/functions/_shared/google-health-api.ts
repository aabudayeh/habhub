import { googleError, fetchWithTimeout } from "./google-health-http.ts";

const API_ROOT = "https://health.googleapis.com/v4";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const MIN_HEALTH_REQUEST_INTERVAL_MS = 450;
let lastHealthRequestStartedAt = 0;
let healthRequestGate: Promise<void> = Promise.resolve();

async function paceHealthRequest() {
  const turn = healthRequestGate.then(async () => {
    const wait = Math.max(0, lastHealthRequestStartedAt + MIN_HEALTH_REQUEST_INTERVAL_MS - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastHealthRequestStartedAt = Date.now();
  });
  healthRequestGate = turn.catch(() => undefined);
  await turn;
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
};

export type GoogleHealthIdentity = {
  healthUserId: string;
};

export type GoogleHealthDataPoint = Record<string, unknown> & {
  dataPointName?: string;
};

export async function exchangeAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw await googleError(response);
  const token = await response.json() as Partial<GoogleTokenResponse>;
  if (!token.access_token || !token.refresh_token)
    throw new Error("Google did not return the required offline refresh token");
  return token as GoogleTokenResponse & { refresh_token: string };
}

export async function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw await googleError(response);
  const token = await response.json() as Partial<GoogleTokenResponse>;
  if (!token.access_token) throw new Error("Google returned no access token");
  return token as GoogleTokenResponse;
}

export async function revokeGoogleToken(token: string) {
  const response = await fetchWithTimeout(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  // Google treats an already-invalid token as an idempotent disconnect from
  // HabHub's perspective.  Callers still delete their encrypted local copy.
  if (!response.ok && response.status !== 400) throw await googleError(response);
}

async function authorizedJson<T>(
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      // The unverified <=100-user pilot is limited to 2.5 QPS per user. A
      // database lease prevents same-user parallel invocations; this gate also
      // spaces pagination/retries inside one Edge isolate to <=2.22 QPS.
      await paceHealthRequest();
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      headers.set("Authorization", `Bearer ${accessToken}`);
      if (init.body) headers.set("Content-Type", "application/json");
      response = await fetchWithTimeout(url, {
        ...init,
        headers,
      }, 20_000);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Google Health request failed");
      if (lastError.name === "AbortError" && attempt === 3) throw lastError;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt + Math.random() * 200));
        continue;
      }
      throw lastError;
    }
    if (response.ok) return await response.json() as T;
    const error = await googleError(response);
    if (response.status !== 429 && response.status < 500) throw error;
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt + Math.random() * 200));
  }
  throw lastError ?? new Error("Google Health request failed");
}

export async function getGoogleHealthIdentity(accessToken: string) {
  const identity = await authorizedJson<Partial<GoogleHealthIdentity>>(
    accessToken,
    `${API_ROOT}/users/me/identity`,
  );
  if (!identity.healthUserId || !/^[A-Za-z0-9-]{1,63}$/.test(identity.healthUserId))
    throw new Error("Google Health returned an invalid user identity");
  return identity as GoogleHealthIdentity;
}

export type CivilDate = { year: number; month: number; day: number };

function civilDate(date: string): CivilDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Invalid civil date");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export async function dailyRollUp(
  accessToken: string,
  dataType: string,
  fromDate: string,
  throughDateExclusive: string,
) {
  return authorizedJson<{
    rollupDataPoints?: GoogleHealthDataPoint[];
    nextPageToken?: string;
  }>(
    accessToken,
    `${API_ROOT}/users/me/dataTypes/${encodeURIComponent(dataType)}/dataPoints:dailyRollUp`,
    {
      method: "POST",
      body: JSON.stringify({
        range: {
          start: { date: civilDate(fromDate), time: {} },
          end: { date: civilDate(throughDateExclusive), time: {} },
        },
        windowSizeDays: 1,
        pageSize: 100,
        dataSourceFamily: "users/me/dataSourceFamilies/all-sources",
      }),
    },
  );
}

export async function reconcileDataPoints(
  accessToken: string,
  dataType: string,
  filter: string,
  pageSize: number,
) {
  const output: GoogleHealthDataPoint[] = [];
  let pageToken = "";
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({
      pageSize: String(pageSize),
      filter,
      dataSourceFamily: "users/me/dataSourceFamilies/all-sources",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await authorizedJson<{
      dataPoints?: GoogleHealthDataPoint[];
      nextPageToken?: string;
    }>(
      accessToken,
      `${API_ROOT}/users/me/dataTypes/${encodeURIComponent(dataType)}/dataPoints:reconcile?${query}`,
    );
    output.push(...(response.dataPoints ?? []));
    pageToken = response.nextPageToken ?? "";
    if (!pageToken) return output;
  }
  throw new Error(`Google Health pagination limit exceeded for ${dataType}`);
}
