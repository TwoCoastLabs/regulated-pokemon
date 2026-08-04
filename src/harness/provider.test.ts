import { describe, expect, it } from "vitest";

import { FailingProvider, ScriptedProvider, tokenEstimate, type CompletionRequest } from "./provider.js";

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

describe("ScriptedProvider", () => {
  it("returns the scripted text with a deterministic usage estimate", async () => {
    const provider = new ScriptedProvider("scripted:test", () => "a b");
    const completion = await provider.complete(request);
    expect(provider.id).toBe("scripted:test");
    expect(completion.text).toBe("a b");
    expect(completion.usage).toEqual({ promptTokens: 3, completionTokens: 2 });
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
