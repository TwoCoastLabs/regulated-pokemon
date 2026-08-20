import { describe, expect, it } from "vitest";

import { harnessWorld } from "./corpus.js";
import { certifiedReference, RETRIEVAL_SPECIES_CAP, retrieveReference } from "./reference.js";

const world = harnessWorld();
const reference = certifiedReference(world.registry);

/** The species rows of a reference block — `id | dex | ...` — for counting. */
const speciesRows = (block: string): string[] => block.split("\n").filter((line) => /^[a-z0-9-]+ \| \d+ \| /.test(line));

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

describe("retrieveReference — only the facts a question needs", () => {
  it("a named species pulls its row and nothing unrelated", () => {
    const block = retrieveReference(world.registry, "What's Pikachu's Speed stat?");
    expect(speciesRows(block)).toHaveLength(1);
    expect(block).toMatch(/pikachu \| 25 \| electric \| - \| .*\b90\b/); // the stat is there
    expect(block).not.toMatch(/\bmachamp\b/); // an unnamed species is not
    // Dramatically shorter than the whole registry — the point of the exercise.
    expect(block.length).toBeLessThan(reference.length / 5);
  });

  it("a named type pulls that type's whole membership — the evidence a ranking rests on", () => {
    const block = retrieveReference(world.registry, "Which Electric Pokemon is the fastest?");
    const ids = speciesRows(block).map((line) => line.split(" ")[0]!);
    expect(ids).toContain("pikachu");
    expect(ids).toContain("raichu");
    expect(ids).toContain("zapdos");
    // Every retrieved species is actually Electric — retrieval did not overreach.
    for (const id of ids) expect(world.registry.findSpecies(id)?.types).toContain("electric");
    expect(ids).not.toContain("machamp");
  });

  it("a named move pulls the move and the species that can learn it", () => {
    const block = retrieveReference(world.registry, "Which Pokemon can learn Surf?");
    expect(block).toMatch(/surf \| water \|/); // the move's own row
    expect(speciesRows(block).length).toBeGreaterThan(1); // its learners, capped
  });

  it("a meta question with no entity retrieves no species facts", () => {
    const block = retrieveReference(world.registry, "What is a gym badge?");
    expect(speciesRows(block)).toHaveLength(0);
  });

  it("never exceeds the species cap, and is a pure function of the question", () => {
    // "normal" and "water" together are the two largest Kanto types; the cap holds.
    const broad = retrieveReference(world.registry, "list every normal and water and flying and poison pokemon");
    expect(speciesRows(broad).length).toBeLessThanOrEqual(RETRIEVAL_SPECIES_CAP);
    expect(retrieveReference(world.registry, "What's Pikachu's Speed stat?")).toBe(
      retrieveReference(world.registry, "What's Pikachu's Speed stat?"),
    );
  });

  it("carries the same 'facts, never policy' guarantee as the full block", () => {
    const block = retrieveReference(world.registry, "Is Mewtwo legendary?");
    expect(block).toMatch(/mewtwo \| \d+ \| psychic \| legendary \|/);
    for (const policy of ["minimumBadgeLevel", "acquisition", "disclosure", "IA-"]) {
      expect(block).not.toContain(policy);
    }
  });
});
