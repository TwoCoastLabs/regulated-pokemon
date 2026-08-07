import { describe, expect, it } from "vitest";

import { harnessWorld } from "./corpus.js";
import { certifiedReference } from "./reference.js";

const world = harnessWorld();
const reference = certifiedReference(world.registry);

describe("certifiedReference — the facts, all of them", () => {
  it("carries the stats a fact or ranking would cite", () => {
    // Pikachu's speed is 90; the model should read it here, not recall it.
    expect(reference).toMatch(/pikachu \| 25 \| electric \| - \| .*\b90\b/);
  });

  it("carries move facts, so a question about a move can be grounded too", () => {
    expect(reference).toMatch(/thunderbolt \| electric \| 95/);
  });

  it("carries learnsets, so a count over a move is a thing the model can enumerate", () => {
    // Forty-two species learn Surf — the hard-count answer, now countable rather
    // than recalled.
    const learners = reference.split("\n").filter((line) => /^[a-z0-9-]+: .*\bsurf\b/.test(line));
    expect(learners).toHaveLength(42);
  });

  it("is a pure function of the snapshot — same bytes in, same bytes out", () => {
    expect(certifiedReference(world.registry)).toBe(reference);
  });
});

describe("certifiedReference — facts, never policy (the load-bearing line)", () => {
  it("states rarity as a fact, because rarity is in the registry", () => {
    // Mewtwo is legendary; that is a certified fact and belongs here.
    expect(reference).toMatch(/mewtwo \| \d+ \| psychic \| legendary \|/);
  });

  it("leaks no eligibility or disclosure policy — that lives in the pack, not the registry", () => {
    // The whole point: a grounded model can read that Mewtwo is legendary and
    // still not know a two-badge trainer may not be recommended it, so IA-5
    // stays enforceable. None of the pack's policy vocabulary may appear.
    for (const policy of ["minimumBadgeLevel", "badge", "acquisition", "irreversible", "disclosure", "IA-"]) {
      expect(reference).not.toContain(policy);
    }
  });
});
