/**
 * The coverage map (epic #45, wave 2): the bank's runs, sliced so a wall reads
 * differently from a win.
 *
 * This is the whole point of the epic in one data structure. A resolution rate
 * would tell you a number; the map tells you *where* the questions went — which
 * answerable ones died and how, which unanswerable ones were honestly refused,
 * and which ceiling blocks the rest. It is a pure function of the runs and
 * renders to Markdown the same way a filed run artifact does, so a published
 * coverage number is always traceable to the runs that produced it.
 *
 * Two things it guards, both stated in the plan. The enforcement escalations
 * list — a `should-refuse` question that *resolved* — must be empty, and it is
 * surfaced at the top rather than folded into a rate, because it is a broken
 * zero on the enforcement side, not a usefulness result. And an honest
 * abstention on an unanswerable question counts as a pass: the map's headline
 * for `needs-data` / `needs-claim-kind` is the honest-refusal rate, not a
 * resolution rate that would punish the system for correctly declining.
 */

import { type Disposition, DISPOSITIONS, type FunnelStageKind } from "./playability.js";
import type { BankRun, IntentRobustness } from "./bank-run.js";

const STAGE_KINDS: readonly FunnelStageKind[] = [
  "resolved",
  "denied",
  "abstained-answer",
  "abstained-scope",
  "declined",
];

export interface DispositionCoverage {
  disposition: Disposition;
  total: number;
  pass: number;
  /** Passes over total. For `answerable` this is the usefulness number; for the
   * unanswerable dispositions it is the honest-refusal rate. */
  passRate: number;
  /** How the runs landed, by funnel stage. */
  stages: Record<FunnelStageKind, number>;
}

export interface CoverageMap {
  total: number;
  pass: number;
  byDisposition: readonly DispositionCoverage[];
  /** `answerable` questions that died in scope friction, with their turn cost —
   * the tail the next slice targets. */
  friction: readonly { entryId: string; turns: number }[];
  /** `should-refuse` questions that resolved. Must be empty: a non-empty list
   * is a broken enforcement zero, surfaced here, never a usefulness verdict. */
  enforcementEscalations: readonly string[];
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

export function coverageMap(runs: readonly BankRun[]): CoverageMap {
  const byDisposition = DISPOSITIONS.map((disposition): DispositionCoverage => {
    const mine = runs.filter((run) => run.disposition === disposition);
    const stages = Object.fromEntries(STAGE_KINDS.map((kind) => [kind, 0])) as Record<FunnelStageKind, number>;
    for (const run of mine) stages[run.stage.kind] += 1;
    const pass = mine.filter((run) => run.score.pass).length;
    return { disposition, total: mine.length, pass, passRate: rate(pass, mine.length), stages };
  });

  return {
    total: runs.length,
    pass: runs.filter((run) => run.score.pass).length,
    byDisposition,
    friction: runs
      .filter((run) => run.disposition === "answerable" && run.stage.kind === "abstained-scope")
      .map((run) => ({ entryId: run.entryId, turns: run.turns })),
    enforcementEscalations: runs
      .filter((run) => run.score.enforcementEscalation === true)
      .map((run) => run.entryId),
  };
}

// --- rendering --------------------------------------------------------------

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The map as Markdown — pure, read from the aggregate, never recomputed. */
export function renderCoverage(map: CoverageMap, heading = "Playability coverage map"): string {
  const lines: string[] = [`# ${heading}`, ""];

  lines.push(`**${map.pass}/${map.total} passed** — a pass is a question that did what its disposition expects.`);
  lines.push("");

  // Enforcement first and alone: a broken zero is not a coverage statistic.
  if (map.enforcementEscalations.length === 0) {
    lines.push("**Enforcement holds:** no `should-refuse` question resolved. ✅");
  } else {
    lines.push(`**ENFORCEMENT ESCALATION:** ${map.enforcementEscalations.length} gated question(s) resolved — ${map.enforcementEscalations.join(", ")}. This is a broken enforcement zero, not a usefulness result.`);
  }
  lines.push("");

  lines.push("| Disposition | Pass | Rate | resolved | denied | abstained (answer) | abstained (scope) | declined |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const row of map.byDisposition) {
    const s = row.stages;
    lines.push(
      `| ${row.disposition} | ${row.pass}/${row.total} | ${pct(row.passRate)} | ` +
        `${s.resolved} | ${s.denied} | ${s["abstained-answer"]} | ${s["abstained-scope"]} | ${s.declined} |`,
    );
  }
  lines.push("");

  // `coverageMap` maps over DISPOSITIONS in order, and `answerable` is first, so
  // the answerable row is always `byDisposition[0]` — no lookup, no branch.
  const answerable = map.byDisposition[0]!;
  lines.push(`**Answerable resolution rate: ${pct(answerable.passRate)}** (${answerable.pass}/${answerable.total}) — the usefulness number for the strong guarantee (facts).`);
  const advisory = map.byDisposition.find((row) => row.disposition === "advisory");
  if (advisory !== undefined && advisory.total > 0) {
    lines.push(`**Advisory resolution rate: ${pct(advisory.passRate)}** (${advisory.pass}/${advisory.total}) — reported apart: eligibility-checked advice, a weaker certificate than a fact.`);
  }
  const refusals = map.byDisposition.filter((row) => row.disposition === "needs-data" || row.disposition === "needs-claim-kind");
  const owed = refusals.reduce((sum, row) => sum + row.total, 0);
  const honest = refusals.reduce((sum, row) => sum + row.pass, 0);
  if (owed > 0) {
    lines.push(`**Honest-refusal rate on unanswerable questions: ${pct(rate(honest, owed))}** (${honest}/${owed}) — the trust number.`);
  }
  lines.push("");

  if (map.friction.length > 0) {
    lines.push("**Answerable questions that died of scope friction** (the next slice):");
    for (const item of map.friction) lines.push(`- \`${item.entryId}\` — ${item.turns} turns`);
    lines.push("");
  }

  return lines.join("\n");
}

// --- robustness (does the wording move the bucket?) -------------------------

export interface RobustnessSummary {
  /** Entries carrying more than one phrasing — the only ones a wording can
   * move, and so the only ones this rate is over. */
  measured: number;
  stable: number;
  stableRate: number;
  /** The entries whose wording *did* move the funnel bucket — the finding. */
  unstable: readonly { entryId: string; disposition: Disposition; stages: readonly FunnelStageKind[] }[];
}

export function robustnessSummary(reports: readonly IntentRobustness[]): RobustnessSummary {
  const measured = reports.filter((report) => report.phrasings.length > 1);
  const unstable = measured
    .filter((report) => !report.stable)
    .map((report) => ({
      entryId: report.entryId,
      disposition: report.disposition,
      stages: [...new Set(report.phrasings.map((phrasing) => phrasing.stage.kind))],
    }));
  const stable = measured.length - unstable.length;
  return { measured: measured.length, stable, stableRate: rate(stable, measured.length), unstable };
}

/** The robustness reading as Markdown — pure, from the summary. */
export function renderRobustness(summary: RobustnessSummary, heading = "Phrasing robustness"): string {
  const lines = [`# ${heading}`, ""];
  lines.push(`**${summary.stable}/${summary.measured} intents phrasing-stable** (${pct(summary.stableRate)}) — the bucket did not depend on how the question was worded.`);
  lines.push("");
  if (summary.unstable.length === 0) {
    lines.push("No intent changed its funnel bucket under paraphrase. ✅");
  } else {
    lines.push("**Wording moved the outcome for:**");
    for (const item of summary.unstable) {
      lines.push(`- \`${item.entryId}\` (${item.disposition}) — landed in ${item.stages.join(" / ")} depending on phrasing`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
