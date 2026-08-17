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
  FactValue,
  RosterCriteria,
  ScopeCandidate,
  ScopeDimension,
  ScopeValue,
} from "../kernel/contracts.js";
import type { ManifestContext, ManifestDraft } from "../kernel/manifest.js";
import { buildRoster } from "../kernel/roster.js";
import type { AccordPack } from "../kernel/pack.js";
import { denialCode } from "../kernel/violation.js";

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
  | { ok: true; draft: ManifestDraft }
  | { ok: false; reason: string };

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
      const asserted = asFactValue(value.asserted);
      if (asserted === null || !isString(value.entityId) || !isString(value.factId)) return null;
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
    case "membership":
      if (!isString(value.rosterId) || !isString(value.entityId) || !isBoolean(value.asserted)) return null;
      return { kind: "membership", rosterId: value.rosterId, entityId: value.entityId, asserted: value.asserted };
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
 * than smuggled downstream. Claims are carried verbatim — a swapped stat or a
 * wrong count survives decoding intact and is denied by `compileManifest`,
 * which is exactly where enforcement is proven.
 */
export function decodeAnswer(text: string, context: ManifestContext, transactionId: string): AnswerDecode {
  const parsed = parse(text);
  if (!isObject(parsed)) return { ok: false, reason: "answer was not a JSON object" };
  if (!Array.isArray(parsed.rosters) || !Array.isArray(parsed.claims)) {
    return { ok: false, reason: "answer is missing rosters or claims" };
  }

  const rosters = [];
  for (const entry of parsed.rosters) {
    if (!isObject(entry) || !isString(entry.id) || !isObject(entry.criteria) || !Array.isArray(entry.criteria.all)) {
      return { ok: false, reason: "a roster is malformed" };
    }
    const built = buildRoster(context.registry, entry.id, entry.criteria as unknown as RosterCriteria);
    if (!built.ok) {
      return { ok: false, reason: `a roster was refused: ${built.violations.map(denialCode).join(", ")}` };
    }
    rosters.push(built.value);
  }

  const claims = [];
  for (const entry of parsed.claims) {
    const claim = asClaim(entry);
    if (claim === null) return { ok: false, reason: "a claim is malformed" };
    claims.push(claim);
  }

  // An answer that asserts nothing is not an answer. Compiled, it would mint
  // a certified page whose only content is the standing provenance footer —
  // technically true, useless, and read by a visitor as "answered". The
  // honest reading of an empty claims list is that the model had nothing to
  // say, which is an abstention, and abstentions are counted, not certified.
  if (claims.length === 0) {
    return { ok: false, reason: "the answer asserts no claims at all" };
  }

  return { ok: true, draft: { transactionId, claims, rosters } };
}
