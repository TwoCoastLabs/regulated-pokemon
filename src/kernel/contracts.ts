/**
 * Core contracts of the enforcement kernel (see docs/architecture.md).
 *
 * Design rules, in order of importance:
 * 1. Fail closed — a stage that cannot prove, refuses, and the refusal
 *    names its Accord article.
 * 2. No model output crosses a commit boundary without deterministic
 *    verification; the LLM lives only inside "propose" steps.
 * 3. Every verdict is a pure function of recorded, versioned inputs
 *    (IA-10: replay is re-execution, not logging).
 */

import type { ArticleId } from "./accord.js";
import type { StatName } from "./snapshot-format.js";

/** Typed material scope (IA-1). Established, never inferred. */
export interface TrainerScope {
  version: string; // e.g. "red-blue"
  region: string; // e.g. "kanto"
  badgeLevel: number; // accreditation for IA-5 gating
  comparisonBasis?: string; // e.g. "base-speed"
}

/** The dimensions of material scope, as things that can be talked about. */
export type ScopeDimension = keyof TrainerScope;

/** What a dimension may be bound to. Typed values only — never free text. */
export type ScopeValue = string | number;

/**
 * The channel a piece of text arrived on, assigned by the transport and never
 * inferred from the text itself (IA-8).
 *
 * This is the article's engineering consequence made structural: prompt
 * injection is an authority problem, not a detection problem, so a pasted
 * guide and a retrieved page are not classified as hostile — they arrive on a
 * channel the trainer does not speak on, and the resolver never reads them.
 */
export type UtteranceSource = "trainer" | "advisor" | "quoted-document" | "third-party" | "tool";

/** A typed interpretation offered for confirmation. Never authority itself. */
export type ScopeCandidate = Partial<TrainerScope>;

/**
 * How one dimension came to be bound. Recorded because a grant that states
 * only its conclusions is unfalsifiable: a scope established from the
 * trainer's own sentence and one established from a rival's reported wish
 * would be byte-identical, and IA-8 would have nothing to disagree with.
 */
export interface ScopeBinding {
  dimension: ScopeDimension;
  value: ScopeValue;
  /** Index into the recorded transcript of the event that bound it. */
  evidenceIndex: number;
  /**
   * `direct` — approved vocabulary in the trainer's own words.
   * `confirmed` — the trainer's confirmation of one stated interpretation.
   * `answer` — the trainer's direct reply to a recorded clarifying question;
   *   the question supplies the context a bare value lacks.
   */
  route: "direct" | "confirmed" | "answer";
  /** The exact wording this binding rests on, normalised for replay. */
  matchedText: string;
}

/**
 * One recorded conversational act. Proposals sit in the transcript beside
 * utterances rather than off to one side: what the model offered is part of
 * the record even when nothing came of it, and a verdict that depended on an
 * unrecorded proposal could not be replayed (IA-10).
 */
export type ScopeEvent =
  | { kind: "utterance"; at: string; source: UtteranceSource; text: string }
  | {
      /**
       * A clarifying question put to the trainer, recorded as evidence. Its
       * whole effect is context: the trainer's direct reply may bind this one
       * dimension on bare wording, because the question said what the words
       * are about. The channel decides here as everywhere (IA-8) — only the
       * advisor's own questions arm an answer, and the question text is in
       * the record so the leniency it granted is auditable.
       */
      kind: "question";
      at: string;
      source: UtteranceSource;
      dimension: ScopeDimension;
      text: string;
    }
  | {
      kind: "proposal";
      at: string;
      id: string;
      /** Typed values only, so a proposer cannot express one the vocabulary lacks. */
      candidate: ScopeCandidate;
      /** The wording this claims to interpret. Recorded, never binding. */
      interpreting: string;
    }
  | {
      kind: "confirmation";
      at: string;
      source: UtteranceSource;
      proposalId: string;
      /** Digest of the candidate as it was shown — not of the one on file now. */
      candidateDigest: string;
      decision: "confirm" | "reject";
    };

export type ScopeTranscript = readonly ScopeEvent[];

/** Proof that scope was established, with a validity window. */
export interface ScopeGrant {
  id: string;
  /** The Accord pack whose approved vocabulary read the evidence. */
  packId: string;
  scope: TrainerScope;
  /** One per bound dimension: the value, and the evidence it rests on. */
  bindings: readonly ScopeBinding[];
  /** Digest of the recorded transcript the bindings were derived from. */
  evidenceDigest: string;
  issuedAt: string; // RFC 3339
  expiresAt: string; // RFC 3339
}

/** A pinned certified registry version (IA-2). */
export interface CertifiedSnapshot {
  id: string;
  sourceCommit: string;
  sourceRepository: string;
}

/**
 * A resolved fact. `absent` is itself a certified answer — "this move has no
 * power" is a fact, distinct from "this snapshot does not certify power".
 *
 * A contract rather than a registry detail because claims assert these values
 * and verification compares them; both sides need the same vocabulary.
 */
export type FactValue =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string }
  | { kind: "list"; value: readonly string[] }
  | { kind: "absent" };

/**
 * A declarative set definition. Criteria are data, not code, so a roster can
 * be recomputed from its own definition during verification and replay.
 */
export type RosterCriterion =
  | { kind: "has-type"; type: string }
  | { kind: "learns-move"; move: string }
  | { kind: "rarity"; rarity: "legendary" | "mythical" }
  | { kind: "stat-at-least"; stat: StatName; value: number }
  | { kind: "stat-at-most"; stat: StatName; value: number };

/** Conjunction: a species is a member exactly when it satisfies every term. */
export interface RosterCriteria {
  all: readonly RosterCriterion[];
}

/** Closed-world certified set (IA-4): the roster IS the count. */
export interface ClosedRoster {
  id: string;
  snapshotId: string;
  criteria: RosterCriteria;
  /** Every member, in Pokédex order. Canonical order keeps replay exact. */
  memberIds: readonly string[];
  /**
   * The stated count. Deliberately redundant with `memberIds.length`: a
   * certificate that states its own cardinality can be caught disagreeing
   * with the set it encloses, which is how a tampered count is detected.
   */
  cardinality: number;
}

/**
 * The result of an operation that may refuse. Refusal carries named
 * violations rather than an empty or default value — a stage that cannot
 * prove, refuses (never returns "nothing found").
 */
export type Resolution<T> =
  | { ok: true; value: T }
  | { ok: false; violations: readonly Violation[] };

/**
 * One regulated assertion, in a form that can be disagreed with.
 *
 * Every kind records *what was said*, not merely what was consulted. A fact
 * claim that named only its fact id would be unfalsifiable: verification would
 * re-resolve the fact, get the right answer, and have nothing to compare it
 * to — a swapped stat would sail through. The asserted value is the thing the
 * verifier is checking, so it is part of the record.
 */
export type Claim =
  | { kind: "fact"; entityId: string; factId: string; asserted: FactValue }
  /**
   * A count over a certified roster.
   *
   * `reported` is derivable and therefore optional: the roster *is* the count
   * (IA-4), so a proposer that defines the set has already fixed the number, and
   * asking it to also state one is asking it to redo arithmetic the kernel
   * performs from the same criteria. When omitted, `compileManifest` fills it
   * from the certified cardinality; when present — a legacy answer, or an
   * adversary asserting a wrong one — it is verified against that cardinality and
   * refused on mismatch. Either way the committed count is the set's, never the
   * model's memory of it.
   */
  | { kind: "count"; rosterId: string; reported?: number }
  | { kind: "membership"; rosterId: string; entityId: string; asserted: boolean }
  | {
      kind: "ranking";
      rosterId: string;
      /** A certified fact id, e.g. "base-speed". Never a free-text basis. */
      basis: string;
      direction: "highest" | "lowest";
      /**
       * The extreme member, derivable and therefore optional — like a count's
       * number. The set, the basis and the direction already determine it; a
       * proposer that fixes those has fixed the winner, and computing it is the
       * kernel's arithmetic, not the model's memory. Omitted → `compileManifest`
       * fills it from the certified set (when there is a unique winner; a tie or
       * an unorderable basis stays unfilled and is refused by name). Present — a
       * legacy answer, or an adversary naming the wrong one — is verified against
       * the computed winner and refused on mismatch.
       */
      selectedEntityId?: string;
    }
  /**
   * A different speech act from `ranking`: "the fastest is Electrode" is a
   * claim about a set, "go and catch Mewtwo" is advice. IA-5 gates the second,
   * so it needs something of its own to gate.
   */
  | { kind: "recommendation"; entityId: string }
  /**
   * A consequential act the Advisor proposes to perform (IA-7, IA-9).
   *
   * Part of the certified answer because of what Article VII binds: an action
   * executes against "the exact certified answer the Trainer saw and
   * confirmed", so the act itself has to be *in* that answer and on that page.
   * An action assembled afterwards out of a chat message would be an act the
   * trainer confirmed nothing about — and an irreversible one could never have
   * triggered the disclosure Article IX owes, because nothing upstream of the
   * confirmation would have known it was coming.
   */
  | { kind: "action"; tool: string; entityId: string };

/**
 * The mandatory text a disclosure carries, named rather than quoted (IA-6).
 *
 * A manifest records which approved block it owes, not the words themselves.
 * The words live in the Accord pack, where they are reviewed and versioned; a
 * record that carried its own copy of them could be edited into agreement with
 * whatever ended up on screen, which is the one thing a disclosure must not be
 * able to do.
 */
export interface DisclosureBlockRef {
  id: string;
  version: number;
  locale: string;
  /** Digest over the block's normalised text in that locale. */
  digest: string;
}

/** A governed display unit (IA-6): text that must be customer-visible. */
export interface Exhibit {
  /** Unique in the manifest, and the unit id the artifact has to mark. */
  id: string;
  /**
   * The Accord pack rule that made it mandatory.
   *
   * Carried separately from `id` because one rule can owe more than one
   * disclosure: an answer proposing two irreversible acts owes a consent
   * notice for each, and the two are different units on the page.
   */
  rule: string;
  kind: "fact" | "count" | "selection" | "warning" | "provenance";
  /** The entity this discloses about, when a rule triggered on one. */
  entityId?: string;
  /**
   * For the consent notice an irreversible act owes (IA-9): the action it
   * discloses. The notice has to sit beside the act itself rather than beside
   * anything that happens to mention the same species.
   */
  tool?: string;
  block: DisclosureBlockRef;
  /** Article that triggered this exhibit, when it is a mandatory disclosure. */
  triggeredBy?: ArticleId;
}

/** The certified answer plan: what may be committed, and nothing else. */
export interface AnswerManifest {
  transactionId: string;
  scopeGrantId: string;
  snapshotId: string;
  /** The Accord pack version whose rules governed this answer (IA-5, IA-6). */
  packId: string;
  /**
   * The locale this answer was certified for presentation in.
   *
   * Part of the certified record rather than a display detail, because the
   * locale decides two things a verifier has to know: which approved formatter
   * turns a certified value into the string on the screen, and which approved
   * translation of a disclosure block satisfies it. Chosen by the transport, so
   * that nothing downstream can pick the locale whose rendering suits it.
   */
  locale: string;
  claims: readonly Claim[];
  /**
   * Every roster a claim cites, carried in the record rather than referenced
   * out of it. A count whose set lives elsewhere cannot be recomputed at
   * verification time and cannot be replayed at all (IA-10) — it would have to
   * be re-supplied from outside the record, which is the thing replay exists
   * to forbid.
   */
  rosters: readonly ClosedRoster[];
  exhibits: readonly Exhibit[];
}

/**
 * Derived from the FINAL rendered DOM — never from renderer claims (IA-6).
 *
 * Every field is read out of the artifact, including which transaction it is:
 * an affidavit that copied its subject from the manifest would agree with the
 * manifest by construction and could never catch the artifact disagreeing.
 */
export interface RenderAffidavit {
  transactionId: string;
  artifactDigest: string;
  renderedAt: string; // RFC 3339
  /** Every governed display unit the artifact marked, and whether it showed. */
  units: ReadonlyArray<{ id: string; visible: boolean }>;
}

/** The trainer's confirmation of the exact artifact they saw (IA-7). */
export interface ConfirmationEvent {
  id: string;
  transactionId: string;
  /**
   * The channel the transport assigned it. Only the trainer's binds (IA-8):
   * an injected tool result reading "the user confirmed" arrives here as a
   * recorded event on a channel that cannot consent, rather than as something
   * anyone has to detect.
   */
  source: UtteranceSource;
  /** Digest of the artifact as it was shown — not of the one on file now. */
  artifactDigest: string;
  confirmedAt: string; // RFC 3339
}

/** One consequential action, bound to the confirmed transaction (IA-7). */
export interface ActionGrant {
  transactionId: string;
  confirmationEventId: string;
  tool: string;
  entityId: string;
  scopeGrantId: string;
  authorizedAt: string; // RFC 3339
}

/** A named, replayable denial. Every denial cites its article. */
export interface Violation {
  article: ArticleId;
  rule: string; // stable slug, e.g. "fabricated-entity"
  message: string;
  expected?: string;
  actual?: string;
}

export interface Verdict {
  allowed: boolean;
  violations: readonly Violation[];
}
