import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const CACHE_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 120;
const SEARCH_TIMEOUT_MS = 3500;
const TOKEN_TIMEOUT_MS = 3500;

type Token = { value: string; expiresAt: number };
type CachedSearch = { expiresAt: number; payload: SearchPayload };
type SearchPayload = {
  products: NormalizedFood[];
  market: string;
};
type RawFood = {
  food_id?: unknown;
  food_name?: unknown;
  brand_name?: unknown;
  food_type?: unknown;
  food_description?: unknown;
};
type NormalizedFood = {
  code: string;
  name: string;
  brand?: string;
  basis: string;
  calories: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  completeNutrition: boolean;
  verified: boolean;
  qualityScore: number;
  market: string;
};

let token: Token | undefined;
let tokenRequest: Promise<Token> | undefined;
const cache = new Map<string, CachedSearch>();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data } = await supabase.auth.getUser();
    if (!data.user) return json({ error: "Unauthorized" }, 401);

    const body = (await request.json()) as {
      query?: unknown;
      region?: unknown;
      language?: unknown;
    };
    const query = cleanText(body.query, 100);
    if (!query || query.length < 2)
      return json({ error: "Enter at least two characters." }, 400);

    const requestedRegion = cleanCode(body.region, 2, "US");
    const requestedLanguage = cleanLanguage(body.language);
    const localizationEnabled =
      Deno.env.get("FATSECRET_LOCALIZATION_ENABLED") === "true";
    // Basic and Premier Free credentials are US-only. Only send localization
    // parameters when the deployment explicitly confirms market access.
    const market = localizationEnabled ? requestedRegion : "US";
    const key = `${market}:${requestedLanguage}:${query.toLocaleLowerCase()}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now())
      return json(cached.payload, 200, "private, max-age=300");

    const accessToken = await getAccessToken();
    const parameters = new URLSearchParams({
      search_expression: query,
      max_results: "35",
      page_number: "0",
      format: "json",
    });
    if (localizationEnabled) {
      parameters.set("region", market);
      parameters.set("language", requestedLanguage);
    }
    const response = await timedFetch(
      `https://platform.fatsecret.com/rest/foods/search/v1?${parameters}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      SEARCH_TIMEOUT_MS,
    );
    if (!response.ok)
      throw new Error(`FatSecret search returned ${response.status}`);
    const raw = (await response.json()) as {
      foods?: { food?: RawFood | RawFood[] };
      error?: { code?: unknown; message?: unknown };
    };
    if (raw.error) {
      const code = cleanText(String(raw.error.code ?? ""), 24) ?? "unknown";
      throw new Error(`FatSecret API error ${code}`);
    }
    const foods = raw.foods?.food
      ? Array.isArray(raw.foods.food)
        ? raw.foods.food
        : [raw.foods.food]
      : [];
    const payload: SearchPayload = {
      market,
      products: foods.flatMap((food) => normalizeFood(food, market)),
    };
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, payload });
    trimCache();
    return json(payload, 200, "private, max-age=300");
  } catch (error) {
    console.error(
      "FatSecret proxy failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return json({ error: "Supplemental food search is unavailable." }, 503);
  }
});

async function getAccessToken() {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  if (!tokenRequest) {
    tokenRequest = requestAccessToken().finally(() => {
      tokenRequest = undefined;
    });
  }
  token = await tokenRequest;
  return token.value;
}

async function requestAccessToken(): Promise<Token> {
  const clientId = Deno.env.get("FATSECRET_CLIENT_ID");
  const clientSecret = Deno.env.get("FATSECRET_CLIENT_SECRET");
  if (!clientId || !clientSecret)
    throw new Error("FatSecret credentials are not configured");
  const scope = Deno.env.get("FATSECRET_SCOPE")?.trim() || "basic";
  const response = await timedFetch(
    "https://oauth.fatsecret.com/connect/token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope,
      }),
    },
    TOKEN_TIMEOUT_MS,
  );
  if (!response.ok)
    throw new Error(`FatSecret OAuth returned ${response.status}`);
  const payload = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  const value = cleanText(payload.access_token, 4096);
  const seconds = Number(payload.expires_in);
  if (!value) throw new Error("FatSecret OAuth returned no access token");
  return {
    value,
    expiresAt:
      Date.now() +
      Math.max(300, Number.isFinite(seconds) ? seconds : 3600) * 1000,
  };
}

function normalizeFood(food: RawFood, market: string): NormalizedFood[] {
  const id = cleanText(food.food_id, 80);
  const name = cleanText(food.food_name, 180);
  const description = cleanText(food.food_description, 500);
  if (!id || !name || !description) return [];
  const nutrition = parseDescription(description);
  if (!nutrition.calories || nutrition.calories <= 0) return [];
  const brand = cleanText(food.brand_name, 120);
  const completeNutrition = [
    nutrition.proteinG,
    nutrition.fatG,
    nutrition.carbsG,
  ].every((value) => value !== undefined);
  return [
    {
      code: `fatsecret:${id}`,
      name,
      ...(brand ? { brand } : {}),
      basis: nutrition.basis,
      calories: nutrition.calories,
      proteinG: nutrition.proteinG,
      fatG: nutrition.fatG,
      carbsG: nutrition.carbsG,
      completeNutrition,
      verified: true,
      qualityScore: food.food_type === "Generic" ? 175 : 165,
      market,
    },
  ];
}

function parseDescription(description: string) {
  const [basisPart] = description.split(/\s+-\s+/, 1);
  const nutrient = (label: string) => {
    const match = description.match(
      new RegExp(`${label}:\\s*([0-9]+(?:[.,][0-9]+)?)`, "i"),
    );
    if (!match) return undefined;
    const value = Number(match[1].replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  return {
    basis: basisPart.replace(/^per\s+/i, "").trim() || "1 serving",
    calories: nutrient("Calories"),
    fatG: nutrient("Fat"),
    carbsG: nutrient("Carbs"),
    proteinG: nutrient("Protein"),
  };
}

async function timedFetch(
  input: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : undefined;
}

function cleanCode(value: unknown, length: number, fallback: string) {
  const code = cleanText(value, length)?.toUpperCase();
  return code && new RegExp(`^[A-Z]{${length}}$`).test(code) ? code : fallback;
}

function cleanLanguage(value: unknown) {
  const language = cleanText(value, 8) ?? "en";
  return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(language) ? language : "en";
}

function trimCache() {
  for (const [key, value] of cache) {
    if (value.expiresAt <= Date.now()) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES)
    cache.delete(cache.keys().next().value!);
}

function json(body: unknown, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Cache-Control": cacheControl,
      "Content-Type": "application/json",
    },
  });
}
