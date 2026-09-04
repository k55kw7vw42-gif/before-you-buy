/**
 * Module resolve hook so `node --experimental-strip-types` can load the app's
 * TypeScript modules directly: it maps the `@/` path alias onto `src/` and adds
 * the `.ts` extension that ESM requires but TypeScript source omits.
 *
 * Used only by scripts/unit-test.mjs - the app itself is compiled by Next.
 */
import { pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = pathToFileURL(
  resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "src") + "/",
).href;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    return next(`${SRC}${specifier.slice(2)}.ts`, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
}
