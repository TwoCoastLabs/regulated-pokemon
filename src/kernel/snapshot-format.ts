/**
 * The on-disk shape of a certified snapshot (IA-2).
 *
 * These are types only — no logic — so that the regeneration script
 * (scripts/fetch-snapshot.ts) and the kernel's loader agree on one schema
 * without the kernel depending on anything that touches the network.
 *
 * A snapshot is a *closed* projection of the upstream registry: the kernel
 * may assert exactly what is written here and nothing else. Anything absent
 * is not "unknown", it is unprovable, and asking for it is a denial.
 */

export const SNAPSHOT_SCHEMA_VERSION = 3;

/** The cartridges this snapshot's version group comprises. Closed: an
 * encounter recorded against any other version fails the loader. */
export const SNAPSHOT_VERSIONS: readonly string[] = ["red", "blue"];

/** Provenance of the projection, including the limits of its certification. */
export interface SnapshotSource {
  repository: string;
  /** 40-character upstream commit the projection was built from. */
  commit: string;
  license: string;
  /** Repo-relative path to the preserved upstream license text. */
  licenseFile: string;
  notice: string;
  /** Number of upstream documents read to build this projection. */
  documentCount: number;
  /** Digest over every consumed upstream document (path + bytes). */
  documentsDigest: string;
  /**
   * What this snapshot does and does not certify. The registry states the
   * limits of its own certification; the kernel never infers past them.
   */
  caveats: readonly string[];
}

/** The single version-group world this snapshot describes. */
export interface SnapshotScope {
  pokedex: string;
  pokedexId: number;
  versionGroup: string;
  versionGroupOrder: number;
  generation: string;
}

/** Base stats, named exactly as upstream names them. */
export interface SnapshotStats {
  hp: number;
  attack: number;
  defense: number;
  "special-attack": number;
  "special-defense": number;
  speed: number;
}

export type StatName = keyof SnapshotStats;

export const STAT_NAMES: readonly StatName[] = [
  "hp",
  "attack",
  "defense",
  "special-attack",
  "special-defense",
  "speed",
] as const;

/** One (move, method) pair legal in this version group. */
export interface SnapshotLearnedMove {
  move: string;
  method: string;
  /** Level for `level-up`; null for every other method. */
  level: number | null;
}

/**
 * One certified evolution edge. `to` is always a species this snapshot
 * certifies: upstream chains are not version-pinned, so edges into
 * later-generation relatives (Espeon, Crobat) — and parents from them
 * (Pichu) — are excluded at build time rather than caveated at read time.
 */
export interface SnapshotEvolution {
  to: string;
  /** Upstream trigger slug: level-up, use-item, trade. */
  trigger: string;
  minLevel: number | null;
  /** The stone or item, when the trigger needs one. */
  item: string | null;
}

/** Presence-only encounter data: where a species can be found, per cartridge.
 * Rates and level ranges are deliberately not vendored (epic #54, decision 5). */
export interface SnapshotEncounter {
  area: string;
  /** Which cartridges of this version group, each in SNAPSHOT_VERSIONS. */
  versions: readonly string[];
}

export interface SnapshotSpecies {
  /** Entity id used throughout the kernel — the upstream species slug. */
  id: string;
  speciesId: number;
  pokemonId: number;
  pokedexNumber: number;
  /**
   * Upstream splits rarity into two flags and Mew is mythical rather than
   * legendary; both are carried so an IA-5 restriction can name either
   * without the kernel guessing which one a policy meant.
   */
  isLegendary: boolean;
  isMythical: boolean;
  /** Types as of this version group (upstream `past_types` applied). */
  types: readonly string[];
  stats: SnapshotStats;
  learnset: readonly SnapshotLearnedMove[];
  /** The certified species this one evolves from, when the snapshot holds it. */
  evolvesFrom: string | null;
  evolvesTo: readonly SnapshotEvolution[];
  encounters: readonly SnapshotEncounter[];
}

export interface SnapshotMove {
  id: string;
  moveId: number;
  /** Values as of this version group (upstream `past_values` applied). */
  type: string;
  damageClass: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  shortEffect: string;
  /** The TM/HM that teaches it in this version group ("tm11", "hm03"), or
   * null for a move no machine carries. */
  machine: string | null;
}

/**
 * The generation's damage chart (upstream `past_damage_relations` applied),
 * vendored as a **complete matrix** rather than the upstream's sparse
 * relations. Sparseness would make "no entry" and "neutral" the same bytes;
 * writing every attacking × defending cell means a missing one is a loader
 * refusal, never a silent 1×.
 */
export interface SnapshotTypeChart {
  /** The generation's closed set of type ids, sorted. */
  types: readonly string[];
  /** Damage multiplier, attacking type → defending type → 0, 0.5, 1 or 2. */
  multipliers: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** The multipliers a chart cell may hold; anything else fails the loader. */
export const CHART_MULTIPLIERS: readonly number[] = [0, 0.5, 1, 2];

export interface SnapshotDocument {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  /** Stable, human-readable snapshot id, e.g. "kanto-red-blue". */
  id: string;
  scope: SnapshotScope;
  source: SnapshotSource;
  /** Digest over the certified content only (id, scope, chart, species, moves). */
  contentDigest: string;
  typeChart: SnapshotTypeChart;
  species: readonly SnapshotSpecies[];
  moves: readonly SnapshotMove[];
}

/** Fields hashed into `contentDigest` — provenance is deliberately excluded. */
export type SnapshotContent = Pick<
  SnapshotDocument,
  "schemaVersion" | "id" | "scope" | "typeChart" | "species" | "moves"
>;

export function snapshotContent(document: SnapshotContent): SnapshotContent {
  return {
    schemaVersion: document.schemaVersion,
    id: document.id,
    scope: document.scope,
    typeChart: document.typeChart,
    species: document.species,
    moves: document.moves,
  };
}

/** Deterministic JSON: keys sorted, so a digest never depends on key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
