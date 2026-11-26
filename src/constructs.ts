/**
 * Layer 2 executable VSL constructs: AllowedState, InadmissibleState,
 * Fallback, Invariant, PreNode, TerminalState.
 *
 * This module must NEVER import any agent-framework package or model-
 * provider SDK. It is the most likely module to accidentally regain such a
 * coupling later if someone adds a "convenience" method that assumes a
 * particular framework's call shape -- don't. Any adapter-specific compile
 * step (turning a PreNode/Invariant into a framework's own guardrail type)
 * belongs in a separate `@supersemantics/vsl-<framework>` package, never
 * here. Port of vsl_core/constructs.py.
 */

import { AssuranceBasis, AssuranceLevel, F2Modification, GammaEstimate, ROBUST_GAMMA_DEFAULT_THRESHOLD } from "./metrics.js";

/**
 * The placeholder's own type, so it is recognised with instanceof. Not
 * exported: only this module creates one.
 */
class NotStatedBasis extends AssuranceBasis {}

// Placeholder held by a construct whose caller did not pass assuranceBasis
// (the normal case from 0.3.0). It exists only so adapters released before
// 0.3.0, which read `construct.assuranceBasis.f2Modification`, keep working
// against this release. It states nothing: assuranceLevel returns null for
// it. Removed in 1.0 along with the field.
const NOT_STATED: AssuranceBasis = new NotStatedBasis(true, F2Modification.NONE);

/** The deprecation message for passing `assuranceBasis`, identical in meaning to vsl-core's. */
export const ASSURANCE_BASIS_DEPRECATION =
  "assuranceBasis is no longer used; enforcement is computed from the ledger " +
  "(VerbaLedger.enforcement). Remove it; it will be rejected in 1.0.";

const ASSURANCE_LEVEL_DEPRECATION =
  "assuranceLevel is deprecated and will be removed in 1.0; this package no longer " +
  "reports an assurance level. Use VerbaLedger.enforcement(decisionId).";

const warned = new Set<string>();

// Once per process and code, like Node's own deprecations, so a loop
// building constructs prints one warning, not hundreds.
function deprecate(message: string, code: string): void {
  if (warned.has(code)) return;
  warned.add(code);
  if (typeof process !== "undefined" && typeof process.emitWarning === "function") {
    process.emitWarning(message, { type: "DeprecationWarning", code });
  }
}

function basisOrPlaceholder(basis: AssuranceBasis | undefined): AssuranceBasis {
  if (basis === undefined || basis instanceof NotStatedBasis) return NOT_STATED;
  deprecate(ASSURANCE_BASIS_DEPRECATION, "VSL_ASSURANCE_BASIS");
  return basis;
}

function deprecatedLevel(basis: AssuranceBasis): AssuranceLevel | null {
  deprecate(ASSURANCE_LEVEL_DEPRECATION, "VSL_ASSURANCE_LEVEL");
  return basis instanceof NotStatedBasis ? null : basis.derivedLevel;
}

/**
 * Framework-agnostic monitor signature. An adapter's compile step is
 * responsible for constructing whatever `candidateInput` means in its own
 * framework's terms before calling this.
 */
export type DriftMonitor = (candidateInput: unknown) => Promise<GammaEstimate>;

/** Framework-agnostic formation-layer intervention signature. */
export type FormationLayerIntervention = (deltaFactor: number) => Promise<boolean>;

export interface AllowedStateInit {
  name: string;
  description: string;
  /** @deprecated Ignored; passing it emits a DeprecationWarning. Removed in 1.0. */
  assuranceBasis?: AssuranceBasis;
  measurement: string;
  validityConditions?: readonly string[];
}

/**
 * A state meeting all required prerequisites, Constraints, rules, and
 * validity conditions.
 *
 * `assuranceBasis` is deprecated and ignored (see Invariant).
 */
export class AllowedState {
  readonly name: string;
  readonly description: string;
  readonly assuranceBasis: AssuranceBasis;
  readonly measurement: string;
  readonly validityConditions: readonly string[];

  constructor(init: AllowedStateInit) {
    this.name = init.name;
    this.description = init.description;
    this.assuranceBasis = basisOrPlaceholder(init.assuranceBasis);
    this.measurement = init.measurement;
    this.validityConditions = init.validityConditions ?? [];
  }

  /** @deprecated The level of a passed assuranceBasis, else null. Removed in 1.0. */
  get assuranceLevel(): AssuranceLevel | null {
    return deprecatedLevel(this.assuranceBasis);
  }
}

export interface InadmissibleStateInit {
  name: string;
  description: string;
  signature: string;
  energyGapProxy?: string | null;
}

/** A state that must not occur -- corresponds to a Drift Node. */
export class InadmissibleState {
  readonly name: string;
  readonly description: string;
  readonly signature: string;
  readonly energyGapProxy: string | null;

  constructor(init: InadmissibleStateInit) {
    this.name = init.name;
    this.description = init.description;
    this.signature = init.signature;
    this.energyGapProxy = init.energyGapProxy ?? null;
  }
}

export interface FallbackInit {
  onFailure?: string;
  deltaFactor?: number;
  maxRetries?: number;
  onMaxRetries?: string;
}

/** A deterministic recovery/termination action when a State is invalid or a Pre-Node cannot be satisfied. */
export class Fallback {
  readonly onFailure: string;
  readonly deltaFactor: number;
  readonly maxRetries: number;
  readonly onMaxRetries: string;

  constructor(init: FallbackInit = {}) {
    this.onFailure = init.onFailure ?? "INCREASE_DELTA";
    this.deltaFactor = init.deltaFactor ?? 1.5;
    this.maxRetries = init.maxRetries ?? 3;
    this.onMaxRetries = init.onMaxRetries ?? "AUTOMATION_DENIED";
  }

  /** Structural equality -- two Fallbacks with the same field values are equivalent, mirroring Python's dataclass `__eq__`. */
  equals(other: Fallback): boolean {
    return (
      this.onFailure === other.onFailure &&
      this.deltaFactor === other.deltaFactor &&
      this.maxRetries === other.maxRetries &&
      this.onMaxRetries === other.onMaxRetries
    );
  }
}

const DEFAULT_FALLBACK = new Fallback();

export interface InvariantInit {
  name: string;
  description: string;
  rule: (candidateInput: unknown) => Promise<boolean>;
  /** @deprecated Ignored; passing it emits a DeprecationWarning. Removed in 1.0. */
  assuranceBasis?: AssuranceBasis;
  scope?: string;
  cannotBeBypassed?: boolean;
  onViolation?: TerminalState | null;
}

/**
 * A persistent Constraint that cannot be bypassed. Violation triggers
 * IMMEDIATE_TERMINAL_STATE per the spec, not an ordinary Fallback.
 *
 * `assuranceBasis` is deprecated and ignored: whether a gate held before its
 * action is computed from the ledger (VerbaLedger.enforcement), never
 * declared. Passing one emits a DeprecationWarning; it is removed in 1.0.
 *
 * onViolation names which TerminalState that immediate transition is
 * into. It's optional (an Invariant can exist before its Terminal State
 * is decided), but when set, an adapter catching InvariantViolation for
 * this Invariant should treat entry into onViolation as automatic --
 * that's what "violation triggers immediate Terminal State" means.
 */
export class Invariant {
  readonly name: string;
  readonly description: string;
  readonly rule: (candidateInput: unknown) => Promise<boolean>;
  readonly assuranceBasis: AssuranceBasis;
  readonly scope: string;
  readonly cannotBeBypassed: boolean;
  readonly onViolation: TerminalState | null;

  constructor(init: InvariantInit) {
    this.name = init.name;
    this.description = init.description;
    this.rule = init.rule;
    this.assuranceBasis = basisOrPlaceholder(init.assuranceBasis);
    this.scope = init.scope ?? "ALL_STATES";
    this.cannotBeBypassed = init.cannotBeBypassed ?? true;
    this.onViolation = init.onViolation ?? null;
  }

  /** @deprecated The level of a passed assuranceBasis, else null. Removed in 1.0. */
  get assuranceLevel(): AssuranceLevel | null {
    return deprecatedLevel(this.assuranceBasis);
  }
}

export interface TerminalStateInit {
  name: string;
  description: string;
  entryConditions?: readonly string[];
  requiresHumanAuthorisedTransition?: boolean;
}

/** A state from which no further automated transitions are permitted. */
export class TerminalState {
  readonly name: string;
  readonly description: string;
  readonly entryConditions: readonly string[];
  readonly requiresHumanAuthorisedTransition: boolean;

  constructor(init: TerminalStateInit) {
    this.name = init.name;
    this.description = init.description;
    this.entryConditions = init.entryConditions ?? [];
    this.requiresHumanAuthorisedTransition = init.requiresHumanAuthorisedTransition ?? true;
  }
}

export interface PreNodeInit {
  name: string;
  description: string;
  monitor: DriftMonitor;
  /** @deprecated Ignored; passing it emits a DeprecationWarning. Removed in 1.0. */
  assuranceBasis?: AssuranceBasis;
  gammaThreshold?: number;
  intervention?: FormationLayerIntervention | null;
  fallback?: Fallback;
}

/**
 * A mandatory prerequisite that must be satisfied before transitioning
 * into a target State -- the central VERBA construct. Every Pre-Node is an
 * Eligibility Condition: a State transition without a satisfied Pre-Node
 * is, by definition, Drift.
 */
export class PreNode {
  readonly name: string;
  readonly description: string;
  readonly monitor: DriftMonitor;
  readonly assuranceBasis: AssuranceBasis;
  readonly gammaThreshold: number;
  readonly intervention: FormationLayerIntervention | null;
  readonly fallback: Fallback;

  constructor(init: PreNodeInit) {
    this.name = init.name;
    this.description = init.description;
    this.monitor = init.monitor;
    this.assuranceBasis = basisOrPlaceholder(init.assuranceBasis);
    this.gammaThreshold = init.gammaThreshold ?? ROBUST_GAMMA_DEFAULT_THRESHOLD;
    this.intervention = init.intervention ?? null;
    this.fallback = init.fallback ?? DEFAULT_FALLBACK;

    if (this.fallback.maxRetries < 0) {
      throw new Error("Fallback.maxRetries must be >= 0.");
    }
    if (this.fallback.deltaFactor <= 0) {
      throw new Error("Fallback.deltaFactor must be > 0.");
    }
  }

  /** @deprecated The level of a passed assuranceBasis, else null. Removed in 1.0. */
  get assuranceLevel(): AssuranceLevel | null {
    return deprecatedLevel(this.assuranceBasis);
  }
}

const invariantRegistry: Invariant[] = [];

/**
 * Register an Invariant in the module-level registry.
 *
 * Throws on a duplicate name rather than silently overwriting -- silently
 * replacing a governance Invariant is exactly the kind of silent failure
 * Design Principle P3 ("explicit failure conditions") forbids.
 */
export function registerInvariant(invariant: Invariant): void {
  if (invariantRegistry.some((existing) => existing.name === invariant.name)) {
    throw new Error(`An Invariant named ${JSON.stringify(invariant.name)} is already registered.`);
  }
  invariantRegistry.push(invariant);
}

export function registeredInvariants(): readonly Invariant[] {
  return [...invariantRegistry];
}
