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

function parse(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
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
    case "count":
      if (!isString(value.rosterId) || !isNumber(value.reported)) return null;
      return { kind: "count", rosterId: value.rosterId, reported: value.reported };
    case "membership":
      if (!isString(value.rosterId) || !isString(value.entityId) || !isBoolean(value.asserted)) return null;
      return { kind: "membership", rosterId: value.rosterId, entityId: value.entityId, asserted: value.asserted };
    case "ranking":
      if (
        !isString(value.rosterId) ||
        !isString(value.basis) ||
        (value.direction !== "highest" && value.direction !== "lowest") ||
        !isString(value.selectedEntityId)
      ) {
        return null;
      }
      return {
        kind: "ranking",
        rosterId: value.rosterId,
        basis: value.basis,
        direction: value.direction,
        selectedEntityId: value.selectedEntityId,
      };
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

  return { ok: true, draft: { transactionId, claims, rosters } };
}
