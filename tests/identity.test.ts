import { describe, expect, it } from "vitest";
import { ClusterKey, Evidence, IdentityKey, Instance } from "../src/identity.js";

describe("IdentityKey.generate", () => {
  it("produces unique values", () => {
    const a = IdentityKey.generate();
    const b = IdentityKey.generate();
    expect(a.value).not.toBe(b.value);
  });

  it("uses the given prefix", () => {
    const key = IdentityKey.generate("agent");
    expect(key.value.startsWith("agent-")).toBe(true);
  });

  it("defaults to the vsl prefix", () => {
    const key = IdentityKey.generate();
    expect(key.value.startsWith("vsl-")).toBe(true);
  });
});

describe("IdentityKey.toString / equals", () => {
  it("toString returns the underlying value", () => {
    expect(new IdentityKey("agent-1").toString()).toBe("agent-1");
  });

  it("equals compares by value, not identity", () => {
    expect(new IdentityKey("agent-1").equals(new IdentityKey("agent-1"))).toBe(true);
    expect(new IdentityKey("agent-1").equals(new IdentityKey("agent-2"))).toBe(false);
  });
});

describe("ClusterKey", () => {
  it("is deterministic regardless of constituent order", () => {
    const a = new IdentityKey("agent-a");
    const b = new IdentityKey("agent-b");
    expect(ClusterKey.fromConstituents([a, b]).value).toBe(ClusterKey.fromConstituents([b, a]).value);
  });

  it("differs for different constituents", () => {
    const a = new IdentityKey("agent-a");
    const b = new IdentityKey("agent-b");
    const c = new IdentityKey("agent-c");
    expect(ClusterKey.fromConstituents([a, b]).value).not.toBe(ClusterKey.fromConstituents([a, c]).value);
  });
});

describe("Evidence", () => {
  it("rejects an empty rootCauseAnalysis", () => {
    expect(() => new Evidence("", "proposal")).toThrow(/rootCauseAnalysis/);
  });

  it("rejects an empty (whitespace-only) specificationUpdateProposal", () => {
    expect(() => new Evidence("root cause", "   ")).toThrow(/specificationUpdateProposal/);
  });

  it("accepts two real, non-empty strings", () => {
    const evidence = new Evidence("root cause", "proposal");
    expect(evidence.rootCauseAnalysis).toBe("root cause");
  });
});

describe("Instance", () => {
  it("new_() mints a fresh IdentityKey when none is given", () => {
    const instance = Instance.new_();
    expect(instance.identityKey).toBeInstanceOf(IdentityKey);
    expect(instance.generation).toBe(0);
    expect(instance.predecessorInstanceId).toBeNull();
  });

  it("new_() accepts an explicit IdentityKey", () => {
    const key = new IdentityKey("agent-fixed");
    const instance = Instance.new_(key);
    expect(instance.identityKey.value).toBe("agent-fixed");
  });

  it("_reEnable creates a new Instance with a new IdentityKey, incrementing generation", () => {
    const original = Instance.new_();
    const evidence = new Evidence("root cause", "proposal");
    const reEnabled = original._reEnable(evidence);

    expect(reEnabled.instanceId).not.toBe(original.instanceId);
    expect(reEnabled.identityKey.value).not.toBe(original.identityKey.value);
    expect(reEnabled.predecessorInstanceId).toBe(original.instanceId);
    expect(reEnabled.generation).toBe(1);
  });

  it("_reEnable does not mutate the original Instance", () => {
    const original = Instance.new_();
    const originalId = original.instanceId;
    original._reEnable(new Evidence("root cause", "proposal"));
    expect(original.instanceId).toBe(originalId);
    expect(original.generation).toBe(0);
  });

  it("re-enablement chains correctly increment generation each time", () => {
    const evidence = new Evidence("root cause", "proposal");
    const gen0 = Instance.new_();
    const gen1 = gen0._reEnable(evidence);
    const gen2 = gen1._reEnable(evidence);
    expect(gen1.generation).toBe(1);
    expect(gen2.generation).toBe(2);
    expect(gen2.predecessorInstanceId).toBe(gen1.instanceId);
  });
});
