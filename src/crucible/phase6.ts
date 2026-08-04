/**
 * Phase 6 crucible: sabotage of the record, not the answer.
 *
 * Every phase before this one attacked something the kernel judges — a datum, a
 * claim, a page, a chain of consent. These attacks leave all of that untouched
 * and honest. The answer is certified, the verdict on file is the verdict it
 * genuinely reached, and the sabotage is to the *books*: a filed verdict edited
 * after the fact, a record missing the input its verdict rested on, a record
 * pinned to a snapshot or a pack the League cannot reproduce it against.
 *
 * That is the whole of Article X. A doctored ledger is not caught by reading
 * the answer, because the answer is fine; it is caught by re-executing the
 * record and finding that the verdict it now produces is not the verdict it
 * claims. "It must have seemed right at the time" is not a record — a record is
 * the thing you can run again.
 *
 * The honest transaction here is minted through the kernel's own front door:
 * scope established from a real transcript over this world's pack, an answer
 * planned and compiled and verified, an outcome reached. What each mutation
 * tampers with is what gets filed, never how the verdict was reached, so every
 * denial lands on the record's reproducibility rather than on the answer.
 */

import type { ArticleId } from "../kernel/accord.js";
import type { ScopeDimension, ScopeTranscript } from "../kernel/contracts.js";
import { candidateDigest, REQUIRED_DIMENSIONS } from "../kernel/scope.js";
import { type RecordedTransaction, type ReplayWorld, verifyReplay } from "../kernel/replay.js";
import { type AnswerPlan, runTransaction, type Transaction } from "../kernel/transaction.js";
import { AccordError, verdictOf } from "../kernel/violation.js";
import type { Verdict } from "../kernel/contracts.js";
import { type Control, type CrucibleWorld, type Mutation } from "./harness.js";
import { honestDraft } from "./phase2.js";

/** Supplied, never clocked: two runs must produce the same record (IA-10). */
const ESTABLISHED_AT = "2026-01-01T00:00:00Z";
const COMMITTED_AT = "2026-01-01T12:00:00Z";

/** A ranking answer is coming, so the comparison basis is material too. */
const REQUIRED: readonly ScopeDimension[] = [...REQUIRED_DIMENSIONS, "comparisonBasis"];

const BASIS_PROPOSAL = "proposal-basis-replay";
const BASIS_CANDIDATE = { comparisonBasis: "base-speed" };

/**
 * A conversation that establishes the fixture scope over this world's pack.
 *
 * Written out here rather than borrowed from a test fixture because the crucible
 * ships in the demo: it must stand on the kernel's public vocabulary, not on
 * test machinery. Three dimensions come from the trainer's own words and the
 * comparison basis goes through the propose/confirm ladder, the same mix the
 * fixture uses, so the answer this scope carries is the one every earlier phase
 * built on.
 */
const SCOPE_TRANSCRIPT: ScopeTranscript = [
  {
    kind: "utterance",
    at: ESTABLISHED_AT,
    source: "trainer",
    text: "I'm playing Red and Blue, travelling around the Kanto region, and I have 8 badges.",
  },
  { kind: "utterance", at: ESTABLISHED_AT, source: "trainer", text: "Which of the Electric ones is the quickest?" },
  {
    kind: "proposal",
    at: ESTABLISHED_AT,
    id: BASIS_PROPOSAL,
    candidate: BASIS_CANDIDATE,
    interpreting: "whichever of them is quickest",
  },
  {
    kind: "confirmation",
    at: ESTABLISHED_AT,
    source: "trainer",
    proposalId: BASIS_PROPOSAL,
    candidateDigest: candidateDigest(BASIS_PROPOSAL, BASIS_CANDIDATE),
    decision: "confirm",
  },
];

/** The honest answer, planned from the same draft every earlier phase uses. */
const plan: AnswerPlan = (context, transactionId) => ({ ...honestDraft(context), transactionId });

/** The world the record is replayed against: the League's registry and pack. */
function replayWorld(world: CrucibleWorld): ReplayWorld {
  return { registry: world.registry, pack: world.pack };
}

/** One governed exchange, honest end to end, filed as a record. */
function honestRecord(world: CrucibleWorld): Transaction {
  const transaction = runTransaction({
    id: "txn-crucible-replay",
    registry: world.registry,
    pack: world.pack,
    transcript: SCOPE_TRANSCRIPT,
    establishedAt: ESTABLISHED_AT,
    committedAt: COMMITTED_AT,
    locale: world.locale,
    required: REQUIRED,
    plan,
  });
  // A crucible that cannot file an honest record is not measuring anything, so
  // this fails loudly rather than degrading into a passing denial.
  if (transaction.outcome.status !== "answered") {
    throw new AccordError([
      { article: "IA-10", rule: "crucible-cannot-file-record", message: `honest exchange ended ${transaction.outcome.status}` },
    ]);
  }
  return transaction;
}

/** File an honest record, tamper with it, then ask the League to replay it. */
function sabotage(world: CrucibleWorld, tamper: (record: Transaction) => RecordedTransaction): Verdict {
  return verifyReplay(replayWorld(world), tamper(honestRecord(world)));
}

export const PHASE_6_MUTATIONS: readonly Mutation[] = [
  {
    id: "file-a-verdict-the-record-does-not-produce",
    title: "File a clean verdict over an answer that is not clean",
    description:
      "The record says answered and every stage verdict says allowed, and the " +
      "manifest it carries reads Pikachu's base speed as 190. Nothing about the " +
      "verdict was recomputed when it was filed. Replaying re-verifies the " +
      "recorded answer, reaches a denial, and finds it disagrees with the one on " +
      "file — which is the whole of Article X, and lands under IA-10 rather than " +
      "IA-2 because what failed is reproduction, not the fact.",
    article: "IA-10",
    rule: "verdict-not-reproduced",
    run: (world) =>
      sabotage(world, (record) => {
        if (record.manifest === undefined) throw new AccordError([]);
        return {
          ...record,
          manifest: {
            ...record.manifest,
            claims: record.manifest.claims.map((claim) =>
              claim.kind === "fact" && claim.entityId === "pikachu"
                ? { ...claim, asserted: { kind: "number", value: 190 } }
                : claim,
            ),
          },
        };
      }),
  },
  {
    id: "keep-the-verdict-lose-the-answer",
    title: "File the answered verdict without the answer",
    description:
      "The record reached an answered verdict and the manifest that verdict was " +
      "reached over is gone. There is nothing left to re-execute: a verdict about " +
      "an answer the books do not keep is a verdict nobody can derive again. The " +
      "record is incomplete, which Article X refuses before it even tries to " +
      "reproduce it.",
    article: "IA-10",
    rule: "record-incomplete",
    run: (world) =>
      sabotage(world, (record) => {
        const { manifest: _dropped, ...withoutManifest } = record;
        return withoutManifest as RecordedTransaction;
      }),
  },
  {
    id: "replay-against-a-drifted-snapshot",
    title: "File a record pinned to a snapshot nobody has",
    description:
      "Every input is honest and the record names a registry snapshot other than " +
      "the certified one. The verdict cannot be reproduced against a version the " +
      "League is not holding, so the snapshot version is part of the record and " +
      "is checked before anything is re-run. Certified facts that moved out from " +
      "under an answer are exactly what pinning the snapshot prevents.",
    article: "IA-10",
    rule: "snapshot-not-pinned",
    run: (world) => sabotage(world, (record) => ({ ...record, snapshotId: "kanto-red-blue@0000000" })),
  },
  {
    id: "replay-against-a-drifted-pack",
    title: "File a record governed by a pack nobody has",
    description:
      "The mirror of the snapshot drift, one aisle over: the answer is honest and " +
      "the record claims it was governed by an Accord pack the League is not " +
      "replaying against. Policy is versioned data, so the pack version is pinned " +
      "in the record like the snapshot is — a verdict reproduced under different " +
      "rules is not the same verdict.",
    article: "IA-10",
    rule: "pack-not-pinned",
    run: (world) => sabotage(world, (record) => ({ ...record, packId: "accord-pack@v0" })),
  },
];

export const PHASE_6_CONTROLS: readonly Control[] = [
  {
    id: "replay-clean-path",
    kind: "clean-path",
    title: "File an honest exchange and replay it, through the kernel's own doors",
    description:
      "Scope established from a real transcript, an answer compiled and verified, " +
      "the whole transaction filed and then re-executed against the same certified " +
      "world. The verdict the record produces on replay is, byte for byte, the one " +
      "on file.",
    run: (world) => verifyReplay(replayWorld(world), honestRecord(world)),
  },
  {
    id: "replay-no-op-sabotage",
    kind: "no-op-sabotage",
    title: "File it, copy it node for node, replay it",
    description:
      "The same file-then-tamper harness every mutation above uses, with the " +
      "tamper reduced to a shallow copy that changes nothing. A harness that " +
      "denied by construction would make all four mutations pass for free.",
    run: (world) => sabotage(world, (record) => ({ ...record })),
  },
];

/** Articles the phase-6 crucible exercises. Pinned by test, both ways. */
export const PHASE_6_ARTICLES: readonly ArticleId[] = ["IA-10"];
