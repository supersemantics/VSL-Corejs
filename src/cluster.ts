/**
 * Layer 0/2 Cluster construct: a higher-order identity formed by
 * coordination of multiple Nodes, generating governance requirements
 * absent at the Node level.
 *
 * Canonical failure mode (Flash Crash, 2010): individual Gamma > 1,
 * Cluster Gamma = 0. Port of vsl_core/cluster.py.
 */

import { Fallback, FormationLayerIntervention, Invariant } from "./constructs.js";
import { ClusterKey, IdentityKey } from "./identity.js";

export interface ClusterInadmissibleStateInit {
  name: string;
  description: string;
  signature: string;
  note?: string;
}

/**
 * A Cluster-level Inadmissible State.
 *
 * `note` is a first-class field, not a comment: the spec's own Cluster
 * example carries a warning sentence ("Individual system Gamma > 1 is
 * insufficient. Cluster-level governance is required.") that is the
 * single most important sentence in the whole construct and should be
 * programmatically retrievable by anything built on top of this package.
 */
export class ClusterInadmissibleState {
  readonly name: string;
  readonly description: string;
  readonly signature: string;
  readonly note: string;

  constructor(init: ClusterInadmissibleStateInit) {
    this.name = init.name;
    this.description = init.description;
    this.signature = init.signature;
    this.note = init.note ?? "";
  }
}

export interface ClusterPreNodeInit {
  name: string;
  triggerDescription: string;
  authority: string;
  intervention?: FormationLayerIntervention | null;
  fallback?: Fallback;
}

/** A Cluster-level Pre-Node -- fires on aggregate/cross-constituent signatures that no single constituent's own Pre-Node would catch. */
export class ClusterPreNode {
  readonly name: string;
  readonly triggerDescription: string;
  readonly authority: string;
  readonly intervention: FormationLayerIntervention | null;
  readonly fallback: Fallback;

  constructor(init: ClusterPreNodeInit) {
    this.name = init.name;
    this.triggerDescription = init.triggerDescription;
    this.authority = init.authority;
    this.intervention = init.intervention ?? null;
    this.fallback = init.fallback ?? new Fallback();
  }
}

export interface ClusterInit {
  name: string;
  clusterKey: ClusterKey;
  constituents: readonly IdentityKey[];
  clusterInadmissibleStates?: readonly ClusterInadmissibleState[];
  clusterPreNodes?: readonly ClusterPreNode[];
  invariants?: readonly Invariant[];
}

/**
 * A higher-order identity formed by coordination of multiple Nodes.
 *
 * The constructor validates that every declared constituent is actually
 * covered by the given ClusterKey's constituentKeys -- this encodes
 * Design Principle P4 (recursive composition) as a runtime-checked
 * invariant instead of a hopeful convention, and directly guards against
 * the Flash-Crash-shaped bug where a Cluster's governance silently
 * doesn't actually cover one of its constituents.
 */
export class Cluster {
  readonly name: string;
  readonly clusterKey: ClusterKey;
  readonly constituents: readonly IdentityKey[];
  readonly clusterInadmissibleStates: readonly ClusterInadmissibleState[];
  readonly clusterPreNodes: readonly ClusterPreNode[];
  readonly invariants: readonly Invariant[];

  constructor(init: ClusterInit) {
    this.name = init.name;
    this.clusterKey = init.clusterKey;
    this.constituents = init.constituents;
    this.clusterInadmissibleStates = init.clusterInadmissibleStates ?? [];
    this.clusterPreNodes = init.clusterPreNodes ?? [];
    this.invariants = init.invariants ?? [];

    const covered = new Set(this.clusterKey.constituentKeys.map((k) => k.value));
    const missing = this.constituents.filter((c) => !covered.has(c.value));
    if (missing.length > 0) {
      throw new Error(
        `Cluster ${JSON.stringify(this.name)} declares constituents not covered by its own clusterKey: ` +
          `${missing.map((m) => m.value).join(", ")}. A Cluster's ClusterKey must be derived from ` +
          `(at least) all of its declared constituents.`
      );
    }
  }

  /**
   * Return a new Cluster with `identityKey` added and clusterKey
   * recomputed. Immutable-by-convention, consistent with
   * Instance._reEnable.
   */
  addConstituent(identityKey: IdentityKey): Cluster {
    const newConstituents = [...this.constituents, identityKey];
    const newClusterKey = ClusterKey.fromConstituents(newConstituents);
    return new Cluster({
      name: this.name,
      clusterKey: newClusterKey,
      constituents: newConstituents,
      clusterInadmissibleStates: this.clusterInadmissibleStates,
      clusterPreNodes: this.clusterPreNodes,
      invariants: this.invariants,
    });
  }
}
