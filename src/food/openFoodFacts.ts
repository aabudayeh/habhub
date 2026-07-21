export type FoodProduct = {
  code: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  basis: string;
  calories: number;
  qualityScore: number;
  completeNutrition: boolean;
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
const FIELDS = [
  "code",
  "product_name",
  "brands",
  "serving_size",
  "image_front_small_url",
  "nutriments",
  "completeness",
  "popularity_key",
  "unique_scans_n",
].join(",");

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
  const nutrientsPresent = [
    nutrient("proteins"),
    nutrient("fat"),
    nutrient("carbohydrates"),
    nutrient("fiber"),
    sodiumG,
  ].filter((value) => value !== undefined).length;
  const completeness = number(product.completeness) ?? 0;
  const popularity =
    number(product.popularity_key) ?? number(product.unique_scans_n) ?? 0;
  return {
    code,
    name,
    brand: product.brands?.split(",")[0]?.trim() || undefined,
    imageUrl: product.image_front_small_url,
    basis: hasServing ? product.serving_size?.trim() || "1 serving" : "100 g",
    calories: Math.round(calories),
    qualityScore:
      completeness * 100 +
      nutrientsPresent * 8 +
      Math.log10(popularity + 1) * 6,
    completeNutrition: completeness >= 0.8 && nutrientsPresent >= 4,
    proteinG: nutrient("proteins"),
    fatG: nutrient("fat"),
    carbsG: nutrient("carbohydrates"),
    fiberG: nutrient("fiber"),
    sodiumMg: sodiumG === undefined ? undefined : sodiumG * 1000,
    sugarG: nutrient("sugars"),
    saturatedFatG: nutrient("saturated-fat"),
    cholesterolMg: (nutrient("cholesterol") ?? 0) * 1000 || undefined,
    potassiumMg: (nutrient("potassium") ?? 0) * 1000 || undefined,
    calciumMg: (nutrient("calcium") ?? 0) * 1000 || undefined,
    ironMg: (nutrient("iron") ?? 0) * 1000 || undefined,
    magnesiumMg: (nutrient("magnesium") ?? 0) * 1000 || undefined,
    vitaminCMg: (nutrient("vitamin-c") ?? 0) * 1000 || undefined,
    vitaminDMcg: (nutrient("vitamin-d") ?? 0) * 1_000_000 || undefined,
    vitaminB12Mcg: (nutrient("vitamin-b12") ?? 0) * 1_000_000 || undefined,
  };
}

async function request(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "North/1.0 (mobile food logger)" },
  });
  if (!response.ok)
    throw new Error(`Food database request failed (${response.status}).`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function foodByBarcode(barcode: string) {
  const code = barcode.replace(/\D/g, "");
  if (!code) return null;
  const data = await request(
    `${API}/api/v3/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`,
  );
  return data.product ? parseProduct(data.product as RawProduct) : null;
}

function words(value: string) {
  return value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export async function searchFoods(query: string): Promise<FoodProduct[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  // Open Food Facts still directs plain-text clients to its legacy full-text
  // endpoint. We request popular results, then rank exact, complete matches on-device.
  const url = `${API}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=40&sort_by=unique_scans_n&fields=${FIELDS}`;
  const data = await request(url);
  const queryWords = words(term);
  const byCode = new Map<string, FoodProduct>();
  for (const raw of (data.products as RawProduct[] | undefined) ?? []) {
    const product = parseProduct(raw);
    if (!product) continue;
    const haystack =
      `${product.name} ${product.brand ?? ""}`.toLocaleLowerCase();
    const matchScore = queryWords.reduce(
      (score, word) =>
        score +
        (haystack.startsWith(word) ? 30 : haystack.includes(word) ? 12 : 0),
      0,
    );
    product.qualityScore += matchScore;
    const existing = byCode.get(product.code);
    if (!existing || product.qualityScore > existing.qualityScore)
      byCode.set(product.code, product);
  }
  return [...byCode.values()]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 20);
}
