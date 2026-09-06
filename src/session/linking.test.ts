/**
 * The driver's half of schema linking (docs/routing.md, R3b), proven on the
 * shipped dictionary: the checks read structure, and the only words they
 * touch are the dictionary's aliases — which can make the system ask, never
 * answer.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import type { Claim } from "../kernel/contracts.js";
import { aliasContradiction, fieldOfClaim, fieldsOfClaim, freshLinks, linkClaims } from "./linking.js";
import type { ClosedRoster } from "../kernel/contracts.js";

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

const waterRoster: ClosedRoster = { id: "water-pokemon", snapshotId: "kanto-red-blue", criteria: { all: [{ kind: "has-type", type: "water" }] }, memberIds: ["squirtle"], cardinality: 1 };
const catalogue: ClosedRoster = { id: "all", snapshotId: "kanto-red-blue", criteria: { all: [] }, memberIds: ["squirtle"], cardinality: 1 };

describe("fieldsOfClaim reaches set claims through their roster", () => {
  it("reads a membership or count as being about what its roster selects on", () => {
    expect(fieldsOfClaim({ kind: "membership", rosterId: "water-pokemon", entityId: "squirtle", asserted: true }, [waterRoster])).toEqual(["types"]);
    expect(fieldsOfClaim({ kind: "count", rosterId: "water-pokemon" }, [waterRoster])).toEqual(["types"]);
    expect(fieldsOfClaim({ kind: "ranking", rosterId: "water-pokemon", basis: "base-speed", direction: "highest" }, [waterRoster])).toEqual(["base-speed", "types"]);
    // The whole catalogue selects on nothing: no field, no check.
    expect(fieldsOfClaim({ kind: "count", rosterId: "all" }, [catalogue])).toEqual([]);
  });

  it("drops a listing of a type when the ask was about the chart", () => {
    const asked = [{ phrase: "what beats water", entityId: "water", fieldId: "type-chart" }];
    const claims: Claim[] = [{ kind: "membership", rosterId: "water-pokemon", entityId: "squirtle", asserted: true }, { kind: "count", rosterId: "water-pokemon" }];
    expect(linkClaims(asked, claims, [waterRoster]).dropped).toBe(2);
    // ...and keeps it when the ask was about the type's members.
    expect(linkClaims([{ phrase: "the water ones", entityId: "water", fieldId: "types" }], claims, [waterRoster]).dropped).toBe(0);
  });
});

describe("freshLinks — only this ask's links", () => {
  it("drops a link whose content words all come from earlier exchanges and none from this one", () => {
    const asked = [
      { phrase: "what's Pikachu's Speed", entityId: "pikachu", fieldId: "base-speed" },
      { phrase: "gym badge", entityId: "gym-badge", fieldId: null },
    ];
    const fresh = freshLinks(asked, "what's a gym badge?", "what's Pikachu's Speed? how tall is Onix?");
    expect(fresh.stale).toBe(1);
    expect(fresh.asked.map((entry) => entry.phrase)).toEqual(["gym badge"]);
  });

  it("keeps a paraphrase the current words do not contain, and a phrase with no content words", () => {
    const fresh = freshLinks(
      [{ phrase: "its velocity", entityId: "pikachu", fieldId: "base-speed" }, { phrase: "it", entityId: "pikachu", fieldId: "types" }],
      "how fast is it?",
      "what's a gym badge?",
    );
    expect(fresh.stale).toBe(0);
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

  it("drops a constant beside a linked field — a game rule is about no subject (dogfood, 2026-09-05)", () => {
    const asked = [{ phrase: "the fastest", entityId: "none", fieldId: "base-speed" }];
    const rule: Claim = { kind: "gameRule", ruleId: "party-size" };
    const types: Claim = { kind: "typeCount" };
    expect(linkClaims(asked, [rule, types, lesson])).toEqual({ claims: [lesson], dropped: 2 });
    // With no field linked, "how many types are there?" keeps its constant.
    expect(linkClaims([{ phrase: "how many types", entityId: "none", fieldId: null }], [types]).dropped).toBe(0);
  });

  it("drops a claim about the reserved no-subject — the model found nothing to be about (dogfood, 2026-09-05)", () => {
    const asked = [{ phrase: "tell me about this", entityId: "none", fieldId: null }];
    const aboutNothing: Claim = { kind: "fact", entityId: "none", factId: "types" };
    expect(linkClaims(asked, [aboutNothing])).toEqual({ claims: [], dropped: 1 });
  });

  it("holds a set claim to nothing when the mapping links no field — 'how many' has no column", () => {
    // Found by the first R3b bank leg: every count over a typed roster fell
    // because the model linked "how many electric ones" to none, honestly.
    const asked = [{ phrase: "how many electric ones", entityId: "electric", fieldId: null }];
    const count: Claim = { kind: "count", rosterId: "water-pokemon" };
    expect(linkClaims(asked, [count], [waterRoster]).dropped).toBe(0);
    // ...but a fact beside it is still the substitution class.
    expect(linkClaims(asked, [count, speed], [waterRoster]).dropped).toBe(1);
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

  it("is silent for a null link whose aliases all name a field another entry already linked — the subject is what is missing", () => {
    // Found live (2026-09-05, strong model): "what's the speed of the fast
    // one?" split into "the speed" → Speed and "the fast one" → none, and
    // the contradiction offered Speed as the one option.
    const asked = [
      { phrase: "the speed", entityId: "none", fieldId: "base-speed" },
      { phrase: "the fast one", entityId: "none", fieldId: null },
    ];
    expect(aliasContradiction(world.pack, world.registry, asked)).toBeUndefined();
    // Alone, the same null link is still the missed field it looks like.
    expect(aliasContradiction(world.pack, world.registry, [asked[1]!])?.suggested.map((field) => field.id)).toEqual(["base-speed"]);
  });

  it("matches word-bounded, so 'type' inside 'typing' is one alias, not two", () => {
    expect(aliasContradiction(world.pack, world.registry, [{ phrase: "its typing", entityId: "pikachu", fieldId: "types" }])).toBeUndefined();
    expect(aliasContradiction(world.pack, world.registry, [{ phrase: "hyper", entityId: "pikachu", fieldId: "base-speed" }])).toBeUndefined();
  });
});

describe("the reserved no-subject is dropped before the mapping is read", () => {
  it("drops a claim about the entity none even when the mapping is empty — a stale-dropped mapping once let one through (dogfood, 2026-09-06)", () => {
    const aboutNothing: Claim = { kind: "fact", entityId: "none", factId: "types" };
    expect(linkClaims([], [aboutNothing, speed])).toEqual({ claims: [speed], dropped: 1 });
  });
});
