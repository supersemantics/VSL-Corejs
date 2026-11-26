import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_KEY,
  DRIFT_DETECTED_KEY,
  Enforcement,
  JsonlLedgerStore,
  LedgerEntry,
  LedgerEntryType,
  VerbaLedger,
} from "../src/index.js";

// Port of vsl-core's tests/test_enforcement.py.

const gate = (ledger: VerbaLedger, decisionId: string, allowed: boolean, name = "refund-cap") =>
  ledger.writeGateDecision("refund-agent", name, { allowed, decisionId });

const action = (ledger: VerbaLedger, decisionId: string, name = "issue_refund") =>
  ledger.writeAction("refund-agent", name, { decisionId });

describe("VerbaLedger.enforcement", () => {
  it("allow then action is BEFORE_ACTION", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", true);
    await action(ledger, "d1");
    expect(await ledger.enforcement("d1")).toBe(Enforcement.BEFORE_ACTION);
  });

  it("an action with no gate record is AFTER_ACTION", async () => {
    const ledger = new VerbaLedger();
    await action(ledger, "d1");
    expect(await ledger.enforcement("d1")).toBe(Enforcement.AFTER_ACTION);
  });

  it("an action recorded before the gate is AFTER_ACTION", async () => {
    const ledger = new VerbaLedger();
    await action(ledger, "d1");
    await gate(ledger, "d1", true);
    expect(await ledger.enforcement("d1")).toBe(Enforcement.AFTER_ACTION);
  });

  it("an action after a deny is AFTER_ACTION", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", false);
    await action(ledger, "d1");
    expect(await ledger.enforcement("d1")).toBe(Enforcement.AFTER_ACTION);
  });

  it("a deny with no action held: BEFORE_ACTION", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", false);
    expect(await ledger.enforcement("d1")).toBe(Enforcement.BEFORE_ACTION);
  });

  it("an allow with no action record is NOT_OBSERVED", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", true);
    expect(await ledger.enforcement("d1")).toBe(Enforcement.NOT_OBSERVED);
  });

  it("an unknown decision is NOT_OBSERVED", async () => {
    expect(await new VerbaLedger().enforcement("missing")).toBe(Enforcement.NOT_OBSERVED);
  });

  it("deny, then an allowing retry, then the action is BEFORE_ACTION", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", false);
    await gate(ledger, "d1", true);
    await action(ledger, "d1");
    expect(await ledger.enforcement("d1")).toBe(Enforcement.BEFORE_ACTION);
  });

  it("every gate must allow before the action; primitiveName judges one gate", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", true, "refund-cap");
    await gate(ledger, "d1", false, "fraud-check");
    await action(ledger, "d1");
    expect(await ledger.enforcement("d1")).toBe(Enforcement.AFTER_ACTION);
    expect(await ledger.enforcement("d1", { primitiveName: "refund-cap" })).toBe(Enforcement.BEFORE_ACTION);
    expect(await ledger.enforcement("d1", { primitiveName: "fraud-check" })).toBe(Enforcement.AFTER_ACTION);
  });

  it("each action is judged by the latest record of each gate before it", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", true);
    await action(ledger, "d1");
    await gate(ledger, "d1", false);
    await action(ledger, "d1");
    expect(await ledger.enforcement("d1")).toBe(Enforcement.AFTER_ACTION);
  });

  it("other decisions do not interfere", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", true);
    await action(ledger, "d2");
    await action(ledger, "d1");
    expect(await ledger.enforcement("d1")).toBe(Enforcement.BEFORE_ACTION);
    expect(await ledger.enforcement("d2")).toBe(Enforcement.AFTER_ACTION);
  });

  it("enforcementByDecision covers every decision with a gate or action record", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "ok", true);
    await action(ledger, "ok");
    await action(ledger, "skipped");
    await gate(ledger, "pending", true);
    await ledger.writeMonitor("refund-agent", false, { decisionId: "plain-monitor" });
    expect(await ledger.enforcementByDecision()).toEqual({
      ok: Enforcement.BEFORE_ACTION,
      skipped: Enforcement.AFTER_ACTION,
      pending: Enforcement.NOT_OBSERVED,
    });
  });

  it("survives a JSONL round trip", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsl-enforcement-"));
    const file = path.join(dir, "decisions.jsonl");
    const ledger = new VerbaLedger(new JsonlLedgerStore(file));
    await gate(ledger, "d1", true);
    await action(ledger, "d1");
    const reloaded = new VerbaLedger(new JsonlLedgerStore(file));
    expect(await reloaded.enforcement("d1")).toBe(Enforcement.BEFORE_ACTION);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("VerbaLedger.writeAction", () => {
  it("writes the action record shape", async () => {
    const entry = await action(new VerbaLedger(), "d1");
    expect(entry.entryType).toBe(LedgerEntryType.MONITOR);
    expect(entry.payload[ACTION_KEY]).toEqual({ name: "issue_refund" });
    expect(entry.payload[DRIFT_DETECTED_KEY]).toBe(false);
    expect(entry.decisionId).toBe("d1");
  });

  it("extraPayload cannot overwrite the record's own keys", async () => {
    const entry = await new VerbaLedger().writeAction("a", "issue_refund", {
      decisionId: "d1",
      extraPayload: { [ACTION_KEY]: "forged", [DRIFT_DETECTED_KEY]: true, amount: 40 },
    });
    expect(entry.payload[ACTION_KEY]).toEqual({ name: "issue_refund" });
    expect(entry.payload[DRIFT_DETECTED_KEY]).toBe(false);
    expect(entry.payload["amount"]).toBe(40);
  });

  it("rejects a missing decisionId or action name", async () => {
    await expect(new VerbaLedger().writeAction("a", "issue_refund", { decisionId: "" })).rejects.toThrow(/decisionId/);
    await expect(new VerbaLedger().writeAction("a", " ", { decisionId: "d1" })).rejects.toThrow(/action's name/);
  });
});

describe("action records and audit()", () => {
  it("do not break the audit", async () => {
    const ledger = new VerbaLedger();
    await gate(ledger, "d1", true);
    await action(ledger, "d1");
    const report = await ledger.audit();
    expect(report.allPassed).toBe(true);
    expect(report.checksPassed).toHaveLength(5);
    expect(await ledger.verifyIntegrity()).toBe(true);
  });

  const appendAt = (ledger: VerbaLedger, timestamp: number, payload: Record<string, unknown>) =>
    ledger.store.append(
      new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "refund-agent", decisionId: "d1", payload, timestamp })
    );

  it("do not hide a monitoring gap", async () => {
    const ledger = new VerbaLedger();
    await appendAt(ledger, 0, { [DRIFT_DETECTED_KEY]: false });
    for (const t of [5, 10, 15]) {
      await appendAt(ledger, t, { [ACTION_KEY]: { name: "issue_refund" }, [DRIFT_DETECTED_KEY]: false });
    }
    await appendAt(ledger, 20, { [DRIFT_DETECTED_KEY]: false });
    expect((await ledger.audit(8)).checksFailed).toContain("no_monitoring_gaps");
  });

  it("gate decisions still count as monitoring", async () => {
    const ledger = new VerbaLedger();
    for (const t of [0, 5, 10]) {
      await appendAt(ledger, t, { primitive_name: "refund-cap", allowed: true, [DRIFT_DETECTED_KEY]: false });
    }
    expect((await ledger.audit(8)).checksPassed).toContain("no_monitoring_gaps");
  });
});
