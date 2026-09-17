/**
 * The activation ceiling (epic #94, slice 1): which deterministic front doors
 * engage on realistic wording, measured instead of assumed.
 *
 * Four deterministic layers stand in front of the model, and each trades
 * recall for specificity (CLAUDE.md lesson 6): **retrieval** pulls the
 * certified rows a question names; the **gated grammar** offers the filler
 * claim kinds a question nominates; the **scope resolver** binds a
 * dimension when a value word meets a context word; and the **lesson door**
 * (docs/lesson-door.md, added 2026-09-17) offers a lesson when the ask
 * contains one of its declared phrasings. A door that never engages
 * is a silent usefulness ceiling — the model is not helped, or is offered the
 * wrong grammar, or the trainer is asked a question their sentence already
 * answered — and nothing in a coverage run says which door failed. This module
 * asks each door directly, offline, over the wordings the banks already carry
 * plus a reviewed bank of scope statements, and reports the rate at which each
 * engaged.
 *
 * One reading is more than a usefulness number: a scope door that engages
 * *wrongly* — binds a value the trainer did not mean, from a tense the pattern
 * ignores or a pasted line the markers do not catch — is lesson 1's hazard
 * made visible, and `boundWrong` is reported apart from `unbound` for that
 * reason. Both fall closed downstream (a wrong binding meets the trainer's
 * true answer as a contradiction and becomes a question), but a front door
 * that mints values off pasted text is the thing to know about before a
 * second world widens the vocabulary.
 *
 * Pure and key-free: a function of the banks, the pack, the registry, and the
 * front doors' own code. No model, no snapshot change, no dollars.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ScopeDimension, ScopeTranscript, TrainerScope } from "../kernel/contracts.js";
import type { AccordPack } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import { deriveScope } from "../kernel/scope.js";
import { AccordError, violation } from "../kernel/violation.js";
import type { BankEntry, QuestionBank } from "./bank.js";
import { type FillerKind, nominateFillerKinds } from "./grammar-gate.js";
import { retrievalSelection } from "./reference.js";
import { type LessonMatcherId, lessonOffer } from "../session/lesson-matcher.js";
import { MUST_NOT_RESOLVE } from "./decline-ledger.js";

// --- the scope-phrasing bank ------------------------------------------------

export const SCOPE_BANK_PATH = resolve(import.meta.dirname, "../../data/playability/scope-phrasings.v1.json");
export const SCOPE_BANK_SCHEMA_VERSION = 1;

/** One realistic scope statement and what an honest reading of it binds. */
export interface ScopePhrasing {
  id: string;
  /** What the trainer typed, on their own channel. */
  say: string;
  /**
   * The dimensions the trainer's *own* words establish about themselves. Empty
   * when the sentence establishes nothing — reported speech, a pasted line, a
   * question. What the deterministic door *should* bind, not what it does.
   */
  expect: Partial<TrainerScope>;
  /** Why; and for a pasted or reported line, which limit it measures. */
  notes?: string;
}

export interface ScopePhrasingBank {
  bankVersion: typeof SCOPE_BANK_SCHEMA_VERSION;
  id: string;
  phrasings: readonly ScopePhrasing[];
}

const DIMENSIONS: readonly ScopeDimension[] = ["version", "region", "badgeLevel", "comparisonBasis"];

export function loadScopePhrasings(input: unknown): ScopePhrasingBank {
  const fail = (rule: string, message: string, actual?: string): never => {
    throw new AccordError([violation("IA-1", rule, message, actual === undefined ? undefined : { actual })]);
  };
  if (input === null || typeof input !== "object") fail("scope-bank-malformed", "the scope-phrasing bank is not an object");
  const doc = input as Partial<ScopePhrasingBank>;
  if (doc.bankVersion !== SCOPE_BANK_SCHEMA_VERSION) {
    fail("scope-bank-schema-unsupported", "the scope-phrasing bank schema version is not supported", String(doc.bankVersion));
  }
  if (typeof doc.id !== "string" || doc.id.length === 0) fail("scope-bank-malformed", "the scope-phrasing bank has no id");
  if (!Array.isArray(doc.phrasings) || doc.phrasings.length === 0) fail("scope-bank-malformed", "the scope-phrasing bank carries no phrasings");
  const seen = new Set<string>();
  for (const entry of doc.phrasings as ScopePhrasing[]) {
    const label = entry.id ?? "(unnamed)";
    if (typeof entry.id !== "string" || entry.id.length === 0) fail("scope-phrasing-unnamed", "a phrasing has no id");
    if (seen.has(entry.id)) fail("scope-phrasing-duplicate", `phrasing "${entry.id}" appears more than once`, entry.id);
    seen.add(entry.id);
    if (typeof entry.say !== "string" || entry.say.trim().length === 0) fail("scope-phrasing-empty", `phrasing "${label}" says nothing`, label);
    if (entry.expect === null || typeof entry.expect !== "object") fail("scope-phrasing-expect-malformed", `phrasing "${label}" has no expectation`, label);
    for (const key of Object.keys(entry.expect)) {
      if (!(DIMENSIONS as readonly string[]).includes(key)) fail("scope-phrasing-dimension-unknown", `phrasing "${label}" expects "${key}", which is not a dimension`, key);
    }
    if (Object.keys(entry.expect).length === 0 && (entry.notes ?? "").trim().length === 0) {
      // A sentence that should bind nothing is the interesting kind; it has to
      // say why, or the reviewer cannot tell a deliberate null from a lazy one.
      fail("scope-phrasing-null-unstated", `phrasing "${label}" expects nothing and does not say why`, label);
    }
  }
  return doc as ScopePhrasingBank;
}

export function readScopePhrasings(path: string = SCOPE_BANK_PATH): ScopePhrasingBank {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([violation("IA-1", "scope-bank-unreadable", `cannot read the scope-phrasing bank at ${path}: ${(cause as Error).message}`)]);
  }
  return loadScopePhrasings(parsed);
}

// --- the lesson-paraphrase bank ---------------------------------------------

export const LESSON_PARAPHRASES_PATH = resolve(import.meta.dirname, "../../data/playability/lesson-paraphrases.v1.json");
export const LESSON_PARAPHRASES_SCHEMA_VERSION = 1;

/** Fresh wordings of one lesson question — the second held-out set for the
 * lesson door, written before the alias widening of 2026-09-17 and never
 * the source of an alias. */
export interface LessonParaphrase {
  entryId: string;
  expectBlockIds: readonly string[];
  phrasings: readonly string[];
}

export interface LessonParaphraseBank {
  bankVersion: typeof LESSON_PARAPHRASES_SCHEMA_VERSION;
  id: string;
  entries: readonly LessonParaphrase[];
}

export function loadLessonParaphrases(input: unknown, bank: QuestionBank): LessonParaphraseBank {
  const fail = (rule: string, message: string, actual?: string): never => {
    throw new AccordError([violation("IA-1", rule, message, actual === undefined ? undefined : { actual })]);
  };
  if (input === null || typeof input !== "object") fail("lesson-paraphrases-malformed", "the lesson-paraphrase bank is not an object");
  const doc = input as Partial<LessonParaphraseBank>;
  if (doc.bankVersion !== LESSON_PARAPHRASES_SCHEMA_VERSION) {
    fail("lesson-paraphrases-schema-unsupported", "the lesson-paraphrase bank schema version is not supported", String(doc.bankVersion));
  }
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) fail("lesson-paraphrases-malformed", "the lesson-paraphrase bank carries no entries");
  const known = new Map(bank.entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  for (const entry of doc.entries as LessonParaphrase[]) {
    if (typeof entry.entryId !== "string" || !known.has(entry.entryId)) fail("lesson-paraphrase-unknown-entry", `paraphrases name "${String(entry.entryId)}", which the bank does not carry`, String(entry.entryId));
    if (seen.has(entry.entryId)) fail("lesson-paraphrase-duplicate", `paraphrases for "${entry.entryId}" appear more than once`, entry.entryId);
    seen.add(entry.entryId);
    const expected = known.get(entry.entryId)?.expectBlockIds ?? [];
    if (!Array.isArray(entry.expectBlockIds) || entry.expectBlockIds.join(",") !== expected.join(",")) {
      // The lesson a wording is meant to draw is the bank's oracle, restated
      // here so a reader sees it; it must not drift from the bank.
      fail("lesson-paraphrase-oracle-drift", `paraphrases for "${entry.entryId}" expect lessons the bank does not`, entry.expectBlockIds?.join(","));
    }
    if (!Array.isArray(entry.phrasings) || entry.phrasings.length === 0 || entry.phrasings.some((text) => typeof text !== "string" || text.trim().length === 0)) {
      fail("lesson-paraphrase-empty", `paraphrases for "${entry.entryId}" carry an empty wording`, entry.entryId);
    }
    // Held out means held out: a wording the bank already carries measures
    // the same thing twice under a different name.
    const bankWordings = new Set(wordingsOf(known.get(entry.entryId)!).map((text) => text.toLowerCase()));
    for (const text of entry.phrasings) {
      if (bankWordings.has(text.toLowerCase())) fail("lesson-paraphrase-not-held-out", `paraphrase "${text}" is already a wording of the bank entry`, text);
    }
  }
  return doc as LessonParaphraseBank;
}

export function readLessonParaphrases(bank: QuestionBank, path: string = LESSON_PARAPHRASES_PATH): LessonParaphraseBank {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([violation("IA-1", "lesson-paraphrases-unreadable", `cannot read the lesson-paraphrase bank at ${path}: ${(cause as Error).message}`)]);
  }
  return loadLessonParaphrases(parsed, bank);
}

// --- the four doors ---------------------------------------------------------

/** Every wording an entry carries: the canonical intent first, then its paraphrases. */
export function wordingsOf(entry: BankEntry): readonly string[] {
  return [entry.intent, ...(entry.phrasings ?? [])];
}

export interface DoorReading {
  entryId: string;
  wording: string;
  /** True for the canonical `intent`; false for a paraphrase. */
  canonical: boolean;
  engaged: boolean;
  /** For the lesson door: what it offered instead, when it missed — the
   * boundary alone reads as an empty list. Absent on the other doors. */
  offered?: readonly string[];
}

/**
 * Retrieval: for every entry whose subject oracle names an entity, did the
 * lexical door pull at least one acceptable entity's row? A miss means the
 * model answers ungrounded — safe, unhelped.
 */
export function retrievalReadings(registry: CertifiedRegistry, bank: QuestionBank): DoorReading[] {
  const readings: DoorReading[] = [];
  for (const entry of bank.entries) {
    const accepted = (entry.expectFacts ?? []).map((want) => want.entityId);
    if (accepted.length === 0) continue;
    wordingsOf(entry).forEach((wording, index) => {
      const pulled = retrievalSelection(registry, wording);
      const engaged = accepted.some((id) => pulled.species.has(id) || pulled.moves.has(id));
      readings.push({ entryId: entry.id, wording, canonical: index === 0, engaged });
    });
  }
  return readings;
}

const FILLER: readonly FillerKind[] = ["count", "typeCount", "gameRule"];

/**
 * The gated grammar: for every entry expecting a filler kind, did the cue
 * nominate it? A miss means the right shape is *unrepresentable* for that
 * wording — a forced deflection or abstention, by the door's own design.
 */
export function nominationReadings(bank: QuestionBank): DoorReading[] {
  const readings: DoorReading[] = [];
  for (const entry of bank.entries) {
    const wanted = (entry.expectClaimKinds ?? []).filter((kind): kind is FillerKind => (FILLER as readonly string[]).includes(kind));
    if (wanted.length === 0) continue;
    wordingsOf(entry).forEach((wording, index) => {
      const nominated = nominateFillerKinds(wording);
      readings.push({ entryId: entry.id, wording, canonical: index === 0, engaged: wanted.every((kind) => nominated.has(kind)) });
    });
  }
  return readings;
}

/**
 * The lesson door: for every entry whose answer is a lesson, did the door
 * offer one of the acceptable lessons for this wording? A miss means the
 * lesson is *unrepresentable* for that wording with the door on — the model
 * can teach only the boundary, so a right answer becomes a wrong decline.
 * The canonical intents are the wordings the aliases were written from; the
 * paraphrases are the ones they were not, and that column is the number.
 */
export function lessonReadings(world: { registry: CertifiedRegistry; pack: AccordPack }, bank: QuestionBank, matcher: LessonMatcherId = "alias"): DoorReading[] {
  const boundary = world.pack.recordsBoundary?.lessonId;
  const readings: DoorReading[] = [];
  for (const entry of bank.entries) {
    const acceptable = entry.expectBlockIds ?? [];
    if (acceptable.length === 0 || !(entry.expectClaimKinds ?? []).includes("explanation")) continue;
    wordingsOf(entry).forEach((wording, index) => {
      const offer = lessonOffer(matcher, world, wording);
      const engaged = acceptable.some((id) => offer.offered.includes(id));
      const instead = offer.offered.filter((id) => id !== boundary);
      readings.push({ entryId: entry.id, wording, canonical: index === 0, engaged, ...(engaged ? {} : { offered: instead }) });
    });
  }
  return readings;
}

/**
 * The lesson door on the second held-out set: the same reading as
 * {@link lessonReadings}, over wordings written after the aliases were
 * first read and never since used to write one. Every reading here is a
 * paraphrase; `canonical` is false throughout.
 */
export function lessonHeldOutReadings(world: { registry: CertifiedRegistry; pack: AccordPack }, paraphrases: LessonParaphraseBank, matcher: LessonMatcherId = "alias"): DoorReading[] {
  const boundary = world.pack.recordsBoundary?.lessonId;
  const readings: DoorReading[] = [];
  for (const entry of paraphrases.entries) {
    for (const wording of entry.phrasings) {
      const offer = lessonOffer(matcher, world, wording);
      const engaged = entry.expectBlockIds.some((id) => offer.offered.includes(id));
      const instead = offer.offered.filter((id) => id !== boundary);
      readings.push({ entryId: entry.entryId, wording, canonical: false, engaged, ...(engaged ? {} : { offered: instead }) });
    }
  }
  return readings;
}

/**
 * The lesson door's other half: for every entry that must not receive a
 * certified answer, did the door offer the boundary lesson *alone*? Any
 * concept or orientation lesson offered here is one the model may take in
 * place of a decline — the decline ledger's largest class (§23). Recall
 * above says what the door lets through; this says what it keeps out, and
 * a matcher is read on both or on neither.
 */
export function lessonPrecisionReadings(world: { registry: CertifiedRegistry; pack: AccordPack }, bank: QuestionBank, matcher: LessonMatcherId = "alias"): DoorReading[] {
  const boundary = world.pack.recordsBoundary?.lessonId;
  const readings: DoorReading[] = [];
  for (const entry of bank.entries) {
    if (!MUST_NOT_RESOLVE.includes(entry.disposition)) continue;
    wordingsOf(entry).forEach((wording, index) => {
      const offer = lessonOffer(matcher, world, wording);
      const instead = offer.offered.filter((id) => id !== boundary);
      const engaged = instead.length === 0;
      readings.push({ entryId: entry.id, wording, canonical: index === 0, engaged, ...(engaged ? {} : { offered: instead }) });
    });
  }
  return readings;
}

export type ScopeOutcome = "bound" | "unbound" | "bound-wrong" | "contradicted" | "inert";

export interface ScopeReading {
  id: string;
  say: string;
  outcome: ScopeOutcome;
  /** What the door bound, dimension → value. */
  bound: Partial<TrainerScope>;
  /** Matches the door saw and refused, with the rule — the evidence an attack reached it. */
  refused: readonly string[];
}

/**
 * The scope resolver, one utterance at a time on the trainer's channel:
 *
 *  - `bound`: every expected dimension bound to its expected value, nothing else.
 *  - `unbound`: something expected, nothing bound — the sentence falls to a
 *    question or the ladder (the usefulness ceiling).
 *  - `bound-wrong`: a dimension bound to a value the trainer did not mean, or
 *    bound where nothing should have been — lesson 1's hazard.
 *  - `contradicted`: the sentence bound a dimension two ways; nothing binds.
 *  - `inert`: nothing expected, nothing bound — a reported or pasted line the
 *    door read and refused, or never parsed.
 */
export function scopeReadings(pack: AccordPack, bank: ScopePhrasingBank): ScopeReading[] {
  return bank.phrasings.map((entry) => {
    const transcript: ScopeTranscript = [{ kind: "utterance", at: "2026-01-01T00:00:00Z", source: "trainer", text: entry.say }];
    const derivation = deriveScope(pack, transcript);
    const bound: Partial<TrainerScope> = {};
    for (const binding of derivation.bindings) (bound as Record<string, unknown>)[binding.dimension] = binding.value;
    const refused = derivation.ignored.map((match) => `${match.dimension}=${String(match.value)} (${match.blockedBy})`);
    const expectedKeys = Object.keys(entry.expect) as ScopeDimension[];
    const boundKeys = Object.keys(bound) as ScopeDimension[];
    let outcome: ScopeOutcome;
    if (derivation.contradicted.length > 0) outcome = "contradicted";
    else if (boundKeys.some((key) => !expectedKeys.includes(key) || bound[key] !== entry.expect[key])) outcome = "bound-wrong";
    else if (expectedKeys.length === 0) outcome = "inert";
    else if (expectedKeys.every((key) => bound[key] === entry.expect[key])) outcome = "bound";
    else outcome = "unbound";
    return { id: entry.id, say: entry.say, outcome, bound, refused };
  });
}

// --- the report -------------------------------------------------------------

export interface DoorRate {
  canonical: { engaged: number; total: number };
  paraphrase: { engaged: number; total: number };
}

export interface ActivationReport {
  retrieval: DoorRate;
  nomination: DoorRate;
  /** Which matcher the lesson door ran for this report. */
  lessonMatcher: LessonMatcherId;
  /** The lesson door's recall — an acceptable lesson offered on a lesson
   * question; absent when the pack declares no lesson coverage, since a
   * door that does not exist has no ceiling. */
  lesson?: DoorRate;
  /** The lesson door's precision — the boundary lesson alone offered on a
   * question that must not receive a certified answer. */
  lessonPrecision?: DoorRate;
  /** The lesson door's recall on the second held-out set
   * (data/playability/lesson-paraphrases.v1.json); absent when that bank
   * was not given, or the pack declares no coverage. */
  lessonHeldOut?: { engaged: number; total: number };
  scope: Record<ScopeOutcome, number>;
  /** The readings behind every number, so a rate is never the only record. */
  retrievalMisses: readonly DoorReading[];
  nominationMisses: readonly DoorReading[];
  lessonMisses: readonly DoorReading[];
  lessonPrecisionMisses: readonly DoorReading[];
  lessonHeldOutMisses: readonly DoorReading[];
  scopeReadings: readonly ScopeReading[];
}

function rate(readings: readonly DoorReading[]): DoorRate {
  const canonical = readings.filter((reading) => reading.canonical);
  const paraphrase = readings.filter((reading) => !reading.canonical);
  return {
    canonical: { engaged: canonical.filter((reading) => reading.engaged).length, total: canonical.length },
    paraphrase: { engaged: paraphrase.filter((reading) => reading.engaged).length, total: paraphrase.length },
  };
}

export function activationReport(
  registry: CertifiedRegistry,
  pack: AccordPack,
  bank: QuestionBank,
  scopeBank: ScopePhrasingBank,
  lessonMatcher: LessonMatcherId = "alias",
  lessonParaphrases?: LessonParaphraseBank,
): ActivationReport {
  const retrieval = retrievalReadings(registry, bank);
  const nomination = nominationReadings(bank);
  const declares = pack.curriculum.some((lesson) => lesson.covers !== undefined);
  const lesson = declares ? lessonReadings({ registry, pack }, bank, lessonMatcher) : [];
  const precision = declares ? lessonPrecisionReadings({ registry, pack }, bank, lessonMatcher) : [];
  const heldOut = declares && lessonParaphrases !== undefined ? lessonHeldOutReadings({ registry, pack }, lessonParaphrases, lessonMatcher) : [];
  const scope = scopeReadings(pack, scopeBank);
  const counts: Record<ScopeOutcome, number> = { bound: 0, unbound: 0, "bound-wrong": 0, contradicted: 0, inert: 0 };
  for (const reading of scope) counts[reading.outcome] += 1;
  return {
    retrieval: rate(retrieval),
    nomination: rate(nomination),
    lessonMatcher,
    ...(declares ? { lesson: rate(lesson), lessonPrecision: rate(precision) } : {}),
    ...(declares && lessonParaphrases !== undefined ? { lessonHeldOut: { engaged: heldOut.filter((reading) => reading.engaged).length, total: heldOut.length } } : {}),
    scope: counts,
    retrievalMisses: retrieval.filter((reading) => !reading.engaged),
    nominationMisses: nomination.filter((reading) => !reading.engaged),
    lessonMisses: lesson.filter((reading) => !reading.engaged),
    lessonPrecisionMisses: precision.filter((reading) => !reading.engaged),
    lessonHeldOutMisses: heldOut.filter((reading) => !reading.engaged),
    scopeReadings: scope,
  };
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "—" : `${part}/${whole} (${Math.round((part / whole) * 100)}%)`;
}

/** The report as Markdown for the findings log — rendered from the data, never hand-transcribed. */
export function renderActivation(report: ActivationReport): string {
  const lines: string[] = [];
  lines.push("| Door | Canonical wording | Paraphrases |");
  lines.push("|---|---:|---:|");
  lines.push(`| Retrieval pulled an acceptable entity | ${pct(report.retrieval.canonical.engaged, report.retrieval.canonical.total)} | ${pct(report.retrieval.paraphrase.engaged, report.retrieval.paraphrase.total)} |`);
  lines.push(`| Grammar nominated the expected filler kind | ${pct(report.nomination.canonical.engaged, report.nomination.canonical.total)} | ${pct(report.nomination.paraphrase.engaged, report.nomination.paraphrase.total)} |`);
  if (report.lesson !== undefined) {
    lines.push(`| Lesson door (${report.lessonMatcher}) offered an acceptable lesson | ${pct(report.lesson.canonical.engaged, report.lesson.canonical.total)} | ${pct(report.lesson.paraphrase.engaged, report.lesson.paraphrase.total)} |`);
  }
  if (report.lessonPrecision !== undefined) {
    lines.push(`| Lesson door (${report.lessonMatcher}) offered the boundary alone on a must-not-answer | ${pct(report.lessonPrecision.canonical.engaged, report.lessonPrecision.canonical.total)} | ${pct(report.lessonPrecision.paraphrase.engaged, report.lessonPrecision.paraphrase.total)} |`);
  }
  if (report.lessonHeldOut !== undefined) {
    lines.push(`| Lesson door (${report.lessonMatcher}) offered an acceptable lesson, second held-out set | — | ${pct(report.lessonHeldOut.engaged, report.lessonHeldOut.total)} |`);
  }
  lines.push("");
  const total = report.scopeReadings.length;
  lines.push(`Scope statements (${total}): bound ${report.scope.bound} · unbound ${report.scope.unbound} · **bound-wrong ${report.scope["bound-wrong"]}** · contradicted ${report.scope.contradicted} · inert ${report.scope.inert}`);
  lines.push("");
  if (report.retrievalMisses.length > 0) {
    lines.push("Retrieval misses:");
    lines.push("");
    for (const miss of report.retrievalMisses) lines.push(`- \`${miss.entryId}\`${miss.canonical ? " (canonical)" : ""}: “${miss.wording}”`);
    lines.push("");
  }
  if (report.nominationMisses.length > 0) {
    lines.push("Nomination misses:");
    lines.push("");
    for (const miss of report.nominationMisses) lines.push(`- \`${miss.entryId}\`${miss.canonical ? " (canonical)" : ""}: “${miss.wording}”`);
    lines.push("");
  }
  if (report.lessonMisses.length > 0) {
    lines.push("Lesson door misses (what the door offered instead; nothing means the boundary lesson alone):");
    lines.push("");
    for (const miss of report.lessonMisses) {
      lines.push(`- \`${miss.entryId}\`${miss.canonical ? " (canonical)" : ""}: “${miss.wording}” → ${(miss.offered ?? []).map((id) => `\`${id}\``).join(", ") || "boundary only"}`);
    }
    lines.push("");
  }
  if (report.lessonHeldOutMisses.length > 0) {
    lines.push("Lesson door misses on the second held-out set:");
    lines.push("");
    for (const miss of report.lessonHeldOutMisses) {
      lines.push(`- \`${miss.entryId}\`: “${miss.wording}” → ${(miss.offered ?? []).map((id) => `\`${id}\``).join(", ") || "boundary only"}`);
    }
    lines.push("");
  }
  if (report.lessonPrecisionMisses.length > 0) {
    lines.push("Lesson door offered a lesson on a question that must not be answered:");
    lines.push("");
    for (const miss of report.lessonPrecisionMisses) {
      lines.push(`- \`${miss.entryId}\`${miss.canonical ? " (canonical)" : ""}: “${miss.wording}” → ${(miss.offered ?? []).map((id) => `\`${id}\``).join(", ")}`);
    }
    lines.push("");
  }
  lines.push("Scope readings that were not `bound` or `inert`:");
  lines.push("");
  for (const reading of report.scopeReadings) {
    if (reading.outcome === "bound" || reading.outcome === "inert") continue;
    const boundText = Object.entries(reading.bound).map(([key, value]) => `${key}=${String(value)}`).join(", ") || "nothing";
    lines.push(`- \`${reading.id}\` **${reading.outcome}** — “${reading.say}” → bound ${boundText}${reading.refused.length > 0 ? `; refused ${reading.refused.join(", ")}` : ""}`);
  }
  return lines.join("\n");
}
