import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const trackerCatalogFile = path.join(
  root,
  "src",
  "domain",
  "trackerCatalog.ts",
);
const sourceText = fs.readFileSync(trackerCatalogFile, "utf8");
const sourceFile = ts.createSourceFile(
  trackerCatalogFile,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function unwrap(node) {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function trackerDescriptions() {
  const descriptions = [];

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === "TRACKER_PRESET_DESCRIPTIONS"
    ) {
      const object = unwrap(node.initializer);
      if (!object || !ts.isObjectLiteralExpression(object)) {
        throw new Error("TRACKER_PRESET_DESCRIPTIONS must be an object literal.");
      }
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const value = unwrap(property.initializer);
        if (!value || !ts.isStringLiteralLike(value)) {
          throw new Error(
            `Tracker description ${property.name.getText(sourceFile)} must be a string literal.`,
          );
        }
        descriptions.push(value.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (!descriptions.length) {
    throw new Error("No tracker descriptions were found.");
  }
  return [...new Set(descriptions)];
}

const languages = [
  ["ar", "ar"],
  ["de", "de"],
  ["es", "es"],
  ["fr", "fr"],
  ["ru", "ru"],
  ["sv", "sv"],
  ["zh-Hans", "zh-CN"],
];

function batches(values) {
  const output = [];
  let current = [];
  let length = 0;
  for (const value of values) {
    if (current.length && (current.length >= 10 || length + value.length > 3_500)) {
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

async function translateBatch(values, targetLanguage, attempt = 0) {
  const joined = values
    .map((value, index) =>
      index
        ? `__HABHUB_TRACKER_SPLIT_${String(index - 1).padStart(3, "0")}__\n${value}`
        : value,
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
      headers: { "User-Agent": "HabHub tracker-description localization generator" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const translated = payload[0].map((segment) => segment[0]).join("");
    const split = translated
      .split(/\s*__HABHUB_TRACKER_SPLIT_\d{3}__\s*/g)
      .map((value) => value.trim());
    if (split.length !== values.length || split.some((value) => !value)) {
      throw new Error(
        `Expected ${values.length} translated descriptions, received ${split.length}.`,
      );
    }
    return split;
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    return translateBatch(values, targetLanguage, attempt + 1);
  }
}

const descriptions = trackerDescriptions();
const catalogDirectory = path.join(root, "src", "i18n", "catalogs");

for (const [fileName, targetLanguage] of languages) {
  const file = path.join(catalogDirectory, `${fileName}.json`);
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const missing = descriptions.filter(
    (description) =>
      typeof catalog[description] !== "string" ||
      !catalog[description].trim() ||
      catalog[description].trim() === description.trim(),
  );
  const chunks = batches(missing);
  let translatedCount = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    process.stdout.write(
      `\r${fileName}: ${index + 1}/${chunks.length} tracker-description batches`,
    );
    const translated = await translateBatch(chunks[index], targetLanguage);
    chunks[index].forEach((description, descriptionIndex) => {
      catalog[description] = translated[descriptionIndex];
    });
    translatedCount += translated.length;
  }
  if (chunks.length) process.stdout.write("\n");
  fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`${fileName}: ${translatedCount} descriptions added or repaired.`);
}

console.log(
  `Verified ${descriptions.length} tracker descriptions across ${languages.length} translated catalogs.`,
);
