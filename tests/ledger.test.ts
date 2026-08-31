import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerIntegrityError } from "../src/exceptions.js";
import {
  GENESIS_HASH,
  InMemoryLedgerStore,
  JsonlLedgerStore,
  LedgerEntry,
  LedgerEntryType,
  VerbaCertificate,
  VerbaLedger,
  VerificationResult,
} from "../src/ledger.js";

describe("InMemoryLedgerStore hash chain", () => {
  it("seals the first entry against the genesis hash at sequence 0", async () => {
    const store = new InMemoryLedgerStore();
    const sealed = await store.append(
      new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-1" })
    );
    expect(sealed.sequence).toBe(0);
    expect(sealed.prevHash).toBe(GENESIS_HASH);
    expect(sealed.entryHash).toHaveLength(64);
  });

  it("chains prevHash to the previous entry's entryHash", async () => {
    const store = new InMemoryLedgerStore();
    const first = await store.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "a" }));
    const second = await store.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "a" }));
    expect(second.sequence).toBe(1);
    expect(second.prevHash).toBe(first.entryHash);
  });
});

describe("entriesForIdentity", () => {
  it("InMemoryLedgerStore filters to only the matching identityKey", async () => {
    const store = new InMemoryLedgerStore();
    await store.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-1" }));
    await store.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-2" }));
    await store.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-1" }));

    const entries: LedgerEntry[] = [];
    for await (const e of store.entriesForIdentity("agent-1")) entries.push(e);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.identityKey === "agent-1")).toBe(true);
  });
});

describe("VerbaLedger.verifyIntegrity", () => {
  it("returns true for an untampered chain", async () => {
    const ledger = new VerbaLedger();
    await ledger.writeMonitor("agent-1", false);
    await ledger.writeVerification("agent-1", VerificationResult.SUFFICIENT);
    expect(await ledger.verifyIntegrity()).toBe(true);
  });

  it("returns false, never throws, for a chain whose entry_hash has been tampered with", async () => {
    const store = new InMemoryLedgerStore();
    const ledger = new VerbaLedger(store);
    await ledger.writeMonitor("agent-1", true);

    // Reach into the store directly to simulate tampering -- this is
    // deliberately bypassing the public API, the same way a real tamper
    // would.
    const entries: LedgerEntry[] = [];
    for await (const e of store.allEntries()) entries.push(e);
    const tampered = entries[0]!.withFields({ payload: { drift_detected: false } });
    store["entries"] = [tampered];

    await expect(ledger.verifyIntegrity()).resolves.toBe(false);
  });

  it("returns false for a sequence gap", async () => {
    const store = new InMemoryLedgerStore();
    const ledger = new VerbaLedger(store);
    await ledger.writeMonitor("agent-1", false);
    await ledger.writeMonitor("agent-1", false);

    const entries: LedgerEntry[] = [];
    for await (const e of store.allEntries()) entries.push(e);
    // Delete the middle of the chain (simulated by skipping straight from
    // sequence 0 to a re-numbered "2") -- entries[1] now claims sequence 1
    // still, so instead directly corrupt its recorded sequence forward.
    const corrupted = entries[1]!.withFields({ sequence: 5 });
    store["entries"] = [entries[0]!, corrupted];

    expect(await ledger.verifyIntegrity()).toBe(false);
  });

  it("returns false when prevHash doesn't match the actual previous entry's entryHash", async () => {
    const store = new InMemoryLedgerStore();
    const ledger = new VerbaLedger(store);
    await ledger.writeMonitor("agent-1", false);
    await ledger.writeMonitor("agent-1", false);

    const entries: LedgerEntry[] = [];
    for await (const e of store.allEntries()) entries.push(e);
    const corrupted = entries[1]!.withFields({ prevHash: "f".repeat(64) });
    store["entries"] = [entries[0]!, corrupted];

    expect(await ledger.verifyIntegrity()).toBe(false);
  });
});

describe("VerbaLedger.write refuses on an already-broken chain", () => {
  it("throws LedgerIntegrityError rather than silently extending a tampered chain", async () => {
    const store = new InMemoryLedgerStore();
    const ledger = new VerbaLedger(store);
    await ledger.writeMonitor("agent-1", false);

    const entries: LedgerEntry[] = [];
    for await (const e of store.allEntries()) entries.push(e);
    const tampered = entries[0]!.withFields({ payload: { drift_detected: true } });
    store["entries"] = [tampered];

    await expect(ledger.writeMonitor("agent-1", false)).rejects.toThrow(LedgerIntegrityError);
  });
});

describe("VerbaLedger.audit", () => {
  it("passes drift_flagged_monitor_has_pre_node when a causally-linked PRE_NODE follows a drift MONITOR", async () => {
    const ledger = new VerbaLedger();
    const monitor = await ledger.writeMonitor("agent-1", true);
    await ledger.write(LedgerEntryType.PRE_NODE, "agent-1", { causedBy: monitor.entryId });

    const report = await ledger.audit();
    expect(report.checksPassed).toContain("drift_flagged_monitor_has_pre_node");
  });

  it("fails drift_flagged_monitor_has_pre_node when a drift MONITOR has no resolving PRE_NODE", async () => {
    const ledger = new VerbaLedger();
    await ledger.writeMonitor("agent-1", true);

    const report = await ledger.audit();
    expect(report.checksFailed).toContain("drift_flagged_monitor_has_pre_node");
    expect(report.allPassed).toBe(false);
  });

  it("causedBy overrides the timestamp/identity fallback heuristic, closing the false-pass gap", async () => {
    const ledger = new VerbaLedger();
    const monitor = await ledger.writeMonitor("agent-1", true);
    // An unrelated PRE_NODE on the same identity, later in time, with an
    // explicit (different) causedBy -- must NOT satisfy the drift monitor's
    // check, even though the old timestamp-only heuristic would wrongly
    // accept it.
    await ledger.write(LedgerEntryType.PRE_NODE, "agent-1", { causedBy: "some-other-entry-id" });

    const report = await ledger.audit();
    expect(report.checksFailed).toContain("drift_flagged_monitor_has_pre_node");
    expect(report.violations["drift_flagged_monitor_has_pre_node"]).toContain(monitor.entryId);
  });

  it("check 3: fails pre_node_has_verification when a PRE_NODE has no resolving VERIFICATION", async () => {
    const ledger = new VerbaLedger();
    const preNode = await ledger.write(LedgerEntryType.PRE_NODE, "agent-1");

    const report = await ledger.audit();
    expect(report.checksFailed).toContain("pre_node_has_verification");
    expect(report.violations["pre_node_has_verification"]).toContain(preNode.entryId);
  });

  it("check 3: passes when a causally-linked VERIFICATION follows the PRE_NODE", async () => {
    const ledger = new VerbaLedger();
    const preNode = await ledger.write(LedgerEntryType.PRE_NODE, "agent-1");
    await ledger.writeVerification("agent-1", VerificationResult.SUFFICIENT, { causedBy: preNode.entryId });

    const report = await ledger.audit();
    expect(report.checksPassed).toContain("pre_node_has_verification");
  });

  it("check 4: fails insufficient_verification_has_specification_update when unresolved", async () => {
    const ledger = new VerbaLedger();
    const verification = await ledger.writeVerification("agent-1", VerificationResult.INSUFFICIENT);

    const report = await ledger.audit();
    expect(report.checksFailed).toContain("insufficient_verification_has_specification_update");
    expect(report.violations["insufficient_verification_has_specification_update"]).toContain(verification.entryId);
  });

  it("check 4: SUFFICIENT verifications never require a SPECIFICATION_UPDATE", async () => {
    const ledger = new VerbaLedger();
    await ledger.writeVerification("agent-1", VerificationResult.SUFFICIENT);

    const report = await ledger.audit();
    expect(report.checksPassed).toContain("insufficient_verification_has_specification_update");
  });

  it("check 4: passes when a causally-linked SPECIFICATION_UPDATE follows an INSUFFICIENT verification", async () => {
    const ledger = new VerbaLedger();
    const verification = await ledger.writeVerification("agent-1", VerificationResult.INSUFFICIENT);
    await ledger.write(LedgerEntryType.SPECIFICATION_UPDATE, "agent-1", { causedBy: verification.entryId });

    const report = await ledger.audit();
    expect(report.checksPassed).toContain("insufficient_verification_has_specification_update");
  });

  it("check 5: fails terminal_has_human_authorised_transition when unresolved", async () => {
    const ledger = new VerbaLedger();
    const terminal = await ledger.write(LedgerEntryType.TERMINAL, "agent-1");

    const report = await ledger.audit();
    expect(report.checksFailed).toContain("terminal_has_human_authorised_transition");
    expect(report.violations["terminal_has_human_authorised_transition"]).toContain(terminal.entryId);
  });

  it("check 5: passes when a causally-linked HUMAN_AUTHORISED_TRANSITION follows the TERMINAL entry", async () => {
    const ledger = new VerbaLedger();
    const terminal = await ledger.write(LedgerEntryType.TERMINAL, "agent-1");
    await ledger.write(LedgerEntryType.HUMAN_AUTHORISED_TRANSITION, "agent-1", { causedBy: terminal.entryId });

    const report = await ledger.audit();
    expect(report.checksPassed).toContain("terminal_has_human_authorised_transition");
  });

  it("every check vacuously passes on an empty ledger", async () => {
    const ledger = new VerbaLedger();
    const report = await ledger.audit();
    expect(report.allPassed).toBe(true);
    expect(report.checksFailed).toEqual([]);
  });

  it("check 1 (no_monitoring_gaps) is skipped -- reported passed -- when maxMonitorGapSeconds is not given", async () => {
    const ledger = new VerbaLedger();
    await ledger.writeMonitor("agent-1", false);
    await ledger.writeMonitor("agent-1", false); // same instant -- would be a "gap" of ~0, irrelevant either way

    const report = await ledger.audit(); // no maxMonitorGapSeconds
    expect(report.checksPassed).toContain("no_monitoring_gaps");
  });

  it("check 1 actually detects a real gap once maxMonitorGapSeconds is given", async () => {
    const store = new InMemoryLedgerStore();
    const ledger = new VerbaLedger(store);
    await ledger.writeMonitor("agent-1", false);
    await ledger.writeMonitor("agent-1", false);

    // Force a real 100-second gap between the two MONITOR entries -- the
    // public write path always stamps "now", so this reaches into the
    // store directly, same pattern as the tamper-detection tests above.
    const entries: LedgerEntry[] = [];
    for await (const e of store.allEntries()) entries.push(e);
    const spread = [
      entries[0]!.withFields({ timestamp: 1000 }),
      entries[1]!.withFields({ timestamp: 1100 }),
    ];
    store["entries"] = spread;

    const passingReport = await ledger.audit(200); // gap (100s) < threshold (200s) -> passes
    expect(passingReport.checksPassed).toContain("no_monitoring_gaps");

    const failingReport = await ledger.audit(50); // gap (100s) > threshold (50s) -> fails
    expect(failingReport.checksFailed).toContain("no_monitoring_gaps");
    expect(failingReport.violations["no_monitoring_gaps"]).toEqual([`${spread[0]!.entryId}->${spread[1]!.entryId}`]);
  });
});

describe("causallyResolves fallback heuristic (no causedBy set)", () => {
  it("an entry on a different identityKey never resolves, regardless of timing", async () => {
    const ledger = new VerbaLedger();
    const monitor = await ledger.writeMonitor("agent-1", true);
    // A PRE_NODE on a totally different identity, later in time, no causedBy --
    // the fallback heuristic must not match across identities.
    await ledger.write(LedgerEntryType.PRE_NODE, "agent-2");

    const report = await ledger.audit();
    expect(report.checksFailed).toContain("drift_flagged_monitor_has_pre_node");
    expect(report.violations["drift_flagged_monitor_has_pre_node"]).toContain(monitor.entryId);
  });

  it("an entry with an earlier timestamp than the source never resolves it", async () => {
    const store = new InMemoryLedgerStore();
    const ledger = new VerbaLedger(store);
    const preNode = await ledger.write(LedgerEntryType.PRE_NODE, "agent-1");
    const monitor = await ledger.writeMonitor("agent-1", true);

    // Force the PRE_NODE (which is actually chained *before* the MONITOR)
    // to appear to have an earlier timestamp than the MONITOR it would
    // otherwise coincidentally match on identity alone.
    const entries: LedgerEntry[] = [];
    for await (const e of store.allEntries()) entries.push(e);
    store["entries"] = [entries[0]!.withFields({ timestamp: 1 }), entries[1]!.withFields({ timestamp: 1000 })];

    const report = await ledger.audit();
    expect(report.checksFailed).toContain("drift_flagged_monitor_has_pre_node");
    expect(report.violations["drift_flagged_monitor_has_pre_node"]).toContain(monitor.entryId);
  });

  it("checkInstance=true (checks 2/3): a resolving entry on a different instanceId does not match", async () => {
    const ledger = new VerbaLedger();
    const monitor = await ledger.writeMonitor("agent-1", true, { instanceId: "instance-a" });
    await ledger.write(LedgerEntryType.PRE_NODE, "agent-1", { instanceId: "instance-b" });

    const report = await ledger.audit();
    expect(report.checksFailed).toContain("drift_flagged_monitor_has_pre_node");
    expect(report.violations["drift_flagged_monitor_has_pre_node"]).toContain(monitor.entryId);
  });

  it("checkInstance=false (checks 4/5): matches across different instanceIds when identity matches", async () => {
    const ledger = new VerbaLedger();
    await ledger.write(LedgerEntryType.TERMINAL, "agent-1", { instanceId: "instance-a" });
    await ledger.write(LedgerEntryType.HUMAN_AUTHORISED_TRANSITION, "agent-1", { instanceId: "instance-b" });

    const report = await ledger.audit();
    expect(report.checksPassed).toContain("terminal_has_human_authorised_transition");
  });
});

describe("VerbaLedger.currentCheckpoint", () => {
  it("returns null for an empty ledger", async () => {
    const ledger = new VerbaLedger();
    expect(await ledger.currentCheckpoint()).toBeNull();
  });

  it("matches the last entry and updates on new writes", async () => {
    const ledger = new VerbaLedger();
    const first = await ledger.writeMonitor("agent-1", false);
    let checkpoint = await ledger.currentCheckpoint();
    expect(checkpoint!.sequence).toBe(first.sequence);
    expect(checkpoint!.entryHash).toBe(first.entryHash);

    const second = await ledger.writeMonitor("agent-1", false);
    checkpoint = await ledger.currentCheckpoint();
    expect(checkpoint!.sequence).toBe(second.sequence);
    expect(checkpoint!.entryHash).toBe(second.entryHash);
  });
});

describe("Causal fields round-trip through JsonlLedgerStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vsl-core-ts-ledger-roundtrip-"));
    filePath = join(dir, "ledger.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("decisionId and causedBy survive a write-then-read-back round trip on disk", async () => {
    const ledger = new VerbaLedger(new JsonlLedgerStore(filePath));
    const first = await ledger.writeMonitor("agent-1", true);
    const second = await ledger.write(LedgerEntryType.PRE_NODE, "agent-1", {
      decisionId: "decision-42",
      causedBy: first.entryId,
    });

    const reader = new JsonlLedgerStore(filePath);
    const entries: LedgerEntry[] = [];
    for await (const e of reader.allEntries()) entries.push(e);

    expect(entries[1]!.decisionId).toBe("decision-42");
    expect(entries[1]!.causedBy).toBe(first.entryId);
    expect(entries[1]!.entryId).toBe(second.entryId);
  });

  it("write() stamps the current LEDGER_SCHEMA_VERSION on every entry it constructs", async () => {
    const ledger = new VerbaLedger();
    const entry = await ledger.writeMonitor("agent-1", false);
    expect(entry.schemaVersion).toBe("1.0");
  });

  it("a bare `new LedgerEntry(...)` does not assume a schema version", () => {
    const entry = new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-1" });
    expect(entry.schemaVersion).toBeNull();
  });
});

describe("VerbaLedger.issueCertificate", () => {
  it("returns null when the audit does not fully pass", async () => {
    const ledger = new VerbaLedger();
    await ledger.writeMonitor("agent-1", true); // drift with no resolving PRE_NODE -> audit fails
    expect(await ledger.issueCertificate()).toBeNull();
  });

  it("issues a real certificate when the audit fully passes, and never fabricates one", async () => {
    const ledger = new VerbaLedger(); // empty ledger -> every check vacuously passes
    const cert = await ledger.issueCertificate();
    expect(cert).not.toBeNull();
    expect(cert!.auditReport.allPassed).toBe(true);
    expect(cert!.certificateHash).toHaveLength(64);
    expect(cert!.toString()).toContain("does not guarantee no Inadmissible State");
  });
});

describe("JsonlLedgerStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vsl-core-ts-ledger-"));
    filePath = join(dir, "ledger.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists entries across separate store instances pointed at the same file", async () => {
    const writer = new JsonlLedgerStore(filePath);
    await writer.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-1" }));
    await writer.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-1" }));

    const reader = new JsonlLedgerStore(filePath);
    const entries: LedgerEntry[] = [];
    for await (const e of reader.allEntries()) entries.push(e);

    expect(entries).toHaveLength(2);
    expect(entries[1]!.prevHash).toBe(entries[0]!.entryHash);
  });

  it("chains correctly through VerbaLedger.verifyIntegrity across a fresh store instance", async () => {
    const ledger1 = new VerbaLedger(new JsonlLedgerStore(filePath));
    await ledger1.writeMonitor("agent-1", false);
    await ledger1.writeVerification("agent-1", VerificationResult.SUFFICIENT);

    const ledger2 = new VerbaLedger(new JsonlLedgerStore(filePath));
    expect(await ledger2.verifyIntegrity()).toBe(true);
  });

  it("entriesForIdentity filters correctly when read back from disk", async () => {
    const store = new JsonlLedgerStore(filePath);
    await store.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-1" }));
    await store.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-2" }));

    const entries: LedgerEntry[] = [];
    for await (const e of store.entriesForIdentity("agent-2")) entries.push(e);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.identityKey).toBe("agent-2");
  });

  it("fsync: true does not error and still persists correctly", async () => {
    const store = new JsonlLedgerStore(filePath, { fsync: true });
    await store.append(new LedgerEntry({ entryType: LedgerEntryType.MONITOR, identityKey: "agent-1" }));
    expect(await store.lastEntry()).not.toBeNull();
  });
});

describe("VerbaCertificate", () => {
  it("accepts an explicit certificateHash rather than always recomputing one", async () => {
    const ledger = new VerbaLedger();
    const report = await ledger.audit();
    const cert = new VerbaCertificate({
      issuedAt: 1,
      periodStart: 1,
      periodEnd: 1,
      entriesCovered: 0,
      auditReport: report,
      certificateHash: "precomputed-hash-value",
    });
    expect(cert.certificateHash).toBe("precomputed-hash-value");
  });
});
