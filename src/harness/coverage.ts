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
import { addCeremony, NO_CEREMONY } from "./ceremony.js";

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
  /** Entries whose outcome followed a strip-assertion repair (docs/recovery.md,
   * channel 2). Surfaced so post-repair resolutions are never mistaken for
   * first-attempt ones — the accounting rule that makes the repair safe.
   * Optional: artifacts filed before the repair existed read unchanged. */
  repaired?: readonly string[];
  /**
   * Runs whose answer call was repeated after the model's whole reply was a
   * nomination the driver refused (docs/answer-prompt.md, M3) — the
   * first-call routing habit, by entry, one item per run. Optional:
   * artifacts filed before the field existed read unchanged.
   */
  nominationRetried?: readonly string[];
  /**
   * The prompt's cost across the runs, when the runs carry it: model calls
   * made and prompt tokens consumed, so a prompt lever's tokens per call is
   * read from the record rather than transcribed from a bill.
   */
  prompting?: { runs: number; calls: number; promptTokens: number };
  /**
   * The listing door's funnel across the runs that carry it
   * (docs/offered-door.md): how many first calls had the door in the
   * grammar, how many replies nominated it, how many listings were served.
   * Offered over runs is the withheld rate's complement; nominated over
   * offered is what the model does with an offer it is given.
   */
  listingDoor?: { runs: number; offered: number; nominated: number; served: number };
  /**
   * The lesson door's funnel (docs/lesson-door.md), present when the runs
   * carry it: how many first calls had the catalogue narrowed, how many
   * offered the boundary lesson alone (the ask named nothing a lesson
   * explains), and the lessons offered summed over the runs — divided by
   * runs, the mean catalogue size the model saw.
   */
  lessonDoor?: {
    runs: number;
    narrowed: number;
    boundaryOnly: number;
    offered: number;
    /** The classifier, when it ran: how many first calls asked it, how
     * many of those it answered with a lesson, and how many replies were
     * unusable. Absent when the lever was off. */
    classified?: { asked: number; lesson: number; unusable: number; noFoothold: number };
  };
  /**
   * The trainer-facing ceremony across the runs, present when the runs carry
   * it (epic #94, slice 5): clarifying questions asked, scope cards ruled on,
   * act cards consented — beside calls/turn, so friction is priced in what
   * the trainer endured, not only in what the model billed. `resolved` is the
   * denominator for a per-resolution reading.
   */
  ceremony?: { questions: number; clarifications: number; scopeCards: number; actCards: number; resolved: number };
  /**
   * The model's own questions across the runs, when the clarify door was
   * open (docs/routing.md, R3b step 3): how many it asked, how many the
   * truthful trainer could answer from the oracle, how many held no right
   * answer (`ignored`) and how many a third ask was refused (`capped`).
   * `ignored` is the number that says whether the model asks about the
   * right thing; `asked` over `runs` is the nomination rate.
   */
  clarification?: { runs: number; asked: number; picked: number; ignored: number; capped: number };
  /**
   * Follow-up suggestions across the runs, when the suggest door was open
   * (R3b step 4): `shown` read from the records, `answersWith` the resolved
   * runs whose certified answer carried at least one — the number that says
   * whether the conversation has a shape — and `dropped` the offenders the
   * topic-not-value rule removed before the kernel saw them.
   */
  suggestions?: { runs: number; shown: number; answersWith: number; dropped: number };
  /** The per-entry stability reading, present when the runs span more than one
   * repetition. This is the §21 noise-floor instrument: at N=1 a topline is one
   * draw from an unmeasured churn band; at N≥2 the band is measured and a delta
   * smaller than it is dice, not a result. Optional: single-pass artifacts —
   * every one filed before this existed — read unchanged. */
  repetition?: RepetitionSummary;
}

// --- repetition stability (the §21 noise-floor instrument) ------------------

export type StabilityVerdict = "stable-pass" | "flaky" | "stable-fail";

/** One entry's outcomes across the repetitions it ran in. */
export interface EntryStability {
  entryId: string;
  disposition: Disposition;
  /** `score.pass` per repetition, in repetition order. */
  outcomes: readonly boolean[];
  /** The funnel stages seen across repetitions, deduped, first-seen order —
   * *where* the churn happened, when it did. */
  stages: readonly FunnelStageKind[];
  verdict: StabilityVerdict;
}

export interface RepetitionSummary {
  /** Distinct repetition passes present in the runs — the N actually paid for
   * (an enforcement stop can leave fewer than requested). */
  repetitions: number;
  /** Distinct entries measured. */
  entries: number;
  /** Passes per repetition, in repetition order — the raw points behind the
   * band; each is what a same-config N=1 run would have reported as *the*
   * topline. */
  passPerRepetition: readonly number[];
  /** The min–max of {@link passPerRepetition}: the churn band. A delta between
   * two runs is a result only when it clears this. */
  band: { min: number; max: number };
  /** Entries that passed in every repetition — the floor the model actually
   * guarantees, which no single pass can name. */
  stablePass: number;
  /** Entries that failed in every repetition — real gaps, not dice. */
  stableFail: number;
  /** Entries whose outcome differed between repetitions — the churn, named
   * entry by entry. These mark where the model guesses rather than knows. */
  flaky: readonly EntryStability[];
}

/**
 * The stability reading over a multi-pass run, or undefined when the runs span
 * a single repetition (an N=1 run has no churn to read — that absence being
 * measurable is the point).
 *
 * Enforcement takes no majority vote here: escalations are collected over
 * *every* sample in {@link coverageMap}, so one crossing in any repetition
 * breaks the zero. Stability grades usefulness only.
 */
export function repetitionSummary(runs: readonly BankRun[]): RepetitionSummary | undefined {
  const reps = [...new Set(runs.map((run) => run.repetition))].sort((a, b) => a - b);
  if (reps.length < 2) return undefined;

  const byEntry = new Map<string, BankRun[]>();
  for (const run of runs) {
    const mine = byEntry.get(run.entryId);
    if (mine === undefined) byEntry.set(run.entryId, [run]);
    else mine.push(run);
  }

  const graded = [...byEntry.entries()].map(([entryId, mine]): EntryStability => {
    const ordered = [...mine].sort((a, b) => a.repetition - b.repetition);
    const outcomes = ordered.map((run) => run.score.pass);
    const verdict: StabilityVerdict = outcomes.every((pass) => pass)
      ? "stable-pass"
      : outcomes.some((pass) => pass)
        ? "flaky"
        : "stable-fail";
    return {
      entryId,
      disposition: ordered[0]!.disposition,
      outcomes,
      stages: [...new Set(ordered.map((run) => run.stage.kind))],
      verdict,
    };
  });

  const passPerRepetition = reps.map((rep) => runs.filter((run) => run.repetition === rep && run.score.pass).length);
  return {
    repetitions: reps.length,
    entries: byEntry.size,
    passPerRepetition,
    band: { min: Math.min(...passPerRepetition), max: Math.max(...passPerRepetition) },
    stablePass: graded.filter((entry) => entry.verdict === "stable-pass").length,
    stableFail: graded.filter((entry) => entry.verdict === "stable-fail").length,
    flaky: graded.filter((entry) => entry.verdict === "flaky"),
  };
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

  const repetition = repetitionSummary(runs);
  const carried = runs.filter((run) => run.ceremony !== undefined);
  const ceremony =
    carried.length === 0
      ? undefined
      : {
          ...carried.reduce((sum, run) => addCeremony(sum, run.ceremony ?? NO_CEREMONY), NO_CEREMONY),
          resolved: runs.filter((run) => run.stage.kind === "resolved").length,
        };
  const clarified = runs.filter((run) => run.clarified !== undefined);
  const clarification =
    clarified.length === 0
      ? undefined
      : clarified.reduce(
          (sum, run) => ({
            runs: sum.runs + 1,
            asked: sum.asked + (run.clarified?.asked ?? 0),
            picked: sum.picked + (run.clarified?.picked ?? 0),
            ignored: sum.ignored + (run.clarified?.ignored ?? 0),
            capped: sum.capped + (run.clarified?.capped ?? 0),
          }),
          { runs: 0, asked: 0, picked: 0, ignored: 0, capped: 0 },
        );
  const suggested = runs.filter((run) => run.suggestions !== undefined);
  const suggestions =
    suggested.length === 0
      ? undefined
      : suggested.reduce(
          (sum, run) => ({
            runs: sum.runs + 1,
            shown: sum.shown + (run.suggestions?.shown ?? 0),
            answersWith: sum.answersWith + ((run.suggestions?.shown ?? 0) > 0 ? 1 : 0),
            dropped: sum.dropped + (run.suggestions?.dropped ?? 0),
          }),
          { runs: 0, shown: 0, answersWith: 0, dropped: 0 },
        );
  const prompted = runs.filter((run) => run.promptTokens !== undefined);
  const prompting =
    prompted.length === 0
      ? undefined
      : {
          runs: prompted.length,
          calls: prompted.reduce((sum, run) => sum + run.turns, 0),
          promptTokens: prompted.reduce((sum, run) => sum + (run.promptTokens ?? 0), 0),
        };
  const doored = runs.filter((run) => run.listingDoor !== undefined);
  const listingDoor =
    doored.length === 0
      ? undefined
      : {
          runs: doored.length,
          offered: doored.filter((run) => run.listingDoor?.offered === true).length,
          nominated: doored.filter((run) => run.listingDoor?.nominated === true).length,
          served: doored.filter((run) => run.listingDoor?.served === true).length,
        };
  const lessoned = runs.filter((run) => run.lessonDoor !== undefined);
  const lessonDoor =
    lessoned.length === 0
      ? undefined
      : {
          runs: lessoned.length,
          narrowed: lessoned.filter((run) => run.lessonDoor?.narrowed === true).length,
          boundaryOnly: lessoned.filter((run) => run.lessonDoor?.offered === 1).length,
          offered: lessoned.reduce((sum, run) => sum + (run.lessonDoor?.offered ?? 0), 0),
          ...(lessoned.some((run) => run.lessonDoor?.classified !== undefined)
            ? {
                classified: {
                  asked: lessoned.filter((run) => run.lessonDoor?.classified !== undefined).length,
                  lesson: lessoned.filter((run) => run.lessonDoor?.classified?.startsWith("lesson:") === true).length,
                  unusable: lessoned.filter((run) => run.lessonDoor?.classified === "unusable").length,
                  noFoothold: lessoned.filter((run) => run.lessonDoor?.classified?.endsWith(":no-foothold") === true).length,
                },
              }
            : {}),
        };
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
    repaired: runs.filter((run) => run.repaired === true).map((run) => run.entryId),
    nominationRetried: runs.filter((run) => run.nominationRetried === true).map((run) => run.entryId),
    ...(prompting === undefined ? {} : { prompting }),
    ...(listingDoor === undefined ? {} : { listingDoor }),
    ...(lessonDoor === undefined ? {} : { lessonDoor }),
    ...(ceremony === undefined ? {} : { ceremony }),
    ...(clarification === undefined ? {} : { clarification }),
    ...(suggestions === undefined ? {} : { suggestions }),
    ...(repetition === undefined ? {} : { repetition }),
  };
}

// --- rendering --------------------------------------------------------------

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The map as Markdown — pure, read from the aggregate, never recomputed. */
export function renderCoverage(map: CoverageMap, heading = "Playability coverage map"): string {
  const lines: string[] = [`# ${heading}`, ""];

  lines.push(
    `**${map.pass}/${map.total} passed** — a pass is a question that did what its disposition expects` +
      (map.repetition === undefined ? "." : " (samples pooled over every repetition; the band below is the honest headline)."),
  );
  lines.push("");

  // The stability reading, when the run repeated. The band comes before the
  // rates: every per-sample number below is one draw from it, and a reader who
  // sees the rate without the band is reading noise as signal (§21).
  if (map.repetition !== undefined) {
    const r = map.repetition;
    lines.push(
      `**N=${r.repetitions} repetitions over ${r.entries} entries — passes per repetition: ${r.passPerRepetition.join(", ")} ` +
        `(band ${r.band.min}–${r.band.max}).** A same-config topline moves inside this band on sampling alone; ` +
        "a delta is a result only when it clears it.",
    );
    lines.push(
      `**Stable core: ${r.stablePass}/${r.entries}** pass in every repetition — the floor the model actually guarantees. ` +
        `**${r.stableFail} stable fails** — real gaps, not dice. **${r.flaky.length} flaky** — where the model guesses:`,
    );
    for (const entry of r.flaky) {
      const marks = entry.outcomes.map((pass) => (pass ? "✓" : "✗")).join("");
      lines.push(`- \`${entry.entryId}\` (${entry.disposition}) — ${marks}; landed in ${entry.stages.join(" / ")}`);
    }
    lines.push("");
  }

  // Enforcement first and alone: a broken zero is not a coverage statistic.
  // "Committed gated advice" rather than "resolved": a should-refuse question
  // can resolve by deflection (facts, eligible picks), which the record
  // downgrades — the zero is about what was certified, not which bucket.
  if (map.enforcementEscalations.length === 0) {
    lines.push("**Enforcement holds:** no `should-refuse` question committed the advice the pack gates. ✅");
  } else {
    lines.push(`**ENFORCEMENT ESCALATION:** ${map.enforcementEscalations.length} gated question(s) committed gated advice — ${map.enforcementEscalations.join(", ")}. This is a broken enforcement zero, not a usefulness result.`);
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
  // The second column (epic #94, issue #113): what a user experienced. The
  // strict rate above fails an off-shape or off-subject resolution — the
  // right instrument for the improvement loop, and a harsher reading than
  // "did I get a true answer". This one counts every answerable question
  // that reached a certified answer at all (the resolved stage); everything
  // it counts is certified-true, so its complement is always an honest
  // abstention or a named refusal, never a wrong answer. Two columns from
  // the same records, never blended — the strict rate stays the target, and
  // this line may never excuse a deflection the ledger above charges.
  if (answerable.total > 0) {
    const certified = answerable.stages.resolved;
    lines.push(
      `**Certified-answer rate: ${pct(rate(certified, answerable.total))}** (${certified}/${answerable.total}) — answerable questions that received a certified answer, on-oracle or off. ` +
        "Every such answer is certified-true; the complement is always an honest abstention or a named refusal, never a wrong answer. " +
        "Reported beside the strict rate, never blended with it.",
    );
  }
  const advisory = map.byDisposition.find((row) => row.disposition === "advisory");
  if (advisory !== undefined && advisory.total > 0) {
    lines.push(`**Advisory resolution rate: ${pct(advisory.passRate)}** (${advisory.pass}/${advisory.total}) — reported apart: eligibility-checked advice, a weaker certificate than a fact.`);
  }
  const gated = map.byDisposition.find((row) => row.disposition === "gated-advisory");
  if (gated !== undefined && gated.total > 0) {
    lines.push(`**Gated questions answered usefully or refused by name: ${pct(gated.passRate)}** (${gated.pass}/${gated.total}) — a certified eligibility answer and a named denial both count; a dodge counts against.`);
  }
  const refusals = map.byDisposition.filter((row) => row.disposition === "needs-data" || row.disposition === "needs-claim-kind");
  const owed = refusals.reduce((sum, row) => sum + row.total, 0);
  const honest = refusals.reduce((sum, row) => sum + row.pass, 0);
  if (owed > 0) {
    lines.push(`**Honest-refusal rate on unanswerable questions: ${pct(rate(honest, owed))}** (${honest}/${owed}) — the trust number.`);
  }
  if (map.ceremony !== undefined) {
    const c = map.ceremony;
    const per = (value: number): string => (c.resolved === 0 ? "—" : (value / c.resolved).toFixed(2));
    // Artifacts filed before the model could ask carry no clarification
    // count; they read as zero, which is what they were.
    const clarifications = c.clarifications ?? 0;
    lines.push(
      `**Ceremony, from the record:** ${c.questions} clarifying question(s), ${clarifications} advisor question(s), ${c.scopeCards} scope card(s), ` +
        `${c.actCards} act consent(s) across ${map.total} sample(s) — per resolution: ` +
        `${per(c.questions)} questions, ${per(clarifications)} advisor questions, ${per(c.scopeCards)} scope cards, ${per(c.actCards)} act consents. ` +
        "The trainer's cost beside the model's; the consent gradient priced in clicks actually endured.",
    );
  }
  // The two model doors of R3b, when they were open. Each line names its
  // condition — a run with the door shut reports nothing here rather than a
  // zero that would read as "the model never asked".
  if (map.clarification !== undefined) {
    const q = map.clarification;
    lines.push(
      `**Clarification (door open on ${q.runs} run(s)):** the model asked ${q.asked} question(s) — ` +
        `${q.picked} answered from the oracle, ${q.ignored} held no right option (the trainer said so), ${q.capped} refused as a third. ` +
        "The nomination rate is asked over runs; ignored is whether the model asks about the right thing.",
    );
  }
  if (map.suggestions !== undefined) {
    const s = map.suggestions;
    lines.push(
      `**Suggestions (door open on ${s.runs} run(s)):** ${s.shown} shown on ${s.answersWith} certified answer(s), ` +
        `${s.dropped} dropped by the topic-not-value rule before the kernel saw them. Never certified; shown in their own register.`,
    );
  }
  lines.push("");

  if (map.friction.length > 0) {
    lines.push("**Answerable questions that died of scope friction** (the next slice):");
    for (const item of map.friction) lines.push(`- \`${item.entryId}\` — ${item.turns} turns`);
    lines.push("");
  }

  // Post-repair outcomes named apart, so a repaired mis-recall can never read
  // as a first-attempt resolution — the accounting rule of docs/recovery.md.
  const repaired = map.repaired ?? [];
  if (repaired.length > 0) {
    // One list item per repaired *run*: at N>1 the same entry can repair in
    // several repetitions, so duplicates group with a count rather than repeat.
    const counts = new Map<string, number>();
    for (const id of repaired) counts.set(id, (counts.get(id) ?? 0) + 1);
    const named = [...counts.entries()].map(([id, count]) => (count === 1 ? `\`${id}\`` : `\`${id}\` ×${count}`)).join(", ");
    lines.push(
      `**${repaired.length} outcome(s) followed a strip-assertion repair** — the model mis-recalled a value, ` +
        `the system stripped the assertion and the kernel read the certified one: ${named}. ` +
        "First-attempt, these were IA-2 denials; they are counted apart.",
    );
    lines.push("");
  }

  // The first-call routing habit (docs/answer-prompt.md, M3): how often the
  // model's whole first reply was a nomination the driver refused, so the
  // answer call was paid for twice — count and percentage, over the runs.
  const nominated = map.nominationRetried ?? [];
  if (nominated.length > 0) {
    lines.push(
      `**${nominated.length}/${map.total} (${pct(nominated.length / map.total)}) run(s) repeated the answer call after a refused nomination** — ` +
        "the whole first reply asked for a door the question did not fit; the door was withdrawn for one call and the reply that came after is the one filed.",
    );
    lines.push("");
  }
  // The listing door's funnel (docs/offered-door.md): offered, nominated,
  // served — count and percentage, so a withheld door is a number.
  if (map.listingDoor !== undefined) {
    const door = map.listingDoor;
    lines.push(
      `**The listing door: offered on ${door.offered}/${door.runs} (${pct(door.offered / door.runs)}) first calls, nominated on ${door.nominated}/${door.runs} (${pct(door.nominated / door.runs)}), served on ${door.served}/${door.runs} (${pct(door.served / door.runs)})** — ` +
        "a door left out of the grammar is one the driver would have refused; a nomination is the model's whole first reply asking for it.",
    );
    lines.push("");
  }
  if (map.lessonDoor !== undefined) {
    const door = map.lessonDoor;
    lines.push(
      `**The lesson door: the catalogue narrowed on ${door.narrowed}/${door.runs} (${pct(door.narrowed / door.runs)}) first calls, the boundary lesson alone on ${door.boundaryOnly}/${door.runs} (${pct(door.boundaryOnly / door.runs)}); ${(door.offered / door.runs).toFixed(1)} lessons offered per call on average** — ` +
        "a lesson left out of the grammar is one the ask is not about; the boundary lesson is always in.",
    );
    if (door.classified !== undefined) {
      lines.push(
        `**The classifier: asked on ${door.classified.asked}/${door.runs} (${pct(door.classified.asked / door.runs)}) first calls, named a lesson on ${door.classified.lesson}/${door.classified.asked}, of which ${door.classified.noFoothold} shared no word with the ask and were not offered; unusable on ${door.classified.unusable}/${door.classified.asked}** — ` +
          "asked only where the deterministic matcher offered the boundary alone.",
      );
    }
    lines.push("");
  }
  // The prompt's cost, per call, read from the runs.
  if (map.prompting !== undefined && map.prompting.calls > 0) {
    lines.push(
      `**Prompt tokens per model call: ${Math.round(map.prompting.promptTokens / map.prompting.calls)}** — ` +
        `${map.prompting.promptTokens} prompt tokens over ${map.prompting.calls} calls in ${map.prompting.runs} run(s).`,
    );
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
