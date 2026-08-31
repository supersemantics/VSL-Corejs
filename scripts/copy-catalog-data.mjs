// Copies the catalog's JSON data files into dist/catalog/ after tsc builds
// the compiled JS there -- tsc does not copy non-.ts files on its own, and
// catalog/loader.ts resolves these files at runtime relative to its own
// location (see loader.ts), so they must sit alongside the compiled
// loader.js. Plain fs.cpSync, no dependency added for this.
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const filename of ["drift_classes.json", "legion_patterns.json"]) {
  cpSync(join(root, "src", "catalog", filename), join(root, "dist", "catalog", filename));
}
