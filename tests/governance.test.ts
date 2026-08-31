import { describe, expect, it } from "vitest";
import {
  Binding,
  GovernanceAuthority,
  HumanAuthorisedTransition,
  Proofing,
  requestReEnablement,
  Specification,
} from "../src/governance.js";
import { Evidence, Instance } from "../src/identity.js";

const authority = () => new GovernanceAuthority({ name: "safety-board", escalationContact: "oncall@example.com" });

describe("Binding", () => {
  it("refuses to construct from unverified Proofing", () => {
    const proofing = new Proofing({ verified: false, verifiedAgainst: "records" });
    expect(() => new Binding(proofing, "escalate-to-safety-board")).toThrow(/unverified Proofing/);
  });

  it("constructs from verified Proofing", () => {
    const proofing = new Proofing({ verified: true, verifiedAgainst: "records" });
    const binding = new Binding(proofing, "escalate-to-safety-board");
    expect(binding.proofing.verified).toBe(true);
  });
});

describe("Specification.activate", () => {
  it("refuses to activate without a Binding", () => {
    const spec = new Specification({ name: "s1", version: "1.0", approvedBy: authority() });
    expect(() => spec.activate()).toThrow(/without a Binding/);
  });

  it("refuses to activate twice", () => {
    const proofing = new Proofing({ verified: true, verifiedAgainst: "records" });
    const binding = new Binding(proofing, "path");
    const spec = new Specification({ name: "s1", version: "1.0", approvedBy: authority() }).withBinding(binding);
    const activated = spec.activate();
    expect(() => activated.activate()).toThrow(/already active/);
  });

  it("activates once a real Binding (which itself required a verified Proofing) is attached", () => {
    const proofing = new Proofing({ verified: true, verifiedAgainst: "records" });
    const binding = new Binding(proofing, "path");
    const spec = new Specification({ name: "s1", version: "1.0", approvedBy: authority() }).withBinding(binding);
    const activated = spec.activate();
    expect(activated.activatedAt).not.toBeNull();
  });
});

describe("requestReEnablement", () => {
  it("pairs a new Instance with the HumanAuthorisedTransition that authorises it", () => {
    const terminated = Instance.new_();
    const evidence = new Evidence("root cause found", "spec update proposed");

    const [newInstance, transition] = requestReEnablement(terminated, authority(), "jane.doe", evidence);

    expect(newInstance.predecessorInstanceId).toBe(terminated.instanceId);
    expect(newInstance.generation).toBe(terminated.generation + 1);
    expect(transition.authorisedBy).toBe("jane.doe");
    expect(transition.evidence).toEqual(["root cause found", "spec update proposed"]);
  });
});

describe("HumanAuthorisedTransition", () => {
  it("requires a real, non-empty human approver", () => {
    expect(
      () => HumanAuthorisedTransition.authorise(authority(), "  ", new Evidence("root cause", "proposal"))
    ).toThrow(/authorisedBy must name a real, non-empty human approver/);
  });

  it("computes a deterministic evidence hash for the same evidence", () => {
    const evidence = new Evidence("root cause", "proposal");
    const t1 = HumanAuthorisedTransition.authorise(authority(), "jane.doe", evidence);
    const t2 = HumanAuthorisedTransition.authorise(authority(), "jane.doe", evidence);
    expect(t1.authorisationEvidenceHash).toBe(t2.authorisationEvidenceHash);
    expect(t1.authorisationEvidenceHash).toHaveLength(64);
  });

  it("produces a different hash for different evidence", () => {
    const t1 = HumanAuthorisedTransition.authorise(authority(), "jane.doe", new Evidence("cause A", "proposal A"));
    const t2 = HumanAuthorisedTransition.authorise(authority(), "jane.doe", new Evidence("cause B", "proposal B"));
    expect(t1.authorisationEvidenceHash).not.toBe(t2.authorisationEvidenceHash);
  });
});
