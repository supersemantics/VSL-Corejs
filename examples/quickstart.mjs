// Gate a tool call in 5 lines: the README quickstart, runnable as is.
//
//   npm install @supersemantics/vsl-core
//   node quickstart.mjs

import {
  AssuranceBasis,
  F2Modification,
  Invariant,
  InvariantViolation,
  PlainJsReferenceAdapter,
} from "@supersemantics/vsl-core";

function issueRefund({ orderId, amount }) { // your existing tool, unchanged
  return `refunded $${amount} on ${orderId}`;
}

// The 5 lines: a rule, the gate built from it, and a call to the gate before the tool runs.
const withinCap = async (args) => args.amount <= 500;
const cap = new Invariant({ name: "refund-cap", description: "Refunds of $500 or less.", rule: withinCap,
  assuranceBasis: new AssuranceBasis(true, F2Modification.NONE) });
const gate = new PlainJsReferenceAdapter().compileInvariant(cap);

async function refund(args) {
  await gate(args); // throws InvariantViolation before the tool runs
  return issueRefund(args);
}

console.log(await refund({ orderId: "A100", amount: 120 }));
try {
  await refund({ orderId: "A200", amount: 9000 });
} catch (denied) {
  if (!(denied instanceof InvariantViolation)) throw denied;
  console.log(`blocked: ${denied.reason}`);
}
