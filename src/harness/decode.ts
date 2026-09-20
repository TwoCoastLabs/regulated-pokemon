/**
 * The propose→structured boundary, and where it fails closed.
 *
 * A live model returns text. These decoders turn that text into the typed
 * things the kernel understands — a scope candidate, an answer draft — and
 * return nothing at all when they cannot. That "nothing" is the whole point: a
 * weak model that emits garbage does not get a guess made on its behalf, it
 * simply fails to propose, and the pipeline falls closed to a clarification or
 * a denial. A malformed answer is a *usefulness* miss, never a safety hole.
 *
 * Two rules that look similar and are not:
 *  - Malformed structure is rejected here (no dimension, wrong type, not JSON).
 *  - A *well-formed lie* is carried through faithfully — a fabricated stat, a
 *    wrong count — because catching those is the kernel's job, not the parser's.
 *    Sanitising them here would move enforcement into an untested guess; leaving
 *    them for `compileManifest` is what makes the enforcement metric mean
 *    something. The decoder is deliberately gullible about truth and strict
 *    about shape.
 */

import type {
  Claim,
  ClarificationOption,
  FactValue,
  RosterCriteria,
  ScopeCandidate,
  ScopeDimension,
  ScopeValue,
} from "../kernel/contracts.js";
import { type ManifestContext, type ManifestDraft, MAX_SUGGESTIONS } from "../kernel/manifest.js";
import { buildRoster } from "../kernel/roster.js";
import { type AccordPack, NO_FIELD } from "../kernel/pack.js";
import { denialCode } from "../kernel/violation.js";
import { canonicalizeClaims, canonicalizeCriteria } from "./canonical.js";
import { MAX_ANSWER_CLAIMS, MAX_ANSWER_ROSTERS, MAX_ASKED, MAX_CLARIFY_OPTIONS } from "./schema.js";

// --- tiny typed predicates --------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value: unknown): value is string {
  return typeof value === "string";
}
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * Unwrap a markdown code fence, and nothing else.
 *
 * A live model asked for JSON routinely returns it inside ```json … ```. That
 * is packaging the chat transport put around the reply, not a claim the model
 * made, so unwrapping it costs no strictness. Everything past this point is as
 * strict as before — in particular there is deliberately no "find the first
 * `{`" salvage: scanning prose for something JSON-shaped is being lenient about
 * *shape*, which is the one thing this decoder may not be.
 */
function unfence(text: string): string {
  const fenced = /^```[a-zA-Z0-9]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(text.trim());
  return fenced === null ? text : fenced[1] ?? "";
}

function parse(text: string): unknown {
  const source = unfence(text);
  if (source.trim() === "") return undefined;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
}

// --- scope candidates -------------------------------------------------------

export interface DecodedCandidate {
  candidate: ScopeCandidate;
  interpreting: string;
}

/**
 * Decode a proposed interpretation of long-tail wording.
 *
 * The pack decides which dimensions exist and what type each holds, so a
 * candidate naming an unknown dimension, or a value of the wrong type, is not a
 * candidate. Whether the value is one the *vocabulary* approves is not checked
 * here — the kernel re-checks a confirmed candidate against approved vocabulary,
 * so a decoder that duplicated that would only get to disagree with it.
 */
export function decodeCandidate(text: string, pack: AccordPack): DecodedCandidate | null {
  const parsed = parse(text);
  if (!isObject(parsed)) return null;
  if (!isString(parsed.interpreting) || parsed.interpreting.trim() === "") return null;
  if (!isObject(parsed.candidate)) return null;

  const types = new Map<ScopeDimension, "text" | "number">(
    pack.vocabulary.dimensions.map((rule) => [rule.dimension, rule.valueType]),
  );

  const candidate: Partial<Record<ScopeDimension, ScopeValue>> = {};
  const entries = Object.entries(parsed.candidate);
  if (entries.length === 0) return null;
  for (const [key, value] of entries) {
    const type = types.get(key as ScopeDimension);
    if (type === undefined) return null;
    if (type === "number" && !isNumber(value)) return null;
    if (type === "text" && !isString(value)) return null;
    candidate[key as ScopeDimension] = value as ScopeValue;
  }
  return { candidate: candidate as ScopeCandidate, interpreting: parsed.interpreting };
}

// --- answers ----------------------------------------------------------------

export type AnswerDecode =
  | {
      ok: true;
      draft: ManifestDraft;
      folds: number;
      route?: RouteNomination;
      /** The model's schema linking (R3b): each thing asked for, linked to a
       * certified field or to none. Empty when the reply carried no mapping
       * — the checks that read it then have nothing to hold the claims to. */
      asked: readonly AskedField[];
      unavailable?: readonly Unavailable[];
      /** The clarification the model nominated instead of answering (R3b
       * step 3), when it did. Decoded for shape; the driver validates every
       * option against the dictionary and the registry and decides whether
       * the question is asked at all. */
      clarify?: ClarifyNomination;
      /** Follow-up questions the model offered (R3b step 4), trimmed and
       * non-empty, at most {@link MAX_SUGGESTIONS}; the driver applies the
       * topic-not-value guard before any reaches a draft. */
      suggestions?: readonly string[];
    }
  | { ok: false; reason: string };

/** A clarification as the model wrote it: the phrase it is about, the
 * question in the model's words, and the typed options it offers. Options
 * that are not one of the two typed shapes are dropped here; whether the
 * ids they name exist is the driver's check. */
export interface ClarifyNomination {
  about: string;
  question: string;
  options: readonly ClarificationOption[];
}

/** One link of the model's schema linking: the trainer's phrase, the subject
 * it is about, and the certified field the model read it as — `null` when
 * the model says the records certify no such field. */
export interface AskedField {
  phrase: string;
  entityId: string;
  fieldId: string | null;
}

/** What the model was asked for and could not certify (epic #145, R3): a
 * subject and the trainer's own phrase for the thing — derived from every
 * `asked` entry linked to no field, reported to the trainer as the records'
 * boundary, never compiled, never certified. */
export interface Unavailable {
  entityId: string;
  asked: string;
}

/**
 * A route the model nominated instead of (or beside) composing — decoded,
 * never trusted: the driver validates the id and every argument against its
 * own catalogue, and an unknown or malformed nomination is simply ignored.
 * Carried raw so the catalogue's argument shapes stay the driver's business.
 */
export interface RouteNomination {
  routeId: string;
  [arg: string]: unknown;
}

/**
 * The reason a well-formed reply carrying zero claims is refused. Exported
 * because it is a distinct *signal*, not just an error string: a model that
 * asserts nothing on a granted ask is abstaining, and one that asserts nothing
 * on the grantless discovery call is reporting the question off-domain (epic
 * #64, slice 2). Both read this one constant so the two cannot drift.
 */
export const NO_CLAIMS_REASON = "the answer asserts no claims at all";

function asFactValue(value: unknown): FactValue | null {
  if (!isObject(value)) return null;
  switch (value.kind) {
    case "number":
      return isNumber(value.value) ? { kind: "number", value: value.value } : null;
    case "boolean":
      return isBoolean(value.value) ? { kind: "boolean", value: value.value } : null;
    case "text":
      return isString(value.value) ? { kind: "text", value: value.value } : null;
    case "list":
      return isStringArray(value.value) ? { kind: "list", value: value.value } : null;
    case "absent":
      return { kind: "absent" };
    default:
      return null;
  }
}

function asClaim(value: unknown): Claim | null {
  if (!isObject(value)) return null;
  switch (value.kind) {
    case "fact": {
      // `asserted` is optional: naming the fact is enough, and the kernel
      // reads the certified value. Present-but-malformed is still malformed.
      if (!isString(value.entityId) || !isString(value.factId)) return null;
      if (value.asserted === undefined) return { kind: "fact", entityId: value.entityId, factId: value.factId };
      const asserted = asFactValue(value.asserted);
      if (asserted === null) return null;
      return { kind: "fact", entityId: value.entityId, factId: value.factId, asserted };
    }
    case "count": {
      // `reported` is optional: a model that defines the set need not count it,
      // and the kernel derives the number. A present-but-non-numeric one is
      // still malformed; an absent one is the intended, grounded shape.
      if (!isString(value.rosterId)) return null;
      if (value.reported !== undefined && !isNumber(value.reported)) return null;
      return value.reported === undefined
        ? { kind: "count", rosterId: value.rosterId }
        : { kind: "count", rosterId: value.rosterId, reported: value.reported };
    }
    case "typeCount": {
      // No roster and no entity: the type universe is fixed. `reported` is
      // optional exactly as a count's — the kernel fills it from the chart.
      if (value.reported !== undefined && !isNumber(value.reported)) return null;
      return value.reported === undefined ? { kind: "typeCount" } : { kind: "typeCount", reported: value.reported };
    }
    case "gameRule": {
      // Names a rule; the kernel looks up and fills the number, so `reported`
      // is optional exactly as a count's.
      if (!isString(value.ruleId)) return null;
      if (value.reported !== undefined && !isNumber(value.reported)) return null;
      return value.reported === undefined
        ? { kind: "gameRule", ruleId: value.ruleId }
        : { kind: "gameRule", ruleId: value.ruleId, reported: value.reported };
    }
    case "membership":
      if (!isString(value.rosterId) || !isString(value.entityId) || !isBoolean(value.asserted)) return null;
      return { kind: "membership", rosterId: value.rosterId, entityId: value.entityId, asserted: value.asserted };
    case "treats":
      // The verdict is the kernel's to derive from the closed effect set; a
      // present `asserted` is allowed (and verified), a malformed one is
      // malformed, and the pair alone is the intended, grounded shape.
      if (
        !isString(value.itemId) ||
        !isString(value.condition) ||
        (value.asserted !== undefined && !isBoolean(value.asserted))
      ) {
        return null;
      }
      return value.asserted === undefined
        ? { kind: "treats", itemId: value.itemId, condition: value.condition }
        : { kind: "treats", itemId: value.itemId, condition: value.condition, asserted: value.asserted };
    case "comparison":
      // No values: the model names the fact and the pair, and the kernel
      // derives both sides, the gap and the leader — a wrong value is not a
      // reachable output under enforced decoding.
      if (!isString(value.factId) || !isString(value.leftId) || !isString(value.rightId)) return null;
      return { kind: "comparison", factId: value.factId, leftId: value.leftId, rightId: value.rightId };
    case "ranking": {
      // `selectedEntityId` is optional: the model declares the set and the
      // ordering, and the kernel names the winner. A present-but-non-string one
      // is still malformed.
      if (
        !isString(value.rosterId) ||
        !isString(value.basis) ||
        (value.direction !== "highest" && value.direction !== "lowest") ||
        (value.selectedEntityId !== undefined && !isString(value.selectedEntityId))
      ) {
        return null;
      }
      const base = { kind: "ranking", rosterId: value.rosterId, basis: value.basis, direction: value.direction } as const;
      return value.selectedEntityId === undefined ? base : { ...base, selectedEntityId: value.selectedEntityId };
    }
    case "matchup": {
      // No `members`: the model names the subject and the direction, and the
      // kernel derives the set from the chart — like a count's number, a wrong
      // list is not a reachable output under enforced decoding.
      const subject = value.subject;
      if (!isObject(subject)) return null;
      if (
        value.direction !== "weak-to" &&
        value.direction !== "resists" &&
        value.direction !== "immune-to" &&
        value.direction !== "strong-against"
      ) {
        return null;
      }
      // `members` is optional (the raw control arm states its own list; the
      // governed grammar never asks for one). Present-but-malformed is still
      // malformed.
      if (value.members !== undefined && !(Array.isArray(value.members) && value.members.every(isString))) {
        return null;
      }
      const members = value.members as readonly string[] | undefined;
      if (subject.kind === "species" && isString(subject.entityId)) {
        const base = { kind: "matchup", subject: { kind: "species", entityId: subject.entityId }, direction: value.direction } as const;
        return members === undefined ? base : { ...base, members };
      }
      if (subject.kind === "type" && isString(subject.typeId)) {
        const base = { kind: "matchup", subject: { kind: "type", typeId: subject.typeId }, direction: value.direction } as const;
        return members === undefined ? base : { ...base, members };
      }
      return null;
    }
    case "eligibility": {
      // No `finding`: the model names the species and the kernel derives what
      // the rules say — verdict, governing rule, threshold, the trainer's own
      // badge level. A stated finding (the raw arm's shape) is read strictly;
      // whether it is *true* is the verifier's question, not the decoder's.
      if (!isString(value.entityId)) return null;
      if (value.finding === undefined) return { kind: "eligibility", entityId: value.entityId };
      const finding = value.finding;
      if (
        !isObject(finding) ||
        !isBoolean(finding.eligible) ||
        !isNumber(finding.badgeLevel) ||
        (finding.ruleId !== undefined && !isString(finding.ruleId)) ||
        (finding.minimumBadgeLevel !== undefined && !isNumber(finding.minimumBadgeLevel))
      ) {
        return null;
      }
      return {
        kind: "eligibility",
        entityId: value.entityId,
        finding: {
          eligible: finding.eligible,
          badgeLevel: finding.badgeLevel,
          ...(finding.ruleId === undefined ? {} : { ruleId: finding.ruleId }),
          ...(finding.minimumBadgeLevel === undefined ? {} : { minimumBadgeLevel: finding.minimumBadgeLevel }),
        },
      };
    }
    case "explanation":
      // The grammar already narrows blockId to the catalogue; the decoder only
      // reads the shape. Whether the lesson exists is the verifier's question,
      // so a hand-written id still decodes and then refuses by name.
      return isString(value.blockId) ? { kind: "explanation", blockId: value.blockId } : null;
    case "recommendation":
      return isString(value.entityId) ? { kind: "recommendation", entityId: value.entityId } : null;
    case "action":
      if (!isString(value.tool) || !isString(value.entityId)) return null;
      return { kind: "action", tool: value.tool, entityId: value.entityId };
    default:
      return null;
  }
}

/**
 * Decode a proposed answer into a draft the kernel can certify.
 *
 * Rosters are built through the kernel's own {@link buildRoster}, so a set the
 * registry cannot support is refused here with the article it earned rather
 * than smuggled downstream. Claims are carried verbatim in *content* — a
 * swapped stat or a wrong count survives decoding intact and is denied by
 * `compileManifest`, which is exactly where enforcement is proven. Entity
 * *names*, though, are read in their canonical surface form
 * ({@link canonicalizeClaims}): "Bulbasaur" is `bulbasaur` and "selfdestruct"
 * is `self-destruct` — the same name, spelled the way the snapshot spells it.
 * A name that is not a surface form of any certified id passes through
 * unchanged and earns its IA-3 exactly as before.
 */
export function decodeAnswer(text: string, context: ManifestContext, transactionId: string): AnswerDecode {
  const parsed = parse(text);
  if (!isObject(parsed)) return { ok: false, reason: "answer was not a JSON object" };
  if (!Array.isArray(parsed.claims)) return { ok: false, reason: "answer is missing claims" };
  // A reply with no rosters key names no roster — the same as an empty
  // list. Found by the governance-tax leg (weak model, decoding free,
  // 2026-09-11): 200 of 231 unusable raw replies were answers that simply
  // omitted the key; a claim citing a roster it never named still fails
  // below, where it is read. (Structured output always emits the key.)
  const rosterList: unknown = parsed.rosters ?? [];
  if (!Array.isArray(rosterList)) return { ok: false, reason: "rosters is not a list" };

  const rosters = [];
  for (const entry of rosterList.slice(0, MAX_ANSWER_ROSTERS)) {
    if (!isObject(entry) || !isString(entry.id) || !isObject(entry.criteria) || !Array.isArray(entry.criteria.all)) {
      return { ok: false, reason: "a roster is malformed" };
    }
    const built = buildRoster(context.registry, entry.id, canonicalizeCriteria(context.registry, entry.criteria as unknown as RosterCriteria));
    if (!built.ok) {
      // The message rides with the code — "x" is not a move certified by
      // … — so a carry-back can name what to fix (session.ts, the refused-roster round).
      return { ok: false, reason: `a roster was refused: ${built.violations.map((one) => `${denialCode(one)} (${one.message})`).join(", ")}` };
    }
    rosters.push(built.value);
  }

  // The schema linking (R3b), read strictly like everything else: an entry
  // that is not a phrase, a subject and a field is malformed. Absent
  // entirely — a scripted model, the control arm — is an empty mapping, not
  // an error: the checks that read it simply have nothing to hold to.
  const asked: AskedField[] = [];
  if (parsed.asked !== undefined) {
    if (!Array.isArray(parsed.asked)) return { ok: false, reason: "asked is not a list" };
    for (const entry of parsed.asked.slice(0, MAX_ASKED)) {
      if (!isObject(entry) || !isString(entry.phrase) || !isString(entry.entityId) || !isString(entry.fieldId)) {
        return { ok: false, reason: "an asked entry is malformed" };
      }
      asked.push({ phrase: entry.phrase, entityId: entry.entityId, fieldId: entry.fieldId === NO_FIELD ? null : entry.fieldId });
    }
  }
  // A phrase linked to no field is the model saying the records do not hold
  // it (the R3a abstention, now a structural reading of the mapping rather
  // than a grammar variant of its own). Lifted out, never compiled.
  const unavailable: Unavailable[] = asked.flatMap((entry) =>
    entry.fieldId === null ? [{ entityId: entry.entityId, asked: entry.phrase }] : [],
  );

  const claims: Claim[] = [];
  let folds = 0;
  let route: RouteNomination | undefined;
  let clarify: ClarifyNomination | undefined;
  let suggestions: readonly string[] | undefined;
  for (const entry of parsed.claims) {
    // A nomination travels in the claims array (one more grammar variant)
    // but is not a claim: it names a deterministic door, and it never
    // reaches compilation. First one wins; the rest are noise.
    if (isObject(entry) && entry.kind === "route" && isString(entry.routeId)) {
      route ??= entry as unknown as RouteNomination;
      continue;
    }
    // A clarification likewise (R3b step 3): at most one per turn — the
    // first wins — and one whose options are all malformed is no
    // clarification at all, dropped here, so the claims beside it stand as
    // they would have.
    if (isObject(entry) && entry.kind === "clarify") {
      if (!isString(entry.about) || !isString(entry.question)) return { ok: false, reason: "a clarification is malformed" };
      const options = Array.isArray(entry.options) ? entry.options.slice(0, MAX_CLARIFY_OPTIONS).flatMap(asClarificationOption) : [];
      if (clarify === undefined && options.length > 0) clarify = { about: entry.about, question: entry.question, options };
      continue;
    }
    // Follow-up suggestions (R3b step 4) travel the same way and are not
    // claims either: the first entry wins, the strings are trimmed, and an
    // empty one is no suggestion.
    if (isObject(entry) && entry.kind === "suggest") {
      if (!Array.isArray(entry.asks)) return { ok: false, reason: "a suggestion list is malformed" };
      const asks = entry.asks.filter(isString).map((ask) => ask.trim()).filter((ask) => ask.length > 0).slice(0, MAX_SUGGESTIONS);
      if (suggestions === undefined && asks.length > 0) suggestions = asks;
      continue;
    }
    const claim = asClaim(entry);
    if (claim === null) return { ok: false, reason: "a claim is malformed" };
    // A comparison of a thing with itself compares nothing — it is one
    // entity's value wearing the comparison's clothes, so it is *folded to
    // the grounded shape it means*: the fact claim, which the kernel then
    // derives and verifies exactly as if the model had named it (recovery
    // channel 2 — deterministic, no guess about intent; the fold enacts the
    // prompt's own sentence). Loop 1 refused these outright and the refusal
    // killed whole answers: 23 abstentions in the re-run were exactly this
    // (findings iteration 40/41). The shape judgement stays propose-side —
    // a kernel rule would re-judge filed records, which IA-10 forbids —
    // and the fold is counted, so a folded resolution is never mistaken
    // for a first-shape one.
    if (claim.kind === "comparison" && claim.leftId === claim.rightId) {
      folds += 1;
      claims.push({ kind: "fact", entityId: claim.leftId, factId: claim.factId });
      continue;
    }
    // A claim whose subject is a lesson id is the lesson in the wrong
    // variant: the id comes from the prompt's closed lesson list and names
    // nothing else, so the shape the model meant is unambiguous. Found live
    // (dogfood, 2026-09-06): "what is a Pokemon" came back as an action —
    // and, on the verifier-in-the-loop retry, a fact — on the entity
    // "what-is-pokemon", denied twice as IA-3/fabricated-entity and filed
    // as a denial where the lesson was the answer. Same discipline as the
    // self-comparison fold: propose-side, deterministic, counted, and the
    // kernel still verifies the lesson like any other claim. Only ids the
    // pack teaches and the registry never certifies fold — a collision
    // would be the pack's to refuse, not this line's to guess at.
    if ((claim.kind === "fact" || claim.kind === "action" || claim.kind === "recommendation") && isLessonId(context, claim.entityId)) {
      folds += 1;
      claims.push({ kind: "explanation", blockId: claim.entityId.trim() });
      continue;
    }
    claims.push(claim);
  }
  const canonical = canonicalizeClaims(context.registry, claims);
  // A claim stated twice proves nothing twice — it is the repetition loop's
  // residue inside the grammar's budget (docs/scale.md, S1), and rendered it
  // reads as a stutter. Value-identical claims fold to their first statement:
  // deterministic, order-preserving, propose-side — the kernel still verifies
  // every survivor exactly as before. Canonical form first, so "Pikachu" and
  // "pikachu" are the same statement here too. A comparison is the same
  // statement in either order — the kernel derives both values and which
  // leads, and which name comes first is presentation — so its key is the
  // pair sorted: found on the Kanto porch (2026-09-19), the strong model
  // stated all six stats as "Venusaur vs Ivysaur" and then again as
  // "Ivysaur vs Venusaur", twelve claims for six comparisons.
  const seen = new Set<string>();
  const deduped = canonical.filter((claim) => {
    const key = claim.kind === "comparison" ? JSON.stringify({ kind: claim.kind, factId: claim.factId, pair: [claim.leftId, claim.rightId].sort() }) : JSON.stringify(claim);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // The grammar's budget, enforced here as well as in the schema: an endpoint
  // that cannot accept `maxItems` (Google's rejects the keyword — the
  // provider folds it out, openrouter.ts) still ends at the same bound,
  // truncated exactly where a constrained decoder would have stopped:
  // first MAX kept, in order, after duplicates fold.
  const distinct = deduped.slice(0, MAX_ANSWER_CLAIMS);

  // An answer that asserts nothing is not an answer. Compiled, it would mint
  // a certified page whose only content is the standing provenance footer —
  // technically true, useless, and read by a visitor as "answered". The
  // honest reading of an empty claims list is that the model had nothing to
  // say, which is an abstention, and abstentions are counted, not certified.
  if (claims.length === 0 && route === undefined && unavailable.length === 0 && clarify === undefined) {
    return { ok: false, reason: NO_CLAIMS_REASON };
  }

  return {
    ok: true,
    draft: { transactionId, claims: distinct, rosters },
    folds,
    asked,
    ...(route === undefined ? {} : { route }),
    ...(unavailable.length === 0 ? {} : { unavailable }),
    ...(clarify === undefined ? {} : { clarify }),
    ...(suggestions === undefined ? {} : { suggestions }),
  };
}

/** Whether an id is one of the pack's lesson ids and not an id the registry
 * certifies — the namespace test the lesson fold rests on. */
function isLessonId(context: ManifestContext, id: string): boolean {
  const trimmed = id.trim();
  if (!context.pack.curriculum.some((lesson) => lesson.id === trimmed)) return false;
  const { registry } = context;
  return !registry.speciesIds.includes(trimmed) && !registry.moveIds.includes(trimmed) && !registry.itemIds.includes(trimmed);
}

/** One typed option, or nothing: a `field` option names a dictionary id or
 * the reserved none (read here as `null`), an `entity` option a subject id.
 * Shape only — an id the dictionary or registry does not hold is the
 * driver's to drop. */
function asClarificationOption(value: unknown): ClarificationOption[] {
  if (!isObject(value) || !isString(value.label) || value.label.trim().length === 0) return [];
  if (value.kind === "field" && isString(value.fieldId)) {
    return [{ kind: "field", label: value.label.trim(), fieldId: value.fieldId === NO_FIELD ? null : value.fieldId }];
  }
  if (value.kind === "entity" && isString(value.entityId) && value.entityId.trim().length > 0) {
    return [{ kind: "entity", label: value.label.trim(), entityId: value.entityId.trim() }];
  }
  return [];
}
