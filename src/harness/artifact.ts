/**
 * The filed record of a run — the thing a billable harness actually produces.
 *
 * A live run costs money and cannot be reproduced by re-running it: the model
 * is nondeterministic, and the slug behind it will be retired eventually. So
 * the artifact is written to be read years later and checked by someone who
 * does not trust it:
 *
 *  - **Whole runs, not summaries.** Each entry carries its transcript and, when
 *    one was reached, the transaction — which is exactly what `replayTransaction`
 *    re-executes (IA-10). A summary would be a press release; this is a record.
 *  - **Provenance travels with it.** The snapshot id and content digest and the
 *    pack id, so a published number names the certified world it was measured
 *    in. A result against an unnamed snapshot is not a result.
 *  - **Models by slug, not by nickname.** "the weak model" is not a finding;
 *    the slug is, and it is what the results page will quote.
 *  - **No secret, ever.** Nothing here is derived from the key, and a test
 *    asserts the serialised bytes cannot contain one.
 *
 * The clock is the caller's, not this module's: pure code stays pure, and the
 * one place that reads a clock is the CLI that also spends the money.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ModelRole } from "./corpus.js";
import type { Metrics } from "./metrics.js";
import type { RawModelMetrics, RawRun } from "./raw.js";
import type { HarnessReport } from "./report.js";
import type { HarnessRun, HarnessWorld } from "./run.js";

export const ARTIFACT_SCHEMA_VERSION = 1;

export interface ArtifactModel {
  id: string;
  role: ModelRole;
  /** The OpenRouter slug on a live run; absent for a scripted stand-in. */
  slug?: string;
}

export interface ArtifactWorld {
  snapshotId: string;
  /** The snapshot's content digest, and the upstream commit it was derived
   * from: together they say exactly which certified facts these numbers were
   * measured against, and both are checkable years later. */
  snapshotDigest: string;
  sourceCommit: string;
  packId: string;
}

export interface HarnessArtifact {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  /** "scripted" or "live" — which kind of run this was, stated rather than
   * inferred from whether the model ids happen to look live. */
  label: string;
  /**
   * When the run started, by the wall clock.
   *
   * Deliberately the only real timestamp in the file: the grants and
   * transactions below carry the harness's *fixed* clock, so that a record
   * replays to the same digests whenever it is re-executed (IA-10). One is
   * when this happened; the others are what it happened at.
   */
  startedAt: string;
  world: ArtifactWorld;
  repetitions: number;
  /**
   * Whether the answer's grammar was enforced at decode time.
   *
   * Recorded because it changes what the usefulness number means: a model that
   * cannot emit malformed JSON is being measured on a different task from one
   * that can. Enforcement is unaffected either way — the grammar constrains
   * shape, and every value still faces the same verification — but a page that
   * did not say which run it was would be comparing two things as though they
   * were one.
   */
  structuredOutput: boolean;
  /** Whether the proposer was handed the certified registry to compose from.
   * Recorded for the same reason as {@link structuredOutput}: it changes what
   * the usefulness number measures — composing from provided facts versus
   * recalling them — while leaving enforcement untouched. */
  grounded: boolean;
  /** True when the run stopped before its last repetition; the corpus below is
   * then smaller than the one requested, and says so. */
  stoppedEarly: boolean;
  scenarios: readonly { id: string; title: string }[];
  models: readonly ArtifactModel[];
  runs: readonly HarnessRun[];
  metrics: Metrics;
  /**
   * The control arm, when the run carried one: the same models ungoverned,
   * their answers published as-is and metered afterwards. Additive and
   * optional — an artifact filed before the arm existed reads unchanged, and
   * its absence means the arm did not run, never that it ran clean.
   */
  raw?: { runs: readonly RawRun[]; metrics: readonly RawModelMetrics[] };
  verdict: { ok: boolean; failures: readonly string[] };
}

export interface ArtifactInput {
  label: string;
  startedAt: string;
  world: HarnessWorld;
  /** Defaults false: a scripted run has no endpoint to constrain. */
  structured?: boolean;
  /** Defaults false: a scripted run answers from its script, not a reference. */
  grounded?: boolean;
}

export function buildArtifact(report: HarnessReport, input: ArtifactInput): HarnessArtifact {
  const { document, snapshot } = input.world.registry;
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    label: input.label,
    startedAt: input.startedAt,
    world: {
      snapshotId: snapshot.id,
      snapshotDigest: document.contentDigest,
      sourceCommit: snapshot.sourceCommit,
      packId: input.world.pack.id,
    },
    repetitions: report.repetitions,
    structuredOutput: input.structured ?? false,
    grounded: input.grounded ?? false,
    stoppedEarly: report.stoppedEarly,
    scenarios: report.scenarios.map((scenario) => ({ id: scenario.id, title: scenario.title })),
    models: report.models.map((model) => ({
      id: model.provider.id,
      role: model.role,
      ...(model.slug === undefined ? {} : { slug: model.slug }),
    })),
    runs: report.runs,
    metrics: report.metrics,
    ...(report.rawRuns === undefined || report.rawMetrics === undefined
      ? {}
      : { raw: { runs: report.rawRuns, metrics: report.rawMetrics } }),
    verdict: { ok: report.failures.length === 0, failures: report.failures },
  };
}

/** The addressing every filed artifact shares — when the run started and what
 * kind of run it was — which together name the file. The coverage artifact
 * (coverage-artifact.ts) files through the same helpers under a different
 * label, so every record in `runs/` sorts and reads the same way. */
export interface ArtifactAddress {
  startedAt: string;
  label: string;
}

/** A filename that sorts chronologically and survives a filesystem: the
 * timestamp with its punctuation flattened, then the label. */
export function artifactFilename(artifact: ArtifactAddress): string {
  return `${artifact.startedAt.replace(/[:.]/g, "-")}-${artifact.label}.json`;
}

export type WriteFile = (path: string, contents: string) => void;

const writeToDisk: WriteFile = (path, contents) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
};

/** File the artifact and return where it went. Pretty-printed: it is meant to
 * be read and diffed, and it is small next to what it cost to produce. */
export function fileArtifact<T extends ArtifactAddress>(artifact: T, directory: string, write: WriteFile = writeToDisk): string {
  const path = join(directory, artifactFilename(artifact));
  write(path, `${JSON.stringify(artifact, null, 2)}\n`);
  return path;
}
