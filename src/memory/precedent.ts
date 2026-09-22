/**
 * The precedent store: memory the operator owns (docs/precedent.md, epic
 * #169 M1).
 *
 * A precedent is a filed exchange the kernel accepted and a person or the
 * bank's oracle judged on target — the trainer's own words, and the *shape*
 * of the answer that was accepted for them, with every value removed. The
 * driver retrieves the nearest few for a new ask and writes them into the
 * answer prompt as worked examples of which door to take. One rule holds the
 * whole thing to the architecture:
 *
 *   **Memory is a door, not an authority.** What enters it was accepted by
 *   the kernel and judged on target; the model never writes it; the verifier
 *   never reads it.
 *
 * So: the store is versioned data with a loader that fails closed on any id
 * the world does not certify and on any value a shape still carries; the
 * live path reads it and never writes it; retrieval is deterministic and
 * lexical, so a run replays; and a precedent's `shape` keeps `kind` and the
 * ids that name what was asked about — never an asserted value, a reported
 * number, a selected winner, a member list or a finding — so a stale number
 * cannot travel from an old record into a new answer. The kernel's modules
 * import nothing from here (pinned by test): a precedent is prompt context,
 * and the verdict never depends on it.
 *
 * No domain word lives in this file — it sits on the routing path and the
 * domain-word gate reads it — so the same module serves a Pokédex and a
 * drug label.
 */

import type { Claim, RosterCriteria } from "../kernel/contracts.js";
import { digestText } from "../kernel/digest.js";
import type { ManifestDraft } from "../kernel/manifest.js";
import type { AccordPack } from "../kernel/pack.js";
import { type CertifiedRegistry, ITEM_FACT_IDS, MOVE_FACT_IDS, SPECIES_FACT_IDS } from "../kernel/registry.js";
import { AccordError, violation } from "../kernel/violation.js";

export const PRECEDENT_SCHEMA_VERSION = 1;

/** A claim with its values removed: `kind` and the ids that name what it is
 * about. A plain object on purpose — the loader validates every field it
 * carries against the world, and {@link shapeOf} is the one writer. */
export type ClaimShape = Readonly<Record<string, unknown>> & { kind: string };

/** A roster as the model defined it: its criteria are the *question's*
 * parameters (a type, a move, a threshold), never the certified answer. */
export interface RosterShape {
  id: string;
  criteria: RosterCriteria;
}

/** A route nomination the driver served: its id and arguments, which are
 * the ask's parameters (how many, which set), not values. */
export interface RouteShape {
  routeId: string;
  args: Readonly<Record<string, string | number | boolean>>;
}

export interface PrecedentShape {
  claims: readonly ClaimShape[];
  rosters: readonly RosterShape[];
  route?: RouteShape;
}

export interface PrecedentSource {
  kind: "bank-run" | "session";
  /** The filed artifact (or trace) the record is in. */
  artifact: string;
  transactionId: string;
  /** The bank entry the run was of, when it was — the hold-out key. */
  entryId?: string;
}

export interface Precedent {
  id: string;
  /** Never offered against another snapshot. */
  snapshotId: string;
  /** The trainer's own words, verbatim. */
  ask: string;
  profile?: { version: string; region: string; badgeLevel: number };
  shape: PrecedentShape;
  source: PrecedentSource;
  promoted: { by: "oracle" | "reviewer"; at: string };
}

export interface PrecedentStore {
  schemaVersion: typeof PRECEDENT_SCHEMA_VERSION;
  /** The pack every precedent validates under. */
  packId: string;
  precedents: readonly Precedent[];
}

// --- the shape ---------------------------------------------------------------

/** The fields a claim shape keeps, per kind — the ids that name what was
 * asked about and the direction of the ask. Everything else a claim can
 * carry (`asserted`, `reported`, `selectedEntityId`, `members`, `finding`,
 * `left`, `right`) is a value, and a value never enters the store. */
const SHAPE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  fact: ["entityId", "factId"],
  count: ["rosterId"],
  typeCount: [],
  gameRule: ["ruleId"],
  membership: ["rosterId", "entityId"],
  treats: ["itemId", "condition"],
  comparison: ["factId", "leftId", "rightId"],
  ranking: ["rosterId", "basis", "direction"],
  matchup: ["subject", "direction"],
  eligibility: ["entityId"],
  explanation: ["blockId"],
  recommendation: ["entityId"],
  action: ["tool", "entityId"],
};

export const SHAPE_KINDS: readonly string[] = Object.keys(SHAPE_FIELDS);

/** One claim, values removed. */
export function claimShape(claim: Claim): ClaimShape {
  const fields = SHAPE_FIELDS[claim.kind] ?? [];
  const shape: Record<string, unknown> = { kind: claim.kind };
  const record = claim as unknown as Record<string, unknown>;
  for (const field of fields) if (record[field] !== undefined) shape[field] = record[field];
  return shape as ClaimShape;
}

/** A draft (or a certified manifest's claims and rosters), values removed —
 * the only writer of a precedent's shape. */
export function shapeOf(draft: Pick<ManifestDraft, "claims" | "rosters">, route?: RouteShape): PrecedentShape {
  return {
    claims: draft.claims.map(claimShape),
    rosters: draft.rosters.map((roster) => ({ id: roster.id, criteria: roster.criteria })),
    ...(route === undefined ? {} : { route }),
  };
}

/**
 * A shape in one canonical string, so two shapes compare by meaning: claims
 * sorted, keys sorted, and each roster id replaced by its criteria — the
 * model names its rosters freely ("all-pokemon", "all_pokemon"), and a name
 * is not part of the shape.
 */
export function canonicalShape(shape: PrecedentShape): string {
  const byId = new Map(shape.rosters.map((roster) => [roster.id, stable(roster.criteria)] as const));
  const claims = shape.claims
    .map((claim) => {
      const copy: Record<string, unknown> = { ...claim };
      if (typeof copy.rosterId === "string") copy.rosterId = byId.get(copy.rosterId) ?? copy.rosterId;
      return stable(copy);
    })
    .sort();
  const rosters = [...byId.values()].sort();
  return stable({ claims, rosters, route: shape.route === undefined ? null : stable(shape.route) });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

// --- the loader --------------------------------------------------------------

/**
 * Validate a parsed store against the world, or refuse it by name. Every
 * check is one an unreviewed store fails: a claim kind the grammar lacks, a
 * lesson or rule the pack does not carry, an entity or fact the registry
 * does not certify, a shape still carrying a value, a snapshot or pack the
 * store was not built for. A precedent cannot be a way to smuggle an id
 * into the prompt that the world does not hold, and it cannot carry a
 * number.
 */
export function loadPrecedentStore(input: unknown, world: { registry: CertifiedRegistry; pack: AccordPack }): PrecedentStore {
  const fail = (rule: string, message: string, actual?: string): never => {
    throw new AccordError([violation("IA-8", rule, message, actual === undefined ? undefined : { actual })]);
  };
  if (input === null || typeof input !== "object") fail("precedent-store-malformed", "the precedent store is not an object");
  const doc = input as Partial<PrecedentStore>;
  if (doc.schemaVersion !== PRECEDENT_SCHEMA_VERSION) {
    fail("precedent-schema-unsupported", "the precedent store schema version is not supported", String(doc.schemaVersion));
  }
  if (doc.packId !== world.pack.id) fail("precedent-pack-mismatch", "the precedent store was built for another pack", String(doc.packId));
  if (!Array.isArray(doc.precedents)) fail("precedent-store-malformed", "the precedent store carries no precedents list");

  const { registry, pack } = world;
  const entities = new Set([...registry.speciesIds, ...registry.moveIds, ...registry.itemIds]);
  const facts = new Set([...SPECIES_FACT_IDS, ...MOVE_FACT_IDS, ...ITEM_FACT_IDS]);
  const lessons = new Set(pack.curriculum.map((lesson) => lesson.id));
  const rules = new Set(pack.gameRules.map((rule) => rule.id));
  const tools = new Set(pack.actions.map((action) => action.id));
  const seen = new Set<string>();

  for (const precedent of doc.precedents as Precedent[]) {
    const label = typeof precedent?.id === "string" ? precedent.id : "(unnamed)";
    if (typeof precedent?.id !== "string" || precedent.id.length === 0) fail("precedent-unnamed", "a precedent has no id");
    if (seen.has(precedent.id)) fail("precedent-duplicate-id", `precedent "${label}" appears more than once`, label);
    seen.add(precedent.id);
    if (typeof precedent.snapshotId !== "string" || precedent.snapshotId.length === 0) {
      fail("precedent-world-unnamed", `precedent "${label}" names no snapshot`, label);
    }
    if (typeof precedent.ask !== "string" || precedent.ask.trim().length === 0) fail("precedent-ask-empty", `precedent "${label}" has no ask`, label);
    if (precedent.shape === null || typeof precedent.shape !== "object" || !Array.isArray(precedent.shape.claims) || !Array.isArray(precedent.shape.rosters)) {
      fail("precedent-shape-malformed", `precedent "${label}" has no shape`, label);
    }
    if (precedent.source === null || typeof precedent.source !== "object" || typeof precedent.source.transactionId !== "string") {
      fail("precedent-source-missing", `precedent "${label}" names no record it came from`, label);
    }
    if (precedent.promoted === null || typeof precedent.promoted !== "object" || (precedent.promoted.by !== "oracle" && precedent.promoted.by !== "reviewer")) {
      fail("precedent-unpromoted", `precedent "${label}" was promoted by nobody`, label);
    }
    for (const claim of precedent.shape.claims) {
      const fields = SHAPE_FIELDS[claim.kind] ?? fail("precedent-unknown-kind", `precedent "${label}" carries a claim kind the grammar lacks`, String(claim.kind));
      for (const key of Object.keys(claim)) {
        if (key !== "kind" && !fields.includes(key)) fail("precedent-value-carried", `precedent "${label}" carries a value in a ${claim.kind} claim`, key);
      }
      const named = (field: string): string | undefined => (typeof claim[field] === "string" ? (claim[field] as string) : undefined);
      for (const field of ["entityId", "leftId", "rightId", "itemId"]) {
        const id = named(field);
        if (id !== undefined && !entities.has(id)) fail("precedent-uncertified-entity", `precedent "${label}" names an entity the records do not certify`, id);
      }
      if (claim.kind === "matchup") {
        const subject = claim.subject as { kind?: string; entityId?: string; typeId?: string } | undefined;
        if (subject?.kind === "species" && (subject.entityId === undefined || !entities.has(subject.entityId))) {
          fail("precedent-uncertified-entity", `precedent "${label}" names a matchup subject the records do not certify`, String(subject.entityId));
        }
        if (subject?.kind === "type" && (subject.typeId === undefined || !registry.typeNames.has(subject.typeId))) {
          fail("precedent-uncertified-entity", `precedent "${label}" names a type the records do not certify`, String(subject.typeId));
        }
      }
      for (const field of ["factId", "basis"]) {
        const id = named(field);
        if (id !== undefined && !facts.has(id)) fail("precedent-uncertified-fact", `precedent "${label}" names a fact the records do not certify`, id);
      }
      const block = named("blockId");
      if (block !== undefined && !lessons.has(block)) fail("precedent-unknown-block", `precedent "${label}" names a lesson the pack does not carry`, block);
      const rule = named("ruleId");
      if (rule !== undefined && !rules.has(rule)) fail("precedent-unknown-rule", `precedent "${label}" names a rule the pack does not carry`, rule);
      const tool = named("tool");
      if (tool !== undefined && !tools.has(tool)) fail("precedent-unknown-tool", `precedent "${label}" names an act the pack does not allow`, tool);
    }
    for (const roster of precedent.shape.rosters) {
      if (typeof roster?.id !== "string" || roster.criteria === null || typeof roster.criteria !== "object" || !Array.isArray(roster.criteria.all)) {
        fail("precedent-shape-malformed", `precedent "${label}" carries a malformed roster`, label);
      }
    }
    if (precedent.shape.route !== undefined && (typeof precedent.shape.route.routeId !== "string" || typeof precedent.shape.route.args !== "object")) {
      fail("precedent-shape-malformed", `precedent "${label}" carries a malformed route`, label);
    }
  }
  return doc as PrecedentStore;
}

/** The store's digest, for an artifact to pin which memory a run held. */
export function precedentStoreDigest(store: PrecedentStore): string {
  return digestText(stable(store));
}

// --- retrieval ---------------------------------------------------------------

export interface PrecedentLevers {
  /** How many precedents a call may hold. */
  k: number;
  /** The least overlap a precedent must score to be offered. */
  threshold: number;
}

export const DEFAULT_PRECEDENT_LEVERS: PrecedentLevers = { k: 3, threshold: 0.25 };

/** What a bank run withholds so a precedent never answers for the entry it
 * was made from: the entry's id, and every wording of it. */
export interface HoldOut {
  entryId?: string;
  phrasings?: readonly string[];
}

/** One precedent as a call held it — enough for the trace to show what the
 * model was shown without the store in hand. */
export interface HeldPrecedent {
  id: string;
  score: number;
  ask: string;
  shape: PrecedentShape;
}

export interface Retrieval {
  held: readonly HeldPrecedent[];
  /** Precedents withheld under the hold-out rule, by id, with the reason. */
  withheld: readonly { id: string; reason: string }[];
  /** The best score under the threshold, when the door came up empty — so a
   * reader sees what the retriever almost offered. */
  nearestMiss?: { id: string; score: number; ask: string };
  /** Precedents about a named subject set aside because this ask names none
   * (only when the caller read the ask); absent when none were. */
  setAside?: number;
}

/**
 * Function words, so overlap is read on the words that carry the ask.
 * Structural only — articles, pronouns, auxiliaries, prepositions,
 * conjunctions, a greeting — so the list lints one world exactly as it
 * lints another; no domain word may ever appear here (the gate reads it).
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "this", "that", "these", "those", "some", "any",
  "i", "im", "me", "my", "mine", "we", "our", "you", "your", "it", "its", "they", "them", "their", "he", "she", "his", "her",
  "is", "are", "am", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "can", "could", "would", "should", "will", "shall", "may", "might", "must",
  "of", "to", "in", "on", "for", "at", "with", "by", "from", "about", "into", "over", "up", "out",
  "and", "or", "but", "if", "then", "so", "as", "than", "too", "very",
  "please", "hey", "hi", "hello", "thanks", "ok", "okay", "just", "also", "there", "here", "now",
]);

/** The words of an ask, folded the way the row retriever folds a name: lowercase, hyphens as spaces, punctuation gone, function words removed. */
export function askTokens(text: string): ReadonlySet<string> {
  const words = text
    .toLowerCase()
    // A possessive names the same thing as the noun ("pikachu's speed").
    .replace(/['']s\b/g, "")
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 0 && !FUNCTION_WORDS.has(word));
  return new Set(words);
}

/** Jaccard overlap of two token sets; 0 when either is empty. */
export function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function withheldReason(precedent: Precedent, holdOut: HoldOut | undefined): string | undefined {
  if (holdOut === undefined) return undefined;
  if (holdOut.entryId !== undefined && precedent.source.entryId === holdOut.entryId) return "made from this same bank entry";
  const ask = precedent.ask.trim().toLowerCase();
  if ((holdOut.phrasings ?? []).some((phrasing) => phrasing.trim().toLowerCase() === ask)) return "its ask is a wording of this same bank entry";
  return undefined;
}

/**
 * The nearest precedents for an ask — deterministic, so a run replays: token
 * overlap above the threshold, the top k in score order, ties broken first
 * by a shared named subject (`entities`: the ids the row retriever selected
 * for the ask), then by id. A precedent from another snapshot is never
 * offered; a precedent the hold-out names is withheld and said so.
 */
export function retrievePrecedents(
  store: PrecedentStore,
  ask: string,
  options: { snapshotId: string; levers?: PrecedentLevers; holdOut?: HoldOut; entities?: ReadonlySet<string> },
): Retrieval {
  const levers = options.levers ?? DEFAULT_PRECEDENT_LEVERS;
  const tokens = askTokens(ask);
  const withheld: { id: string; reason: string }[] = [];
  const scored: { precedent: Precedent; score: number; shared: boolean }[] = [];
  // An ask that names no certified subject (the retriever selected nothing)
  // is shown no precedent that was about one. Found live (dogfood
  // 2026-09-20, findings §38): "tell me about this game" shares one carrying
  // word with "Tell me everything about Pikachu.", scored exactly the
  // threshold, and was shown a six-fact profile as the door to take; the
  // strong model took it, for the game. A lesson, a rule, a count over a
  // type are about no named thing and are still offered. Only when the
  // caller read the ask (`entities` given): a retrieval that never looked
  // withholds nothing.
  const bare = options.entities !== undefined && options.entities.size === 0;
  let setAside = 0;
  for (const precedent of store.precedents) {
    if (precedent.snapshotId !== options.snapshotId) continue;
    const reason = withheldReason(precedent, options.holdOut);
    if (reason !== undefined) {
      withheld.push({ id: precedent.id, reason });
      continue;
    }
    if (bare && namesSubject(precedent)) {
      setAside += 1;
      continue;
    }
    const score = overlap(tokens, askTokens(precedent.ask));
    if (score === 0) continue;
    scored.push({ precedent, score, shared: sharesEntity(precedent, options.entities) });
  }
  scored.sort((a, b) => b.score - a.score || Number(b.shared) - Number(a.shared) || (a.precedent.id < b.precedent.id ? -1 : 1));
  const above = scored.filter((entry) => entry.score >= levers.threshold);
  const held = above.slice(0, levers.k).map(({ precedent, score }) => ({ id: precedent.id, score: round(score), ask: precedent.ask, shape: precedent.shape }));
  const miss = scored.find((entry) => entry.score < levers.threshold);
  return {
    held,
    withheld,
    ...(setAside > 0 ? { setAside } : {}),
    ...(held.length === 0 && miss !== undefined ? { nearestMiss: { id: miss.precedent.id, score: round(miss.score), ask: miss.precedent.ask } } : {}),
  };
}

/** Whether a precedent's shape is the profile bundle — every claim a fact
 * or a comparison about a named species, move or item, and nothing else.
 * Only that shape is set aside for a bare ask: it is the door an ask about
 * no one thing cannot take. A recommendation, an eligibility finding, a
 * ranking or a membership names a subject too, but is exactly the door
 * "build me a team" or "can I use a legendary" should be shown — the first
 * cut of this rule (2026-09-21, findings §38) set those aside as well, and
 * the team asks ran with no example at all; a lesson, a rule and a set
 * defined by criteria never named one. */
function namesSubject(precedent: Precedent): boolean {
  const claims = precedent.shape.claims;
  return (
    claims.length > 0 &&
    claims.every((claim) => {
      if (claim.kind === "fact") return typeof claim.entityId === "string";
      if (claim.kind === "comparison") return typeof claim.leftId === "string" || typeof claim.rightId === "string";
      return false;
    })
  );
}

/** The precedents named by id — the fixed arm of the measurement: the same
 * few on every call, whatever the ask, so a few-shot effect can be read
 * apart from a retrieval effect. Unknown ids are skipped, not invented. */
export function fixedPrecedents(store: PrecedentStore, ids: readonly string[], snapshotId: string): readonly HeldPrecedent[] {
  return ids.flatMap((id) => {
    const precedent = store.precedents.find((entry) => entry.id === id && entry.snapshotId === snapshotId);
    return precedent === undefined ? [] : [{ id, score: 1, ask: precedent.ask, shape: precedent.shape }];
  });
}

/** The fixed arm's default exemplars, chosen once from the store: the first
 * precedent of a lesson, of a fact and of a count, in store order — one of
 * each door, whatever the ask. */
export function defaultFixedIds(store: PrecedentStore, snapshotId: string): readonly string[] {
  const first = (kind: string): string | undefined =>
    store.precedents.find((entry) => entry.snapshotId === snapshotId && entry.shape.claims.length === 1 && entry.shape.claims[0]?.kind === kind)?.id;
  return ["explanation", "fact", "count"].flatMap((kind) => {
    const id = first(kind);
    return id === undefined ? [] : [id];
  });
}

function sharesEntity(precedent: Precedent, entities: ReadonlySet<string> | undefined): boolean {
  if (entities === undefined || entities.size === 0) return false;
  return precedent.shape.claims.some((claim) => {
    for (const field of ["entityId", "leftId", "rightId", "itemId"]) {
      const id = claim[field];
      if (typeof id === "string" && entities.has(id)) return true;
    }
    const subject = claim.subject as { entityId?: string } | undefined;
    return subject?.entityId !== undefined && entities.has(subject.entityId);
  });
}

function round(score: number): number {
  return Math.round(score * 100) / 100;
}

// --- the prompt section, and the reading after the verdict --------------------

/** A shape as the model is shown it: the accepted reply's JSON, ids and kinds only. */
export function renderShape(shape: PrecedentShape): string {
  const claims: unknown[] = shape.route === undefined ? [...shape.claims] : [{ kind: "route", routeId: shape.route.routeId, ...shape.route.args }, ...shape.claims];
  return JSON.stringify({ claims, rosters: shape.rosters });
}

/** Which held precedent the accepted draft took the shape of, if any —
 * computed after the verdict, deterministically, by canonical shape. Claims
 * and rosters only: a served route composes claims, and it is the composed
 * shape the draft carries. */
export function followed(draft: Pick<ManifestDraft, "claims" | "rosters">, held: readonly HeldPrecedent[]): HeldPrecedent | undefined {
  const own = canonicalShape(shapeOf(draft));
  return held.find((precedent) => canonicalShape({ claims: precedent.shape.claims, rosters: precedent.shape.rosters }) === own);
}
