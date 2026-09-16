/**
 * The decline ledger — what the system answered when it should have declined,
 * and which layer owes the fix (epic #170, mostly K2).
 *
 * The correct-decline rate — how often the system correctly declines a
 * question it should not answer — is the lowest of the usefulness numbers on
 * both models, and a rate alone says nothing about what to build. This turns
 * the rate back into a list: every sample on a question that must not
 * resolve, what the record certified instead, and the layer whose change
 * would make that wrong answer unrepresentable.
 *
 * It is worth being exact about which slice this is, because the names are
 * close. K1's *demand* ledger is what was asked and **not answered** — the
 * honest abstentions, which are the signal a data steward acts on, since the
 * flywheel's organizing rule is that abstentions are the demand signal. This
 * module is the other half: the questions that should have been declined and
 * were **answered anyway**, each classified by the layer that owes the fix,
 * which is K2. A question this system correctly declined every time is in the
 * denominator here and is never listed as a row. Building the abstention side
 * is what would make a demand ledger out of it, and it is not built.
 *
 * Classification is deterministic and reads only the filed record — the
 * manifest's claim kinds and ids, the pack's records-boundary lesson, the
 * funnel stage. A miss the record cannot classify is `reviewer`, counted and
 * named rather than guessed at; K2's gate asks for that share explicitly.
 *
 * No model, no clock, no network — the same discipline replay and the funnel
 * keep. Every number here is read from a paid run that has already been filed.
 */

import type { Claim } from "../kernel/contracts.js";
import type { Disposition } from "./playability.js";
import type { RecordedBankRun } from "./bank-run.js";

/**
 * The dispositions whose questions must not receive a certified answer.
 *
 * `advisory` is deliberately absent. It sits in the same complement of
 * `answerable` that the correct-decline rate is reported over, but an advisory
 * question is *expected* to resolve — with eligibility-checked advice — so a
 * resolution there is a usefulness miss of a different kind, never a failure
 * to decline. Counting it here would let a shape deflection on "which starter
 * should I pick?" masquerade as a fabrication risk.
 */
export const MUST_NOT_RESOLVE: readonly Disposition[] = ["needs-data", "needs-claim-kind", "off-domain", "gated-advisory", "should-refuse"];

/**
 * What the record shows happened — the route the answer was built on.
 *
 * Named for the route rather than for a diagnosis, because the route is what
 * the manifest actually holds; the diagnosis is {@link MissLayer}, derived
 * from it. Keeping the two apart is what stops a dominant layer from erasing
 * the distinctions inside it: several of these classes share an owner and
 * need different fixes.
 */
export type MissRoute =
  /** A pack lesson on a subject the ask did not name, certified in place of a
   * decline. The lesson catalogue is an enum on every answer call, so a
   * topically adjacent lesson is representable on every ask. */
  | "topical-lesson"
  /** The records-boundary lesson, taught alone, on a question that was not
   * about the game at all. The scorer fails any resolution on an off-domain
   * ask; whether teaching the boundary there is a miss or the best available
   * answer is a judgement the record cannot make. */
  | "boundary-lesson-off-domain"
  /** An `eligibility` or `recommendation` claim on an ask that requested
   * neither. The advice routes are open on every call, like the lessons. */
  | "advice-route"
  /** A real, certified fact answered in place of one the world does not
   * hold — the neighbour that was retrieved instead. */
  | "neighbouring-fact"
  /** A closed roster or count built for a set the ask did not name. */
  | "substituted-set"
  /** An ask the pack gates, answered out of claims the pack does not gate. */
  | "gated-dodge"
  /** The manifest matches none of the above. */
  | "unclassified";

/**
 * The layer that owes the fix, from epic #170's taxonomy.
 *
 * The test for assigning one is "if this layer changed, would the wrong
 * answer stop being representable?" — not "which layer is nearest the
 * symptom".
 */
export type MissLayer =
  /** A route was in the answer grammar on an ask it could never correctly
   * serve. Withholding or narrowing it by the ask makes the wrong answer
   * unrepresentable — the treatment #118 S4a applied to the listing door. */
  | "grammar"
  /** The certified answer exists and a neighbouring row reached the model in
   * its place. The shortlist is what failed, not the grammar. */
  | "retrieval"
  /** The pack's gate should have decided the ask and the answer went around
   * it: a rule that exists but never fired. */
  | "policy"
  /** The record does not decide it. Counted and named, never guessed —
   * K2's gate asks for this share explicitly. */
  | "reviewer";

/** The owner of each route, and the change that would retire it. */
export const ROUTE_LAYER: Readonly<Record<MissRoute, { readonly layer: MissLayer; readonly why: string }>> = {
  "topical-lesson": {
    layer: "grammar",
    why: "a pack lesson on a subject the ask did not name; the lesson catalogue is in the grammar whole, so a topically adjacent lesson is representable on every ask",
  },
  "boundary-lesson-off-domain": {
    layer: "reviewer",
    why: "the records-boundary lesson, taught alone, on a question not about the game — a judgement about the oracle, not a defect the record decides",
  },
  "advice-route": {
    layer: "grammar",
    why: "an eligibility or recommendation claim on an ask that requested neither; the advice routes are open on every call",
  },
  "neighbouring-fact": {
    layer: "retrieval",
    why: "a neighbouring certified fact answered in place of the one asked for",
  },
  "substituted-set": {
    layer: "grammar",
    why: "a closed set built for a set the ask did not name; the roster route is open on every call",
  },
  "gated-dodge": {
    layer: "policy",
    why: "an ask the pack gates, answered out of claims the pack does not gate — the rule never fired",
  },
  unclassified: {
    layer: "reviewer",
    why: "the manifest matches no known route",
  },
};

/** What the record certified in place of a decline — ids only, no values. */
export interface CertifiedInstead {
  /** Distinct claim kinds, sorted, so the shape is comparable across samples. */
  readonly kinds: readonly string[];
  /** Pack lesson ids certified, sorted. */
  readonly lessonIds: readonly string[];
  /** `entityId/factId` pairs certified, sorted. */
  readonly factIds: readonly string[];
  /** How many closed rosters the answer carried. */
  readonly rosters: number;
}

/** One sample on a question that must not resolve, and did. */
export interface DeclineMiss {
  readonly leg: string;
  readonly model: string;
  readonly entryId: string;
  readonly opening: string;
  readonly disposition: Disposition;
  readonly repetition: number;
  readonly instead: CertifiedInstead;
  /** What the record shows happened. */
  readonly route: MissRoute;
  /** The layer that owes the fix for the wrong disposition. */
  readonly layer: MissLayer;
  /** Why that layer, in the words a reviewer would use. */
  readonly why: string;
}

function certifiedInstead(claims: readonly Claim[], rosters: number): CertifiedInstead {
  const lessonIds: string[] = [];
  const factIds: string[] = [];
  for (const claim of claims) {
    if (claim.kind === "explanation") lessonIds.push(claim.blockId);
    if (claim.kind === "fact") factIds.push(`${claim.entityId}/${claim.factId}`);
  }
  return {
    kinds: [...new Set(claims.map((claim) => claim.kind))].sort(),
    lessonIds: [...lessonIds].sort(),
    factIds: [...factIds].sort(),
    rosters,
  };
}

/**
 * Name the route the answer was built on, from the record alone.
 *
 * The rules run in order and the first that matches wins. None of them reads
 * the question's wording — only the disposition the bank pinned and what the
 * manifest holds — so the classification replays from the record, which is
 * what K2's gate asks of it.
 */
export function classifyDeclineMiss(
  disposition: Disposition,
  instead: CertifiedInstead,
  boundaryLessonId: string | undefined,
): MissRoute {
  const onlyLessons = instead.kinds.length === 1 && instead.kinds[0] === "explanation";
  const allBoundary =
    boundaryLessonId !== undefined && instead.lessonIds.length > 0 && instead.lessonIds.every((id) => id === boundaryLessonId);
  // A gate that exists and never fired. Checked first because on a gated ask
  // it is the gate, not the claim kind, that was owed: whatever the answer was
  // built from, the rule the trainer's ask turned on was never read. Teaching
  // the records boundary here is not an honest refusal — the records do hold
  // the entity, and the pack has a verdict about it.
  if (disposition === "gated-advisory" || disposition === "should-refuse") return "gated-dodge";
  // The boundary lesson taught alone is the honest refusal for a needs-data
  // ask and the scorer passes it there, so reaching this line means the ask
  // was off-domain, where the scorer fails every resolution. Whether teaching
  // the boundary to someone asking about pasta is a miss or the best answer
  // available is a judgement about the oracle, so it is named and left to a
  // reviewer rather than counted as a defect.
  if (disposition === "off-domain" && onlyLessons && allBoundary) return "boundary-lesson-off-domain";
  // The whole pack catalogue is an enum on the explanation route of every
  // answer call, so a topically adjacent lesson is always representable,
  // however far from what the lesson covers.
  if (onlyLessons) return "topical-lesson";
  // Advice offered where none was asked for: the two advice routes are open
  // on every call exactly as the lessons are.
  if (instead.kinds.includes("eligibility") || instead.kinds.includes("recommendation")) return "advice-route";
  // A real, certified fact stood in for one the world does not hold.
  if (instead.factIds.length > 0) return "neighbouring-fact";
  // A closed set was built for an ask that named no set.
  if (instead.rosters > 0 || instead.kinds.includes("count") || instead.kinds.includes("membership")) return "substituted-set";
  return "unclassified";
}

/**
 * Every sample in one filed leg that answered a question it should have
 * declined.
 *
 * A resolution that taught the records-boundary lesson alone is *not* here:
 * the scorer already counts it as the honest refusal it is, and this reads the
 * filed score rather than re-deriving one, so the ledger and the coverage map
 * can never disagree about what a miss is.
 */
export function declineMisses(
  leg: string,
  model: string,
  runs: readonly RecordedBankRun[],
  boundaryLessonId: string | undefined,
): readonly DeclineMiss[] {
  const misses: DeclineMiss[] = [];
  for (const run of runs) {
    if (!MUST_NOT_RESOLVE.includes(run.disposition)) continue;
    if (run.score.pass || run.stage.kind !== "resolved") continue;
    const manifest = run.run.transaction?.manifest;
    const instead = certifiedInstead(manifest?.claims ?? [], manifest?.rosters?.length ?? 0);
    const route = classifyDeclineMiss(run.disposition, instead, boundaryLessonId);
    misses.push({
      leg,
      model,
      entryId: run.entryId,
      opening: run.opening,
      disposition: run.disposition,
      repetition: run.repetition,
      instead,
      route,
      ...ROUTE_LAYER[route],
    });
  }
  return misses;
}

/** One question's standing in the ledger, across every leg read. */
export interface DeclineLedgerRow {
  readonly entryId: string;
  readonly opening: string;
  readonly disposition: Disposition;
  /** Samples of this question across the legs read — the denominator. */
  readonly samples: number;
  /** Samples that answered when they should have declined. */
  readonly misses: number;
  /** The routes taken, with how often, most frequent first. */
  readonly routes: readonly { readonly route: MissRoute; readonly count: number }[];
  /** What was certified instead, by shape, most frequent first. */
  readonly instead: readonly { readonly shape: string; readonly count: number }[];
}

export interface DeclineLedger {
  /** Legs read, in the order given. */
  readonly legs: readonly { readonly leg: string; readonly model: string; readonly source: string | undefined; readonly samples: number; readonly misses: number }[];
  /** Samples on questions that must not resolve, across every leg. */
  readonly samples: number;
  readonly misses: number;
  /** Per route, across every leg — what happened, with its owner. */
  readonly byRoute: readonly { readonly route: MissRoute; readonly layer: MissLayer; readonly count: number; readonly why: string }[];
  /** Per layer, across every leg; the `reviewer` row is K2's gate number. */
  readonly byLayer: readonly { readonly layer: MissLayer; readonly count: number }[];
  /** Per disposition, across every leg. */
  readonly byDisposition: readonly { readonly disposition: Disposition; readonly samples: number; readonly misses: number }[];
  /** One row per question that missed at least once, worst first. */
  readonly rows: readonly DeclineLedgerRow[];
}

/** One filed leg, as the ledger reads it. */
export interface DeclineLedgerLeg {
  readonly leg: string;
  readonly model: string;
  readonly runs: readonly RecordedBankRun[];
  readonly boundaryLessonId: string | undefined;
  /** The artifact this leg was read from. Rendered beside every number, so a
   * ledger filed as a document traces back to the paid run behind it and can
   * never be hand-edited into something no artifact says. */
  readonly source?: string;
}

function shapeOf(instead: CertifiedInstead): string {
  const kinds = instead.kinds.length === 0 ? "nothing" : instead.kinds.join("+");
  return instead.rosters > 0 && !instead.kinds.includes("roster") ? `${kinds} (+${instead.rosters} roster)` : kinds;
}

function ranked<T extends string>(counts: ReadonlyMap<T, number>): readonly { key: T; count: number }[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    // Ties break on the key so the ledger is byte-stable across runs of the
    // same input — a filed classification has to replay (K2's gate).
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** The ledger over any number of filed legs. Pure: same legs, same bytes. */
export function declineLedger(legs: readonly DeclineLedgerLeg[]): DeclineLedger {
  const perLeg: { leg: string; model: string; source: string | undefined; samples: number; misses: number }[] = [];
  const routeCounts = new Map<MissRoute, number>();
  const layerCounts = new Map<MissLayer, number>();
  const dispSamples = new Map<Disposition, number>();
  const dispMisses = new Map<Disposition, number>();
  const rows = new Map<string, { opening: string; disposition: Disposition; samples: number; misses: number; routes: Map<MissRoute, number>; instead: Map<string, number> }>();
  let samples = 0;
  let misses = 0;

  for (const leg of legs) {
    const mine = leg.runs.filter((run) => MUST_NOT_RESOLVE.includes(run.disposition));
    const found = declineMisses(leg.leg, leg.model, leg.runs, leg.boundaryLessonId);
    perLeg.push({ leg: leg.leg, model: leg.model, source: leg.source, samples: mine.length, misses: found.length });
    samples += mine.length;
    misses += found.length;
    for (const run of mine) {
      dispSamples.set(run.disposition, (dispSamples.get(run.disposition) ?? 0) + 1);
      const row = rows.get(run.entryId) ?? { opening: run.opening, disposition: run.disposition, samples: 0, misses: 0, routes: new Map(), instead: new Map() };
      row.samples += 1;
      rows.set(run.entryId, row);
    }
    for (const miss of found) {
      routeCounts.set(miss.route, (routeCounts.get(miss.route) ?? 0) + 1);
      layerCounts.set(miss.layer, (layerCounts.get(miss.layer) ?? 0) + 1);
      dispMisses.set(miss.disposition, (dispMisses.get(miss.disposition) ?? 0) + 1);
      const row = rows.get(miss.entryId);
      // Every miss came from a run counted just above, so the row exists.
      if (row === undefined) continue;
      row.misses += 1;
      row.routes.set(miss.route, (row.routes.get(miss.route) ?? 0) + 1);
      const shape = shapeOf(miss.instead);
      row.instead.set(shape, (row.instead.get(shape) ?? 0) + 1);
    }
  }

  return {
    legs: perLeg,
    samples,
    misses,
    byRoute: ranked(routeCounts).map(({ key, count }) => ({ route: key, count, ...ROUTE_LAYER[key] })),
    byLayer: ranked(layerCounts).map(({ key, count }) => ({ layer: key, count })),
    byDisposition: [...dispSamples.entries()]
      .map(([disposition, total]) => ({ disposition, samples: total, misses: dispMisses.get(disposition) ?? 0 }))
      .sort((a, b) => b.misses - a.misses || a.disposition.localeCompare(b.disposition)),
    rows: [...rows.entries()]
      .filter(([, row]) => row.misses > 0)
      .map(([entryId, row]) => ({
        entryId,
        opening: row.opening,
        disposition: row.disposition,
        samples: row.samples,
        misses: row.misses,
        routes: ranked(row.routes).map(({ key, count }) => ({ route: key, count })),
        instead: ranked(row.instead).map(({ key, count }) => ({ shape: key, count })),
      }))
      .sort((a, b) => b.misses - a.misses || a.entryId.localeCompare(b.entryId)),
  };
}

function countAndPercent(count: number, total: number): string {
  // Count and percentage together, always — the project's reporting rule, so
  // a reader never does the mental math and a share can never hide a small
  // denominator.
  return total === 0 ? `${count}/0 (—)` : `${count}/${total} (${Math.round((100 * count) / total)}%)`;
}

/** The ledger as Markdown — a reading, never a recomputation. */
export function renderDeclineLedger(ledger: DeclineLedger): readonly string[] {
  const lines: string[] = [
    "# The decline ledger",
    "",
    "Every sample on a question that must not receive a certified answer, and what the",
    "record certified when it answered anyway. Read from filed runs; nothing here is",
    "measured or recomputed. Each row is a **defect** — the system answered a different",
    "question rather than saying it could not answer this one — and the **layer** is who",
    "owes the fix. The questions it correctly declined are in the denominators below and",
    "are not listed: counting those is the demand ledger (epic #170 K1), which is not",
    "built.",
    "",
    "Generated by `npm run decline-ledger` — do not hand-edit. Every number below",
    "traces to an artifact named in the table that follows; the only way to change",
    "one is a new run.",
    "",
    `**Answered when it should have declined: ${countAndPercent(ledger.misses, ledger.samples)}** across ${ledger.legs.length} filed leg(s).`,
    "",
    "## The legs read",
    "",
    "| leg | model | samples | answered wrongly | artifact |",
    "| --- | --- | ---: | ---: | --- |",
  ];
  for (const leg of ledger.legs) {
    lines.push(
      `| ${leg.leg} | \`${leg.model}\` | ${leg.samples} | ${countAndPercent(leg.misses, leg.samples)} | ${leg.source === undefined ? "—" : `\`${leg.source}\``} |`,
    );
  }
  lines.push("", "## What happened, and who owes the fix", "", "| route | share of the misses | layer | the change that would retire it |", "| --- | ---: | --- | --- |");
  for (const row of ledger.byRoute) {
    lines.push(`| ${row.route} | ${countAndPercent(row.count, ledger.misses)} | ${row.layer} | ${row.why} |`);
  }
  lines.push("", "Rolled up by layer:", "", "| layer | share of the misses |", "| --- | ---: |");
  for (const row of ledger.byLayer) {
    lines.push(`| ${row.layer} | ${countAndPercent(row.count, ledger.misses)} |`);
  }
  lines.push("", "## By disposition", "", "| disposition | samples | answered wrongly |", "| --- | ---: | ---: |");
  for (const row of ledger.byDisposition) {
    lines.push(`| ${row.disposition} | ${row.samples} | ${countAndPercent(row.misses, row.samples)} |`);
  }
  lines.push("", "## The questions, worst first", "", "| question | disposition | answered wrongly | route | certified instead |", "| --- | --- | ---: | --- | --- |");
  for (const row of ledger.rows) {
    const routes = row.routes.map((entry) => `${entry.route} ${entry.count}`).join(", ");
    const instead = row.instead.map((entry) => `${entry.shape} ${entry.count}`).join(", ");
    lines.push(`| ${row.opening.replace(/\|/g, "\\|")} <br> \`${row.entryId}\` | ${row.disposition} | ${countAndPercent(row.misses, row.samples)} | ${routes} | ${instead} |`);
  }
  return lines;
}
