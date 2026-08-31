import { describe, expect, it } from "vitest";
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

const highBasis = () => new AssuranceBasis(true, F2Modification.FULL);

describe("PreNode fallback validation", () => {
  it("rejects a negative maxRetries", () => {
    expect(
      () =>
        new PreNode({
          name: "x",
          description: "x",
          monitor: async () => new GammaEstimate({ gammaHat: 1.0 }),
          assuranceBasis: highBasis(),
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
          assuranceBasis: highBasis(),
          fallback: new Fallback({ deltaFactor: 0 }),
        })
    ).toThrow(/deltaFactor must be > 0/);
  });

  it("defaults to the ROBUST_GAMMA_DEFAULT_THRESHOLD and a default Fallback", () => {
    const node = new PreNode({
      name: "x",
      description: "x",
      monitor: async () => new GammaEstimate({ gammaHat: 1.0 }),
      assuranceBasis: highBasis(),
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
      assuranceBasis: highBasis(),
    });
    registerInvariant(inv);
    expect(() => registerInvariant(inv)).toThrow(/already registered/);
    expect(registeredInvariants().some((i) => i.name === inv.name)).toBe(true);
  });
});

describe("AllowedState", () => {
  it("derives assuranceLevel from its assuranceBasis, not settable directly", () => {
    const state = new AllowedState({
      name: "approved",
      description: "x",
      assuranceBasis: highBasis(),
      measurement: "logit adjustment",
    });
    expect(state.assuranceLevel).toBe(AssuranceLevel.HIGH);
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

describe("Invariant.assuranceLevel", () => {
  it("derives from its assuranceBasis", async () => {
    const inv = new Invariant({
      name: `inv-level-${Date.now()}`,
      description: "x",
      rule: async () => true,
      assuranceBasis: highBasis(),
    });
    expect(inv.assuranceLevel).toBe(AssuranceLevel.HIGH);
  });

  it("cannotBeBypassed defaults to true", () => {
    const inv = new Invariant({
      name: `inv-bypass-${Date.now()}`,
      description: "x",
      rule: async () => true,
      assuranceBasis: highBasis(),
    });
    expect(inv.cannotBeBypassed).toBe(true);
  });
});

describe("PreNode.assuranceLevel", () => {
  it("derives from its assuranceBasis", () => {
    const node = new PreNode({
      name: "x",
      description: "x",
      monitor: async () => new GammaEstimate({ gammaHat: 1.0 }),
      assuranceBasis: highBasis(),
    });
    expect(node.assuranceLevel).toBe(AssuranceLevel.HIGH);
  });
});
