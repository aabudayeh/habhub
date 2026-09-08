import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const languages = [
  ["ar", "ar"],
  ["de", "de"],
  ["es", "es"],
  ["fr", "fr"],
  ["ru", "ru"],
  ["sv", "sv"],
  ["zh-Hans", "zh-CN"],
];

const scan = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "validate-i18n.mjs"), "--json"],
  { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (scan.error) throw scan.error;
if (scan.status !== 0) throw new Error(scan.stderr || `i18n scan exited ${scan.status}`);
const { uncovered = [] } = JSON.parse(scan.stdout);
if (!uncovered.length) {
  console.log("No uncovered interface copy needs translation.");
  process.exit(0);
}

function batches(values) {
  const output = [];
  let current = [];
  let length = 0;
  for (const value of values) {
    if (current.length && (current.length >= 12 || length + value.length > 3_600)) {
      output.push(current);
      current = [];
      length = 0;
    }
    current.push(value);
    length += value.length;
  }
  if (current.length) output.push(current);
  return output;
}

function protectPlaceholders(value) {
  const placeholders = [];
  const protectedValue = value.replace(/\{[^}]+\}/g, (placeholder) => {
    const token = `__HABHUB_PARAMETER_${String(placeholders.length).padStart(3, "0")}__`;
    placeholders.push([token, placeholder]);
    return token;
  });
  return { protectedValue, placeholders };
}

function restorePlaceholders(value, placeholders) {
  let restored = value;
  for (const [token, placeholder] of placeholders) {
    const flexibleToken = new RegExp(
      token.replaceAll("_", "\\s*_\\s*").replaceAll("HABHUB", "HABHUB\\s*"),
      "gi",
    );
    restored = restored.replace(flexibleToken, placeholder);
  }
  return restored.trim();
}

function placeholderSignature(value) {
  return [...value.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join("|");
}

async function translateBatch(values, targetLanguage, attempt = 0) {
  const prepared = values.map(protectPlaceholders);
  const joined = prepared
    .map(({ protectedValue }, index) =>
      index
        ? `__HABHUB_RELEASE_SPLIT_${String(index - 1).padStart(3, "0")}__\n${protectedValue}`
        : protectedValue,
    )
    .join("\n");
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.search = new URLSearchParams({
    client: "gtx",
    sl: "en",
    tl: targetLanguage,
    dt: "t",
    q: joined,
  }).toString();
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "HabHub release localization generator" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const translated = payload[0].map((segment) => segment[0]).join("");
    const split = translated
      .split(/\s*__HABHUB_RELEASE_SPLIT_\d{3}__\s*/gi)
      .map((value, index) => restorePlaceholders(value, prepared[index]?.placeholders ?? []));
    if (split.length !== values.length || split.some((value) => !value)) {
      throw new Error(`Expected ${values.length} results, received ${split.length}`);
    }
    split.forEach((translation, index) => {
      if (placeholderSignature(translation) !== placeholderSignature(values[index])) {
        throw new Error(`Placeholder mismatch for ${JSON.stringify(values[index])}`);
      }
    });
    return split;
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    return translateBatch(values, targetLanguage, attempt + 1);
  }
}

for (const [fileName, targetLanguage] of languages) {
  const file = path.join(root, "src", "i18n", "catalogs", `${fileName}.json`);
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const missing = uncovered.filter((source) => !catalog[source]);
  const translated = [];
  const chunks = batches(missing);
  for (let index = 0; index < chunks.length; index += 1) {
    process.stdout.write(`\r${fileName}: ${index + 1}/${chunks.length} release-copy batches`);
    translated.push(...(await translateBatch(chunks[index], targetLanguage)));
  }
  process.stdout.write("\n");
  missing.forEach((source, index) => {
    catalog[source] = translated[index];
  });
  fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

console.log(
  `Added ${uncovered.length} release-copy translations to ${languages.length} offline catalogs.`,
);
