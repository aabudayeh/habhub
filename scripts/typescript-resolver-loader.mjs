/**
 * Node's type-stripping mode intentionally follows strict ESM resolution,
 * while Metro/TypeScript use extensionless local imports. This validation-only
 * loader resolves those imports without changing application source syntax.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isLocal = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (!isLocal || hasExtension || error?.code !== "ERR_MODULE_NOT_FOUND")
      throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
