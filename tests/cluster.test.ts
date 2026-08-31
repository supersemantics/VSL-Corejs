import { describe, expect, it } from "vitest";
import { Cluster, ClusterInadmissibleState, ClusterPreNode } from "../src/cluster.js";
import { ClusterKey, IdentityKey } from "../src/identity.js";

describe("Cluster", () => {
  it("constructs when every constituent is covered by the ClusterKey", () => {
    const a = IdentityKey.generate();
    const b = IdentityKey.generate();
    const key = ClusterKey.fromConstituents([a, b]);
    const cluster = new Cluster({ name: "c1", clusterKey: key, constituents: [a, b] });
    expect(cluster.constituents).toHaveLength(2);
  });

  it("rejects a constituent not covered by the ClusterKey -- the Flash-Crash-shaped bug", () => {
    const a = IdentityKey.generate();
    const b = IdentityKey.generate();
    const uncovered = IdentityKey.generate();
    const key = ClusterKey.fromConstituents([a, b]);
    expect(() => new Cluster({ name: "c1", clusterKey: key, constituents: [a, b, uncovered] })).toThrow(
      /not covered by its own clusterKey/
    );
  });

  it("addConstituent recomputes the ClusterKey deterministically regardless of insertion order", () => {
    const a = IdentityKey.generate();
    const b = IdentityKey.generate();
    const key = ClusterKey.fromConstituents([a]);
    const cluster = new Cluster({ name: "c1", clusterKey: key, constituents: [a] });
    const grown = cluster.addConstituent(b);

    const directKey = ClusterKey.fromConstituents([b, a]); // reversed order
    expect(grown.clusterKey.value).toBe(directKey.value);
  });
});

describe("ClusterKey.fromConstituents", () => {
  it("is order-independent", () => {
    const a = new IdentityKey("agent-a");
    const b = new IdentityKey("agent-b");
    expect(ClusterKey.fromConstituents([a, b]).value).toBe(ClusterKey.fromConstituents([b, a]).value);
  });
});

describe("ClusterInadmissibleState", () => {
  it("carries note as a first-class field, defaulting to empty string", () => {
    const withoutNote = new ClusterInadmissibleState({ name: "x", description: "x", signature: "x" });
    expect(withoutNote.note).toBe("");

    const flashCrash = new ClusterInadmissibleState({
      name: "flash-crash",
      description: "Individual Gamma > 1 but Cluster Gamma = 0",
      signature: "coordinated-cascade",
      note: "Individual system Gamma > 1 is insufficient. Cluster-level governance is required.",
    });
    expect(flashCrash.note).toContain("Cluster-level governance is required");
  });
});

describe("ClusterPreNode", () => {
  it("constructs with a default Fallback and null intervention", () => {
    const node = new ClusterPreNode({
      name: "cluster-cascade-check",
      triggerDescription: "aggregate cross-constituent drift signature",
      authority: "safety-board",
    });
    expect(node.intervention).toBeNull();
    expect(node.fallback.maxRetries).toBe(3);
  });
});
