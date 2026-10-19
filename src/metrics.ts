/**
 * Layer 3 quantitative backbone: Delta, Gamma, GES, EEF.
 *
 * Pure computation over numbers/objects. No I/O, no framework or model SDK
 * dependency of any kind. Port of vsl_core/metrics.py.
 */

/**
 * VERBA's default Robust Gamma Threshold: gammaThreshold = 1.1,
 * corresponding to a 10% relative estimation-error tolerance (delta = 0.1).
 * This is the maximum estimation error the framework can absorb while
 * still guaranteeing gamma* > 1, not an arbitrarily rounded-up safety
 * margin.
 *
 * A threshold is therefore 1 + (the estimation-error allowance it already
 * includes). GammaEstimate.sufficient() treats it as the minimum allowance:
 * a monitor's own deltaEstimationError only raises the bar when it exceeds
 * that allowance (see sufficient()).
 */
export const ROBUST_GAMMA_DEFAULT_THRESHOLD = 1.1;

/** The source spec's stated recommendation for high-stakes deployments (delta = 0.2). */
export const ROBUST_GAMMA_HIGH_STAKES_THRESHOLD = 1.2;

/**
 * HIGH / MEDIUM / LOW confidence rating per the F1/F2 test.
 *
 * A mechanism satisfying F1 (pre-commitment) but only partial F2 (energy-
 * landscape modification) -- e.g. a gate in front of a hosted model API
 * call whose prompt the application writes -- caps at MEDIUM, never HIGH.
 * This distinction must never be blurred by any code or docs built on top
 * of this package.
 *
 * The level measures one thing: how deeply governance shapes what the
 * model produces. Whether a gate blocks the action before it happens is
 * F1, and is best reported on its own rather than read off the level -- a
 * gate with F1=true and F2=NONE is LOW here, yet it still stops every
 * action it denies.
 *
 * Prefer constructing this via AssuranceBasis.derivedLevel rather than
 * setting it directly.
 */
export enum AssuranceLevel {
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
}

/**
 * How fully an intervention modifies the energy function
 * E_gov(x) = E_0(x) + U(x), per the source spec's F2 test.
 *
 * F2 is judged at the call the gate guards: what does the application do
 * to the model there? It is never earned by the gate itself -- allowing or
 * blocking an action changes nothing about what a model produces.
 *
 * FULL: directly modifies the energy function (logit adjustment,
 * activation steering, fine-tuning, constitutional training). Needs a
 * model whose internals the application controls; a hosted model API
 * rules it out.
 * PARTIAL: shapes output through attention/context rather than direct
 * energy modification -- the application changes what the model sees (its
 * own system prompt, RAG context injection, redacting the input).
 * INDIRECT: affects sampling without touching the energy function itself
 * (temperature adjustment).
 * NONE: the gate only allows or blocks, and the application shapes nothing
 * at the guarded call -- or no model is involved at all (an amount cap
 * before issueRefund, an allow-list before sendEmail).
 *
 * When unsure, pick the lowest value the code honestly supports.
 */
export enum F2Modification {
  FULL = "FULL",
  PARTIAL = "PARTIAL",
  INDIRECT = "INDIRECT",
  NONE = "NONE",
}

/**
 * The F1/F2 facts an AssuranceLevel must be derived from, rather than
 * asserted directly.
 *
 * Before this type existed, a caller could freely set an assurance level
 * on a mechanism that was actually output-layer. AssuranceBasis makes the
 * two load-bearing facts (F1: does this run before commitment? F2: how
 * fully does it modify the energy function?) the only inputs, and derives
 * the level from them.
 *
 * derivedLevel implements the source table exhaustively:
 *   f1PreCommitment=false                          -> LOW,  for any F2 value
 *   f1PreCommitment=true,  f2Modification=FULL      -> HIGH
 *   f1PreCommitment=true,  f2Modification in {PARTIAL, INDIRECT} -> MEDIUM
 *   f1PreCommitment=true,  f2Modification=NONE      -> LOW
 *
 * That last row (f1=true, f2=NONE) is not in the source paper's table --
 * the paper never covers a mechanism that runs before commitment but
 * claims zero energy-landscape effect. This is a deliberate interpretive
 * extension, not a spec fact: a check that runs early but does nothing to
 * the distribution isn't governance in the Gamma-sufficiency sense, so it
 * is treated the same as output-layer (LOW) rather than left undefined.
 * LOW here describes influence on the model, not enforcement: such a gate
 * still blocks every action it denies (that is its F1).
 *
 * The constructor requires f1PreCommitment to actually be a boolean and
 * f2Modification to actually be an F2Modification member. Before these
 * checks existed, a caller could pass null/undefined and derivedLevel
 * would silently fall through every branch to LOW -- an accidental,
 * unflagged LOW indistinguishable from a deliberate one. This does not
 * make derivedLevel *correct* (nothing here can verify a stated F1/F2 fact
 * reflects what the gated mechanism actually does), it only guarantees
 * both values were a real, deliberate choice rather than an unnoticed
 * accident.
 */
export class AssuranceBasis {
  readonly f1PreCommitment: boolean;
  readonly f2Modification: F2Modification;

  constructor(f1PreCommitment: boolean, f2Modification: F2Modification) {
    if (typeof f1PreCommitment !== "boolean") {
      throw new TypeError(
        `AssuranceBasis.f1PreCommitment must be a boolean, got ${JSON.stringify(
          f1PreCommitment
        )}. There is no safe default -- omitting or guessing this value is exactly the mistake this check exists to catch.`
      );
    }
    if (!Object.values(F2Modification).includes(f2Modification)) {
      throw new TypeError(
        `AssuranceBasis.f2Modification must be an F2Modification member (FULL/PARTIAL/INDIRECT/NONE), got ${JSON.stringify(
          f2Modification
        )}. There is no safe default -- omitting or guessing this value is exactly the mistake this check exists to catch.`
      );
    }
    this.f1PreCommitment = f1PreCommitment;
    this.f2Modification = f2Modification;
  }

  get derivedLevel(): AssuranceLevel {
    if (!this.f1PreCommitment) {
      return AssuranceLevel.LOW;
    }
    if (this.f2Modification === F2Modification.FULL) {
      return AssuranceLevel.HIGH;
    }
    if (
      this.f2Modification === F2Modification.PARTIAL ||
      this.f2Modification === F2Modification.INDIRECT
    ) {
      return AssuranceLevel.MEDIUM;
    }
    return AssuranceLevel.LOW;
  }
}

export interface GammaEstimateInit {
  gammaHat: number;
  deltaEstimationError?: number;
  energyGapEstimate?: number | null;
  measuredAt?: number;
}

/**
 * A point estimate of Gamma (Governance-to-Drift Ratio) plus its
 * estimation-error bound, so sufficiency can be judged against the Robust
 * Gamma Threshold rather than the raw estimate.
 *
 * Three facts a caller needs at the point of use, not just discoverable by
 * reading sufficient()'s body or the module-level threshold constant:
 *
 * 1. sufficient() requires gammaHat to be strictly greater than
 *    requiredGammaHat(threshold) = max(threshold, 1 + delta). That is the
 *    source spec's robust condition (gamma* = gammaHat / (1 + delta) > 1),
 *    with the threshold as the minimum estimation-error allowance. Exactly
 *    on the bar does not pass.
 * 2. The default threshold (ROBUST_GAMMA_DEFAULT_THRESHOLD = 1.1) already
 *    encodes a 10% estimation-error tolerance (delta = 0.1). A
 *    deltaEstimationError at or below that allowance does not raise the bar
 *    again; only a larger one does (delta = 0.2 against 1.1 requires
 *    gammaHat > 1.2). Before rules version 2026.10, sufficient() divided
 *    gammaHat by (1 + delta) and then compared it with the threshold,
 *    counting the allowance twice (delta = 0.1 required gammaHat > 1.21).
 * 3. deltaEstimationError is not a measured property of the monitor -- it
 *    is how the monitor's author declares reduced confidence in their own
 *    gammaHat estimate. Leaving it at the 0.0 default is itself a claim
 *    ("this gammaHat is exact"), not a neutral/safe absence of
 *    information; set it deliberately when the estimation method is
 *    noisier than that.
 *
 * What gammaHat is today: this package never measures Gamma; the monitor
 * computes gammaHat and the gate only compares it. For most actions the
 * spec's Gamma cannot be measured directly, so a monitor returns a gate
 * score in Gamma units. Make it honest: build it as a ratio where 1.0 means
 * break-even (a policy limit divided by the requested amount, a judge score
 * divided by its break-even score), return 0.0 when input is missing or
 * unreadable, never pass a raw 0-1 confidence (it can never exceed 1.1), and
 * call a fixed 2.0-or-0.0 value what it is: a pass/fail encoding, not a
 * measurement. For a rule that must never be broken, use an Invariant rather
 * than a large threshold. Record each decision with
 * VerbaLedger.writeGateDecision() if Gamma is to be tracked over time.
 */
export class GammaEstimate {
  readonly gammaHat: number;
  readonly deltaEstimationError: number;
  readonly energyGapEstimate: number | null;
  readonly measuredAt: number;

  constructor(init: GammaEstimateInit) {
    this.gammaHat = init.gammaHat;
    this.deltaEstimationError = init.deltaEstimationError ?? 0.0;
    this.energyGapEstimate = init.energyGapEstimate ?? null;
    this.measuredAt = init.measuredAt ?? Date.now() / 1000;
  }

  /** gamma* = gammaHat * (1 / (1 + delta)), the worst-case Gamma after accounting for estimation error. */
  robustGamma(): number {
    return this.gammaHat * (1.0 / (1.0 + this.deltaEstimationError));
  }

  /**
   * The value gammaHat must strictly exceed to pass:
   * max(threshold, 1 + delta). The threshold is 1 plus the estimation-error
   * allowance it already includes, so this is the larger of that allowance
   * and the monitor's own declared deltaEstimationError.
   */
  requiredGammaHat(threshold: number = ROBUST_GAMMA_DEFAULT_THRESHOLD): number {
    return Math.max(threshold, 1.0 + this.deltaEstimationError);
  }

  /**
   * True iff gammaHat is strictly greater than requiredGammaHat(threshold).
   * Whenever this is true, robustGamma() > 1 also holds: governance beats
   * drift even in the worst case the declared delta allows.
   *
   * This exact name and signature is load-bearing: it is called directly
   * by PlainJsReferenceAdapter.compilePreNode and by any other adapter's
   * compiled gate.
   */
  sufficient(threshold: number = ROBUST_GAMMA_DEFAULT_THRESHOLD): boolean {
    return this.gammaHat > this.requiredGammaHat(threshold);
  }
}

/** Governance potential: the energy contribution of the governance mechanism to the governed landscape. */
export class Delta {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  /** delta = gamma * (E_high - E_drift). */
  static fromGamma(gamma: number, energyGap: number): Delta {
    return new Delta(gamma * energyGap);
  }
}

/**
 * Governance Effectiveness Score: a runtime-measurable proxy for whether
 * governance is actually working.
 *
 * GES = 0: no effect. GES = 1: divergence eliminated. GES < 0: governance
 * made things worse.
 */
export class GES {
  readonly score: number;

  constructor(score: number) {
    this.score = score;
  }

  /** GES = 1 - (integral of governed KL divergence / integral of ungoverned KL divergence). */
  static compute(governedKlIntegral: number, ungovernedKlIntegral: number): GES {
    if (ungovernedKlIntegral === 0) {
      throw new Error(
        "ungovernedKlIntegral must be nonzero -- a zero-divergence ungoverned baseline makes GES undefined, not zero."
      );
    }
    return new GES(1.0 - governedKlIntegral / ungovernedKlIntegral);
  }

  /** True iff GES < theta, the spec's trigger for a Specification Update. */
  triggersSpecificationUpdate(theta: number): boolean {
    return this.score < theta;
  }
}

/**
 * The three zones of Enforcement Effectiveness Factor.
 *
 * Zone 1 (Gamma < 1): insufficient governance.
 * Zone 2 (Gamma > 1, EEF <= 1): optimal -- VERBA's target state at all times.
 * Zone 3 (EEF > 1): over-governance; new Drift Nodes form in unspecified gaps.
 */
export enum EEFZone {
  INSUFFICIENT = "INSUFFICIENT",
  OPTIMAL = "OPTIMAL",
  OVER_GOVERNANCE = "OVER_GOVERNANCE",
}

/** Enforcement Effectiveness Factor: ratio of governance cost to maximum sustainable governance cost. */
export class EEF {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  /** EEF = C(U_PN) / C_max. */
  static compute(costOfPreNode: number, maxSustainableCost: number): EEF {
    if (maxSustainableCost === 0) {
      throw new Error("maxSustainableCost must be nonzero.");
    }
    return new EEF(costOfPreNode / maxSustainableCost);
  }

  /**
   * Classify into the spec's three zones: Zone 1 (Gamma<=1) is insufficient
   * regardless of EEF; Zone 2 (Gamma>1, EEF<=1) is optimal; Zone 3 (EEF>1)
   * is over-governance.
   */
  zone(gammaEstimate: GammaEstimate): EEFZone {
    if (gammaEstimate.robustGamma() <= 1.0) {
      return EEFZone.INSUFFICIENT;
    }
    if (this.value <= 1.0) {
      return EEFZone.OPTIMAL;
    }
    return EEFZone.OVER_GOVERNANCE;
  }
}

/**
 * Inverse temperature: inverse of effective system "temperature." Higher
 * Beta means lower volatility -- probability concentrates more strongly on
 * energy minima. Systems tuned at a normal Beta may fail at crisis (lower)
 * Beta, requiring higher Delta to hold Gamma > 1.
 *
 * The source spec describes this relationship only qualitatively -- it
 * gives no closed-form formula relating Beta to Delta or Gamma the way it
 * does for Gamma/GES/EEF. This type deliberately holds nothing but the raw
 * value: it exists so Beta can be named and logged (e.g. "measured at
 * crisis Beta=X"), not to compute anything from it. Do not add a formula
 * here that the source paper doesn't actually provide.
 */
export class Beta {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }
}

/** A named quantitative limit. Exceeding (or falling below, depending on the quantity) it invalidates a transition. */
export class Threshold {
  readonly name: string;
  readonly value: number;
  readonly unit: string;

  constructor(name: string, value: number, unit = "") {
    this.name = name;
    this.value = value;
    this.unit = unit;
  }
}

// The three concrete default thresholds the source spec names. Only Gamma's
// was previously represented anywhere in this module (as
// ROBUST_GAMMA_DEFAULT_THRESHOLD); Jacobian and KL are reference constants
// only -- computing lambda_min(J_gov) or a KL divergence is inherently
// model-specific and stays out of core, the same way Gamma estimation
// itself does. These exist so a DriftMonitor implementer has the spec's own
// defaults available instead of re-deriving or mistyping them.
export const GAMMA_MONITORING_THRESHOLD = new Threshold(
  "Gamma monitoring threshold",
  ROBUST_GAMMA_DEFAULT_THRESHOLD
);
export const JACOBIAN_RED_FLAG_THRESHOLD = new Threshold("Jacobian red flag (lambda_min)", 0.05);
export const KL_MONITORING_THRESHOLD = new Threshold("KL monitoring threshold", 0.15, "nats");
