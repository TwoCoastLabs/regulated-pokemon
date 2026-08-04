import { beforeAll, describe, expect, it } from "vitest";

import type { Claim } from "../kernel/contracts.js";
import { computeEnforcement, computeHealth, computeMetrics, computeUsefulness } from "./metrics.js";
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
    expect(use.scenarios).toBe(2);
    expect(use.answered).toBe(1);
    expect(use.unresolved).toBe(1);
    expect(use.resolutionRate).toBe(0.5);
    expect(use.abstentionRate).toBe(0.5);
    expect(use.avgTurnsToAnswer).toBe(1);
  });

  it("is all zeros for a model that ran nothing, without dividing by zero", () => {
    const use = computeUsefulness("scripted:ghost", []);
    expect(use).toMatchObject({ scenarios: 0, resolutionRate: 0, abstentionRate: 0, avgTurnsToAnswer: 0 });
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

describe("computeMetrics", () => {
  it("assembles the split and flags that an adversary was present", () => {
    const metrics = computeMetrics(world, SCENARIOS, modelList, allRuns);
    expect(metrics.adversaryPresent).toBe(true);
    expect(metrics.usefulness).toHaveLength(3);
    expect(metrics.health).toHaveLength(3);
  });
});
