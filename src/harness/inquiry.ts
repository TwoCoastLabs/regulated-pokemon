/**
 * The realistic inquiry bank, and the expressibility pass over it (epic #94,
 * slice 0).
 *
 * The playability bank measures how often the Advisor answers questions a
 * bank author who knows the grammar would write. This bank asks the other
 * question: what fraction of a *realistically phrased* stream — the way a
 * trainer at a Pokémon Center counter actually talks — can the current claim
 * vocabulary express at all? That number is the riskiest unknown in the
 * product story (#94, "the middle leg"), and it is cheap: the pass is a pure
 * function of reviewed data, key-free, no model, no snapshot.
 *
 * Two things this module is deliberately not.
 *
 *  1. **Not a coverage run.** The world these questions are about — items —
 *     is not in the snapshot yet (slice 3). Nothing here resolves an entity or
 *     a fact; every entry names the *shapes* an on-target answer needs, and
 *     the pass compares those shapes with what the kernel can compile today.
 *     When the world lands, the entries migrate into the playability format
 *     and gain their oracles; until then an `expectFacts` authored against a
 *     world that does not exist could not be validated, and an oracle the
 *     loader cannot check is the one kind of oracle this project refuses.
 *  2. **Not a wish list.** Shapes are a closed vocabulary ({@link SHAPES}):
 *     the kernel's claim kinds plus the candidate shapes the bank *demanded*,
 *     each tiered by what it would cost to land. A shape not on the list is a
 *     loader refusal, so a question cannot quietly invent its own answer type.
 *
 * The output of the pass is what slice 3 and 4 may build. Nothing is built
 * that the bank did not name; the discipline is the point.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AccordError, violation } from "../kernel/violation.js";
import { CLAIM_KINDS, type ClaimKind } from "./bank.js";
import { type Disposition, DISPOSITIONS } from "./playability.js";

/** The shipped inquiry bank on disk. */
export const INQUIRY_BANK_PATH = resolve(import.meta.dirname, "../../data/playability/center-inquiries.v1.json");

export const INQUIRY_SCHEMA_VERSION = 1;

/**
 * What it costs to make a shape expressible, ordered. The pass reports an
 * entry at the highest tier any of its shapes sits at.
 *
 *  - `existing`: a claim kind the kernel compiles today. Landing the world's
 *    data (fact readers, pack entries) is all it takes.
 *  - `port`: an existing claim kind whose *vocabulary* must be widened to the
 *    new entity domain — roster criteria over items, actions that use items.
 *    The verifier and the crucible for the kind already exist.
 *  - `shape`: a new claim kind — its own derivation, verifier, crucible
 *    mutation, and coverage bucket.
 *  - `composition`: a derived value over more than one claim — arithmetic
 *    the kernel would have to perform, not a lookup it would make.
 */
export const SHAPE_TIERS = ["existing", "port", "shape", "composition"] as const;
export type ShapeTier = (typeof SHAPE_TIERS)[number];

export interface ShapeDefinition {
  id: string;
  tier: ShapeTier;
  /** One line: what an answer of this shape asserts. */
  summary: string;
}

/**
 * The closed shape vocabulary. The first block is the kernel's own claim
 * kinds, verbatim (pinned to {@link CLAIM_KINDS} by test). Everything after
 * it was added because an entry in the shipped bank needed it and nothing
 * existing would do — each is a demand, not a plan.
 */
export const SHAPES: readonly ShapeDefinition[] = [
  ...CLAIM_KINDS.map((kind): ShapeDefinition => ({ id: kind, tier: "existing", summary: `the kernel's ${kind} claim` })),
  {
    // Landed in epic #94 slice 3 PR 2: roster criteria range over items, so
    // entries that needed this now need only the world's data. The tier moves
    // rather than the entry vanishing — the bank's demand history stays
    // legible in the findings, and the pass reads today's kernel.
    id: "item-roster",
    tier: "existing",
    summary: "a closed roster over items — criteria such as category, what it treats, a cost bound — feeding count, membership and ranking exactly as species rosters do (landed: slice 3 PR 2)",
  },
  {
    id: "item-action",
    tier: "port",
    summary: "an act that uses an item on a party Pokémon, registered in the pack like release is, with an irreversible one owing its consent notice",
  },
  {
    id: "arithmetic",
    tier: "composition",
    summary: "a quantity computed over certified facts — doses to reach a total, value per unit cost — where the kernel performs the arithmetic and the model names only the operands",
  },
];

const shapeById = new Map(SHAPES.map((shape) => [shape.id, shape]));

export function shape(id: string): ShapeDefinition | undefined {
  return shapeById.get(id);
}

/** Dispositions expected to resolve; the ones the expressibility number is over. */
export const RESOLVING: readonly Disposition[] = ["answerable", "advisory", "gated-advisory", "should-refuse"];

/** Dispositions whose whole point is a ceiling; each must name it in `notes`. */
const UNANSWERABLE: readonly Disposition[] = ["needs-data", "needs-claim-kind"];

export interface InquiryEntry {
  id: string;
  /** The question as a trainer would actually put it — not as a bank author who knows the grammar would. */
  question: string;
  /** What the question should do once the Center world exists with what this bank demanded. */
  disposition: Disposition;
  /**
   * For resolving dispositions: every shape an on-target answer needs, from
   * {@link SHAPES}. The expressibility pass reads these. Absent for the
   * unanswerable and off-domain dispositions — a `needs-claim-kind` entry is
   * by definition one no shape on the list expresses.
   */
  shapes?: readonly string[];
  /** Entities the question is about, from the bank's declared world. */
  entities?: readonly string[];
  /** Why this disposition; the ceiling for unanswerable entries; the demand for any non-existing shape. */
  notes?: string;
}

/**
 * The world the bank assumes, declared in the bank itself so entries can be
 * validated against *something* before the snapshot exists. Slice 3's
 * snapshot must contain every id here — a test it inherits.
 */
export interface InquiryWorld {
  items: readonly string[];
  species: readonly string[];
  /** Pack decisions the bank assumes slice 3 will make, stated so a reviewer can disagree with them. */
  assumptions: readonly string[];
}

export interface InquiryBank {
  bankVersion: typeof INQUIRY_SCHEMA_VERSION;
  id: string;
  world: InquiryWorld;
  entries: readonly InquiryEntry[];
}

function idList(value: unknown, what: string, fail: (rule: string, message: string, actual?: string) => never): readonly string[] {
  if (!Array.isArray(value)) fail("inquiry-world-malformed", `the bank declares no ${what}`);
  const seen = new Set<string>();
  for (const id of value as unknown[]) {
    if (typeof id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      fail("inquiry-world-id-malformed", `a declared ${what} id is not a canonical id`, String(id));
    }
    if (seen.has(id)) fail("inquiry-world-duplicate", `${what} id "${id}" is declared twice`, id);
    seen.add(id);
  }
  return value as readonly string[];
}

/**
 * Validate a parsed inquiry bank, or refuse it by name. Every check is one a
 * drifted or unreviewed bank fails in a way that would make the expressibility
 * number lie: a shape nobody defined, a resolving entry with no shapes, a
 * ceiling with no stated reason, a demand with no stated demand, an entity
 * outside the declared world.
 */
export function loadInquiryBank(input: unknown): InquiryBank {
  const fail = (rule: string, message: string, actual?: string): never => {
    throw new AccordError([violation("IA-1", rule, message, actual === undefined ? undefined : { actual })]);
  };

  if (input === null || typeof input !== "object") fail("inquiry-malformed", "the inquiry bank is not an object");
  const doc = input as Partial<InquiryBank>;
  if (doc.bankVersion !== INQUIRY_SCHEMA_VERSION) {
    fail("inquiry-schema-unsupported", "the inquiry bank schema version is not supported", String(doc.bankVersion));
  }
  if (typeof doc.id !== "string" || doc.id.length === 0) fail("inquiry-malformed", "the inquiry bank has no id");
  if (doc.world === null || typeof doc.world !== "object") fail("inquiry-world-malformed", "the inquiry bank declares no world");
  const world = doc.world as Partial<InquiryWorld>;
  const items = idList(world.items, "item", fail);
  const species = idList(world.species, "species", fail);
  if (!Array.isArray(world.assumptions) || world.assumptions.some((line) => typeof line !== "string" || line.trim().length === 0)) {
    fail("inquiry-world-malformed", "the bank's pack assumptions must be a list of statements");
  }
  const known = new Set([...items, ...species]);
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) fail("inquiry-malformed", "the inquiry bank carries no entries");

  const seen = new Set<string>();
  for (const entry of doc.entries as InquiryEntry[]) {
    const label = entry.id ?? "(unnamed)";
    if (typeof entry.id !== "string" || entry.id.length === 0) fail("inquiry-entry-unnamed", "an entry has no id");
    if (seen.has(entry.id)) fail("inquiry-duplicate-id", `entry "${entry.id}" appears more than once`, entry.id);
    seen.add(entry.id);
    if (typeof entry.question !== "string" || entry.question.trim().length === 0) {
      fail("inquiry-entry-empty", `entry "${label}" has no question text`, label);
    }
    if (!DISPOSITIONS.includes(entry.disposition)) {
      fail("inquiry-unknown-disposition", `entry "${label}" declares an unknown disposition`, String(entry.disposition));
    }

    const resolving = RESOLVING.includes(entry.disposition);
    if (resolving) {
      if (!Array.isArray(entry.shapes) || entry.shapes.length === 0) {
        fail("inquiry-shapes-missing", `entry "${label}" (${entry.disposition}) names no answer shape`, label);
      }
    } else if (entry.shapes !== undefined) {
      // A ceiling that names a shape is not a ceiling; an off-domain question
      // has no shape. Either way the disposition is wrong, and the pass would
      // count it on the wrong side.
      fail("inquiry-shapes-unexpected", `entry "${label}" (${entry.disposition}) names shapes and is not expected to resolve`, label);
    }
    let demands = false;
    for (const id of entry.shapes ?? []) {
      const found = typeof id === "string" ? shape(id) : undefined;
      if (found === undefined) {
        fail("inquiry-shape-unknown", `entry "${label}" needs "${String(id)}", which is not a defined shape`, String(id));
      } else if (found.tier !== "existing") {
        demands = true;
      }
    }
    if (demands && (entry.notes ?? "").trim().length === 0) {
      fail("inquiry-demand-unstated", `entry "${label}" demands a shape the kernel lacks and does not say why`, label);
    }
    if (UNANSWERABLE.includes(entry.disposition) && (entry.notes ?? "").trim().length === 0) {
      fail("inquiry-ceiling-unstated", `entry "${label}" (${entry.disposition}) must name the ceiling in its notes`, label);
    }
    for (const entity of entry.entities ?? []) {
      if (typeof entity !== "string" || !known.has(entity)) {
        fail("inquiry-entity-unknown", `entry "${label}" is about "${String(entity)}", which the bank's world does not declare`, String(entity));
      }
    }
  }

  return doc as InquiryBank;
}

/** Read and validate the inquiry bank from disk. Throws named, never silently. */
export function readInquiryBank(path: string = INQUIRY_BANK_PATH): InquiryBank {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([violation("IA-1", "inquiry-unreadable", `cannot read the inquiry bank at ${path}: ${(cause as Error).message}`)]);
  }
  return loadInquiryBank(parsed);
}

// --- the expressibility pass ------------------------------------------------

/** The tier an entry lands at: the highest tier among the shapes it needs. */
export function entryTier(entry: InquiryEntry): ShapeTier | undefined {
  if (entry.shapes === undefined) return undefined;
  let highest: ShapeTier = "existing";
  for (const id of entry.shapes) {
    const tier = shape(id)?.tier ?? "existing";
    if (SHAPE_TIERS.indexOf(tier) > SHAPE_TIERS.indexOf(highest)) highest = tier;
  }
  return highest;
}

export interface Expressibility {
  /** Entries expected to resolve — the denominator. */
  resolving: number;
  /** Resolving entries by the tier they land at. */
  byTier: Record<ShapeTier, number>;
  /** Resolving entries by disposition, then tier. */
  byDisposition: Record<string, Record<ShapeTier, number>>;
  /**
   * The strict number: the share of resolving entries the kernel's *current
   * claim kinds* express, needing only the world's data.
   */
  expressibleNow: number;
  /** The share needing no new claim kind — existing kinds, or an existing kind widened to items. */
  expressibleWithPort: number;
  /** Every non-existing shape the bank demanded, with how many entries need it — the build list. */
  demanded: readonly { shape: ShapeDefinition; entries: number }[];
  /** Entries whose ceiling is a shape nobody has defined, named. */
  ceilings: readonly { id: string; notes: string }[];
  /** All entries by disposition, so the bank's own balance is visible. */
  dispositions: Record<string, number>;
}

function emptyTiers(): Record<ShapeTier, number> {
  return { existing: 0, port: 0, shape: 0, composition: 0 };
}

/** The pass itself: a pure function of the bank and {@link SHAPES}. */
export function expressibility(bank: InquiryBank): Expressibility {
  const byTier = emptyTiers();
  const byDisposition: Record<string, Record<ShapeTier, number>> = {};
  const demandCounts = new Map<string, number>();
  const dispositions: Record<string, number> = {};
  const ceilings: { id: string; notes: string }[] = [];
  let resolving = 0;

  for (const entry of bank.entries) {
    dispositions[entry.disposition] = (dispositions[entry.disposition] ?? 0) + 1;
    if (entry.disposition === "needs-claim-kind") ceilings.push({ id: entry.id, notes: entry.notes ?? "" });
    const tier = entryTier(entry);
    if (tier === undefined) continue;
    resolving += 1;
    byTier[tier] += 1;
    (byDisposition[entry.disposition] ??= emptyTiers())[tier] += 1;
    for (const id of new Set(entry.shapes)) {
      if (shape(id)?.tier !== "existing") demandCounts.set(id, (demandCounts.get(id) ?? 0) + 1);
    }
  }

  const demanded = [...demandCounts.entries()]
    .map(([id, entries]) => ({ shape: shape(id) as ShapeDefinition, entries }))
    .sort((a, b) => b.entries - a.entries || a.shape.id.localeCompare(b.shape.id));

  return {
    resolving,
    byTier,
    byDisposition,
    expressibleNow: resolving === 0 ? 0 : byTier.existing / resolving,
    expressibleWithPort: resolving === 0 ? 0 : (byTier.existing + byTier.port) / resolving,
    demanded,
    ceilings,
    dispositions,
  };
}

/** The pass as Markdown, for the findings log — rendered from the data, never hand-transcribed. */
export function renderExpressibility(bank: InquiryBank, result: Expressibility = expressibility(bank)): string {
  const pct = (share: number): string => `${Math.round(share * 100)}%`;
  const lines: string[] = [];
  lines.push(`Bank \`${bank.id}\`: ${bank.entries.length} entries, ${result.resolving} expected to resolve.`);
  lines.push("");
  lines.push("| Disposition | Entries | existing | port | shape | composition |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const disposition of DISPOSITIONS) {
    const count = result.dispositions[disposition] ?? 0;
    const tiers = result.byDisposition[disposition];
    const cell = (tier: ShapeTier): string => (tiers === undefined ? "—" : String(tiers[tier]));
    lines.push(`| ${disposition} | ${count} | ${cell("existing")} | ${cell("port")} | ${cell("shape")} | ${cell("composition")} |`);
  }
  lines.push(`| **resolving total** | **${result.resolving}** | **${result.byTier.existing}** | **${result.byTier.port}** | **${result.byTier.shape}** | **${result.byTier.composition}** |`);
  lines.push("");
  lines.push(`**Expressible now** (current claim kinds, data only): **${result.byTier.existing}/${result.resolving} (${pct(result.expressibleNow)})**.`);
  lines.push(`**Expressible with no new claim kind** (existing kinds widened to items): **${result.byTier.existing + result.byTier.port}/${result.resolving} (${pct(result.expressibleWithPort)})**.`);
  lines.push("");
  lines.push("Shapes the bank demanded, by entries needing them:");
  lines.push("");
  for (const { shape: demand, entries } of result.demanded) {
    lines.push(`- \`${demand.id}\` (${demand.tier}) — ${entries} entries — ${demand.summary}`);
  }
  if (result.ceilings.length > 0) {
    lines.push("");
    lines.push("Ceilings (no defined shape expresses these):");
    lines.push("");
    for (const ceiling of result.ceilings) lines.push(`- \`${ceiling.id}\` — ${ceiling.notes}`);
  }
  return lines.join("\n");
}
