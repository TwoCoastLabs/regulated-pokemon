/**
 * The lesson door's two matchers, unit by unit (docs/lesson-door.md). The
 * numbers each produces on the held-out set are pinned in activation.test;
 * this file pins the mechanics — the fold, the stop words, the typo rule,
 * the normalised score, the policy — so a number that moves can be traced
 * to the piece that moved it.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import { aliasOffer, askWords, BM25_K, BM25_THRESHOLD, bm25Offer, bm25Share, bothOffer, foldAsk, lessonOffer, phrasingsOf, words } from "./lesson-matcher.js";

const world = harnessWorld();
const BOUNDARY = "what-the-records-hold";

describe("folding the ask", () => {
  it("lowers case, strips accents, straightens apostrophes, collapses space", () => {
    expect(foldAsk("  What’s a  Poké Ball?\n")).toBe("what's a poke ball?");
  });

  it("splits words and drops possessives", () => {
    expect(words("What are a Pokémon's attacks?")).toEqual(["what", "are", "a", "pokemon", "attacks"]);
  });
});

describe("the alias matcher", () => {
  it("matches a declared phrasing as a whole phrase and applies the policy", () => {
    expect(aliasOffer(world, "What is a Gym Leader?").offered).toEqual(["what-is-gym-leader", BOUNDARY]);
    expect(aliasOffer(world, "Who is the Pewter City gym leader?").offered).toEqual([BOUNDARY]);
  });

  it("expands a concept lesson's nouns through the pack's shared forms, with the article chosen by the noun", () => {
    const lesson = world.pack.curriculum.find((entry) => entry.id === "what-is-evolution")!;
    const phrasings = phrasingsOf(world.pack, lesson);
    expect(phrasings).toContain("what is evolution");
    expect(phrasings).toContain("what is an evolution");
    expect(phrasings).toContain("explain evolving");
    expect(phrasings).toContain("how does evolution work");
    // The literal aliases survive beside the expansion.
    expect(phrasings).toContain("what does it mean to evolve");
    expect(aliasOffer(world, "Can you explain evolution?").offered).toEqual(["what-is-evolution", "what-the-records-hold"]);
  });

  it("expands an orientation lesson's own forms over the pack's topics", () => {
    const lesson = world.pack.curriculum.find((entry) => entry.id === "is-it-hard")!;
    const phrasings = phrasingsOf(world.pack, lesson);
    expect(phrasings).toContain("is this game hard");
    expect(phrasings).toContain("how difficult is the game");
    expect(phrasings).toContain("first-timer");
    expect(aliasOffer(world, "How difficult is the game really?").offered).toEqual(["is-it-hard", "what-the-records-hold"]);
  });

  it("expands nothing for a pack without shared forms — literal aliases alone", () => {
    const { lessonAskForms: _forms, ...bare } = world.pack;
    const lesson = bare.curriculum.find((entry) => entry.id === "what-is-evolution")!;
    expect(phrasingsOf(bare, lesson)).toEqual(lesson.covers!.aliases.map(foldAsk));
  });

  it("does not match inside a longer word", () => {
    // "what is a type" is an alias; "typewriter" must not trigger it.
    expect(aliasOffer(world, "what is a typewriter").offered).toEqual([BOUNDARY]);
  });

  it("offers every lesson on a pack that declares no coverage, and says so", () => {
    const bare = { pack: { ...world.pack, curriculum: world.pack.curriculum.map(({ covers: _covers, ...lesson }) => lesson) } };
    const offer = aliasOffer(bare, "What is a Gym Leader?");
    expect(offer.offered).toHaveLength(24);
    expect(offer.reason).toContain("declares no lesson coverage");
  });
});

describe("the BM25 matcher's mechanics", () => {
  it("drops stop words from the corpus and from the pack's question-word markers, and keeps content", () => {
    // "what", "is", "a" are marker or corpus stop words; "pokemon" is in 20
    // of 24 lessons; "gym" and "leader" are content.
    expect(askWords(world.pack, "What is a Gym Leader?")).toEqual(["gym", "leader"]);
    expect(askWords(world.pack, "What is a Pokémon?")).toEqual([]);
  });

  it("reads a misspelling as its one vocabulary neighbour within an edit, first letter kept", () => {
    expect(askWords(world.pack, "how do i cath a pokemon")).toContain("catch");
    expect(askWords(world.pack, "what is a gym badg")).toContain("badge");
    // Three letters: never folded.
    expect(askWords(world.pack, "whats this game evn about")).not.toContain("even");
  });

  it("scores on a normalised scale and puts the titled lesson first on a definitional ask", () => {
    const shares = world.pack.curriculum.map((lesson, index) => ({ id: lesson.id, share: bm25Share(world.pack, "What is a Gym Leader?", index) }));
    const best = [...shares].sort((a, b) => b.share - a.share)[0]!;
    expect(best.id).toBe("what-is-gym-leader");
    expect(best.share).toBeGreaterThan(BM25_THRESHOLD);
    expect(best.share).toBeLessThanOrEqual(1);
    // An ask with no indexable words scores 0 against everything.
    expect(shares.every((entry) => bm25Share(world.pack, "What is a Pokémon?", world.pack.curriculum.findIndex((l) => l.id === entry.id)) === 0)).toBe(true);
  });

  it("offers at most k lessons beside the boundary, the boundary always, the boundary never scored", () => {
    const offer = bm25Offer(world, "Who is the Pewter City gym leader?");
    expect(offer.offered).toContain(BOUNDARY);
    expect(offer.offered.length).toBeLessThanOrEqual(BM25_K + 1);
    expect(offer.reason).toContain("%");
  });

  it("says when nothing scored", () => {
    const offer = bm25Offer(world, "What is a Pokémon?");
    expect(offer.offered).toEqual([BOUNDARY]);
    expect(offer.reason).toContain("no lesson's text explains");
  });
});

describe("the union and the switch", () => {
  it("offers what either matcher offers, the policy applied once", () => {
    const alias = new Set(aliasOffer(world, "how do i cath a pokemon").offered);
    const bm25 = new Set(bm25Offer(world, "how do i cath a pokemon").offered);
    const both = bothOffer(world, "how do i cath a pokemon");
    expect(alias.has("how-catch")).toBe(false);
    expect(bm25.has("how-catch")).toBe(true);
    expect(both.offered).toContain("how-catch");
    expect(both.offered).toContain(BOUNDARY);
  });

  it("dispatches by id, alias by default", () => {
    expect(lessonOffer("alias", world, "What is a Gym Leader?")).toEqual(aliasOffer(world, "What is a Gym Leader?"));
    expect(lessonOffer("bm25", world, "What is a Gym Leader?")).toEqual(bm25Offer(world, "What is a Gym Leader?"));
    expect(lessonOffer("both", world, "What is a Gym Leader?")).toEqual(bothOffer(world, "What is a Gym Leader?"));
  });
});
