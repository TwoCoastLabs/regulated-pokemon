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
 *   npm run snapshot:fetch -- --check --head      # verify against upstream head
 *
 * `--check` on its own re-derives from the pinned commit and can only fail if
 * the vendored file was edited: a commit is immutable, so the bytes cannot
 * move under it. `--check --head` re-derives from upstream's current default
 * branch instead, which is the question the drift watch asks.
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
  SNAPSHOT_VERSIONS,
  type SnapshotDocument,
  type SnapshotEncounter,
  type SnapshotEvolution,
  type SnapshotLearnedMove,
  type SnapshotMove,
  type SnapshotSpecies,
  type SnapshotStats,
  type SnapshotTypeChart,
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
  "The type chart is pinned to this generation via upstream " +
    "`past_damage_relations`, era quirks preserved (e.g. Ghost dealing no " +
    "damage to Psychic in generation I). It is vendored as a complete " +
    "matrix; upstream's sparse relations are expanded so that a missing " +
    "cell can never read as neutral.",
  "Move legality is pinned to this version group via upstream learnset entries.",
  "Move power, accuracy, PP and type are pinned via upstream `past_values`.",
  "Base stats are NOT version-pinned: upstream publishes present-day values " +
    "only, and several species were re-statted in later generations. Claims " +
    "over stats are certified against this snapshot, not against the " +
    "original cartridge.",
  "Move effect text is present-day upstream wording; it is not version-pinned.",
  "Species absent from this Pokédex are not certified by this snapshot and " +
    "cannot be asserted from it.",
  "Evolution chains are NOT version-pinned upstream: edges are restricted at " +
    "build time to species this snapshot certifies (excluding later relatives " +
    "such as Pichu, Espeon and Crobat), but triggers and items are " +
    "present-day upstream data.",
  "Encounters are presence-only, per cartridge (red, blue), filtered from " +
    "upstream version details. Rates and level ranges are deliberately not " +
    "vendored.",
  "TM/HM assignments are pinned to this version group via upstream machine " +
    "records.",
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
  evolution_chain: { url: string };
}

interface EvolutionDetail {
  trigger: NamedResource;
  min_level: number | null;
  item: NamedResource | null;
}

interface ChainLink {
  species: NamedResource;
  evolution_details: EvolutionDetail[];
  evolves_to: ChainLink[];
}

interface EvolutionChainDocument {
  id: number;
  chain: ChainLink;
}

interface EncounterDocument
  extends Array<{
    location_area: NamedResource;
    version_details: Array<{ version: NamedResource }>;
  }> {}

interface MachineDocument {
  id: number;
  item: NamedResource;
  move: NamedResource;
  version_group: NamedResource;
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

interface DamageRelations {
  double_damage_to: NamedResource[];
  half_damage_to: NamedResource[];
  no_damage_to: NamedResource[];
}

interface TypeDocument {
  id: number;
  name: string;
  generation: NamedResource;
  damage_relations: DamageRelations;
  past_damage_relations: Array<{ generation: NamedResource; damage_relations: DamageRelations }>;
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
  machines: Array<{ machine: { url: string }; version_group: NamedResource }>;
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

function moveAt(move: MoveDocument, versionGroupOrder: Map<string, number>, target: number): Omit<SnapshotMove, "machine"> {
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

/**
 * The generation's damage chart, expanded to a complete matrix.
 *
 * Upstream ships sparse relations (only the non-neutral cells), recorded
 * against the *last* generation in which they applied — the same convention as
 * `past_types`, resolved by the same walk. Every attacking × defending cell is
 * written out: 1 unless the era's relations say otherwise, so downstream a
 * missing cell is a loader refusal rather than an implicit neutral.
 */
function chartOf(
  types: readonly TypeDocument[],
  generationOrder: Map<string, number>,
  target: number,
): SnapshotTypeChart {
  const names = types.map((entry) => entry.name).sort();
  const inGeneration = new Set(names);

  const multipliers: Record<string, Record<string, number>> = {};
  for (const name of names) {
    const document = types.find((entry) => entry.name === name)!;
    const past = applicableEntries(
      document.past_damage_relations,
      (entry) => generationOrder.get(entry.generation.name),
      target,
    );
    // Each past entry restates the full relations, so the earliest applicable
    // entry — last after the latest-to-earliest walk — wins, as with types.
    const relations = past.at(-1)?.damage_relations ?? document.damage_relations;

    const row: Record<string, number> = {};
    for (const defending of names) row[defending] = 1;
    for (const [resources, multiplier] of [
      [relations.double_damage_to, 2],
      [relations.half_damage_to, 0.5],
      [relations.no_damage_to, 0],
    ] as const) {
      for (const resource of resources) {
        // Relations may point at types from later generations; those defenders
        // do not exist in this world and get no cell.
        if (inGeneration.has(resource.name)) row[resource.name] = multiplier;
      }
    }
    multipliers[name] = row;
  }

  return { types: names, multipliers };
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

/**
 * The certified evolution edges around one species: its parent and children,
 * both restricted to the ids this snapshot certifies. Upstream chains are not
 * version-pinned, so the restriction is what keeps Pichu from parenting
 * Pikachu in a world where Pichu does not exist. Upstream sometimes repeats an
 * identical detail entry (Raichu's stone twice); edges are deduplicated on
 * their whole shape.
 */
function evolutionEdges(
  chain: EvolutionChainDocument,
  speciesId: string,
  certified: ReadonlySet<string>,
): { evolvesFrom: string | null; evolvesTo: SnapshotEvolution[] } {
  let evolvesFrom: string | null = null;
  const evolvesTo: SnapshotEvolution[] = [];

  const walk = (node: ChainLink, parent: string | null): void => {
    if (node.species.name === speciesId) {
      evolvesFrom = parent !== null && certified.has(parent) ? parent : null;
      for (const child of node.evolves_to) {
        if (!certified.has(child.species.name)) continue;
        const seen = new Set<string>();
        for (const detail of child.evolution_details) {
          const edge: SnapshotEvolution = {
            to: child.species.name,
            trigger: detail.trigger.name,
            minLevel: detail.min_level,
            item: detail.item?.name ?? null,
          };
          const key = JSON.stringify(edge);
          if (seen.has(key)) continue;
          seen.add(key);
          evolvesTo.push(edge);
        }
        // A certified child with no detail entries still evolves somehow;
        // upstream owes the trigger, and silence here would drop the edge.
        if (child.evolution_details.length === 0) {
          evolvesTo.push({ to: child.species.name, trigger: "unknown", minLevel: null, item: null });
        }
      }
    }
    for (const child of node.evolves_to) walk(child, node.species.name);
  };
  walk(chain.chain, null);
  return { evolvesFrom, evolvesTo };
}

/** Presence-only encounters for this version group's cartridges, sorted. */
function encountersOf(document: EncounterDocument): SnapshotEncounter[] {
  const byArea = new Map<string, Set<string>>();
  for (const entry of document) {
    const versions = entry.version_details
      .map((detail) => detail.version.name)
      .filter((version) => SNAPSHOT_VERSIONS.includes(version));
    if (versions.length === 0) continue;
    const set = byArea.get(entry.location_area.name) ?? new Set<string>();
    for (const version of versions) set.add(version);
    byArea.set(entry.location_area.name, set);
  }
  return [...byArea.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, versions]) => ({ area, versions: [...versions].sort() }));
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

  const typeList = await registry.read<ListDocument>("type");
  const typeDocuments = await mapPooled(typeList.results, (entry) =>
    registry.read<TypeDocument>(`type/${idFromUrl(entry.url, "type")}`),
  );
  // The chart is closed over the types this generation *has*: a type
  // introduced later does not exist in this world, so it gets no row, no
  // column, and no way to be asserted.
  const generationTypes = typeDocuments.filter((document) => {
    const order = generationOrder.get(document.generation.name);
    return order !== undefined && order <= targetGenerationOrder;
  });
  const typeChart = chartOf(generationTypes, generationOrder, targetGenerationOrder);
  console.error(`type chart: ${typeChart.types.length} types`);

  const pokedex = await registry.read<PokedexDocument>(`pokedex/${POKEDEX_ID}`);
  const entries = [...pokedex.pokemon_entries].sort((a, b) => a.entry_number - b.entry_number);
  console.error(`pokédex ${POKEDEX_ID}: ${entries.length} entries`);

  const moveIds = new Map<string, number>();
  const gathered = await mapPooled(entries, async (entry) => {
    const speciesId = idFromUrl(entry.pokemon_species.url, "pokemon-species");
    const document = await registry.read<SpeciesDocument>(`pokemon-species/${speciesId}`);
    const variety = document.varieties.find((candidate) => candidate.is_default);
    if (!variety) throw new Error(`${document.name}: no default variety`);
    const pokemonId = idFromUrl(variety.pokemon.url, "pokemon");
    const pokemon = await registry.read<PokemonDocument>(`pokemon/${pokemonId}`);
    return { entry, document, pokemon };
  });

  // Evolution needs the whole certified set before any edge is kept, so the
  // chains are read in a second pass — one fetch per distinct chain.
  const certified = new Set(gathered.map(({ document }) => document.name));
  const chainIds = [...new Set(gathered.map(({ document }) => idFromUrl(document.evolution_chain.url, "evolution-chain")))].sort(
    (a, b) => a - b,
  );
  const chains = new Map(
    await mapPooled(chainIds, async (chainId) => {
      const chain = await registry.read<EvolutionChainDocument>(`evolution-chain/${chainId}`);
      return [chainId, chain] as const;
    }),
  );
  console.error(`evolution: ${chains.size} distinct chains`);

  const species = await mapPooled(gathered, async ({ entry, document, pokemon }) => {
    const chain = chains.get(idFromUrl(document.evolution_chain.url, "evolution-chain"));
    if (chain === undefined) throw new Error(`${document.name}: evolution chain not fetched`);
    const edges = evolutionEdges(chain, document.name, certified);
    const encounterDocument = await registry.read<EncounterDocument>(`pokemon/${pokemon.id}/encounters`);
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
      evolvesFrom: edges.evolvesFrom,
      evolvesTo: edges.evolvesTo,
      encounters: encountersOf(encounterDocument),
    } satisfies SnapshotSpecies;
  });

  const referenced = [...moveIds.entries()].sort(([a], [b]) => a.localeCompare(b));
  console.error(`learnsets reference ${referenced.length} distinct moves`);
  const moves = await mapPooled(referenced, async ([, moveId]) => {
    const document = await registry.read<MoveDocument>(`move/${moveId}`);
    const base = moveAt(document, versionGroupOrder, target.order);
    // The TM/HM that carries the move in this version group, when one does.
    const machineRef = document.machines.find((entry) => entry.version_group.name === VERSION_GROUP);
    if (machineRef === undefined) return { ...base, machine: null };
    const machine = await registry.read<MachineDocument>(`machine/${idFromUrl(machineRef.machine.url, "machine")}`);
    return { ...base, machine: machine.item.name };
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
    typeChart,
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

// --- drift ------------------------------------------------------------------

/**
 * What `--check` found, as an exit code.
 *
 * Distinct codes rather than pass/fail because the two kinds of drift mean
 * different things and deserve different responses. `content` means the
 * projection this repository vendors has changed and a re-pin would change
 * certified facts. `documents` means upstream churned in ways our narrow
 * projection filters out — worth knowing, not worth acting on.
 *
 * Neither is a regression in this repository, so neither belongs in the PR
 * gate; see .github/workflows/upstream-drift.yml.
 */
const DRIFT_EXIT = { none: 0, documents: 3, content: 4 } as const;

type DriftKind = keyof typeof DRIFT_EXIT;

/**
 * Compare the vendored snapshot against a freshly derived one.
 *
 * The report goes to stdout as `key=value` lines while every other message in
 * this script goes to stderr, so a caller can quote stdout verbatim into an
 * issue body without scraping progress chatter out of it.
 */
function reportDrift(vendored: SnapshotDocument, upstream: SnapshotDocument): DriftKind {
  const contentMoved = vendored.contentDigest !== upstream.contentDigest;
  const documentsMoved = vendored.source.documentsDigest !== upstream.source.documentsDigest;
  const kind: DriftKind = contentMoved ? "content" : documentsMoved ? "documents" : "none";

  const report = [
    `drift=${kind}`,
    `commit.vendored=${vendored.source.commit}`,
    `commit.upstream=${upstream.source.commit}`,
    `content.vendored=${vendored.contentDigest}`,
    `content.upstream=${upstream.contentDigest}`,
    `documents.vendored=${vendored.source.documentsDigest}`,
    `documents.upstream=${upstream.source.documentsDigest}`,
    `species.vendored=${vendored.species.length}`,
    `species.upstream=${upstream.species.length}`,
    `moves.vendored=${vendored.moves.length}`,
    `moves.upstream=${upstream.moves.length}`,
  ];
  console.log(report.join("\n"));

  console.error(
    kind === "none"
      ? "check: vendored snapshot matches upstream, both digests"
      : kind === "documents"
        ? "check: upstream documents changed, but the projection we vendor did not"
        : "check: the projection we vendor has changed upstream",
  );
  return kind;
}

/** The upstream default branch, resolved to a commit so the run is pinned. */
async function resolveHead(): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch("https://api.github.com/repos/PokeAPI/api-data/commits/HEAD", {
    headers: {
      accept: "application/vnd.github+json",
      // Optional: only to stay clear of the unauthenticated rate limit on
      // shared CI addresses. This repository's own token is enough; the
      // request reads a public repository.
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
  });
  if (!response.ok) {
    throw new Error(`cannot resolve upstream head: HTTP ${response.status} ${response.statusText}`);
  }
  const { sha } = (await response.json()) as { sha: string };
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`upstream head is not a sha: ${sha}`);
  return sha;
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
  const checkOnly = argv.includes("--check");
  const againstHead = argv.includes("--head");
  if (againstHead && !checkOnly) throw new Error("--head only makes sense with --check");
  if (againstHead && flagValue(argv, "--commit") !== undefined) {
    throw new Error("--head and --commit name different things to build from");
  }

  const commit = againstHead ? await resolveHead() : (flagValue(argv, "--commit") ?? DEFAULT_COMMIT);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`--commit must be a 40-character sha: ${commit}`);

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
    process.exitCode = DRIFT_EXIT[reportDrift(vendored, snapshot)];
    return;
  }

  await writeFile(outputPath, serialized);
  console.error(`wrote ${outputPath}`);
}

await main();
