/**
 * The coverage aggregation, over hand-built runs — so the two guarded cases
 * (the enforcement escalation surfaced at the top, the friction tail) are
 * asserted directly rather than coaxed out of a live session.
 */

import { describe, expect, it } from "vitest";

import type { BankRun, IntentRobustness } from "./bank-run.js";
import { coverageMap, renderCoverage, renderRobustness, robustnessSummary } from "./coverage.js";
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
    expect(md).toContain("Honest-refusal rate on unanswerable questions: 100%");
    expect(md).toContain("`ans-3` — 9 turns");
  });

  it("omits the honest-refusal line when the slice has no unanswerable questions", () => {
    const md = renderCoverage(coverageMap([run("ans-1", "answerable", { kind: "resolved" }, true)]));
    expect(md).toContain("Answerable resolution rate: 100%");
    expect(md).not.toContain("Honest-refusal rate");
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

// --- robustness -------------------------------------------------------------

function report(entryId: string, disposition: Disposition, stageKinds: FunnelStage["kind"][]): IntentRobustness {
  const phrasings = stageKinds.map((kind, index) => ({
    text: `phrasing ${index}`,
    stage: (kind === "denied" ? { kind, article: "IA-5", rule: "restricted-species" } : { kind }) as FunnelStage,
    pass: true,
  }));
  return { entryId, disposition, phrasings, runs: [], stable: new Set(stageKinds).size === 1 };
}

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
