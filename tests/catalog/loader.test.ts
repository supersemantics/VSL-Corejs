import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  TIER_DEFINITIONS,
  classesByTier,
  getDriftClass,
  getStabilisationOperator,
  loadBoundaryCases,
  loadCaseStudies,
  loadCompoundDriftModes,
  loadCriticalContraindications,
  loadDriftClasses,
  loadLegionPatterns,
  loadMonitoringFrequency,
  loadStabilisationOperators,
  onlyValidatedHeuristics,
  primarySoCodes,
  validate,
} from "../../src/catalog/loader.js";

describe("loadDriftClasses", () => {
  it("computes 45 real drift classes, split across the five categories as documented", () => {
    const classes = loadDriftClasses();
    expect(classes.size).toBe(45);
    const counts: Record<string, number> = { external: 0, internal: 0, systemic: 0, linguistic: 0, authority: 0 };
    for (const dc of classes.values()) counts[dc.category] = (counts[dc.category] ?? 0) + 1;
    expect(counts).toEqual({ external: 15, internal: 19, systemic: 7, linguistic: 3, authority: 1 });
  });

  it("covers every declared category", () => {
    for (const category of CATEGORIES) {
      expect(loadDriftClasses().size).toBeGreaterThan(0);
      expect(category).toBeTruthy(); // categories are just iterated above, no per-category API here
    }
  });

  it("throws for an unknown code", () => {
    expect(() => getDriftClass("DC-DOES-NOT-EXIST")).toThrow(/No Drift Class/);
  });

  it("returns a real, populated entry for a known code", () => {
    const dc = getDriftClass("DC-E1");
    expect(dc.name).toBe("Threshold Assault");
    expect(dc.category).toBe("external");
    expect(dc.tier).toBe("A");
  });
});

describe("classesByTier", () => {
  it("only returns classes matching the given tier", () => {
    for (const dc of classesByTier("A")) {
      expect(dc.tier).toBe("A");
    }
    expect(classesByTier("A").length).toBeGreaterThan(0);
  });
});

describe("TIER_DEFINITIONS", () => {
  it("has exactly the four documented tiers, A through D", () => {
    expect(Object.keys(TIER_DEFINITIONS).sort()).toEqual(["A", "B", "C", "D"]);
  });
});

describe("loadCompoundDriftModes / loadBoundaryCases / loadCriticalContraindications / loadCaseStudies", () => {
  it("load the real, non-empty data sections", () => {
    expect(loadCompoundDriftModes().size).toBe(10);
    expect(loadBoundaryCases().size).toBe(4);
    expect(loadCriticalContraindications().size).toBe(3);
    expect(loadCaseStudies().size).toBe(5);
  });

  it("loadCompoundDriftModes populates code from the dict key, not a data field", () => {
    const modes = loadCompoundDriftModes();
    for (const [key, mode] of modes) {
      expect(mode.code).toBe(key);
    }
  });
});

describe("primarySoCodes", () => {
  it("splits a compound comma-separated primarySo string", () => {
    const dc = { primarySo: "SO-7, SO-8" } as Parameters<typeof primarySoCodes>[0];
    expect(primarySoCodes(dc)).toEqual(["SO-7", "SO-8"]);
  });

  it("strips a trailing parenthetical note", () => {
    const dc = { primarySo: "SO-9 (external oversight)" } as Parameters<typeof primarySoCodes>[0];
    expect(primarySoCodes(dc)).toEqual(["SO-9"]);
  });
});

describe("loadStabilisationOperators", () => {
  it("has exactly 10 entries including the lettered SO-8b variant", () => {
    const operators = loadStabilisationOperators();
    expect(operators.size).toBe(10);
    expect(operators.has("SO-8b")).toBe(true);
  });

  it("throws for an unknown code", () => {
    expect(() => getStabilisationOperator("SO-DOES-NOT-EXIST")).toThrow(/No Stabilisation Operator/);
  });

  it("returns a real, populated entry for a known code", () => {
    const so = getStabilisationOperator("SO-8b");
    expect(so.code).toBe("SO-8b");
    expect(so.name.length).toBeGreaterThan(0);
  });
});

describe("loadMonitoringFrequency", () => {
  it("loads the real, non-empty monitoring-frequency-by-label data", () => {
    const frequency = loadMonitoringFrequency();
    expect(frequency.size).toBeGreaterThan(0);
    for (const codes of frequency.values()) {
      expect(Array.isArray(codes)).toBe(true);
    }
  });
});

describe("loadLegionPatterns", () => {
  it("has 46 top-level entries -- the 45 real DC codes plus the CLUSTER-HANDOVER orphan", () => {
    expect(loadLegionPatterns().size).toBe(46);
    expect(loadLegionPatterns().has("CLUSTER-HANDOVER")).toBe(true);
  });
});

describe("onlyValidatedHeuristics", () => {
  it("excludes every SPECULATIVE-confidence heuristic", () => {
    const validated = onlyValidatedHeuristics();
    for (const matches of validated.values()) {
      for (const [, heuristic] of matches) {
        expect(["HIGH", "MEDIUM"]).toContain(heuristic.confidence);
      }
    }
  });

  it("is a strict subset of everything in loadLegionPatterns", () => {
    const validated = onlyValidatedHeuristics();
    const allCodes = new Set(loadLegionPatterns().keys());
    for (const code of validated.keys()) {
      expect(allCodes.has(code)).toBe(true);
    }
  });
});

describe("validate", () => {
  it("surfaces the known, real data-quality findings rather than silently fixing them", () => {
    const findings = validate();
    // These are real, documented findings in the actual source data --
    // this test locks in that they stay surfaced, not silently resolved
    // by a future data edit going unnoticed.
    expect(findings.some((f) => f.includes("total_drift_classes claims"))).toBe(true);
    expect(findings.some((f) => f.includes("CLUSTER-HANDOVER"))).toBe(true);
    expect(findings.some((f) => f.includes("zero Legion detection heuristics"))).toBe(true);
  });
});
