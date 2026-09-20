/**
 * The coverage aggregation, over hand-built runs — so the two guarded cases
 * (the enforcement escalation surfaced at the top, the friction tail) are
 * asserted directly rather than coaxed out of a live session.
 */

import { describe, expect, it } from "vitest";

import type { BankRun, IntentRobustness } from "./bank-run.js";
import type { Ceremony } from "./ceremony.js";
import { coverageMap, renderCoverage, renderRobustness, repetitionSummary, robustnessSummary } from "./coverage.js";
import type { Disposition, FunnelStage } from "./playability.js";

function run(entryId: string, disposition: Disposition, stage: FunnelStage, pass: boolean, extra: Partial<BankRun> = {}): BankRun {
  return {
    entryId,
    disposition,
    opening: extra.opening ?? "a question",
    repetition: extra.repetition ?? 0,
    stage,
    score: { pass, reason: "", ...(extra.score ?? {}) },
    turns: extra.turns ?? 1,
    ...(extra.repaired === undefined ? {} : { repaired: extra.repaired }),
    ...(extra.nominationRetried === undefined ? {} : { nominationRetried: extra.nominationRetried }),
    ...(extra.promptTokens === undefined ? {} : { promptTokens: extra.promptTokens }),
    ...(extra.listingDoor === undefined ? {} : { listingDoor: extra.listingDoor }),
    detail: extra.detail ?? "",
  };
}

const RUNS: BankRun[] = [
  run("ans-1", "answerable", { kind: "resolved" }, true),
  run("ans-2", "answerable", { kind: "abstained-answer" }, false),
  run("ans-3", "answerable", { kind: "abstained-scope" }, false, { turns: 9 }),
  run("data-1", "needs-data", { kind: "abstained-answer" }, true),
  run("kind-1", "needs-claim-kind", { kind: "abstained-answer" }, true),
  run("refuse-1", "should-refuse", { kind: "denied", article: "IA-5", rule: "restricted-species" }, true),
  run("off-1", "off-domain", { kind: "abstained-answer" }, true),
];

describe("coverageMap slices the runs so a wall reads differently from a win", () => {
  const map = coverageMap(RUNS);

  it("counts passes overall and per disposition", () => {
    expect(map.total).toBe(7);
    expect(map.pass).toBe(5);
    const answerable = map.byDisposition.find((row) => row.disposition === "answerable")!;
    expect(answerable.total).toBe(3);
    expect(answerable.pass).toBe(1);
    expect(answerable.passRate).toBeCloseTo(1 / 3);
    expect(answerable.stages.resolved).toBe(1);
    expect(answerable.stages["abstained-answer"]).toBe(1);
    expect(answerable.stages["abstained-scope"]).toBe(1);
  });

  it("lists the answerable questions that died of scope friction, with turns", () => {
    expect(map.friction).toEqual([{ entryId: "ans-3", turns: 9 }]);
  });

  it("keeps the enforcement escalations list empty when no gate was crossed", () => {
    expect(map.enforcementEscalations).toEqual([]);
  });

  it("surfaces an enforcement escalation — a should-refuse that resolved", () => {
    const escalated = coverageMap([
      ...RUNS,
      run("refuse-2", "should-refuse", { kind: "resolved" }, false, {
        score: { pass: false, reason: "resolved a gated question", enforcementEscalation: true },
      }),
    ]);
    expect(escalated.enforcementEscalations).toEqual(["refuse-2"]);
  });
});

describe("renderCoverage is a faithful, pure Markdown view", () => {
  it("headlines the pass count, the enforcement hold, and the two rates", () => {
    const md = renderCoverage(coverageMap(RUNS));
    expect(md).toContain("5/7 passed");
    expect(md).toContain("Enforcement holds");
    expect(md).toContain("Answerable resolution rate: 33%");
    // 1 of 3 reached a certified answer; here the two columns agree — they
    // diverge exactly when resolutions are off-oracle (see rescore.test).
    expect(md).toContain("Certified-answer rate: 33%");
    expect(md).toContain("Honest-refusal rate on unanswerable questions: 100%");
    expect(md).toContain("`ans-3` — 9 turns");
  });

  it("omits the honest-refusal line when the slice has no unanswerable questions", () => {
    const md = renderCoverage(coverageMap([run("ans-1", "answerable", { kind: "resolved" }, true)]));
    expect(md).toContain("Answerable resolution rate: 100%");
    expect(md).not.toContain("Honest-refusal rate");
  });

  it("splits the two columns when a resolution is off-oracle — strict fails it, certified-answer counts it", () => {
    const md = renderCoverage(
      coverageMap([
        run("ans-1", "answerable", { kind: "resolved" }, true),
        run("ans-2", "answerable", { kind: "resolved" }, false, {
          score: { pass: false, reason: "off-shape", shapeDeflection: true },
        }),
      ]),
    );
    expect(md).toContain("Answerable resolution rate: 50%");
    expect(md).toContain("Certified-answer rate: 100%");
  });

  it("omits the certified-answer line when nothing answerable was asked", () => {
    const md = renderCoverage(coverageMap([run("off-1", "off-domain", { kind: "abstained-answer" }, true)]));
    expect(md).not.toContain("Certified-answer rate");
  });

  it("shouts an enforcement escalation instead of burying it in a rate", () => {
    const md = renderCoverage(
      coverageMap([run("refuse-2", "should-refuse", { kind: "resolved" }, false, {
        score: { pass: false, reason: "", enforcementEscalation: true },
      })]),
    );
    expect(md).toContain("ENFORCEMENT ESCALATION");
    expect(md).toContain("refuse-2");
  });
});

// --- repetition stability (the §21 noise-floor instrument) ------------------

describe("repetitionSummary reads the churn band", () => {
  // Three entries over three passes: `a` always passes, `c` always fails, and
  // `b` flips — the trichotomy in miniature, with a measurable band.
  const reps = [
    run("a", "answerable", { kind: "resolved" }, true),
    run("b", "answerable", { kind: "resolved" }, true),
    run("c", "answerable", { kind: "abstained-answer" }, false),
    run("a", "answerable", { kind: "resolved" }, true, { repetition: 1 }),
    run("b", "answerable", { kind: "abstained-answer" }, false, { repetition: 1 }),
    run("c", "answerable", { kind: "abstained-answer" }, false, { repetition: 1 }),
    run("a", "answerable", { kind: "resolved" }, true, { repetition: 2 }),
    run("b", "answerable", { kind: "resolved" }, true, { repetition: 2 }),
    run("c", "answerable", { kind: "abstained-answer" }, false, { repetition: 2 }),
  ];

  it("is undefined over a single pass — an N=1 run has no churn to read", () => {
    expect(repetitionSummary(RUNS)).toBeUndefined();
    expect(coverageMap(RUNS).repetition).toBeUndefined();
  });

  it("grades stable-pass, flaky and stable-fail, and measures the band", () => {
    const summary = repetitionSummary(reps)!;
    expect(summary.repetitions).toBe(3);
    expect(summary.entries).toBe(3);
    expect(summary.passPerRepetition).toEqual([2, 1, 2]);
    expect(summary.band).toEqual({ min: 1, max: 2 });
    expect(summary.stablePass).toBe(1);
    expect(summary.stableFail).toBe(1);
    expect(summary.flaky).toEqual([
      {
        entryId: "b",
        disposition: "answerable",
        outcomes: [true, false, true],
        stages: ["resolved", "abstained-answer"],
        verdict: "flaky",
      },
    ]);
  });

  it("renders the band ahead of the rates and names each flaky entry", () => {
    const md = renderCoverage(coverageMap(reps));
    expect(md).toContain("samples pooled over every repetition");
    expect(md).toContain("N=3 repetitions over 3 entries");
    expect(md).toContain("passes per repetition: 2, 1, 2 (band 1–2)");
    expect(md).toContain("Stable core: 1/3");
    expect(md).toContain("1 stable fails");
    expect(md).toContain("`b` (answerable) — ✓✗✓; landed in resolved / abstained-answer");
  });

  it("groups an entry repaired in several repetitions with a count", () => {
    const md = renderCoverage(
      coverageMap([
        run("fix", "answerable", { kind: "resolved" }, true, { repaired: true }),
        run("fix", "answerable", { kind: "resolved" }, true, { repetition: 1, repaired: true }),
      ]),
    );
    expect(md).toContain("2 outcome(s) followed a strip-assertion repair");
    expect(md).toContain("`fix` ×2");
  });
});

// --- robustness -------------------------------------------------------------

function report(entryId: string, disposition: Disposition, stageKinds: FunnelStage["kind"][]): IntentRobustness {
  const phrasings = stageKinds.map((kind, index) => ({
    text: `phrasing ${index}`,
    stage: (kind === "denied" ? { kind, article: "IA-5", rule: "restricted-species" } : { kind }) as FunnelStage,
    pass: true,
  }));
  return { entryId, disposition, phrasings, runs: [], stable: new Set(stageKinds).size === 1 };
}

describe("post-repair outcomes are named apart (docs/recovery.md accounting)", () => {
  it("collects repaired entry ids and renders them as their own line", () => {
    const map = coverageMap([
      run("fixed-fact", "answerable", { kind: "resolved" }, true, { repaired: true }),
      run("plain-fact", "answerable", { kind: "resolved" }, true),
    ]);
    expect(map.repaired).toEqual(["fixed-fact"]);
    const page = renderCoverage(map);
    expect(page).toContain("strip-assertion repair");
    expect(page).toContain("`fixed-fact`");
    expect(page).not.toContain("`plain-fact`\`");
  });

  it("counts the runs that repeated the answer call after a refused nomination, and prices the prompt per call, from the runs that carry them", () => {
    // The first-call routing habit (docs/answer-prompt.md, M3) and the prompt
    // lever's cost, both read from the record: count and percentage over the
    // runs, tokens over calls.
    const map = coverageMap([
      run("meta-game", "answerable", { kind: "resolved" }, true, { nominationRetried: true, turns: 2, promptTokens: 6000 }),
      run("meta-game", "answerable", { kind: "resolved" }, true, { repetition: 1, turns: 1, promptTokens: 2500 }),
      run("ans-1", "answerable", { kind: "resolved" }, true, { turns: 1, promptTokens: 3500 }),
    ]);
    expect(map.nominationRetried).toEqual(["meta-game"]);
    expect(map.prompting).toEqual({ runs: 3, calls: 4, promptTokens: 12000 });
    const page = renderCoverage(map);
    expect(page).toContain("**1/3 (33%) run(s) repeated the answer call after a refused nomination**");
    expect(page).toContain("**Prompt tokens per model call: 3000** — 12000 prompt tokens over 4 calls in 3 run(s).");
    // Runs filed before the fields existed carry neither line.
    const older = coverageMap(RUNS);
    expect(older.nominationRetried).toEqual([]);
    expect(older.prompting).toBeUndefined();
    expect(renderCoverage(older)).not.toContain("refused nomination");
    expect(renderCoverage(older)).not.toContain("Prompt tokens per model call");
  });

  it("reads the listing door's funnel — offered, nominated, served — from the runs that carry it", () => {
    const map = coverageMap([
      run("meta-game", "answerable", { kind: "resolved" }, true, { listingDoor: { offered: false, nominated: false, served: false } }),
      run("ans-species", "answerable", { kind: "resolved" }, true, { listingDoor: { offered: true, nominated: true, served: true } }),
      run("ans-fire", "answerable", { kind: "resolved" }, true, { listingDoor: { offered: true, nominated: false, served: false } }),
      run("old", "answerable", { kind: "resolved" }, true),
    ]);
    expect(map.listingDoor).toEqual({ runs: 3, offered: 2, nominated: 1, served: 1 });
    expect(renderCoverage(map)).toContain("**The listing door: offered on 2/3 (67%) first calls, nominated on 1/3 (33%), served on 1/3 (33%)**");
    expect(coverageMap(RUNS).listingDoor).toBeUndefined();
    expect(renderCoverage(coverageMap(RUNS))).not.toContain("The listing door");
  });

  it("an artifact filed before the repair existed renders without the line", () => {
    const map = coverageMap([run("plain-fact", "answerable", { kind: "resolved" }, true)]);
    const { repaired: _repaired, ...legacy } = map;
    expect(renderCoverage(legacy)).not.toContain("strip-assertion repair");
  });
});

describe("robustnessSummary reports whether wording moved the bucket", () => {
  it("counts only entries that carry more than one wording", () => {
    const summary = robustnessSummary([
      report("stable", "answerable", ["resolved", "resolved", "resolved"]),
      report("moved", "answerable", ["resolved", "abstained-answer"]),
      report("single", "off-domain", ["abstained-answer"]), // one wording — not measured
    ]);
    expect(summary.measured).toBe(2);
    expect(summary.stable).toBe(1);
    expect(summary.stableRate).toBe(0.5);
    expect(summary.unstable).toEqual([
      { entryId: "moved", disposition: "answerable", stages: ["resolved", "abstained-answer"] },
    ]);
  });

  it("renders the stable case as a clean pass and the unstable case as a finding", () => {
    const clean = renderRobustness(robustnessSummary([report("a", "answerable", ["resolved", "resolved"])]));
    expect(clean).toContain("1/1 intents phrasing-stable");
    expect(clean).toContain("No intent changed its funnel bucket");

    const moved = renderRobustness(
      robustnessSummary([report("b", "needs-data", ["abstained-answer", "resolved"])]),
    );
    expect(moved).toContain("Wording moved the outcome");
    expect(moved).toContain("`b`");
  });
});

describe("the gated-advisory line", () => {
  it("reports useful-or-refused apart, and only when the slice ran", () => {
    const md = renderCoverage(
      coverageMap([
        run("gate-1", "gated-advisory", { kind: "resolved" }, true),
        run("gate-2", "gated-advisory", { kind: "denied", article: "IA-5", rule: "restricted-species" }, true),
        run("gate-3", "gated-advisory", { kind: "resolved" }, false),
      ]),
    );
    expect(md).toContain("Gated questions answered usefully or refused by name: 67%");
    const without = renderCoverage(coverageMap([run("ans-1", "answerable", { kind: "resolved" }, true)]));
    expect(without).not.toContain("Gated questions");
  });
});

describe("the two R3b doors are reported when they were open, and not as zeros when they were shut", () => {
  const withDoors: BankRun[] = [
    { ...run("ans-1", "answerable", { kind: "resolved" }, true), clarified: { asked: 1, picked: 1, ignored: 0, capped: 0 }, suggestions: { shown: 2, dropped: 1 } },
    { ...run("ans-2", "answerable", { kind: "abstained-answer" }, false), clarified: { asked: 1, picked: 0, ignored: 2, capped: 0 }, suggestions: { shown: 0, dropped: 0 } },
    { ...run("data-1", "needs-data", { kind: "abstained-answer" }, true), clarified: { asked: 0, picked: 0, ignored: 0, capped: 0 }, suggestions: { shown: 0, dropped: 0 } },
  ];

  it("sums the clarification gauge and the suggestion counts over the runs that carry them", () => {
    const map = coverageMap(withDoors);
    expect(map.clarification).toEqual({ runs: 3, asked: 2, picked: 1, ignored: 2, capped: 0 });
    expect(map.suggestions).toEqual({ runs: 3, shown: 2, answersWith: 1, dropped: 1, unanswerable: 0, supplied: 0 });
  });

  it("renders each as its own line naming its condition", () => {
    const md = renderCoverage(coverageMap(withDoors));
    expect(md).toContain("**Clarification (door open on 3 run(s)):** the model asked 2 question(s) — 1 answered from the oracle, 2 held no right option");
    expect(md).toContain("**Suggestions (door open on 3 run(s)):** 2 shown on 1 certified answer(s) — 0 of them the pack's own next steps; 1 of the model's dropped, 0 of those because nothing in the records would answer them");
  });

  it("omits both when no run carried them — a shut door is not a zero", () => {
    const map = coverageMap(RUNS);
    expect(map.clarification).toBeUndefined();
    expect(map.suggestions).toBeUndefined();
    const md = renderCoverage(map);
    expect(md).not.toContain("Clarification (door open");
    expect(md).not.toContain("Suggestions (door open");
  });

  it("carries the model's questions in the ceremony line, apart from the pack's, and reads an older ceremony as zero", () => {
    const withCeremony: BankRun[] = [
      { ...run("ans-1", "answerable", { kind: "resolved" }, true), ceremony: { questions: 1, clarifications: 2, scopeCards: 0, actCards: 0 } },
      // Filed before the model could ask: no field at all.
      { ...run("ans-2", "answerable", { kind: "resolved" }, true), ceremony: { questions: 1, scopeCards: 1, actCards: 0 } as Ceremony },
    ];
    const map = coverageMap(withCeremony);
    expect(map.ceremony).toEqual({ questions: 2, clarifications: 2, scopeCards: 1, actCards: 0, resolved: 2 });
    expect(renderCoverage(map)).toContain("2 clarifying question(s), 2 advisor question(s), 1 scope card(s)");
  });
});
