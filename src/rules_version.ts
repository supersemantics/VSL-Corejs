/**
 * The version of the assurance rules this package applies. Port of
 * vsl_core/rules_version.py; the value must stay identical to the Python
 * package's so records from either can be read the same way.
 *
 * "Assurance rules" means the decisions this package makes on a caller's
 * behalf: how GammaEstimate.sufficient() judges a Gamma estimate against a
 * threshold, and how AssuranceBasis.derivedLevel turns F1/F2 into an
 * AssuranceLevel.
 *
 * The version is written into every gate-decision ledger record
 * (VerbaLedger.writeGateDecision), so a record can always be read under the
 * rules that produced it, even after a later release changes one. Bump it
 * whenever either rule changes meaning, and say what changed in CHANGELOG.md.
 *
 * Deliberately a module of its own with no imports: ledger.ts depends only on
 * exceptions.ts and this constant.
 */

export const ASSURANCE_RULES_VERSION = "2026.10";
