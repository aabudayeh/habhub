import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const languages = ["ar", "es", "zh-Hans", "sv", "de", "ru", "fr"];
const languageSet = new Set(languages);
const sourceExtensions = new Set([".ts", ".tsx"]);

const translatedProps = new Map([
  ["Button", new Set(["label", "accessibilityLabel", "accessibilityHint"])],
  ["Chip", new Set(["label", "accessibilityLabel", "accessibilityHint"])],
  ["IconButton", new Set(["label", "accessibilityLabel", "accessibilityHint"])],
  ["PageHeader", new Set(["eyebrow", "title", "subtitle"])],
  ["SectionHeader", new Set(["title"])],
  ["SelectionMenu", new Set(["title", "emptyLabel"])],
  ["MetricSelector", new Set(["title", "emptyLabel"])],
  ["TextInput", new Set(["placeholder", "accessibilityLabel", "accessibilityHint"])],
  ["AppTextInput", new Set(["placeholder", "accessibilityLabel", "accessibilityHint"])],
]);
const universalTranslatedProps = new Set([
  "accessibilityLabel",
  "accessibilityHint",
]);
const textComponents = new Set(["Text", "AppText"]);
// Copy stored in option/menu objects is rendered later, so JSX-only scanning
// misses it. Keep this deliberately limited to user-facing property names to
// avoid treating route IDs, persisted values, and style constants as copy.
const objectCopyProps = new Set([
  "body",
  "caption",
  "copy",
  "description",
  "detail",
  "emptyLabel",
  "eyebrow",
  "helper",
  "hint",
  "label",
  "message",
  "owner",
  "periodLabel",
  "stat",
  "sublabel",
  "subtitle",
  "text",
  "title",
]);

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(absolute);
    return sourceExtensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function sourceFile(file) {
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function unwrap(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function literalValue(node) {
  const value = unwrap(node);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

function jsxTagName(node) {
  if (ts.isIdentifier(node.tagName)) return node.tagName.text;
  return node.tagName.getText();
}

function attributeByName(opening, name) {
  return opening.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && propertyName(attribute.name) === name,
  );
}

function isFalseAttribute(attribute) {
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) {
    return false;
  }
  if (!ts.isJsxExpression(attribute.initializer)) return false;
  return attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword;
}

function normalizeCopy(value) {
  return value.replace(/\s+/g, " ").trim();
}

function templateFromExpression(expression) {
  const node = unwrap(expression);
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return `${node.head.text}${node.templateSpans
      .map((span) => `{value}${span.literal.text}`)
      .join("")}`;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = templateFromExpression(node.left) ?? "{value}";
    const right = templateFromExpression(node.right) ?? "{value}";
    return `${left}${right}`;
  }
  return undefined;
}

function stringsFromExpression(expression) {
  const node = unwrap(expression);
  if (!node) return [];
  if (ts.isConditionalExpression(node)) {
    return [
      ...stringsFromExpression(node.whenTrue),
      ...stringsFromExpression(node.whenFalse),
    ];
  }
  const template = templateFromExpression(node);
  return template === undefined ? [] : [template];
}

function stringsFromJsxInitializer(initializer) {
  if (!initializer) return [];
  if (ts.isStringLiteral(initializer)) return [initializer.text];
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    return stringsFromExpression(initializer.expression);
  }
  return [];
}

function looksLikeCopy(value) {
  const withoutPlaceholders = value.replace(/\{[^}]+\}/g, "");
  return (
    /\p{L}/u.test(withoutPlaceholders) &&
    !/^#[0-9a-f]{3,8}$/i.test(value) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    !/^https?:\/\//i.test(value) &&
    !/^[/@][\w./:[\]-]+$/.test(value)
  );
}

function locationOf(file, node) {
  const source = node.getSourceFile();
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  return `${path.relative(root, file).replaceAll("\\", "/")}:${line}`;
}

function addCopy(found, value, file, node, kind) {
  const normalized = normalizeCopy(value);
  if (!normalized || !looksLikeCopy(normalized)) return;
  const existing = found.get(normalized) ?? [];
  existing.push({ location: locationOf(file, node), kind });
  found.set(normalized, existing);
}

function scanUiFile(file, found, pathErrors) {
  const source = sourceFile(file);

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "react-native") {
      continue;
    }
    const imports = statement.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;
    for (const specifier of imports.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      const local = specifier.name.text;
      if (
        (imported === "Text" && local === "Text") ||
        (imported === "TextInput" && local === "TextInput") ||
        (imported === "Alert" && local === "Alert")
      ) {
        pathErrors.push(
          `${locationOf(file, specifier)} imports raw ${imported}; use the localized app wrapper.`,
        );
      }
    }
  }

  function visit(node) {
    const relativeFile = path.relative(root, file).replaceAll("\\", "/");
    const notificationSource =
      relativeFile.startsWith("src/notifications/") ||
      relativeFile === "src/cloud/groupCloud.ts";
    const badgeGenerator = relativeFile === "src/domain/badges.ts";

    if (
      badgeGenerator &&
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "labels"
    ) {
      const initializer = unwrap(node.initializer);
      if (initializer && ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          for (const value of stringsFromExpression(property.initializer)) {
            addCopy(found, value, file, property, "badge.periodLabel");
          }
        }
      }
    }

    if (
      badgeGenerator &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "overall"
    ) {
      for (const index of [1, 6, 7]) {
        const argument = node.arguments[index];
        if (!argument) continue;
        for (const value of stringsFromExpression(argument)) {
          addCopy(found, value, file, argument, "badge.overallCopy");
        }
      }
    }

    if (notificationSource && ts.isReturnStatement(node) && node.expression) {
      for (const value of stringsFromExpression(node.expression)) {
        addCopy(found, value, file, node, "notification.return");
      }
    }

    if (
      notificationSource &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["localizedContent", "withLocalizedPushCopy"].includes(
        node.expression.text,
      )
    ) {
      for (const argument of node.arguments) {
        for (const value of stringsFromExpression(argument)) {
          addCopy(found, value, file, argument, "notification.localizedCopy");
        }
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && objectCopyProps.has(name)) {
        for (const value of stringsFromExpression(node.initializer)) {
          addCopy(found, value, file, node, `object.${name}`);
        }
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = jsxTagName(opening);
      const translationDisabled = isFalseAttribute(attributeByName(opening, "translate"));

      if (!translationDisabled) {
        for (const attribute of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) continue;
          const name = propertyName(attribute.name);
          if (!name) continue;
          if (
            universalTranslatedProps.has(name) ||
            translatedProps.get(tag)?.has(name)
          ) {
            for (const value of stringsFromJsxInitializer(attribute.initializer)) {
              addCopy(found, value, file, attribute, `${tag}.${name}`);
            }
          }
        }

        if (ts.isJsxElement(node) && textComponents.has(tag)) {
          for (const child of node.children) {
            if (ts.isJsxText(child)) {
              addCopy(found, child.text, file, child, `${tag}.children`);
            } else if (ts.isJsxExpression(child) && child.expression) {
              for (const value of stringsFromExpression(child.expression)) {
                addCopy(found, value, file, child, `${tag}.children`);
              }
            }
          }
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "alert" &&
      node.expression.expression.getText(source) === "Alert"
    ) {
      for (const argument of node.arguments.slice(0, 2)) {
        for (const value of stringsFromExpression(argument)) {
          addCopy(found, value, file, argument, "Alert.alert");
        }
      }
      const buttons = unwrap(node.arguments[2]);
      if (buttons && ts.isArrayLiteralExpression(buttons)) {
        for (const element of buttons.elements) {
          const button = unwrap(element);
          if (!button || !ts.isObjectLiteralExpression(button)) continue;
          for (const property of button.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              propertyName(property.name) === "text"
            ) {
              for (const value of stringsFromExpression(property.initializer)) {
                addCopy(found, value, file, property, "Alert.button");
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function catalogMaps() {
  return Object.fromEntries(languages.map((language) => [language, new Map()]));
}

function addCatalogEntry(catalogs, language, source, translation, issues, origin) {
  if (!source || !translation) {
    issues.push(`${origin} has an empty source or translation.`);
    return;
  }
  const existing = catalogs[language].get(source);
  if (existing && existing !== translation) {
    issues.push(`${origin} duplicates ${JSON.stringify(source)} with a different translation.`);
    return;
  }
  const sourcePlaceholders = [...source.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .sort();
  const translationPlaceholders = [...translation.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .sort();
  if (sourcePlaceholders.join("|") !== translationPlaceholders.join("|")) {
    issues.push(
      `${origin} changes placeholders for ${JSON.stringify(source)}.`,
    );
    return;
  }
  catalogs[language].set(source, translation);
}

function regularExpressionParts(node) {
  const value = unwrap(node);
  if (!value || !ts.isRegularExpressionLiteral(value)) return undefined;
  const literal = value.getText(value.getSourceFile());
  const closingSlash = literal.lastIndexOf("/");
  if (!literal.startsWith("/") || closingSlash <= 0) return undefined;
  return {
    source: literal.slice(1, closingSlash),
    flags: literal.slice(closingSlash + 1).replace(/[gy]/g, ""),
  };
}

function matchingGroupEnd(source, start) {
  let depth = 0;
  let inCharacterClass = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) continue;
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isCapturingGroup(source, start) {
  if (source[start + 1] !== "?") return true;
  // Named captures start with (?<name>); look-behind starts with (?<= / (?<!.
  return (
    source[start + 2] === "<" &&
    source[start + 3] !== "=" &&
    source[start + 3] !== "!"
  );
}

function scannerPatternFromRuntimeRegex(source, flags) {
  let scannerSource = "";
  let inCharacterClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      scannerSource += `${character}${source[index + 1] ?? ""}`;
      index += 1;
      continue;
    }
    if (character === "[") inCharacterClass = true;
    if (character === "]" && inCharacterClass) inCharacterClass = false;
    if (
      inCharacterClass ||
      character !== "(" ||
      !isCapturingGroup(source, index)
    ) {
      scannerSource += character;
      continue;
    }

    const groupEnd = matchingGroupEnd(source, index);
    if (groupEnd < 0) return undefined;
    scannerSource += "\\{value\\}";
    index = groupEnd;

    // One source interpolation becomes one scanner placeholder regardless of
    // whether the corresponding runtime capture is optional or repeated.
    if (/[?*+]/.test(source[index + 1] ?? "")) {
      index += 1;
      if (source[index + 1] === "?") index += 1;
    } else if (source[index + 1] === "{") {
      const quantifierEnd = source.indexOf("}", index + 2);
      if (quantifierEnd >= 0) index = quantifierEnd;
      if (source[index + 1] === "?") index += 1;
    }
  }
  try {
    return new RegExp(scannerSource, flags);
  } catch {
    return undefined;
  }
}

function collectCatalogsFromTypeScript(
  file,
  catalogs,
  issues,
  runtimeDomainCatalogs,
  runtimeTemplatePatterns,
) {
  const source = sourceFile(file);
  const relativeFile = path.relative(root, file).replaceAll("\\", "/");
  const isDomainCatalog = relativeFile === "src/i18n/domain.ts";

  function collectLanguageObject(object, origin) {
    const languageProperties = object.properties.filter(
      (property) =>
        ts.isPropertyAssignment(property) &&
        languageSet.has(propertyName(property.name)),
    );
    if (!languageProperties.length) return;
    for (const languageProperty of languageProperties) {
      const language = propertyName(languageProperty.name);
      const entries = unwrap(languageProperty.initializer);
      if (!language || !entries || !ts.isObjectLiteralExpression(entries)) continue;
      for (const entry of entries.properties) {
        if (!ts.isPropertyAssignment(entry)) continue;
        const key = propertyName(entry.name);
        const translation = literalValue(entry.initializer);
        if (key && translation !== undefined) {
          addCatalogEntry(
            catalogs,
            language,
            key,
            translation,
            issues,
            `${origin}:${language}`,
          );
        }
      }
    }
  }

  function collectTranslationRows(array, origin, targetCatalogs = catalogs) {
    for (const element of array.elements) {
      const row = unwrap(element);
      if (!row || !ts.isArrayLiteralExpression(row)) continue;
      const values = row.elements.map(literalValue);
      if (values.length !== languages.length + 1 || values.some((value) => value === undefined)) {
        issues.push(`${origin} must contain source plus exactly ${languages.length} translations.`);
        continue;
      }
      const [sourceText, ...translations] = values;
      languages.forEach((language, index) =>
        addCatalogEntry(
          targetCatalogs,
          language,
          sourceText,
          translations[index],
          issues,
          origin,
        ),
      );
    }
  }

  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      collectLanguageObject(node, locationOf(file, node));
    }
    if (ts.isVariableDeclaration(node)) {
      const initializer = unwrap(node.initializer);
      const namedTranslationRows = /TranslationRows$/.test(node.name.getText(source));
      const domainRowTable =
        isDomainCatalog &&
        initializer &&
        ts.isArrayLiteralExpression(initializer) &&
        initializer.elements.length > 0 &&
        initializer.elements.every((element) =>
          ts.isArrayLiteralExpression(unwrap(element)),
        );
      if (initializer && ts.isArrayLiteralExpression(initializer)) {
        if (namedTranslationRows) {
          collectTranslationRows(initializer, locationOf(file, node));
        } else if (domainRowTable) {
          // Domain labels intentionally overlap contextual UI labels (for
          // example the Back muscle and the Back navigation action). Validate
          // them as their own runtime catalog rather than treating a valid
          // contextual translation as a conflicting UI-catalog duplicate.
          collectTranslationRows(
            initializer,
            locationOf(file, node),
            runtimeDomainCatalogs,
          );
        }
      }
    }
    if (
      isDomainCatalog &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "template"
    ) {
      const origin = locationOf(file, node);
      const regexParts = regularExpressionParts(node.arguments[0]);
      const renderers = unwrap(node.arguments[1]);
      if (!regexParts) {
        issues.push(`${origin} template must use a regular-expression literal.`);
      }
      if (!renderers || !ts.isObjectLiteralExpression(renderers)) {
        issues.push(`${origin} template must provide a renderer object.`);
      } else {
        const rendererLanguages = new Set(
          renderers.properties
            .map((property) => propertyName(property.name))
            .filter((language) => languageSet.has(language)),
        );
        const missingRenderers = languages.filter(
          (language) => !rendererLanguages.has(language),
        );
        if (missingRenderers.length) {
          issues.push(
            `${origin} template is missing renderers for: ${missingRenderers.join(", ")}.`,
          );
        } else if (regexParts) {
          try {
            runtimeTemplatePatterns.push({
              origin,
              pattern: new RegExp(regexParts.source, regexParts.flags),
              scannerPattern: scannerPatternFromRuntimeRegex(
                regexParts.source,
                regexParts.flags,
              ),
            });
          } catch {
            issues.push(`${origin} contains an invalid runtime translation pattern.`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function collectCatalogsFromJson(directory, catalogs, issues) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const language = entry.name.replace(/\.json$/, "");
    if (!languageSet.has(language)) continue;
    const file = path.join(directory, entry.name);
    const values = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [source, translation] of Object.entries(values)) {
      // Curated inline entries take precedence over generated fallbacks.
      if (catalogs[language].has(source)) continue;
      addCatalogEntry(
        catalogs,
        language,
        source,
        typeof translation === "string" ? translation : "",
        issues,
        path.relative(root, file),
      );
    }
  }
}

function templatePattern(source) {
  const escaped = source
    .split(/\{[^}]+\}/g)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".+?")}$`, "s");
}

const catalogs = catalogMaps();
const runtimeDomainCatalogs = catalogMaps();
const catalogIssues = [];
const runtimeTemplatePatterns = [];
for (const file of walkFiles(path.join(root, "src", "i18n"))) {
  collectCatalogsFromTypeScript(
    file,
    catalogs,
    catalogIssues,
    runtimeDomainCatalogs,
    runtimeTemplatePatterns,
  );
}
collectCatalogsFromJson(path.join(root, "src", "i18n", "catalogs"), catalogs, catalogIssues);

const catalogKeys = new Set(
  languages.flatMap((language) => [...catalogs[language].keys()]),
);
const runtimeDomainKeys = new Set(
  languages.flatMap((language) => [...runtimeDomainCatalogs[language].keys()]),
);
const templatePatterns = [...catalogKeys]
  // Placeholder-only formatting rows such as "{value1}" must not match every
  // untranslated phrase. Runtime translation applies only templates with
  // actual words, so validation must enforce the same boundary.
  .filter(
    (key) =>
      /\{[^}]+\}/.test(key) &&
      /\p{L}/u.test(key.replace(/\{[^}]+\}/g, "")),
  )
  .map((key) => ({ key, pattern: templatePattern(key) }));

const uiCopy = new Map();
const pathErrors = [];
for (const directory of [
  path.join(root, "app"),
  path.join(root, "src", "components"),
  path.join(root, "src", "notifications"),
  path.join(root, "src", "cloud"),
  path.join(root, "src", "screenTime"),
  path.join(root, "src", "widgets"),
]) {
  for (const file of walkFiles(directory)) scanUiFile(file, uiCopy, pathErrors);
}
for (const file of [
  path.join(root, "src", "domain", "alerts.ts"),
  path.join(root, "src", "domain", "badges.ts"),
  path.join(root, "src", "domain", "gym.ts"),
  path.join(root, "src", "domain", "leaderboard.ts"),
  path.join(root, "src", "domain", "metrics.ts"),
  path.join(root, "src", "domain", "recaps.ts"),
  path.join(root, "src", "domain", "trackerCatalog.ts"),
]) {
  scanUiFile(file, uiCopy, pathErrors);
}

function candidateValuesForPlaceholder(copy, start) {
  const before = copy.slice(0, start);
  if (/\b(?:day|workout|time)$/.test(before)) return ["", "s"];
  if (/\{$/.test(before)) return ["1"];
  return [
    "1",
    "1.5",
    "Steps",
    "Breakfast",
    "more",
    "below",
    "selected day",
    "2026-01-01",
    "",
    "s",
    " at 6 days",
    "+",
  ];
}

function concreteRuntimeCandidates(copy, limit = 20000) {
  const placeholder = /\{[^}]+\}/g;
  const matches = [...copy.matchAll(placeholder)];
  if (!matches.length) return [];
  const candidates = [];

  function expand(index, cursor, value) {
    if (candidates.length >= limit) return;
    if (index >= matches.length) {
      candidates.push(`${value}${copy.slice(cursor)}`);
      return;
    }
    const match = matches[index];
    const start = match.index;
    const nextCursor = start + match[0].length;
    const prefix = `${value}${copy.slice(cursor, start)}`;
    for (const replacement of candidateValuesForPlaceholder(copy, start)) {
      expand(index + 1, nextCursor, `${prefix}${replacement}`);
    }
  }

  expand(0, 0, "");
  return candidates;
}

function coveredByRuntimeTemplate(copy) {
  if (
    runtimeTemplatePatterns.some(
      ({ pattern, scannerPattern }) =>
        pattern.test(copy) || scannerPattern?.test(copy),
    )
  ) {
    return true;
  }
  if (!/\{[^}]+\}/.test(copy)) return false;
  return concreteRuntimeCandidates(copy).some((candidate) =>
    runtimeTemplatePatterns.some(({ pattern }) => pattern.test(candidate)),
  );
}

const missingByLanguage = [];
for (const key of [...catalogKeys].sort()) {
  for (const language of languages) {
    if (!catalogs[language].has(key)) missingByLanguage.push(`${language}: ${key}`);
  }
}

const uncovered = [...uiCopy.keys()]
  .filter(
    (copy) =>
      !catalogKeys.has(copy) &&
      !runtimeDomainKeys.has(copy) &&
      !coveredByRuntimeTemplate(copy) &&
      // JSON/catalog template coverage is valid only for a source expression
      // that the scanner itself normalized to placeholders.
      (!/\{[^}]+\}/.test(copy) ||
        !templatePatterns.some(({ pattern }) => pattern.test(copy))),
  )
  .sort((left, right) => left.localeCompare(right));

if (process.argv.includes("--json")) {
  process.stdout.write(
    `${JSON.stringify(
      {
        uiKeys: [...uiCopy.keys()].sort((left, right) => left.localeCompare(right)),
        uncovered,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const errors = [...catalogIssues, ...pathErrors];
if (missingByLanguage.length) {
  errors.push(
    `Catalog parity failed (${missingByLanguage.length} missing):\n${missingByLanguage
      .slice(0, 80)
      .map((item) => `  - ${item}`)
      .join("\n")}`,
  );
}
if (uncovered.length) {
  errors.push(
    `Untranslated interface copy (${uncovered.length} keys):\n${uncovered
      .slice(0, 120)
      .map((copy) => {
        const examples = uiCopy
          .get(copy)
          .slice(0, 2)
          .map(({ location, kind }) => `${location} (${kind})`)
          .join(", ");
        return `  - ${JSON.stringify(copy)} — ${examples}`;
      })
      .join("\n")}`,
  );
}

if (errors.length) {
  console.error(errors.join("\n\n"));
  console.error(
    `\ni18n validation failed: ${uiCopy.size - uncovered.length}/${uiCopy.size} detected UI keys covered; ${catalogKeys.size} catalog keys.`,
  );
  process.exit(1);
}

console.log(
  `i18n validation passed: ${uiCopy.size}/${uiCopy.size} detected UI keys covered across ${languages.length} translated catalogs.`,
);
