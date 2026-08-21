export type UsdaNutrientRow = {
  nutrientId?: number | string;
  nutrientName?: string;
  unitName?: string;
  value?: number | string;
};

type UsdaNutrientIdentity = number | string;

function finiteNonnegative(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

/** Stable USDA ids take priority; name aliases remain a legacy fallback. */
export function usdaNutrientRow(
  nutrients: readonly UsdaNutrientRow[],
  ...identities: UsdaNutrientIdentity[]
) {
  for (const identity of identities) {
    const match = nutrients.find((row) =>
      typeof identity === "number"
        ? Number(row.nutrientId) === identity
        : String(row.nutrientName ?? "").trim().toLowerCase() ===
          identity.toLowerCase(),
    );
    if (match) return match;
  }
  return undefined;
}

export function usdaCalories(nutrients: readonly UsdaNutrientRow[]) {
  for (const identity of [2048, 2047, 1008, "energy"] as const) {
    const row = usdaNutrientRow(nutrients, identity);
    if (String(row?.unitName ?? "").trim().toLowerCase() !== "kcal")
      continue;
    const amount = finiteNonnegative(row?.value);
    if (amount !== undefined) return amount;
  }
  return undefined;
}

export function usdaMassNutrientAs(
  nutrients: readonly UsdaNutrientRow[],
  targetUnit: "g" | "mg" | "mcg",
  ...identities: UsdaNutrientIdentity[]
) {
  const row = usdaNutrientRow(nutrients, ...identities);
  const amount = finiteNonnegative(row?.value);
  if (amount === undefined) return undefined;
  const sourceUnit = String(row?.unitName ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("µ", "u");
  const grams =
    sourceUnit === "g"
      ? amount
      : sourceUnit === "mg"
        ? amount / 1000
        : sourceUnit === "ug" || sourceUnit === "mcg"
          ? amount / 1_000_000
          : undefined;
  if (grams === undefined) return undefined;
  return targetUnit === "g"
    ? grams
    : targetUnit === "mg"
      ? grams * 1000
      : grams * 1_000_000;
}

export function usdaTotalSugarsG(nutrients: readonly UsdaNutrientRow[]) {
  return usdaMassNutrientAs(
    nutrients,
    "g",
    2000,
    "total sugars",
    "sugars, total including nlea",
    "sugars, total",
  );
}
