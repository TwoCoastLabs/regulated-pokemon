/**
 * Phase 2 crucible: sabotage of a compiled answer.
 *
 * Phase 1 attacked the registry — the datum. These attacks all leave the
 * registry untouched and go after the *answer*: a stat quoted wrong, a count
 * that no longer matches its set, a runner-up crowned, a restricted species
 * recommended to a novice, a mandatory warning quietly dropped. Each is the
 * shape of a plausible sentence, which is precisely why none of them may be
 * caught by reading the prose.
 *
 * Every mutation compiles an honest manifest first and tampers afterwards. A
 * sabotage that could not be compiled would prove only that the compiler
 * refuses bad input, not that the verifier catches a manifest that arrived
 * from somewhere else.
 */

import type { AnswerManifest, Claim, ClosedRoster, Exhibit, RosterCriteria, Verdict } from "../kernel/contracts.js";
import { digestText } from "../kernel/digest.js";
import { compileManifest, verifyManifest } from "../kernel/manifest.js";
import { buildRoster } from "../kernel/roster.js";
import { AccordError } from "../kernel/violation.js";
import type { ArticleId } from "../kernel/accord.js";
import { type Control, type CrucibleWorld, type Mutation } from "./harness.js";

const ELECTRIC: RosterCriteria = { all: [{ kind: "has-type", type: "electric" }] };
const BOOMERS: RosterCriteria = { all: [{ kind: "learns-move", move: "self-destruct" }] };
/** Everything at or below Lapras and Vaporeon, who tie for the highest HP. */
const STURDY: RosterCriteria = { all: [{ kind: "stat-at-most", stat: "hp", value: 130 }] };

function roster(world: CrucibleWorld, id: string, criteria: RosterCriteria): ClosedRoster {
  const built = buildRoster(world.registry, id, criteria);
  if (!built.ok) throw new AccordError(built.violations);
  return built.value;
}

/**
 * The answer every mutation starts from: one claim of each kind, over two
 * certified sets, for a trainer accredited to hear all of it.
 *
 * Exported because phase 4 renders this exact answer. The two phases sabotage
 * different things about the same sentence, which is the only way to find out
 * whether they agree about what an answer is.
 */
export function honestAnswer(world: CrucibleWorld): AnswerManifest {
  const electric = roster(world, "electric-kanto", ELECTRIC);
  const boomers = roster(world, "selfdestruct-learners", BOOMERS);
  const claims: Claim[] = [
    { kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } },
    { kind: "count", rosterId: electric.id, reported: electric.cardinality },
    { kind: "count", rosterId: boomers.id, reported: boomers.cardinality },
    { kind: "membership", rosterId: electric.id, entityId: "zapdos", asserted: true },
    {
      kind: "ranking",
      rosterId: electric.id,
      basis: "base-speed",
      direction: "highest",
      selectedEntityId: "electrode",
    },
    { kind: "recommendation", entityId: "mewtwo" },
  ];

  const compiled = compileManifest(world, { transactionId: "txn-crucible", claims, rosters: [electric, boomers] });
  // A crucible that cannot build an honest answer is not measuring anything,
  // so this fails loudly rather than degrading into a passing denial.
  if (!compiled.ok) throw new AccordError(compiled.violations);
  return compiled.value;
}

/** Compile honestly, tamper with the record, then submit it for verification. */
function sabotageAnswer(world: CrucibleWorld, sabotage: (manifest: AnswerManifest) => AnswerManifest): Verdict {
  return verifyManifest(world, sabotage(honestAnswer(world)));
}

/**
 * Tamper with the *world* instead of the record: the same honest answer, put
 * in front of a different pack or a differently accredited trainer.
 */
function sabotageWorld(world: CrucibleWorld, sabotage: (world: CrucibleWorld) => CrucibleWorld): Verdict {
  return verifyManifest(sabotage(world), honestAnswer(world));
}

function replaceClaim(manifest: AnswerManifest, kind: Claim["kind"], replacement: Claim): AnswerManifest {
  const claims = manifest.claims.map((claim) => (claim.kind === kind ? replacement : claim));
  return { ...manifest, claims };
}

export const PHASE_2_MUTATIONS: readonly Mutation[] = [
  {
    id: "swapped-stat",
    title: "Quote a stat that is not the certified one",
    description:
      "Pikachu's base speed becomes 200. The entity is real, the fact is " +
      "certified, and only the value is wrong — which is the shape almost " +
      "every real misstatement takes.",
    article: "IA-2",
    rule: "fact-mismatch",
    run: (world) =>
      sabotageAnswer(world, (manifest) =>
        replaceClaim(manifest, "fact", {
          kind: "fact",
          entityId: "pikachu",
          factId: "base-speed",
          asserted: { kind: "number", value: 200 },
        }),
      ),
  },
  {
    id: "point-provenance-at-other-words",
    title: "Keep the provenance exhibit, aim it at a different text",
    description:
      "The disclosure is still listed, so a presence check passes. It now " +
      "names a block that is not the approved attribution — the shape a " +
      "stale translation, an older revision or a hand-edited record takes.",
    article: "IA-2",
    rule: "exhibit-block-mismatch",
    run: (world) =>
      sabotageAnswer(world, (manifest) => ({
        ...manifest,
        exhibits: manifest.exhibits.map((exhibit) =>
          exhibit.id === "provenance"
            ? { ...exhibit, block: { ...exhibit.block, digest: "sha256:0".padEnd(71, "0") } }
            : exhibit,
        ),
      })),
  },
  {
    id: "recommend-missingno",
    title: "Recommend something that does not exist",
    description:
      "The MissingNo clause reaches advice: no amount of enthusiasm makes a " +
      "species the registry has never heard of catchable.",
    article: "IA-3",
    rule: "fabricated-entity",
    run: (world) =>
      sabotageAnswer(world, (manifest) =>
        replaceClaim(manifest, "recommendation", { kind: "recommendation", entityId: "missingno" }),
      ),
  },
  {
    id: "count-without-the-set",
    title: "Show a number the set does not support",
    description:
      "Every member of the roster is right and the number beside it is not. " +
      "The roster is the count, so this is the certificate contradicting the " +
      "sentence it certifies.",
    article: "IA-4",
    rule: "count-mismatch",
    run: (world) =>
      sabotageAnswer(world, (manifest) =>
        replaceClaim(manifest, "count", { kind: "count", rosterId: "electric-kanto", reported: 12 }),
      ),
  },
  {
    id: "orphan-the-count",
    title: "Cite a set the record does not carry",
    description:
      "The claim survives and its evidence is removed. A count whose set is " +
      "somewhere else cannot be recomputed now or replayed later.",
    article: "IA-4",
    rule: "roster-not-in-manifest",
    run: (world) =>
      sabotageAnswer(world, (manifest) => ({
        ...manifest,
        rosters: manifest.rosters.filter((entry) => entry.id !== "electric-kanto"),
      })),
  },
  {
    id: "invert-membership",
    title: "Say a member is not one",
    description: "Zapdos is Electric. Asserting otherwise is not a matter of opinion.",
    article: "IA-4",
    rule: "membership-mismatch",
    run: (world) =>
      sabotageAnswer(world, (manifest) =>
        replaceClaim(manifest, "membership", {
          kind: "membership",
          rosterId: "electric-kanto",
          entityId: "zapdos",
          asserted: false,
        }),
      ),
  },
  {
    id: "crown-the-runner-up",
    title: "Give the prize to second place",
    description:
      "Jolteon is fast and Electrode is faster. A superlative is a claim about " +
      "an ordering, so it is checked by redoing the ordering.",
    article: "IA-4",
    rule: "ranking-mismatch",
    run: (world) =>
      sabotageAnswer(world, (manifest) =>
        replaceClaim(manifest, "ranking", {
          kind: "ranking",
          rosterId: "electric-kanto",
          basis: "base-speed",
          direction: "highest",
          selectedEntityId: "jolteon",
        }),
      ),
  },
  {
    id: "break-a-tie-quietly",
    title: "Answer a question that has no single answer",
    description:
      "Lapras and Vaporeon share the highest HP in this set. Picking one reads " +
      "as decisive and is simply wrong, and an argmax over an array would pick " +
      "whichever the Pokédex lists first without ever noticing.",
    article: "IA-4",
    rule: "ranking-tie",
    run: (world) =>
      sabotageAnswer(world, (manifest) => {
        const sturdy = roster(world, "hp-130-or-less", STURDY);
        return {
          ...manifest,
          rosters: [...manifest.rosters, sturdy],
          claims: [
            ...manifest.claims,
            {
              kind: "ranking",
              rosterId: sturdy.id,
              basis: "base-hp",
              direction: "highest",
              selectedEntityId: "lapras",
            },
          ],
        };
      }),
  },
  {
    id: "recommend-past-the-gate",
    title: "Recommend a legendary to a trainer with two badges",
    description:
      "The species is real, the facts about it are certified, and the trainer " +
      "is not accredited to be advised to acquire it. Phrasing has no " +
      "mechanism by which it could help.",
    article: "IA-5",
    rule: "restricted-species",
    run: (world) =>
      sabotageWorld(world, (current) => ({
        ...current,
        grant: { ...current.grant, scope: { ...current.grant.scope, badgeLevel: 2 } },
      })),
  },
  {
    id: "answer-under-another-pack",
    title: "Present an answer governed by different rules",
    description:
      "The manifest was compiled under one version of the Accord pack and is " +
      "judged under another. Which eligibility rules applied is part of the " +
      "record, not a detail of the runtime.",
    article: "IA-5",
    rule: "pack-mismatch",
    run: (world) => sabotageAnswer(world, (manifest) => ({ ...manifest, packId: "indigo-accord-v2" })),
  },
  {
    id: "drop-the-warning",
    title: "Lose the Selfdestruct warning on the way out",
    description:
      "The answer is still about a move that faints the user, and the " +
      "disclosure the pack requires for it is gone. Nothing else about the " +
      "answer changes.",
    article: "IA-6",
    rule: "exhibit-not-manifested",
    run: (world) =>
      sabotageAnswer(world, (manifest) => ({
        ...manifest,
        exhibits: manifest.exhibits.filter((exhibit) => exhibit.id !== "selfdestruct-warning"),
      })),
  },
  {
    id: "slip-in-an-exhibit",
    title: "Add a disclosure no rule asked for",
    description:
      "An exhibit nobody can trace to a pack rule is an obligation invented " +
      "downstream, and phase 4 would dutifully require it on screen.",
    article: "IA-6",
    rule: "exhibit-unrequired",
    run: (world) =>
      sabotageAnswer(world, (manifest) => {
        const injected: Exhibit = {
          id: "sponsored-message",
          kind: "warning",
          block: {
            id: "silph-co-sponsorship",
            version: 1,
            locale: manifest.locale,
            digest: digestText("Brought to you by Silph Co."),
          },
        };
        return { ...manifest, exhibits: [...manifest.exhibits, injected] };
      }),
  },
];

export const PHASE_2_CONTROLS: readonly Control[] = [
  {
    id: "answer-clean-path",
    kind: "clean-path",
    title: "Compile and verify a complete answer",
    description:
      "A fact, two counts, a membership, a ranking and a recommendation, for " +
      "a trainer accredited to hear all of it — through the kernel's own " +
      "entry points, with nothing tampered.",
    run: (world) => {
      const manifest = honestAnswer(world);
      return verifyManifest(world, manifest);
    },
  },
  {
    id: "answer-no-op-sabotage",
    kind: "no-op-sabotage",
    title: "Change nothing, through the identical harness",
    description:
      "The same compile-then-tamper harness every mutation above uses, with " +
      "both the record and the world left exactly as compiled.",
    run: (world) => {
      const record = sabotageAnswer(world, (manifest) => manifest);
      return record.allowed ? sabotageWorld(world, (current) => current) : record;
    },
  },
];

/** Articles the phase-2 crucible exercises. Pinned by test, both ways. */
export const PHASE_2_ARTICLES: readonly ArticleId[] = ["IA-2", "IA-3", "IA-4", "IA-5", "IA-6"];
