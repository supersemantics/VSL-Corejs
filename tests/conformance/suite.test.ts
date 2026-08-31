import { describe, expect, it } from "vitest";
import { Invariant, PreNode } from "../../src/constructs.js";
import { AutomationDeniedException, ConformanceError } from "../../src/exceptions.js";
import { PlainJsReferenceAdapter } from "../../src/conformance/reference_adapter.js";
import { CompiledGate, VSLAdapter } from "../../src/conformance/protocol.js";
import { runConformanceSuite } from "../../src/conformance/suite.js";

/** An adapter whose compiled gates never throw, regardless of input -- must fail the suite, not pass it. */
class NeverRaisesAdapter implements VSLAdapter {
  compilePreNode(_preNode: PreNode): CompiledGate {
    return async () => {};
  }
  compileInvariant(_invariant: Invariant): CompiledGate {
    return async () => {};
  }
}

/**
 * An adapter whose compiled gates always throw, regardless of input --
 * must fail the suite's pass-through checks. Throws
 * AutomationDeniedException specifically, not a plain Error: Check 2's
 * catch block rethrows anything that isn't AutomationDeniedException
 * rather than recording it as a failure, so a plain Error here would
 * crash the suite call instead of exercising the check this test is
 * actually about.
 */
class AlwaysRaisesAdapter implements VSLAdapter {
  compilePreNode(_preNode: PreNode): CompiledGate {
    return async () => {
      throw new AutomationDeniedException({ reason: "always denies", identityKey: "test" });
    };
  }
  compileInvariant(_invariant: Invariant): CompiledGate {
    return async () => {
      throw new AutomationDeniedException({ reason: "always denies", identityKey: "test" });
    };
  }
}

/** An adapter that returns something uncallable as a "gate" -- must throw ConformanceError, not silently proceed. */
class NonCallableGateAdapter implements VSLAdapter {
  compilePreNode(_preNode: PreNode): CompiledGate {
    return "not a function" as unknown as CompiledGate;
  }
  compileInvariant(_invariant: Invariant): CompiledGate {
    return "not a function" as unknown as CompiledGate;
  }
}

describe("runConformanceSuite -- verifying it actually catches broken adapters", () => {
  it("the reference adapter is fully conformant", async () => {
    expect(await runConformanceSuite(new PlainJsReferenceAdapter())).toEqual([]);
  });

  it("catches an adapter whose gates never raise", async () => {
    const failures = await runConformanceSuite(new NeverRaisesAdapter());
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes("Check 1"))).toBe(true);
    expect(failures.some((f) => f.includes("Check 3"))).toBe(true);
  });

  it("catches an adapter whose gates always raise", async () => {
    const failures = await runConformanceSuite(new AlwaysRaisesAdapter());
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes("Check 2"))).toBe(true);
    expect(failures.some((f) => f.includes("Check 4"))).toBe(true);
  });

  it("throws ConformanceError, not a silent failure entry, when a gate isn't callable", async () => {
    await expect(runConformanceSuite(new NonCallableGateAdapter())).rejects.toThrow(ConformanceError);
  });

  it("propagates an unexpected (non-AutomationDeniedException) error from a gate rather than swallowing it as a failure entry", async () => {
    class ThrowsPlainErrorAdapter implements VSLAdapter {
      compilePreNode(_preNode: PreNode): CompiledGate {
        return async () => {
          throw new TypeError("something genuinely broke, unrelated to governance");
        };
      }
      compileInvariant(_invariant: Invariant): CompiledGate {
        return async () => {};
      }
    }
    await expect(runConformanceSuite(new ThrowsPlainErrorAdapter())).rejects.toThrow(TypeError);
  });
});
