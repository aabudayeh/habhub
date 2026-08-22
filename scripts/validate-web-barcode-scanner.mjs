import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  normalizeFoodBarcodeInput,
  webCameraErrorMessage,
} from "../src/food/barcode.ts";

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

console.log("Web/PWA barcode scanner validation passed.");
