import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function firstFile(candidates) {
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Node's type-stripping mode intentionally follows strict ESM resolution,
 * while Metro/TypeScript use extensionless local imports. This validation-only
 * loader resolves those imports without changing application source syntax.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const raw = path.join(root, specifier.slice(2));
    const candidate = firstFile([raw, `${raw}.ts`, `${raw}.tsx`]);
    if (candidate)
      return nextResolve(pathToFileURL(candidate).href, context);
  }
  const isLocal = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
  if (isLocal && !hasExtension && context.parentURL?.startsWith("file:")) {
    const raw = path.resolve(
      path.dirname(fileURLToPath(context.parentURL)),
      specifier,
    );
    const candidate = firstFile([raw, `${raw}.ts`, `${raw}.tsx`]);
    if (candidate)
      return nextResolve(pathToFileURL(candidate).href, context);
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!isLocal || hasExtension || error?.code !== "ERR_MODULE_NOT_FOUND")
      throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    const source = fs.readFileSync(fileURLToPath(url), "utf8");
    return {
      format: "module",
      source: ts.transpileModule(source, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: fileURLToPath(url),
      }).outputText,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
