# Changelog

What changed in each release, and why. Newest first. This package is the TypeScript port of [vsl-core](https://github.com/supersemantics/VSL-Core); releases track its rules, and the same assurance rules version means the same decisions in both.

## 0.2.0 — assurance rules version 2026.10 (matches vsl-core 0.2.0)

### Changed: how a Gamma threshold is applied (behaviour change only when `deltaEstimationError` > 0)

`GammaEstimate.sufficient(threshold)` now passes when `gammaHat` is strictly greater than `max(threshold, 1 + deltaEstimationError)`.

**Why.** A threshold already includes an estimation-error allowance: 1.1 is the 10% allowance, 1.2 is 20%. The old check divided `gammaHat` by `(1 + delta)` and then compared the result with the threshold, so a declared delta was counted on top of the allowance the threshold already held: `deltaEstimationError: 0.1` with the default threshold required `gammaHat > 1.21` instead of `1.1`. The new rule is the source spec's robust condition (robust Gamma above 1) with the threshold as the minimum allowance.

| `gammaHat` | delta | threshold | Before | Now |
|---|---|---|---|---|
| any | 0 | any | unchanged | unchanged |
| 1.15 | 0.1 | 1.1 | denied (needed > 1.21) | allowed (needs > 1.1) |
| 1.15 | 0.2 | 1.1 | denied (needed > 1.32) | denied (needs > 1.2) |
| 1.25 | 0.2 | 1.1 | denied (needed > 1.32) | allowed (needs > 1.2) |

Only monitors that set `deltaEstimationError` above 0 are affected; exactly on the bar still does not pass. New: `requiredGammaHat(threshold)`. Checked against vsl-core 0.2.0 on 140 threshold/delta/gamma combinations: identical decisions.

### Added: `VerbaLedger.writeGateDecision()`

One standard record of a gate's decision, with the same payload keys as vsl-core's `write_gate_decision()` so records from either package read the same way: a `MONITOR` entry with `primitive_name`, `allowed`, `rules_version` and `drift_detected` (`!allowed`), plus `gamma_hat`, `delta_estimation_error`, `robust_gamma`, `gamma_threshold` and `required_gamma_hat` for a PreNode. Pass `{ estimate, gammaThreshold }` for a PreNode (`allowed` is computed with the gate's own `sufficient()` check) or `{ allowed }` for an Invariant. A contradictory or incomplete record throws. Keys exported as `PRIMITIVE_NAME_KEY`, `GATE_ALLOWED_KEY`, `RULES_VERSION_KEY`. Recording is still a call your own code makes.

### Added: `ASSURANCE_RULES_VERSION`

`"2026.10"`, the same value as vsl-core, exported and written into every gate-decision record. `ledger.ts` still imports nothing but `exceptions.ts` and the import-free `rules_version.ts`.

### Documentation

Doc comments on `F2Modification`, `AssuranceLevel`, `AssuranceBasis` and `GammaEstimate` now match vsl-core: F2 is judged at the call the gate guards and is never earned by the gate itself (a gate that only allows or blocks is `NONE`; the application's own system prompt, RAG or input redaction makes it `PARTIAL`; `FULL` needs a model whose internals the application controls); the level measures influence on the model, not enforcement; monitors return a gate score in Gamma units. See vsl-core's README for the full guidance.

## 0.1.0

Initial TypeScript port of vsl-core, with an async `LedgerStore` interface and dual ESM/CommonJS builds.
