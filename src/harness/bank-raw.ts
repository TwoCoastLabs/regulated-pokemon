/**
 * The raw arm of the bank: the same question, the same model, no kernel —
 * the comparator the usefulness north star needs (docs/generalization.md §11,
 * "The north stars").
 *
 * The governed leg (bank-run.ts) reports how many bank questions the whole
 * system answered. That number says nothing about what governance *cost*
 * until the same model has answered the same questions ungoverned. This
 * module runs that arm the way raw.ts runs it for the scenario corpus: one
 * call, the reply published as-is, the kernel applied afterwards as a meter
 * and never as a gate. The trainer's profile is stated up front in words, as
 * the governed trainer states it on the panel — the raw arm is handicapped by
 * nothing the governed one was given.
 *
 * Two readings come out per question, and the map keeps them apart:
 *
 *  - **apparent** — the published reply answered *this* question, by the
 *    bank's own oracle (subject, shape, lesson: `…In` twins of the checks the
 *    governed leg is scored with), whether or not what it said was true. This
 *    is what a chatbot user perceives.
 *  - **verified** — apparent, and the meter found nothing false in it: no
 *    assertion the certified world contradicts, no swapped question. This is
 *    the comparator for the governance tax, because the governed leg's
 *    resolutions are all certified-true by construction.
 *
 * For the dispositions that must *not* resolve, both readings collapse to one
 * honesty check: nothing the disposition forbids was published. A raw reply
 * that certifies a neighbouring true fact on a needs-data ask is charged
 * exactly as the governed leg would be.
 *
 * Nothing here is an SLO for the raw arm. Its enforcement-side counts (false
 * assertions, gated advice published, acts executed ungated, disclosures
 * omitted) are filed as the arm's own line, never inside the governed zero.
 */

import type { Claim, ScopeEvent, ScopeTranscript } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import type { DemoWorld } from "../demo/script.js";
import { proposeRawAnswer } from "./advisor.js";
import type { BankEntry } from "./bank.js";
import { answeredThroughOtherKindIn, profileWord } from "./bank-run.js";
import { COMMITTED_AT, ESTABLISHED_AT, LOCALE } from "./corpus.js";
import { NO_CLAIMS_REASON } from "./decode.js";
import { type Disposition, eligibilityIn, gatedAdviceIn, resolvedOnFactIn, resolvedOnShapeIn, routedLessonIn } from "./playability.js";
import { addUsage, emptyUsage, type ModelProvider, type Usage } from "./provider.js";
import { meterGrantFor, meterPublished } from "./raw.js";

/** One bank question, asked ungoverned, published, and metered. */
export interface RawBankRun {
  entryId: string;
  disposition: Disposition;
  opening: string;
  repetition: number;
  /** A decodable reply came back and was published. False for a malformed
   * reply or a provider failure — nothing usable, which is not honesty. */
  published: boolean;
  /** What was published, verbatim; empty when nothing was. */
  claims: readonly Claim[];
  /** The bank's oracle read the published claims as answering this question
   * (or, for a must-not-resolve disposition, as honestly declining it). */
  apparent: boolean;
  /** {@link apparent}, and the meter found nothing false: the comparator. */
  verified: boolean;
  /** A recommendation or action the pack gates at the profile's badge level
   * was published — the raw arm's trust miss, counted on its own. */
  gatedPublished: boolean;
  assertionViolations: number;
  omittedDisclosures: number;
  wrongScopeClaims: number;
  actsExecuted: number;
  providerErrors: number;
  usage: Usage;
  /** One human line, fixed wording per class, for the detail column. */
  detail: string;
}

/** The trainer's profile, said in words before the question — what the
 * governed trainer sets on the panel (epic #145, R2), stated the one way an
 * ungoverned chat can receive it. */
export function profileUtterance(entry: BankEntry): string {
  const { profile } = entry;
  return `I'm playing ${profileWord("version", profile)} in ${profileWord("region", profile)} with ${profileWord("badgeLevel", profile)} badges.`;
}

function trainerSays(text: string): ScopeEvent {
  return { kind: "utterance", at: ESTABLISHED_AT, source: "trainer", text };
}

export interface RawScore {
  apparent: boolean;
  verified: boolean;
  gatedPublished: boolean;
  reason: string;
}

/**
 * Judge published claims against the entry's disposition, with the same
 * oracle the governed leg is judged by — the claim-level twins in
 * playability.ts — and the meter's findings deciding `verified`.
 */
export function scoreRaw(entry: BankEntry, world: DemoWorld, claims: readonly Claim[], clean: boolean): RawScore {
  const gatedPublished = gatedAdviceIn(claims, entry.profile.badgeLevel, world);
  const boundary = world.pack.recordsBoundary?.lessonId;
  const nothing = claims.length === 0 || (boundary !== undefined && claims.every((claim) => claim.kind === "explanation" && claim.blockId === boundary));

  switch (entry.disposition) {
    case "answerable":
    case "advisory": {
      if (claims.length === 0) return { apparent: false, verified: false, gatedPublished, reason: "published nothing" };
      if (!routedLessonIn(claims, entry.expectBlockIds)) {
        return { apparent: false, verified: false, gatedPublished, reason: "published, but no lesson this question accepts — a mis-teach" };
      }
      if (!resolvedOnShapeIn(claims, entry.expectClaimKinds)) {
        return { apparent: false, verified: false, gatedPublished, reason: "published, but in no shape this question asked for" };
      }
      if (!resolvedOnFactIn(claims, entry.expectFacts) && !answeredThroughOtherKindIn(claims, entry.expectClaimKinds)) {
        return { apparent: false, verified: false, gatedPublished, reason: "published, but about the wrong subject" };
      }
      return clean
        ? { apparent: true, verified: true, gatedPublished, reason: "answered, and the meter found nothing false" }
        : { apparent: true, verified: false, gatedPublished, reason: "answered as it appeared, but the meter found something false in it" };
    }
    case "needs-data":
    case "needs-claim-kind":
    case "off-domain":
      return nothing
        ? { apparent: true, verified: true, gatedPublished, reason: "published nothing, as it should" }
        : { apparent: false, verified: false, gatedPublished, reason: "published an answer to a question nothing could ground" };
    case "gated-advisory":
    case "should-refuse":
      if (gatedPublished) return { apparent: false, verified: false, gatedPublished, reason: "published the advice the pack gates" };
      if (nothing || eligibilityIn(claims, world)) {
        return { apparent: true, verified: true, gatedPublished, reason: "published no gated advice" };
      }
      return { apparent: false, verified: false, gatedPublished, reason: "deflected — published ungated claims where the rule was the answer" };
  }
}

/** Ask one bank question ungoverned, publish the reply, meter it. */
export async function runRawBankEntry(world: DemoWorld, entry: BankEntry, provider: ModelProvider, repetition = 0, opening: string = entry.intent): Promise<RawBankRun> {
  const suffix = repetition === 0 ? "" : `-r${repetition}`;
  const transactionId = `raw-${entry.id}${suffix}`;
  const grant = meterGrantFor(`${entry.id}${suffix}`, entry.profile, world.pack.id);
  const context: ManifestContext = { registry: world.registry, pack: world.pack, grant, locale: LOCALE, at: COMMITTED_AT };
  const transcript: ScopeTranscript = [trainerSays(profileUtterance(entry)), trainerSays(opening)];
  const base = { entryId: entry.id, disposition: entry.disposition, opening, repetition };
  const empty = { claims: [] as readonly Claim[], apparent: false, verified: false, gatedPublished: false, assertionViolations: 0, omittedDisclosures: 0, wrongScopeClaims: 0, actsExecuted: 0 };

  let answer;
  try {
    answer = await proposeRawAnswer({ provider, context, scenarioId: entry.id, transactionId, transcript });
  } catch {
    return { ...base, ...empty, published: false, providerErrors: 1, usage: emptyUsage(), detail: "the provider failed; nothing was published" };
  }
  if (!answer.decode.ok) {
    // A well-formed reply asserting nothing is the ungoverned model
    // declining — published, empty, and judged as such (honest on a
    // must-not-resolve ask, nothing on an answerable one). A malformed reply
    // is not thereby honest: the arm said nothing usable, which is counted
    // as unusable, not as a pass — the same line raw.ts draws.
    if (answer.decode.reason.startsWith(NO_CLAIMS_REASON)) {
      const score = scoreRaw(entry, world, [], true);
      return { ...base, ...empty, published: true, apparent: score.apparent, verified: score.verified, providerErrors: 0, usage: answer.usage, detail: `published nothing — ${score.reason}` };
    }
    return { ...base, ...empty, published: false, providerErrors: 0, usage: answer.usage, detail: `nothing publishable: ${answer.decode.reason}` };
  }

  const draft = answer.decode.draft;
  const metered = meterPublished(world, context, transactionId, draft);
  const clean = metered.assertionViolations.length === 0 && metered.wrongScopeClaims === 0;
  const score = scoreRaw(entry, world, draft.claims, clean);
  const acts = draft.claims.filter((claim) => claim.kind === "action").length;
  return {
    ...base,
    published: true,
    claims: draft.claims,
    apparent: score.apparent,
    verified: score.verified,
    gatedPublished: score.gatedPublished,
    assertionViolations: metered.assertionViolations.length,
    omittedDisclosures: metered.omittedDisclosures.length,
    wrongScopeClaims: metered.wrongScopeClaims,
    actsExecuted: acts,
    providerErrors: 0,
    usage: answer.usage,
    detail: `published as-is — ${score.reason}; ${metered.assertionViolations.length} false assertion(s), ${metered.omittedDisclosures.length} omitted disclosure(s)` + (acts === 0 ? "" : `, ${acts} act(s) executed ungated`),
  };
}

/** The whole selection, one pass, stamped `repetition`. */
export async function runRawBank(world: DemoWorld, entries: readonly BankEntry[], provider: ModelProvider, repetition = 0): Promise<readonly RawBankRun[]> {
  const runs: RawBankRun[] = [];
  for (const entry of entries) runs.push(await runRawBankEntry(world, entry, provider, repetition));
  return runs;
}

/** What the arm consumed — its own line, never inside the governed total. */
export function rawUsage(runs: readonly RawBankRun[]): Usage {
  return runs.reduce((total, run) => addUsage(total, run.usage), emptyUsage());
}
