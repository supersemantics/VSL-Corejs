/**
 * Layer 4 Governance Authority / Human-Authorised Transition / escalation /
 * Policy-as-Code (Proofing, Binding, Specification).
 *
 * Port of vsl_core/governance.py.
 */

import { createHash } from "node:crypto";
import { Invariant, PreNode, TerminalState } from "./constructs.js";
import { Evidence, Instance } from "./identity.js";

export interface GovernanceAuthorityInit {
  name: string;
  escalationContact: string;
  secondaryAuthorities?: readonly string[];
  responseTimeSlaSeconds?: number | null;
}

/**
 * A defined role/body authorised to approve rule changes, exceptions,
 * Human-Authorised Transitions, and Specification Updates. Must be named
 * per escalation pathway, with secondary authorities and defined response
 * times.
 */
export class GovernanceAuthority {
  readonly name: string;
  readonly escalationContact: string;
  readonly secondaryAuthorities: readonly string[];
  readonly responseTimeSlaSeconds: number | null;

  constructor(init: GovernanceAuthorityInit) {
    this.name = init.name;
    this.escalationContact = init.escalationContact;
    this.secondaryAuthorities = init.secondaryAuthorities ?? [];
    this.responseTimeSlaSeconds = init.responseTimeSlaSeconds ?? null;
  }
}

export interface HumanAuthorisedTransitionInit {
  authority: GovernanceAuthority;
  authorisedBy: string;
  evidence: readonly string[];
  timestamp?: number;
  authorisationEvidenceHash?: string;
}

/**
 * A transition requiring explicit, auditable human approval from the
 * Governance Authority. The only sanctioned way out of a Terminal State --
 * no timeout, no default-approve, no automatic retry-after-N-seconds.
 *
 * Construct via `authorise()`, not the bare constructor, wherever possible
 * -- authorise() is the one path that ties this record to a real Evidence
 * object rather than an arbitrary evidence array.
 */
export class HumanAuthorisedTransition {
  readonly authority: GovernanceAuthority;
  readonly authorisedBy: string;
  readonly evidence: readonly string[];
  readonly timestamp: number;
  readonly authorisationEvidenceHash: string;

  constructor(init: HumanAuthorisedTransitionInit) {
    if (!init.authorisedBy.trim()) {
      throw new Error("authorisedBy must name a real, non-empty human approver.");
    }
    this.authority = init.authority;
    this.authorisedBy = init.authorisedBy;
    this.evidence = init.evidence;
    this.timestamp = init.timestamp ?? Date.now() / 1000;
    if (init.authorisationEvidenceHash) {
      this.authorisationEvidenceHash = init.authorisationEvidenceHash;
    } else {
      const blob = init.evidence.join("|");
      this.authorisationEvidenceHash = createHash("sha256").update(blob, "utf-8").digest("hex");
    }
  }

  /**
   * The one sanctioned way to produce a HumanAuthorisedTransition: from a
   * real GovernanceAuthority, a named human approver, and a validated
   * Evidence object (rootCauseAnalysis + specificationUpdateProposal,
   * both already checked non-empty by Evidence's constructor).
   */
  static authorise(authority: GovernanceAuthority, authorisedBy: string, evidence: Evidence): HumanAuthorisedTransition {
    return new HumanAuthorisedTransition({
      authority,
      authorisedBy,
      evidence: [evidence.rootCauseAnalysis, evidence.specificationUpdateProposal],
    });
  }
}

/**
 * The sanctioned path out of a Terminal State: produces a new, re-enabled
 * Instance AND the HumanAuthorisedTransition record that authorises it,
 * together, so a caller cannot obtain one without the other.
 *
 * Routes through HumanAuthorisedTransition.authorise() (real
 * GovernanceAuthority + named human approver + validated Evidence) and
 * Instance._reEnable() (mechanism). Both entries -- RE_ENABLEMENT for the
 * new Instance, HUMAN_AUTHORISED_TRANSITION for the authorisation record
 * -- are what a caller should then write to a VerbaLedger.
 *
 * This is a convenience/policy wrapper, not a language-enforced gate:
 * Instance._reEnable() remains directly callable on its own (see its
 * docstring, and the leading underscore signalling it isn't the
 * sanctioned entry point).
 */
export function requestReEnablement(
  instance: Instance,
  authority: GovernanceAuthority,
  authorisedBy: string,
  evidence: Evidence
): [Instance, HumanAuthorisedTransition] {
  const transition = HumanAuthorisedTransition.authorise(authority, authorisedBy, evidence);
  const newInstance = instance._reEnable(evidence);
  return [newInstance, transition];
}

export interface ProofingInit {
  verified: boolean;
  verifiedAgainst: string;
  verifiedAt?: number;
}

/**
 * Automated verification that a claimed attribute matches an
 * authoritative record, using stable anchors. Required before a new
 * Specification version activates.
 *
 * A plain result type, not a check-runner: core doesn't know what an
 * "authoritative record" is for any given domain, the same way it doesn't
 * know how to compute a real Gamma estimate. The caller performs whatever
 * domain-specific comparison makes sense and constructs
 * `new Proofing({ verified: <result>, verifiedAgainst: "..." })`.
 */
export class Proofing {
  readonly verified: boolean;
  readonly verifiedAgainst: string;
  readonly verifiedAt: number;

  constructor(init: ProofingInit) {
    this.verified = init.verified;
    this.verifiedAgainst = init.verifiedAgainst;
    this.verifiedAt = init.verifiedAt ?? Date.now() / 1000;
  }
}

/**
 * Explicit link between a verified factor and a proven record / approved
 * escalation path, required before proceeding. Prevents Specification
 * activation without prior Proofing.
 *
 * The constructor enforces this structurally: a Binding cannot be
 * constructed at all from an unverified Proofing, not just by convention.
 */
export class Binding {
  readonly proofing: Proofing;
  readonly escalationPath: string;
  readonly boundAt: number;

  constructor(proofing: Proofing, escalationPath: string, boundAt?: number) {
    if (!proofing.verified) {
      throw new Error(
        "Cannot create a Binding from unverified Proofing -- Binding requires prior successful Proofing to have already occurred."
      );
    }
    this.proofing = proofing;
    this.escalationPath = escalationPath;
    this.boundAt = boundAt ?? Date.now() / 1000;
  }
}

export interface SpecificationInit {
  name: string;
  version: string;
  approvedBy: GovernanceAuthority;
  preNodes?: readonly PreNode[];
  invariants?: readonly Invariant[];
  terminalStates?: readonly TerminalState[];
  binding?: Binding | null;
  activatedAt?: number | null;
}

/**
 * Policy-as-Code: a deterministic, versioned, machine-readable bundle of
 * PreNodes/Invariants/TerminalStates. Per Design Principle P5, a new
 * version requires Proofing and GOV approval before activation.
 *
 * approvedBy is required at construction -- a Specification with no named
 * approving authority can't be represented at all. binding starts unset
 * (a Specification can be drafted before it's proofed) and is attached via
 * withBinding() once Proofing has succeeded; activate() then refuses to
 * proceed without one.
 */
export class Specification {
  readonly name: string;
  readonly version: string;
  readonly approvedBy: GovernanceAuthority;
  readonly preNodes: readonly PreNode[];
  readonly invariants: readonly Invariant[];
  readonly terminalStates: readonly TerminalState[];
  readonly binding: Binding | null;
  readonly activatedAt: number | null;

  constructor(init: SpecificationInit) {
    this.name = init.name;
    this.version = init.version;
    this.approvedBy = init.approvedBy;
    this.preNodes = init.preNodes ?? [];
    this.invariants = init.invariants ?? [];
    this.terminalStates = init.terminalStates ?? [];
    this.binding = init.binding ?? null;
    this.activatedAt = init.activatedAt ?? null;
  }

  private toInit(): SpecificationInit {
    return {
      name: this.name,
      version: this.version,
      approvedBy: this.approvedBy,
      preNodes: this.preNodes,
      invariants: this.invariants,
      terminalStates: this.terminalStates,
      binding: this.binding,
      activatedAt: this.activatedAt,
    };
  }

  /**
   * Return a new Specification with `binding` attached. Since Binding's
   * constructor already refuses to exist without verified Proofing, a
   * Specification can never reach activate() without a real, successful
   * Proofing behind it.
   */
  withBinding(binding: Binding): Specification {
    return new Specification({ ...this.toInit(), binding });
  }

  /**
   * Return a new, activated Specification. Throws if already active, or
   * if no Binding has been attached yet -- this is the structural
   * enforcement of P5 ("New versions require Proofing and GOV approval
   * before activation"): approvedBy is already required at construction,
   * and binding transitively requires a verified Proofing.
   */
  activate(): Specification {
    if (this.activatedAt !== null) {
      throw new Error(`Specification "${this.name}" v${this.version} is already active as of ${this.activatedAt}.`);
    }
    if (this.binding === null) {
      throw new Error(
        `Cannot activate Specification "${this.name}" v${this.version} without a Binding (which itself requires prior successful Proofing).`
      );
    }
    return new Specification({ ...this.toInit(), activatedAt: Date.now() / 1000 });
  }
}
