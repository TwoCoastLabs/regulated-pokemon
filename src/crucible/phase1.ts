/**
 * Phase 1 crucible: sabotage of the certified registry and of closed rosters,
 * each piece of which must be denied by its named article.
 *
 * The shapes these are written in — and why they are values rather than test
 * bodies — live in harness.ts.
 */

import type { ArticleId } from "../kernel/accord.js";
import type { ClosedRoster, RosterCriteria, Verdict } from "../kernel/contracts.js";
import { type CertifiedRegistry, loadRegistry } from "../kernel/registry.js";
import { buildRoster, verifyRoster } from "../kernel/roster.js";
import { SNAPSHOT_SCHEMA_VERSION, type SnapshotDocument } from "../kernel/snapshot-format.js";
import { verdictOf } from "../kernel/violation.js";
import { type Control, mutable, type Mutation } from "./harness.js";

const ELECTRIC: RosterCriteria = { all: [{ kind: "has-type", type: "electric" }] };

/** Sabotage the vendored document, then ask the loader to trust it. */
function sabotageSnapshot(registry: CertifiedRegistry, sabotage: (document: SnapshotDocument) => void): Verdict {
  const document = structuredClone(registry.document) as SnapshotDocument;
  sabotage(document);
  const loaded = loadRegistry(document);
  return loaded.ok ? verdictOf([]) : verdictOf(loaded.violations);
}

/** Certify a roster honestly, sabotage it afterwards, then verify it. */
function sabotageRoster(registry: CertifiedRegistry, sabotage: (roster: ClosedRoster) => ClosedRoster): Verdict {
  const built = buildRoster(registry, "electric-kanto", ELECTRIC);
  if (!built.ok) return verdictOf(built.violations);
  return verifyRoster(registry, sabotage(built.value));
}

function speciesNamed(document: SnapshotDocument, id: string) {
  const found = document.species.find((species) => species.id === id);
  if (found === undefined) throw new Error(`crucible fixture expects species ${id}`);
  return found;
}

export const PHASE_1_MUTATIONS: readonly Mutation[] = [
  {
    id: "steel-magnemite",
    title: "Edit a certified fact in the vendored file",
    description:
      "Give Magnemite the Steel type it only gained in generation II. Nothing " +
      "structural is broken and the edit is plausible, so only the content " +
      "digest stands between an edited file and a certified answer.",
    article: "IA-2",
    rule: "snapshot-digest-mismatch",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        const magnemite = speciesNamed(document, "magnemite");
        mutable(magnemite).types = ["electric", "steel"];
      }),
  },
  {
    id: "duplicate-species",
    title: "Register a second Pikachu",
    description:
      "Two entries share one id, so which one a fact resolves from depends on " +
      "lookup order. Ambiguous identity is a route to asserting something that " +
      "is not so.",
    article: "IA-3",
    rule: "duplicate-entity",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        const pikachu = speciesNamed(document, "pikachu");
        const impostor = mutable(structuredClone(pikachu));
        impostor.stats.speed = 300;
        mutable(document).species.push(impostor);
      }),
  },
  {
    id: "phantom-move",
    title: "Teach a move that does not exist",
    description:
      "A learnset cites a move absent from the move table. Left alone, the " +
      "registry would happily report a species that learns nothing at all.",
    article: "IA-3",
    rule: "dangling-move-reference",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        const pikachu = speciesNamed(document, "pikachu");
        mutable(pikachu).learnset.push({ move: "hyper-fang-blast", method: "machine", level: null });
      }),
  },
  {
    id: "shuffled-dex",
    title: "Shuffle the Pokédex order",
    description:
      "Reordering breaks nothing a reader would notice, and breaks every " +
      "digest taken over a roster derived from it.",
    article: "IA-2",
    rule: "snapshot-inconsistent",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        mutable(document).species.reverse();
      }),
  },
  {
    id: "future-schema",
    title: "Serve a snapshot from a later schema",
    description:
      "A registry the kernel does not know how to read is not a registry it " +
      "may guess at.",
    article: "IA-2",
    rule: "snapshot-schema-unsupported",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        // Relative, not a literal: "the future" must stay ahead of whatever
        // schema the kernel currently reads.
        (document as { schemaVersion: number }).schemaVersion = SNAPSHOT_SCHEMA_VERSION + 1;
      }),
  },
  {
    id: "inject-missingno",
    title: "Add MissingNo to the roster",
    description:
      "The MissingNo clause in one line: a member that the certified registry " +
      "has never heard of.",
    article: "IA-3",
    rule: "fabricated-entity",
    run: ({ registry }) =>
      sabotageRoster(registry, (roster) => ({
        ...roster,
        memberIds: [...roster.memberIds, "missingno"],
        cardinality: roster.cardinality + 1,
      })),
  },
  {
    id: "drop-a-member",
    title: "Quietly drop a member",
    description:
      "Zapdos meets the criteria and is left out. The count is adjusted to " +
      "match, so the roster is internally consistent and still wrong.",
    article: "IA-4",
    rule: "roster-member-missing",
    run: ({ registry }) =>
      sabotageRoster(registry, (roster) => ({
        ...roster,
        memberIds: roster.memberIds.filter((id) => id !== "zapdos"),
        cardinality: roster.cardinality - 1,
      })),
  },
  {
    id: "add-an-outsider",
    title: "Slip in a member that fails the criteria",
    description: "Snorlax is not Electric, and no amount of confident phrasing makes it so.",
    article: "IA-4",
    rule: "roster-member-extra",
    run: ({ registry }) =>
      sabotageRoster(registry, (roster) => ({
        ...roster,
        memberIds: [...roster.memberIds, "snorlax"],
        cardinality: roster.cardinality + 1,
      })),
  },
  {
    id: "tamper-the-count",
    title: "Change the number without changing the list",
    description:
      "Every member is correct and the stated total is not. The roster is the " +
      "count, so the certificate contradicts itself.",
    article: "IA-4",
    rule: "cardinality-mismatch",
    run: ({ registry }) => sabotageRoster(registry, (roster) => ({ ...roster, cardinality: roster.cardinality - 1 })),
  },
  {
    id: "foreign-snapshot",
    title: "Answer from a different game",
    description:
      "A roster certified against Yellow, presented as an answer about " +
      "Red/Blue. Facts are only facts within the version that certifies them.",
    article: "IA-2",
    rule: "snapshot-mismatch",
    run: ({ registry }) => sabotageRoster(registry, (roster) => ({ ...roster, snapshotId: "kanto-yellow" })),
  },
  {
    id: "chart-off-scale",
    title: "Write a multiplier the game does not have",
    description:
      "A 3× cell is not a stronger opinion, it is a value outside the game's " +
      "own scale — the chart refuses it before anything can derive from it.",
    article: "IA-2",
    rule: "chart-invalid-multiplier",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        mutable(document.typeChart.multipliers)["water"]!["fire"] = 3;
      }),
  },
  {
    id: "chart-missing-cell",
    title: "Delete a cell and hope it reads as neutral",
    description:
      "Sparse charts make 'no entry' and 'neutral' the same bytes. This one " +
      "is complete by construction, so a missing cell is a refusal, never a 1×.",
    article: "IA-2",
    rule: "chart-incomplete",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        delete mutable(document.typeChart.multipliers)["ground"]!["flying"];
      }),
  },
  {
    id: "espeon-evolution",
    title: "Evolve Eevee into a species from the future",
    description:
      "Espeon is five years away. An evolution edge into a species this " +
      "snapshot does not certify is a road out of the closed world, and a " +
      "record that could cite it could cite anything.",
    article: "IA-3",
    rule: "dangling-evolution-reference",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        mutable(speciesNamed(document, "eevee")).evolvesTo.push({
          to: "espeon",
          trigger: "level-up",
          minLevel: null,
          item: null,
        });
      }),
  },
  {
    id: "yellow-encounter",
    title: "File an encounter from another cartridge",
    description:
      "Pikachu 'found' via Yellow's script, recorded under Red/Blue's name. " +
      "The version group's cartridges are a closed set; an encounter outside " +
      "them is a fact about a different game.",
    article: "IA-2",
    rule: "encounter-version-unclosed",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        mutable(speciesNamed(document, "pikachu")).encounters.push({ area: "pallet-town-area", versions: ["yellow"] });
      }),
  },
  {
    id: "bootleg-machine",
    title: "Teach a move from a bootleg cartridge",
    description:
      "A 'machine' that is not a TM or HM is not a way this game teaches " +
      "anything; the loader refuses the shape before a claim can cite it.",
    article: "IA-2",
    rule: "machine-invalid",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        const surf = document.moves.find((move) => move.id === "surf");
        if (surf === undefined) throw new Error("crucible fixture expects surf");
        mutable(surf).machine = "bootleg-01";
      }),
  },
  {
    id: "fairy-clefable",
    title: "Type a species outside the generation's chart",
    description:
      "Clefable became a Fairy type five generations after Red/Blue. A type " +
      "the chart does not close over does not exist in this world, and a " +
      "species wearing it is dangling off the certified universe.",
    article: "IA-3",
    rule: "dangling-type-reference",
    run: ({ registry }) =>
      sabotageSnapshot(registry, (document) => {
        speciesNamed(document, "clefable");
        mutable(speciesNamed(document, "clefable")).types = ["fairy"];
      }),
  },
];

/**
 * The runs that must be allowed. Every mutation above is only evidence if
 * both of these pass: if a control ever denies, the crucible is measuring a
 * broken harness rather than a working kernel.
 */
export const PHASE_1_CONTROLS: readonly Control[] = [
  {
    id: "clean-path",
    kind: "clean-path",
    title: "Certify and verify with nothing in the way",
    description:
      "The vendored snapshot loaded, a roster built from it and verified, " +
      "through the kernel's own entry points and no sabotage harness at all.",
    run: ({ registry }) => {
      const built = buildRoster(registry, "control", ELECTRIC);
      return built.ok ? verifyRoster(registry, built.value) : verdictOf(built.violations);
    },
  },
  {
    id: "no-op-sabotage",
    kind: "no-op-sabotage",
    title: "Change nothing, through the identical harness",
    description:
      "The unmutated pipeline, run through the same sabotage functions every " +
      "mutation uses — with the sabotage itself a no-op.",
    run: ({ registry }) => {
      const loaded = sabotageSnapshot(registry, () => {});
      return loaded.allowed ? sabotageRoster(registry, (roster) => roster) : loaded;
    },
  },
];

/** Articles the phase-1 crucible exercises. Pinned by test, both ways. */
export const PHASE_1_ARTICLES: readonly ArticleId[] = ["IA-2", "IA-3", "IA-4"];
