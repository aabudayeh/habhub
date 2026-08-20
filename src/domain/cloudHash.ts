/**
 * Deterministic, order-insensitive object hashing used by the durable cloud
 * outbox. State is immutable, so retaining hashes by object identity turns a
 * one-row update from a full historical re-serialization into a cheap scan of
 * already-hashed references.
 */
const objectHashCache = new WeakMap<object, string>();

function canonicalHashValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalHashValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalHashValue(item)]),
    );
  }
  return value;
}

function updateFnv(hash: number, source: string) {
  let next = hash;
  for (let index = 0; index < source.length; index += 1) {
    next ^= source.charCodeAt(index);
    next = Math.imul(next, 16777619);
  }
  return next;
}

export function stableValueHash(value: unknown) {
  if (value && typeof value === "object") {
    const cached = objectHashCache.get(value);
    if (cached) return cached;
  }
  const serialized = JSON.stringify(canonicalHashValue(value));
  const source = serialized === undefined ? "__undefined__" : serialized;
  const hash = (updateFnv(2166136261, source) >>> 0).toString(16);
  if (value && typeof value === "object") objectHashCache.set(value, hash);
  return hash;
}

/**
 * Hashes an immutable sequence without building one giant JSON string. The
 * index and encoded length delimit every element, so order remains meaningful
 * exactly as it was in the previous array hash.
 */
export function orderedValueHash(values: readonly unknown[] | undefined) {
  let hash = 2166136261;
  const items = values ?? [];
  hash = updateFnv(hash, `[${items.length}]`);
  for (let index = 0; index < items.length; index += 1) {
    const itemHash = stableValueHash(items[index]);
    hash = updateFnv(hash, `${index}:${itemHash.length}:${itemHash};`);
  }
  return (hash >>> 0).toString(16);
}
