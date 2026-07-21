export type FoodProduct = {
  code: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  basis: string;
  calories: number;
  qualityScore: number;
  completeNutrition: boolean;
  source: "Open Food Facts" | "USDA" | "Offline";
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
};

type RawProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  image_front_small_url?: string;
  nutriments?: Record<string, unknown>;
  completeness?: number | string;
  popularity_key?: number | string;
  unique_scans_n?: number | string;
};

const API = "https://world.openfoodfacts.org";
const USDA_API = "https://api.nal.usda.gov/fdc/v1";
const USDA_KEY = process.env.EXPO_PUBLIC_USDA_FDC_API_KEY?.trim();
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map<string, { at: number; products: FoodProduct[] }>();
const FIELDS = [
  "code", "product_name", "brands", "serving_size", "image_front_small_url",
  "nutriments", "completeness", "popularity_key", "unique_scans_n",
].join(",");

const OFFLINE: FoodProduct[] = [
  food("banana", "Banana", 89, 1.1, 0.3, 22.8, 2.6, 1),
  food("apple", "Apple", 52, 0.3, 0.2, 13.8, 2.4, 1),
  food("egg", "Egg, whole", 143, 12.6, 9.5, 0.7, 0, 142),
  food("chicken-breast", "Chicken breast, cooked", 165, 31, 3.6, 0, 0, 74),
  food("white-rice", "White rice, cooked", 130, 2.7, 0.3, 28.2, 0.4, 1),
  food("oats", "Oats, dry", 379, 13.2, 6.5, 67.7, 10.1, 6),
  food("whole-milk", "Whole milk", 61, 3.2, 3.3, 4.8, 0, 43),
  food("greek-yogurt", "Greek yogurt, plain", 73, 10, 1.9, 3.9, 0, 36),
  food("salmon", "Salmon, cooked", 206, 22.1, 12.4, 0, 0, 61),
  food("potato", "Potato, boiled", 87, 1.9, 0.1, 20.1, 1.8, 4),
  food("broccoli", "Broccoli, cooked", 35, 2.4, 0.4, 7.2, 3.3, 41),
  food("olive-oil", "Olive oil", 884, 0, 100, 0, 0, 2),
];

function food(code: string, name: string, calories: number, proteinG: number, fatG: number, carbsG: number, fiberG: number, sodiumMg: number): FoodProduct {
  return { code: `offline:${code}`, name, basis: "100 g", calories, proteinG, fatG, carbsG, fiberG, sodiumMg, source: "Offline", verified: true, completeNutrition: true, qualityScore: 70 };
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseProduct(product: RawProduct): FoodProduct | null {
  const name = product.product_name?.trim();
  const code = product.code?.trim();
  if (!name || !code) return null;
  const nutrients = product.nutriments ?? {};
  const hasServing = number(nutrients["energy-kcal_serving"]) !== undefined;
  const suffix = hasServing ? "serving" : "100g";
  const nutrient = (key: string) => number(nutrients[`${key}_${suffix}`]);
  const calories = nutrient("energy-kcal");
  if (calories === undefined || calories <= 0) return null;
  const sodiumG = nutrient("sodium");
  const nutrientsPresent = [nutrient("proteins"), nutrient("fat"), nutrient("carbohydrates"), nutrient("fiber"), sodiumG].filter((value) => value !== undefined).length;
  const completeness = number(product.completeness) ?? 0;
  const popularity = number(product.popularity_key) ?? number(product.unique_scans_n) ?? 0;
  const completeNutrition = completeness >= 0.8 && nutrientsPresent >= 4;
  return {
    code, name, brand: product.brands?.split(",")[0]?.trim() || undefined,
    imageUrl: product.image_front_small_url,
    basis: hasServing ? product.serving_size?.trim() || "1 serving" : "100 g",
    calories: Math.round(calories), source: "Open Food Facts",
    verified: completeNutrition, completeNutrition,
    qualityScore: completeness * 100 + nutrientsPresent * 8 + Math.log10(popularity + 1) * 6,
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

async function request(url: string, attempts = 3) {
  let last: Error | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(url, { headers: { "User-Agent": "MetricRally/1.0 (mobile food logger)" }, signal: controller.signal });
      if (response.ok) return response.json() as Promise<Record<string, unknown>>;
      last = new Error(`Food database request failed (${response.status}).`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw last;
    } catch (error) {
      last = error instanceof Error ? error : new Error("Food database request failed.");
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
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
  return value.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function matchScore(product: FoodProduct, term: string) {
  const haystack = `${product.name} ${product.brand ?? ""}`.toLocaleLowerCase();
  return words(term).reduce((score, word) => score + (haystack === word ? 80 : haystack.startsWith(word) ? 34 : haystack.includes(word) ? 14 : -8), 0);
}

async function openFoodFactsSearch(term: string) {
  const url = `${API}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=35&sort_by=unique_scans_n&fields=${FIELDS}`;
  const data = await request(url);
  return ((data.products as RawProduct[] | undefined) ?? []).map(parseProduct).filter(Boolean) as FoodProduct[];
}

async function usdaSearch(term: string): Promise<FoodProduct[]> {
  if (!USDA_KEY) return [];
  const url = `${USDA_API}/foods/search?api_key=${encodeURIComponent(USDA_KEY)}&query=${encodeURIComponent(term)}&pageSize=30&dataType=Foundation,SR%20Legacy,Branded`;
  const data = await request(url, 2);
  return ((data.foods as Record<string, any>[] | undefined) ?? []).flatMap((raw) => {
    const nutrients = raw.foodNutrients ?? [];
    const nutrient = (...names: string[]) => number(nutrients.find((item: any) => names.includes(String(item.nutrientName).toLowerCase()))?.value);
    const calories = nutrient("energy", "energy (atwater general factors)");
    if (!raw.description || calories === undefined) return [];
    const verified = raw.dataType === "Foundation" || raw.dataType === "SR Legacy";
    return [{
      code: `usda:${raw.fdcId}`, name: raw.description, brand: raw.brandName,
      basis: "100 g", calories: Math.round(calories), source: "USDA" as const,
      verified, completeNutrition: true, qualityScore: verified ? 150 : 95,
      proteinG: nutrient("protein"), fatG: nutrient("total lipid (fat)"), carbsG: nutrient("carbohydrate, by difference"),
      fiberG: nutrient("fiber, total dietary"), sugarG: nutrient("sugars, total including nlea", "sugars, total"),
      saturatedFatG: nutrient("fatty acids, total saturated"), sodiumMg: nutrient("sodium, na"), cholesterolMg: nutrient("cholesterol"),
      potassiumMg: nutrient("potassium, k"), calciumMg: nutrient("calcium, ca"), ironMg: nutrient("iron, fe"), magnesiumMg: nutrient("magnesium, mg"),
      vitaminCMg: nutrient("vitamin c, total ascorbic acid"), vitaminDMcg: nutrient("vitamin d (d2 + d3)"), vitaminB12Mcg: nutrient("vitamin b-12"),
    }];
  });
}

export async function searchFoods(query: string): Promise<FoodProduct[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const key = term.toLocaleLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.products;
  const offline = OFFLINE.filter((product) => matchScore(product, term) > 0);
  const settled = await Promise.allSettled([openFoodFactsSearch(term), usdaSearch(term)]);
  const remote = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const merged = new Map<string, FoodProduct>();
  for (const product of [...remote, ...offline]) {
    product.qualityScore += matchScore(product, term) + (product.verified ? 45 : 0);
    const duplicateKey = `${product.name.toLocaleLowerCase()}|${product.brand?.toLocaleLowerCase() ?? ""}`;
    const existing = merged.get(duplicateKey);
    if (!existing || product.qualityScore > existing.qualityScore) merged.set(duplicateKey, product);
  }
  const products = [...merged.values()].sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 25);
  if (!products.length && settled.some((result) => result.status === "rejected"))
    throw new Error("Food databases are temporarily busy. Try again shortly.");
  cache.set(key, { at: Date.now(), products });
  return products;
}
