# Changelog

What changed in each release, and why. Newest first. This package is the TypeScript port of [vsl-core](https://github.com/supersemantics/VSL-Core); releases track its rules, and the same assurance rules version means the same decisions in both.

## 0.2.4: quickstart, gate a tool call in 5 lines

The code is unchanged from 0.2.3.

**Before:** the README's first example built a `PreNode` and a ledger, but never showed a gate stopping
a tool call. There was no short, runnable path from `npm install` to a blocked call.

**After:** a "Quickstart: gate a tool call in 5 lines" section near the top of the README: a rule, an
`Invariant`, the gate, and the call before the tool, with each line explained in plain language. It
also shows how to record each decision in the ledger, and points to the LangGraph.js adapter and its
starter. The same code is in `examples/quickstart.mjs`.

**Why:** the README is the npm page. Someone arriving there should be able to gate a real tool call
in a minute, and see what the gate does and does not claim (it blocks; it doesn't steer a model).

## 0.2.3 (2026-11-13, tag `v0.2.3`): first release published from GitHub Actions, with provenance

The code is unchanged from 0.2.2.

**Before:** 0.2.2 was published by hand, the first time, because npm can only trust a workflow for a
package that already exists. It has no provenance.

**After:** this version is built, tested and published by `.github/workflows/publish.yml` when its tag
is pushed, through npm Trusted Publishing: no token is stored anywhere. npm shows a provenance
statement linking the package to the exact commit and workflow run that built it.

**Why:** anyone installing the package can check where it came from; and this first publish through
the workflow confirms the Trusted Publishing connection.

## 0.2.2 (2026-11-13, tag `v0.2.2`): published on npm

The first version on npm: `npm install @supersemantics/vsl-core`. The code is unchanged from 0.2.1.

**Before:** installed from GitHub (`npm install github:supersemantics/vsl-corejs`); the README said it
was not yet on npm, and `package.json` named no repository.

**After:** the README gives the npm command, `package.json` names the repository, homepage and issue
tracker and publishes publicly, and a pushed release tag publishes from GitHub Actions through npm
Trusted Publishing, with provenance (`.github/workflows/publish.yml`).

**Why:** an install from a registry, with a version; and vsl-langgraphjs can then depend on a version
range instead of a Git URL.

## 0.2.1 (2026-11-12, tag `v0.2.1`): docs

The README no longer points to a separate hosted ledger package when it explains why `LedgerStore` is async. No code change.

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
