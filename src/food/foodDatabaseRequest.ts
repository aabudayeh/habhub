export type FoodDatabasePayload = Record<string, unknown>;

export class FoodDatabaseRequestError extends Error {
  readonly status?: number;
  readonly payload?: FoodDatabasePayload;

  constructor(
    message: string,
    status?: number,
    payload?: FoodDatabasePayload,
  ) {
    super(message);
    this.name = "FoodDatabaseRequestError";
    this.status = status;
    this.payload = payload;
  }
}

type FoodDatabaseFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

type FoodDatabaseRequestOptions = {
  attempts?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetcher?: FoodDatabaseFetch;
  wait?: (milliseconds: number) => Promise<void>;
};

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function record(value: unknown): FoodDatabasePayload | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as FoodDatabasePayload)
    : undefined;
}

async function responsePayload(response: Response) {
  try {
    return record(await response.json());
  } catch {
    return undefined;
  }
}

/**
 * Fetch JSON from a food provider while retaining an HTTP error's structured
 * payload. Barcode lookups need that payload because Open Food Facts uses a
 * documented HTTP 404 for an ordinary product-not-found result.
 */
export async function requestFoodDatabase(
  url: string,
  options: FoodDatabaseRequestOptions = {},
) {
  const attempts = Math.max(1, options.attempts ?? 3);
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let last: Error | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 9_000,
    );
    let serverDelay: number | undefined;
    let retryable = true;
    try {
      const response = await fetcher(url, {
        headers: options.headers ?? {},
        signal: controller.signal,
      });
      const payload = await responsePayload(response);
      if (response.ok && payload) return payload;

      last = new FoodDatabaseRequestError(
        response.ok
          ? "Food database returned an invalid response."
          : `Food database request failed (${response.status}).`,
        response.status,
        payload,
      );
      retryable =
        response.ok || [429, 500, 502, 503, 504].includes(response.status);
      serverDelay = retryAfterMs(response.headers.get("retry-after"));
    } catch (error) {
      last =
        error instanceof Error
          ? error
          : new Error("Food database request failed.");
    } finally {
      clearTimeout(timeout);
    }

    if (!retryable) throw last;
    if (attempt < attempts - 1)
      await wait(Math.min(5_000, serverDelay ?? 450 * 2 ** attempt));
  }

  throw last ?? new Error("Food database request failed.");
}

export function isOpenFoodFactsProductNotFound(
  payload: FoodDatabasePayload | undefined,
) {
  if (!payload) return false;
  if (payload.status === 0) return true;

  const result = record(payload.result);
  if (result?.id === "product_not_found") return true;

  return Array.isArray(payload.errors)
    ? payload.errors.some((candidate) => {
        const error = record(candidate);
        return record(error?.message)?.id === "product_not_found";
      })
    : false;
}

function confirmedProductNotFound(reason: unknown) {
  return (
    reason instanceof FoodDatabaseRequestError &&
    reason.status === 404 &&
    isOpenFoodFactsProductNotFound(reason.payload)
  );
}

function shouldTryLegacyProductEndpoint(reason: unknown) {
  if (!(reason instanceof FoodDatabaseRequestError)) return true;
  return reason.status === 404 || reason.status === undefined || reason.status >= 500;
}

type FoodDatabaseRequester = (
  url: string,
  attempts?: number,
) => Promise<FoodDatabasePayload>;

/**
 * Resolve a barcode through the current Open Food Facts endpoint. The official
 * v2 product endpoint is a bounded compatibility fallback when v3 fails
 * without a confirmed product-not-found response.
 */
export async function requestOpenFoodFactsBarcode(
  apiBase: string,
  code: string,
  fields: string,
  requester: FoodDatabaseRequester,
) {
  const suffix = `${encodeURIComponent(code)}.json?fields=${encodeURIComponent(fields)}`;
  try {
    const payload = await requester(`${apiBase}/api/v3/product/${suffix}`, 2);
    return isOpenFoodFactsProductNotFound(payload) ? null : payload;
  } catch (reason) {
    if (confirmedProductNotFound(reason)) return null;
    if (!shouldTryLegacyProductEndpoint(reason)) throw reason;

    try {
      const payload = await requester(`${apiBase}/api/v2/product/${suffix}`, 1);
      return isOpenFoodFactsProductNotFound(payload) ? null : payload;
    } catch (fallbackReason) {
      if (confirmedProductNotFound(fallbackReason)) return null;
      throw fallbackReason;
    }
  }
}
