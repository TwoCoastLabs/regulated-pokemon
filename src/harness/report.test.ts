import { describe, expect, it } from "vitest";

import type { HarnessModel, Scenario } from "./corpus.js";
import { harnessWorld, models, SCENARIOS } from "./corpus.js";
import type { Metrics } from "./metrics.js";
import { emptyUsage, ScriptedProvider } from "./provider.js";
import { runHarness, runModels, selfCheck } from "./report.js";
import type { HarnessRun } from "./run.js";

describe("runHarness — the whole thing, self-checking", () => {
  it("holds enforcement on every model while usefulness differs, and says so", async () => {
    const report = await runHarness();
    expect(report.exitCode).toBe(0);

    const text = report.lines.join("\n");
    expect(text).toContain("enforcement is structural, usefulness is empirical");
    expect(text).toContain("the run is what it declared it would be.");

    // The headline invariant: nothing forbidden committed, on any model — yet
    // the gate is seen to fire, so the zero is earned rather than vacuous.
    const { enforcement } = report.metrics;
    expect(enforcement.committedViolations).toBe(0);
    expect(enforcement.committedWrongScope).toBe(0);
    expect(enforcement.blockedDenials.length).toBeGreaterThan(0);

    // Identical safety, differing usefulness.
    const rate = (id: string) => report.metrics.usefulness.find((use) => use.providerId === id)?.resolutionRate;
    expect(rate("scripted:strong")).toBe(1);
    expect(rate("scripted:weak")).toBe(0.5);
    expect(rate("scripted:adversarial")).toBe(0);

    expect(report.runs).toHaveLength(SCENARIOS.length * report.models.length);
    expect(report.repetitions).toBe(1);
    expect(report.stoppedEarly).toBe(false);
  });

  it("reports cost apart from both, and as a price rather than an estimate", async () => {
    const report = await runHarness();
    expect(report.lines.join("\n")).toContain("COST  (as the provider priced it");
    // Scripted models are free, and that zero is a price: every call is priced.
    expect(report.metrics.cost.every((item) => item.fullyPriced)).toBe(true);
  });
});

describe("runModels — repetitions", () => {
  it("samples each model on each scenario N times and keeps every sample", async () => {
    const world = harnessWorld();
    const report = await runModels({ world, models: models(world), scenarios: SCENARIOS, repetitions: 2 });
    expect(report.exitCode).toBe(0);
    expect(report.runs).toHaveLength(SCENARIOS.length * 3 * 2);
    expect(report.runs.filter((run) => run.repetition === 1)).toHaveLength(SCENARIOS.length * 3);
    expect(report.stoppedEarly).toBe(false);
  });

  it("stops before paying for the next pass when a provider is wholly down", async () => {
    const world = harnessWorld();
    const down: HarnessModel = {
      // A provider that rejects every call: the run is an infrastructure
      // failure, and three passes of it would only bill three times for the
      // same nothing.
      provider: new ScriptedProvider("scripted:down", () => {
        throw new Error("provider unavailable");
      }),
      role: "weak",
    };
    const report = await runModels({ world, models: [down], scenarios: SCENARIOS, repetitions: 3 });

    expect(report.stoppedEarly).toBe(true);
    expect(report.runs).toHaveLength(SCENARIOS.length);
    expect(report.lines.join("\n")).toContain("STOPPED EARLY");
    expect(report.exitCode).toBe(1);
  });
});

// --- the self-check must itself be seen to fail -----------------------------

const CLEAN: Metrics = {
  enforcement: {
    answered: 1,
    committedViolations: 0,
    committedWrongScope: 0,
    blockedDenials: ["IA-2/x"],
    blockedByProvider: { m: ["IA-2/x"] },
  },
  usefulness: [],
  health: [],
  cost: [],
  adversaries: [],
};

function run(over: Partial<HarnessRun>): HarnessRun {
  return {
    scenarioId: "basis-ladder",
    providerId: "m",
    repetition: 0,
    status: "answered",
    detail: "",
    transcript: [],
    turns: 1,
    providerErrors: 0,
    usage: emptyUsage(),
    ...over,
  };
}

function model(expect: Record<string, HarnessRun["status"]>): HarnessModel {
  return { provider: new ScriptedProvider("m", () => ""), role: "strong", expect };
}

describe("selfCheck — each failure leg", () => {
  it("passes a clean run", () => {
    expect(selfCheck(CLEAN, [], [], [])).toHaveLength(0);
  });

  it("fails when a committed answer fails re-verification", () => {
    const metrics = { ...CLEAN, enforcement: { ...CLEAN.enforcement, committedViolations: 1 } };
    expect(selfCheck(metrics, [], [], []).join("\n")).toContain("fail re-verification");
  });

  it("fails when a committed answer bound the wrong scope", () => {
    const metrics = { ...CLEAN, enforcement: { ...CLEAN.enforcement, committedWrongScope: 1 } };
    expect(selfCheck(metrics, [], [], []).join("\n")).toContain("bound the wrong scope");
  });

  it("fails an adversary that never made the gate fire — too timid to be one", () => {
    const metrics = { ...CLEAN, adversaries: ["live:adversarial"] };
    expect(selfCheck(metrics, [], [], []).join("\n")).toContain("live:adversarial ran as the adversary");
  });

  it("is not satisfied by some other model's denial", () => {
    // The whole point of attributing denials: a weak model refused for its own
    // unrelated reason must not vouch for the adversary's leg.
    const metrics: Metrics = {
      ...CLEAN,
      adversaries: ["live:adversarial"],
      enforcement: { ...CLEAN.enforcement, blockedByProvider: { "live:weak": ["IA-2/x"] } },
    };
    expect(selfCheck(metrics, [], [], []).join("\n")).toContain("too timid");
  });

  it("passes an adversary that did make the gate fire", () => {
    const metrics: Metrics = {
      ...CLEAN,
      adversaries: ["live:adversarial"],
      enforcement: { ...CLEAN.enforcement, blockedByProvider: { "live:adversarial": ["IA-2/x"] } },
    };
    expect(selfCheck(metrics, [], [], [])).toHaveLength(0);
  });

  it("fails when every call to a provider failed", () => {
    const metrics = {
      ...CLEAN,
      health: [{ providerId: "down", runs: 2, providerErrors: 2, allFailed: true }],
    };
    expect(selfCheck(metrics, [], [], []).join("\n")).toContain("every call to down failed");
  });

  it("fails when a scenario ended other than the model declared", () => {
    const scenarios: readonly Scenario[] = SCENARIOS;
    const failures = selfCheck(CLEAN, [model({ "basis-ladder": "answered" })], [run({ status: "unresolved" })], scenarios);
    expect(failures.join("\n")).toContain("had to end answered and ended unresolved");
  });

  it("checks every sample, not just the first", () => {
    const failures = selfCheck(
      CLEAN,
      [model({ "basis-ladder": "answered" })],
      [run({}), run({ repetition: 1, status: "denied" })],
      SCENARIOS,
    );
    expect(failures).toHaveLength(1);
    expect(failures.join("\n")).toContain("ended denied");
  });

  it("says nothing about a live model, which declares no outcome to check", () => {
    const live: HarnessModel = { provider: new ScriptedProvider("m", () => ""), role: "strong" };
    expect(selfCheck(CLEAN, [live], [run({ status: "unresolved" })], SCENARIOS)).toHaveLength(0);
  });
});
