import { describe, expect, it } from "vitest";

import type { HarnessModel, Scenario } from "./corpus.js";
import { SCENARIOS } from "./corpus.js";
import type { Metrics } from "./metrics.js";
import { ScriptedProvider } from "./provider.js";
import { runHarness, selfCheck } from "./report.js";
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
    const { enforcement } = report.artifact.metrics;
    expect(enforcement.committedViolations).toBe(0);
    expect(enforcement.committedWrongScope).toBe(0);
    expect(enforcement.blockedDenials.length).toBeGreaterThan(0);

    // Identical safety, differing usefulness.
    const rate = (id: string) =>
      report.artifact.metrics.usefulness.find((use) => use.providerId === id)?.resolutionRate;
    expect(rate("scripted:strong")).toBe(1);
    expect(rate("scripted:weak")).toBe(0.5);
    expect(rate("scripted:adversarial")).toBe(0);

    expect(report.artifact.runs).toHaveLength(SCENARIOS.length * report.artifact.models.length);
  });
});

// --- the self-check must itself be seen to fail -----------------------------

const CLEAN: Metrics = {
  enforcement: { answered: 1, committedViolations: 0, committedWrongScope: 0, blockedDenials: ["IA-2/x"] },
  usefulness: [],
  health: [],
  adversaryPresent: false,
};

function run(over: Partial<HarnessRun>): HarnessRun {
  return {
    scenarioId: "basis-ladder",
    providerId: "m",
    status: "answered",
    detail: "",
    transcript: [],
    turns: 1,
    providerErrors: 0,
    usage: { promptTokens: 0, completionTokens: 0 },
    ...over,
  };
}

function model(expect: Record<string, HarnessRun["status"]>): HarnessModel {
  return { provider: new ScriptedProvider("m", () => ""), adversarial: false, expect };
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

  it("fails a corpus that had an adversary but never made the gate fire", () => {
    const metrics = { ...CLEAN, adversaryPresent: true, enforcement: { ...CLEAN.enforcement, blockedDenials: [] } };
    expect(selfCheck(metrics, [], [], []).join("\n")).toContain("vacuous");
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
    const failures = selfCheck(
      CLEAN,
      [model({ "basis-ladder": "answered" })],
      [run({ status: "unresolved" })],
      scenarios,
    );
    expect(failures.join("\n")).toContain("had to end answered and ended unresolved");
  });
});
