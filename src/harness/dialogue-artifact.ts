/**
 * The filed record of a dialogue coverage run.
 *
 * A multi-turn number, like a single-turn one, must be traceable to the run
 * that produced it (CLAUDE.md). So a live dialogue run files the same kind of
 * record the single-turn coverage run does (coverage-artifact.ts): whole
 * conversations — every turn's transcript and, where one was reached, the
 * transaction `replayTransaction` re-executes — with the provenance naming the
 * certified world and the dialogue bank the numbers were measured in. The map
 * is computed once, at filing time, and rendered from the file ever after.
 *
 * Dialogue artifacts live in `runs/coverage/` alongside the single-turn ones
 * but under the `dialogue` label, so `runs/`'s consumers — which assume every
 * file there is a single-turn harness run — never mistake one for the other.
 */

import { join } from "node:path";

import type { AccordPack } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import type { ArtifactWorld } from "./artifact.js";
import type { CoverageModel } from "./coverage-artifact.js";
import { type DialogueCoverageMap, dialogueCoverage, renderDialogueCoverage } from "./dialogue-coverage.js";
import type { RecordedDialogueRun } from "./dialogue-run.js";

export const DIALOGUE_ARTIFACT_SCHEMA_VERSION = 1;

/** The label that doubles as the filename suffix (`<ts>-dialogue.json`). */
export const DIALOGUE_LABEL = "dialogue";

export interface DialogueArtifact {
  schemaVersion: typeof DIALOGUE_ARTIFACT_SCHEMA_VERSION;
  label: typeof DIALOGUE_LABEL;
  /** When the run started, by the wall clock — the only real timestamp here;
   * the conversations below carry the harness's fixed clock so they replay. */
  startedAt: string;
  world: ArtifactWorld;
  /** Which reviewed dialogue bank these conversations came from, by its id. */
  bankId: string;
  model: CoverageModel;
  /** Whether the answer grammar was enforced at decode time — it changes what
   * the usefulness number means, so it travels with the number. */
  structuredOutput: boolean;
  /** Whether the proposer was handed the certified facts to compose from — a
   * usefulness dial that leaves enforcement untouched, recorded with the number. */
  grounded: boolean;
  /** Whether grounding was retrieval-scoped (only what each question needs)
   * rather than the whole registry. At most one of this and {@link grounded}. */
  retrieval: boolean;
  /** Whether the answer grammar was narrowed to each question's nominated kinds
   * (§19) — recorded with the number. */
  gatedGrammar: boolean;
  /** Whether strip-assertion resubmit was enabled — recorded with the number. */
  repair: boolean;
  /** How many passes each conversation ran (epic #94, slice 5). Optional:
   * artifacts filed before the dial existed read unchanged as one pass. */
  repetitions?: number;
  /** Whole conversations, never summaries. Each turn carries the wording asked
   * and the full record behind its funnel verdict. */
  runs: readonly RecordedDialogueRun[];
  /** The aggregate the page renders — computed here, at filing time, from the
   * runs above, and never recomputed downstream. */
  map: DialogueCoverageMap;
}

export interface DialogueArtifactInput {
  startedAt: string;
  world: { registry: CertifiedRegistry; pack: AccordPack };
  bankId: string;
  model: CoverageModel;
  structuredOutput: boolean;
  grounded: boolean;
  retrieval: boolean;
  gatedGrammar: boolean;
  repair: boolean;
  repetitions?: number;
  runs: readonly RecordedDialogueRun[];
}

export function buildDialogueArtifact(input: DialogueArtifactInput): DialogueArtifact {
  const { document, snapshot } = input.world.registry;
  return {
    schemaVersion: DIALOGUE_ARTIFACT_SCHEMA_VERSION,
    label: DIALOGUE_LABEL,
    startedAt: input.startedAt,
    world: {
      snapshotId: snapshot.id,
      snapshotDigest: document.contentDigest,
      sourceCommit: snapshot.sourceCommit,
      packId: input.world.pack.id,
    },
    bankId: input.bankId,
    model: input.model,
    structuredOutput: input.structuredOutput,
    grounded: input.grounded,
    retrieval: input.retrieval,
    gatedGrammar: input.gatedGrammar,
    repair: input.repair,
    ...(input.repetitions === undefined || input.repetitions <= 1 ? {} : { repetitions: input.repetitions }),
    runs: input.runs,
    map: dialogueCoverage(input.runs),
  };
}

// --- rendering a filed artifact ---------------------------------------------

/** The filed run as a Markdown page: provenance first, then the map it filed.
 * A function of the artifact alone — same bytes in, same page out. */
export function renderDialogueArtifact(artifact: DialogueArtifact): string {
  const { world } = artifact;
  const header = [
    "# Dialogue coverage — filed run",
    "",
    "<!-- Generated from a dialogue artifact; do not hand-edit. Regenerate with `npm run coverage:map -- --dialogues`. -->",
    "",
    `Generated from a **dialogue** run started \`${artifact.startedAt}\` on \`${artifact.model.slug}\`, ` +
      `${artifact.retrieval ? "**grounded by retrieval** (only the facts each question needs)" : artifact.grounded ? "**grounded** (the whole certified registry)" : "ungrounded (answered from its own knowledge)"}${artifact.gatedGrammar ? ", **gated grammar**" : ""}${artifact.repair ? ", **repair**" : ""}.`,
    "",
    "## Provenance",
    "",
    `Dialogue bank \`${artifact.bankId}\`, measured against snapshot \`${world.snapshotId}\` (\`${world.snapshotDigest}\`), ` +
      `derived from upstream commit \`${world.sourceCommit}\`, under Accord pack \`${world.packId}\`. ` +
      "A result against an unnamed world is not a result.",
    "",
  ];

  return `${header.join("\n")}${renderDialogueCoverage(artifact.map, `Dialogue coverage — ${artifact.model.slug}`)}`;
}

/**
 * The newest dialogue artifact in a directory, by filename — and only a
 * dialogue one: `runs/coverage/` also holds the single-turn coverage artifacts,
 * and rendering one of those through this reader would be a shape error
 * presented as a result.
 */
export function latestDialogueArtifact(directory: string, readDir: (directory: string) => readonly string[]): string | undefined {
  const files = readDir(directory)
    .filter((name) => name.endsWith(`-${DIALOGUE_LABEL}.json`))
    .sort();
  const newest = files.at(-1);
  return newest === undefined ? undefined : join(directory, newest);
}
