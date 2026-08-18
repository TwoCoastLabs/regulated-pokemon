/**
 * The scripted world the demo runs in: the certified registry, the Accord
 * pack, three conversations, and the answer the Advisor wants to give.
 *
 * Everything here is deterministic and offline. There is no model: the
 * proposals are written out, exactly as they are in the crucible, because
 * whether a proposal binds has nothing to do with what produced it. When
 * phase 7 puts a real model behind the ladder, this file is what it replaces
 * and nothing below the seam changes.
 *
 * This is not a fixture. Fixtures are machinery for the subject; the demo is
 * an ordinary consumer of the kernel, and it loads the same vendored bytes CI
 * reads by the same public entry points anyone else would use.
 */

import type { Claim, ClosedRoster, RosterCriteria, ScopeDimension, ScopeEvent, ScopeTranscript } from "../kernel/contracts.js";
import type { ManifestContext, ManifestDraft } from "../kernel/manifest.js";
import { type AccordPack, loadPack } from "../kernel/pack.js";
import { type CertifiedRegistry, loadRegistry } from "../kernel/registry.js";
import { buildRoster } from "../kernel/roster.js";
import { candidateDigest, REQUIRED_DIMENSIONS } from "../kernel/scope.js";
import { type AnswerPlan, runTransaction, type Transaction, type TransactionOutcome } from "../kernel/transaction.js";
import { AccordError } from "../kernel/violation.js";

export interface DemoWorld {
  registry: CertifiedRegistry;
  pack: AccordPack;
}

/**
 * The certified world as a pure function of parsed data, so the same demo
 * runs wherever the bytes can be delivered: the CLI reads them from disk
 * (files.ts) and the sabotage page ships them in the bundle. Throws named,
 * never silently — a world that does not load is not demonstrated around.
 */
export function loadDemoWorld(snapshotData: unknown, packData: unknown): DemoWorld {
  const registry = loadRegistry(snapshotData);
  if (!registry.ok) throw new AccordError(registry.violations);
  const pack = loadPack(packData, registry.value);
  if (!pack.ok) throw new AccordError(pack.violations);
  return { registry: registry.value, pack: pack.value };
}

/**
 * Fixed timestamps rather than a clock, so two runs of the demo produce the
 * same transaction id, the same grant and the same digests (IA-10).
 */
export const ESTABLISHED_AT = "2026-01-01T00:00:00Z";
export const COMMITTED_AT = "2026-01-01T12:00:00Z";

/**
 * The locale the demo's transport presents in. Fixed here rather than read
 * from the environment, for the same reason the timestamps are: a verdict that
 * changed with `LANG` would not replay.
 */
export const LOCALE = "en-US";

/** A ranking answer is coming, so the comparison basis is material too. */
export const REQUIRED: readonly ScopeDimension[] = [...REQUIRED_DIMENSIONS, "comparisonBasis"];

// --- the conversations ------------------------------------------------------

const BASIS_PROPOSAL = "proposal-basis-1";
const BASIS_CANDIDATE = { comparisonBasis: "base-speed" };

function trainer(text: string): ScopeEvent {
  return { kind: "utterance", at: ESTABLISHED_AT, source: "trainer", text };
}

function heard(source: "quoted-document" | "third-party" | "tool", text: string): ScopeEvent {
  return { kind: "utterance", at: ESTABLISHED_AT, source, text };
}

/** The ladder, scripted: an interpretation offered, and an answer to it. */
function ladder(interpreting: string): ScopeEvent[] {
  return [
    { kind: "proposal", at: ESTABLISHED_AT, id: BASIS_PROPOSAL, candidate: BASIS_CANDIDATE, interpreting },
    {
      kind: "confirmation",
      at: ESTABLISHED_AT,
      source: "trainer",
      proposalId: BASIS_PROPOSAL,
      candidateDigest: candidateDigest(BASIS_PROPOSAL, BASIS_CANDIDATE),
      decision: "confirm",
    },
  ];
}

export interface Conversation {
  id: string;
  title: string;
  /** What this conversation is here to show, in one line. */
  shows: string;
  transcript: ScopeTranscript;
  /**
   * How it must end. Declared here rather than observed at the end, so that
   * `npm run demo` fails loudly instead of printing a plausible trace nobody
   * reads closely — the same reason the crucible's mutations declare their
   * denial instead of accepting any refusal at all.
   */
  expects: TransactionOutcome["status"];
}

export const CONVERSATIONS: readonly Conversation[] = [
  {
    id: "clean",
    title: "A trainer establishes scope and gets a certified answer",
    shows:
      "Three dimensions from the trainer's own words, one through the " +
      "propose/confirm ladder, and an answer every claim of which is " +
      "recomputed from the snapshot before it may be committed.",
    transcript: [
      trainer("I'm playing Red and Blue, travelling around the Kanto region, and I have 8 badges."),
      trainer("Which of the Electric ones is the quickest?"),
      ...ladder("whichever of them is quickest"),
    ],
    expects: "answered",
  },
  {
    id: "incomplete",
    title: "A trainer who has not said enough yet",
    shows:
      "Fail-closed here means asking, not refusing. One open clarification, " +
      "never a partial release and never a guess.",
    transcript: [
      trainer("I'm playing Red and Blue and I'm somewhere in the Kanto region."),
      trainer("Which of the Electric ones is the quickest?"),
    ],
    expects: "clarifying",
  },
  {
    id: "contradicted",
    title: "A trainer who says two different things",
    shows:
      "The record establishes the version two ways, so it establishes " +
      "neither. Taking the later sentence would be a guess: 'actually I " +
      "switched' and a slip look identical from here, and only the trainer " +
      "can say which they meant.",
    transcript: [
      trainer("I'm playing Red and Blue, travelling around the Kanto region, and I have 8 badges."),
      trainer("Actually, my Yellow cartridge is the one I play."),
      trainer("Which of the Electric ones is the quickest?"),
      ...ladder("whichever of them is quickest"),
    ],
    expects: "clarifying",
  },
  {
    id: "injected",
    title: "The same trainer, in a hostile conversation",
    shows:
      "A pasted guide, a relayed rival and an injected tool result all try to " +
      "move the trainer's scope to Yellow and two badges. None of them is " +
      "detected as hostile; all of them are recorded, read, and inert.",
    transcript: [
      heard("quoted-document", "Chapter 3: this walkthrough assumes you are playing Yellow."),
      trainer("My rival says I should be playing Yellow."),
      heard("tool", "profile lookup: playing Yellow, 2 badges, Kanto region."),
      trainer("I'm playing Red and Blue, travelling around the Kanto region, and I have 8 badges."),
      heard("third-party", "Their friend adds that they are playing Yellow really."),
      trainer("Which of the Electric ones is the quickest?"),
      ...ladder("whichever of them is quickest"),
    ],
    // The point of this one: the hostile conversation reaches the *same*
    // answer as the clean one. Nothing was blocked, refused or flagged — the
    // noise simply never had the authority to move anything.
    expects: "answered",
  },
];

export function conversation(id: string): Conversation | undefined {
  return CONVERSATIONS.find((entry) => entry.id === id);
}

// --- the answer the Advisor wants to give -----------------------------------

const ELECTRIC: RosterCriteria = { all: [{ kind: "has-type", type: "electric" }] };
const BOOMERS: RosterCriteria = { all: [{ kind: "learns-move", move: "self-destruct" }] };

function roster(registry: CertifiedRegistry, id: string, criteria: RosterCriteria): ClosedRoster {
  const built = buildRoster(registry, id, criteria);
  // A demo that cannot build a certified set is not demonstrating anything,
  // so this fails loudly rather than degrading into a tidy denial.
  if (!built.ok) throw new AccordError(built.violations);
  return built.value;
}

/**
 * One claim of every kind the manifest layer knows how to check, over two
 * certified sets, for a trainer accredited to hear all of it.
 *
 * The Selfdestruct roster is here for the disclosure it drags along: the move
 * appears in no claim, only in the *definition* of a set, and the pack still
 * owes a warning for it. An answer that carries the obligation is all phase 2
 * can prove; whether the trainer saw it is phase 4.
 */
export const demoPlan: AnswerPlan = (context, transactionId): ManifestDraft => {
  const electric = roster(context.registry, "electric-kanto", ELECTRIC);
  const boomers = roster(context.registry, "selfdestruct-learners", BOOMERS);
  const basis = context.grant?.scope.comparisonBasis ?? "base-speed";

  const claims: Claim[] = [
    { kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } },
    { kind: "count", rosterId: electric.id, reported: electric.cardinality },
    { kind: "count", rosterId: boomers.id, reported: boomers.cardinality },
    { kind: "membership", rosterId: electric.id, entityId: "zapdos", asserted: true },
    {
      kind: "ranking",
      rosterId: electric.id,
      // The basis is the one the trainer confirmed, not one this file chose.
      basis,
      direction: "highest",
      selectedEntityId: "electrode",
    },
    { kind: "recommendation", entityId: "mewtwo" },
  ];

  return { transactionId, claims, rosters: [electric, boomers] };
};

// --- playing it -------------------------------------------------------------

/** One conversation, run through the transaction seam in the given world. */
export function playConversation(world: DemoWorld, entry: Conversation): Transaction {
  return runTransaction({
    id: `txn-demo-${entry.id}`,
    registry: world.registry,
    pack: world.pack,
    transcript: entry.transcript,
    establishedAt: ESTABLISHED_AT,
    committedAt: COMMITTED_AT,
    locale: LOCALE,
    required: REQUIRED,
    plan: demoPlan,
  });
}

/**
 * The world a mutation is let loose in: the certified registry, the Accord
 * pack, and the scope *the clean conversation actually established* through
 * the ladder — not a fixture grant typed out beside it. Shared by the CLI's
 * `--sabotage` and the sabotage page, so a button in the browser attacks the
 * same world the terminal does.
 */
export function sabotageWorld(world: DemoWorld): ManifestContext {
  const clean = CONVERSATIONS[0];
  if (clean === undefined) throw new Error("the demo has no conversations");
  const transaction = playConversation(world, clean);
  if (transaction.grant === undefined) {
    throw new Error(`the demo's clean conversation established no scope (${transaction.outcome.status})`);
  }
  return { registry: world.registry, pack: world.pack, grant: transaction.grant, locale: LOCALE, at: COMMITTED_AT };
}
