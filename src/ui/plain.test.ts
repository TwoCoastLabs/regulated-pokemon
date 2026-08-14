/**
 * The player's register is page copy, so it is tested like page copy: the
 * rules a live session can provoke each get a specific sentence, everything
 * else falls to its article's plain meaning, and no path ever loses the
 * formal identity (code, article title, analog) the console shows beside it.
 */

import { describe, expect, it } from "vitest";

import type { Violation } from "../kernel/contracts.js";
import { plainBinding, plainCandidate, plainStage, plainViolation } from "./plain.js";

const violation = (article: Violation["article"], rule: string): Violation => ({
  article,
  rule,
  message: `kernel message for ${rule}`,
});

describe("plainViolation", () => {
  it("gives the provocable rules their own sentence, with the formal identity intact", () => {
    const denial = plainViolation(violation("IA-2", "fact-mismatch"));
    expect(denial.plain).toBe("The Advisor stated a value that the official records contradict.");
    expect(denial.code).toBe("IA-2/fact-mismatch");
    expect(denial.articleTitle.length).toBeGreaterThan(0);
    expect(denial.analog.length).toBeGreaterThan(0);
    expect(denial.message).toBe("kernel message for fact-mismatch");

    expect(plainViolation(violation("IA-7", "unknown-action")).plain).toContain("no approved tool");
    expect(plainViolation(violation("IA-5", "restricted-species")).plain).toContain("badge count");
    expect(plainViolation(violation("IA-3", "fabricated-entity")).plain).toContain("doesn't exist");
  });

  it("falls back to the article's plain meaning for a rule it has no phrase for", () => {
    const loaderRule = plainViolation(violation("IA-6", "pack-block-digest-mismatch"));
    expect(loaderRule.plain).toBe(
      "The page didn't show exactly what the certified answer says, so it was never shown to you.",
    );
    // Every article carries a fallback, so the generic last resort is
    // unreachable through a well-formed violation — asserted by construction:
    for (const article of ["IA-1", "IA-2", "IA-3", "IA-4", "IA-5", "IA-6", "IA-7", "IA-8", "IA-9", "IA-10"] as const) {
      expect(plainViolation(violation(article, "no-such-rule")).plain).not.toContain("didn't survive");
    }
  });
});

describe("plainStage", () => {
  it("finishes the sentence for every stage", () => {
    expect(plainStage("scope")).toBe("before your question was even settled");
    expect(plainStage("answer")).toBe("before the answer could reach you");
    expect(plainStage("render")).toBe("on the page itself");
    expect(plainStage("action")).toBe("at the moment of action");
  });
});

describe("plain bindings", () => {
  it("wears the approved vocabulary casually without translating it", () => {
    expect(plainBinding("version", "red-blue")).toBe("the Red & Blue version");
    expect(plainBinding("region", "kanto")).toBe("the Kanto region");
    expect(plainBinding("badgeLevel", 8)).toBe("8 badges");
    expect(plainBinding("badgeLevel", 1)).toBe("1 badge");
    expect(plainBinding("comparisonBasis", "base-speed")).toBe("comparing by Base Speed");
  });

  it("joins a whole candidate into one readable phrase", () => {
    expect(plainCandidate({ comparisonBasis: "base-speed" })).toBe("comparing by Base Speed");
    expect(plainCandidate({ version: "red-blue", badgeLevel: 8 })).toBe("the Red & Blue version, and 8 badges");
  });
});
