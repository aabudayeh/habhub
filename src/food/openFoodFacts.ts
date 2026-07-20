export type FoodProduct = {
  code: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  basis: string;
  calories: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?:number;saturatedFatG?:number;cholesterolMg?:number;potassiumMg?:number;
  calciumMg?:number;ironMg?:number;magnesiumMg?:number;vitaminCMg?:number;vitaminDMcg?:number;vitaminB12Mcg?:number;
};

type RawProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  image_front_small_url?: string;
  nutriments?: Record<string, unknown>;
};

const API = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,brands,serving_size,image_front_small_url,nutriments';

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseProduct(product: RawProduct): FoodProduct | null {
  const name = product.product_name?.trim();
  const code = product.code?.trim();
  if (!name || !code) return null;
  const nutrients = product.nutriments ?? {};
  const hasServing = number(nutrients['energy-kcal_serving']) !== undefined;
  const suffix = hasServing ? 'serving' : '100g';
  const nutrient = (key: string) => number(nutrients[`${key}_${suffix}`]);
  const calories = nutrient('energy-kcal');
  if (calories === undefined) return null;
  const sodiumG = nutrient('sodium');
  return {
    code,
    name,
    brand: product.brands?.split(',')[0]?.trim() || undefined,
    imageUrl: product.image_front_small_url,
    basis: hasServing ? product.serving_size?.trim() || '1 serving' : '100 g',
    calories: Math.round(calories),
    proteinG: nutrient('proteins'),
    fatG: nutrient('fat'),
    carbsG: nutrient('carbohydrates'),
    fiberG: nutrient('fiber'),
    sodiumMg: sodiumG === undefined ? undefined : sodiumG * 1000,
    sugarG:nutrient('sugars'),saturatedFatG:nutrient('saturated-fat'),
    cholesterolMg:(nutrient('cholesterol')??0)*1000||undefined,potassiumMg:(nutrient('potassium')??0)*1000||undefined,
    calciumMg:(nutrient('calcium')??0)*1000||undefined,ironMg:(nutrient('iron')??0)*1000||undefined,magnesiumMg:(nutrient('magnesium')??0)*1000||undefined,
    vitaminCMg:(nutrient('vitamin-c')??0)*1000||undefined,vitaminDMcg:(nutrient('vitamin-d')??0)*1000000||undefined,vitaminB12Mcg:(nutrient('vitamin-b12')??0)*1000000||undefined,
  };
}

async function request(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'North/1.0 (mobile food logger)' } });
  if (!response.ok) throw new Error(`Food database request failed (${response.status}).`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function foodByBarcode(barcode: string): Promise<FoodProduct | null> {
  const code = barcode.replace(/\D/g, '');
  if (!code) return null;
  const data = await request(`${API}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  return Number(data.status) === 1 ? parseProduct(data.product as RawProduct) : null;
}

export async function searchFoods(query: string): Promise<FoodProduct[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const url = `${API}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`;
  const data = await request(url);
  return ((data.products as RawProduct[] | undefined) ?? []).map(parseProduct).filter((item): item is FoodProduct => Boolean(item));
}
