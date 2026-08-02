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

export const SNAPSHOT_SCHEMA_VERSION = 1;

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
}

export interface SnapshotDocument {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  /** Stable, human-readable snapshot id, e.g. "kanto-red-blue". */
  id: string;
  scope: SnapshotScope;
  source: SnapshotSource;
  /** Digest over the certified content only (id, scope, species, moves). */
  contentDigest: string;
  species: readonly SnapshotSpecies[];
  moves: readonly SnapshotMove[];
}

/** Fields hashed into `contentDigest` — provenance is deliberately excluded. */
export type SnapshotContent = Pick<
  SnapshotDocument,
  "schemaVersion" | "id" | "scope" | "species" | "moves"
>;

export function snapshotContent(document: SnapshotContent): SnapshotContent {
  return {
    schemaVersion: document.schemaVersion,
    id: document.id,
    scope: document.scope,
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
