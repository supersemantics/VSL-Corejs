/**
 * The VERBA Ledger: an immutable, append-only, hash-chained audit log.
 *
 * Port of vsl_core/ledger.py, with one deliberate design departure: the
 * LedgerStore interface here is async (Promise/AsyncIterable-returning),
 * where Python's is fully synchronous. This isn't a 1:1 translation
 * choice -- it's forward-looking: a future HTTP-backed RemoteLedgerStore
 * for this package cannot be synchronous in JS (there is no synchronous
 * fetch), so making every LedgerStore implementation async from the start
 * -- including the in-memory/file ones below, even though neither strictly
 * needs it -- keeps the interface uniform rather than breaking it later.
 *
 * Entry-type count note, carried over from the Python source: the source
 * spec's prose says the Ledger has "six entry types" but then enumerates
 * seven. This is a stale-count bug in the source document itself. All
 * seven are implemented here; the enumerated list is trusted over the
 * prose summary count.
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { LedgerIntegrityError } from "./exceptions.js";
import { ASSURANCE_RULES_VERSION } from "./rules_version.js";

export const GENESIS_HASH = "0".repeat(64);

/**
 * The current shape/version of LedgerEntry's recorded fields. Bump this
 * whenever a field is added, removed, or reinterpreted, so an entry is
 * self-describing about which format it was written under rather than
 * leaving a reader to guess from which fields happen to be present.
 * Entries persisted before this field existed load with
 * schemaVersion=null (see LedgerEntry.fromDict) -- that absence is itself
 * meaningful, not a bug.
 */
export const LEDGER_SCHEMA_VERSION = "1.0";

/** The Ledger's entry types (seven -- see module docstring). */
export enum LedgerEntryType {
  MONITOR = "MONITOR",
  PRE_NODE = "PRE_NODE",
  VERIFICATION = "VERIFICATION",
  TERMINAL = "TERMINAL",
  SPECIFICATION_UPDATE = "SPECIFICATION_UPDATE",
  HUMAN_AUTHORISED_TRANSITION = "HUMAN_AUTHORISED_TRANSITION",
  RE_ENABLEMENT = "RE_ENABLEMENT",
}

// Bare module-level aliases, exported alongside the enum, matching the
// Python source's `HUMAN_AUTHORISED_TRANSITION`/`RE_ENABLEMENT` module
// constants -- governance.ts's Python counterpart relies on this exact
// import shape (`from .ledger import HUMAN_AUTHORISED_TRANSITION,
// RE_ENABLEMENT`); kept here for API parity even though governance.ts
// itself doesn't currently need them (it never writes to the ledger).
export const HUMAN_AUTHORISED_TRANSITION = LedgerEntryType.HUMAN_AUTHORISED_TRANSITION;
export const RE_ENABLEMENT = LedgerEntryType.RE_ENABLEMENT;

// Named payload keys for the two ledger checks that would otherwise read
// magic, unexported string literals out of an untyped payload object.
// Without a canonical spelling, a client writing payload={ drift: true }
// instead of payload={ drift_detected: true } would silently never trip
// the check -- no error, just quietly wrong.
export const DRIFT_DETECTED_KEY = "drift_detected";
export const VERIFICATION_RESULT_KEY = "result";

/**
 * Named payload keys of a gate-decision record (VerbaLedger.writeGateDecision).
 * Identical to the Python package's spellings, so records from either can be
 * read and compared the same way.
 */
export const PRIMITIVE_NAME_KEY = "primitive_name";
export const GATE_ALLOWED_KEY = "allowed";
export const RULES_VERSION_KEY = "rules_version";

/**
 * What writeGateDecision reads from a Gamma estimate. A GammaEstimate
 * satisfies it; declared structurally so this module never imports metrics.
 */
export interface GateEstimate {
  readonly gammaHat: number;
  readonly deltaEstimationError: number;
  robustGamma(): number;
  requiredGammaHat(threshold: number): number;
  sufficient(threshold: number): boolean;
}

export interface GateDecisionOptions extends Omit<WriteOptions, "payload"> {
  /** Required for an Invariant; computed (and checked, if given) for a PreNode. */
  allowed?: boolean;
  /** The PreNode monitor's GammaEstimate. */
  estimate?: GateEstimate;
  /** The PreNode's gammaThreshold; required with estimate. */
  gammaThreshold?: number;
  extraPayload?: Record<string, unknown>;
}

/**
 * The two outcomes a VERIFICATION ledger entry's result can carry. Used
 * with VERIFICATION_RESULT_KEY / VerbaLedger.writeVerification().
 */
export enum VerificationResult {
  SUFFICIENT = "SUFFICIENT",
  INSUFFICIENT = "INSUFFICIENT",
}

export interface LedgerEntryInit {
  entryType: LedgerEntryType;
  identityKey: string;
  clusterKey?: string | null;
  instanceId?: string | null;
  decisionId?: string | null;
  causedBy?: string | null;
  schemaVersion?: string | null;
  payload?: Record<string, unknown>;
  timestamp?: number;
  entryId?: string;
  sequence?: number;
  prevHash?: string;
  entryHash?: string;
}

/**
 * One entry in the hash chain.
 *
 * identityKey/clusterKey are plain strings, not identity.ts objects --
 * deliberate, matching the Python source: it keeps this module's only
 * dependency at exceptions.ts, so the Ledger subtree can be vendored or
 * reused on its own without pulling in the rest of the package's object
 * graph.
 *
 * sequence, prevHash, and entryHash are populated by a LedgerStore's
 * append() method, not by the caller -- a caller cannot lie about an
 * entry's position in the chain. Until sealed by a store, a freshly
 * constructed LedgerEntry has sequence=-1 and empty hashes.
 *
 * decisionId/causedBy are optional causal-correlation fields, not part of
 * the source spec. Without them, audit()'s cross-referencing checks can
 * only match entries by "same identityKey/instanceId and a later
 * timestamp" -- which silently mismatches when a single Instance has more
 * than one decision in flight at once. causedBy lets an entry name the
 * exact prior entryId it resolves, so audit() can match causally instead
 * of guessing from timing; decisionId is purely descriptive grouping
 * metadata and is not itself read by any audit check.
 *
 * schemaVersion records which shape of LedgerEntry wrote this entry (see
 * LEDGER_SCHEMA_VERSION). It defaults to null deliberately --
 * VerbaLedger.write() is what stamps the current constant onto every
 * entry it constructs; a bare `new LedgerEntry(...)` (e.g. in a test, or
 * via fromDict() reconstructing a legacy entry with no recorded version)
 * should not silently claim a version it wasn't actually written under.
 */
export class LedgerEntry {
  readonly entryType: LedgerEntryType;
  readonly identityKey: string;
  readonly clusterKey: string | null;
  readonly instanceId: string | null;
  readonly decisionId: string | null;
  readonly causedBy: string | null;
  readonly schemaVersion: string | null;
  readonly payload: Record<string, unknown>;
  readonly timestamp: number;
  readonly entryId: string;
  readonly sequence: number;
  readonly prevHash: string;
  readonly entryHash: string;

  constructor(init: LedgerEntryInit) {
    this.entryType = init.entryType;
    this.identityKey = init.identityKey;
    this.clusterKey = init.clusterKey ?? null;
    this.instanceId = init.instanceId ?? null;
    this.decisionId = init.decisionId ?? null;
    this.causedBy = init.causedBy ?? null;
    this.schemaVersion = init.schemaVersion ?? null;
    this.payload = init.payload ?? {};
    this.timestamp = init.timestamp ?? Date.now() / 1000;
    this.entryId = init.entryId && init.entryId.length > 0 ? init.entryId : randomUUID();
    this.sequence = init.sequence ?? -1;
    this.prevHash = init.prevHash ?? "";
    this.entryHash = init.entryHash ?? "";
  }

  /** Return a copy of this entry with the given fields overridden -- TS's equivalent of Python's dataclasses.replace(). */
  withFields(overrides: Partial<LedgerEntryInit>): LedgerEntry {
    return new LedgerEntry({ ...this.toInit(), ...overrides });
  }

  private toInit(): LedgerEntryInit {
    return {
      entryType: this.entryType,
      identityKey: this.identityKey,
      clusterKey: this.clusterKey,
      instanceId: this.instanceId,
      decisionId: this.decisionId,
      causedBy: this.causedBy,
      schemaVersion: this.schemaVersion,
      payload: this.payload,
      timestamp: this.timestamp,
      entryId: this.entryId,
      sequence: this.sequence,
      prevHash: this.prevHash,
      entryHash: this.entryHash,
    };
  }

  toDict(): Record<string, unknown> {
    return {
      entry_id: this.entryId,
      sequence: this.sequence,
      entry_type: this.entryType,
      identity_key: this.identityKey,
      cluster_key: this.clusterKey,
      instance_id: this.instanceId,
      decision_id: this.decisionId,
      caused_by: this.causedBy,
      schema_version: this.schemaVersion,
      payload: this.payload,
      timestamp: this.timestamp,
      prev_hash: this.prevHash,
      entry_hash: this.entryHash,
    };
  }

  /**
   * Reconstruct an entry from its serialized form.
   *
   * Deliberately does NOT recompute/verify entryHash -- a store must be
   * able to load and inspect a corrupted chain in order to diagnose it.
   * Recomputation-and-comparison is verifyIntegrity()'s job, not this
   * constructor's.
   */
  static fromDict(data: Record<string, unknown>): LedgerEntry {
    return new LedgerEntry({
      entryType: data["entry_type"] as LedgerEntryType,
      identityKey: data["identity_key"] as string,
      clusterKey: (data["cluster_key"] as string | null | undefined) ?? null,
      instanceId: (data["instance_id"] as string | null | undefined) ?? null,
      decisionId: (data["decision_id"] as string | null | undefined) ?? null,
      causedBy: (data["caused_by"] as string | null | undefined) ?? null,
      schemaVersion: (data["schema_version"] as string | null | undefined) ?? null,
      payload: (data["payload"] as Record<string, unknown> | undefined) ?? {},
      timestamp: data["timestamp"] as number,
      entryId: data["entry_id"] as string,
      sequence: data["sequence"] as number,
      prevHash: data["prev_hash"] as string,
      entryHash: data["entry_hash"] as string,
    });
  }
}

/**
 * Deterministic, recursive key-sorted JSON serialization matching
 * Python's `json.dumps(obj, sort_keys=True, separators=(",", ":"))`.
 * `JSON.stringify` does not sort object keys, so a hand-rolled canonical
 * serializer is required for hashing to be deterministic regardless of
 * property insertion order. This does not aim for byte-identical output
 * with vsl-core's Python hashes -- that's not a goal for this package;
 * each language implementation only needs to be internally
 * self-consistent.
 */
function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalJsonStringify((value as Record<string, unknown>)[k])}`
    );
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`Cannot canonically serialize value of type ${typeof value}`);
}

/**
 * Deterministic hash over every field of `entry` except entryHash itself.
 * Canonical (sorted-key, fixed-separator) JSON serialization guarantees
 * the same logical entry always hashes identically, so a single-field
 * change -- in memory or on disk -- changes this hash.
 */
function computeEntryHash(entry: LedgerEntry): string {
  const canonical = {
    entry_id: entry.entryId,
    sequence: entry.sequence,
    entry_type: entry.entryType,
    identity_key: entry.identityKey,
    cluster_key: entry.clusterKey,
    instance_id: entry.instanceId,
    decision_id: entry.decisionId,
    caused_by: entry.causedBy,
    schema_version: entry.schemaVersion,
    payload: entry.payload,
    timestamp: entry.timestamp,
    prev_hash: entry.prevHash,
  };
  const blob = canonicalJsonStringify(canonical);
  return createHash("sha256").update(blob, "utf-8").digest("hex");
}

/**
 * True if `candidate` counts as resolving `source` in an audit check.
 *
 * If `candidate.causedBy` is set, it must reference `source.entryId`
 * exactly -- an explicit causal claim is authoritative and overrides the
 * fallback heuristic below, even when timestamps/identity/instance would
 * otherwise coincidentally match a *different*, unrelated entry.
 *
 * If `candidate.causedBy` is unset, falls back to the pre-existing
 * timestamp + identityKey (+ instanceId, when checkInstance) heuristic, so
 * callers that don't populate the causal fields see unchanged behavior.
 */
function causallyResolves(candidate: LedgerEntry, source: LedgerEntry, checkInstance: boolean): boolean {
  if (candidate.causedBy !== null) {
    return candidate.causedBy === source.entryId;
  }
  if (candidate.timestamp < source.timestamp) {
    return false;
  }
  if (candidate.identityKey !== source.identityKey) {
    return false;
  }
  if (checkInstance && candidate.instanceId !== source.instanceId) {
    return false;
  }
  return true;
}

/** Assign chain position and compute the entry's hash. Used by every LedgerStore implementation's append() so sealing logic exists exactly once. */
function seal(entry: LedgerEntry, sequence: number, prevHash: string): LedgerEntry {
  const positioned = entry.withFields({ sequence, prevHash });
  return positioned.withFields({ entryHash: computeEntryHash(positioned) });
}

/**
 * What a LedgerStore implementation must provide. Async throughout --
 * see the module docstring for why this diverges from Python's
 * synchronous Protocol.
 */
export interface LedgerStore {
  append(entry: LedgerEntry): Promise<LedgerEntry>;
  allEntries(): AsyncIterable<LedgerEntry>;
  entriesForIdentity(identityKey: string): AsyncIterable<LedgerEntry>;
  lastEntry(): Promise<LedgerEntry | null>;
}

/** Backing store for tests and short-lived scripts. In-process only -- no persistence, no cross-process concerns. */
export class InMemoryLedgerStore implements LedgerStore {
  private entries: LedgerEntry[] = [];
  // A promise chain acting as an async mutex: JS has no threads, but
  // `await` points inside append() (none currently, kept for symmetry
  // with JsonlLedgerStore and future stores) mean two concurrent callers
  // could otherwise interleave. Cheap to keep even where not strictly
  // needed.
  private queue: Promise<unknown> = Promise.resolve();

  private runExclusive<T>(fn: () => T): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    return this.runExclusive(() => {
      const last = this.entries.length > 0 ? this.entries[this.entries.length - 1]! : null;
      const sequence = last === null ? 0 : last.sequence + 1;
      const prevHash = last === null ? GENESIS_HASH : last.entryHash;
      const sealed = seal(entry, sequence, prevHash);
      this.entries.push(sealed);
      return sealed;
    });
  }

  async *allEntries(): AsyncIterable<LedgerEntry> {
    const snapshot = [...this.entries];
    for (const entry of snapshot) {
      yield entry;
    }
  }

  async *entriesForIdentity(identityKey: string): AsyncIterable<LedgerEntry> {
    for await (const entry of this.allEntries()) {
      if (entry.identityKey === identityKey) {
        yield entry;
      }
    }
  }

  async lastEntry(): Promise<LedgerEntry | null> {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1]! : null;
  }
}

export interface JsonlLedgerStoreOptions {
  fsync?: boolean;
}

/**
 * One JSON object per line, true append-only file writes, never
 * rewrite-in-place. This is what makes tamper detection meaningful: a
 * tamper test reaches into the actual file bytes on disk, not through
 * this store's own API.
 *
 * Reading does not recompute/verify hashes -- see LedgerEntry.fromDict.
 *
 * fsync defaults to false for test speed; production use should pass
 * fsync: true so a write survives a crash immediately after it returns.
 *
 * Cross-process safety gap, disclosed rather than silently omitted:
 * Python's JsonlLedgerStore holds a real OS-level advisory lock
 * (fcntl.flock / msvcrt.locking) across its whole read-last-entry-then-
 * write critical section, closing the race between two separate store
 * instances -- in one process or several -- writing to the same file.
 * Node's standard library has no equivalent cross-process file-locking
 * primitive. This class only serializes writers *within the same Node
 * process* (via an internal async-mutex queue, necessary because
 * fs/promises I/O is non-blocking and concurrent awaited appends could
 * otherwise interleave). It does NOT protect against two separate Node
 * processes (or two separate machines) appending to the same file
 * concurrently -- that can still corrupt the sequence/hash chain. Do not
 * point multiple processes at the same JsonlLedgerStore file until this
 * gap is closed (e.g. via an added dependency for real cross-process
 * locking, which would need a conscious tradeoff against this package's
 * zero-dependency guarantee).
 */
export class JsonlLedgerStore implements LedgerStore {
  readonly path: string;
  readonly fsync: boolean;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(path: string, options: JsonlLedgerStoreOptions = {}) {
    this.path = path;
    this.fsync = options.fsync ?? false;
    if (!fs.existsSync(this.path)) {
      fs.writeFileSync(this.path, "");
    }
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async *allEntries(): AsyncIterable<LedgerEntry> {
    const text = await fsp.readFile(this.path, "utf-8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      yield LedgerEntry.fromDict(JSON.parse(line));
    }
  }

  async *entriesForIdentity(identityKey: string): AsyncIterable<LedgerEntry> {
    for await (const entry of this.allEntries()) {
      if (entry.identityKey === identityKey) {
        yield entry;
      }
    }
  }

  async lastEntry(): Promise<LedgerEntry | null> {
    let last: LedgerEntry | null = null;
    for await (const entry of this.allEntries()) {
      last = entry;
    }
    return last;
  }

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    return this.runExclusive(async () => {
      const last = await this.lastEntry();
      const sequence = last === null ? 0 : last.sequence + 1;
      const prevHash = last === null ? GENESIS_HASH : last.entryHash;
      const sealed = seal(entry, sequence, prevHash);
      // Plain JSON.stringify, no replacer array: JSON.stringify(obj, arrayOfKeys)
      // filters recursively at EVERY nesting level against that same array, not
      // just the top level -- an earlier version of this line passed the
      // top-level field names as the replacer to sort them for file
      // readability, which silently zeroed out `payload`'s own nested keys
      // (they aren't in that array) on every write. Key order in the stored
      // JSON is cosmetic only; correctness matters, sorting doesn't.
      const line = JSON.stringify(sealed.toDict()) + "\n";
      const handle = await fsp.open(this.path, "a");
      try {
        await handle.write(line, null, "utf-8");
        if (this.fsync) {
          await handle.sync();
        }
      } finally {
        await handle.close();
      }
      return sealed;
    });
  }
}

/** Result of VerbaLedger.audit(): which of the spec's five checks passed/failed, and which specific entries violated a failed check. */
export class LedgerAuditReport {
  readonly checksPassed: readonly string[];
  readonly checksFailed: readonly string[];
  readonly violations: Readonly<Record<string, readonly string[]>>;

  constructor(
    checksPassed: readonly string[],
    checksFailed: readonly string[],
    violations: Readonly<Record<string, readonly string[]>>
  ) {
    this.checksPassed = checksPassed;
    this.checksFailed = checksFailed;
    this.violations = violations;
  }

  get allPassed(): boolean {
    return this.checksFailed.length === 0;
  }
}

/**
 * The chain's current tip: just enough for an external party to
 * independently witness that the chain hasn't been rolled back or
 * replaced wholesale, without vsl-core itself doing any anchoring,
 * signing, or networking.
 */
export class LedgerCheckpoint {
  readonly sequence: number;
  readonly entryHash: string;
  readonly checkedAt: number;

  constructor(sequence: number, entryHash: string, checkedAt: number) {
    this.sequence = sequence;
    this.entryHash = entryHash;
    this.checkedAt = checkedAt;
  }
}

export interface VerbaCertificateInit {
  issuedAt: number;
  periodStart: number;
  periodEnd: number;
  entriesCovered: number;
  auditReport: LedgerAuditReport;
  certificateHash?: string;
}

/**
 * An audit outcome confirming all five Ledger checks pass for a period.
 * Certifies the governance PROCESS, not the underlying system -- see
 * NOTE, which is deliberately surfaced in toString() so it cannot be
 * missed in logs.
 */
export class VerbaCertificate {
  static readonly NOTE =
    "This certificate does not guarantee no Inadmissible State was ever " +
    "reached. It certifies that every detected Drift event was addressed, " +
    "Terminal States were properly escalated, and governance was " +
    "continuously monitored -- it certifies the governance process, not " +
    "the underlying system, model, or domain.";

  readonly issuedAt: number;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly entriesCovered: number;
  readonly auditReport: LedgerAuditReport;
  readonly certificateHash: string;

  constructor(init: VerbaCertificateInit) {
    this.issuedAt = init.issuedAt;
    this.periodStart = init.periodStart;
    this.periodEnd = init.periodEnd;
    this.entriesCovered = init.entriesCovered;
    this.auditReport = init.auditReport;
    if (init.certificateHash) {
      this.certificateHash = init.certificateHash;
    } else {
      const blob = canonicalJsonStringify({
        issued_at: this.issuedAt,
        period_start: this.periodStart,
        period_end: this.periodEnd,
        entries_covered: this.entriesCovered,
        checks_passed: [...this.auditReport.checksPassed],
        checks_failed: [...this.auditReport.checksFailed],
      });
      this.certificateHash = createHash("sha256").update(blob, "utf-8").digest("hex");
    }
  }

  toString(): string {
    return `VerbaCertificate(entriesCovered=${this.entriesCovered}, allPassed=${this.auditReport.allPassed}) -- ${VerbaCertificate.NOTE}`;
  }
}

const AUDIT_CHECKS: readonly string[] = [
  "no_monitoring_gaps",
  "drift_flagged_monitor_has_pre_node",
  "pre_node_has_verification",
  "insufficient_verification_has_specification_update",
  "terminal_has_human_authorised_transition",
];

export interface WriteOptions {
  clusterKey?: string | null;
  instanceId?: string | null;
  decisionId?: string | null;
  causedBy?: string | null;
  payload?: Record<string, unknown>;
}

/** Façade over a LedgerStore implementing write/verifyIntegrity/audit. */
export class VerbaLedger {
  readonly store: LedgerStore;

  constructor(store?: LedgerStore) {
    this.store = store ?? new InMemoryLedgerStore();
  }

  async write(entryType: LedgerEntryType, identityKey: string, options: WriteOptions = {}): Promise<LedgerEntry> {
    const last = await this.store.lastEntry();
    if (last !== null && computeEntryHash(last) !== last.entryHash) {
      throw new LedgerIntegrityError(
        "Refusing to append: the ledger's last entry fails its own hash check, " +
          "indicating the existing chain has already been tampered with. Diagnose " +
          "with verifyIntegrity()/audit() before writing further entries."
      );
    }
    const draft = new LedgerEntry({
      entryType,
      identityKey,
      clusterKey: options.clusterKey,
      instanceId: options.instanceId,
      decisionId: options.decisionId,
      causedBy: options.causedBy,
      schemaVersion: LEDGER_SCHEMA_VERSION,
      payload: options.payload ?? {},
    });
    return this.store.append(draft);
  }

  /**
   * Write a MONITOR entry with a correctly-keyed drift_detected payload
   * field, so a caller never needs to know DRIFT_DETECTED_KEY directly.
   * The load-bearing key is merged in last so extraPayload can never
   * silently clobber it.
   */
  async writeMonitor(
    identityKey: string,
    driftDetected: boolean,
    options: WriteOptions & { extraPayload?: Record<string, unknown> } = {}
  ): Promise<LedgerEntry> {
    const payload = { ...(options.extraPayload ?? {}), [DRIFT_DETECTED_KEY]: driftDetected };
    return this.write(LedgerEntryType.MONITOR, identityKey, { ...options, payload });
  }

  /** Write a VERIFICATION entry with a correctly-keyed result payload field, so a caller never needs to know VERIFICATION_RESULT_KEY directly. */
  async writeVerification(
    identityKey: string,
    result: VerificationResult,
    options: WriteOptions & { extraPayload?: Record<string, unknown> } = {}
  ): Promise<LedgerEntry> {
    const payload = { ...(options.extraPayload ?? {}), [VERIFICATION_RESULT_KEY]: result };
    return this.write(LedgerEntryType.VERIFICATION, identityKey, { ...options, payload });
  }

  /**
   * Write one gate's allow/deny decision as a MONITOR entry in the standard
   * gate-decision shape, so every agent records gates the same way. Port of
   * VerbaLedger.write_gate_decision; the payload keys are identical.
   *
   * `primitiveName` is the gate's declared PreNode/Invariant `name`, which is
   * what links the runtime record to the gate in the code. Pass `decisionId`
   * so a decision's gate checks and its outcome can be read back together.
   *
   * For a PreNode, pass the monitor's GammaEstimate as `estimate` and the
   * PreNode's `gammaThreshold`: `allowed` is then computed with
   * estimate.sufficient(gammaThreshold), the same check the compiled gate
   * makes, and the record carries gamma_hat, delta_estimation_error,
   * robust_gamma, gamma_threshold and required_gamma_hat. An explicit
   * `allowed` that disagrees throws rather than recording a contradiction.
   * For an Invariant (no Gamma), pass `allowed` alone.
   *
   * Every record carries `rules_version` (ASSURANCE_RULES_VERSION) and
   * `drift_detected = !allowed`. A denied gate is drift as far as audit() is
   * concerned: follow it with the decision's VERIFICATION or TERMINAL entry.
   * The record's own keys are merged last; extraPayload can never overwrite
   * them.
   */
  async writeGateDecision(
    identityKey: string,
    primitiveName: string,
    options: GateDecisionOptions = {}
  ): Promise<LedgerEntry> {
    const { allowed: givenAllowed, estimate, gammaThreshold, extraPayload, ...writeOptions } = options;
    if (typeof primitiveName !== "string" || primitiveName.trim() === "") {
      throw new Error(
        "writeGateDecision needs the gate's declared name as primitiveName; " +
          "without it the record cannot be linked to its gate."
      );
    }

    let allowed: boolean;
    let gateFields: Record<string, unknown> = {};
    if (estimate !== undefined) {
      if (gammaThreshold === undefined) {
        throw new Error(
          "writeGateDecision with an estimate needs the PreNode's gammaThreshold, " +
            "so the record shows the bar the gate actually applied."
        );
      }
      const computed = Boolean(estimate.sufficient(gammaThreshold));
      if (givenAllowed !== undefined && givenAllowed !== computed) {
        throw new Error(
          `allowed=${givenAllowed} contradicts estimate.sufficient(${gammaThreshold}) = ${computed}; ` +
            "refusing to record a gate decision that disagrees with the gate's own check."
        );
      }
      allowed = computed;
      gateFields = {
        gamma_hat: estimate.gammaHat,
        delta_estimation_error: estimate.deltaEstimationError,
        robust_gamma: estimate.robustGamma(),
        gamma_threshold: gammaThreshold,
        required_gamma_hat: estimate.requiredGammaHat(gammaThreshold),
      };
    } else if (gammaThreshold !== undefined) {
      throw new Error(
        "gammaThreshold was given without an estimate; pass the monitor's " +
          "GammaEstimate too, or neither for an Invariant."
      );
    } else if (typeof givenAllowed !== "boolean") {
      throw new Error(
        `writeGateDecision needs allowed=true/false when no estimate is given (got ${JSON.stringify(givenAllowed)}).`
      );
    } else {
      allowed = givenAllowed;
    }

    const payload = {
      ...(extraPayload ?? {}),
      ...gateFields,
      [PRIMITIVE_NAME_KEY]: primitiveName,
      [GATE_ALLOWED_KEY]: allowed,
      [RULES_VERSION_KEY]: ASSURANCE_RULES_VERSION,
      [DRIFT_DETECTED_KEY]: !allowed,
    };
    return this.write(LedgerEntryType.MONITOR, identityKey, { ...writeOptions, payload });
  }

  /**
   * Return the chain's current tip, or null for an empty ledger. This is
   * the one fact an external anchoring service would need to witness the
   * chain independently over time -- vsl-core exposes the value and stops
   * there; it does not sign, transmit, or store it anywhere itself.
   */
  async currentCheckpoint(): Promise<LedgerCheckpoint | null> {
    const last = await this.store.lastEntry();
    if (last === null) return null;
    return new LedgerCheckpoint(last.sequence, last.entryHash, Date.now() / 1000);
  }

  /**
   * Recompute every entry's hash and chain pointer. Never throws --
   * returns false for any mismatch, gap in sequence, or broken chain
   * link, so a chain already known to be suspect can still be inspected
   * (see audit()) rather than throwing past the caller.
   */
  async verifyIntegrity(): Promise<boolean> {
    let expectedPrev = GENESIS_HASH;
    let expectedSequence = 0;
    for await (const entry of this.store.allEntries()) {
      if (entry.sequence !== expectedSequence) return false;
      if (entry.prevHash !== expectedPrev) return false;
      if (computeEntryHash(entry) !== entry.entryHash) return false;
      expectedPrev = entry.entryHash;
      expectedSequence += 1;
    }
    return true;
  }

  /**
   * The spec's Section 10 five audit checks. maxMonitorGapSeconds has no
   * universal default -- required monitoring cadence varies by domain, so
   * the caller must supply a domain-appropriate value. Passing undefined
   * skips check 1 entirely (reported as passed, since no gap threshold
   * was asked for).
   *
   * Checks 2-5 match causally via `causedBy` whenever a candidate entry
   * sets it, falling back to the same-identity/instance-and-later-
   * timestamp heuristic only when it's unset.
   */
  async audit(maxMonitorGapSeconds?: number): Promise<LedgerAuditReport> {
    const entries: LedgerEntry[] = [];
    for await (const entry of this.store.allEntries()) {
      entries.push(entry);
    }
    const violations: Record<string, string[]> = {};

    const monitorEntries = entries.filter((e) => e.entryType === LedgerEntryType.MONITOR);
    if (maxMonitorGapSeconds !== undefined) {
      const sortedMonitors = [...monitorEntries].sort((a, b) => a.timestamp - b.timestamp);
      const gapViolations: string[] = [];
      for (let i = 1; i < sortedMonitors.length; i++) {
        const prev = sortedMonitors[i - 1]!;
        const curr = sortedMonitors[i]!;
        if (curr.timestamp - prev.timestamp > maxMonitorGapSeconds) {
          gapViolations.push(`${prev.entryId}->${curr.entryId}`);
        }
      }
      if (gapViolations.length > 0) {
        violations["no_monitoring_gaps"] = gapViolations;
      }
    }

    const preNodeEntries = entries.filter((e) => e.entryType === LedgerEntryType.PRE_NODE);
    const check2 = monitorEntries
      .filter(
        (m) =>
          m.payload[DRIFT_DETECTED_KEY] === true &&
          !preNodeEntries.some((pn) => causallyResolves(pn, m, true))
      )
      .map((m) => m.entryId);
    if (check2.length > 0) {
      violations["drift_flagged_monitor_has_pre_node"] = check2;
    }

    const verificationEntries = entries.filter((e) => e.entryType === LedgerEntryType.VERIFICATION);
    const check3 = preNodeEntries
      .filter((pn) => !verificationEntries.some((v) => causallyResolves(v, pn, true)))
      .map((pn) => pn.entryId);
    if (check3.length > 0) {
      violations["pre_node_has_verification"] = check3;
    }

    const specUpdateEntries = entries.filter((e) => e.entryType === LedgerEntryType.SPECIFICATION_UPDATE);
    const check4 = verificationEntries
      .filter(
        (v) =>
          v.payload[VERIFICATION_RESULT_KEY] === VerificationResult.INSUFFICIENT &&
          !specUpdateEntries.some((s) => causallyResolves(s, v, false))
      )
      .map((v) => v.entryId);
    if (check4.length > 0) {
      violations["insufficient_verification_has_specification_update"] = check4;
    }

    const terminalEntries = entries.filter((e) => e.entryType === LedgerEntryType.TERMINAL);
    const hatEntries = entries.filter((e) => e.entryType === LedgerEntryType.HUMAN_AUTHORISED_TRANSITION);
    const check5 = terminalEntries
      .filter((t) => !hatEntries.some((h) => causallyResolves(h, t, false)))
      .map((t) => t.entryId);
    if (check5.length > 0) {
      violations["terminal_has_human_authorised_transition"] = check5;
    }

    const checksFailed = AUDIT_CHECKS.filter((c) => c in violations);
    const checksPassed = AUDIT_CHECKS.filter((c) => !(c in violations));
    return new LedgerAuditReport(checksPassed, checksFailed, violations);
  }

  /** Returns a VerbaCertificate only if the audit fully passes; never fabricates a certificate for a failed audit. */
  async issueCertificate(maxMonitorGapSeconds?: number): Promise<VerbaCertificate | null> {
    const entries: LedgerEntry[] = [];
    for await (const entry of this.store.allEntries()) {
      entries.push(entry);
    }
    const report = await this.audit(maxMonitorGapSeconds);
    if (!report.allPassed) return null;
    const now = Date.now() / 1000;
    return new VerbaCertificate({
      issuedAt: now,
      periodStart: entries.length > 0 ? entries[0]!.timestamp : now,
      periodEnd: entries.length > 0 ? entries[entries.length - 1]!.timestamp : now,
      entriesCovered: entries.length,
      auditReport: report,
    });
  }
}
