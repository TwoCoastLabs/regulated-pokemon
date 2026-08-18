/**
 * Phase 5 crucible: sabotage of the chain between the page and the act.
 *
 * Everything below leaves a certified answer and a compliant page completely
 * intact. Phase 2's attacks had to make the answer wrong; phase 4's had to make
 * the page wrong. These make neither wrong. The manifest verifies, the artifact
 * shows every slot and every disclosure, the affidavit is honest about it — and
 * then something between that page and the act does not line up: the wrong
 * digest, the wrong confirmation, the wrong order, a scope that has since run
 * out, a tool result answering for the trainer, or an act the trainer was never
 * shown at all.
 *
 * That is the whole of Article VII. "Confirmed A, executed B" is not a bug to
 * test for, because there is no test that catches it by inspecting A or B; it
 * is a disagreement between two records, and only something holding both can
 * name it.
 *
 * Article IX needed no mutations of its own kind. An irreversible act's consent
 * notice is a triggered exhibit under Article VI, so dropping it from the
 * record, aiming it at a different act, or hiding it on the page are refused by
 * machinery phases 2 and 4 already shipped — and each denial lands under IA-9,
 * because the pack rule that owes the notice cites IA-9. The three mutations
 * below prove exactly that: the articles compose rather than multiply. The
 * fourth is one layer earlier still, at the pack, where an act declared
 * irreversible with nothing to disclose is a consent nobody could ever give.
 */

import type { ArticleId } from "../kernel/accord.js";
import { type ActionRecord, authorizeAction, verifyAction } from "../kernel/action.js";
import type {
  ActionGrant,
  AnswerManifest,
  ConfirmationEvent,
  RenderAffidavit,
  Verdict,
} from "../kernel/contracts.js";
import { type DomElement, element } from "../kernel/dom.js";
import { compileManifest, verifyManifest } from "../kernel/manifest.js";
import { type AccordPack, loadPack } from "../kernel/pack.js";
import { attestRender, planRender } from "../kernel/render.js";
import { AccordError, verdictOf } from "../kernel/violation.js";
import { renderAnswer } from "../render/reference.js";
import { edit, inside, swearTo } from "./artifact.js";
import type { Control, CrucibleWorld, Mutation } from "./harness.js";
import { honestDraft } from "./phase2.js";

/**
 * The chain's four moments, supplied rather than read from a clock: a verdict
 * is a pure function of recorded inputs, and `now()` is not one of them.
 */
const RENDERED_AT = "2026-01-01T12:00:00Z";
const CONFIRMED_AT = "2026-01-01T12:00:30Z";
const AUTHORIZED_AT = "2026-01-01T12:00:31Z";
const EXECUTED_AT = "2026-01-01T12:00:32Z";

/** The act this phase is about, and the units it puts on the page. */
const TOOL = "release";
const SUBJECT = "pikachu";
const ACTION_CARD = `action:${TOOL}:${SUBJECT}`;
const CONSENT_NOTICE = `release-irreversibility:${SUBJECT}`;
const CONFIRMATION_ID = "confirmation-crucible-1";

/**
 * Phase 2's answer, plus the act it leads to.
 *
 * The act is a claim in the certified answer rather than something assembled
 * afterwards, which is what makes the rest of this phase possible: it is
 * compiled, it triggers the consent notice Article IX owes, it is planned onto
 * the page, and it is therefore something the trainer can be shown and can
 * agree to.
 */
function answerWithAnAct(world: CrucibleWorld): AnswerManifest {
  const draft = honestDraft(world);
  const compiled = compileManifest(world, {
    ...draft,
    claims: [...draft.claims, { kind: "action", tool: TOOL, entityId: SUBJECT }],
  });
  // A crucible that cannot build an honest answer is not measuring anything,
  // so this fails loudly rather than degrading into a passing denial.
  if (!compiled.ok) throw new AccordError(compiled.violations);
  return compiled.value;
}

/** The transport's record of the trainer saying yes to what is on the screen. */
function trainerConfirms(affidavit: RenderAffidavit): ConfirmationEvent {
  return {
    id: CONFIRMATION_ID,
    transactionId: affidavit.transactionId,
    source: "trainer",
    artifactDigest: affidavit.artifactDigest,
    confirmedAt: CONFIRMED_AT,
  };
}

/**
 * The grant a transport would mint for the record in front of it.
 *
 * Deliberately not `authorizeAction`, which refuses to mint one that will not
 * verify. Same reasoning as the unscrupulous witness in ./artifact.ts: the
 * kernel is not entitled to assume the grant it is judging came from something
 * on its side.
 */
function grantFor(world: CrucibleWorld, manifest: AnswerManifest, confirmation: ConfirmationEvent): ActionGrant {
  return {
    transactionId: manifest.transactionId,
    confirmationEventId: confirmation.id,
    tool: TOOL,
    entityId: SUBJECT,
    scopeGrantId: world.grant!.id,
    authorizedAt: AUTHORIZED_AT,
  };
}

/** The whole chain, honest end to end, through the kernel's own front doors. */
function acted(world: CrucibleWorld): ActionRecord {
  const manifest = answerWithAnAct(world);
  const planned = planRender(world, manifest);
  if (!planned.ok) throw new AccordError(planned.violations);

  const artifact = renderAnswer(world.pack, planned.value);
  const attested = attestRender(world, manifest, artifact, RENDERED_AT);
  if (!attested.ok) throw new AccordError(attested.violations);

  const confirmation = trainerConfirms(attested.value);
  const authorized = authorizeAction(world, {
    manifest,
    artifact,
    affidavit: attested.value,
    confirmation,
    tool: TOOL,
    entityId: SUBJECT,
    authorizedAt: AUTHORIZED_AT,
    executedAt: EXECUTED_AT,
  });
  if (!authorized.ok) throw new AccordError(authorized.violations);

  return {
    manifest,
    artifact,
    affidavit: attested.value,
    confirmation,
    grant: authorized.value,
    executedAt: EXECUTED_AT,
  };
}

/** What a mutation replaces. Anything it leaves out is rebuilt honestly. */
type Sabotaged = Partial<ActionRecord>;

/**
 * Act honestly, break one link, and submit the whole chain.
 *
 * Everything downstream of the sabotage is rebuilt around it rather than reused
 * from the clean run, and that is this harness's most important decision. A
 * confirmation still carrying the digest of the untouched page would deny every
 * page mutation twice — once on its merits and once because the digest moved —
 * and the second denial would do the work while looking like the first. So a
 * page attacked here arrives with an affidavit that is honest about the page, a
 * confirmation of that page, and a grant citing that confirmation. Each attack
 * has to be caught for what it did.
 */
function sabotage(world: CrucibleWorld, change: (honest: ActionRecord) => Sabotaged): Verdict {
  const honest = acted(world);
  const changed = change(honest);

  const manifest = changed.manifest ?? honest.manifest;
  const artifact = changed.artifact ?? honest.artifact;
  const affidavit = changed.affidavit ?? swearTo(artifact, RENDERED_AT);
  const confirmation = changed.confirmation ?? trainerConfirms(affidavit);
  const grant = changed.grant ?? grantFor(world, manifest, confirmation);

  return verifyAction(world, {
    manifest,
    artifact,
    affidavit,
    confirmation,
    grant,
    executedAt: changed.executedAt ?? EXECUTED_AT,
  });
}

/** Sabotage the pack itself, then ask the loader to trust it. */
function sabotagePack(world: CrucibleWorld, change: (draft: AccordPack) => AccordPack): Verdict {
  const loaded = loadPack(change(structuredClone(world.pack) as AccordPack), world.registry);
  return loaded.ok ? verdictOf([]) : verdictOf(loaded.violations);
}

export const PHASE_5_MUTATIONS: readonly Mutation[] = [
  {
    id: "act-on-something-never-proposed",
    title: "Execute against a Pokémon the answer only talked about",
    description:
      "Electrode is on the page, certified, and correctly the fastest Electric " +
      "Pokémon in Kanto. Nothing on that page proposed to release it. An " +
      "entity check would pass here, which is why the chain binds the act and " +
      "not the noun: displaying something is not proposing to do something to " +
      "it.",
    article: "IA-7",
    rule: "action-never-shown",
    run: (world) =>
      sabotage(world, (honest) => ({
        grant: { ...honest.grant, entityId: "electrode" },
      })),
  },
  {
    id: "hide-the-act-from-the-page",
    title: "Show everything except what you are about to do",
    description:
      "The card naming the act is wrapped in display:none. One edit, three " +
      "named denials: IA-6 for the card, IA-9 for the consent notice inside " +
      "it, and IA-7 for an act the trainer could not have seen before " +
      "agreeing to it. Composing the articles means the record says all three " +
      "rather than picking the one it likes.",
    article: "IA-7",
    rule: "action-not-visible",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: inside(honest.artifact, ACTION_CARD, element("div", { style: "display: none" })),
      })),
  },
  {
    id: "doctor-the-confirmed-digest",
    title: "Keep the confirmation, change what it says was on the screen",
    description:
      "The trainer confirmed, the page is compliant, and the digest in the " +
      "record is not the digest of that page. This is the shape a re-render, a " +
      "cache or an edit-after-signature takes, and it is the one thing a " +
      "confirmation exists to make detectable.",
    article: "IA-7",
    rule: "confirmation-digest-mismatch",
    run: (world) =>
      sabotage(world, (honest) => ({
        confirmation: { ...honest.confirmation, artifactDigest: `sha256:${"0".repeat(64)}` },
      })),
  },
  {
    id: "confirm-a-page-that-did-not-exist-yet",
    title: "Sign for the artifact before it was drawn",
    description:
      "Every identity in the chain matches and the timestamps are impossible. " +
      "Consent to a page that had not been rendered is consent to something " +
      "else with the right digest attached afterwards.",
    article: "IA-7",
    rule: "confirmed-before-render",
    run: (world) =>
      sabotage(world, (honest) => ({
        confirmation: { ...honest.confirmation, confirmedAt: "2026-01-01T11:59:00Z" },
      })),
  },
  {
    id: "authorize-before-the-trainer-agreed",
    title: "Authorize the act, then collect the yes",
    description:
      "The grant predates the confirmation it cites. Consent obtained after " +
      "the decision was taken is a record of a formality, not of a decision.",
    article: "IA-7",
    rule: "authorized-before-confirmation",
    run: (world) =>
      sabotage(world, (honest) => ({
        grant: { ...honest.grant, authorizedAt: "2026-01-01T12:00:10Z" },
      })),
  },
  {
    id: "execute-before-authorizing",
    title: "Do it, and authorize it a moment later",
    description:
      "The act runs ahead of the grant that permits it. Nothing else in the " +
      "chain is wrong, which is exactly how this arrives in real systems: as " +
      "a retry, a queue, or an optimistic write.",
    article: "IA-7",
    rule: "executed-before-authorization",
    run: (world) => sabotage(world, () => ({ executedAt: "2026-01-01T12:00:20Z" })),
  },
  {
    id: "execute-when-the-scope-has-expired",
    title: "Confirm today, act the day after tomorrow",
    description:
      "Scope valid when the answer committed is not scope valid when somebody " +
      "clicks. The window is checked again at the moment of execution, because " +
      "'while scope is still valid' is a sentence about that moment.",
    article: "IA-7",
    rule: "scope-expired-at-action",
    run: (world) => sabotage(world, () => ({ executedAt: "2026-01-03T00:00:00Z" })),
  },
  {
    id: "lose-the-clock",
    title: "Authorize an act at no particular time",
    description:
      "One timestamp is unreadable, so the order of the chain cannot be " +
      "established at all. A record that cannot be put in order is not a " +
      "record that happens to be in the right one.",
    article: "IA-7",
    rule: "action-time-unreadable",
    run: (world) =>
      sabotage(world, (honest) => ({
        grant: { ...honest.grant, authorizedAt: "shortly after lunch" },
      })),
  },
  {
    id: "confirm-another-answer",
    title: "Borrow a confirmation from a different transaction",
    description:
      "A real trainer really did confirm something. It was not this. A " +
      "confirmation is not a token that can be spent anywhere; it names the " +
      "answer it was given for.",
    article: "IA-7",
    rule: "confirmation-foreign-transaction",
    run: (world) =>
      sabotage(world, (honest) => ({
        confirmation: { ...honest.confirmation, transactionId: "txn-crucible-elsewhere" },
      })),
  },
  {
    id: "cite-a-confirmation-nobody-gave",
    title: "Point the act at a confirmation that is not on file",
    description:
      "The trainer confirmed this page and the grant cites some other event " +
      "id. Whether that event exists somewhere is beside the point: the chain " +
      "is only a chain if each link names the one before it.",
    article: "IA-7",
    rule: "action-unconfirmed",
    run: (world) =>
      sabotage(world, (honest) => ({
        grant: { ...honest.grant, confirmationEventId: "confirmation-somewhere-else" },
      })),
  },
  {
    id: "act-under-another-transaction",
    title: "Execute this act against a different answer",
    description:
      "Everything about the act is right except which certified answer it is " +
      "an act of. One proof identity runs from scope to execution, and this is " +
      "the link where it is easiest to substitute a neighbour.",
    article: "IA-7",
    rule: "action-foreign-transaction",
    run: (world) =>
      sabotage(world, (honest) => ({
        grant: { ...honest.grant, transactionId: "txn-crucible-elsewhere" },
      })),
  },
  {
    id: "act-under-another-trainers-scope",
    title: "Do it, but under somebody else's scope",
    description:
      "The act cites a scope grant that is not the one this answer was " +
      "certified against. Scope is what made the answer suitable; an act " +
      "carrying a different one is an act nobody established the suitability " +
      "of.",
    article: "IA-7",
    rule: "action-scope-mismatch",
    run: (world) =>
      sabotage(world, (honest) => ({
        grant: { ...honest.grant, scopeGrantId: "scope-somebody-else" },
      })),
  },
  {
    id: "invent-a-tool",
    title: "Propose an act the Accord has never heard of",
    description:
      "The species is certified, the trainer is accredited, and the verb is " +
      "one nobody approved. The action registry is closed for the same reason " +
      "the fact vocabulary is: an unlisted act is a way of changing the " +
      "trainer's state that no rule — including Article IX's — was written " +
      "about. The rest of the record is made perfectly consistent with the " +
      "new verb, consent notice and all, so nothing but the verb is wrong.",
    article: "IA-7",
    rule: "unknown-action",
    run: (world) => {
      const honest = answerWithAnAct(world);
      return verifyManifest(world, {
        ...honest,
        claims: honest.claims.map((claim) =>
          claim.kind === "action" ? { ...claim, tool: "delete-save-file" } : claim,
        ),
        // An unknown act triggers no disclosure, so a record still carrying
        // one would be denied for that instead, and the verb would sail past.
        exhibits: honest.exhibits.filter((exhibit) => exhibit.id !== CONSENT_NOTICE),
      });
    },
  },
  {
    id: "let-a-tool-result-say-yes",
    title: "Have an injected tool result do the confirming",
    description:
      "The classic injection, arriving at the one place it would pay off: not " +
      "trying to move scope, but answering for the trainer at the moment of " +
      "consent. It is recorded, it is read, and it cannot consent — the " +
      "channel it came in on is not one the trainer speaks on.",
    article: "IA-8",
    rule: "confirmation-not-from-trainer",
    run: (world) =>
      sabotage(world, (honest) => ({
        confirmation: { ...honest.confirmation, source: "tool" },
      })),
  },
  {
    id: "drop-the-consent-notice",
    title: "Release it without saying that release is forever",
    description:
      "The answer still proposes an irreversible act and no longer carries the " +
      "notice the pack owes for it. Nothing new in the kernel catches this: " +
      "it is phase 2's exhibit obligation, firing under IA-9 because the pack " +
      "rule that requires the notice cites IA-9.",
    article: "IA-9",
    rule: "exhibit-not-manifested",
    run: (world) =>
      sabotage(world, (honest) => ({
        manifest: {
          ...honest.manifest,
          exhibits: honest.manifest.exhibits.filter((exhibit) => exhibit.id !== CONSENT_NOTICE),
        },
      })),
  },
  {
    id: "aim-the-consent-notice-at-a-reversible-act",
    title: "Keep the notice, attach it to adding the Pokémon to the team",
    description:
      "Word for word the approved consent text, on the page, visible, beside " +
      "an act it was not written for. What a disclosure is about is as " +
      "load-bearing as what it says, so the record states both and both are " +
      "recomputed.",
    article: "IA-9",
    rule: "exhibit-misattributed",
    run: (world) =>
      sabotage(world, (honest) => ({
        manifest: {
          ...honest.manifest,
          exhibits: honest.manifest.exhibits.map((exhibit) =>
            exhibit.id === CONSENT_NOTICE ? { ...exhibit, tool: "add-to-team" } : exhibit,
          ),
        },
      })),
  },
  {
    id: "hide-the-consent-notice",
    title: "Disclose the permanence, invisibly",
    description:
      "The notice is in the document, beside the act, in the record — and " +
      "aria-hidden. Article IX composes out of Article VI, so it is phase 4's " +
      "walker that catches this, and the denial lands under IA-9 because that " +
      "is the article that owed the notice.",
    article: "IA-9",
    rule: "exhibit-hidden-aria-hidden",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: edit(honest.artifact, CONSENT_NOTICE, (found) => ({
          ...found,
          attributes: { ...found.attributes, "aria-hidden": "true" },
        })),
      })),
  },
  {
    id: "declare-an-act-irreversible-and-disclose-nothing",
    title: "Write a pack where release is forever and nothing says so",
    description:
      "One layer earlier than every mutation above: the policy itself. An act " +
      "the League calls irreversible with no disclosure attached is a consent " +
      "the trainer could never give, because there would be nothing to consent " +
      "to. The pack refuses to load rather than shipping a rule that can never " +
      "fire.",
    article: "IA-9",
    rule: "pack-irreversible-undisclosed",
    run: (world) =>
      sabotagePack(world, (draft) => ({
        ...draft,
        exhibits: draft.exhibits.filter((rule) => rule.when.kind !== "action-claimed"),
      })),
  },
];

export const PHASE_5_CONTROLS: readonly Control[] = [
  {
    id: "action-clean-path",
    kind: "clean-path",
    title: "Answer, render, confirm and act, through the kernel's own doors",
    description:
      "Phase 2's answer with an irreversible act added to it: compiled, " +
      "planned, rendered, sworn to, confirmed by the trainer over that exact " +
      "artifact, and authorised against that confirmation — with the consent " +
      "notice beside the act, naming the Pokémon being given up and every " +
      "move it knows, read out of the snapshot.",
    run: (world) => verifyAction(world, acted(world)),
  },
  {
    id: "action-no-op-sabotage",
    kind: "no-op-sabotage",
    title: "Break nothing, through the identical harness",
    description:
      "The same act-then-tamper harness every mutation above uses, with the " +
      "page rebuilt node for node and every record re-derived from it. A " +
      "harness that denied by construction would make all eighteen pass for " +
      "free.",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: edit(honest.artifact, ACTION_CARD, (found) => found),
      })),
  },
];

/** Articles the phase-5 crucible exercises. Pinned by test, both ways. */
export const PHASE_5_ARTICLES: readonly ArticleId[] = ["IA-7", "IA-8", "IA-9"];
