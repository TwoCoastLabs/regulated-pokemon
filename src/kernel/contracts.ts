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

/** Proof that scope was established, with a validity window. */
export interface ScopeGrant {
  id: string;
  scope: TrainerScope;
  /** Digest of the conversation evidence that established the scope. */
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

export type Claim =
  | { kind: "fact"; entityId: string; factId: string }
  | { kind: "count"; rosterId: string; reported: number }
  | { kind: "membership"; rosterId: string; entityId: string }
  | { kind: "ranking"; rosterId: string; basis: string; selectedEntityId: string };

/** A governed display unit (IA-6): fragments that must be customer-visible. */
export interface Exhibit {
  id: string;
  kind: "fact" | "count" | "selection" | "warning" | "provenance";
  entityId?: string;
  requiredFragments: readonly string[];
  /** Article that triggered this exhibit, when it is a mandatory disclosure. */
  triggeredBy?: ArticleId;
}

/** The certified answer plan: what may be committed, and nothing else. */
export interface AnswerManifest {
  transactionId: string;
  scopeGrantId: string;
  snapshotId: string;
  claims: readonly Claim[];
  exhibits: readonly Exhibit[];
}

/** Derived from the FINAL rendered DOM — never from renderer claims (IA-6). */
export interface RenderAffidavit {
  transactionId: string;
  artifactDigest: string;
  renderedAt: string; // RFC 3339
  exhibits: ReadonlyArray<{ id: string; visible: boolean }>;
}

/** The trainer's confirmation of the exact artifact they saw (IA-7). */
export interface ConfirmationEvent {
  id: string;
  transactionId: string;
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
