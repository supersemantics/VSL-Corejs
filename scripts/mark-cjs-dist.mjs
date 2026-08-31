// Writes dist/cjs/package.json = { "type": "commonjs" }. The root
// package.json sets "type": "module", so without this, Node would treat
// every .js file under dist/cjs/ as ESM regardless of the CommonJS
// syntax tsconfig.cjs.json actually compiled them to -- Node supports a
// nested package.json overriding "type" for everything under it, which
// is the standard, dependency-free way to ship a dual ESM+CJS package
// without renaming every output file to .cjs.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
writeFileSync(join(root, "dist", "cjs", "package.json"), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
console.log("Wrote dist/cjs/package.json");
