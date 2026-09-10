/**
 * The governance tax: the governed leg beside the raw arm, per disposition
 * (docs/generalization.md §11, "The north stars").
 *
 * The usefulness north star is a ratio, not a count: what the kernel costs in
 * answers, measured against the same model ungoverned on the same questions.
 * This module computes that from two sets of runs over the same entries and
 * renders it as one table, every cell a count and a percentage together
 * (CLAUDE.md, model doctrine). It never blends the two arms: the governed
 * side's pass is the coverage map's pass; the raw side's two readings are the
 * raw arm's own, and its enforcement-side counts are a separate block that no
 * governed number touches.
 *
 * With repetitions, the honest headline is the stable core on each side —
 * entries that passed in every pass — because a topline pooled over samples
 * moves inside the band on dice alone (findings §22).
 */

import type { BankRun } from "./bank-run.js";
import { type RawBankRun, rawUsage } from "./bank-raw.js";
import { type Disposition, DISPOSITIONS } from "./playability.js";
import type { Usage } from "./provider.js";

/** One side's reading over a set of entries. */
export interface ArmCount {
  /** Samples that passed, over every repetition. */
  pass: number;
  samples: number;
  /** Entries that passed in every repetition they ran in — the floor. Equal
   * to `pass` at N=1. */
  stable: number;
}

export interface TaxRow {
  disposition: Disposition;
  /** Distinct entries both arms ran *and* the raw grammar can express — the
   * comparison's denominator. */
  entries: number;
  /** Entries both arms ran that the raw grammar cannot express (lessons,
   * game-rule constants), left out of every count in this row, with the
   * governed side's stable passes on them — so the reader sees what the
   * comparison does not cover, and what governed did there. */
  inexpressible: { entries: number; governedStable: number };
  governed: ArmCount;
  rawApparent: ArmCount;
  rawVerified: ArmCount;
  /** Verified with text-valued facts in the model's own words excused (see
   * `RawBankRun.verifiedExcusingText`) — beside `rawVerified`, never instead. */
  rawVerifiedExcusingText: ArmCount;
  /** Raw samples that published gated advice — the trust miss, by count. */
  gatedPublished: number;
}

export interface RawArmLedger {
  runs: number;
  published: number;
  /** Malformed replies: nothing usable came back. */
  unusable: number;
  providerErrors: number;
  /** Published answers carrying at least one false assertion. */
  violatedRuns: number;
  assertionViolations: number;
  wrongScopeClaims: number;
  /** Of the false assertions, verbatim mismatches on text-valued facts. */
  textMismatches: number;
  /** Denial codes across the published answers, tallied. */
  byCode: Readonly<Record<string, number>>;
  omittedDisclosures: number;
  gatedPublished: number;
  actsExecuted: number;
  usage: Usage;
}

export interface GovernanceTax {
  /** Repetitions present in the runs (the larger of the two arms'). */
  repetitions: number;
  rows: readonly TaxRow[];
  raw: RawArmLedger;
}

function stableOf(ids: readonly string[], passes: ReadonlyMap<string, readonly boolean[]>): number {
  return ids.filter((id) => {
    const outcomes = passes.get(id) ?? [];
    return outcomes.length > 0 && outcomes.every(Boolean);
  }).length;
}

function armCount(ids: readonly string[], samples: readonly { entryId: string; pass: boolean }[]): ArmCount {
  const byEntry = new Map<string, boolean[]>();
  for (const sample of samples) byEntry.set(sample.entryId, [...(byEntry.get(sample.entryId) ?? []), sample.pass]);
  return {
    pass: samples.filter((sample) => sample.pass).length,
    samples: samples.length,
    stable: stableOf(ids, byEntry),
  };
}

/** The tax over the entries *both* arms ran; an entry one arm skipped is no
 * comparison and is left out of every row. */
export function governanceTax(governed: readonly BankRun[], raw: readonly RawBankRun[]): GovernanceTax {
  const governedIds = new Set(governed.map((run) => run.entryId));
  const shared = new Set(raw.map((run) => run.entryId).filter((id) => governedIds.has(id)));
  // Expressibility is a property of the entry; every raw run of it agrees.
  const expressible = new Set(raw.filter((run) => run.expressible !== false).map((run) => run.entryId));
  const rows = DISPOSITIONS.flatMap((disposition): TaxRow[] => {
    const all = [...new Set(governed.filter((run) => run.disposition === disposition && shared.has(run.entryId)).map((run) => run.entryId))];
    if (all.length === 0) return [];
    const ids = all.filter((id) => expressible.has(id));
    const left = all.filter((id) => !expressible.has(id));
    const governedSamplesAll = governed.filter((run) => run.disposition === disposition && shared.has(run.entryId)).map((run) => ({ entryId: run.entryId, pass: run.score.pass }));
    const mine = new Set(ids);
    const governedSamples = governedSamplesAll.filter((sample) => mine.has(sample.entryId));
    const rawSamples = raw.filter((run) => mine.has(run.entryId));
    return [
      {
        disposition,
        entries: ids.length,
        inexpressible: { entries: left.length, governedStable: armCount(left, governedSamplesAll.filter((sample) => !mine.has(sample.entryId))).stable },
        governed: armCount(ids, governedSamples),
        rawApparent: armCount(ids, rawSamples.map((run) => ({ entryId: run.entryId, pass: run.apparent }))),
        rawVerified: armCount(ids, rawSamples.map((run) => ({ entryId: run.entryId, pass: run.verified }))),
        rawVerifiedExcusingText: armCount(ids, rawSamples.map((run) => ({ entryId: run.entryId, pass: run.verifiedExcusingText }))),
        gatedPublished: rawSamples.filter((run) => run.gatedPublished).length,
      },
    ];
  });
  const repetitions = Math.max(
    new Set(governed.map((run) => run.repetition)).size,
    new Set(raw.map((run) => run.repetition)).size,
  );
  const published = raw.filter((run) => run.published);
  const byCode: Record<string, number> = {};
  for (const run of published) for (const code of run.violations) byCode[code] = (byCode[code] ?? 0) + 1;
  return {
    repetitions,
    rows,
    raw: {
      runs: raw.length,
      published: published.length,
      unusable: raw.filter((run) => !run.published && run.providerErrors === 0).length,
      providerErrors: raw.reduce((sum, run) => sum + run.providerErrors, 0),
      violatedRuns: published.filter((run) => run.assertionViolations > 0).length,
      assertionViolations: published.reduce((sum, run) => sum + run.assertionViolations, 0),
      wrongScopeClaims: published.reduce((sum, run) => sum + run.wrongScopeClaims, 0),
      textMismatches: published.reduce((sum, run) => sum + run.textMismatches, 0),
      byCode,
      omittedDisclosures: published.reduce((sum, run) => sum + run.omittedDisclosures, 0),
      gatedPublished: published.filter((run) => run.gatedPublished).length,
      actsExecuted: published.reduce((sum, run) => sum + run.actsExecuted, 0),
      usage: rawUsage(raw),
    },
  };
}

/** `n/d (p%)` — a count and its percentage together, never either alone. */
export function fraction(part: number, whole: number): string {
  if (whole === 0) return `${part}/0`;
  return `${part}/${whole} (${Math.round((part / whole) * 100)}%)`;
}

/** The Markdown section — pure, a function of the tax alone. */
export function renderTax(tax: GovernanceTax): string {
  const lines: string[] = ["## The governance tax — the same model, ungoverned, beside it", ""];
  const stable = tax.repetitions > 1;
  const count = (arm: ArmCount, entries: number): string => (stable ? fraction(arm.stable, entries) : fraction(arm.pass, arm.samples));

  lines.push(
    "The raw arm asks each question once with no kernel: the reply is published as it came, then metered by the same verifier the governed leg is gated with. " +
      "**Apparent** is the bank's oracle reading the published reply as an answer to *this* question, true or not — what a chatbot user perceives. " +
      "**Verified** is apparent with nothing false in it — the comparator, since every governed resolution is certified-true. " +
      "On the dispositions that must not resolve, both readings are the one honesty check: nothing the disposition forbids was published. " +
      "The raw arm runs under a plain persona told nothing about verification, with the claim grammar asked for in the prompt and never enforced at decode, so its answers are what an untimid chatbot gives; its harm counts below are therefore a measurement, not the floor the scenario corpus's control arm reports." +
      (stable ? ` With N=${tax.repetitions}, every cell is the stable core — entries that passed in every repetition.` : ""),
  );
  lines.push("");

  const answerable = tax.rows.find((row) => row.disposition === "answerable");
  if (answerable !== undefined) {
    lines.push(
      `**Answerable, on the ${answerable.entries} entries the raw grammar can express — governed ${count(answerable.governed, answerable.entries)} · raw, verified ${count(answerable.rawVerified, answerable.entries)} · raw, verified excusing text facts ${count(answerable.rawVerifiedExcusingText, answerable.entries)} · raw, apparent ${count(answerable.rawApparent, answerable.entries)}.** ` +
        "The tax in believed answers is the first number against the fourth; what those believed answers were worth is the fourth against the second and third. The third excuses a text-valued fact in the model's own words (a correct paraphrase the certificate could not show)." +
        (answerable.inexpressible.entries === 0
          ? ""
          : ` ${answerable.inexpressible.entries} answerable entries expect a lesson or a game-rule constant, which the raw grammar cannot express (a chatbot would teach in prose no meter here can judge); they are left out of the comparison, and governed passed ${count({ pass: answerable.inexpressible.governedStable, samples: answerable.inexpressible.entries, stable: answerable.inexpressible.governedStable }, answerable.inexpressible.entries)} of them stably.`),
    );
    lines.push("");
  }

  lines.push(`| Disposition | entries compared | governed pass | raw apparent | raw verified | raw verified, text excused | raw gated advice published | left out (raw grammar cannot express) |`);
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const row of tax.rows) {
    const left = row.inexpressible.entries === 0 ? "—" : `${row.inexpressible.entries} (governed ${row.inexpressible.governedStable} stably)`;
    lines.push(
      `| ${row.disposition} | ${row.entries} | ${count(row.governed, row.entries)} | ${count(row.rawApparent, row.entries)} | ${count(row.rawVerified, row.entries)} | ${count(row.rawVerifiedExcusingText, row.entries)} | ${row.gatedPublished} | ${left} |`,
    );
  }
  lines.push("");

  const r = tax.raw;
  lines.push(
    `**Raw arm, enforcement side (the arm's own line, never inside the governed zero):** ${fraction(r.violatedRuns, r.published)} published answers carried a false assertion (${r.assertionViolations} in all); ` +
      `${r.textMismatches} of those were text facts in the model's own words; ${r.wrongScopeClaims} answered a swapped question; gated advice published ${r.gatedPublished} time(s); ${r.actsExecuted} act(s) executed ungated; ${r.omittedDisclosures} mandated disclosure(s) omitted. ` +
      `By article: ${Object.entries(r.byCode).sort(([, a], [, b]) => b - a).map(([code, n]) => `${code} ×${n}`).join(", ") || "none"}. ` +
      `${fraction(r.unusable, r.runs)} replies were unusable; ${r.providerErrors} provider error(s).`,
  );
  lines.push(`**Raw arm cost:** ${r.usage.calls} call(s), ${r.usage.promptTokens + r.usage.completionTokens} tokens, $${r.usage.costUsd.toFixed(4)} (provider-reported; a floor).`);
  lines.push("");
  return lines.join("\n");
}
