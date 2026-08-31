/**
 * PlainJsReferenceAdapter: the simplest possible conformant adapter --
 * direct call, no framework underneath it at all.
 *
 * This is real, tested code, not a label: runConformanceSuite must return
 * [] for it, proving the conformance contract is satisfiable, not merely
 * specified on paper. Port of vsl_core/conformance/reference_adapter.py
 * (PlainPythonReferenceAdapter).
 */

import { Invariant, PreNode } from "../constructs.js";
import { AutomationDeniedException, InvariantViolation } from "../exceptions.js";
import { CompiledGate } from "./protocol.js";

export class PlainJsReferenceAdapter {
  compilePreNode(preNode: PreNode): CompiledGate {
    return async (candidateInput: unknown): Promise<void> => {
      const estimate = await preNode.monitor(candidateInput);
      if (!estimate.sufficient(preNode.gammaThreshold)) {
        throw new AutomationDeniedException({
          reason: `Pre-node '${preNode.name}' insufficient Gamma`,
          identityKey: "conformance-test",
        });
      }
    };
  }

  compileInvariant(invariant: Invariant): CompiledGate {
    return async (candidateInput: unknown): Promise<void> => {
      const holds = await invariant.rule(candidateInput);
      if (!holds) {
        let reason = `Invariant '${invariant.name}' violated`;
        const terminalStateName = invariant.onViolation !== null ? invariant.onViolation.name : null;
        if (terminalStateName !== null) {
          reason += ` -- entering terminal state '${terminalStateName}'`;
        }
        throw new InvariantViolation({
          reason,
          identityKey: "conformance-test",
          invariantName: invariant.name,
          terminalStateName,
        });
      }
    };
  }
}
