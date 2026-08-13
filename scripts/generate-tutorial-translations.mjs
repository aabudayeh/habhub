import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveTutorialModule(
  request,
  parent,
  isMain,
  options,
) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, request.slice(2))
    : request;
  return originalResolveFilename.call(
    this,
    resolvedRequest,
    parent,
    isMain,
    options,
  );
};
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const { TUTORIAL_GUIDES } = require(
  path.join(root, "src/tutorial/guides.ts"),
);

const english = new Map();
function add(key, value) {
  if (!value) return;
  const current = english.get(key);
  if (current && current !== value)
    throw new Error(`Conflicting English tutorial value for ${key}`);
  english.set(key, value);
}
for (const guide of TUTORIAL_GUIDES) {
  add(`guide.${guide.id}.title`, guide.title);
  add(`guide.${guide.id}.detail`, guide.detail);
  for (const section of guide.sections ?? []) {
    add(`section.${section.id}.title`, section.title);
    add(`section.${section.id}.detail`, section.detail);
  }
  for (const step of guide.steps) {
    add(`step.${step.id}.title`, step.title);
    add(`step.${step.id}.copy`, step.copy);
    add(`step.${step.id}.primaryLabel`, step.primaryLabel);
    add(`step.${step.id}.instruction`, step.interaction?.instruction);
  }
}

const entries = [...english.entries()].sort(([left], [right]) =>
  left.localeCompare(right),
);
const languages = [
  ["ar", "ar", "tutorialArCatalog"],
  ["de", "de", "tutorialDeCatalog"],
  ["es", "es", "tutorialEsCatalog"],
  ["fr", "fr", "tutorialFrCatalog"],
  ["ru", "ru", "tutorialRuCatalog"],
  ["sv", "sv", "tutorialSvCatalog"],
  ["zh-Hans", "zh-CN", "tutorialZhHansCatalog"],
];
const reviewedOverrides = {
  ar: {
    "guide.essential.title": "أساسيات HabHub",
    "step.full.screen-time.access.copy": "على Android، امنح حق الوصول للاستخدام لمعرفة الوقت الأمامي التقريبي والتفاصيل لكل تطبيق. تبقى حدود التقرير والتطبيق على هذا الجهاز؛ يدعم نظام iOS سجلات التتبع اليدوية حتى يتوفر استحقاق Family Controls المعتمد بشكل منفصل.",
  },
  de: { "section.status.title": "Körperstatus" },
  es: {
    "step.full.screen-time.access.copy": "En Android, otorgue acceso de uso para ver el tiempo aproximado en primer plano y el desglose por aplicación. Los límites de informes y aplicaciones permanecen en este dispositivo; iOS admite registros de seguimiento manuales hasta que exista el derecho Family Controls aprobado por separado.",
  },
  fr: { "section.notifications.title": "Alertes" },
  ru: {
    "guide.essential.title": "Основы HabHub",
    "step.full.custom.formula.copy": "Вставляйте идентификаторы трекера и используйте арифметику, сравнения, круглые скобки и MIN, MAX, AVERAGE, ROUND, ABS, CLAMP или IF. HabHub безопасно разбирает это выражение и никогда не выполняет произвольный код.",
    "step.full.screen-time.access.copy": "На Android предоставьте доступ к использованию, чтобы увидеть приблизительное время работы на переднем плане и разбивку по каждому приложению. Отчет и ограничения приложений остаются на этом устройстве; iOS поддерживает ручные записи трекера, пока не будет отдельно одобрено разрешение Family Controls.",
  },
  sv: {
    "guide.module:leaderboard.title": "Guide till topplistan",
    "guide.module:timer.title": "Guide till tidtagare",
    "section.display.title": "Visning",
    "section.journal.title": "Dagbok",
    "section.leaderboard.title": "Topplista",
    "section.status.title": "Statusvy",
    "section.timer.title": "Tidtagare",
  },
  "zh-Hans": {
    "step.full.screen-time.access.copy": "在 Android 上授予使用情况访问权限，即可查看大致的前台时长和各应用明细。报告和应用限制仅保留在此设备上；在单独获批 Family Controls 权限之前，iOS 支持手动记录该跟踪项。",
  },
};
const outputDirectory = path.join(root, "src/i18n/tutorial");
fs.mkdirSync(outputDirectory, { recursive: true });

const keyOrder = entries.map(([key]) => key);
const englishValues = entries.map(([, value]) => value);

function moduleSource(exportName, values, note) {
  const rows = keyOrder
    .map((key, index) => `  ${JSON.stringify(key)}: ${JSON.stringify(values[index])},`)
    .join("\n");
  return `/** ${note} */\nexport const ${exportName} = {\n${rows}\n} as const satisfies Readonly<Record<string, string>>;\n`;
}

fs.writeFileSync(
  path.join(outputDirectory, "en.ts"),
  moduleSource(
    "tutorialEnCatalog",
    englishValues,
    "Canonical English copy keyed by durable guide, section and step ids.",
  ),
  "utf8",
);

function batches(values) {
  const output = [];
  let current = [];
  let length = 0;
  for (const value of values) {
    if (current.length && (current.length >= 14 || length + value.length > 4_200)) {
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
      index ? `__HABHUB_TUTORIAL_SPLIT_${String(index - 1).padStart(3, "0")}__\n${value}` : value,
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
      headers: { "User-Agent": "HabHub tutorial localization generator" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const translated = payload[0].map((segment) => segment[0]).join("");
    const split = translated
      .split(/\s*__HABHUB_TUTORIAL_SPLIT_\d{3}__\s*/g)
      .map((value) => value.trim());
    if (split.length !== values.length || split.some((value) => !value))
      throw new Error(`Expected ${values.length} results, received ${split.length}`);
    return split;
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    return translateBatch(values, targetLanguage, attempt + 1);
  }
}

for (const [fileName, targetLanguage, exportName] of languages) {
  const translated = [];
  const chunks = batches(englishValues);
  for (let index = 0; index < chunks.length; index += 1) {
    process.stdout.write(
      `\r${fileName}: ${index + 1}/${chunks.length} translation batches`,
    );
    translated.push(...(await translateBatch(chunks[index], targetLanguage)));
  }
  process.stdout.write("\n");
  if (translated.length !== entries.length)
    throw new Error(`${fileName}: translation count mismatch`);
  for (const [key, value] of Object.entries(reviewedOverrides[fileName] ?? {})) {
    const keyIndex = keyOrder.indexOf(key);
    if (keyIndex < 0) throw new Error(`${fileName}: override key not found: ${key}`);
    translated[keyIndex] = value;
  }
  fs.writeFileSync(
    path.join(outputDirectory, `${fileName}.ts`),
    moduleSource(
      exportName,
      translated,
      `Machine-translated HabHub tutorial catalog (${fileName}); stable keys prevent silent English fallback.`,
    ),
    "utf8",
  );
}

console.log(
  `Generated ${entries.length} stable tutorial strings in English and ${languages.length} translated catalogs.`,
);
