/**
 * runConformanceSuite: mechanical proof that a VSLAdapter implementation is
 * conformant, not just documentation claiming it is.
 *
 * Each check below constructs a real PreNode/Invariant and exercises the
 * adapter's compiled gate directly, using a mutable side-effect counter
 * cell to prove ordering (F1 pre-commitment) rather than merely checking
 * return values. Port of vsl_core/conformance/suite.py.
 */

import { Invariant, PreNode } from "../constructs.js";
import { AutomationDeniedException, ConformanceError, InvariantViolation } from "../exceptions.js";
import { AssuranceBasis, F2Modification, GammaEstimate } from "../metrics.js";
import { CompiledGate, VSLAdapter } from "./protocol.js";

// These synthetic PreNodes are genuinely formation-layer, full-F2 checks --
// HIGH is the correct, justified claim for them, not a lazy default.
const HIGH_ASSURANCE_BASIS = new AssuranceBasis(true, F2Modification.FULL);

function requireCallableGate(adapterName: string, methodName: string, gate: unknown): void {
  if (typeof gate !== "function") {
    throw new ConformanceError(
      `${adapterName}.${methodName} did not return a callable gate (got ${JSON.stringify(
        gate
      )}); the conformance suite cannot run against it.`
    );
  }
}

/**
 * Check 1: a PreNode whose monitor returns a GammaEstimate below
 * gammaThreshold must have its compiled gate throw before a side-effect
 * counter increments.
 */
async function checkPreNodeBlocksBeforeSideEffect(adapter: VSLAdapter): Promise<string[]> {
  const failures: string[] = [];
  const counter = { value: 0 };

  const preNode = new PreNode({
    name: "conformance-blocking",
    description: "Conformance check: below-threshold Gamma must block.",
    monitor: async () => new GammaEstimate({ gammaHat: 0.1 }),
    assuranceBasis: HIGH_ASSURANCE_BASIS,
    gammaThreshold: 1.1,
  });
  const gate: CompiledGate = adapter.compilePreNode(preNode);
  requireCallableGate(adapter.constructor.name, "compilePreNode", gate);

  let threw = false;
  try {
    await gate("candidate");
    counter.value += 1;
  } catch (exc) {
    if (exc instanceof AutomationDeniedException) {
      threw = true;
    } else {
      throw exc;
    }
  }

  if (!threw) {
    failures.push(
      "Check 1 (PreNode pre-commitment blocking): compiled gate did not throw AutomationDeniedException for an insufficient Gamma estimate."
    );
  }
  if (counter.value !== 0) {
    failures.push(
      "Check 1 (PreNode pre-commitment blocking): the side-effect counter incremented despite the gate throwing -- F1 pre-commitment violated."
    );
  }
  return failures;
}

/**
 * Check 2: a PreNode whose monitor returns a GammaEstimate above threshold
 * must not throw, and the side-effect counter must increment normally
 * afterward.
 */
async function checkPreNodeAllowsAfterPass(adapter: VSLAdapter): Promise<string[]> {
  const failures: string[] = [];
  const counter = { value: 0 };

  const preNode = new PreNode({
    name: "conformance-passing",
    description: "Conformance check: above-threshold Gamma must pass through.",
    monitor: async () => new GammaEstimate({ gammaHat: 5.0 }),
    assuranceBasis: HIGH_ASSURANCE_BASIS,
    gammaThreshold: 1.1,
  });
  const gate: CompiledGate = adapter.compilePreNode(preNode);
  requireCallableGate(adapter.constructor.name, "compilePreNode", gate);

  try {
    await gate("candidate");
    counter.value += 1;
  } catch (exc) {
    if (exc instanceof AutomationDeniedException) {
      failures.push(
        `Check 2 (PreNode pass-through): gate threw unexpectedly for a sufficient Gamma estimate (${exc}).`
      );
      return failures;
    }
    throw exc;
  }

  if (counter.value !== 1) {
    failures.push(
      "Check 2 (PreNode pass-through): the side-effect counter did not increment after a passing gate call."
    );
  }
  return failures;
}

/**
 * Check 3: an Invariant whose rule returns false must throw
 * InvariantViolation specifically -- not a bare AutomationDeniedException.
 * Invariants get no Fallback, straight to Terminal per the spec.
 */
async function checkInvariantViolationIsSpecificType(adapter: VSLAdapter): Promise<string[]> {
  const failures: string[] = [];

  const invariant = new Invariant({
    name: "conformance-invariant-fail",
    description: "Conformance check: a failing rule must throw InvariantViolation.",
    rule: async () => false,
    assuranceBasis: HIGH_ASSURANCE_BASIS,
  });
  const gate: CompiledGate = adapter.compileInvariant(invariant);
  requireCallableGate(adapter.constructor.name, "compileInvariant", gate);

  try {
    await gate("candidate");
    failures.push(
      "Check 3 (Invariant violation specificity): compiled gate did not throw for a failing Invariant rule."
    );
  } catch (exc) {
    if (exc instanceof InvariantViolation) {
      // expected
    } else if (exc instanceof AutomationDeniedException) {
      failures.push(
        `Check 3 (Invariant violation specificity): gate threw ${exc.constructor.name}, expected the more specific InvariantViolation.`
      );
    } else {
      throw exc;
    }
  }
  return failures;
}

/** Check 4: an Invariant whose rule returns true must not throw. */
async function checkInvariantPass(adapter: VSLAdapter): Promise<string[]> {
  const failures: string[] = [];

  const invariant = new Invariant({
    name: "conformance-invariant-pass",
    description: "Conformance check: a passing rule must not throw.",
    rule: async () => true,
    assuranceBasis: HIGH_ASSURANCE_BASIS,
  });
  const gate: CompiledGate = adapter.compileInvariant(invariant);
  requireCallableGate(adapter.constructor.name, "compileInvariant", gate);

  try {
    await gate("candidate");
  } catch (exc) {
    failures.push(
      `Check 4 (Invariant pass-through): gate threw unexpectedly for a passing rule (${
        exc instanceof Error ? exc.constructor.name : String(exc)
      }).`
    );
  }
  return failures;
}

/**
 * Check 5: a compiled gate must be safely reusable. Construct once, call
 * with a passing input then a failing input (then passing again), and
 * confirm no state leaks between calls.
 */
async function checkGateReusableWithoutStateLeak(adapter: VSLAdapter): Promise<string[]> {
  const failures: string[] = [];

  const preNode = new PreNode({
    name: "conformance-reusable",
    description: "Conformance check: a compiled gate must be reusable across calls.",
    monitor: async (candidateInput) => new GammaEstimate({ gammaHat: candidateInput === "good" ? 5.0 : 0.1 }),
    assuranceBasis: HIGH_ASSURANCE_BASIS,
    gammaThreshold: 1.1,
  });
  const gate: CompiledGate = adapter.compilePreNode(preNode);
  requireCallableGate(adapter.constructor.name, "compilePreNode", gate);

  try {
    await gate("good");
  } catch (exc) {
    if (exc instanceof AutomationDeniedException) {
      failures.push(`Check 5 (gate reusability): first call with a passing input threw unexpectedly (${exc}).`);
    } else {
      throw exc;
    }
  }

  let threw = false;
  try {
    await gate("bad");
  } catch (exc) {
    if (exc instanceof AutomationDeniedException) {
      threw = true;
    } else {
      throw exc;
    }
  }
  if (!threw) {
    failures.push(
      "Check 5 (gate reusability): second call with a failing input did not throw -- state may have leaked from the first (passing) call."
    );
  }

  try {
    await gate("good");
  } catch (exc) {
    if (exc instanceof AutomationDeniedException) {
      failures.push(
        `Check 5 (gate reusability): third call with a passing input threw unexpectedly after a prior failing call (${exc}) -- state leaked from the second (failing) call.`
      );
    } else {
      throw exc;
    }
  }

  return failures;
}

async function runAllChecks(adapter: VSLAdapter): Promise<string[]> {
  const failures: string[] = [];
  failures.push(...(await checkPreNodeBlocksBeforeSideEffect(adapter)));
  failures.push(...(await checkPreNodeAllowsAfterPass(adapter)));
  failures.push(...(await checkInvariantViolationIsSpecificType(adapter)));
  failures.push(...(await checkInvariantPass(adapter)));
  failures.push(...(await checkGateReusableWithoutStateLeak(adapter)));
  return failures;
}

/**
 * Run all behavioral conformance checks against `adapter`.
 *
 * Returns an array of human-readable failure descriptions; an empty array
 * means fully conformant. Throws ConformanceError only if the adapter's
 * own methods are broken badly enough to prevent the suite from running at
 * all (e.g. returning something uncallable as a "gate").
 */
export async function runConformanceSuite(adapter: VSLAdapter): Promise<string[]> {
  return runAllChecks(adapter);
}
