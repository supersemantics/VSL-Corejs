/**
 * Layer 4 identity/audit-scoping vocabulary: Identity Key, Cluster Key,
 * Instance, Re-Enablement.
 *
 * Uses Node's built-in `node:crypto` (createHash, randomUUID) -- available
 * in Node >=18 and requiring no external dependency, keeping this package's
 * zero-runtime-dependency guarantee. Synchronous, matching Python's
 * synchronous hashlib usage (Web Crypto's subtle.digest is async-only,
 * which would force ClusterKey.fromConstituents to become async for no
 * real benefit here). Port of vsl_core/identity.py.
 */

import { createHash, randomUUID } from "node:crypto";

/**
 * A stable identifier scoping counters, limits, and process Instances.
 *
 * Immutable and equality-comparable by value (see `equals`) so it can key
 * Maps/Sets by its `.value`, or be compared directly -- JS objects don't
 * get value equality for free the way a Python frozen dataclass's `__eq__`
 * does, so callers needing set-membership semantics should key on
 * `.value`, not the IdentityKey instance itself.
 */
export class IdentityKey {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  static generate(prefix = "vsl"): IdentityKey {
    return new IdentityKey(`${prefix}-${randomUUID()}`);
  }

  toString(): string {
    return this.value;
  }

  equals(other: IdentityKey): boolean {
    return this.value === other.value;
  }
}

/**
 * The composite Identity Key shared across all constituent systems of a
 * Cluster.
 *
 * Deliberately NOT a subclass of IdentityKey. A Cluster's governance
 * sufficiency is not the same question as any one constituent's -- the
 * Flash Crash case study is precisely the failure mode where individual
 * Gamma > 1 was insufficient at the Cluster level. Making ClusterKey a
 * distinct type (rather than an IdentityKey subtype) means a ClusterKey
 * can never be silently accepted somewhere only a single-system
 * IdentityKey should be valid -- TypeScript's structural typing means this
 * separation is enforced by the two classes having different shapes
 * (`constituentKeys` has no IdentityKey counterpart), not by nominal
 * inheritance, but the effect is the same: no accidental substitution.
 */
export class ClusterKey {
  readonly value: string;
  readonly constituentKeys: readonly IdentityKey[];

  constructor(value: string, constituentKeys: readonly IdentityKey[]) {
    this.value = value;
    this.constituentKeys = constituentKeys;
  }

  /**
   * Derive a stable composite value from a deterministic hash of the
   * sorted constituent key values, so the same set of constituents always
   * produces the same ClusterKey.value regardless of the order they were
   * supplied in.
   */
  static fromConstituents(constituentKeys: readonly IdentityKey[]): ClusterKey {
    const sortedValues = constituentKeys.map((k) => k.value).sort();
    const digest = createHash("sha256").update(sortedValues.join("|"), "utf-8").digest("hex");
    return new ClusterKey(`cluster-${digest.slice(0, 16)}`, [...constituentKeys]);
  }
}

/**
 * The evidence a Re-Enablement request must carry: a root-cause analysis
 * and a specification-update proposal, per the spec's Re-Enablement
 * requirements.
 *
 * A structured type rather than two loose strings so validation (both
 * fields non-empty) lives in exactly one place and callers can't construct
 * "evidence" that's silently missing a field.
 */
export class Evidence {
  readonly rootCauseAnalysis: string;
  readonly specificationUpdateProposal: string;

  constructor(rootCauseAnalysis: string, specificationUpdateProposal: string) {
    if (!rootCauseAnalysis.trim()) {
      throw new Error("rootCauseAnalysis must be a non-empty evidence string.");
    }
    if (!specificationUpdateProposal.trim()) {
      throw new Error("specificationUpdateProposal must be a non-empty evidence string.");
    }
    this.rootCauseAnalysis = rootCauseAnalysis;
    this.specificationUpdateProposal = specificationUpdateProposal;
  }
}

export interface InstanceInit {
  instanceId: string;
  identityKey: IdentityKey;
  createdAt?: number;
  predecessorInstanceId?: string | null;
  generation?: number;
}

/**
 * A single execution of a process with its own identifier, counters,
 * limits, and history -- scoped by Identity Key.
 *
 * Instances are immutable; Re-Enablement never mutates an existing
 * Instance, it produces a new one (see `_reEnable`).
 */
export class Instance {
  readonly instanceId: string;
  readonly identityKey: IdentityKey;
  readonly createdAt: number;
  readonly predecessorInstanceId: string | null;
  readonly generation: number;

  constructor(init: InstanceInit) {
    this.instanceId = init.instanceId;
    this.identityKey = init.identityKey;
    this.createdAt = init.createdAt ?? Date.now() / 1000;
    this.predecessorInstanceId = init.predecessorInstanceId ?? null;
    this.generation = init.generation ?? 0;
  }

  /**
   * Mint a fresh Instance. If no IdentityKey is given, a new one is
   * generated -- this is also the path Re-Enablement uses internally,
   * since Re-Enablement "always creates a new Instance with a new
   * Identity Key" per the spec.
   */
  static new_(identityKey?: IdentityKey): Instance {
    return new Instance({
      instanceId: randomUUID(),
      identityKey: identityKey ?? IdentityKey.generate(),
    });
  }

  /**
   * Restore eligibility after a Terminal State.
   *
   * Named with a leading underscore on purpose, matching the Python
   * source: this is the bare mechanism, not the sanctioned entry point.
   * A public `reEnable()` would invite direct use, when the only audited
   * path should ever be `governance.requestReEnablement()`. The
   * underscore is a stronger signal than a docstring warning alone,
   * though TypeScript still can't make this a hard guarantee -- nothing
   * stops external code from calling `instance._reEnable(evidence)`
   * directly.
   *
   * Always returns a brand-new Instance with a new IdentityKey; never
   * mutates `this`, and the old Instance/IdentityKey are never reused --
   * Re-Enablement is a reset of eligibility, not of the audit trail.
   *
   * `evidence` is a required Evidence object, not two optional loose
   * strings: the spec states Re-Enablement "requires root-cause analysis
   * and a specification-update proposal as evidence," and Evidence's
   * constructor enforces both fields are non-empty.
   */
  _reEnable(evidence: Evidence): Instance {
    void evidence; // required for the caller-facing contract; not consumed here, same as the Python source
    return new Instance({
      instanceId: randomUUID(),
      identityKey: IdentityKey.generate(),
      predecessorInstanceId: this.instanceId,
      generation: this.generation + 1,
    });
  }
}
