/**
 * The VSLAdapter/CompiledGate contract every framework adapter must
 * satisfy. Port of vsl_core/conformance/protocol.py.
 */

import { Invariant, PreNode } from "../constructs.js";

/**
 * A compiled, callable gate for a single PreNode or Invariant.
 *
 * Must throw vsl-core's AutomationDeniedException (or the more specific
 * InvariantViolation) if the check fails. Must resolve normally if it
 * passes. MUST complete (throw or resolve) strictly before any side effect
 * the gate guards is allowed to occur -- this is the F1 pre-commitment
 * property from the source spec, and it is the one property
 * runConformanceSuite exists to verify mechanically, not just document.
 */
export type CompiledGate = (candidateInput: unknown) => Promise<void>;

/** What a framework adapter must implement to be VSL-conformant. */
export interface VSLAdapter {
  compilePreNode(preNode: PreNode): CompiledGate;
  compileInvariant(invariant: Invariant): CompiledGate;
}
