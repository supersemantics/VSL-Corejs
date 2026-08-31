/**
 * Loader for the Drift Class (DC) / Stabilisation Operator (SO) / Legion
 * detection-heuristic catalog (Paper 5: "Toward a Basis Representation of
 * Drift Forensics").
 *
 * This module surfaces, deliberately and prominently, three real
 * data-quality findings in the source JSON rather than silently fixing
 * them -- see validate(). Do not trust the source data's own
 * metadata.total_drift_classes field; compute counts from the data
 * itself. Port of vsl_core/catalog/loader.py.
 *
 * The underlying data (originally vsl-core's own drift_classes.json /
 * legion_patterns.json, copied verbatim -- same license, same package,
 * same author) is imported here from generated TS modules
 * (drift_classes.data.ts / legion_patterns.data.ts -- see
 * scripts/generate-catalog-data.mjs), not read from disk at runtime. This
 * package ships both ESM and CommonJS builds; a runtime
 * fs.readFileSync(..., import.meta.url) approach works under ESM but
 * import.meta doesn't exist under CommonJS at all -- a compile error, not
 * just a runtime one. A plain `export const` TS module compiles
 * identically under both module targets with no bundler or
 * import.meta/__dirname branching required.
 */

import { driftClassesData } from "./drift_classes.data.js";
import { legionPatternsData } from "./legion_patterns.data.js";

export const CATEGORIES = ["external", "internal", "systemic", "linguistic", "authority"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface DriftClass {
  code: string;
  name: string;
  category: string;
  tier: string;
  operationalDefinition: string;
  primaryLegions: readonly string[];
  primarySo: string;
  contraindications: string | null;
  notes: string | null;
  references: string;
}

/**
 * Split a possibly-compound primarySo string (e.g. "SO-7, SO-8" or "SO-9
 * (external oversight)") into individual SO codes.
 */
export function primarySoCodes(driftClass: DriftClass): string[] {
  const codes: string[] = [];
  for (let part of driftClass.primarySo.split(",")) {
    part = part.trim();
    if (part.includes("(")) {
      part = part.split("(")[0]!.trim();
    }
    if (part) codes.push(part);
  }
  return codes;
}

export interface StabilisationOperator {
  code: string;
  name: string;
  proposedFunction: string;
  primaryDcTargets: readonly string[];
  contraindicatedOn: readonly string[];
}

export interface CompoundDriftMode {
  code: string;
  name: string;
  components: readonly string[];
  mechanism: string;
  confidence: string;
}

export interface BoundaryCase {
  key: string;
  classes: readonly string[];
  distinguishingTest: string;
  misdiagnosisRisk: string;
  whyItMatters: string;
}

export interface CriticalContraindication {
  key: string;
  prohibition: string;
  predictedFailureState: string;
  description: string;
  observableSignature: string;
}

export interface CaseStudy {
  key: string;
  primaryDc: string;
  secondaryDc: readonly string[];
  compoundMode: string;
  proposedSo: string;
  confidence: string;
  reference: string;
}

export interface LegionHeuristic {
  patternType: string;
  patterns: readonly string[];
  confidence: string;
  description: string;
}

export interface Legion {
  code: string;
  name: string;
  heuristics: readonly LegionHeuristic[];
}

export interface LegionEntry {
  code: string;
  name: string;
  tier: string;
  category: string;
  legions: readonly Legion[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawJson = any;

function rawDriftClasses(): RawJson {
  return driftClassesData;
}

function rawLegionPatterns(): RawJson {
  return legionPatternsData;
}

function driftClassFromDict(code: string, data: RawJson): DriftClass {
  return {
    code: data.code ?? code,
    name: data.name,
    category: data.category,
    tier: data.tier,
    operationalDefinition: data.operational_definition,
    primaryLegions: data.primary_legions ?? [],
    primarySo: data.primary_so,
    contraindications: data.contraindications ?? null,
    notes: data.notes ?? null,
    references: data.references ?? "",
  };
}

let cachedDriftClasses: Map<string, DriftClass> | null = null;

/**
 * Flatten all five categories into one Map keyed by DC code.
 *
 * Real count: 45 (external=15, internal=19, systemic=7, linguistic=3,
 * authority=1) -- NOT the 36 claimed by metadata.total_drift_classes.
 */
export function loadDriftClasses(): Map<string, DriftClass> {
  if (cachedDriftClasses !== null) return cachedDriftClasses;
  const raw = rawDriftClasses();
  const result = new Map<string, DriftClass>();
  for (const category of CATEGORIES) {
    const entries = raw.drift_classes[category] ?? {};
    for (const [code, entry] of Object.entries(entries)) {
      result.set(code, driftClassFromDict(code, entry));
    }
  }
  cachedDriftClasses = result;
  return result;
}

export function getDriftClass(code: string): DriftClass {
  const dc = loadDriftClasses().get(code);
  if (dc === undefined) {
    throw new Error(`No Drift Class with code "${code}".`);
  }
  return dc;
}

export function classesByTier(tier: string): DriftClass[] {
  return [...loadDriftClasses().values()].filter((dc) => dc.tier === tier);
}

let cachedStabilisationOperators: Map<string, StabilisationOperator> | null = null;

/** 10 entries: SO-1..SO-9 plus SO-8b (not a clean SO-1..SO-10 sequence -- see validate()). */
export function loadStabilisationOperators(): Map<string, StabilisationOperator> {
  if (cachedStabilisationOperators !== null) return cachedStabilisationOperators;
  const raw = rawDriftClasses();
  const result = new Map<string, StabilisationOperator>();
  for (const [code, data] of Object.entries<RawJson>(raw.stabilisation_operators)) {
    result.set(code, {
      code: data.code ?? code,
      name: data.name,
      proposedFunction: data.proposed_function,
      primaryDcTargets: data.primary_dc_targets ?? [],
      contraindicatedOn: data.contraindicated_on ?? [],
    });
  }
  cachedStabilisationOperators = result;
  return result;
}

export function getStabilisationOperator(code: string): StabilisationOperator {
  const so = loadStabilisationOperators().get(code);
  if (so === undefined) {
    throw new Error(`No Stabilisation Operator with code "${code}".`);
  }
  return so;
}

let cachedCompoundDriftModes: Map<string, CompoundDriftMode> | null = null;

export function loadCompoundDriftModes(): Map<string, CompoundDriftMode> {
  if (cachedCompoundDriftModes !== null) return cachedCompoundDriftModes;
  const raw = rawDriftClasses();
  const result = new Map<string, CompoundDriftMode>();
  for (const [code, data] of Object.entries<RawJson>(raw.compound_drift_modes ?? {})) {
    result.set(code, {
      code,
      name: data.name,
      components: data.components ?? [],
      mechanism: data.mechanism,
      confidence: data.confidence,
    });
  }
  cachedCompoundDriftModes = result;
  return result;
}

let cachedBoundaryCases: Map<string, BoundaryCase> | null = null;

export function loadBoundaryCases(): Map<string, BoundaryCase> {
  if (cachedBoundaryCases !== null) return cachedBoundaryCases;
  const raw = rawDriftClasses();
  const result = new Map<string, BoundaryCase>();
  for (const [key, data] of Object.entries<RawJson>(raw.boundary_cases ?? {})) {
    result.set(key, {
      key,
      classes: data.classes ?? [],
      distinguishingTest: data.distinguishing_test,
      misdiagnosisRisk: data.misdiagnosis_risk,
      whyItMatters: data.why_it_matters,
    });
  }
  cachedBoundaryCases = result;
  return result;
}

let cachedCriticalContraindications: Map<string, CriticalContraindication> | null = null;

export function loadCriticalContraindications(): Map<string, CriticalContraindication> {
  if (cachedCriticalContraindications !== null) return cachedCriticalContraindications;
  const raw = rawDriftClasses();
  const result = new Map<string, CriticalContraindication>();
  for (const [key, data] of Object.entries<RawJson>(raw.critical_contraindications ?? {})) {
    result.set(key, {
      key,
      prohibition: data.prohibition,
      predictedFailureState: data.predicted_failure_state,
      description: data.description,
      observableSignature: data.observable_signature,
    });
  }
  cachedCriticalContraindications = result;
  return result;
}

let cachedCaseStudies: Map<string, CaseStudy> | null = null;

export function loadCaseStudies(): Map<string, CaseStudy> {
  if (cachedCaseStudies !== null) return cachedCaseStudies;
  const raw = rawDriftClasses();
  const result = new Map<string, CaseStudy>();
  for (const [key, data] of Object.entries<RawJson>(raw.case_studies ?? {})) {
    result.set(key, {
      key,
      primaryDc: data.primary_dc,
      secondaryDc: data.secondary_dc ?? [],
      compoundMode: data.compound_mode,
      proposedSo: data.proposed_so,
      confidence: data.confidence,
      reference: data.reference,
    });
  }
  cachedCaseStudies = result;
  return result;
}

let cachedMonitoringFrequency: Map<string, readonly string[]> | null = null;

export function loadMonitoringFrequency(): Map<string, readonly string[]> {
  if (cachedMonitoringFrequency !== null) return cachedMonitoringFrequency;
  const raw = rawDriftClasses();
  const result = new Map<string, readonly string[]>();
  for (const [label, codes] of Object.entries<RawJson>(raw.monitoring_frequency_by_dc ?? {})) {
    result.set(label, [...codes]);
  }
  cachedMonitoringFrequency = result;
  return result;
}

export const TIER_DEFINITIONS: Readonly<Record<string, string>> = { ...rawDriftClasses().tier_definitions };

function legionFromDict(code: string, data: RawJson): Legion {
  const heuristics: LegionHeuristic[] = (data.heuristics ?? []).map((h: RawJson) => ({
    patternType: h.pattern_type,
    patterns: h.patterns ?? [],
    confidence: h.confidence,
    description: h.description,
  }));
  return { code, name: data.name, heuristics };
}

let cachedLegionPatterns: Map<string, LegionEntry> | null = null;

/**
 * 46 top-level entries: the 45 real DC codes plus one orphan,
 * CLUSTER-HANDOVER, which has no corresponding entry in
 * drift_classes.json -- see validate().
 */
export function loadLegionPatterns(): Map<string, LegionEntry> {
  if (cachedLegionPatterns !== null) return cachedLegionPatterns;
  const raw = rawLegionPatterns();
  const result = new Map<string, LegionEntry>();
  for (const [code, data] of Object.entries<RawJson>(raw)) {
    const legions = Object.entries<RawJson>(data.legions ?? {}).map(([legionCode, legionData]) =>
      legionFromDict(legionCode, legionData)
    );
    result.set(code, { code, name: data.name, tier: data.tier, category: data.category, legions });
  }
  cachedLegionPatterns = result;
  return result;
}

let cachedValidatedHeuristics: Map<string, [string, LegionHeuristic][]> | null = null;

/**
 * Filter to heuristics with confidence in (HIGH, MEDIUM) only -- what a
 * cautious integrator should reach for, since 106 of 113 heuristics in
 * the source data are self-labeled SPECULATIVE.
 *
 * Keyed by the top-level code (DC or CLUSTER-HANDOVER); each value is a
 * list of [legionCode, heuristic] pairs so callers can still tell which
 * Legion within that entry produced the finding.
 */
export function onlyValidatedHeuristics(): Map<string, [string, LegionHeuristic][]> {
  if (cachedValidatedHeuristics !== null) return cachedValidatedHeuristics;
  const result = new Map<string, [string, LegionHeuristic][]>();
  for (const [code, entry] of loadLegionPatterns()) {
    const matches: [string, LegionHeuristic][] = [];
    for (const legion of entry.legions) {
      for (const heuristic of legion.heuristics) {
        if (heuristic.confidence === "HIGH" || heuristic.confidence === "MEDIUM") {
          matches.push([legion.code, heuristic]);
        }
      }
    }
    if (matches.length > 0) result.set(code, matches);
  }
  cachedValidatedHeuristics = result;
  return result;
}

/**
 * Human-readable data-quality findings, computed at call time from the
 * real data -- never fixed, only surfaced. Returns an empty array only if
 * a future revision of the source JSON genuinely resolves every finding
 * below.
 */
export function validate(): string[] {
  const findings: string[] = [];

  const raw = rawDriftClasses();
  const driftClasses = loadDriftClasses();
  const realCount = driftClasses.size;
  const claimedCount = raw.metadata?.total_drift_classes;
  if (claimedCount !== realCount) {
    const byCategory = CATEGORIES.map(
      (category) => `${category}=${Object.keys(raw.drift_classes[category] ?? {}).length}`
    ).join(", ");
    findings.push(
      `metadata.total_drift_classes claims ${claimedCount} but the real computed count across all ` +
        `five categories (${byCategory}) is ${realCount}. Do not trust the metadata field.`
    );
  }

  const legionPatterns = loadLegionPatterns();
  const driftClassCodes = new Set(driftClasses.keys());
  const orphans = [...legionPatterns.keys()].filter((c) => !driftClassCodes.has(c)).sort();
  if (orphans.length > 0) {
    findings.push(
      `legion_patterns.json contains [${orphans.join(", ")}] with no corresponding entry in ` +
        `drift_classes.json. Treat as a real finding worth promoting to a formal DC in a future ` +
        `spec revision, not a data error to silently drop.`
    );
  }

  const emptyLegionCodes = [...legionPatterns.entries()]
    .filter(([, entry]) => entry.legions.length === 0)
    .map(([code]) => code)
    .sort();
  if (emptyLegionCodes.length > 0) {
    findings.push(
      `${emptyLegionCodes.length} drift classes have zero Legion detection heuristics defined at all: ` +
        `${emptyLegionCodes.join(", ")}. This is a coverage gap, not a data error -- these are ` +
        `predominantly tier B/C/D (theoretical/hypothesised/limit) classes where no detection heuristic ` +
        `has been proposed yet. onlyValidatedHeuristics() naturally excludes them too, since there is ` +
        `nothing to filter.`
    );
  }

  const mismatches: string[] = [];
  const sharedCodes = [...legionPatterns.keys()].filter((c) => driftClassCodes.has(c)).sort();
  for (const code of sharedCodes) {
    const dc = driftClasses.get(code)!;
    const entry = legionPatterns.get(code)!;
    if (dc.name !== entry.name || dc.tier !== entry.tier || dc.category !== entry.category) {
      mismatches.push(code);
    }
  }
  if (mismatches.length > 0) {
    findings.push(`name/tier/category mismatch between drift_classes.json and legion_patterns.json for: ${mismatches.join(", ")}.`);
  }

  const soCodes = [...loadStabilisationOperators().keys()].sort();
  if (soCodes.length > 0 && !soCodes.every((c) => c.startsWith("SO-"))) {
    findings.push(`Unexpected Stabilisation Operator code format among: [${soCodes.join(", ")}].`);
  } else if (soCodes.length !== 10 || !soCodes.includes("SO-8b")) {
    findings.push(
      `Expected 10 Stabilisation Operators (SO-1..SO-9 plus the lettered variant SO-8b, not a clean ` +
        `SO-1..SO-10 sequence); found ${soCodes.length}: [${soCodes.join(", ")}].`
    );
  }

  return findings;
}
