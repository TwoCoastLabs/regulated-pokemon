import { beforeAll, describe, expect, it } from "vitest";

import type { Claim } from "../kernel/contracts.js";
import {
  computeCost,
  computeEnforcement,
  computeGateRecall,
  computeHealth,
  computeMetrics,
  computeUsefulness,
} from "./metrics.js";
import { harnessWorld, models, type Scenario, SCENARIOS } from "./corpus.js";
import type { HarnessRun } from "./run.js";
import { runScenario } from "./run.js";

const world = harnessWorld();
const modelList = models(world);
const provider = (id: string) => modelList.find((model) => model.provider.id === id)!.provider;
const BASICS = SCENARIOS.find((entry) => entry.id === "basics") as Scenario;

let allRuns: HarnessRun[];
let strongBasics: HarnessRun;

beforeAll(async () => {
  allRuns = [];
  for (const model of modelList) {
    for (const scenario of SCENARIOS) allRuns.push(await runScenario(world, scenario, model.provider));
  }
  strongBasics = await runScenario(world, BASICS, provider("scripted:strong"));
});

describe("computeEnforcement — checked, not asserted", () => {
  it("re-verifies every committed answer to zero, and records the denials the gate fired", () => {
    const enforcement = computeEnforcement(world, SCENARIOS, allRuns);
    expect(enforcement.committedViolations).toBe(0);
    expect(enforcement.committedWrongScope).toBe(0);
    expect(enforcement.answered).toBeGreaterThan(0);
    expect(enforcement.blockedDenials.length).toBeGreaterThan(0);
    expect(enforcement.blockedDenials.every((code) => code.startsWith("IA-"))).toBe(true);
  });

  it("exercises more than one article: restricted species and fabrication both fire", () => {
    // The corpus is not a single trick. The adversary trips a different article
    // per scenario, so a gate that only caught fact-mismatches would be seen to
    // pass here and still be missing IA-5 and IA-3.
    const fired = new Set(computeEnforcement(world, SCENARIOS, allRuns).blockedDenials);
    expect(fired).toContain("IA-5/restricted-species");
    expect(fired).toContain("IA-3/fabricated-entity");
  });

  it("attributes each denial to the model that provoked it", () => {
    const enforcement = computeEnforcement(world, SCENARIOS, allRuns);
    // The adversary is the one attacking, so it is the one that must be seen
    // making the gate fire — "somebody was denied" is not the same claim.
    expect(enforcement.blockedByProvider["scripted:adversarial"]?.length).toBeGreaterThan(0);
    expect(enforcement.blockedByProvider["scripted:strong"]).toBeUndefined();
  });

  it("catches a committed answer that fails independent re-verification", () => {
    const tampered: HarnessRun = {
      ...strongBasics,
      transaction: {
        ...strongBasics.transaction!,
        manifest: {
          ...strongBasics.transaction!.manifest!,
          claims: strongBasics.transaction!.manifest!.claims.map((claim: Claim) =>
            claim.kind === "fact" ? { ...claim, asserted: { kind: "number", value: 999 } } : claim,
          ),
        },
      },
    };
    expect(computeEnforcement(world, SCENARIOS, [tampered]).committedViolations).toBe(1);
  });

  it("catches a committed answer whose bound scope disagrees with the trainer's truth", () => {
    const wrongScope: HarnessRun = { ...strongBasics, grantScope: { ...strongBasics.grantScope!, version: "yellow" } };
    expect(computeEnforcement(world, SCENARIOS, [wrongScope]).committedWrongScope).toBe(1);
  });

  it("counts an answered run with no bound scope as wrong-scope, never as fine", () => {
    const { grantScope: _dropped, ...noScope } = strongBasics;
    expect(computeEnforcement(world, SCENARIOS, [noScope]).committedWrongScope).toBe(1);
  });
});

describe("computeUsefulness — empirical, per model", () => {
  it("splits answered, denied and unresolved into rates and turns", () => {
    const runs = allRuns.filter((run) => run.providerId === "scripted:weak");
    const use = computeUsefulness("scripted:weak", runs);
    // The weak model resolves every scenario but the ladder, which stays
    // unresolved — so its rates are (n-1)/n and 1/n, whatever the corpus size.
    const n = SCENARIOS.length;
    expect(use.runs).toBe(n);
    expect(use.answered).toBe(n - 1);
    expect(use.unresolved).toBe(1);
    expect(use.resolutionRate).toBeCloseTo((n - 1) / n);
    expect(use.abstentionRate).toBeCloseTo(1 / n);
    expect(use.avgTurnsToAnswer).toBe(1);
  });

  it("is all zeros for a model that ran nothing, without dividing by zero", () => {
    const use = computeUsefulness("scripted:ghost", []);
    expect(use).toMatchObject({ runs: 0, resolutionRate: 0, abstentionRate: 0, avgTurnsToAnswer: 0 });
  });
});

describe("computeHealth — outages counted, never averaged", () => {
  it("is clean when no call failed", () => {
    const runs = allRuns.filter((run) => run.providerId === "scripted:strong");
    expect(computeHealth("scripted:strong", runs)).toMatchObject({ providerErrors: 0, allFailed: false });
  });

  it("flags a provider whose every run hit an infrastructure failure", () => {
    const failed: HarnessRun[] = [
      { ...strongBasics, providerErrors: 1 },
      { ...strongBasics, providerErrors: 2 },
    ];
    expect(computeHealth("scripted:down", failed).allFailed).toBe(true);
  });
});

describe("computeCost — money, in its own section", () => {
  it("sums a model's usage and calls a scripted run fully priced", () => {
    const runs = allRuns.filter((run) => run.providerId === "scripted:strong");
    const cost = computeCost("scripted:strong", runs);
    expect(cost.usage.calls).toBeGreaterThan(0);
    expect(cost.usage.costUsd).toBe(0);
    expect(cost.fullyPriced).toBe(true);
  });

  it("reports a total as a floor when the provider left a call unpriced", () => {
    const unpriced: HarnessRun = {
      ...strongBasics,
      usage: { promptTokens: 1, completionTokens: 1, calls: 2, costedCalls: 1, costUsd: 0.01 },
    };
    expect(computeCost("live:strong", [unpriced]).fullyPriced).toBe(false);
  });
});

describe("computeGateRecall — what the front door routed, before any model", () => {
  it("shows the ladder scenario escalating one dimension, with the wording it hands over", () => {
    const gate = computeGateRecall(world, SCENARIOS).find((entry) => entry.scenarioId === "basis-ladder")!;
    // The three plain dimensions come from the trainer's own words; the
    // comparison basis is the one the model must interpret.
    expect(gate.boundDirectly).toEqual(["version", "region", "badgeLevel"]);
    expect(gate.escalated).toEqual(["comparisonBasis"]);
    expect(gate.resolvedWithoutModel).toBe(false);
    // The question really is routed to the model, not silently dropped — this is
    // the number measured instead of assumed.
    expect(gate.unmatched.some((wording) => wording.includes("quickest"))).toBe(true);
  });

  it("shows the plain scenario resolving without ever engaging the model for scope", () => {
    const gate = computeGateRecall(world, SCENARIOS).find((entry) => entry.scenarioId === "basics")!;
    expect(gate.boundDirectly).toEqual(["version", "region", "badgeLevel"]);
    expect(gate.escalated).toEqual([]);
    expect(gate.resolvedWithoutModel).toBe(true);
  });

  it("is a property of the corpus, not the model — same recall whichever runs", () => {
    // Model-independent by construction: it reads the fixed opening, not runs.
    expect(computeGateRecall(world, SCENARIOS)).toEqual(computeMetrics(world, SCENARIOS, modelList, allRuns).gate);
  });
});

describe("computeMetrics", () => {
  it("assembles the split and names the adversary that must be seen to fail", () => {
    const metrics = computeMetrics(world, SCENARIOS, modelList, allRuns);
    expect(metrics.adversaries).toEqual(["scripted:adversarial"]);
    expect(metrics.usefulness).toHaveLength(3);
    expect(metrics.health).toHaveLength(3);
    expect(metrics.cost).toHaveLength(3);
    expect(metrics.gate).toHaveLength(SCENARIOS.length);
  });
});
