import { describe, expect, it } from "vitest";
import {
  AssuranceBasis,
  AssuranceLevel,
  Beta,
  Delta,
  EEF,
  EEFZone,
  F2Modification,
  GAMMA_MONITORING_THRESHOLD,
  GammaEstimate,
  GES,
  JACOBIAN_RED_FLAG_THRESHOLD,
  KL_MONITORING_THRESHOLD,
  ROBUST_GAMMA_DEFAULT_THRESHOLD,
  Threshold,
} from "../src/metrics.js";

describe("AssuranceBasis.derivedLevel", () => {
  const cases: Array<[boolean, F2Modification, AssuranceLevel]> = [
    [false, F2Modification.FULL, AssuranceLevel.LOW],
    [false, F2Modification.PARTIAL, AssuranceLevel.LOW],
    [false, F2Modification.INDIRECT, AssuranceLevel.LOW],
    [false, F2Modification.NONE, AssuranceLevel.LOW],
    [true, F2Modification.FULL, AssuranceLevel.HIGH],
    [true, F2Modification.PARTIAL, AssuranceLevel.MEDIUM],
    [true, F2Modification.INDIRECT, AssuranceLevel.MEDIUM],
    [true, F2Modification.NONE, AssuranceLevel.LOW],
  ];

  for (const [f1, f2, expected] of cases) {
    it(`f1=${f1} f2=${f2} -> ${expected}`, () => {
      const basis = new AssuranceBasis(f1, f2);
      expect(basis.derivedLevel).toBe(expected);
    });
  }

  it("rejects a non-boolean f1PreCommitment", () => {
    // @ts-expect-error deliberately passing an invalid value to prove the runtime check
    expect(() => new AssuranceBasis(null, F2Modification.FULL)).toThrow(TypeError);
    // @ts-expect-error deliberately passing an invalid value to prove the runtime check
    expect(() => new AssuranceBasis(1, F2Modification.FULL)).toThrow(TypeError);
  });

  it("rejects a non-F2Modification f2Modification", () => {
    // @ts-expect-error deliberately passing an invalid value to prove the runtime check
    expect(() => new AssuranceBasis(true, null)).toThrow(TypeError);
    // @ts-expect-error deliberately passing an invalid value to prove the runtime check
    expect(() => new AssuranceBasis(true, "FULL_TYPO")).toThrow(TypeError);
  });
});

describe("GammaEstimate", () => {
  it("robustGamma applies the estimation-error discount", () => {
    const estimate = new GammaEstimate({ gammaHat: 2.0, deltaEstimationError: 1.0 });
    expect(estimate.robustGamma()).toBeCloseTo(1.0);
  });

  it("sufficient() gates on robustGamma, not raw gammaHat", () => {
    // gammaHat clears the 1.1 default threshold, but with delta=1.0 the
    // robust gamma (1.0) does not.
    const estimate = new GammaEstimate({ gammaHat: 2.0, deltaEstimationError: 1.0 });
    expect(estimate.sufficient()).toBe(false);
  });

  it("sufficient() uses strict > against the threshold", () => {
    const estimate = new GammaEstimate({ gammaHat: 1.1 });
    expect(estimate.sufficient(1.1)).toBe(false);
    expect(new GammaEstimate({ gammaHat: 1.1000001 }).sufficient(1.1)).toBe(true);
  });

  it("zero estimation error means robust equals raw gammaHat", () => {
    const estimate = new GammaEstimate({ gammaHat: 3.0 });
    expect(estimate.robustGamma()).toBeCloseTo(3.0);
  });
});

describe("Delta.fromGamma", () => {
  it("computes gamma * energyGap", () => {
    expect(Delta.fromGamma(2.0, 5.0).value).toBeCloseTo(10.0);
  });
});

describe("GES", () => {
  it("computes 1 - governed/ungoverned", () => {
    expect(GES.compute(2.0, 10.0).score).toBeCloseTo(0.8);
  });

  it("can be negative -- governance made things worse", () => {
    expect(GES.compute(15.0, 10.0).score).toBeLessThan(0);
  });

  it("rejects a zero ungoverned baseline", () => {
    expect(() => GES.compute(1.0, 0)).toThrow(/ungovernedKlIntegral must be nonzero/);
  });

  it("triggersSpecificationUpdate compares against theta", () => {
    const ges = GES.compute(9.0, 10.0); // score = 0.1
    expect(ges.triggersSpecificationUpdate(0.2)).toBe(true);
    expect(ges.triggersSpecificationUpdate(0.05)).toBe(false);
  });
});

describe("EEF.zone", () => {
  it("Zone 1 (insufficient) when robustGamma <= 1, regardless of EEF", () => {
    const gamma = new GammaEstimate({ gammaHat: 0.5 });
    const eef = new EEF(0.5);
    expect(eef.zone(gamma)).toBe(EEFZone.INSUFFICIENT);
  });

  it("Zone 2 (optimal) when Gamma > 1 and EEF <= 1", () => {
    const gamma = new GammaEstimate({ gammaHat: 2.0 });
    const eef = new EEF(1.0);
    expect(eef.zone(gamma)).toBe(EEFZone.OPTIMAL);
  });

  it("Zone 3 (over-governance) when Gamma > 1 and EEF > 1", () => {
    const gamma = new GammaEstimate({ gammaHat: 2.0 });
    const eef = new EEF(1.5);
    expect(eef.zone(gamma)).toBe(EEFZone.OVER_GOVERNANCE);
  });

  it("EEF.compute rejects a zero max sustainable cost", () => {
    expect(() => EEF.compute(1.0, 0)).toThrow(/maxSustainableCost must be nonzero/);
  });

  it("EEF.compute divides cost by max sustainable cost", () => {
    expect(EEF.compute(3.0, 6.0).value).toBeCloseTo(0.5);
  });
});

describe("Beta", () => {
  it("is a bare value holder -- no formula, just stores the value", () => {
    const beta = new Beta(2.5);
    expect(beta.value).toBe(2.5);
  });
});

describe("Threshold", () => {
  it("constructs with an optional unit, defaulting to empty string", () => {
    const t = new Threshold("custom", 0.5);
    expect(t.unit).toBe("");
    const withUnit = new Threshold("KL", 0.15, "nats");
    expect(withUnit.unit).toBe("nats");
  });

  it("GAMMA_MONITORING_THRESHOLD derives from ROBUST_GAMMA_DEFAULT_THRESHOLD", () => {
    expect(GAMMA_MONITORING_THRESHOLD.value).toBe(ROBUST_GAMMA_DEFAULT_THRESHOLD);
  });

  it("JACOBIAN_RED_FLAG_THRESHOLD is 0.05", () => {
    expect(JACOBIAN_RED_FLAG_THRESHOLD.value).toBe(0.05);
  });

  it("KL_MONITORING_THRESHOLD is 0.15 nats", () => {
    expect(KL_MONITORING_THRESHOLD.value).toBe(0.15);
    expect(KL_MONITORING_THRESHOLD.unit).toBe("nats");
  });
});
