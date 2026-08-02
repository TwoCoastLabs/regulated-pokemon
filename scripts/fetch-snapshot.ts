/**
 * Regenerate the certified snapshot from a pinned PokeAPI/api-data commit.
 *
 * This script is a maintenance tool, not part of the kernel: it is the only
 * code in the repository that touches the network, it never runs in CI, and
 * nothing it fetches is trusted until it has been written to disk, reviewed,
 * and re-validated by the loader. CI reads the vendored bytes only.
 *
 * Usage:
 *   npm run snapshot:fetch                        # refresh the pinned commit
 *   npm run snapshot:fetch -- --commit <40-sha>   # re-pin to another commit
 *   npm run snapshot:fetch -- --check             # verify, do not write
 *
 * The upstream projection is deliberately narrow: one Pokédex, one version
 * group, no artwork, no flavour text, no localisation. See data/README.md.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotDocument,
  type SnapshotLearnedMove,
  type SnapshotMove,
  type SnapshotSpecies,
  type SnapshotStats,
  STAT_NAMES,
  snapshotContent,
  stableStringify,
} from "../src/kernel/snapshot-format.ts";

// --- what we pin ------------------------------------------------------------

const REPOSITORY = "https://github.com/PokeAPI/api-data";
const DEFAULT_COMMIT = "eed7925e3158c9f744816768d3cc3395e290127f";
const LICENSE = "BSD-3-Clause";
const LICENSE_FILE = "data/LICENSE.pokeapi";
const SNAPSHOT_ID = "kanto-red-blue";
const POKEDEX_ID = 2;
const VERSION_GROUP = "red-blue";

const NOTICE =
  "Data derived from the PokeAPI project (BSD-3-Clause). PokeAPI is " +
  "community-maintained and is this project's designated data source; it is " +
  "not an official Pokémon authority. No artwork or sprites are included.";

/**
 * Upstream pins some facts per version group and others not at all. The
 * snapshot says so out loud so that no downstream claim quietly overstates
 * what the registry can certify.
 */
const CAVEATS = [
  "Types are pinned to this version group via upstream `past_types`.",
  "Move legality is pinned to this version group via upstream learnset entries.",
  "Move power, accuracy, PP and type are pinned via upstream `past_values`.",
  "Base stats are NOT version-pinned: upstream publishes present-day values " +
    "only, and several species were re-statted in later generations. Claims " +
    "over stats are certified against this snapshot, not against the " +
    "original cartridge.",
  "Move effect text is present-day upstream wording; it is not version-pinned.",
  "Species absent from this Pokédex are not certified by this snapshot and " +
    "cannot be asserted from it.",
] as const;

const CONCURRENCY = 8;

// --- upstream document shapes (only the fields we consume) ------------------

interface NamedResource {
  name: string;
  url: string;
}

interface ListDocument {
  results: NamedResource[];
}

interface VersionGroupDocument {
  id: number;
  name: string;
  order: number;
  generation: NamedResource;
}

interface PokedexDocument {
  pokemon_entries: Array<{ entry_number: number; pokemon_species: NamedResource }>;
}

interface SpeciesDocument {
  id: number;
  name: string;
  is_legendary: boolean;
  is_mythical: boolean;
  varieties: Array<{ is_default: boolean; pokemon: NamedResource }>;
}

interface PokemonDocument {
  id: number;
  name: string;
  types: Array<{ slot: number; type: NamedResource }>;
  past_types: Array<{ generation: NamedResource; types: Array<{ slot: number; type: NamedResource }> }>;
  stats: Array<{ base_stat: number; stat: NamedResource }>;
  moves: Array<{
    move: NamedResource;
    version_group_details: Array<{
      level_learned_at: number;
      move_learn_method: NamedResource;
      version_group: NamedResource;
    }>;
  }>;
}

interface MovePastValue {
  accuracy: number | null;
  power: number | null;
  pp: number | null;
  type: NamedResource | null;
  version_group: NamedResource;
}

interface MoveDocument {
  id: number;
  name: string;
  accuracy: number | null;
  power: number | null;
  pp: number | null;
  priority: number;
  type: NamedResource;
  damage_class: NamedResource;
  past_values: MovePastValue[];
  effect_entries: Array<{ short_effect: string; language: NamedResource }>;
}

// --- fetching ---------------------------------------------------------------

/**
 * Reads upstream documents and, as a side effect, records a digest of every
 * byte consumed. The digest is order-independent: paths are sorted before
 * hashing, so a re-run with different scheduling produces the same value.
 */
class PinnedRegistry {
  private readonly documents = new Map<string, string>();
  private readonly commit: string;

  constructor(commit: string) {
    this.commit = commit;
  }

  async read<T>(path: string): Promise<T> {
    const url = `https://raw.githubusercontent.com/PokeAPI/api-data/${this.commit}/data/api/v2/${path}/index.json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`upstream ${path}: HTTP ${response.status} ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.documents.set(path, sha256(bytes));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  get documentCount(): number {
    return this.documents.size;
  }

  get documentsDigest(): string {
    const sorted = [...this.documents.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return sha256(sorted.map(([path, digest]) => `${path} ${digest}`).join("\n"));
  }
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Bounded-concurrency map that preserves input order. */
async function mapPooled<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function idFromUrl(url: string, resource: string): number {
  const match = new RegExp(`/${resource}/(\\d+)/?$`).exec(url);
  if (!match?.[1]) throw new Error(`cannot read ${resource} id from ${url}`);
  return Number.parseInt(match[1], 10);
}

// --- version pinning --------------------------------------------------------

/**
 * Upstream records historical values against the *last* version group (or
 * generation) in which they applied. To recover the values for our target we
 * walk the applicable entries from latest to earliest, letting each override
 * the running value; nulls mean "unchanged from the later entry".
 */
function applicableEntries<T>(
  entries: readonly T[],
  orderOf: (entry: T) => number | undefined,
  targetOrder: number,
): T[] {
  return entries
    .map((entry) => ({ entry, order: orderOf(entry) }))
    .filter((candidate): candidate is { entry: T; order: number } => candidate.order !== undefined)
    .filter((candidate) => candidate.order >= targetOrder)
    .sort((a, b) => b.order - a.order)
    .map((candidate) => candidate.entry);
}

function typesAt(pokemon: PokemonDocument, generationOrder: Map<string, number>, target: number): string[] {
  const past = applicableEntries(
    pokemon.past_types,
    (entry) => generationOrder.get(entry.generation.name),
    target,
  );
  // Each past_types entry restates the full type list, so the earliest
  // applicable entry — last after the latest-to-earliest walk — wins.
  const chosen = past.at(-1)?.types ?? pokemon.types;
  return [...chosen].sort((a, b) => a.slot - b.slot).map((entry) => entry.type.name);
}

function moveAt(move: MoveDocument, versionGroupOrder: Map<string, number>, target: number): SnapshotMove {
  let power = move.power;
  let accuracy = move.accuracy;
  let pp = move.pp;
  let type = move.type.name;

  for (const past of applicableEntries(
    move.past_values,
    (entry) => versionGroupOrder.get(entry.version_group.name),
    target,
  )) {
    if (past.power !== null) power = past.power;
    if (past.accuracy !== null) accuracy = past.accuracy;
    if (past.pp !== null) pp = past.pp;
    if (past.type !== null) type = past.type.name;
  }

  const shortEffect = move.effect_entries.find((entry) => entry.language.name === "en")?.short_effect;
  if (shortEffect === undefined) throw new Error(`move ${move.name}: no English short effect`);

  return {
    id: move.name,
    moveId: move.id,
    type,
    damageClass: move.damage_class.name,
    power,
    accuracy,
    pp,
    priority: move.priority,
    shortEffect: shortEffect.replace(/\s+/g, " ").trim(),
  };
}

function statsOf(pokemon: PokemonDocument): SnapshotStats {
  const byName = new Map(pokemon.stats.map((entry) => [entry.stat.name, entry.base_stat]));
  const stats: Partial<SnapshotStats> = {};
  for (const name of STAT_NAMES) {
    const value = byName.get(name);
    if (value === undefined) throw new Error(`${pokemon.name}: missing base stat ${name}`);
    stats[name] = value;
  }
  return stats as SnapshotStats;
}

/**
 * Moves legal in the target version group. Upstream addresses move documents
 * by numeric id, so the ids of every referenced move are collected into
 * `moveIds` as a side effect rather than re-derived later.
 */
function learnsetOf(pokemon: PokemonDocument, moveIds: Map<string, number>): SnapshotLearnedMove[] {
  const learned: SnapshotLearnedMove[] = [];
  for (const entry of pokemon.moves) {
    for (const detail of entry.version_group_details) {
      if (detail.version_group.name !== VERSION_GROUP) continue;
      const method = detail.move_learn_method.name;
      moveIds.set(entry.move.name, idFromUrl(entry.move.url, "move"));
      learned.push({
        move: entry.move.name,
        method,
        level: method === "level-up" ? detail.level_learned_at : null,
      });
    }
  }
  return learned.sort(
    (a, b) => a.move.localeCompare(b.move) || a.method.localeCompare(b.method) || (a.level ?? 0) - (b.level ?? 0),
  );
}

// --- build ------------------------------------------------------------------

async function build(commit: string): Promise<SnapshotDocument> {
  const registry = new PinnedRegistry(commit);

  const generations = await registry.read<ListDocument>("generation");
  const generationOrder = new Map(
    generations.results.map((entry) => [entry.name, idFromUrl(entry.url, "generation")]),
  );

  const versionGroupList = await registry.read<ListDocument>("version-group");
  const versionGroups = await mapPooled(versionGroupList.results, (entry) =>
    registry.read<VersionGroupDocument>(`version-group/${idFromUrl(entry.url, "version-group")}`),
  );
  const versionGroupOrder = new Map(versionGroups.map((group) => [group.name, group.order]));

  const target = versionGroups.find((group) => group.name === VERSION_GROUP);
  if (!target) throw new Error(`version group ${VERSION_GROUP} not found upstream`);
  const targetGenerationOrder = generationOrder.get(target.generation.name);
  if (targetGenerationOrder === undefined) {
    throw new Error(`generation ${target.generation.name} not found upstream`);
  }

  const pokedex = await registry.read<PokedexDocument>(`pokedex/${POKEDEX_ID}`);
  const entries = [...pokedex.pokemon_entries].sort((a, b) => a.entry_number - b.entry_number);
  console.error(`pokédex ${POKEDEX_ID}: ${entries.length} entries`);

  const moveIds = new Map<string, number>();
  const species = await mapPooled(entries, async (entry) => {
    const speciesId = idFromUrl(entry.pokemon_species.url, "pokemon-species");
    const document = await registry.read<SpeciesDocument>(`pokemon-species/${speciesId}`);
    const variety = document.varieties.find((candidate) => candidate.is_default);
    if (!variety) throw new Error(`${document.name}: no default variety`);
    const pokemonId = idFromUrl(variety.pokemon.url, "pokemon");
    const pokemon = await registry.read<PokemonDocument>(`pokemon/${pokemonId}`);
    return {
      id: document.name,
      speciesId: document.id,
      pokemonId: pokemon.id,
      pokedexNumber: entry.entry_number,
      isLegendary: document.is_legendary,
      isMythical: document.is_mythical,
      types: typesAt(pokemon, generationOrder, targetGenerationOrder),
      stats: statsOf(pokemon),
      learnset: learnsetOf(pokemon, moveIds),
    } satisfies SnapshotSpecies;
  });

  const referenced = [...moveIds.entries()].sort(([a], [b]) => a.localeCompare(b));
  console.error(`learnsets reference ${referenced.length} distinct moves`);
  const moves = await mapPooled(referenced, async ([, moveId]) => {
    const document = await registry.read<MoveDocument>(`move/${moveId}`);
    return moveAt(document, versionGroupOrder, target.order);
  });

  const content = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: SNAPSHOT_ID,
    scope: {
      pokedex: "kanto",
      pokedexId: POKEDEX_ID,
      versionGroup: target.name,
      versionGroupOrder: target.order,
      generation: target.generation.name,
    },
    species,
    moves,
  } as const;

  return {
    ...content,
    contentDigest: sha256(stableStringify(snapshotContent(content))),
    source: {
      repository: REPOSITORY,
      commit,
      license: LICENSE,
      licenseFile: LICENSE_FILE,
      notice: NOTICE,
      documentCount: registry.documentCount,
      documentsDigest: registry.documentsDigest,
      caveats: CAVEATS,
    },
  };
}

// --- entry point ------------------------------------------------------------

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1]?.trim();
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commit = flagValue(argv, "--commit") ?? DEFAULT_COMMIT;
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`--commit must be a 40-character sha: ${commit}`);
  const checkOnly = argv.includes("--check");

  const outputPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    `../data/snapshots/${SNAPSHOT_ID}.json`,
  );

  console.error(`building ${SNAPSHOT_ID} from ${REPOSITORY} @ ${commit}`);
  const snapshot = await build(commit);
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  console.error(
    `${snapshot.species.length} species, ${snapshot.moves.length} moves, ` +
      `${snapshot.source.documentCount} upstream documents`,
  );
  console.error(`content  ${snapshot.contentDigest}`);
  console.error(`sources  ${snapshot.source.documentsDigest}`);

  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8").catch(() => undefined);
    if (existing === undefined) throw new Error(`no vendored snapshot at ${outputPath}`);
    const vendored = JSON.parse(existing) as SnapshotDocument;
    if (vendored.contentDigest !== snapshot.contentDigest) {
      throw new Error(
        `vendored snapshot differs from upstream\n` +
          `  vendored ${vendored.contentDigest}\n  upstream ${snapshot.contentDigest}`,
      );
    }
    console.error("check: vendored snapshot matches upstream");
    return;
  }

  await writeFile(outputPath, serialized);
  console.error(`wrote ${outputPath}`);
}

await main();
