/**
 * Phase 7 of the crucible in epic #94's numbering: the Center world's claim
 * shapes (slice 3, PR 2). The mutations run against the second certified
 * world — kanto-center, the one with items — because the shapes they attack
 * only exist there.
 *
 * The phase declares `world: "center"` in the crucible's assembly and runs
 * against whatever Center context the runner supplies — it builds no world of
 * its own, because a phase that read one from disk would drag `node:fs` into
 * the browser bundle and blank the sabotage page.
 *
 * What this phase owns is small and specific: the certified *negative* (a
 * treats verdict flipped against the closed effect set), the derived
 * comparison (a value doctored, a fact that does not compare), and the
 * domain discipline of item rosters (species terms and item terms may not
 * mix). Everything else the new kinds touch — fabricated entities, roster
 * tampering, render binding — is already owned by earlier phases and holds
 * for items through the same single gates.
 */

import type { ArticleId } from "../kernel/accord.js";
import type { AnswerManifest, Claim, Verdict } from "../kernel/contracts.js";
import { compileManifest, type ManifestContext, verifyManifest } from "../kernel/manifest.js";
import { buildRoster } from "../kernel/roster.js";
import { AccordError } from "../kernel/violation.js";
import type { Control, CrucibleWorld, Mutation } from "./harness.js";

const TREATS: Claim = { kind: "treats", itemId: "antidote", condition: "poison" };
const COMPARISON: Claim = { kind: "comparison", factId: "restores-hp", leftId: "super-potion", rightId: "potion" };

/** The honest Center answer: a verdict, a comparison, and a count over an
 * item roster — compiled and verified through the same entry points as any
 * answer, against the world that certifies items. */
function honestCenterAnswer(context: ManifestContext): AnswerManifest {
  const roster = buildRoster(context.registry, "cures-poison", { all: [{ kind: "treats-condition", condition: "poison" }] });
  if (!roster.ok) throw new AccordError(roster.violations);
  const compiled = compileManifest(context, {
    transactionId: "txn-center-shapes",
    claims: [TREATS, COMPARISON, { kind: "count", rosterId: roster.value.id }],
    rosters: [roster.value],
  });
  if (!compiled.ok) throw new AccordError(compiled.violations);
  return compiled.value;
}

function sabotageCenter(world: CrucibleWorld, mutate: (manifest: AnswerManifest) => AnswerManifest): Verdict {
  return verifyManifest(world, mutate(honestCenterAnswer(world)));
}

function swapClaim(manifest: AnswerManifest, kind: Claim["kind"], replacement: Claim): AnswerManifest {
  return { ...manifest, claims: manifest.claims.map((claim) => (claim.kind === kind ? replacement : claim)) };
}

export const PHASE_7_MUTATIONS: readonly Mutation[] = [
  {
    id: "flip-the-certified-negative",
    title: "Claim the Antidote treats a burn",
    description:
      "The whole point of the treats shape is the certified no. The closed " +
      "effect set says an Antidote cures poison and nothing else; an answer " +
      "asserting it treats a burn is refused against that set, not debated.",
    article: "IA-2",
    rule: "treats-mismatch",
    run: (world) => sabotageCenter(world, (manifest) => swapClaim(manifest, "treats", { kind: "treats", itemId: "antidote", condition: "burn", asserted: true })),
  },
  {
    id: "invent-a-condition",
    title: "Rule on a condition the records do not know",
    description:
      "Sadness is not a status condition. The condition vocabulary is closed, " +
      "so the relation is refused before anything derives from it — a verdict " +
      "about an unknown condition would be a certificate over nothing.",
    article: "IA-2",
    rule: "unknown-condition",
    run: (world) => sabotageCenter(world, (manifest) => swapClaim(manifest, "treats", { kind: "treats", itemId: "full-heal", condition: "sadness", asserted: true })),
  },
  {
    id: "doctor-the-comparison",
    title: "State a comparison value the records contradict",
    description:
      "The model names the fact and the pair; the kernel derives the values. " +
      "A stated left side that disagrees with the certified value is a " +
      "different claim wearing the comparison's clothes.",
    article: "IA-2",
    rule: "comparison-mismatch",
    run: (world) =>
      sabotageCenter(world, (manifest) =>
        swapClaim(manifest, "comparison", { ...COMPARISON, left: { kind: "number", value: 500 }, right: { kind: "number", value: 20 } }),
      ),
  },
  {
    id: "compare-the-incomparable",
    title: "Compare two effect texts as if they were numbers",
    description:
      "item-effect is prose. Nothing numeric compares, so nothing compares — " +
      "refused by name rather than improvised into an opinion with a " +
      "certificate.",
    article: "IA-2",
    rule: "incomparable-fact",
    run: (world) => sabotageCenter(world, (manifest) => swapClaim(manifest, "comparison", { kind: "comparison", factId: "item-effect", leftId: "potion", rightId: "antidote" })),
  },
  {
    id: "mix-the-universes",
    title: "Blend species terms and item terms in one roster",
    description:
      "Electric-type things that cure poison is not a set either universe " +
      "certifies. The domain is a property of the criteria, and a blend is " +
      "refused rather than intersected into nonsense.",
    article: "IA-2",
    rule: "criteria-domain-mixed",
    run: (world) =>
      sabotageCenter(world, (manifest) => ({
        ...manifest,
        rosters: manifest.rosters.map((roster) => ({
          ...roster,
          criteria: { all: [...roster.criteria.all, { kind: "has-type", type: "electric" }] },
        })),
      })),
  },
  {
    id: "recommend-a-controlled-item",
    title: "Recommend Protein to a two-badge trainer",
    description:
      "Vitamins are controlled performance enhancers under the Center's own " +
      "pack. The gate is the species gate one universe over: same article, " +
      "same badge scale, its own named rule — and pleading has no mechanism " +
      "here either.",
    article: "IA-5",
    rule: "restricted-item",
    run: (world) => {
      // The runner's Center world is always granted at full accreditation;
      // the gate needs a two-badge trainer, so the scope is narrowed the way
      // phase 2 narrows it — on the world the phase declared, never a private one.
      const context = { ...world, grant: { ...world.grant!, scope: { ...world.grant!.scope, badgeLevel: 2 } } };
      const compiled = compileManifest(context, {
        transactionId: "txn-center-gate",
        claims: [{ kind: "recommendation", entityId: "protein" }],
        rosters: [],
      });
      if (compiled.ok) return verifyManifest(context, compiled.value);
      return { allowed: false, violations: compiled.violations };
    },
  },
];

export const PHASE_7_CONTROLS: readonly Control[] = [
  {
    id: "center-shapes-clean-path",
    kind: "clean-path",
    title: "A verdict, a comparison and an item count, verified",
    description:
      "The honest Center answer: the Antidote's certified yes on poison, the " +
      "Super Potion beside the Potion with both values derived, and a count " +
      "over the items that cure poison. Zero violations, through the same " +
      "gates every answer faces.",
    run: (world) => verifyManifest(world, honestCenterAnswer(world)),
  },
  {
    id: "center-shapes-no-op-sabotage",
    kind: "no-op-sabotage",
    title: "Mutate nothing, through the identical harness",
    description: "The same compile-then-verify harness every mutation above uses, with the manifest left exactly as compiled.",
    run: (world) => sabotageCenter(world, (manifest) => manifest),
  },
];

/** Articles the phase-7 crucible exercises. Pinned by test, both ways. */
export const PHASE_7_ARTICLES: readonly ArticleId[] = ["IA-2", "IA-5"];
