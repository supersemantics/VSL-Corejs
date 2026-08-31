import { describe, expect, it } from "vitest";
import { Invariant, TerminalState } from "../../src/constructs.js";
import { InvariantViolation } from "../../src/exceptions.js";
import { AssuranceBasis, F2Modification } from "../../src/metrics.js";
import { PlainJsReferenceAdapter } from "../../src/conformance/reference_adapter.js";
import { runConformanceSuite } from "../../src/conformance/suite.js";

describe("PlainJsReferenceAdapter", () => {
  it("is fully conformant -- runConformanceSuite returns no failures", async () => {
    const failures = await runConformanceSuite(new PlainJsReferenceAdapter());
    expect(failures).toEqual([]);
  });

  it("includes the terminal state name in the reason when onViolation is set", async () => {
    const adapter = new PlainJsReferenceAdapter();
    const halted = new TerminalState({ name: "halted", description: "x" });
    const invariant = new Invariant({
      name: "hard-cap",
      description: "x",
      rule: async () => false,
      assuranceBasis: new AssuranceBasis(true, F2Modification.FULL),
      onViolation: halted,
    });
    const gate = adapter.compileInvariant(invariant);

    await expect(gate("candidate")).rejects.toThrow(/entering terminal state 'halted'/);
  });

  it("leaves the reason unchanged when onViolation is unset", async () => {
    const adapter = new PlainJsReferenceAdapter();
    const invariant = new Invariant({
      name: "hard-cap",
      description: "x",
      rule: async () => false,
      assuranceBasis: new AssuranceBasis(true, F2Modification.FULL),
    });
    const gate = adapter.compileInvariant(invariant);

    try {
      await gate("candidate");
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(InvariantViolation);
      expect((exc as InvariantViolation).reason).not.toContain("entering terminal state");
      expect((exc as InvariantViolation).terminalStateName).toBeNull();
    }
  });
});
