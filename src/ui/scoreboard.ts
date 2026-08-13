/**
 * The scoreboard: the epic's thesis, read straight off the filed record.
 *
 * "Enforcement is structural, usefulness is empirical" is a claim about models
 * plural — the same kernel over a strong, a weak and an adversarial model must
 * show the same zeros while usefulness is allowed to differ. This projection
 * lays the filed per-model metrics side by side so that comparison is the
 * thing on screen, and it computes nothing the record does not already state:
 *
 *  - Usefulness, health and cost are filed per model; they are joined here,
 *    never re-derived from the runs.
 *  - Enforcement is filed for the corpus as a whole. When a total is zero,
 *    every model's share is zero — that is arithmetic, not recomputation, and
 *    it is the only case in which this projection states a per-model zero. A
 *    non-zero total is shown broken at the corpus level and attributed to no
 *    one, because the record does not say whose it was.
 *  - Denials are attributed per model exactly as the record attributes them
 *    (`blockedByProvider`), which is what keeps an adversarial leg honest: an
 *    adversary that never made the gate fire proved nothing, and its row says
 *    so rather than borrowing another model's denial.
 *
 * The raw board below is the other side of the A/B: the same models with the
 * kernel removed, read from the filed raw-arm metrics. Its rows are joined the
 * same way — per-model figures as filed, corpus totals as sums of filed
 * figures, nothing re-judged from the runs. A record without a raw arm
 * projects to no board at all: absence means the arm did not run, never that
 * it ran clean.
 */

import type { HarnessArtifact } from "../harness/artifact.js";
import type { ModelRole } from "../harness/corpus.js";
import type { RawModelMetrics } from "../harness/raw.js";

/** One denial code and how often this model provoked it. */
export interface DenialTally {
  code: string;
  count: number;
}

/** One model's column on the scoreboard, joined from the filed metrics. */
export interface ScoreboardRow {
  providerId: string;
  role: ModelRole;
  /** The OpenRouter slug on a live run; the id is the identity otherwise. */
  slug?: string;
  runs: number;
  resolved: number;
  resolutionRate: number;
  abstentionRate: number;
  avgTurnsToAnswer: number;
  answered: number;
  acted: number;
  denied: number;
  unresolved: number;
  /** Denials this model provoked, tallied by code, most frequent first. */
  denials: readonly DenialTally[];
  /** An adversarial model the gate was never seen refusing. The corpus-level
   * verdict already fails such a run; a row wearing the flag keeps a filed
   * failure legible instead of reading as a very safe model. */
  vacuousAdversary: boolean;
  providerErrors: number;
  /** Every run hit an infrastructure failure — this column measured nothing. */
  allFailed: boolean;
  cost?: ScoreboardCost;
}

export interface ScoreboardCost {
  usd: number;
  /** True when some calls came back unpriced, so the figure is a floor. */
  floor: boolean;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ScoreboardView {
  /**
   * True when all three enforcement totals are zero. Only then does the board
   * state the thesis — each model's share of a zero total is exactly zero —
   * and a false here is worn by every row as "not attributable".
   */
  identical: boolean;
  rows: readonly ScoreboardRow[];
}

function toTallies(counts: Readonly<Record<string, number>>): readonly DenialTally[] {
  return Object.entries(counts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function tally(codes: readonly string[]): readonly DenialTally[] {
  const counts: Record<string, number> = {};
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1;
  return toTallies(counts);
}

export function scoreboard(artifact: HarnessArtifact): ScoreboardView {
  const { enforcement, usefulness, health, cost } = artifact.metrics;
  // The `?? 0` guards keep an artifact filed before the act path renderable,
  // exactly as the Markdown results page does.
  const identical =
    enforcement.committedViolations === 0 &&
    enforcement.committedWrongScope === 0 &&
    (enforcement.committedUnauthorizedActions ?? 0) === 0;
  const blocked = enforcement.blockedByProvider ?? {};

  const rows = artifact.models.map((model): ScoreboardRow => {
    const use = usefulness.find((entry) => entry.providerId === model.id);
    const wellness = health.find((entry) => entry.providerId === model.id);
    const spend = cost.find((entry) => entry.providerId === model.id);
    const denials = tally(blocked[model.id] ?? []);
    return {
      providerId: model.id,
      role: model.role,
      ...(model.slug === undefined ? {} : { slug: model.slug }),
      runs: use?.runs ?? 0,
      resolved: use?.resolved ?? use?.answered ?? 0,
      resolutionRate: use?.resolutionRate ?? 0,
      abstentionRate: use?.abstentionRate ?? 0,
      avgTurnsToAnswer: use?.avgTurnsToAnswer ?? 0,
      answered: use?.answered ?? 0,
      acted: use?.acted ?? 0,
      denied: use?.denied ?? 0,
      unresolved: use?.unresolved ?? 0,
      denials,
      vacuousAdversary: model.role === "adversarial" && denials.length === 0,
      providerErrors: wellness?.providerErrors ?? 0,
      allFailed: wellness?.allFailed ?? false,
      ...(spend === undefined
        ? {}
        : {
            cost: {
              usd: spend.usage.costUsd,
              floor: !spend.fullyPriced,
              calls: spend.usage.calls,
              promptTokens: spend.usage.promptTokens,
              completionTokens: spend.usage.completionTokens,
            },
          }),
    };
  });

  return { identical, rows };
}

/** One model's raw-arm column: what it published without the kernel, as the
 * meter filed it. */
export interface RawScoreboardRow {
  providerId: string;
  role: ModelRole;
  slug?: string;
  runs: number;
  committed: number;
  unusable: number;
  providerErrors: number;
  /** Committed answers carrying at least one false assertion. */
  violatedRuns: number;
  /** Committed answers carrying none — raw can be right; nothing makes it so. */
  cleanRuns: number;
  assertionViolations: number;
  /** The meter's findings against this model's published claims, by code. */
  findings: readonly DenialTally[];
  omittedDisclosures: number;
  actsExecuted: number;
  unaskedActs: number;
  wrongScopeClaims: number;
  /** Nothing this model said ever became a publication — the column holds no
   * measurement, which is different from holding a clean one. */
  publishedNothing: boolean;
  cost?: ScoreboardCost;
}

/** Corpus totals for the raw arm — sums of the filed per-model figures, the
 * counterpart of "a zero total is a zero for each model" run in reverse. */
export interface RawScoreboardTotals {
  committed: number;
  assertionViolations: number;
  wrongScopeClaims: number;
  actsExecuted: number;
  unaskedActs: number;
  omittedDisclosures: number;
}

export interface RawScoreboardView {
  rows: readonly RawScoreboardRow[];
  totals: RawScoreboardTotals;
}

function rawRow(model: HarnessArtifact["models"][number], filed: RawModelMetrics | undefined): RawScoreboardRow {
  const usage = filed?.usage;
  return {
    providerId: model.id,
    role: model.role,
    ...(model.slug === undefined ? {} : { slug: model.slug }),
    runs: filed?.runs ?? 0,
    committed: filed?.committed ?? 0,
    unusable: filed?.unusable ?? 0,
    providerErrors: filed?.providerErrors ?? 0,
    violatedRuns: filed?.violatedRuns ?? 0,
    cleanRuns: filed?.cleanRuns ?? 0,
    assertionViolations: filed?.assertionViolations ?? 0,
    findings: toTallies(filed?.byCode ?? {}),
    omittedDisclosures: filed?.omittedDisclosures ?? 0,
    actsExecuted: filed?.actsExecuted ?? 0,
    unaskedActs: filed?.unaskedActs ?? 0,
    wrongScopeClaims: filed?.wrongScopeClaims ?? 0,
    publishedNothing: (filed?.committed ?? 0) === 0,
    ...(usage === undefined
      ? {}
      : {
          cost: {
            usd: usage.costUsd,
            floor: usage.costedCalls !== usage.calls,
            calls: usage.calls,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
          },
        }),
  };
}

/**
 * The raw side of the A/B, or nothing: a record filed before the control arm
 * existed — or a run where the arm was off — projects to `undefined`, and the
 * page shows no raw leg rather than a clean-looking empty one.
 */
export function rawScoreboard(artifact: HarnessArtifact): RawScoreboardView | undefined {
  const raw = artifact.raw;
  if (raw === undefined) return undefined;

  const rows = artifact.models.map((model) =>
    rawRow(
      model,
      raw.metrics.find((entry) => entry.providerId === model.id),
    ),
  );
  const totals = rows.reduce<RawScoreboardTotals>(
    (sum, row) => ({
      committed: sum.committed + row.committed,
      assertionViolations: sum.assertionViolations + row.assertionViolations,
      wrongScopeClaims: sum.wrongScopeClaims + row.wrongScopeClaims,
      actsExecuted: sum.actsExecuted + row.actsExecuted,
      unaskedActs: sum.unaskedActs + row.unaskedActs,
      omittedDisclosures: sum.omittedDisclosures + row.omittedDisclosures,
    }),
    { committed: 0, assertionViolations: 0, wrongScopeClaims: 0, actsExecuted: 0, unaskedActs: 0, omittedDisclosures: 0 },
  );

  return { rows, totals };
}
