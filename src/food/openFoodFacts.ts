import { getLocales } from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { supabase } from "@/src/lib/supabase";

export type FoodProduct = {
  code: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  basis: string;
  calories: number;
  qualityScore: number;
  completeNutrition: boolean;
  source: "Open Food Facts" | "FatSecret" | "USDA" | "Offline";
  verified?: boolean;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?: number;
  saturatedFatG?: number;
  cholesterolMg?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  magnesiumMg?: number;
  vitaminCMg?: number;
  vitaminDMcg?: number;
  vitaminB12Mcg?: number;
  /** Search-only metadata; the logging UI intentionally ignores these fields. */
  searchAliases?: string[];
  countryTags?: string[];
  popularityScore?: number;
  localeMatch?: boolean;
};

export type FoodSearchOptions = {
  /** Newest first. Used only as a small, on-device tie-breaker. */
  recentLabels?: string[];
};

type RawProduct = {
  code?: string;
  product_name?: string;
  product_name_de?: string;
  product_name_en?: string;
  generic_name?: string;
  generic_name_de?: string;
  generic_name_en?: string;
  categories?: string | string[];
  brands?: string | string[];
  countries_tags?: string[];
  serving_size?: string;
  image_front_small_url?: string;
  nutriments?: Record<string, unknown>;
  completeness?: number | string;
  popularity_key?: number | string;
  unique_scans_n?: number | string;
  scans_n?: number | string;
  states_tags?: string[];
  lang?: string;
  lc?: string;
  [key: string]: unknown;
};

const API = "https://world.openfoodfacts.org";
const SEARCH_API = "https://search.openfoodfacts.org";
const USDA_API = "https://api.nal.usda.gov/fdc/v1";
const USDA_KEY = process.env.EXPO_PUBLIC_USDA_FDC_API_KEY?.trim();
const CACHE_TTL = 30 * 60 * 1000;
const STALE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 18;
const FATSECRET_CLIENT_TIMEOUT_MS = 1800;
const CACHE_STORAGE_KEY = "habhub-food-search-cache-v3";
type FoodCacheEntry = { at: number; products: FoodProduct[] };
const cache = new Map<string, FoodCacheEntry>();
let storedCachePromise: Promise<Record<string, FoodCacheEntry>> | null = null;
const locale = getLocales()[0];
const languageCode = (locale?.languageCode ?? "en").toLowerCase();
const regionCode = (locale?.regionCode ?? "").toLowerCase();
const REGION_TAGS: Record<string, string> = {
  de: "en:germany",
  at: "en:austria",
  ch: "en:switzerland",
  gb: "en:united-kingdom",
  us: "en:united-states",
  ca: "en:canada",
  fr: "en:france",
  es: "en:spain",
  it: "en:italy",
  nl: "en:netherlands",
  be: "en:belgium",
  au: "en:australia",
};
const FIELDS = [
  "code", "product_name", "product_name_de", "product_name_en",
  `product_name_${languageCode}`, "generic_name", "generic_name_de", "generic_name_en",
  `generic_name_${languageCode}`, "lc", "lang",
  "categories", "brands", "countries_tags", "serving_size", "image_front_small_url",
  "nutriments", "completeness", "popularity_key", "unique_scans_n", "scans_n", "states_tags",
].join(",");

const OFFLINE: FoodProduct[] = [
  food("banana", "Banana", 89, 1.1, 0.3, 22.8, 2.6, 1, ["banane", "bananen", "fruit", "obst"]),
  food("apple", "Apple", 52, 0.3, 0.2, 13.8, 2.4, 1, ["apfel", "aepfel", "fruit", "obst"]),
  food("egg", "Egg, whole", 143, 12.6, 9.5, 0.7, 0, 142, ["eggs", "ei", "eier"]),
  food("chicken-breast", "Chicken breast, cooked", 165, 31, 3.6, 0, 0, 74, ["chicken", "haehnchenbrust", "huehnerbrust"]),
  food("white-rice", "White rice, cooked", 130, 2.7, 0.3, 28.2, 0.4, 1, ["rice", "reis"]),
  food("oats", "Oats, dry", 379, 13.2, 6.5, 67.7, 10.1, 6, ["oatmeal", "hafer", "haferflocken"]),
  food("whole-milk", "Whole milk", 61, 3.2, 3.3, 4.8, 0, 43, ["milk", "milch", "vollmilch"]),
  food("greek-yogurt", "Greek yogurt, plain", 73, 10, 1.9, 3.9, 0, 36, ["yoghurt", "joghurt", "griechischer joghurt"]),
  food("salmon", "Salmon, cooked", 206, 22.1, 12.4, 0, 0, 61, ["lachs"]),
  food("potato", "Potato, boiled", 87, 1.9, 0.1, 20.1, 1.8, 4, ["potatoes", "kartoffel", "kartoffeln"]),
  food("broccoli", "Broccoli, cooked", 35, 2.4, 0.4, 7.2, 3.3, 41),
  food("olive-oil", "Olive oil", 884, 0, 100, 0, 0, 2, ["olivenoel", "olivenol"]),
];

function food(code: string, name: string, calories: number, proteinG: number, fatG: number, carbsG: number, fiberG: number, sodiumMg: number, searchAliases: string[] = []): FoodProduct {
  return { code: `offline:${code}`, name, basis: "100 g", calories, proteinG, fatG, carbsG, fiberG, sodiumMg, source: "Offline", verified: true, completeNutrition: true, qualityScore: 70, searchAliases };
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown) {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? value.split(",") : [];
}

function parseProduct(product: RawProduct): FoodProduct | null {
  const localizedName = text(product[`product_name_${languageCode}`]);
  const name = (
    localizedName ??
    product.product_name ??
    product.generic_name
  )?.trim();
  const code = product.code?.trim();
  if (!name || !code) return null;
  const nutrients = product.nutriments ?? {};
  // Prefer per-100g data so products remain comparable and the amount control
  // has a predictable basis. Fall back to a serving only when 100g is absent.
  const hasPer100g = number(nutrients["energy-kcal_100g"]) !== undefined;
  const suffix = hasPer100g ? "100g" : "serving";
  const nutrient = (key: string) => number(nutrients[`${key}_${suffix}`]);
  const calories = nutrient("energy-kcal");
  if (calories === undefined || calories <= 0) return null;
  const sodiumG = nutrient("sodium");
  const nutrientsPresent = [nutrient("proteins"), nutrient("fat"), nutrient("carbohydrates"), nutrient("fiber"), sodiumG].filter((value) => value !== undefined).length;
  const completeness = number(product.completeness) ?? 0;
  const popularity =
    number(product.popularity_key) ??
    number(product.unique_scans_n) ??
    number(product.scans_n) ??
    0;
  const countryTags = product.countries_tags ?? [];
  const localeMatch = Boolean(
    REGION_TAGS[regionCode] && countryTags.includes(REGION_TAGS[regionCode]),
  );
  const completeNutrition = Boolean(
    nutrientsPresent >= 4 &&
      (completeness >= 0.8 ||
        product.states_tags?.includes("en:nutrition-facts-completed")),
  );
  const localizedGeneric = text(product[`generic_name_${languageCode}`]);
  const aliases = [
    product.product_name,
    product.product_name_de,
    product.product_name_en,
    localizedGeneric,
    product.generic_name,
    product.generic_name_de,
    product.generic_name_en,
    ...strings(product.categories),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value !== name));
  return {
    code, name, brand: strings(product.brands)[0]?.trim() || undefined,
    imageUrl: product.image_front_small_url,
    basis: hasPer100g ? "100 g" : product.serving_size?.trim() || "1 serving",
    calories: Math.round(calories), source: "Open Food Facts",
    // Open Food Facts is community supplied. Completeness is useful, but it is
    // not independent verification and should not be labelled as such.
    verified: false, completeNutrition,
    qualityScore:
      completeness * 100 +
      nutrientsPresent * 8 +
      Math.log10(popularity + 1) * 6 +
      (localeMatch ? 55 : 0) +
      (localizedName ? 18 : 0),
    searchAliases: [...new Set(aliases)],
    countryTags,
    popularityScore: popularity,
    localeMatch,
    proteinG: nutrient("proteins"), fatG: nutrient("fat"), carbsG: nutrient("carbohydrates"), fiberG: nutrient("fiber"),
    sodiumMg: sodiumG === undefined ? undefined : sodiumG * 1000,
    sugarG: nutrient("sugars"), saturatedFatG: nutrient("saturated-fat"),
    cholesterolMg: multiply(nutrient("cholesterol"), 1000), potassiumMg: multiply(nutrient("potassium"), 1000),
    calciumMg: multiply(nutrient("calcium"), 1000), ironMg: multiply(nutrient("iron"), 1000),
    magnesiumMg: multiply(nutrient("magnesium"), 1000), vitaminCMg: multiply(nutrient("vitamin-c"), 1000),
    vitaminDMcg: multiply(nutrient("vitamin-d"), 1_000_000), vitaminB12Mcg: multiply(nutrient("vitamin-b12"), 1_000_000),
  };
}

function multiply(value: number | undefined, factor: number) {
  return value === undefined ? undefined : value * factor;
}

async function storedCache() {
  if (!storedCachePromise) {
    storedCachePromise = AsyncStorage.getItem(CACHE_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, FoodCacheEntry>;
        return Object.fromEntries(
          Object.entries(parsed).filter(
            ([, entry]) =>
              Number.isFinite(entry?.at) && Array.isArray(entry?.products),
          ),
        );
      })
      .catch(() => ({}));
  }
  return storedCachePromise;
}

async function cachedProducts(key: string) {
  const memory = cache.get(key);
  const entry = memory ?? (await storedCache())[key];
  if (!entry) return { fresh: undefined, stale: undefined };
  cache.set(key, entry);
  const age = Date.now() - entry.at;
  return {
    fresh: age < CACHE_TTL ? entry.products : undefined,
    stale: age < STALE_CACHE_TTL ? entry.products : undefined,
  };
}

async function rememberProducts(key: string, products: FoodProduct[]) {
  const entry = { at: Date.now(), products };
  cache.set(key, entry);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  const stored = await storedCache();
  stored[key] = entry;
  const trimmed = Object.fromEntries(
    Object.entries(stored)
      .filter(([, value]) => Date.now() - value.at < STALE_CACHE_TTL)
      .sort(([, left], [, right]) => right.at - left.at)
      .slice(0, CACHE_LIMIT),
  );
  storedCachePromise = Promise.resolve(trimmed);
  await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(trimmed));
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function request(url: string, attempts = 3) {
  let last: Error | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    let serverDelay: number | undefined;
    let retryable = true;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Accept-Language": [languageCode, "en"].filter(Boolean).join(","),
      };
      // Browsers control User-Agent themselves; native fetch permits the
      // identifying header requested by Open Food Facts.
      if (Platform.OS !== "web")
        headers["User-Agent"] = "HabHub/1.0 (https://habhub.expo.app)";
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.ok) return response.json() as Promise<Record<string, unknown>>;
      last = new Error(`Food database request failed (${response.status}).`);
      retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!retryable) throw last;
      serverDelay = retryAfterMs(response.headers.get("retry-after"));
    } catch (error) {
      last = error instanceof Error ? error : new Error("Food database request failed.");
    } finally {
      clearTimeout(timeout);
    }
    if (!retryable) throw last;
    if (attempt < attempts - 1)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, serverDelay ?? 450 * 2 ** attempt)),
      );
  }
  throw last ?? new Error("Food database request failed.");
}

export async function foodByBarcode(barcode: string) {
  const code = barcode.replace(/\D/g, "");
  if (!code) return null;
  const data = await request(`${API}/api/v3/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  return data.product ? parseProduct(data.product as RawProduct) : null;
}

function words(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => TOKEN_EQUIVALENTS[word] ?? word);
}

const TOKEN_EQUIVALENTS: Record<string, string> = {
  bananas: "banana",
  banane: "banana",
  bananen: "banana",
  apples: "apple",
  apfel: "apple",
  kartoffeln: "kartoffel",
  potatoes: "potato",
  eier: "egg",
  eggs: "egg",
  haferflocken: "oats",
  yoghurt: "yogurt",
  joghurt: "yogurt",
};

function tokenMatch(candidate: string, query: string) {
  if (candidate === query) return 1;
  if (
    Math.min(candidate.length, query.length) >= 4 &&
    (candidate.startsWith(query) || query.startsWith(candidate))
  )
    return 0.55;
  return 0;
}

function matchScore(product: FoodProduct, term: string) {
  const query = words(term);
  const name = words(product.name);
  const brand = words(product.brand ?? "");
  if (!query.length) return 0;
  const aliases = (product.searchAliases ?? []).map(words);
  const queryPhrase = query.join(" ");
  const namePhrase = name.join(" ");
  const aliasPhrases = aliases.map((tokens) => tokens.join(" "));
  const exactName = namePhrase === queryPhrase;
  const exactAlias = aliasPhrases.includes(queryPhrase);
  const phraseStart = namePhrase.startsWith(queryPhrase);
  const containsPhrase = namePhrase.includes(queryPhrase);
  let matched = 0;
  const relevance = query.reduce((score, queryWord) => {
    const nameMatch = Math.max(...name.map((word) => tokenMatch(word, queryWord)), 0);
    const aliasMatch = Math.max(
      ...aliases.flat().map((word) => tokenMatch(word, queryWord)),
      0,
    );
    const brandMatch = Math.max(...brand.map((word) => tokenMatch(word, queryWord)), 0);
    const best = Math.max(nameMatch, aliasMatch, brandMatch);
    if (best > 0) matched += 1;
    if (nameMatch) return score + Math.round(180 * nameMatch);
    if (aliasMatch) return score + Math.round(130 * aliasMatch);
    if (brandMatch) return score + Math.round(90 * brandMatch);
    return score - 260;
  }, 0);
  if (!matched || matched / query.length < 0.66) return 0;
  const preparationPenalty = [
    "smoothie",
    "pudding",
    "shake",
    "flavour",
    "flavored",
    "dessert",
    "bar",
    "drink",
    "saft",
    "nektar",
    "riegel",
    "geschmack",
  ].some((word) => name.includes(word) && !query.includes(word))
    ? 260
    : 0;
  return (
    relevance +
    (exactName
      ? 1400
      : exactAlias
        ? 1100
      : phraseStart
        ? 620
        : containsPhrase
          ? 480
          : 0) -
    preparationPenalty -
    Math.min(180, Math.max(0, name.length - query.length) * 12)
  );
}

async function searchALicious(term: string) {
  const parameters = new URLSearchParams({
    q: term,
    langs: [...new Set([languageCode, "en"])].join(","),
    page_size: "50",
    page: "1",
    boost_phrase: "true",
    fields: FIELDS,
  });
  const data = await request(
    `${SEARCH_API}/search?${parameters.toString()}`,
    2,
  );
  return ((data.hits as RawProduct[] | undefined) ?? [])
    .map(parseProduct)
    .filter(Boolean) as FoodProduct[];
}

async function legacyOpenFoodFactsSearch(term: string) {
  const parameters = new URLSearchParams({
    search_terms: term,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "50",
    sort_by: "popularity_key",
    fields: FIELDS,
    lc: languageCode,
  });
  if (regionCode) parameters.set("cc", regionCode);
  const url = `${API}/cgi/search.pl?${parameters.toString()}`;
  const data = await request(url, 1);
  return ((data.products as RawProduct[] | undefined) ?? []).map(parseProduct).filter(Boolean) as FoodProduct[];
}

async function openFoodFactsSearch(term: string) {
  try {
    return await searchALicious(term);
  } catch {
    // Search-a-licious is the current full-text service. Retain the legacy
    // endpoint only as a sequential fallback for temporary service outages.
    return legacyOpenFoodFactsSearch(term);
  }
}

async function usdaSearch(term: string): Promise<FoodProduct[]> {
  if (!USDA_KEY) return [];
  const parameters = new URLSearchParams({
    api_key: USDA_KEY,
    query: term,
    pageSize: "40",
    dataType: "Foundation,SR Legacy,Survey (FNDDS),Branded",
  });
  const url = `${USDA_API}/foods/search?${parameters.toString()}`;
  const data = await request(url, 2);
  return ((data.foods as Record<string, any>[] | undefined) ?? []).flatMap((raw) => {
    const nutrients = raw.foodNutrients ?? [];
    const nutrient = (...names: string[]) => number(nutrients.find((item: any) => names.includes(String(item.nutrientName).toLowerCase()))?.value);
    const calories = number(
      nutrients.find(
        (item: any) =>
          (String(item.nutrientNumber) === "208" ||
            Number(item.nutrientId) === 1008 ||
            String(item.nutrientName).toLowerCase() === "energy") &&
          String(item.unitName).toLowerCase() === "kcal",
      )?.value,
    );
    if (!raw.description || calories === undefined) return [];
    const verified = ["Foundation", "SR Legacy", "Survey (FNDDS)"].includes(raw.dataType);
    const macros = [nutrient("protein"), nutrient("total lipid (fat)"), nutrient("carbohydrate, by difference"), nutrient("fiber, total dietary")];
    const completeNutrition = macros.filter((value) => value !== undefined).length >= 3;
    return [{
      code: `usda:${raw.fdcId}`, name: raw.description, brand: raw.brandName,
      basis: "100 g", calories: Math.round(calories), source: "USDA" as const,
      verified, completeNutrition, qualityScore: verified ? 160 : 95,
      searchAliases: [raw.additionalDescriptions, raw.foodCategory, raw.brandOwner].filter(Boolean),
      proteinG: nutrient("protein"), fatG: nutrient("total lipid (fat)"), carbsG: nutrient("carbohydrate, by difference"),
      fiberG: nutrient("fiber, total dietary"), sugarG: nutrient("sugars, total including nlea", "sugars, total"),
      saturatedFatG: nutrient("fatty acids, total saturated"), sodiumMg: nutrient("sodium, na"), cholesterolMg: nutrient("cholesterol"),
      potassiumMg: nutrient("potassium, k"), calciumMg: nutrient("calcium, ca"), ironMg: nutrient("iron, fe"), magnesiumMg: nutrient("magnesium, mg"),
      vitaminCMg: nutrient("vitamin c, total ascorbic acid"), vitaminDMcg: nutrient("vitamin d (d2 + d3)"), vitaminB12Mcg: nutrient("vitamin b-12"),
    }];
  });
}

type FatSecretProduct = Omit<
  FoodProduct,
  "source" | "localeMatch" | "countryTags"
> & {
  market?: string;
};

async function fatSecretSearch(term: string): Promise<FoodProduct[]> {
  if (!supabase) return [];
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Race the complete supplemental path, including the local session read.
    // AbortSignal cancels the network request where supported; the race still
    // releases food search on time if a native fetch implementation is slow to
    // observe cancellation.
    const request = (async () => {
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session) return null;
      return supabase.functions.invoke("fatsecret-food-search", {
        body: {
          query: term,
          region: regionCode.toUpperCase(),
          language: languageCode,
        },
        signal: controller.signal,
      });
    })();
    const deadline = new Promise<null>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, FATSECRET_CLIENT_TIMEOUT_MS);
    });
    const result = await Promise.race([request, deadline]);
    if (!result) return [];
    const { data, error } = result;
    if (error) return [];
    const products = Array.isArray(data?.products)
      ? (data.products as FatSecretProduct[])
      : [];
    return products.flatMap((raw) => {
      const calories = number(raw.calories);
      const name = text(raw.name);
      const code = text(raw.code);
      if (!name || !code || calories === undefined || calories <= 0) return [];
      const market = text(raw.market)?.toLowerCase() ?? "us";
      return [
        {
          ...raw,
          code,
          name,
          calories,
          source: "FatSecret" as const,
          countryTags: [`fatsecret:${market}`],
          localeMatch: market === regionCode,
        },
      ];
    });
  } catch {
    return [];
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function recentBoost(product: FoodProduct, recentLabels: string[]) {
  const name = words(product.name).join(" ");
  const brand = words(product.brand ?? "").join(" ");
  for (let index = 0; index < Math.min(30, recentLabels.length); index += 1) {
    const recent = words(recentLabels[index]).join(" ");
    if (
      recent === name ||
      recent.startsWith(`${name} `) ||
      (brand && recent.includes(name) && recent.includes(brand))
    )
      return Math.max(20, 180 - index * 6);
  }
  return 0;
}

function duplicateKey(product: FoodProduct) {
  return `${words(product.name).join(" ")}|${words(product.brand ?? "").join(" ")}`;
}

function rankFoods(
  candidates: FoodProduct[],
  term: string,
  options: FoodSearchOptions,
) {
  const merged = new Map<string, FoodProduct>();
  for (const sourceProduct of candidates) {
    const relevance = matchScore(sourceProduct, term);
    if (relevance <= 0) continue;
    const popularity = Math.log10((sourceProduct.popularityScore ?? 0) + 1) * 8;
    const product = {
      ...sourceProduct,
      qualityScore:
        relevance * 1000 +
        recentBoost(sourceProduct, options.recentLabels ?? []) * 10 +
        Math.min(240, sourceProduct.qualityScore) +
        (sourceProduct.completeNutrition ? 110 : 0) +
        (sourceProduct.verified ? 90 : 0) +
        (sourceProduct.localeMatch ? 75 : 0) +
        (sourceProduct.source === "Offline" ? 120 : 0) +
        (sourceProduct.source === "Open Food Facts" && regionCode !== "us" ? 20 : 0) +
        (sourceProduct.source === "FatSecret"
          ? sourceProduct.localeMatch
            ? 95
            : -160
          : 0) +
        popularity,
    };
    const key = duplicateKey(product);
    const existing = merged.get(key);
    if (!existing || product.qualityScore > existing.qualityScore)
      merged.set(key, product);
  }
  return [...merged.values()]
    .sort(
      (left, right) =>
        right.qualityScore - left.qualityScore ||
        Number(right.completeNutrition) - Number(left.completeNutrition) ||
        Number(right.verified) - Number(left.verified) ||
        left.name.localeCompare(right.name, languageCode) ||
        left.code.localeCompare(right.code),
    )
    .slice(0, 25);
}

export async function searchFoods(
  query: string,
  options: FoodSearchOptions = {},
): Promise<FoodProduct[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const key = `${languageCode}-${regionCode}:${term.toLocaleLowerCase()}`;
  const cached = await cachedProducts(key);
  if (cached.fresh)
    return rankFoods([...cached.fresh, ...OFFLINE], term, options);
  const searches: Promise<FoodProduct[]>[] = [openFoodFactsSearch(term)];
  // FoodData Central keys are free, but must not be embedded in source. It is a
  // useful second provider when a deployment supplies its public search key.
  if (USDA_KEY) searches.push(usdaSearch(term));
  searches.push(fatSecretSearch(term));
  const settled = await Promise.allSettled(searches);
  const remote = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const candidates = remote.length ? remote : (cached.stale ?? []);
  const products = rankFoods([...candidates, ...OFFLINE], term, options);
  if (!products.length && settled.some((result) => result.status === "rejected"))
    throw new Error("Food databases are temporarily busy. Try again shortly.");
  if (settled.some((result) => result.status === "fulfilled"))
    void rememberProducts(key, remote).catch(() => undefined);
  return products;
}
