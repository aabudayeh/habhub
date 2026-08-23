import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  normalizeFoodBarcodeInput,
  webCameraErrorMessage,
} from "../src/food/barcode.ts";
import {
  FoodDatabaseRequestError,
  isOpenFoodFactsProductNotFound,
  requestFoodDatabase,
  requestOpenFoodFactsBarcode,
} from "../src/food/foodDatabaseRequest.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");

assert.equal(normalizeFoodBarcodeInput(" 4006-3813-3393-1 "), "4006381333931");
assert.equal(normalizeFoodBarcodeInput("036000291452"), "036000291452");
assert.equal(normalizeFoodBarcodeInput("1234567"), undefined);
assert.match(webCameraErrorMessage({ name: "NotAllowedError" }), /blocked/i);
assert.match(webCameraErrorMessage({ name: "NotReadableError" }), /busy/i);

const webScanner = read("src/components/BarcodeCamera.web.tsx");
assert.match(webScanner, /import\(\s*["']@zxing\/browser["']\s*\)/);
assert.match(webScanner, /facingMode:\s*\{\s*ideal:\s*["']environment["']/);
assert.match(webScanner, /controls\?\.stop\(\)/);
assert.match(webScanner, /stream\.getTracks\(\)/);
for (const format of ["EAN_13", "EAN_8", "UPC_A", "UPC_E"])
  assert.ok(webScanner.includes(`BarcodeFormat.${format}`), `${format} must be enabled`);

const screen = read("app/food-search.tsx");
assert.match(screen, /Platform\.OS === ["']web["']/);
assert.match(screen, /Enter the number printed under the barcode/);
assert.match(screen, /Try camera again/);
assert.match(screen, /barcodeScanLocked\.current/);
assert.match(screen, /barcodeLookupSequence\.current/);
assert.match(screen, /onBarcodeScanned=\{handleScannedBarcode\}/);

const v3NotFound = {
  status: "failure",
  result: { id: "product_not_found" },
  errors: [{ message: { id: "product_not_found" } }],
};
const v2NotFound = { status: 0, status_verbose: "product not found" };
assert.equal(isOpenFoodFactsProductNotFound(v3NotFound), true);
assert.equal(isOpenFoodFactsProductNotFound(v2NotFound), true);
assert.equal(isOpenFoodFactsProductNotFound({ status: "failure" }), false);

const structured404Calls = [];
const structured404 = await requestOpenFoodFactsBarcode(
  "https://world.openfoodfacts.org",
  "4006381333931",
  "code,product_name,nutriments",
  async (url) => {
    structured404Calls.push(url);
    throw new FoodDatabaseRequestError("not found", 404, v3NotFound);
  },
);
assert.equal(structured404, null);
assert.equal(
  structured404Calls.length,
  1,
  "a confirmed v3 product-not-found must not waste a fallback request",
);

const fallbackCalls = [];
const fallbackProduct = { product: { code: "4006381333931" } };
const fallbackResult = await requestOpenFoodFactsBarcode(
  "https://world.openfoodfacts.org",
  "4006381333931",
  "code,product_name,nutriments",
  async (url, attempts) => {
    fallbackCalls.push({ url, attempts });
    if (url.includes("/api/v3/"))
      throw new FoodDatabaseRequestError("unstructured route response", 404);
    return fallbackProduct;
  },
);
assert.deepEqual(fallbackResult, fallbackProduct);
assert.match(fallbackCalls[0].url, /\/api\/v3\/product\/4006381333931\.json/);
assert.equal(fallbackCalls[0].attempts, 2);
assert.match(fallbackCalls[1].url, /\/api\/v2\/product\/4006381333931\.json/);
assert.equal(fallbackCalls[1].attempts, 1);

const confirmedFallback404 = await requestOpenFoodFactsBarcode(
  "https://world.openfoodfacts.org",
  "4006381333931",
  "code",
  async (url) => {
    if (url.includes("/api/v3/"))
      throw new FoodDatabaseRequestError("unstructured route response", 404);
    throw new FoodDatabaseRequestError("not found", 404, v2NotFound);
  },
);
assert.equal(confirmedFallback404, null);

const authFailure = new FoodDatabaseRequestError("blocked", 403, {
  error: "blocked",
});
await assert.rejects(
  requestOpenFoodFactsBarcode(
    "https://world.openfoodfacts.org",
    "4006381333931",
    "code",
    async () => {
      throw authFailure;
    },
  ),
  (reason) => reason === authFailure,
  "real non-retryable HTTP errors must not be hidden as product-not-found",
);

const networkFailure = new TypeError("network offline");
let networkCalls = 0;
await assert.rejects(
  requestOpenFoodFactsBarcode(
    "https://world.openfoodfacts.org",
    "4006381333931",
    "code",
    async () => {
      networkCalls += 1;
      throw networkFailure;
    },
  ),
  (reason) => reason === networkFailure,
);
assert.equal(networkCalls, 2, "v3 failure gets one bounded official v2 fallback");

let parsed404Calls = 0;
await assert.rejects(
  requestFoodDatabase("https://example.test/product", {
    attempts: 3,
    fetcher: async () => {
      parsed404Calls += 1;
      return new Response(JSON.stringify(v3NotFound), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
    wait: async () => undefined,
  }),
  (reason) =>
    reason instanceof FoodDatabaseRequestError &&
    reason.status === 404 &&
    isOpenFoodFactsProductNotFound(reason.payload),
);
assert.equal(parsed404Calls, 1, "ordinary HTTP 404s are parsed but not retried");

console.log("Web/PWA barcode scanner validation passed.");
