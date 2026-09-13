/**
 * The claim view: each certified claim's scale and the lines it was formed
 * from, read from the manifest — with the ranked field and the lesson text
 * when the caller holds the world, and the set alone when it does not.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import type { AnswerManifest, ClosedRoster } from "../kernel/contracts.js";
import { blockFor, curriculumRule } from "../kernel/pack.js";
import { type ClaimSource, manifestView } from "./claims.js";

const world = harnessWorld();

const source: ClaimSource = {
  resolve: (entityId, factId) => world.registry.resolve(entityId, factId),
  lesson: (blockId, locale) => {
    const rule = curriculumRule(world.pack, blockId);
    return rule === undefined ? undefined : blockFor(rule, locale)?.text;
  },
};

const electric: ClosedRoster = {
  id: "electric-pokemon",
  snapshotId: "kanto-red-blue",
  criteria: { all: [{ kind: "has-type", type: "electric" }] },
  memberIds: ["pikachu", "raichu", "magnemite", "magneton", "voltorb", "electrode", "electabuzz", "jolteon", "zapdos"],
  cardinality: 9,
};

function manifest(claims: AnswerManifest["claims"], rosters: readonly ClosedRoster[] = []): Pick<AnswerManifest, "claims" | "rosters" | "locale"> {
  return { claims, rosters, locale: "en-US" };
}

describe("a ranking is 1 of N, and the field is listed the way the kernel ranked it", () => {
  const ranking = manifest([{ kind: "ranking", rosterId: "electric-pokemon", basis: "base-speed", direction: "highest", selectedEntityId: "electrode" }], [electric]);

  it("with the world: N is the roster's cardinality and the winner leads the ranked field", () => {
    const view = manifestView(ranking, source);
    expect(view.claims).toHaveLength(1);
    const [claim] = view.claims;
    expect(claim!.scale).toBe("1 of 9");
    expect(claim!.summary).toContain("electrode");
    // The set's definition, then nine members in ranked order.
    expect(claim!.lines[0]).toBe("the set: species of type electric");
    expect(claim!.lines).toHaveLength(10);
    expect(claim!.lines[1]).toMatch(/^1\. electrode — base-speed \d+$/);
    // Every member appears once, and the values never rise down the list.
    const values = claim!.lines.slice(1).map((line) => Number(line.split("base-speed ")[1]));
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    expect(claim!.lines.slice(1).map((line) => line.split(" ")[1])).toEqual(expect.arrayContaining([...electric.memberIds]));
    expect(view.rosters).toEqual([{ id: "electric-pokemon", scale: "9 members", criteria: "of type electric", members: electric.memberIds }]);
  });

  it("without the world: the set and its members still show, and the field is named as re-resolved by the kernel", () => {
    const [claim] = manifestView(ranking).claims;
    expect(claim!.scale).toBe("1 of 9");
    expect(claim!.lines[1]).toContain("members (Pokédex order): pikachu, raichu");
    expect(claim!.lines[2]).toContain("re-resolved by the kernel");
  });

  it("a ranking over a roster the record does not carry says so, rather than inventing a set", () => {
    const [claim] = manifestView(manifest([{ kind: "ranking", rosterId: "ghosts", basis: "base-speed", direction: "lowest" }])).claims;
    expect(claim!.scale).toBeUndefined();
    expect(claim!.lines).toEqual(["roster ghosts is not in the record"]);
  });
});

describe("every other kind names its scale in the record's own numbers", () => {
  it("count and membership read the roster; comparison shows both values and the lead", () => {
    const view = manifestView(
      manifest(
        [
          { kind: "count", rosterId: "electric-pokemon", reported: 9 },
          { kind: "membership", rosterId: "electric-pokemon", entityId: "jolteon", asserted: true },
          { kind: "comparison", factId: "base-speed", leftId: "pikachu", rightId: "raichu", left: { kind: "number", value: 90 }, right: { kind: "number", value: 100 } },
        ],
        [electric],
      ),
    );
    const [count, membership, comparison] = view.claims;
    expect(count!.scale).toBe("9 members");
    expect(count!.lines[1]).toContain("electrode");
    expect(membership!.scale).toBe("1 of 9");
    expect(membership!.lines[0]).toBe("jolteon is among the 9 species of type electric");
    expect(comparison!.scale).toBe("2 values");
    expect(comparison!.lines).toEqual(["pikachu · base-speed = 90", "raichu · base-speed = 100", "raichu leads by 10"]);
  });

  it("a fact resolves its value from the world when the record left it derived; a lesson shows its size and opening", () => {
    const view = manifestView(manifest([{ kind: "fact", entityId: "pikachu", factId: "base-speed" }, { kind: "explanation", blockId: "what-is-badge" }]), source);
    const [fact, lesson] = view.claims;
    expect(fact!.scale).toBe("1 value");
    expect(fact!.lines[0]).toMatch(/^pikachu · base-speed = \d+$/);
    expect(lesson!.scale).toMatch(/^\d+ words$/);
    expect(lesson!.lines[0]).toMatch(/^\d+ words of reviewed text, shown verbatim$/);
    expect(lesson!.lines[1]!.startsWith("“")).toBe(true);
    // Without the world, the same two say what the kernel did, not a number it did not carry.
    const bare = manifestView(manifest([{ kind: "fact", entityId: "pikachu", factId: "base-speed" }, { kind: "explanation", blockId: "what-is-badge" }]));
    expect(bare.claims[0]!.lines[0]).toBe("pikachu · base-speed = derived by the kernel");
    expect(bare.claims[1]!.scale).toBeUndefined();
  });

  it("matchup, eligibility, game rule, type count, treats, recommendation and action each carry one line", () => {
    const view = manifestView(
      manifest([
        { kind: "matchup", subject: { kind: "species", entityId: "pikachu" }, direction: "weak-to", members: ["ground"] },
        { kind: "matchup", subject: { kind: "type", typeId: "normal" }, direction: "immune-to", members: [] },
        { kind: "eligibility", entityId: "mewtwo", finding: { eligible: false, badgeLevel: 2, ruleId: "legendary", minimumBadgeLevel: 8 } },
        { kind: "gameRule", ruleId: "party-size", reported: 6 },
        { kind: "typeCount", reported: 15 },
        { kind: "treats", itemId: "antidote", condition: "poison", asserted: true },
        { kind: "recommendation", entityId: "pikachu" },
        { kind: "action", tool: "reserve", entityId: "pikachu" },
      ]),
    );
    expect(view.claims.map((claim) => claim.scale)).toEqual(["1 type", "0 types", undefined, "1 rule", "15 types", undefined, undefined, undefined]);
    expect(view.claims[0]!.lines[0]).toBe("pikachu weak-to: ground — read off the certified type chart");
    expect(view.claims[1]!.lines[0]).toContain("nothing");
    expect(view.claims[2]!.lines[0]).toBe('not eligible at badge 2 ("legendary" requires badge 8)');
    expect(view.claims[3]!.lines[0]).toContain("party-size = 6");
    expect(view.claims[5]!.lines[0]).toBe("antidote treats poison");
    expect(view.claims.every((claim) => claim.lines.length >= 1)).toBe(true);
  });
});
