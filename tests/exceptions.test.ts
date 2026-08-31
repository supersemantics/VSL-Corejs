import { describe, expect, it } from "vitest";
import {
  AutomationDeniedException,
  CatalogValidationError,
  ConformanceError,
  InvariantViolation,
  LedgerIntegrityError,
  VSLError,
} from "../src/exceptions.js";

describe("AutomationDeniedException", () => {
  it("is a VSLError", () => {
    const exc = new AutomationDeniedException({ reason: "denied", identityKey: "agent-1" });
    expect(exc).toBeInstanceOf(VSLError);
    expect(exc).toBeInstanceOf(Error);
  });

  it("defaults instanceId to null and stamps a timestamp", () => {
    const exc = new AutomationDeniedException({ reason: "denied", identityKey: "agent-1" });
    expect(exc.instanceId).toBeNull();
    expect(exc.timestamp).toBeGreaterThan(0);
  });

  it("is actually throwable and catchable", () => {
    expect(() => {
      throw new AutomationDeniedException({ reason: "denied", identityKey: "agent-1" });
    }).toThrow(AutomationDeniedException);
  });
});

describe("InvariantViolation", () => {
  it("is a subclass of AutomationDeniedException", () => {
    const exc = new InvariantViolation({ reason: "violated", identityKey: "agent-1" });
    expect(exc).toBeInstanceOf(AutomationDeniedException);
  });

  it("is caught by a generic AutomationDeniedException handler", () => {
    let caught: unknown = null;
    try {
      throw new InvariantViolation({ reason: "violated", identityKey: "agent-1" });
    } catch (exc) {
      if (exc instanceof AutomationDeniedException) caught = exc;
    }
    expect(caught).not.toBeNull();
  });

  it("is distinguishable from a plain AutomationDeniedException via instanceof", () => {
    const plain = new AutomationDeniedException({ reason: "denied", identityKey: "agent-1" });
    const invariant = new InvariantViolation({ reason: "violated", identityKey: "agent-1" });
    expect(plain).not.toBeInstanceOf(InvariantViolation);
    expect(invariant).toBeInstanceOf(InvariantViolation);
  });

  it("carries invariantName and terminalStateName", () => {
    const exc = new InvariantViolation({
      reason: "violated",
      identityKey: "agent-1",
      invariantName: "hard-cap",
      terminalStateName: "halted",
    });
    expect(exc.invariantName).toBe("hard-cap");
    expect(exc.terminalStateName).toBe("halted");
  });

  it("defaults terminalStateName to null when unset", () => {
    const exc = new InvariantViolation({ reason: "violated", identityKey: "agent-1" });
    expect(exc.terminalStateName).toBeNull();
  });
});

describe("Other VSLError subclasses are distinct types", () => {
  it("LedgerIntegrityError, CatalogValidationError, ConformanceError are all VSLErrors but distinguishable", () => {
    const ledger = new LedgerIntegrityError("chain broken");
    const catalog = new CatalogValidationError("bad json");
    const conformance = new ConformanceError("gate not callable");

    for (const err of [ledger, catalog, conformance]) {
      expect(err).toBeInstanceOf(VSLError);
    }
    expect(ledger).not.toBeInstanceOf(CatalogValidationError);
    expect(catalog).not.toBeInstanceOf(ConformanceError);
    expect(conformance).not.toBeInstanceOf(LedgerIntegrityError);
  });
});
