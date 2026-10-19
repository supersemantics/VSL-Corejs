/**
 * @supersemantics/vsl-core -- framework-agnostic and model-agnostic VSL
 * (VERBA Specification Language) governance primitives. TypeScript port of
 * vsl-core (https://github.com/supersemantics/VSL-Core).
 *
 * Note for callers coming from the Python package: runConformanceSuite is
 * async here (returns Promise<string[]>), not synchronous -- JS has no
 * built-in way to block on a Promise the way Python's asyncio.run() does,
 * so `await runConformanceSuite(adapter)` is the idiomatic TS equivalent.
 */

export * from "./exceptions.js";
export * from "./metrics.js";
export * from "./rules_version.js";
export * from "./identity.js";
export * from "./constructs.js";
export * from "./cluster.js";
export * from "./ledger.js";
export * from "./governance.js";
export * as catalog from "./catalog/loader.js";
export * from "./conformance/protocol.js";
export * from "./conformance/suite.js";
export * from "./conformance/reference_adapter.js";
