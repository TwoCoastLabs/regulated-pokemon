import { describe, expect, it } from "vitest";

import type { ScopeGrant } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import { candidateDigest } from "../kernel/scope.js";
import { proposalDigest, proposeAnswer, proposeScope } from "./advisor.js";
import { harnessWorld } from "./corpus.js";
import { ScriptedProvider } from "./provider.js";

const world = harnessWorld();
const AT = "2026-01-01T00:00:00Z";

const grant: ScopeGrant = {
  id: "grant-test",
  packId: world.pack.id,
  scope: { version: "red-blue", region: "kanto", badgeLevel: 8, comparisonBasis: "base-speed" },
  bindings: [],
  evidenceDigest: "sha256:unused",
  issuedAt: AT,
  expiresAt: "2027-01-01T00:00:00Z",
};
const context: ManifestContext = { registry: world.registry, pack: world.pack, grant, locale: "en-US", at: AT };

describe("proposeScope", () => {
  const input = {
    pack: world.pack,
    scenarioId: "s",
    transcript: [],
    missing: ["comparisonBasis"] as const,
    unmatched: ["the quickest"],
    turn: 1,
    at: AT,
  };

  it("records a decodable proposal as an untrusted event with a replayable id", async () => {
    const provider = new ScriptedProvider("m", () =>
      JSON.stringify({ candidate: { comparisonBasis: "base-speed" }, interpreting: "the quickest" }),
    );
    const step = await proposeScope({ ...input, provider });
    expect(step.event).not.toBeNull();
    expect(step.event?.id).toBe("prop-s-1");
    expect(step.event?.candidate).toEqual({ comparisonBasis: "base-speed" });
    expect(step.usage.completionTokens).toBeGreaterThan(0);
  });

  it("proposes nothing when the model's reply cannot be decoded", async () => {
    const provider = new ScriptedProvider("m", () => "gibberish");
    const step = await proposeScope({ ...input, provider });
    expect(step.event).toBeNull();
  });
});

describe("proposeAnswer", () => {
  it("decodes a usable answer into a draft", async () => {
    const provider = new ScriptedProvider("m", () =>
      JSON.stringify({
        rosters: [],
        claims: [{ kind: "recommendation", entityId: "pikachu" }],
      }),
    );
    const step = await proposeAnswer(provider, context, "s", "txn-1");
    expect(step.decode.ok).toBe(true);
  });

  it("reports an unusable answer rather than inventing one", async () => {
    const provider = new ScriptedProvider("m", () => "not json");
    const step = await proposeAnswer(provider, context, "s", "txn-1");
    expect(step.decode.ok).toBe(false);
  });
});

describe("proposalDigest", () => {
  it("is the digest the kernel checks a confirmation against", () => {
    const event = { kind: "proposal", at: AT, id: "prop-x", candidate: { version: "red-blue" }, interpreting: "w" } as const;
    expect(proposalDigest(event)).toBe(candidateDigest("prop-x", event.candidate));
  });
});
