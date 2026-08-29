import { describe, expect, it } from "vitest";

import { harnessWorld } from "./corpus.js";
import { certifiedReference, RETRIEVAL_LEXICON, RETRIEVAL_SPECIES_CAP, retrievalSelection, retrieveReference } from "./reference.js";
import { centerRegistry, kantoRegistry } from "../testing/fixtures.js";

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

describe("retrieval recall for set and advice questions (Center loop 2)", () => {
  // The loop-2 linking instrument's finding, pinned as its fix: these bank
  // wordings retrieved ZERO rows in the loop-1 build — "poisoned" did not stem
  // to poison, "vending machine drinks" names no id, "potions" no category —
  // and the grounded model, handed nothing, honestly abstained. Wordings are
  // read from the shipped bank so the pin tracks the questions actually asked.
  const registry = centerRegistry();
  const rows = (question: string) => {
    const selection = retrievalSelection(registry, question);
    return new Set([...selection.species, ...selection.moves, ...selection.items]);
  };

  it("pins every lexicon id to the world that uses it", () => {
    for (const entry of RETRIEVAL_LEXICON) {
      for (const id of entry.items) {
        expect(registry.findItem(id), `${entry.phrase} names unknown item ${id}`).toBeDefined();
      }
    }
  });

  it("links the formerly zero-row wordings", () => {
    expect(rows("are the vending machine drinks as good as potions").has("lemonade")).toBe(true);
    expect(rows("which of the X items can I actually use in battle").has("x-attack")).toBe(true);
    expect(rows("what evolution stones exist in this game").has("thunder-stone")).toBe(true);
    expect(rows("how many kinds of potion are there").has("hyper-potion")).toBe(true);
    expect(rows("my pokemon is poisoned and nearly dead, what do I buy").has("antidote")).toBe(true);
    expect(rows("what ball should I use on an abra, it keeps teleporting").has("great-ball")).toBe(true);
  });

  it("stems every condition inflection to its curing items", () => {
    expect(rows("my pikachu got burned, help").has("burn-heal")).toBe(true);
    expect(rows("charmander is frozen solid").has("ice-heal")).toBe(true);
    expect(rows("my pokemon is paralyzed").has("paralyze-heal")).toBe(true);
    expect(rows("it fell asleep in battle").has("awakening")).toBe(true);
    expect(rows("snorlax seems confused").has("full-heal")).toBe(true);
  });

  it("keeps the frozen world unmoved — no lexicon id exists there, so nothing matches", () => {
    const kanto = kantoRegistry();
    const selection = retrievalSelection(kanto, "are the vending machine drinks as good as potions");
    expect(selection.items.size).toBe(0);
  });
});
