import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as vsl from "../src/index.js";
import {
  DRIFT_DETECTED_KEY,
  GATE_ALLOWED_KEY,
  InMemoryLedgerStore,
  JsonlLedgerStore,
  LedgerEntryType,
  PRIMITIVE_NAME_KEY,
  RULES_VERSION_KEY,
  VerbaLedger,
} from "../src/ledger.js";
import {
  GammaEstimate,
  ROBUST_GAMMA_DEFAULT_THRESHOLD,
  ROBUST_GAMMA_HIGH_STAKES_THRESHOLD,
} from "../src/metrics.js";
import { ASSURANCE_RULES_VERSION } from "../src/rules_version.js";

const newLedger = () => new VerbaLedger(new InMemoryLedgerStore());

describe("VerbaLedger.writeGateDecision", () => {
  it("records a PreNode decision with its Gamma and the bar applied", async () => {
    const entry = await newLedger().writeGateDecision("refund-agent", "refund-within-policy", {
      estimate: new GammaEstimate({ gammaHat: 1.3 }),
      gammaThreshold: ROBUST_GAMMA_DEFAULT_THRESHOLD,
      decisionId: "d-1",
    });

    expect(entry.entryType).toBe(LedgerEntryType.MONITOR);
    expect(entry.decisionId).toBe("d-1");
    expect(entry.payload).toEqual({
      gamma_hat: 1.3,
      delta_estimation_error: 0,
      robust_gamma: 1.3,
      gamma_threshold: ROBUST_GAMMA_DEFAULT_THRESHOLD,
      required_gamma_hat: ROBUST_GAMMA_DEFAULT_THRESHOLD,
      [PRIMITIVE_NAME_KEY]: "refund-within-policy",
      [GATE_ALLOWED_KEY]: true,
      [RULES_VERSION_KEY]: ASSURANCE_RULES_VERSION,
      [DRIFT_DETECTED_KEY]: false,
    });
  });

  it("computes allowed with the gate's own check", async () => {
    const ledger = newLedger();
    const denied = await ledger.writeGateDecision("a", "payment", {
      estimate: new GammaEstimate({ gammaHat: 1.15 }),
      gammaThreshold: ROBUST_GAMMA_HIGH_STAKES_THRESHOLD,
    });
    expect(denied.payload[GATE_ALLOWED_KEY]).toBe(false);
    expect(denied.payload[DRIFT_DETECTED_KEY]).toBe(true);

    const withDelta = await ledger.writeGateDecision("a", "budget", {
      estimate: new GammaEstimate({ gammaHat: 1.15, deltaEstimationError: 0.1 }),
      gammaThreshold: ROBUST_GAMMA_DEFAULT_THRESHOLD,
    });
    expect(withDelta.payload[GATE_ALLOWED_KEY]).toBe(true);
    expect(withDelta.payload["required_gamma_hat"]).toBe(ROBUST_GAMMA_DEFAULT_THRESHOLD);
  });

  it("records an Invariant decision from allowed alone", async () => {
    const entry = await newLedger().writeGateDecision("email-agent", "no-external-recipients", {
      allowed: false,
    });
    expect(entry.payload).toEqual({
      [PRIMITIVE_NAME_KEY]: "no-external-recipients",
      [GATE_ALLOWED_KEY]: false,
      [RULES_VERSION_KEY]: ASSURANCE_RULES_VERSION,
      [DRIFT_DETECTED_KEY]: true,
    });
  });

  it("refuses an allowed that contradicts the estimate", async () => {
    const ledger = newLedger();
    await expect(
      ledger.writeGateDecision("a", "refund", {
        allowed: true,
        estimate: new GammaEstimate({ gammaHat: 0.5 }),
        gammaThreshold: ROBUST_GAMMA_DEFAULT_THRESHOLD,
      })
    ).rejects.toThrow(/contradicts/);
    expect(await ledger.store.lastEntry()).toBeNull();
  });

  it.each([
    ["", { allowed: true }, /primitiveName/],
    ["g", { estimate: new GammaEstimate({ gammaHat: 2.0 }) }, /gammaThreshold/],
    ["g", { gammaThreshold: 1.1, allowed: true }, /without an estimate/],
    ["g", {}, /allowed=true\/false/],
  ])("refuses an incomplete record (%s, %o)", async (name, options, message) => {
    await expect(newLedger().writeGateDecision("a", name, options)).rejects.toThrow(message);
  });

  it("never lets extraPayload overwrite the record", async () => {
    const entry = await newLedger().writeGateDecision("a", "refund", {
      estimate: new GammaEstimate({ gammaHat: 0.5 }),
      gammaThreshold: ROBUST_GAMMA_DEFAULT_THRESHOLD,
      extraPayload: {
        order_id: "o-7",
        [GATE_ALLOWED_KEY]: true,
        [DRIFT_DETECTED_KEY]: false,
        [PRIMITIVE_NAME_KEY]: "other",
        [RULES_VERSION_KEY]: "1999.01",
        gamma_hat: 9.0,
      },
    });
    expect(entry.payload["order_id"]).toBe("o-7");
    expect(entry.payload[GATE_ALLOWED_KEY]).toBe(false);
    expect(entry.payload[DRIFT_DETECTED_KEY]).toBe(true);
    expect(entry.payload[PRIMITIVE_NAME_KEY]).toBe("refund");
    expect(entry.payload[RULES_VERSION_KEY]).toBe(ASSURANCE_RULES_VERSION);
    expect(entry.payload["gamma_hat"]).toBe(0.5);
  });

  it("round-trips through a persistent store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vsl-gate-"));
    try {
      const path = join(dir, "ledger.jsonl");
      await new VerbaLedger(new JsonlLedgerStore(path)).writeGateDecision("a", "refund", {
        estimate: new GammaEstimate({ gammaHat: 2.0 }),
        gammaThreshold: ROBUST_GAMMA_DEFAULT_THRESHOLD,
      });
      const reopened = new VerbaLedger(new JsonlLedgerStore(path));
      expect((await reopened.store.lastEntry())?.payload[GATE_ALLOWED_KEY]).toBe(true);
      expect(await reopened.verifyIntegrity()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ASSURANCE_RULES_VERSION", () => {
  it("is exported and matches the Python package", () => {
    expect(vsl.ASSURANCE_RULES_VERSION).toBe("2026.10");
  });

  it("ledger.ts still never imports metrics", () => {
    const source = readFileSync(new URL("../src/ledger.ts", import.meta.url), "utf-8");
    const localImports = [...source.matchAll(/from "\.\/([^"]+)"/g)].map((m) => m[1]).sort();
    expect(localImports).toEqual(["exceptions.js", "rules_version.js"]);
  });
});
