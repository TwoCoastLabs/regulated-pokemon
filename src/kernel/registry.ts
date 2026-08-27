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

import type { CertifiedSnapshot, FactValue, Resolution, Violation } from "./contracts.js";
import { sha256Hex } from "./sha256.js";
import {
  CHART_MULTIPLIERS,
  FIDELITY_CLASSES,
  type FidelityClass,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_VERSIONS,
  type SnapshotDocument,
  type SnapshotMove,
  type SnapshotSpecies,
  type SnapshotTypeChart,
  STAT_NAMES,
  snapshotContent,
  stableStringify,
  type SnapshotItem,
} from "./snapshot-format.js";
import { AccordError, violation } from "./violation.js";

// FactValue itself is a contract (claims assert one, verification compares
// one); these are the registry's readers and formatters for it.
export type { FactValue };

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
/** An empty list is certified absence ("evolves into: none"), not a refusal —
 * the list formatter cannot show an empty series, and "none" is the truth. */
const listOrNone = (value: readonly string[]): FactValue =>
  value.length === 0 ? { kind: "absent" } : list(value);

/** One evolution edge as a deterministic phrase: the target and what it takes.
 * Derived from vendored fields only, so two builds phrase it identically. */
function evolutionMethod(edge: SnapshotSpecies["evolvesTo"][number]): string {
  const means = edge.item ?? (edge.minLevel !== null ? `level ${edge.minLevel}` : edge.trigger);
  return `${edge.to} via ${means}`;
}

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
  "evolves-from": (species) => (species.evolvesFrom === null ? { kind: "absent" } : text(species.evolvesFrom)),
  "evolves-to": (species) => listOrNone(species.evolvesTo.map((edge) => edge.to)),
  "evolution-methods": (species) => listOrNone(species.evolvesTo.map(evolutionMethod)),
  // Presence only, the union over this version group's cartridges; Mew's
  // honest answer is "none" — it is event-only, and absence is certified too.
  locations: (species) => listOrNone(species.encounters.map((entry) => entry.area)),
};

const MOVE_FACTS: Record<string, (move: SnapshotMove) => FactValue> = {
  machine: (move) => (move.machine === null ? { kind: "absent" } : text(move.machine)),
  "move-type": (move) => text(move.type),
  "move-damage-class": (move) => text(move.damageClass),
  "move-power": (move) => optionalNumber(move.power),
  "move-accuracy": (move) => optionalNumber(move.accuracy),
  "move-pp": (move) => optionalNumber(move.pp),
  "move-effect": (move) => text(move.shortEffect),
};

/**
 * Item facts (epic #94, slice 3). Structured fields read straight from the
 * document; era fields read from the reviewed `certified` block and nowhere
 * else — a fact the sheet did not certify is unprovable here, not defaulted.
 * An "absent" is itself certified: "Safari Ball's catch multiplier" resolves
 * to no value on purpose, because generation I's Safari Zone had its own
 * mechanics and the modern number would be the wrong era's.
 */
const ITEM_FACTS: Record<string, (item: SnapshotItem) => FactValue> = {
  "item-category": (item) => text(item.category),
  cost: (item) => number(item.cost),
  consumable: (item) => boolean(item.consumable),
  "usable-in-battle": (item) => boolean(item.usableInBattle),
  "usable-overworld": (item) => boolean(item.usableOverworld),
  "item-effect": (item) => text(item.shortEffect),
  "restores-hp": (item) =>
    item.certified.restoresHp === undefined
      ? { kind: "absent" }
      : item.certified.restoresHp === "full"
        ? text("full")
        : number(item.certified.restoresHp),
  cures: (item) => listOrNone([...(item.certified.cures ?? [])]),
  revives: (item) => (item.certified.revives === undefined ? { kind: "absent" } : text(item.certified.revives)),
  "restores-pp": (item) =>
    item.certified.restoresPp === undefined
      ? { kind: "absent" }
      : item.certified.restoresPp === "full"
        ? text("full")
        : number(item.certified.restoresPp),
  "pp-scope": (item) => (item.certified.ppScope === undefined ? { kind: "absent" } : text(item.certified.ppScope)),
  "repel-steps": (item) => optionalNumber(item.certified.repelSteps ?? null),
  "catch-rate-multiplier": (item) => optionalNumber(item.certified.catchRateMultiplier ?? null),
  "always-catches": (item) => boolean(item.certified.alwaysCatches === true),
  evolves: (item) => listOrNone((item.certified.evolves ?? []).map((pair) => `${pair.from} into ${pair.to}`)),
  "era-name": (item) => (item.certified.eraName === undefined ? { kind: "absent" } : text(item.certified.eraName)),
};

export const SPECIES_FACT_IDS: readonly string[] = Object.keys(SPECIES_FACTS).sort();
export const MOVE_FACT_IDS: readonly string[] = Object.keys(MOVE_FACTS).sort();
export const ITEM_FACT_IDS: readonly string[] = Object.keys(ITEM_FACTS).sort();

export class CertifiedRegistry {
  readonly document: SnapshotDocument;
  readonly snapshot: CertifiedSnapshot;
  private readonly speciesById: ReadonlyMap<string, SnapshotSpecies>;
  private readonly moveById: ReadonlyMap<string, SnapshotMove>;
  private readonly itemById: ReadonlyMap<string, SnapshotItem>;
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
    this.itemById = new Map((document.items ?? []).map((item) => [item.id, item]));
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

  /** Every certified item, in upstream id order; empty for item-less worlds. */
  get items(): readonly SnapshotItem[] {
    return this.document.items ?? [];
  }

  get itemIds(): readonly string[] {
    return (this.document.items ?? []).map((item) => item.id);
  }

  findItem(itemId: string): SnapshotItem | undefined {
    return this.itemById.get(itemId);
  }

  /** The generation's closed damage chart. Validated complete at load. */
  get typeChart(): SnapshotTypeChart {
    return this.document.typeChart;
  }

  /**
   * One chart cell, or undefined for a type the chart does not close over.
   * Never a default: a caller that would treat "no cell" as neutral is the
   * exact confusion the complete matrix exists to prevent.
   */
  multiplier(attacking: string, defending: string): number | undefined {
    return this.document.typeChart.multipliers[attacking]?.[defending];
  }

  findSpecies(entityId: string): SnapshotSpecies | undefined {
    return this.speciesById.get(entityId);
  }

  findMove(moveId: string): SnapshotMove | undefined {
    return this.moveById.get(moveId);
  }

  knowsEntity(entityId: string): boolean {
    return this.speciesById.has(entityId) || this.moveById.has(entityId) || this.itemById.has(entityId);
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

    const item = this.itemById.get(entityId);
    if (item !== undefined) return apply(ITEM_FACTS, factId, item, entityId, this.snapshot.id);

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
  const violations = [
    ...checkIntegrity(document),
    ...checkChart(document),
    ...checkItems(document),
    ...checkFidelity(document),
    ...checkDigest(document),
  ];
  if (violations.length > 0) return { ok: false, violations };

  return { ok: true, value: new CertifiedRegistry(document) };
}

/** Every surface the fidelity declaration must cover: each fact id this
 * registry can certify, plus the matchup matrix. */
export function fidelitySurfaces(document?: { items?: readonly unknown[] }): readonly string[] {
  const itemSurfaces = document?.items === undefined ? [] : ITEM_FACT_IDS;
  return [...SPECIES_FACT_IDS, ...MOVE_FACT_IDS, ...itemSurfaces, "type-chart"].sort();
}

/**
 * The era-fidelity declaration, closed in both directions (epic #87,
 * slice 3): every certified surface must state how faithfully it tracks the
 * era the snapshot names, and nothing undeclared may appear. This is what
 * turns the caveats' prose into a check — a new fact family cannot land
 * without declaring its fidelity, and a certificate can never imply more
 * than the world's provenance backs (IA-2 as truth-in-labeling).
 */
function checkFidelity(document: SnapshotDocument): Violation[] {
  const declared = document.source.fidelity;
  if (declared === undefined || declared === null || typeof declared !== "object") {
    return [
      violation("IA-2", "fidelity-undeclared", "snapshot declares no era fidelity for its certified surfaces", {
        expected: "source.fidelity covering every certified surface",
        actual: "not declared",
      }),
    ];
  }

  const violations: Violation[] = [];
  const surfaces = new Set(fidelitySurfaces(document));
  for (const surface of surfaces) {
    if (declared[surface] === undefined) {
      violations.push(
        violation("IA-2", "fidelity-surface-undeclared", `certified surface "${surface}" declares no era fidelity`, {
          expected: `a fidelity class for "${surface}"`,
          actual: "not declared",
        }),
      );
    }
  }
  for (const [surface, fidelity] of Object.entries(declared)) {
    if (!surfaces.has(surface)) {
      violations.push(
        violation("IA-2", "fidelity-surface-unknown", `fidelity is declared for "${surface}", which this registry does not certify`, {
          expected: "a certified fact id, or type-chart",
          actual: surface,
        }),
      );
    }
    if (!FIDELITY_CLASSES.includes(fidelity as FidelityClass)) {
      violations.push(
        violation("IA-2", "fidelity-class-unknown", `surface "${surface}" declares fidelity "${String(fidelity)}", which is not a class`, {
          expected: FIDELITY_CLASSES.join(", "),
          actual: String(fidelity),
        }),
      );
    }
  }
  return violations;
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

  const missing = (["id", "scope", "source", "contentDigest", "typeChart"] as const).filter(
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
/**
 * The chart must be *complete and closed* before anything derives from it: a
 * missing cell that read as neutral, or a multiplier outside the game's own
 * set, would let a derived matchup assert something no chart certifies.
 */
function checkChart(document: SnapshotDocument): Violation[] {
  const violations: Violation[] = [];
  const chart = document.typeChart;

  if (!Array.isArray(chart.types) || chart.types.length === 0) {
    return [violation("IA-2", "chart-empty", "snapshot has a type chart that closes over no types")];
  }
  for (const duplicate of duplicates(chart.types)) {
    violations.push(
      violation("IA-2", "chart-duplicate-type", `type "${duplicate}" appears in the chart more than once`, {
        actual: duplicate,
      }),
    );
  }

  const closed = new Set(chart.types);
  const rows = Object.keys(chart.multipliers ?? {});
  for (const missing of chart.types.filter((type) => !rows.includes(type))) {
    violations.push(
      violation("IA-2", "chart-incomplete", `the chart has no row for attacking type "${missing}"`, {
        expected: `a row per type: ${chart.types.join(", ")}`,
        actual: `no "${missing}" row`,
      }),
    );
  }
  for (const extra of rows.filter((row) => !closed.has(row))) {
    violations.push(
      violation("IA-2", "chart-unclosed", `the chart has a row for "${extra}", which is not a type it closes over`, {
        expected: chart.types.join(", "),
        actual: extra,
      }),
    );
  }

  for (const attacking of rows.filter((row) => closed.has(row))) {
    const row = chart.multipliers[attacking] ?? {};
    const cells = Object.keys(row);
    for (const missing of chart.types.filter((type) => !cells.includes(type))) {
      violations.push(
        violation("IA-2", "chart-incomplete", `the chart has no "${attacking}" versus "${missing}" cell`, {
          expected: `a cell per defending type`,
          actual: `no "${missing}" cell`,
        }),
      );
    }
    for (const extra of cells.filter((cell) => !closed.has(cell))) {
      violations.push(
        violation("IA-2", "chart-unclosed", `"${attacking}" has a cell against "${extra}", which is not a type the chart closes over`, {
          expected: chart.types.join(", "),
          actual: extra,
        }),
      );
    }
    for (const [defending, value] of Object.entries(row)) {
      if (!CHART_MULTIPLIERS.includes(value)) {
        violations.push(
          violation("IA-2", "chart-invalid-multiplier", `"${attacking}" versus "${defending}" is ${value}, which the game's chart cannot hold`, {
            expected: CHART_MULTIPLIERS.join(", "),
            actual: String(value),
          }),
        );
      }
    }
  }

  // Every type the world uses must be one the chart closes over — a species
  // or move typed outside it would carry a type that does not exist here.
  for (const species of document.species) {
    for (const type of species.types.filter((entry) => !closed.has(entry))) {
      violations.push(
        violation("IA-3", "dangling-type-reference", `${species.id} is typed "${type}", which this generation's chart does not certify`, {
          expected: chart.types.join(", "),
          actual: type,
        }),
      );
    }
  }
  for (const move of document.moves) {
    if (!closed.has(move.type)) {
      violations.push(
        violation("IA-3", "dangling-type-reference", `${move.id} is typed "${move.type}", which this generation's chart does not certify`, {
          expected: chart.types.join(", "),
          actual: move.type,
        }),
      );
    }
  }

  return violations;
}

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

  // The grown world's references and closed sets (schema v3). Evolution edges
  // may only point at certified species; encounters may only cite this
  // version group's own cartridges; a machine is a TM/HM slug or nothing.
  for (const species of document.species) {
    for (const cited of [species.evolvesFrom, ...species.evolvesTo.map((edge) => edge.to)]) {
      if (cited !== null && !speciesIds.has(cited)) {
        violations.push(
          violation("IA-3", "dangling-evolution-reference", `${species.id}'s evolution cites "${cited}", which this snapshot does not certify`, {
            actual: cited,
          }),
        );
      }
    }
    for (const encounter of species.encounters) {
      const unclosed = encounter.versions.filter((version) => !SNAPSHOT_VERSIONS.includes(version));
      if (encounter.versions.length === 0 || unclosed.length > 0) {
        violations.push(
          violation("IA-2", "encounter-version-unclosed", `${species.id}'s encounter at ${encounter.area} cites a cartridge outside this version group`, {
            expected: SNAPSHOT_VERSIONS.join(", "),
            actual: unclosed.join(", ") || "no version at all",
          }),
        );
      }
    }
  }
  for (const move of document.moves) {
    if (move.machine !== null && !/^(tm|hm)\d+$/.test(move.machine)) {
      violations.push(
        violation("IA-2", "machine-invalid", `${move.id} is taught by "${move.machine}", which is not a TM or HM`, {
          expected: "tm<number> or hm<number>",
          actual: move.machine,
        }),
      );
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
/**
 * The items block, validated before it is trusted (epic #94, slice 3).
 *
 * The extraction crucible's load-time half: a fabricated or drifted
 * certification is refused by name here, against the rest of the snapshot.
 * Cures come from the sheet's closed condition vocabulary; an evolution pair
 * must exist in the species' own certified evolution edges *with this stone*,
 * so a stone cannot certify an evolution the world's roster does not carry.
 * (Provenance-versus-upstream equality is the fetch script's check — the
 * loader has no network and trusts the vendored bytes only as far as they
 * agree with themselves.)
 */
const STATUS_CONDITIONS: readonly string[] = ["poison", "burn", "freeze", "sleep", "paralysis", "confusion"];

function checkItems(document: SnapshotDocument): Violation[] {
  const items = document.items;
  if (items === undefined) return [];
  const violations: Violation[] = [];
  if (items.length === 0) {
    violations.push(violation("IA-2", "items-empty", "the snapshot declares an items block with nothing in it"));
  }
  const seen = new Set<string>();
  const species = new Map(document.species.map((one) => [one.id, one]));
  for (const item of items) {
    if (typeof item.id !== "string" || item.id.length === 0) {
      violations.push(violation("IA-2", "item-unnamed", "an item has no id"));
      continue;
    }
    if (seen.has(item.id)) {
      violations.push(violation("IA-2", "item-duplicated", `item "${item.id}" appears more than once`, { actual: item.id }));
    }
    seen.add(item.id);
    if (species.has(item.id) || document.moves.some((move) => move.id === item.id)) {
      violations.push(violation("IA-2", "item-id-collides", `item "${item.id}" collides with another certified entity`, { actual: item.id }));
    }
    if (item.certified === null || typeof item.certified !== "object" || typeof item.certified.provenance !== "string" || item.certified.provenance.length === 0) {
      violations.push(
        violation("IA-2", "item-uncertified", `item "${item.id}" carries no reviewed extraction provenance`, {
          expected: "a certified block naming the upstream sentence it was reviewed against",
          actual: "missing",
        }),
      );
      continue;
    }
    for (const cure of item.certified.cures ?? []) {
      if (!STATUS_CONDITIONS.includes(cure)) {
        violations.push(
          violation("IA-2", "item-cure-unknown", `item "${item.id}" certifies curing "${String(cure)}", which is not a status condition`, {
            expected: STATUS_CONDITIONS.join(", "),
            actual: String(cure),
          }),
        );
      }
    }
    for (const pair of item.certified.evolves ?? []) {
      const from = species.get(pair.from);
      const edge = from?.evolvesTo.find((entry) => entry.to === pair.to);
      if (from === undefined || edge === undefined || edge.trigger !== "use-item" || edge.item !== item.id) {
        violations.push(
          violation("IA-2", "item-evolution-unsupported", `item "${item.id}" certifies evolving ${pair.from} into ${pair.to}, which the species records do not support with this item`, {
            expected: `a use-item edge ${pair.from} -> ${pair.to} via ${item.id}`,
            actual: from === undefined ? `no species "${pair.from}"` : edge === undefined ? "no such edge" : `${edge.trigger}${edge.item === null ? "" : ` via ${edge.item}`}`,
          }),
        );
      }
    }
  }
  return violations;
}

function checkDigest(document: SnapshotDocument): Violation[] {
  const recomputed = `sha256:${sha256Hex(stableStringify(snapshotContent(document)))}`;
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
