/**
 * Read-to-act continuity (IA-7, IA-9): the chain from what the trainer saw to
 * what actually happens.
 *
 * Every layer below this one proves something about a document. The registry
 * proves a datum, the manifest proves an answer, the affidavit proves a page.
 * None of them can prove the thing Article VII is about, which is that the act
 * being executed is the act that was shown, on that page, to that trainer, who
 * said yes to it — in that order, while their scope was still good.
 *
 * So this module holds no facts of its own. It composes: it re-runs the render
 * verification rather than trusting a verdict somebody reached earlier, and it
 * puts the confirmation and the grant beside it. That composition *is* the
 * enforcement. "Confirmed A, executed B" is not a bug to test for; it is a
 * disagreement between two recorded objects, and the disagreement has a name.
 *
 * Article IX needed no machinery here at all, which is the result worth
 * reporting. An irreversible act's consent notice is a triggered exhibit under
 * Article VI, so it is required by the manifest, rendered by the plan and
 * proved visible by the affidavit — every one of those denials already lands
 * under IA-9, because the pack rule that owes the notice cites IA-9. And the
 * consent that binds it is Article VII's, checked below. The articles compose
 * rather than multiply, exactly as the Accord says they should.
 *
 * Two decisions are worth stating because they are where a plausible design
 * would be wrong.
 *
 * 1. **The render is verified again, at action time.** An affidavit checked
 *    when the page was drawn is evidence about the page, not a licence to stop
 *    looking; the artifact is in the record, so it is read again here. Scope
 *    valid at render is not scope valid at execution either, which is why the
 *    validity window is checked a second time against the moment of execution
 *    rather than inherited from the commit.
 * 2. **Nothing is short-circuited between the page and the chain.** Hiding the
 *    card that says what will happen breaks Article VI (the trainer was shown
 *    nothing) *and* Article VII (they authorised something they could not have
 *    seen). Both denials are reported. Collapsing them would mean choosing
 *    which article a sabotage "really" violates, and the honest answer is both.
 */

import type {
  ActionGrant,
  AnswerManifest,
  ConfirmationEvent,
  RenderAffidavit,
  Resolution,
  ScopeGrant,
  Verdict,
  Violation,
} from "./contracts.js";
import type { DomElement } from "./dom.js";
import type { ManifestContext } from "./manifest.js";
import { actionUnitId, planRender, verifyRender } from "./render.js";
import { verdictOf, violation } from "./violation.js";

/**
 * Everything the League would hold about one act, and everything a verdict
 * about it may depend on (IA-10).
 *
 * The artifact travels with the record rather than being re-rendered from the
 * manifest. A page rebuilt at action time would be the renderer's second
 * opinion about what it drew the first time, and the trainer confirmed the
 * first one.
 */
export interface ActionRecord {
  manifest: AnswerManifest;
  artifact: DomElement;
  affidavit: RenderAffidavit;
  confirmation: ConfirmationEvent;
  grant: ActionGrant;
  /** RFC 3339. The moment the act would execute — supplied, never a clock. */
  executedAt: string;
}

/** What a caller brings when it wants to act: the record, minus the grant. */
export interface ActionRequest extends Omit<ActionRecord, "grant"> {
  tool: string;
  entityId: string;
  authorizedAt: string;
}

/**
 * Authorize one act, or refuse.
 *
 * Built on the verifier rather than beside it, like `compileManifest` and
 * `attestRender`: the grant this mints is submitted to exactly the check a
 * grant arriving from anywhere else would face, so there is no path by which
 * the thing that authorises an act is more trusted than the thing that audits
 * one.
 */
export function authorizeAction(context: ManifestContext, request: ActionRequest): Resolution<ActionGrant> {
  // An act is always personal (IA-7 binds it to the trainer's confirmation),
  // so a grantless context — legal for a lesson — can authorize nothing.
  if (context.grant === undefined) {
    return {
      ok: false,
      violations: [violation("IA-1", "scope-not-established", "an act cannot be authorized with no scope established")],
    };
  }
  const grant: ActionGrant = {
    transactionId: request.manifest.transactionId,
    confirmationEventId: request.confirmation.id,
    tool: request.tool,
    entityId: request.entityId,
    scopeGrantId: context.grant.id,
    authorizedAt: request.authorizedAt,
  };

  const verdict = verifyAction(context, { ...request, grant });
  if (!verdict.allowed) return { ok: false, violations: verdict.violations };
  return { ok: true, value: grant };
}

/**
 * Judge one act against the whole chain behind it, and name every break.
 *
 * Knows nothing about how any link was produced. A record from the kernel's own
 * entry points, from a replay, or from a mutated fixture is read identically.
 */
export function verifyAction(context: ManifestContext, record: ActionRecord): Verdict {
  // Same rule as authorization: no scope, no act — judged before the chain,
  // because every later check compares against the scope this context lacks.
  if (context.grant === undefined) {
    return verdictOf([
      violation("IA-1", "scope-not-established", "an act cannot be verified with no scope established"),
    ]);
  }
  const rendered = verifyRender(context, record.manifest, record.artifact, record.affidavit);

  return verdictOf([
    ...rendered.violations,
    ...checkConfirmation(record),
    ...checkGrant(context, record),
    ...checkWhatWasShown(context, record),
    ...checkOrder(record),
    ...checkScopeAtAction(context.grant, record.executedAt),
  ]);
}

// --- the confirmation -------------------------------------------------------

/**
 * The trainer's yes, and what it was a yes to.
 *
 * The digest comparison is the whole of Article VII's "same rendered artifact",
 * and it is a comparison rather than a lookup on purpose: the confirmation
 * carries the digest of the page *as it was shown*, so a page edited afterwards
 * disagrees with the consent instead of quietly replacing it.
 */
function checkConfirmation(record: ActionRecord): Violation[] {
  const violations: Violation[] = [];
  const { confirmation, affidavit, manifest } = record;

  if (confirmation.transactionId !== manifest.transactionId) {
    violations.push(
      violation("IA-7", "confirmation-foreign-transaction", "the confirmation on file is for another answer", {
        expected: manifest.transactionId,
        actual: confirmation.transactionId || "no transaction",
      }),
    );
  }
  // IA-8 rather than IA-7: this is not a broken chain, it is a link forged by
  // somebody who does not speak for the trainer. A tool result reading "the
  // user confirmed" is recorded, read, and structurally incapable of consent.
  if (confirmation.source !== "trainer") {
    violations.push(
      violation("IA-8", "confirmation-not-from-trainer", `the confirmation arrived on the ${confirmation.source} channel`, {
        expected: "trainer",
        actual: confirmation.source,
      }),
    );
  }
  if (confirmation.artifactDigest !== affidavit.artifactDigest) {
    violations.push(
      violation("IA-7", "confirmation-digest-mismatch", "the trainer confirmed a different artifact from the one on file", {
        expected: affidavit.artifactDigest,
        actual: confirmation.artifactDigest || "no digest",
      }),
    );
  }

  return violations;
}

// --- the grant --------------------------------------------------------------

/** One proof identity: the act cites this answer, this consent, this trainer. */
function checkGrant(context: ManifestContext, record: ActionRecord): Violation[] {
  const violations: Violation[] = [];
  const { grant, confirmation, manifest } = record;

  if (grant.transactionId !== manifest.transactionId) {
    violations.push(
      violation("IA-7", "action-foreign-transaction", "the act is being executed against another answer", {
        expected: manifest.transactionId,
        actual: grant.transactionId || "no transaction",
      }),
    );
  }
  if (grant.confirmationEventId !== confirmation.id) {
    violations.push(
      violation("IA-7", "action-unconfirmed", "the act cites a confirmation other than the one on file", {
        expected: confirmation.id,
        actual: grant.confirmationEventId || "no confirmation",
      }),
    );
  }
  if (grant.scopeGrantId !== context.grant?.id) {
    violations.push(
      violation("IA-7", "action-scope-mismatch", "the act was authorised under another trainer's scope", {
        expected: context.grant?.id ?? "no scope grant",
        actual: grant.scopeGrantId || "no scope grant",
      }),
    );
  }

  return violations;
}

// --- what the trainer actually saw ------------------------------------------

/**
 * The act was on the page, and the page showed it.
 *
 * "Even if that thing is true" is the sentence in the article, and it is the
 * reason this check is about the *act* rather than about the entity. A page
 * that recommends Pikachu has displayed Pikachu; it has not displayed a
 * proposal to release it, and an entity check would let one authorise the
 * other. So the act has to be a claim in the certified answer, and its unit has
 * to have been visible in the artifact the trainer confirmed.
 */
function checkWhatWasShown(context: ManifestContext, record: ActionRecord): Violation[] {
  const { grant, manifest, affidavit } = record;
  const claimed = manifest.claims.some(
    (claim) => claim.kind === "action" && claim.tool === grant.tool && claim.entityId === grant.entityId,
  );
  if (!claimed) {
    return [
      violation("IA-7", "action-never-shown", `this answer never proposed to ${grant.tool} ${grant.entityId}`, {
        expected: `an action claim for ${grant.tool} ${grant.entityId}`,
        actual: describeActs(manifest) || "no acts proposed",
      }),
    ];
  }

  // The plan is re-derived rather than taken from the affidavit's word for it:
  // the affidavit says which units showed, and the plan says which unit this
  // act would have to be. A denial about the plan is already reported by the
  // render verification above, so nothing is said twice here.
  const planned = planRender(context, manifest);
  if (!planned.ok) return [];

  const id = actionUnitId(grant.tool, grant.entityId);
  const shown = affidavit.units.find((unit) => unit.id === id);
  if (shown?.visible === true) return [];
  return [
    violation("IA-7", "action-not-visible", `the trainer could not see that this answer would ${grant.tool} ${grant.entityId}`, {
      expected: `${id} visible in the confirmed artifact`,
      actual: shown === undefined ? "not in the artifact" : "hidden",
    }),
  ];
}

function describeActs(manifest: AnswerManifest): string {
  return manifest.claims
    .flatMap((claim) => (claim.kind === "action" ? [`${claim.tool} ${claim.entityId}`] : []))
    .join(", ");
}

// --- time -------------------------------------------------------------------

/**
 * Rendered, then confirmed, then authorised, then executed.
 *
 * Ordering is the half of Article VII that a digest cannot carry. A
 * confirmation that predates the page it names is not consent to that page,
 * however perfectly the two agree afterwards — it is the record of a trainer
 * agreeing to something else, with the right digest attached later.
 */
function checkOrder(record: ActionRecord): Violation[] {
  const rendered = { label: "the artifact was rendered", at: record.affidavit.renderedAt };
  const confirmed = { label: "the trainer confirmed", at: record.confirmation.confirmedAt };
  const authorized = { label: "the act was authorised", at: record.grant.authorizedAt };
  const executed = { label: "the act would execute", at: record.executedAt };

  const unreadable = [rendered, confirmed, authorized, executed].filter((moment) =>
    Number.isNaN(Date.parse(moment.at)),
  );
  if (unreadable.length > 0) {
    return [
      violation("IA-7", "action-time-unreadable", "the record does not say when every step of this act happened", {
        expected: "RFC 3339 timestamps",
        actual: unreadable.map((moment) => `${moment.label}: ${moment.at || "nothing"}`).join("; "),
      }),
    ];
  }

  const inOrder = (
    rule: string,
    message: string,
    earlier: { label: string; at: string },
    later: { label: string; at: string },
  ): Violation[] => {
    if (Date.parse(later.at) >= Date.parse(earlier.at)) return [];
    return [violation("IA-7", rule, message, { expected: `at or after ${earlier.label} (${earlier.at})`, actual: later.at })];
  };

  return [
    ...inOrder("confirmed-before-render", "the trainer confirmed before the artifact existed", rendered, confirmed),
    ...inOrder(
      "authorized-before-confirmation",
      "the act was authorised before the trainer confirmed it",
      confirmed,
      authorized,
    ),
    ...inOrder("executed-before-authorization", "the act would execute before it was authorised", authorized, executed),
  ];
}

/**
 * Scope, checked again at the moment it matters.
 *
 * The manifest already checked this window at commit time, and that check
 * cannot stand in for this one: a grant that was valid when the answer was
 * drawn can have expired by the time somebody clicks. Article VII says "while
 * scope is still valid", and "still" is the word doing the work.
 */
function checkScopeAtAction(grant: ScopeGrant, executedAt: string): Violation[] {
  const at = Date.parse(executedAt);
  const expires = Date.parse(grant.expiresAt);
  const issued = Date.parse(grant.issuedAt);
  if (Number.isNaN(at) || Number.isNaN(expires) || Number.isNaN(issued)) return [];

  if (at >= issued && at <= expires) return [];
  return [
    violation("IA-7", "scope-expired-at-action", `scope grant ${grant.id} is not valid at the moment this act would execute`, {
      expected: `${grant.issuedAt}..${grant.expiresAt}`,
      actual: executedAt,
    }),
  ];
}
