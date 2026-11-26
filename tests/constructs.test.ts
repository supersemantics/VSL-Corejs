import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AllowedState,
  Fallback,
  InadmissibleState,
  Invariant,
  PreNode,
  registerInvariant,
  registeredInvariants,
  TerminalState,
} from "../src/constructs.js";
import { AssuranceBasis, AssuranceLevel, F2Modification, GammaEstimate } from "../src/metrics.js";

describe("PreNode fallback validation", () => {
  it("rejects a negative maxRetries", () => {
    expect(
      () =>
        new PreNode({
          name: "x",
          description: "x",
          monitor: async () => new GammaEstimate({ gammaHat: 1.0 }),
              fallback: new Fallback({ maxRetries: -1 }),
        })
    ).toThrow(/maxRetries must be >= 0/);
  });

  it("rejects a non-positive deltaFactor", () => {
    expect(
      () =>
        new PreNode({
          name: "x",
          description: "x",
          monitor: async () => new GammaEstimate({ gammaHat: 1.0 }),
              fallback: new Fallback({ deltaFactor: 0 }),
        })
    ).toThrow(/deltaFactor must be > 0/);
  });

  it("defaults to the ROBUST_GAMMA_DEFAULT_THRESHOLD and a default Fallback", () => {
    const node = new PreNode({
      name: "x",
      description: "x",
      monitor: async () => new GammaEstimate({ gammaHat: 1.0 }),
    });
    expect(node.gammaThreshold).toBeCloseTo(1.1);
    expect(node.fallback.maxRetries).toBe(3);
  });
});

describe("Invariant registry", () => {
  it("rejects registering a duplicate name", () => {
    const inv = new Invariant({
      name: `dup-${Date.now()}`,
      description: "x",
      rule: async () => true,
    });
    registerInvariant(inv);
    expect(() => registerInvariant(inv)).toThrow(/already registered/);
    expect(registeredInvariants().some((i) => i.name === inv.name)).toBe(true);
  });
});

describe("AllowedState", () => {
  it("is built from a name, description and measurement", () => {
    const state = new AllowedState({ name: "approved", description: "x", measurement: "refund under cap" });
    expect(state.measurement).toBe("refund under cap");
    expect(state.validityConditions).toEqual([]);
  });
});

describe("InadmissibleState", () => {
  it("constructs with the required fields and defaults energyGapProxy to null", () => {
    const state = new InadmissibleState({ name: "drift-x", description: "x", signature: "pattern-a" });
    expect(state.energyGapProxy).toBeNull();
  });
});

describe("Fallback.equals", () => {
  it("two Fallbacks with the same field values are equal", () => {
    expect(new Fallback().equals(new Fallback())).toBe(true);
  });

  it("differs when any field differs", () => {
    expect(new Fallback({ maxRetries: 3 }).equals(new Fallback({ maxRetries: 5 }))).toBe(false);
  });
});

describe("TerminalState", () => {
  it("requires human-authorised transition by default", () => {
    const state = new TerminalState({ name: "halted", description: "x" });
    expect(state.requiresHumanAuthorisedTransition).toBe(true);
  });
});

describe("Invariant defaults", () => {
  it("cannotBeBypassed defaults to true", () => {
    const inv = new Invariant({ name: `inv-bypass-${Date.now()}`, description: "x", rule: async () => true });
    expect(inv.cannotBeBypassed).toBe(true);
  });
});

describe("assuranceBasis (deprecated)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // A fresh copy of the module, so its once-per-process warning state starts empty.
  async function freshConstructs() {
    vi.resetModules();
    return import("../src/constructs.js");
  }

  const monitor = async () => new GammaEstimate({ gammaHat: 1.0 });
  const rule = async () => true;

  it("gates built without one emit no warning", async () => {
    const emit = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const c = await freshConstructs();
    new c.PreNode({ name: "p", description: "d", monitor });
    new c.Invariant({ name: "i", description: "d", rule });
    new c.AllowedState({ name: "a", description: "d", measurement: "m" });
    expect(emit).not.toHaveBeenCalled();
  });

  it("passing one emits a DeprecationWarning, once per process, and changes nothing", async () => {
    const emit = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const c = await freshConstructs();
    const basis = new AssuranceBasis(true, F2Modification.FULL);
    const withBasis = new c.Invariant({ name: "i", description: "d", rule, assuranceBasis: basis });
    new c.PreNode({ name: "p", description: "d", monitor, assuranceBasis: basis });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(c.ASSURANCE_BASIS_DEPRECATION, { type: "DeprecationWarning", code: "VSL_ASSURANCE_BASIS" });
    expect(withBasis.cannotBeBypassed).toBe(true);
  });

  it("a construct without one still has an assuranceBasis for adapters released before 0.3.0", async () => {
    vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const c = await freshConstructs();
    const inv = new c.Invariant({ name: "i", description: "d", rule });
    expect(inv.assuranceBasis.f2Modification).toBe(F2Modification.NONE);
  });

  it("assuranceLevel is null without one, the derived level with one, and warns", async () => {
    const emit = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const c = await freshConstructs();
    expect(new c.PreNode({ name: "p", description: "d", monitor }).assuranceLevel).toBeNull();
    const basis = new AssuranceBasis(true, F2Modification.FULL);
    expect(new c.Invariant({ name: "i", description: "d", rule, assuranceBasis: basis }).assuranceLevel).toBe(AssuranceLevel.HIGH);
    expect(emit.mock.calls.map((call) => (call[1] as { code: string }).code)).toContain("VSL_ASSURANCE_LEVEL");
  });
});
