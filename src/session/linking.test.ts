/**
 * The driver's half of schema linking (docs/routing.md, R3b), proven on the
 * shipped dictionary: the checks read structure, and the only words they
 * touch are the dictionary's aliases — which can make the system ask, never
 * answer.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import type { Claim } from "../kernel/contracts.js";
import { aliasContradiction, fieldOfClaim, linkClaims } from "./linking.js";

const world = harnessWorld();

const speed: Claim = { kind: "fact", entityId: "pikachu", factId: "base-speed" };
const hp: Claim = { kind: "fact", entityId: "pikachu", factId: "base-hp" };
const lesson: Claim = { kind: "explanation", blockId: "what-is-badge" };
const weakTo: Claim = { kind: "matchup", subject: { kind: "species", entityId: "pikachu" }, direction: "weak-to" };

describe("fieldOfClaim", () => {
  it("names the field a fact, comparison, ranking or matchup is about, and nothing for the rest", () => {
    expect(fieldOfClaim(speed)).toBe("base-speed");
    expect(fieldOfClaim({ kind: "comparison", factId: "move-power", leftId: "surf", rightId: "thunderbolt" })).toBe("move-power");
    expect(fieldOfClaim({ kind: "ranking", rosterId: "r", basis: "base-attack", direction: "highest" })).toBe("base-attack");
    expect(fieldOfClaim(weakTo)).toBe("type-chart");
    expect(fieldOfClaim(lesson)).toBeUndefined();
    expect(fieldOfClaim({ kind: "count", rosterId: "r" })).toBeUndefined();
  });
});

describe("linkClaims — R1, claims stay inside the ask", () => {
  it("holds nothing when the reply linked nothing", () => {
    expect(linkClaims([], [speed, hp])).toEqual({ claims: [speed, hp], dropped: 0 });
  });

  it("drops a field-bearing claim about a field the model did not link, and counts it", () => {
    const asked = [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-speed" }];
    expect(linkClaims(asked, [speed, hp, lesson])).toEqual({ claims: [speed, lesson], dropped: 1 });
  });

  it("drops every field-bearing claim when every link is to no field — the substitution class", () => {
    const asked = [{ phrase: "how tall", entityId: "onix", fieldId: null }];
    expect(linkClaims(asked, [speed, weakTo])).toEqual({ claims: [], dropped: 2 });
  });
});

describe("aliasContradiction — R3, the dictionary's words can only make the system ask", () => {
  it("is silent when the phrase carries an alias of the linked field", () => {
    expect(aliasContradiction(world.pack, world.registry, [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-speed" }])).toBeUndefined();
  });

  it("is silent when the phrase carries no alias at all — the model's link stands, unchecked by words", () => {
    expect(aliasContradiction(world.pack, world.registry, [{ phrase: "its zip", entityId: "pikachu", fieldId: "base-speed" }])).toBeUndefined();
  });

  it("names the contradiction when the phrase carries only another field's alias", () => {
    const found = aliasContradiction(world.pack, world.registry, [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-attack" }]);
    expect(found?.linked?.id).toBe("base-attack");
    expect(found?.suggested.map((field) => field.id)).toEqual(["base-speed"]);
  });

  it("names a field the dictionary holds when the model linked none", () => {
    const found = aliasContradiction(world.pack, world.registry, [{ phrase: "what does it evolve into", entityId: "eevee", fieldId: null }]);
    expect(found?.linked).toBeUndefined();
    expect(found?.suggested.map((field) => field.id)).toEqual(["evolves-to"]);
  });

  it("reads aliases per the subject the ask names — a move's word is no evidence about a species", () => {
    // "how strong" is the move-power alias; Pikachu is a species, so it says
    // nothing against a link to its Attack stat.
    expect(aliasContradiction(world.pack, world.registry, [{ phrase: "how strong", entityId: "pikachu", fieldId: "base-attack" }])).toBeUndefined();
    // For a move, the same phrase is evidence, and contradicts a link to PP.
    const found = aliasContradiction(world.pack, world.registry, [{ phrase: "how strong", entityId: "thunderbolt", fieldId: "move-pp" }]);
    expect(found?.suggested.map((field) => field.id)).toEqual(["move-power"]);
  });

  it("matches word-bounded, so 'type' inside 'typing' is one alias, not two", () => {
    expect(aliasContradiction(world.pack, world.registry, [{ phrase: "its typing", entityId: "pikachu", fieldId: "types" }])).toBeUndefined();
    expect(aliasContradiction(world.pack, world.registry, [{ phrase: "hyper", entityId: "pikachu", fieldId: "base-speed" }])).toBeUndefined();
  });
});
