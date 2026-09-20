/**
 * Follow-up suggestions the records can answer (docs/suggestions.md).
 *
 * A suggestion beside an answer is a promise: the trainer clicks it and
 * expects an answer. The register's first gate (suggestion-rule.ts) keeps a
 * value off it; this module keeps a *dead end* off it. Two readings, both
 * deterministic and neither a model call:
 *
 * 1. **Answerable** — a suggestion, the model's or the pack's, is held to the
 *    same readings the ask itself would face: the lesson door's alias
 *    matcher, for a lesson the pack declares coverage for; the dictionary's
 *    aliases, for a certified field — with "it" resolved to a subject the
 *    answer just named. A suggestion that reaches neither is dropped and
 *    counted. This errs toward dropping (the alias matcher's recall ceiling,
 *    CLAUDE.md lesson 6), which is the right side to err on: a dropped
 *    suggestion costs nothing, a dead end costs the trainer's trust.
 *
 * 2. **Offered** — the operator's own next steps, from the pack's `nextAsks`
 *    table (versioned data, held to its promise at load): after a lesson,
 *    the lessons the pack says follow it; after a comparison, the same pair
 *    on another field; after a listing, the set ranked by a field; after
 *    facts about one subject, its other fields — the ones an earlier
 *    accepted exchange asked for first, when the precedent store holds one.
 *    Never a text already shown or already asked in this session.
 *
 * The model's suggestions that pass come first — they are the
 * conversation's own — and the pack's fill the register to its cap. Nothing
 * here is enforcement: the kernel's gate still refuses a value, and the
 * manifest carries the texts by equality as before.
 */

import type { Claim } from "../kernel/contracts.js";
import type { ManifestDraft } from "../kernel/manifest.js";
import { type AccordPack, carriesPhrase, declaresLessonCoverage, type DictionaryEntry } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import { MAX_SUGGESTIONS, suggestionProblem } from "../kernel/suggestion-rule.js";
import type { PrecedentStore } from "../memory/precedent.js";
import { deriveScope } from "../kernel/scope.js";
import { lessonOffer } from "./lesson-matcher.js";

export interface NextAskWorld {
  registry: CertifiedRegistry;
  pack: AccordPack;
}

/** What a suggestion would be answered with — the reading that makes it
 * a promise the records can keep — or why it would not. */
export type Answerability =
  /** The lessons the door would offer for it — the model picks among them. */
  | { kind: "lesson"; lessonIds: readonly string[] }
  | { kind: "field"; fieldId: string }
  | { kind: "none"; reason: string };

/** The subjects an answer named, by what they are — read from the draft's
 * claims and rosters, filtered through the registry so a model's stray id
 * names nothing. */
export interface AnswerSubjects {
  species: readonly string[];
  moves: readonly string[];
  items: readonly string[];
}

function subjectIdsOf(claim: Claim): readonly string[] {
  switch (claim.kind) {
    case "fact":
    case "eligibility":
    case "recommendation":
    case "action":
    case "membership":
      return [claim.entityId];
    case "comparison":
      return [claim.leftId, claim.rightId];
    case "treats":
      return [claim.itemId];
    case "matchup":
      return claim.subject.kind === "species" ? [claim.subject.entityId] : [];
    default:
      return [];
  }
}

export function answerSubjects(registry: CertifiedRegistry, draft: Pick<ManifestDraft, "claims" | "rosters">): AnswerSubjects {
  const ids = new Set(draft.claims.flatMap(subjectIdsOf));
  return {
    species: registry.speciesIds.filter((id) => ids.has(id)),
    moves: registry.moveIds.filter((id) => ids.has(id)),
    items: registry.itemIds.filter((id) => ids.has(id)),
  };
}

/** The dictionary field a text asks for, by its longest alias carried;
 * nothing when it carries none. */
function fieldAskedFor(pack: AccordPack, text: string): DictionaryEntry | undefined {
  let best: { entry: DictionaryEntry; length: number } | undefined;
  for (const entry of pack.dictionary) {
    for (const alias of entry.aliases) {
      if (!carriesPhrase(text, alias)) continue;
      if (best === undefined || alias.length > best.length) best = { entry, length: alias.length };
    }
  }
  return best?.entry;
}

/**
 * Whether the records would answer this text, read as an ask is read: a
 * certified field about a subject the answer named first — "it" points at
 * the answer's subject, so a field needs one of its kind there, and "what
 * type is it?" beside a species is a fact, not the types lesson — then a
 * declared lesson (the boundary lesson is a refusal, never an answer). A
 * type-chart ask ("what is it weak to?") is answered for a species through
 * the matchup, so a species subject serves it.
 */
export function answerable(world: NextAskWorld, draft: Pick<ManifestDraft, "claims" | "rosters">, text: string): Answerability {
  const { pack } = world;
  const field = fieldAskedFor(pack, text);
  const subjects = answerSubjects(world.registry, draft);
  // "Them" after a listing or a count is the set: a roster's members are
  // species, so a species field is served (bank, 2026-09-20: "which of them
  // is the fastest?" after a count read as a field of no one).
  const listed = draft.rosters.length > 0 || draft.claims.some((claim) => claim.kind === "count" || claim.kind === "ranking" || claim.kind === "membership");
  const served =
    field === undefined
      ? false
      : field.subject === "species" || field.subject === "type"
        ? subjects.species.length > 0 || listed
        : field.subject === "move"
          ? subjects.moves.length > 0
          : subjects.items.length > 0;
  if (field !== undefined && served) {
    // A question asked beside a ranked or listed set will rank it, and a
    // ranking binds the scope's comparison basis on its way in. The
    // vocabulary's basis terms are single tokens and need a context word,
    // so "what about Special Defense?" binds nothing and the basis stays
    // the previous ranking's — and the ranking by Special Defense is then
    // denied under IA-1 (bank, 2026-09-20: the model's own suggestion).
    // Beside a set, a basis field must bind itself outright, the rule the
    // pack's rank wordings are pinned to.
    // "It" has no one to point at when the set is the only subject, so a
    // species field there is a ranking, and a field the vocabulary holds no
    // basis term for (Special Defense) cannot be ranked by at all.
    if (listed && subjects.species.length === 0 && field.subject === "species") {
      const basis = deriveScope(pack, [{ kind: "utterance", at: "1970-01-01T00:00:00.000Z", source: "trainer", text }]).bindings.find((binding) => binding.dimension === "comparisonBasis");
      if (basis?.value !== field.id) {
        return { kind: "none", reason: `asks to rank by ${field.name} without binding the comparison basis to it${basis === undefined ? "" : ` (it would bind ${String(basis.value)})`}, and would be denied` };
      }
    }
    return { kind: "field", fieldId: field.id };
  }
  if (declaresLessonCoverage(pack)) {
    const boundary = pack.recordsBoundary?.lessonId;
    const offered = lessonOffer("alias", { pack }, text).offered.filter((id) => id !== boundary);
    if (offered.length > 0) return { kind: "lesson", lessonIds: offered };
  }
  if (field === undefined) return { kind: "none", reason: "asks for nothing the lessons cover or the records certify" };
  return { kind: "none", reason: `asks for ${field.name} of a ${field.subject} the answer did not name` };
}

/** A suggestion the register will show, with where it came from and what
 * reading made it a promise. */
export interface NextAsk {
  text: string;
  source: "model" | "pack";
  via: Exclude<Answerability, { kind: "none" }>;
}

/** A suggestion the register will not show, and why. */
export interface DroppedAsk {
  text: string;
  source: "model" | "pack";
  /** Which gate dropped it: the register's rule (`value`), a repeat
   * (`duplicate`), the records' reach (`unanswerable`), or the cap. */
  cause: "value" | "duplicate" | "unanswerable" | "answered" | "cap";
  reason: string;
}

export interface NextAskOffer {
  kept: readonly NextAsk[];
  dropped: readonly DroppedAsk[];
}

/** The same question, said two ways, is one question: case, edge
 * punctuation and spacing folded. */
export function sameAsk(a: string, b: string): boolean {
  return foldText(a) === foldText(b);
}

function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

/** The fields a draft certifies, per subject — a comparison certifies its
 * field for both. */
export function certifiedIn(draft: Pick<ManifestDraft, "claims">): readonly { entityId: string; factId: string }[] {
  return draft.claims.flatMap((claim) =>
    claim.kind === "fact"
      ? [{ entityId: claim.entityId, factId: claim.factId }]
      : claim.kind === "comparison"
        ? [
            { entityId: claim.leftId, factId: claim.factId },
            { entityId: claim.rightId, factId: claim.factId },
          ]
        : [],
  );
}

/** What the session has already answered, so a next step is never a step
 * back: the lessons taught and the fields certified per subject, read
 * from the filed records (a comparison certifies its field for both). */
export interface AnswerHistory {
  lessons: readonly string[];
  fields: readonly { entityId: string; factId: string }[];
}

export interface CandidateOptions {
  store?: PrecedentStore;
  history?: AnswerHistory;
}

/**
 * The operator's candidates for this answer, in the order worth offering
 * them, before any exclusion: the reading of the draft decides which table
 * applies, so a listing is never followed by "how fast is it?" about no one
 * in particular, and a comparison is followed by the same pair again. What
 * the session already answered — this draft's claims and the history's —
 * is never offered: a lesson taught, a field certified for the subject.
 */
export function packCandidates(world: NextAskWorld, draft: Pick<ManifestDraft, "claims" | "rosters">, options: CandidateOptions = {}): readonly NextAsk[] {
  const table = world.pack.presentation.nextAsks;
  if (table === undefined) return [];
  const out: NextAsk[] = [];
  const push = (text: string, via: NextAsk["via"]): void => {
    if (!out.some((one) => sameAsk(one.text, text))) out.push({ text, source: "pack", via });
  };
  const subjects = answerSubjects(world.registry, draft);
  const history = options.history ?? { lessons: [], fields: [] };
  const taughtNow = draft.claims.flatMap((claim) => (claim.kind === "explanation" ? [claim.blockId] : []));
  const taught = new Set([...history.lessons, ...taughtNow]);
  const certified = [...history.fields, ...certifiedIn(draft)];
  const has = (entityId: string, factId: string): boolean => certified.some((one) => one.entityId === entityId && one.factId === factId);

  // After the records-boundary lesson — a decline — the pack's own way in.
  const boundary = world.pack.recordsBoundary?.lessonId;
  if (boundary !== undefined && taughtNow.includes(boundary)) {
    for (const lessonId of table.afterBoundary ?? []) {
      const wording = table.lessons[lessonId]?.ask;
      if (wording !== undefined && !taught.has(lessonId)) push(wording, { kind: "lesson", lessonIds: [lessonId] });
    }
  }

  // After a lesson: the lessons the pack says follow it, in its order.
  for (const lessonId of taughtNow) {
    for (const followId of table.lessons[lessonId]?.next ?? []) {
      if (taught.has(followId)) continue;
      const wording = table.lessons[followId]?.ask;
      if (wording !== undefined) push(wording, { kind: "lesson", lessonIds: [followId] });
    }
  }

  // After a comparison, or facts about the same two subjects: the pair on
  // the fields not yet certified for both.
  const compared = draft.claims.some((claim) => claim.kind === "comparison");
  const pair = subjects.species.length === 2 && subjects.moves.length === 0 ? subjects.species : undefined;
  if (compared || pair !== undefined) {
    const [left, right] = pair ?? [];
    for (const [fieldId, entry] of Object.entries(table.fields)) {
      if (entry.compare === undefined) continue;
      if (left !== undefined && right !== undefined && has(left, fieldId) && has(right, fieldId)) continue;
      push(entry.compare, { kind: "field", fieldId });
    }
    return out;
  }

  // After a listing: the set ranked by a field it was not ranked by.
  const listed = draft.rosters.length > 0 || draft.claims.some((claim) => claim.kind === "membership" || claim.kind === "count" || claim.kind === "ranking");
  if (listed) {
    const ranked = draft.claims.flatMap((claim) => (claim.kind === "ranking" ? [claim.basis] : []));
    for (const [fieldId, entry] of Object.entries(table.fields)) {
      if (entry.rank === undefined || ranked.includes(fieldId)) continue;
      push(entry.rank, { kind: "field", fieldId });
    }
    return out;
  }

  // After facts about exactly one subject: its other fields. The fields an
  // earlier accepted exchange asked for about this very subject come first
  // — the operator's memory says those are the questions trainers ask.
  const one = subjects.species.length === 1 && subjects.moves.length === 0 ? { id: subjects.species[0]!, kind: "species" } : subjects.moves.length === 1 && subjects.species.length === 0 ? { id: subjects.moves[0]!, kind: "move" } : undefined;
  if (one !== undefined) {
    const precedented = new Set(
      (options.store?.precedents ?? [])
        .filter((precedent) => precedent.snapshotId === world.registry.snapshot.id)
        .flatMap((precedent) => precedent.shape.claims)
        .flatMap((shape) => (shape.kind === "fact" && shape.entityId === one.id && typeof shape.factId === "string" ? [shape.factId] : [])),
    );
    const fields = Object.entries(table.fields).filter(([fieldId]) => {
      const entry = world.pack.dictionary.find((rule) => rule.id === fieldId);
      if (entry === undefined || has(one.id, fieldId)) return false;
      return one.kind === "species" ? entry.subject === "species" || entry.subject === "type" : entry.subject === "move";
    });
    const ordered = [...fields.filter(([fieldId]) => precedented.has(fieldId)), ...fields.filter(([fieldId]) => !precedented.has(fieldId))];
    for (const [fieldId, entry] of ordered) push(entry.ask, { kind: "field", fieldId });
  }
  return out;
}

/**
 * The register for one answer: the model's suggestions that pass both gates,
 * then the pack's, up to the cap; nothing shown or asked before in this
 * session. Each drop carries its reason so the ledger can say it.
 */
export function offerNextAsks(
  world: NextAskWorld,
  draft: Pick<ManifestDraft, "claims" | "rosters">,
  modelSuggestions: readonly string[],
  options: CandidateOptions & { excluded?: readonly string[]; cap?: number } = {},
): NextAskOffer {
  const cap = options.cap ?? MAX_SUGGESTIONS;
  const kept: NextAsk[] = [];
  const dropped: DroppedAsk[] = [];
  const history = options.history ?? { lessons: [], fields: [] };
  const taught = new Set([...history.lessons, ...draft.claims.flatMap((claim) => (claim.kind === "explanation" ? [claim.blockId] : []))]);
  const certified = [...history.fields, ...certifiedIn(draft)];
  const has = (entityId: string, factId: string): boolean => certified.some((one) => one.entityId === entityId && one.factId === factId);
  const subjects = answerSubjects(world.registry, draft);
  const subjectsOf = (fieldId: string): readonly string[] => {
    const subject = world.pack.dictionary.find((entry) => entry.id === fieldId)?.subject;
    return subject === "move" ? subjects.moves : subject === "item" ? subjects.items : subject === "type" ? [] : subjects.species;
  };
  const seen = (text: string): boolean => kept.some((one) => sameAsk(one.text, text)) || (options.excluded ?? []).some((earlier) => sameAsk(earlier, text));
  const consider = (text: string, source: "model" | "pack", via?: NextAsk["via"]): void => {
    if (kept.length >= cap) {
      dropped.push({ text, source, cause: "cap", reason: `the register holds ${cap}` });
      return;
    }
    const problem = suggestionProblem(world.registry, text);
    if (problem !== undefined) {
      dropped.push({ text, source, cause: "value", reason: problem });
      return;
    }
    if (seen(text)) {
      dropped.push({ text, source, cause: "duplicate", reason: "already shown or asked in this session" });
      return;
    }
    const reading = via ?? answerable(world, draft, text);
    if (reading.kind === "none") {
      dropped.push({ text, source, cause: "unanswerable", reason: reading.reason });
      return;
    }
    // A step back is no step: the lesson this very answer teaches, or a
    // field already certified for the subject, asked again (dogfood,
    // 2026-09-20: "what types are there?" beside the types lesson).
    if (reading.kind === "lesson" && reading.lessonIds.every((id) => taught.has(id))) {
      dropped.push({ text, source, cause: "answered", reason: "asks for a lesson this session already taught" });
      return;
    }
    if (reading.kind === "field" && subjectsOf(reading.fieldId).length > 0 && subjectsOf(reading.fieldId).every((id) => has(id, reading.fieldId))) {
      dropped.push({ text, source, cause: "answered", reason: "asks for a field this session already certified for the subject" });
      return;
    }
    kept.push({ text, source, via: reading });
  };
  for (const text of modelSuggestions) consider(text, "model");
  for (const candidate of packCandidates(world, draft, { ...(options.store === undefined ? {} : { store: options.store }), ...(options.history === undefined ? {} : { history: options.history }) })) {
    if (kept.length >= cap) break;
    consider(candidate.text, "pack", candidate.via);
  }
  return { kept, dropped };
}
