/**
 * The playability question bank (epic #45, wave 1): a diverse set of player
 * questions, each tagged with what it is *expected* to do, loaded and
 * validated the way the Accord pack is.
 *
 * The bank is the load-bearing artifact of the whole epic, and it is *reviewed
 * data, not generated data* — a wrong disposition tag makes the coverage map
 * lie, so the loader is where a malformed or self-contradictory entry is caught
 * before a run is ever paid for. Same discipline as `loadPack`: fail closed,
 * named, at load.
 *
 * What the loader cannot check is the judgement itself — whether "how do I
 * evolve Pikachu?" is really `needs-claim-kind` rather than `needs-data`. That
 * is a human's call, and the bank does not ship until one has read it. The
 * loader's job is the mechanical half: every disposition is known, every
 * answerable names claim kinds the kernel actually has, every profile is
 * complete enough to establish scope, and the unanswerable entries say *why*
 * they cannot be answered — the note that becomes the coverage map's roadmap.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ScopeValue, TrainerScope } from "../kernel/contracts.js";
import { REQUIRED_DIMENSIONS } from "../kernel/scope.js";
import { AccordError, violation } from "../kernel/violation.js";
import { type Disposition, DISPOSITIONS, type ExpectedFact } from "./playability.js";

/** The shipped bank on disk — the same bytes a live run reads. */
export const BANK_PATH = resolve(import.meta.dirname, "../../data/playability/bank.v1.json");

export const BANK_SCHEMA_VERSION = 1;

/**
 * The eight claim kinds a certified answer may assert. Pinned here as the
 * closed list an `answerable` entry may name, and kept in step with the
 * `Claim` union in `kernel/contracts.ts` by {@link bank.test}. A kind outside
 * this list is a kind the kernel cannot compile, so an entry expecting it
 * could never pass.
 */
export const CLAIM_KINDS = ["fact", "count", "typeCount", "gameRule", "membership", "treats", "comparison", "ranking", "matchup", "eligibility", "explanation", "recommendation", "action"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/** One question, and the disposition it was authored to have. */
export interface BankEntry {
  id: string;
  /** The canonical phrasing. Wave 3 adds paraphrases beside it. */
  intent: string;
  /** The trainer profile the simulated trainer answers scope questions from.
   * Complete on purpose: the bank measures the *answer* ceiling, not scope. */
  profile: TrainerScope;
  disposition: Disposition;
  /** For `answerable`/`should-refuse`: the claim kinds a good answer asserts —
   * the oracle, never a script. Absent for the unanswerable dispositions. */
  expectClaimKinds?: readonly ClaimKind[];
  /**
   * For entries expecting an `explanation`: the catalogue lessons any of which
   * answers this question — the routing oracle. Scoring reads it as routing
   * accuracy: a committed lesson outside this list is a mis-teach, the
   * curriculum's own species of deflection.
   */
  expectBlockIds?: readonly string[];
  /**
   * For entries expecting a `fact`: the certified facts any of which an
   * on-target answer asserts — the subject oracle (epic #87, slice 1),
   * parallel to `expectBlockIds` for lessons. `factId` omitted accepts any
   * certified fact about that entity (the open-summary case). Required for
   * fact-expecting resolving entries: without it, a certified answer about
   * the wrong subject scores as a pass, which is the gap the field closes.
   */
  expectFacts?: readonly ExpectedFact[];
  /**
   * Frozen paraphrases of the same intent — terse, verbose, misspelled — beside
   * the canonical `intent`. Fixtures, authored once and reviewed, never varied
   * at run time (a run that changed its own inputs would not replay). The
   * robustness reading asks whether the wording moves the funnel bucket.
   */
  phrasings?: readonly string[];
  /** Why this disposition. Required for the unanswerable dispositions, where
   * it names the specific ceiling — the coverage map reads it as the roadmap. */
  notes?: string;
}

export interface QuestionBank {
  bankVersion: typeof BANK_SCHEMA_VERSION;
  id: string;
  entries: readonly BankEntry[];
}

/** Dispositions whose whole point is a ceiling; each must name it in `notes`. */
const UNANSWERABLE: readonly Disposition[] = ["needs-data", "needs-claim-kind"];

function isClaimKind(value: unknown): value is ClaimKind {
  return typeof value === "string" && (CLAIM_KINDS as readonly string[]).includes(value);
}

/**
 * Validate a parsed bank, or refuse it by name.
 *
 * Every check is one an unreviewed or drifted bank fails: an entry pointing at
 * a disposition the scorer never heard of, an `answerable` naming a claim kind
 * the kernel cannot compile, a profile too thin to establish scope, an
 * unanswerable entry with no stated ceiling, two entries sharing an id. All of
 * them would produce a coverage-map number that means nothing.
 */
export function loadBank(input: unknown): QuestionBank {
  const fail = (rule: string, message: string, actual?: string): never => {
    throw new AccordError([violation("IA-1", rule, message, actual === undefined ? undefined : { actual })]);
  };

  if (input === null || typeof input !== "object") fail("bank-malformed", "the question bank is not an object");
  const doc = input as Partial<QuestionBank>;

  if (doc.bankVersion !== BANK_SCHEMA_VERSION) {
    fail("bank-schema-unsupported", "the question bank schema version is not supported", String(doc.bankVersion));
  }
  if (typeof doc.id !== "string" || doc.id.length === 0) fail("bank-malformed", "the question bank has no id");
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) {
    fail("bank-malformed", "the question bank carries no entries");
  }

  const seen = new Set<string>();
  for (const entry of doc.entries as BankEntry[]) {
    const label = entry.id ?? "(unnamed)";
    if (typeof entry.id !== "string" || entry.id.length === 0) fail("bank-entry-unnamed", "an entry has no id");
    if (seen.has(entry.id)) fail("bank-duplicate-id", `entry "${entry.id}" appears more than once`, entry.id);
    seen.add(entry.id);

    if (typeof entry.intent !== "string" || entry.intent.trim().length === 0) {
      fail("bank-entry-empty", `entry "${label}" has no question text`, label);
    }
    if (!DISPOSITIONS.includes(entry.disposition)) {
      fail("bank-unknown-disposition", `entry "${label}" declares an unknown disposition`, String(entry.disposition));
    }

    // A profile too thin to establish scope would send the entry to scope
    // friction for a reason that is the bank's fault, not the model's.
    for (const dimension of REQUIRED_DIMENSIONS) {
      if (profileValue(entry.profile, dimension) === undefined) {
        fail("bank-profile-incomplete", `entry "${label}" has no ${dimension} in its profile`, label);
      }
    }

    if (
      entry.disposition === "answerable" ||
      entry.disposition === "advisory" ||
      entry.disposition === "gated-advisory" ||
      entry.disposition === "should-refuse"
    ) {
      if (!Array.isArray(entry.expectClaimKinds) || entry.expectClaimKinds.length === 0) {
        fail("bank-claims-missing", `entry "${label}" (${entry.disposition}) names no expected claim kind`, label);
      }
      for (const kind of entry.expectClaimKinds ?? []) {
        if (!isClaimKind(kind)) {
          fail("bank-claim-kind-unknown", `entry "${label}" expects "${String(kind)}", which is not a claim kind`, String(kind));
        }
      }
    }

    const expectsLesson = (entry.expectClaimKinds ?? []).includes("explanation");
    if (expectsLesson && (!Array.isArray(entry.expectBlockIds) || entry.expectBlockIds.length === 0)) {
      // An explanation entry with no routing oracle would score any lesson as
      // a pass — the mis-teach would be unmeasurable by construction.
      fail("bank-lessons-missing", `entry "${label}" expects an explanation and names no acceptable lesson`, label);
    }
    if (!expectsLesson && entry.expectBlockIds !== undefined) {
      fail("bank-lessons-unexpected", `entry "${label}" names lessons and does not expect an explanation`, label);
    }
    for (const blockId of entry.expectBlockIds ?? []) {
      if (typeof blockId !== "string" || blockId.trim().length === 0) {
        fail("bank-lesson-empty", `entry "${label}" carries an empty lesson id`, label);
      }
    }

    const resolving =
      entry.disposition === "answerable" ||
      entry.disposition === "advisory" ||
      entry.disposition === "gated-advisory" ||
      entry.disposition === "should-refuse";
    const expectsFact = (entry.expectClaimKinds ?? []).includes("fact");
    if (resolving && expectsFact && (!Array.isArray(entry.expectFacts) || entry.expectFacts.length === 0)) {
      // A fact entry with no subject oracle would score any certified fact as
      // a pass — the subject deflection would be unmeasurable by construction.
      fail("bank-facts-missing", `entry "${label}" expects a fact and names no acceptable fact`, label);
    }
    if (!expectsFact && entry.expectFacts !== undefined) {
      fail("bank-facts-unexpected", `entry "${label}" names facts and does not expect a fact`, label);
    }
    for (const want of entry.expectFacts ?? []) {
      if (want === null || typeof want !== "object" || typeof want.entityId !== "string" || want.entityId.trim().length === 0) {
        fail("bank-fact-empty", `entry "${label}" carries an acceptable fact with no entity`, label);
      }
      if (want.factId !== undefined && (typeof want.factId !== "string" || want.factId.trim().length === 0)) {
        fail("bank-fact-empty", `entry "${label}" carries an acceptable fact with an empty fact id`, label);
      }
    }

    if (UNANSWERABLE.includes(entry.disposition) && (entry.notes ?? "").trim().length === 0) {
      fail("bank-ceiling-unstated", `entry "${label}" (${entry.disposition}) must name the ceiling in its notes`, label);
    }

    if (entry.phrasings !== undefined) {
      if (!Array.isArray(entry.phrasings)) fail("bank-phrasings-malformed", `entry "${label}" has a non-array phrasings`, label);
      for (const phrasing of entry.phrasings) {
        if (typeof phrasing !== "string" || phrasing.trim().length === 0) {
          fail("bank-phrasing-empty", `entry "${label}" carries an empty paraphrase`, label);
        }
      }
    }
  }

  return doc as QuestionBank;
}

function profileValue(profile: TrainerScope | undefined, dimension: keyof TrainerScope): ScopeValue | undefined {
  return profile?.[dimension];
}

/** Read and validate the bank from disk. Throws named, never silently. */
export function readBank(path: string = BANK_PATH): QuestionBank {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([violation("IA-1", "bank-unreadable", `cannot read the question bank at ${path}: ${(cause as Error).message}`)]);
  }
  return loadBank(parsed);
}
