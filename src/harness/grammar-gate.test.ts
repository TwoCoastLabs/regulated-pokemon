/**
 * The claim-kind nomination behind retrieval-gated grammar. Two things it must
 * get right: a question that *wants* a filler kind nominates it (so the schema
 * still offers it — no recall loss on legitimate counts and rules), and a
 * question that does not want one nominates nothing (so a ranking or a matchup
 * cannot decode as a `count` — the deflection block §19 exists for). Calibrated
 * against the bank's own filler-kind entries and the deflection-prone ones.
 */

import { describe, expect, it } from "vitest";

import { nominateFillerKinds } from "./grammar-gate.js";

const nominates = (question: string) => [...nominateFillerKinds(question)].sort();

describe("nominateFillerKinds offers a filler kind when the question wants it", () => {
  it("counts on a cardinality cue", () => {
    expect(nominates("How many Electric Pokemon are there?")).toContain("count");
    expect(nominates("Number of Water types?")).toContain("count");
    expect(nominates("Count the Electric Pokemon for me, please.")).toContain("count");
  });

  it("adds typeCount when the cardinality is about types", () => {
    expect(nominates("How many types of Pokemon are there?")).toContain("typeCount");
    expect(nominates("how many different types exist in Red and Blue?")).toContain("typeCount");
  });

  it("nominates gameRule for every rule the pack carries, in its bank wording", () => {
    // party-size, moves-per-pokemon, badge-count, starter-count — each intent and
    // a paraphrase, so a legitimate rule question keeps its kind.
    for (const q of [
      "How many Pokémon can I have on my team?",
      "what is the max team size?",
      "How many moves can a Pokémon know at once?",
      "how many attacks can a Pokémon have?",
      "How many Gym Badges are there in Kanto?",
      "How many starter Pokémon can I choose from?",
      // The Center's bag rules (loop 2): the bank's own wordings must nominate.
      "how many different items can I carry",
      "is there a max on how many items I can hold",
      "is there a max on how many potions I can hold",
    ]) {
      expect(nominateFillerKinds(q).has("gameRule")).toBe(true);
    }
  });
});

describe("nominateFillerKinds withholds every filler kind from a shape-vulnerable question", () => {
  it("nominates nothing for a ranking, matchup, membership, fact or lesson", () => {
    // These are exactly the entries that deflected into count/typeCount/gameRule
    // in §18; withholding the three filler kinds is what forces the right shape.
    for (const q of [
      "Which Electric Pokemon is the fastest?", // ranking
      "What is Charizard weak to?", // matchup
      "Is Gyarados a Water type?", // membership
      "What is Thunderbolt's power?", // fact (move)
      "Which TM teaches Surf?", // fact (vendored)
      "What moves can Pikachu learn?", // fact (learnset), not a count
      "What is a gym badge?", // explanation — a rule noun, but no count/limit cue
    ]) {
      expect([...nominateFillerKinds(q)]).toEqual([]);
    }
  });
});
