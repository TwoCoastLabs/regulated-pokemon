import { describe, expect, it } from "vitest";

import { harnessWorld, models, type Scenario, SCENARIOS } from "./corpus.js";
import { FailingProvider, ScriptedProvider } from "./provider.js";
import { runScenario } from "./run.js";

const world = harnessWorld();
const modelList = models(world);
const provider = (id: string) => modelList.find((model) => model.provider.id === id)!.provider;
const scenario = (id: string): Scenario => SCENARIOS.find((entry) => entry.id === id)!;

const LADDER = scenario("basis-ladder");
const BASICS = scenario("basics");

describe("runScenario — the three landing outcomes", () => {
  it("reaches a certified answer when the model interprets and answers well", async () => {
    const run = await runScenario(world, LADDER, provider("scripted:strong"));
    expect(run.status).toBe("answered");
    // one ladder turn plus the answer.
    expect(run.turns).toBe(2);
    expect(run.grantScope?.comparisonBasis).toBe("base-speed");
    expect(run.proposedClaims).toBeDefined();
    expect(run.transaction?.outcome.status).toBe("answered");
  });

  it("answers a plain question in a single turn, no ladder", async () => {
    const run = await runScenario(world, BASICS, provider("scripted:strong"));
    expect(run.status).toBe("answered");
    expect(run.turns).toBe(1);
  });

  it("abstains rather than guessing when it cannot interpret the wording", async () => {
    const run = await runScenario(world, LADDER, provider("scripted:weak"));
    expect(run.status).toBe("unresolved");
    expect(run.turns).toBe(3); // spent the whole scope budget being refused
    expect(run.transaction).toBeUndefined();
  });

  it("is denied at the answer stage when it fabricates a fact", async () => {
    const run = await runScenario(world, LADDER, provider("scripted:adversarial"));
    expect(run.status).toBe("denied");
    expect(run.transaction?.outcome.status).toBe("denied");
  });
});

describe("runScenario — infrastructure and empty replies are not answers", () => {
  it("counts a provider failure during scope, separately from an abstention", async () => {
    const run = await runScenario(world, LADDER, new FailingProvider("down"));
    expect(run.status).toBe("unresolved");
    expect(run.providerErrors).toBe(1);
    expect(run.detail).toContain("scope resolution");
  });

  it("counts a provider failure while producing the answer, keeping the scope it reached", async () => {
    const run = await runScenario(world, BASICS, new FailingProvider("down"));
    expect(run.status).toBe("unresolved");
    expect(run.providerErrors).toBe(1);
    expect(run.detail).toContain("producing the answer");
    expect(run.grantScope).toBeDefined();
  });

  it("treats an undecodable scope reply as a fail-closed abstention", async () => {
    const run = await runScenario(world, LADDER, new ScriptedProvider("m", () => "gibberish"));
    expect(run.status).toBe("unresolved");
    expect(run.detail).toContain("nothing usable for scope");
  });

  it("treats an empty answer as no answer, never a partial release", async () => {
    // Scope needs no ladder here, so the first (and only) call is the answer.
    const run = await runScenario(world, BASICS, new ScriptedProvider("m", () => ""));
    expect(run.status).toBe("unresolved");
    expect(run.detail).toContain("no usable answer");
    expect(run.grantScope).toBeDefined();
  });
});
