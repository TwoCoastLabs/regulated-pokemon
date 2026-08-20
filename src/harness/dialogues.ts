/**
 * The dialogue bank (epic #54): scripted multi-turn conversations, each turn
 * tagged with what it is *expected* to do, loaded and validated the way the
 * single-turn bank is.
 *
 * The single-turn bank (bank.ts) measures one exchange in isolation — a fresh
 * session per question. That is deliberately blind to everything that only
 * exists *across* turns in one session: a scope grant established early and
 * reused (or gone stale) later, a recorded clarifying question arming the wrong
 * later utterance's answer route, deflection compounding down a thread, and the
 * ceremony cost of a whole task rather than a single question. `docs/
 * generalization.md` §10 names this as the unmeasured axis; a `dialogue` entry
 * is the instrument for it.
 *
 * A dialogue is one truthful trainer (the `profile`) speaking a fixed sequence
 * of `turns` into a single session. Every turn carries the same oracle a bank
 * entry does — a `disposition`, and for the resolving/refusing ones the claim
 * kinds a good answer asserts — so a turn is scored by exactly the machinery a
 * single-turn question is (playability.ts), just read from the record *that turn*
 * produced. The loader is the mechanical half of review, identical in spirit to
 * `loadBank`: fail closed, named, at load, before a run is ever paid for. The
 * judgement — is this really the disposition this turn deserves, in this
 * conversational context — is a human's, and the bank does not ship until one
 * has read it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ScopeValue, TrainerScope } from "../kernel/contracts.js";
import { REQUIRED_DIMENSIONS } from "../kernel/scope.js";
import { AccordError, violation } from "../kernel/violation.js";
import { type ClaimKind, CLAIM_KINDS } from "./bank.js";
import { type Disposition, DISPOSITIONS } from "./playability.js";

/** The shipped dialogue bank on disk — the same bytes a live run reads. */
export const DIALOGUE_BANK_PATH = resolve(import.meta.dirname, "../../data/playability/dialogues.v1.json");

export const DIALOGUE_BANK_SCHEMA_VERSION = 1;

/**
 * One turn of a scripted conversation: what the trainer says, and the oracle
 * for what that utterance should do *in the context of the turns before it*.
 * The oracle fields are exactly a bank entry's, so a turn scores through the
 * same {@link scoreDisposition} the single-turn bank uses.
 */
export interface DialogueTurn {
  /** The trainer's words this turn. The truthful-trainer driver answers any
   * clarifying questions this provokes from the dialogue's `profile`; only the
   * substantive asks are scripted here. */
  say: string;
  disposition: Disposition;
  /** For the resolving/refusing dispositions: the claim kinds a good answer to
   * this turn asserts — the oracle, never a script. Absent for the unanswerable
   * dispositions, exactly as in the single-turn bank. */
  expectClaimKinds?: readonly ClaimKind[];
  /** For a turn expecting an `explanation`: the catalogue lessons any of which
   * answers it — the routing oracle. A committed lesson outside this list is a
   * mis-teach, scored as a deflection like everywhere else. */
  expectBlockIds?: readonly string[];
  /** Why this disposition, in this position. Required for the unanswerable
   * dispositions, where it names the ceiling; useful everywhere to say what the
   * *cross-turn* point of the turn is (a reused grant, a stale one, a
   * deflection risk that only exists because of an earlier turn). */
  notes?: string;
}

/** One scripted conversation, and the trainer who speaks it. */
export interface DialogueEntry {
  id: string;
  /** The trainer profile the truthful driver answers scope questions from, for
   * the whole conversation. Complete on purpose: a dialogue measures the
   * *answer* and *cross-turn* ceilings, not scope establishment. */
  profile: TrainerScope;
  turns: readonly DialogueTurn[];
  /** What cross-turn behaviour this conversation exists to exercise — read by a
   * human reviewer and the docs, not by the scorer. */
  notes?: string;
}

export interface DialogueBank {
  bankVersion: typeof DIALOGUE_BANK_SCHEMA_VERSION;
  id: string;
  dialogues: readonly DialogueEntry[];
}

/** Dispositions that name a claim-kind oracle — the same set the single-turn
 * loader requires `expectClaimKinds` for. */
const NAMES_CLAIM_KINDS: readonly Disposition[] = ["answerable", "advisory", "gated-advisory", "should-refuse"];

/** Dispositions whose whole point is a ceiling; each turn must name it. */
const UNANSWERABLE: readonly Disposition[] = ["needs-data", "needs-claim-kind"];

function isClaimKind(value: unknown): value is ClaimKind {
  return typeof value === "string" && (CLAIM_KINDS as readonly string[]).includes(value);
}

function profileValue(profile: TrainerScope | undefined, dimension: keyof TrainerScope): ScopeValue | undefined {
  return profile?.[dimension];
}

/**
 * Validate a parsed dialogue bank, or refuse it by name.
 *
 * Every check mirrors `loadBank`, one level deeper: the bank holds dialogues,
 * each holds turns, and it is the turn that carries the disposition oracle. A
 * malformed turn is caught here rather than producing a coverage number that
 * means nothing — a turn tagged with a disposition the scorer never heard of,
 * an `answerable` turn naming a claim kind the kernel cannot compile, a profile
 * too thin to establish scope, an unanswerable turn with no stated ceiling.
 */
export function loadDialogues(input: unknown): DialogueBank {
  const fail = (rule: string, message: string, actual?: string): never => {
    throw new AccordError([violation("IA-1", rule, message, actual === undefined ? undefined : { actual })]);
  };

  if (input === null || typeof input !== "object") fail("dialogues-malformed", "the dialogue bank is not an object");
  const doc = input as Partial<DialogueBank>;

  if (doc.bankVersion !== DIALOGUE_BANK_SCHEMA_VERSION) {
    fail("dialogues-schema-unsupported", "the dialogue bank schema version is not supported", String(doc.bankVersion));
  }
  if (typeof doc.id !== "string" || doc.id.length === 0) fail("dialogues-malformed", "the dialogue bank has no id");
  if (!Array.isArray(doc.dialogues) || doc.dialogues.length === 0) {
    fail("dialogues-malformed", "the dialogue bank carries no conversations");
  }

  const seen = new Set<string>();
  for (const entry of doc.dialogues as DialogueEntry[]) {
    const label = entry.id ?? "(unnamed)";
    if (typeof entry.id !== "string" || entry.id.length === 0) fail("dialogue-unnamed", "a dialogue has no id");
    if (seen.has(entry.id)) fail("dialogue-duplicate-id", `dialogue "${entry.id}" appears more than once`, entry.id);
    seen.add(entry.id);

    // The profile too thin to establish scope would send the conversation to
    // scope friction for a reason that is the bank's fault, not the model's.
    for (const dimension of REQUIRED_DIMENSIONS) {
      if (profileValue(entry.profile, dimension) === undefined) {
        fail("dialogue-profile-incomplete", `dialogue "${label}" has no ${dimension} in its profile`, label);
      }
    }

    if (!Array.isArray(entry.turns) || entry.turns.length === 0) {
      fail("dialogue-empty", `dialogue "${label}" carries no turns`, label);
    }

    entry.turns.forEach((turn, index) => validateTurn(turn, `${label}#${index + 1}`, fail));
  }

  return doc as DialogueBank;
}

/** Validate one turn against the same rules a bank entry obeys. `where` names
 * the turn (`<dialogue>#<n>`) so a refusal points at the exact utterance. */
function validateTurn(
  turn: DialogueTurn,
  where: string,
  fail: (rule: string, message: string, actual?: string) => never,
): void {
  if (turn === null || typeof turn !== "object") fail("dialogue-turn-malformed", `turn ${where} is not an object`, where);
  if (typeof turn.say !== "string" || turn.say.trim().length === 0) {
    fail("dialogue-turn-empty", `turn ${where} has no trainer utterance`, where);
  }
  if (!DISPOSITIONS.includes(turn.disposition)) {
    fail("dialogue-turn-unknown-disposition", `turn ${where} declares an unknown disposition`, String(turn.disposition));
  }

  if (NAMES_CLAIM_KINDS.includes(turn.disposition)) {
    if (!Array.isArray(turn.expectClaimKinds) || turn.expectClaimKinds.length === 0) {
      fail("dialogue-turn-claims-missing", `turn ${where} (${turn.disposition}) names no expected claim kind`, where);
    }
    for (const kind of turn.expectClaimKinds ?? []) {
      if (!isClaimKind(kind)) {
        fail("dialogue-turn-claim-kind-unknown", `turn ${where} expects "${String(kind)}", which is not a claim kind`, String(kind));
      }
    }
  }

  const expectsLesson = (turn.expectClaimKinds ?? []).includes("explanation");
  if (expectsLesson && (!Array.isArray(turn.expectBlockIds) || turn.expectBlockIds.length === 0)) {
    fail("dialogue-turn-lessons-missing", `turn ${where} expects an explanation and names no acceptable lesson`, where);
  }
  if (!expectsLesson && turn.expectBlockIds !== undefined) {
    fail("dialogue-turn-lessons-unexpected", `turn ${where} names lessons and does not expect an explanation`, where);
  }
  for (const blockId of turn.expectBlockIds ?? []) {
    if (typeof blockId !== "string" || blockId.trim().length === 0) {
      fail("dialogue-turn-lesson-empty", `turn ${where} carries an empty lesson id`, where);
    }
  }

  if (UNANSWERABLE.includes(turn.disposition) && (turn.notes ?? "").trim().length === 0) {
    fail("dialogue-turn-ceiling-unstated", `turn ${where} (${turn.disposition}) must name the ceiling in its notes`, where);
  }
}

/** Read and validate the dialogue bank from disk. Throws named, never silently. */
export function readDialogues(path: string = DIALOGUE_BANK_PATH): DialogueBank {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([
      violation("IA-1", "dialogues-unreadable", `cannot read the dialogue bank at ${path}: ${(cause as Error).message}`),
    ]);
  }
  return loadDialogues(parsed);
}
