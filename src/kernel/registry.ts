/**
 * The certified registry (IA-2, IA-3): the only thing in this system that is
 * allowed to be a source of fact.
 *
 * Two rules govern everything below.
 *
 * 1. The snapshot is *closed*. If a species, move, or fact is not written in
 *    the vendored bytes, it is not "unknown" — it is unprovable, and asking
 *    for it is refused by name. Nothing is inferred, defaulted, or filled in.
 * 2. The registry is validated before it is trusted. A malformed, tampered,
 *    or internally inconsistent snapshot is not a registry, and the process
 *    refuses to start rather than serving facts it cannot stand behind.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import type { CertifiedSnapshot, Resolution, Violation } from "./contracts.js";
import {
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotDocument,
  type SnapshotMove,
  type SnapshotSpecies,
  STAT_NAMES,
  snapshotContent,
  stableStringify,
} from "./snapshot-format.js";
import { AccordError, violation } from "./violation.js";

/**
 * A resolved fact. `absent` is itself a certified answer — "this move has no
 * power" is a fact, distinct from "this snapshot does not certify power".
 */
export type FactValue =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string }
  | { kind: "list"; value: readonly string[] }
  | { kind: "absent" };

export function sameFactValue(left: FactValue, right: FactValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "absent") return true;
  if (left.kind === "list") {
    const other = right as Extract<FactValue, { kind: "list" }>;
    return left.value.length === other.value.length && left.value.every((item, i) => item === other.value[i]);
  }
  return left.value === (right as { value: unknown }).value;
}

export function formatFactValue(value: FactValue): string {
  switch (value.kind) {
    case "absent":
      return "none";
    case "list":
      return value.value.join(", ");
    default:
      return String(value.value);
  }
}

const number = (value: number): FactValue => ({ kind: "number", value });
const boolean = (value: boolean): FactValue => ({ kind: "boolean", value });
const text = (value: string): FactValue => ({ kind: "text", value });
const list = (value: readonly string[]): FactValue => ({ kind: "list", value });
const optionalNumber = (value: number | null): FactValue =>
  value === null ? { kind: "absent" } : number(value);

/**
 * The certified fact vocabulary. A fact id that is not a key here does not
 * exist: there is no fallback path that reads the snapshot directly.
 */
const SPECIES_FACTS: Record<string, (species: SnapshotSpecies) => FactValue> = {
  "pokedex-number": (species) => number(species.pokedexNumber),
  types: (species) => list(species.types),
  "is-legendary": (species) => boolean(species.isLegendary),
  "is-mythical": (species) => boolean(species.isMythical),
  learnset: (species) => list([...new Set(species.learnset.map((entry) => entry.move))].sort()),
  ...Object.fromEntries(
    STAT_NAMES.map((stat) => [`base-${stat}`, (species: SnapshotSpecies) => number(species.stats[stat])]),
  ),
  // Derived, but derived deterministically from bound facts — the only kind
  // of derivation this kernel permits.
  "base-stat-total": (species) =>
    number(STAT_NAMES.reduce((total, stat) => total + species.stats[stat], 0)),
};

const MOVE_FACTS: Record<string, (move: SnapshotMove) => FactValue> = {
  "move-type": (move) => text(move.type),
  "move-damage-class": (move) => text(move.damageClass),
  "move-power": (move) => optionalNumber(move.power),
  "move-accuracy": (move) => optionalNumber(move.accuracy),
  "move-pp": (move) => optionalNumber(move.pp),
  "move-effect": (move) => text(move.shortEffect),
};

export const SPECIES_FACT_IDS: readonly string[] = Object.keys(SPECIES_FACTS).sort();
export const MOVE_FACT_IDS: readonly string[] = Object.keys(MOVE_FACTS).sort();

export class CertifiedRegistry {
  readonly document: SnapshotDocument;
  readonly snapshot: CertifiedSnapshot;
  private readonly speciesById: ReadonlyMap<string, SnapshotSpecies>;
  private readonly moveById: ReadonlyMap<string, SnapshotMove>;
  readonly typeNames: ReadonlySet<string>;

  /**
   * Validated documents only — always build one through {@link loadRegistry},
   * which is the single place a snapshot earns the right to be trusted.
   */
  constructor(document: SnapshotDocument) {
    this.document = document;
    this.snapshot = {
      id: document.id,
      sourceCommit: document.source.commit,
      sourceRepository: document.source.repository,
    };
    this.speciesById = new Map(document.species.map((species) => [species.id, species]));
    this.moveById = new Map(document.moves.map((move) => [move.id, move]));
    this.typeNames = new Set(document.species.flatMap((species) => species.types));
  }

  /** Every certified species, in Pokédex order. */
  get species(): readonly SnapshotSpecies[] {
    return this.document.species;
  }

  get speciesIds(): readonly string[] {
    return this.document.species.map((species) => species.id);
  }

  get moveIds(): readonly string[] {
    return this.document.moves.map((move) => move.id);
  }

  findSpecies(entityId: string): SnapshotSpecies | undefined {
    return this.speciesById.get(entityId);
  }

  findMove(moveId: string): SnapshotMove | undefined {
    return this.moveById.get(moveId);
  }

  knowsEntity(entityId: string): boolean {
    return this.speciesById.has(entityId) || this.moveById.has(entityId);
  }

  /**
   * Resolve one fact, or refuse by name. An unknown entity is a fabrication
   * (IA-3); a known entity with an uncertified fact id is outside what this
   * snapshot approves (IA-2). Neither ever returns a placeholder value.
   */
  resolve(entityId: string, factId: string): Resolution<FactValue> {
    const species = this.speciesById.get(entityId);
    if (species !== undefined) return apply(SPECIES_FACTS, factId, species, entityId, this.snapshot.id);

    const move = this.moveById.get(entityId);
    if (move !== undefined) return apply(MOVE_FACTS, factId, move, entityId, this.snapshot.id);

    return refuse(
      violation(
        "IA-3",
        "fabricated-entity",
        `"${entityId}" is not certified by snapshot ${this.snapshot.id}`,
        { expected: `an entity in ${this.snapshot.id}`, actual: entityId },
      ),
    );
  }
}

function apply<T>(
  facts: Record<string, (subject: T) => FactValue>,
  factId: string,
  subject: T,
  entityId: string,
  snapshotId: string,
): Resolution<FactValue> {
  const reader = facts[factId];
  if (reader === undefined) {
    return refuse(
      violation("IA-2", "uncertified-fact", `snapshot ${snapshotId} does not certify "${factId}" for ${entityId}`, {
        expected: `one of: ${Object.keys(facts).sort().join(", ")}`,
        actual: factId,
      }),
    );
  }
  return { ok: true, value: reader(subject) };
}

function refuse(...violations: Violation[]): { ok: false; violations: readonly Violation[] } {
  return { ok: false, violations };
}

// --- loading ----------------------------------------------------------------

/**
 * Validate a parsed snapshot document and, if it holds up, build a registry.
 * Returns violations rather than throwing so the crucible can assert on the
 * named denial for each way a snapshot can be wrong.
 */
export function loadRegistry(input: unknown): Resolution<CertifiedRegistry> {
  const structural = checkStructure(input);
  if (structural.length > 0) return { ok: false, violations: structural };

  const document = input as SnapshotDocument;
  const violations = [...checkIntegrity(document), ...checkDigest(document)];
  if (violations.length > 0) return { ok: false, violations };

  return { ok: true, value: new CertifiedRegistry(document) };
}

/** Read the vendored snapshot from disk, refusing loudly if it does not hold. */
export function readRegistry(path: string): CertifiedRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([
      violation("IA-2", "snapshot-unreadable", `cannot read snapshot at ${path}: ${(cause as Error).message}`),
    ]);
  }
  const loaded = loadRegistry(parsed);
  if (!loaded.ok) throw new AccordError(loaded.violations);
  return loaded.value;
}

function checkStructure(input: unknown): Violation[] {
  if (input === null || typeof input !== "object") {
    return [violation("IA-2", "snapshot-malformed", "snapshot is not an object")];
  }
  const document = input as Partial<SnapshotDocument>;

  if (document.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return [
      violation("IA-2", "snapshot-schema-unsupported", "snapshot schema version is not supported", {
        expected: String(SNAPSHOT_SCHEMA_VERSION),
        actual: String(document.schemaVersion),
      }),
    ];
  }

  const missing = (["id", "scope", "source", "contentDigest"] as const).filter(
    (field) => document[field] === undefined,
  );
  if (missing.length > 0) {
    return [violation("IA-2", "snapshot-malformed", `snapshot is missing ${missing.join(", ")}`)];
  }
  if (!Array.isArray(document.species) || document.species.length === 0) {
    return [violation("IA-2", "snapshot-malformed", "snapshot certifies no species")];
  }
  if (!Array.isArray(document.moves)) {
    return [violation("IA-2", "snapshot-malformed", "snapshot has no move table")];
  }
  return [];
}

/**
 * Internal consistency. Ambiguous identity and dangling references are IA-3
 * problems rather than IA-2 ones: each is a route by which something that
 * does not exist could be asserted as if it did.
 */
function checkIntegrity(document: SnapshotDocument): Violation[] {
  const violations: Violation[] = [];

  for (const [label, ids] of [
    ["species", document.species.map((species) => species.id)],
    ["move", document.moves.map((move) => move.id)],
  ] as const) {
    for (const duplicate of duplicates(ids)) {
      violations.push(
        violation("IA-3", "duplicate-entity", `${label} id "${duplicate}" appears more than once`, {
          actual: duplicate,
        }),
      );
    }
  }

  const moveIds = new Set(document.moves.map((move) => move.id));
  const speciesIds = new Set(document.species.map((species) => species.id));
  // Species and moves share one entity namespace at resolution time, so an id
  // in both tables would make the answer depend on lookup order.
  for (const shared of [...speciesIds].filter((id) => moveIds.has(id))) {
    violations.push(
      violation("IA-3", "ambiguous-entity", `"${shared}" is both a species and a move`, { actual: shared }),
    );
  }

  for (const species of document.species) {
    for (const learned of species.learnset) {
      if (!moveIds.has(learned.move)) {
        violations.push(
          violation(
            "IA-3",
            "dangling-move-reference",
            `${species.id} learns "${learned.move}", which the move table does not certify`,
            { actual: learned.move },
          ),
        );
      }
    }
  }

  for (const duplicate of duplicates(document.species.map((species) => String(species.pokedexNumber)))) {
    violations.push(
      violation("IA-2", "snapshot-inconsistent", `Pokédex number ${duplicate} is claimed by more than one species`, {
        actual: duplicate,
      }),
    );
  }

  const ordered = document.species.every(
    (species, index) => index === 0 || species.pokedexNumber > document.species[index - 1]!.pokedexNumber,
  );
  if (!ordered) {
    violations.push(
      violation("IA-2", "snapshot-inconsistent", "species are not in ascending Pokédex order"),
    );
  }

  return violations;
}

/** The digest is what makes tampering with the vendored bytes detectable. */
function checkDigest(document: SnapshotDocument): Violation[] {
  const recomputed = `sha256:${createHash("sha256").update(stableStringify(snapshotContent(document))).digest("hex")}`;
  if (recomputed === document.contentDigest) return [];
  return [
    violation("IA-2", "snapshot-digest-mismatch", `snapshot ${document.id} does not match its content digest`, {
      expected: document.contentDigest,
      actual: recomputed,
    }),
  ];
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}
