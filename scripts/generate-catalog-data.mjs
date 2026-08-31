// Regenerates src/catalog/{drift_classes,legion_patterns}.data.ts from the
// canonical JSON files. Run this again whenever those JSON files change --
// they are the source of truth; the .ts modules are a generated,
// committed artifact, not hand-edited.
//
// Why generated .ts modules instead of runtime JSON reads: this package
// ships both ESM and CommonJS builds (see tsconfig.cjs.json). Reading the
// JSON at runtime via fs.readFileSync relative to import.meta.url works
// in ESM but import.meta doesn't exist under CommonJS at all -- a hard
// compile error, not just a runtime one. Plain `export const x = {...}`
// TS modules compile identically under both module targets via plain
// tsc, no bundler or import.meta/__dirname branching required.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const catalogDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "src", "catalog");

function generate(jsonFilename, tsFilename, exportName) {
  const data = JSON.parse(readFileSync(join(catalogDir, jsonFilename), "utf-8"));
  const body =
    `// Generated from ${jsonFilename} by scripts/generate-catalog-data.mjs -- do not hand-edit.\n` +
    `// Run \`node scripts/generate-catalog-data.mjs\` again after changing ${jsonFilename}.\n` +
    `export const ${exportName} = ${JSON.stringify(data, null, 2)} as const;\n`;
  writeFileSync(join(catalogDir, tsFilename), body);
}

generate("drift_classes.json", "drift_classes.data.ts", "driftClassesData");
generate("legion_patterns.json", "legion_patterns.data.ts", "legionPatternsData");
console.log("Regenerated drift_classes.data.ts and legion_patterns.data.ts");
