/**
 * The filed record of a coverage run — wave 4's precondition.
 *
 * The coverage map is the number the playability epic exists to publish, and a
 * published number must be traceable to the run that produced it (CLAUDE.md).
 * So a live coverage run files the same kind of record the live harness does
 * (artifact.ts): whole runs — every transcript and, where one was reached, the
 * transaction `replayTransaction` re-executes — with the provenance naming the
 * certified world and the bank the numbers were measured in. The map itself is
 * computed once, when the artifact is built, and rendered from the file ever
 * after; a page can disagree with its artifact only by being regenerated from
 * a different one.
 */

import { join } from "node:path";

import type { AccordPack } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import type { PromptShape } from "./advisor.js";
import type { ArtifactWorld } from "./artifact.js";
import type { IntentRobustness, RecordedBankRun } from "./bank-run.js";
import type { RawBankRun } from "./bank-raw.js";
import { type CoverageMap, coverageMap, renderCoverage, renderRobustness, type RobustnessSummary, robustnessSummary } from "./coverage.js";
import type { Disposition } from "./playability.js";
import { type GovernanceTax, governanceTax, renderTax } from "./tax.js";

export const COVERAGE_ARTIFACT_SCHEMA_VERSION = 1;

/** The two kinds of coverage run, doubling as the filename suffix. */
export type CoverageLabel = "coverage" | "coverage-robustness";

/** The precedent door as a run held it — recorded with the number, like every lever. */
export interface PrecedentLever {
  mode: "nearest" | "fixed";
  store: string;
  digest: string;
  k: number;
  threshold: number;
  fixed?: readonly string[];
}

export interface CoverageModel {
  /** The provider id the runs carry (`coverage:<slug>`). */
  id: string;
  /** The OpenRouter slug — the finding quotes this, never a nickname. */
  slug: string;
}

export interface CoverageArtifact {
  schemaVersion: typeof COVERAGE_ARTIFACT_SCHEMA_VERSION;
  label: CoverageLabel;
  /** When the run started, by the wall clock — the only real timestamp here;
   * the runs below carry the harness's fixed clock so they replay (IA-10). */
  startedAt: string;
  world: ArtifactWorld;
  /** Which reviewed bank these questions came from, by its versioned id. */
  bankId: string;
  model: CoverageModel;
  /** Whether the answer grammar was enforced at decode time — it changes what
   * the usefulness number means, so it travels with the number. */
  structuredOutput: boolean;
  /** Whether the proposer was handed the certified facts to compose from. Like
   * {@link structuredOutput}, it changes what the usefulness number measures —
   * composing from provided facts versus recalling them — while leaving
   * enforcement untouched, so it travels with the number. */
  grounded: boolean;
  /** Whether grounding was *retrieval*-scoped — only the rows each question
   * needs — rather than the whole registry. At most one of this and
   * {@link grounded} is true; both false is ungrounded. */
  retrieval: boolean;
  /** Whether the answer grammar was narrowed to the claim kinds each question
   * nominated (§19) — a usefulness dial like grounding, recorded with the
   * number because it changes what the number measures. */
  gatedGrammar: boolean;
  /** Whether strip-assertion resubmit was enabled (docs/recovery.md, channel
   * 2) — post-repair outcomes are then possible and are named apart in the
   * map (`repaired`), so the flag travels with the number. */
  repair: boolean;
  /** Set when the trainer's profile was set on the panel before the opener (epic #145, R2). */
  profile?: boolean;
  /** Set when the verifier-in-the-loop retry was on (docs/routing.md, R3b). */
  feedback?: boolean;
  /** Set when the model could ask its own clarifying question (R3b step 3). */
  clarify?: boolean;
  /** Set when the model could offer follow-up suggestions (R3b step 4). */
  suggest?: boolean;
  /**
   * The precedent door, when it was open (docs/precedent.md): which arm
   * (`nearest` retrieves per ask, `fixed` holds the same few on every call),
   * the store's path and digest, the levers, and the fixed ids when the
   * arm was fixed — so a published number names the memory it ran with.
   */
  precedents?: PrecedentLever;
  /** Which answer prompt the calls built (docs/answer-prompt.md): absent on
   * artifacts filed before the lever existed, which ran the legacy prompt. */
  prompt?: PromptShape;
  /** Set when a refused nomination was carried back to the model by name
   * rather than the door withdrawn in silence (docs/answer-prompt.md, M3). */
  refusalFeedback?: boolean;
  /** Set when the listing door was offered only where the driver would
   * accept it (docs/offered-door.md). */
  offeredDoors?: boolean;
  /** Set when the explanation route carried only the lessons the ask is
   * about, plus the boundary (docs/lesson-door.md). */
  lessonDoor?: boolean;
  /** Passes requested over the selected entries. The paid design runs the full
   * bank at 1 and the `should-refuse` slice at 3 — two artifacts, each honest
   * about which it is. */
  repetitions: number;
  /** The disposition filter the run was invoked with, when one was; absent
   * means the whole bank was eligible. */
  dispositions?: readonly Disposition[];
  /** True when an enforcement escalation stopped the run before its last
   * pass — the runs below are then fewer than requested, and say so. */
  stoppedEarly: boolean;
  /** Whole runs, never summaries. Each carries the wording asked, the pass it
   * came from, and the full record behind its funnel verdict. */
  runs: readonly RecordedBankRun[];
  /** The aggregate the page renders — computed here, at filing time, from the
   * runs above, and never recomputed downstream. */
  map: CoverageMap;
  /** The robustness reading, when the run iterated phrasings. */
  robustness?: RobustnessSummary;
  /**
   * The raw arm, when the run paid for it (`--raw`): the same entries asked
   * ungoverned, each reply published and metered, and the governance tax
   * computed once here from the two arms (docs/generalization.md §11). The
   * runs are whole, like the governed ones, so a tax number stays traceable
   * to the replies behind it.
   */
  raw?: {
    runs: readonly RawBankRun[];
    tax: GovernanceTax;
    /** The raw arm asks for the grammar in the prompt only — never enforced
     * at decode, unlike the governed leg's {@link structuredOutput}. Recorded
     * because it changes what the raw number measures. */
    structuredOutput: false;
  };
}

export interface CoverageArtifactInput {
  label: CoverageLabel;
  startedAt: string;
  world: { registry: CertifiedRegistry; pack: AccordPack };
  bankId: string;
  model: CoverageModel;
  structuredOutput: boolean;
  grounded: boolean;
  retrieval: boolean;
  gatedGrammar: boolean;
  repair: boolean;
  /** The trainer's profile was set on the panel before the opener (epic #145, R2). */
  profile?: boolean;
  /** Set when the verifier-in-the-loop retry was on (docs/routing.md, R3b). */
  feedback?: boolean;
  /** Set when the model could ask its own clarifying question (R3b step 3). */
  clarify?: boolean;
  /** Set when the model could offer follow-up suggestions (R3b step 4). */
  suggest?: boolean;
  /** The precedent door, when it was open (docs/precedent.md). */
  precedents?: PrecedentLever;
  /** Which answer prompt the calls built (docs/answer-prompt.md). */
  prompt?: PromptShape;
  /** Set when a refused nomination was carried back by name (M3). */
  refusalFeedback?: boolean;
  /** Set when the listing door was offered only where accepted (S4a). */
  offeredDoors?: boolean;
  lessonDoor?: boolean;
  repetitions: number;
  dispositions?: readonly Disposition[];
  stoppedEarly: boolean;
  runs: readonly RecordedBankRun[];
  /** The per-intent reports, when the run was a robustness pass. */
  robustness?: readonly IntentRobustness[];
  /** The raw arm's runs, when one was paid for. */
  raw?: readonly RawBankRun[];
}

export function buildCoverageArtifact(input: CoverageArtifactInput): CoverageArtifact {
  const { document, snapshot } = input.world.registry;
  return {
    schemaVersion: COVERAGE_ARTIFACT_SCHEMA_VERSION,
    label: input.label,
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
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
    ...(input.clarify === undefined ? {} : { clarify: input.clarify }),
    ...(input.suggest === undefined ? {} : { suggest: input.suggest }),
    ...(input.precedents === undefined ? {} : { precedents: input.precedents }),
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    ...(input.refusalFeedback === undefined ? {} : { refusalFeedback: input.refusalFeedback }),
    ...(input.offeredDoors === undefined ? {} : { offeredDoors: input.offeredDoors }),
    ...(input.lessonDoor === undefined ? {} : { lessonDoor: input.lessonDoor }),
    repetitions: input.repetitions,
    ...(input.dispositions === undefined ? {} : { dispositions: input.dispositions }),
    stoppedEarly: input.stoppedEarly,
    runs: input.runs,
    map: coverageMap(input.runs),
    ...(input.robustness === undefined ? {} : { robustness: robustnessSummary(input.robustness) }),
    ...(input.raw === undefined ? {} : { raw: { runs: input.raw, tax: governanceTax(input.runs, input.raw), structuredOutput: false as const } }),
  };
}

// --- rendering a filed artifact ---------------------------------------------

/** The filed run as a Markdown page: provenance first, then the map it filed.
 * A function of the artifact alone — same bytes in, same page out. */
export function renderCoverageArtifact(artifact: CoverageArtifact): string {
  const { world } = artifact;
  const scope =
    artifact.dispositions === undefined
      ? "the whole bank was eligible"
      : `restricted to disposition(s): ${artifact.dispositions.join(", ")}`;

  const header = [
    "# Playability coverage — filed run",
    "",
    "<!-- Generated from a coverage artifact; do not hand-edit. Regenerate with `npm run coverage:map`. -->",
    "",
    `Generated from a **${artifact.label}** run started \`${artifact.startedAt}\` on \`${artifact.model.slug}\`, ` +
      `${artifact.retrieval ? "**grounded by retrieval** (only the facts each question needs)" : artifact.grounded ? "**grounded** (the whole certified registry)" : "ungrounded (the proposer answered from its own knowledge)"}${artifact.gatedGrammar ? ", **gated grammar** (the schema narrowed to each question's nominated kinds)" : ""}${artifact.repair ? ", **repair** (strip-assertion resubmit on fact-mismatch denials)" : ""}${artifact.profile === true ? ", **profile** (scope set on the panel before the opener)" : ""}${artifact.feedback === true ? ", **feedback** (a named denial carried back to the model once)" : ""}${artifact.clarify === true ? ", **clarify** (the model may ask its own question)" : ""}${artifact.suggest === true ? ", **suggest** (the model may offer follow-ups)" : ""}${artifact.precedents === undefined ? "" : `, **precedents: ${artifact.precedents.mode}** (${artifact.precedents.mode === "fixed" ? "the same few accepted exchanges shown on every call" : `the nearest accepted exchanges shown as examples, k=${artifact.precedents.k}, threshold ${artifact.precedents.threshold}`}; store \`${artifact.precedents.digest}\`)`}${artifact.prompt === undefined ? "" : `, **prompt: ${artifact.prompt}** (${artifact.prompt === "blocks" ? "the fixed block sequence — task and shape first, context only when present, each rule once" : "the prompt as it accreted"})`}${artifact.refusalFeedback === true ? ", **refusal fed back** (a refused nomination carried back to the model by name)" : ""}${artifact.offeredDoors === true ? ", **offered door** (the listing route in the grammar only where the driver would accept it)" : ""}${artifact.lessonDoor === true ? ", **lesson door** (the explanation route carrying only the lessons the ask is about, plus the boundary)" : ""}${artifact.raw === undefined ? "" : ", **raw** (the same model ungoverned beside it, for the governance tax)"}, ` +
      `${artifact.repetitions} repetition(s)${artifact.stoppedEarly ? " — **stopped early** on an enforcement escalation; the runs below are fewer than requested" : ""}; ${scope}.`,
    "",
    "## Provenance",
    "",
    `Bank \`${artifact.bankId}\`, measured against snapshot \`${world.snapshotId}\` (\`${world.snapshotDigest}\`), ` +
      `derived from upstream commit \`${world.sourceCommit}\`, under Accord pack \`${world.packId}\`. ` +
      "A result against an unnamed world is not a result.",
    "",
  ];

  const body =
    artifact.robustness === undefined
      ? renderCoverage(artifact.map, `Coverage map — ${artifact.model.slug}`)
      : renderRobustness(artifact.robustness, `Phrasing robustness — ${artifact.model.slug}`);
  const tax = artifact.raw === undefined ? "" : `\n${renderTax(artifact.raw.tax)}`;

  return `${header.join("\n")}${body}${tax}`;
}

/**
 * The newest coverage artifact in a directory, by filename — and only a
 * coverage one: `runs/` also holds the live harness's artifacts, and rendering
 * one of those here would be a shape error presented as a result.
 */
export function latestCoverageArtifact(directory: string, readDir: (directory: string) => readonly string[]): string | undefined {
  const files = readDir(directory)
    .filter((name) => name.endsWith("-coverage.json") || name.endsWith("-coverage-robustness.json"))
    .sort();
  const newest = files.at(-1);
  return newest === undefined ? undefined : join(directory, newest);
}
