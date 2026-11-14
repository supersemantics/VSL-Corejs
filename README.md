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

## Quickstart: gate a tool call in 5 lines

```
npm install @supersemantics/vsl-core
```

Your agent has a tool, say `issueRefund`. You want a rule checked **before** the tool runs, and the
call stopped if the rule fails. That check is a gate:

```javascript
import {
  AssuranceBasis, F2Modification, Invariant, InvariantViolation, PlainJsReferenceAdapter,
} from "@supersemantics/vsl-core";

const withinCap = async (args) => args.amount <= 500;
const cap = new Invariant({ name: "refund-cap", description: "Refunds of $500 or less.", rule: withinCap,
  assuranceBasis: new AssuranceBasis(true, F2Modification.NONE) });
const gate = new PlainJsReferenceAdapter().compileInvariant(cap);

async function refund(args) {
  await gate(args);           // throws InvariantViolation if the rule fails
  return issueRefund(args);   // only reached when it holds
}
```

What each line does:

- `withinCap` is the rule: plain code that answers yes or no for this one call.
- `Invariant` gives the rule a name and says how strong the check is. It runs before the action
  (`true`: F1) and changes nothing about what a model produces (`F2Modification.NONE`). That makes its
  assurance level LOW: it blocks, but it doesn't steer a model. `vsl-core`'s README explains
  [F1/F2](https://github.com/supersemantics/VSL-Core#the-f1f2-assurance-distinction-read-this-before-trusting-any-assurance-level).
- `compileInvariant` turns the rule into a gate: an async function that resolves when the rule holds
  and throws when it doesn't. `PlainJsReferenceAdapter` is the adapter for plain JavaScript, with no
  agent framework underneath.
- `await gate(args)` goes right before the tool. If it throws, the tool never runs.

`refund({ orderId: "A200", amount: 9000 })` throws `InvariantViolation` ("Invariant 'refund-cap'
violated") and no refund is issued. The whole file, ready to run, is
[`examples/quickstart.mjs`](https://github.com/supersemantics/VSL-Corejs/blob/HEAD/examples/quickstart.mjs).

**Keep a record of each decision.** The gate blocks on its own, but writes nothing down. To keep a
hash-chained record of every allow and deny, write it from the rule:

```javascript
import { VerbaLedger } from "@supersemantics/vsl-core";

const ledger = new VerbaLedger(); // in memory; new VerbaLedger(new JsonlLedgerStore("decisions.jsonl")) for a file

const withinCap = async (args) => {
  const allowed = args.amount <= 500;
  await ledger.writeGateDecision("refund-agent", "refund-cap", { allowed });
  return allowed;
};
```

`await ledger.verifyIntegrity()` returns `true` while no entry has been changed.

**Using LangGraph.js?** [`@supersemantics/vsl-langgraph`](https://github.com/supersemantics/VSL-Langgraphjs)
compiles the same `Invariant` into a graph node. For a complete agent to start from, see the
[LangGraph.js starter](https://github.com/supersemantics/supersemantics-VSL-Starters/tree/main/langgraph-js).

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

**`LedgerStore` is async here; it's synchronous in Python.** A store that
keeps entries over the network cannot be synchronous in JavaScript -- there
is no synchronous `fetch`.
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

```bash
npm install @supersemantics/vsl-core
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
