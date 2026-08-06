import { describe, expect, it } from "vitest";

import {
  addUsage,
  emptyUsage,
  FailingProvider,
  ScriptedProvider,
  tokenEstimate,
  type CompletionRequest,
} from "./provider.js";

const request: CompletionRequest = {
  purpose: "scope",
  prompt: "two words here",
  hint: { scenarioId: "x" },
};

describe("tokenEstimate", () => {
  it("counts words, not characters", () => {
    expect(tokenEstimate("one two three")).toBe(3);
  });

  it("is zero for blank text, so an empty completion costs nothing", () => {
    expect(tokenEstimate("")).toBe(0);
    expect(tokenEstimate("   ")).toBe(0);
  });
});

describe("usage arithmetic", () => {
  it("starts at nothing and sums every dimension, money included", () => {
    const one = { promptTokens: 10, completionTokens: 4, calls: 1, costedCalls: 1, costUsd: 0.002 };
    const two = { promptTokens: 5, completionTokens: 2, calls: 1, costedCalls: 0, costUsd: 0 };
    expect(addUsage(addUsage(emptyUsage(), one), two)).toEqual({
      promptTokens: 15,
      completionTokens: 6,
      calls: 2,
      // One call went unpriced, and the total says so rather than implying the
      // whole run cost $0.002.
      costedCalls: 1,
      costUsd: 0.002,
    });
  });
});

describe("ScriptedProvider", () => {
  it("returns the scripted text with a deterministic usage estimate", async () => {
    const provider = new ScriptedProvider("scripted:test", () => "a b");
    const completion = await provider.complete(request);
    expect(provider.id).toBe("scripted:test");
    expect(completion.text).toBe("a b");
    // costedCalls counts it: a scripted model's zero is a price, not a silence.
    expect(completion.usage).toEqual({
      promptTokens: 3,
      completionTokens: 2,
      calls: 1,
      costedCalls: 1,
      costUsd: 0,
    });
  });

  it("passes the request through so a script can switch on it", async () => {
    const provider = new ScriptedProvider("scripted:echo", (req) => req.purpose);
    const completion = await provider.complete(request);
    expect(completion.text).toBe("scope");
  });
});

describe("FailingProvider", () => {
  it("rejects, so an outage is an error to count and never a silent empty answer", async () => {
    const provider = new FailingProvider("openrouter:down");
    await expect(provider.complete(request)).rejects.toThrow("provider unavailable");
  });

  it("carries a custom reason", async () => {
    await expect(new FailingProvider("x", "rate limited").complete(request)).rejects.toThrow("rate limited");
  });
});
