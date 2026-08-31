/**
 * Exception hierarchy for vsl-core. Zero runtime dependencies -- the root
 * of the package's import graph, and stays that way on purpose.
 *
 * Port of vsl_core/exceptions.py.
 */

/** Root of every error thrown by vsl-core. */
export class VSLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VSLError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AutomationDeniedExceptionInit {
  reason: string;
  identityKey: string;
  instanceId?: string | null;
  timestamp?: number;
}

/**
 * Thrown when a Fallback is exhausted or a Terminal State is entered.
 *
 * The source specification describes this as an exception that "cannot be
 * silently caught." That is a convention, not a language-enforced
 * guarantee: nothing in JS/TS prevents `catch {}`. The guarantee this
 * class actually provides is narrower and real: it is a distinctive,
 * purpose-built type never reused for anything else, so a blanket handler
 * that swallows it is conspicuous in code review.
 */
export class AutomationDeniedException extends VSLError {
  readonly reason: string;
  readonly identityKey: string;
  readonly instanceId: string | null;
  readonly timestamp: number;

  constructor(init: AutomationDeniedExceptionInit) {
    super(init.reason);
    this.name = "AutomationDeniedException";
    this.reason = init.reason;
    this.identityKey = init.identityKey;
    this.instanceId = init.instanceId ?? null;
    this.timestamp = init.timestamp ?? Date.now() / 1000;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  override toString(): string {
    return `${this.reason} (identityKey=${JSON.stringify(this.identityKey)})`;
  }
}

export interface InvariantViolationInit extends AutomationDeniedExceptionInit {
  invariantName?: string;
  terminalStateName?: string | null;
}

/**
 * Thrown when an Invariant's rule returns false.
 *
 * Subclasses AutomationDeniedException (not a sibling) so a generic
 * `catch (e) { if (e instanceof AutomationDeniedException) }` still catches
 * this, while callers that need to distinguish "no Fallback path, straight
 * to Terminal" (the Invariant case) from an ordinary Pre-Node Fallback
 * exhaustion can check `instanceof InvariantViolation` specifically.
 *
 * terminalStateName records the name of the TerminalState this violation
 * entered, when Invariant.onViolation was set -- a plain string, not the
 * real TerminalState object, for the same reason a LedgerEntry's
 * identityKey is a plain string: it keeps this module dependency-free.
 * null means either onViolation was unset, or the raising adapter didn't
 * populate this field.
 */
export class InvariantViolation extends AutomationDeniedException {
  readonly invariantName: string;
  readonly terminalStateName: string | null;

  constructor(init: InvariantViolationInit) {
    super(init);
    this.name = "InvariantViolation";
    this.invariantName = init.invariantName ?? "";
    this.terminalStateName = init.terminalStateName ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by VerbaLedger.write() when an operation assumes an intact chain
 * that the ledger can already tell is broken (e.g. appending to a store
 * whose last entry's hash doesn't match its own prevHash pointer).
 *
 * Distinct from VerbaLedger.verifyIntegrity(), which never throws -- it
 * returns a boolean, so a caller can inspect a chain already known (or
 * suspected) to be tampered with, without an exception interrupting the
 * audit.
 */
export class LedgerIntegrityError extends VSLError {
  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown only for structural catalog-loading errors: malformed JSON, a
 * missing required key, a file that doesn't parse.
 *
 * Never thrown for the catalog's known, expected data-quality findings --
 * those are surfaced as strings, on purpose, so they can be inspected
 * rather than thrown past.
 */
export class CatalogValidationError extends VSLError {
  constructor(message: string) {
    super(message);
    this.name = "CatalogValidationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by runConformanceSuite() only when an adapter's own programming
 * error prevents the suite from running at all (e.g. compilePreNode
 * returning something uncallable instead of a compiled gate).
 *
 * Ordinary conformance failures -- an adapter that runs but behaves
 * incorrectly -- are reported as strings in the suite's returned array,
 * never thrown, so a partially-conformant adapter can still be fully
 * inspected in one pass.
 */
export class ConformanceError extends VSLError {
  constructor(message: string) {
    super(message);
    this.name = "ConformanceError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
