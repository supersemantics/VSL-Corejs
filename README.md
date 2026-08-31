# @supersemantics/vsl-core

A TypeScript port of [`vsl-core`](https://github.com/supersemantics/VSL-Core) --
the Python original, and the canonical reference for the VSL (VERBA
Specification Language) governance vocabulary. This package exists so the
same primitives are available to Node/TypeScript agent frameworks
(LangGraph.js, LangChain.js, and others) without requiring a Python
runtime alongside them.

**Is:**
- A faithful port of `vsl-core`'s constructs -- `PreNode`, `Invariant`, `AssuranceBasis`, `GammaEstimate`, `VerbaLedger`, `Cluster`, the conformance suite, and the Drift Class / Stabilisation Operator catalog.
- Framework-agnostic and model-agnostic, same as the Python original -- this package never imports an agent-framework package or model-provider SDK, and never will.
- Zero runtime dependencies -- only Node built-ins (`node:crypto`, `node:fs`), same guarantee `vsl-core` makes for Python.

**Is not:**
- The reference implementation. When the Python and TypeScript versions disagree on a design question, `vsl-core`'s own README and source are the source of truth -- see it first if something here seems inconsistent with what you already know from the Python package.
- A byte-for-byte transliteration. A handful of things are deliberately adapted to TypeScript/Node rather than translated line-by-line -- see "Where this diverges from `vsl-core`" below. Every departure is a conscious design decision, documented in code and here, not an oversight.
- A framework adapter. This package ships no LangGraph.js, LangChain.js, or other framework integration. Those belong in separate `@supersemantics/vsl-<framework>` packages, the same separation `vsl-core`'s Python ecosystem already follows (`vsl-langgraph`, `vsl-langchain`, `vsl-maf`).

## Quick taste

```typescript
import {
  AssuranceBasis,
  F2Modification,
  GammaEstimate,
  PreNode,
  VerbaLedger,
} from "@supersemantics/vsl-core";

const preNode = new PreNode({
  name: "refund-cap",
  description: "Requires refund amount under the hard cap.",
  monitor: async (candidateInput) => {
    const amount = (candidateInput as { amount: number }).amount;
    return new GammaEstimate({ gammaHat: amount <= 1000 ? 2.0 : 0.0 });
  },
  assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
});

const ledger = new VerbaLedger();
await ledger.writeMonitor("agent-1", false);
console.log(await ledger.verifyIntegrity()); // true
```

`PreNode`/`Invariant` compile into a framework's own gate the same way they
do in Python -- via a `VSLAdapter` implementation. See
[`vsl_core.conformance.protocol.VSLAdapter`](https://github.com/supersemantics/VSL-Core#building-an-adapter)
in the Python README for what "conformant" actually means; the same
contract (`compilePreNode`/`compileInvariant`, verified by
`runConformanceSuite`) applies here.

## Where this diverges from `vsl-core`

Two deliberate departures from the Python source, both documented at the
point they matter in code -- not silent translations, not oversights:

**`LedgerStore` is async here; it's synchronous in Python.** A future
HTTP-backed remote store for this package (the TS equivalent of
[`vsl-core-ledger-client`](https://github.com/supersemantics/VSL-Core-ledger-client))
cannot be synchronous in JavaScript -- there is no synchronous `fetch`.
Rather than port the synchronous interface and break it later, every
`LedgerStore` implementation here -- including `InMemoryLedgerStore` and
`JsonlLedgerStore`, neither of which strictly needs it -- is
`Promise`/`AsyncIterable`-based from the start.

**`JsonlLedgerStore`'s cross-process file locking is narrower than
Python's.** Python's version holds a real OS-level advisory lock
(`fcntl.flock`/`msvcrt.locking`) across its read-last-entry-then-write
critical section, closing the race between two separate store instances --
in one process or several -- writing to the same file. Node's standard
library has no equivalent cross-process locking primitive. This port only
serializes writers *within the same Node process*. It does **not** protect
against two separate Node processes (or two machines) appending to the
same file concurrently -- that can still corrupt the chain. This is
disclosed here and in `ledger.ts`'s own docstring, not silently narrowed.
Don't point multiple processes at the same `JsonlLedgerStore` file until
this gap is closed.

Everything else -- `AssuranceBasis`'s validation and derivation table,
`GammaEstimate.sufficient()`'s robust-gamma gating, `Cluster`'s
constituent-coverage check, the five `audit()` checks and their causal
correlation via `causedBy`, the conformance suite's five checks -- is a
direct, faithful port of the same logic `vsl-core` implements in Python.

## The catalog

The Drift Class / Stabilisation Operator / Legion detection-heuristic data
(`catalog/drift_classes.json`, `catalog/legion_patterns.json`) is copied
verbatim from `vsl-core`'s own OSS data files -- same license, same
package, same author. `validate()` surfaces the same real data-quality
findings the Python loader does (the `metadata.total_drift_classes`
miscount, the `CLUSTER-HANDOVER` orphan, drift classes with zero Legion
heuristics) rather than silently fixing them. As in Python: this catalog
is explicitly not a finished, validated detection system -- call
`onlyValidatedHeuristics()` if you want only the HIGH/MEDIUM-confidence
subset.

## Install

Not yet published to npm.

```bash
npm install github:supersemantics/vsl-core-ts
```

## Layout

```
src/
├── exceptions.ts        VSLError hierarchy
├── metrics.ts            Delta, Gamma, GES, EEF, AssuranceBasis, F2Modification
├── identity.ts            IdentityKey, ClusterKey, Instance, Evidence
├── constructs.ts          PreNode, Invariant, Fallback, TerminalState, AllowedState
├── cluster.ts               Cluster, ClusterPreNode
├── ledger.ts                VerbaLedger, LedgerEntry, LedgerStore + 2 implementations
├── governance.ts            GovernanceAuthority, HumanAuthorisedTransition, Specification
├── catalog/                 Drift Class / Stabilisation Operator / Legion data + loader
└── conformance/              VSLAdapter protocol, runConformanceSuite, reference adapter
```

## Status

Alpha. 51 tests pass across every module, including a full round trip
through the built `dist/` output (not just source via the test runner).
Strict-mode TypeScript, 0 known vulnerabilities, zero runtime dependencies.

## License

MIT -- see LICENSE. Copyright Super Semantics.
