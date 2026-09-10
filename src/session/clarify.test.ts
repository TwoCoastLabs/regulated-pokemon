/**
 * Clarification's driver half (docs/routing.md, R3b step 3), proven on the
 * shipped pack and registry: options are typed and validated, a pick is one
 * match and never a guess, and the scope options are the vocabulary's own
 * words.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import type { ClarificationOption } from "../kernel/contracts.js";
import { MAX_CLARIFICATIONS, matchPick, scopeOptions, validOptions } from "./clarify.js";

const world = harnessWorld();

const speed: ClarificationOption = { kind: "field", label: "its Speed stat", fieldId: "base-speed" };
const attack: ClarificationOption = { kind: "field", label: "its Attack stat", fieldId: "base-attack" };
const none: ClarificationOption = { kind: "field", label: "something else", fieldId: null };
const pikachu: ClarificationOption = { kind: "entity", label: "Pikachu", entityId: "pikachu" };
const raichu: ClarificationOption = { kind: "entity", label: "Raichu", entityId: "raichu" };

describe("validOptions — every option is typed against the dictionary or the registry", () => {
  it("keeps a dictionary field, the reserved none, and a certified subject; drops the rest", () => {
    const kept = validOptions(world.pack, world.registry, [
      speed,
      none,
      pikachu,
      { kind: "field", label: "its height", fieldId: "height" },
      { kind: "entity", label: "Missingno", entityId: "missingno" },
      { kind: "entity", label: "  ", entityId: "pikachu" },
    ]);
    expect(kept).toEqual([speed, none, pikachu]);
  });

  it("canonicalises a subject id and folds duplicate bindings to their first statement", () => {
    const kept = validOptions(world.pack, world.registry, [
      { kind: "entity", label: "Mr. Mime", entityId: "Mr Mime" },
      { kind: "field", label: "speed", fieldId: "base-speed" },
      { kind: "field", label: "how fast", fieldId: "base-speed" },
    ]);
    expect(kept).toEqual([
      { kind: "entity", label: "Mr. Mime", entityId: "mr-mime" },
      { kind: "field", label: "speed", fieldId: "base-speed" },
    ]);
  });
});

describe("matchPick — one match is a pick, none or several is not", () => {
  it("reads the label, whole or as a phrase of the reply", () => {
    expect(matchPick(world.pack, world.registry, [speed, attack], "its Speed stat")).toBe(speed);
    expect(matchPick(world.pack, world.registry, [speed, attack], "I meant its attack stat, please")).toBe(attack);
  });

  it("reads a field's dictionary aliases and name for a field option", () => {
    expect(matchPick(world.pack, world.registry, [speed, attack], "how fast it is")).toBe(speed);
    expect(matchPick(world.pack, world.registry, [speed, attack], "Speed")).toBe(speed);
  });

  it("reads a subject's name for an entity option", () => {
    expect(matchPick(world.pack, world.registry, [pikachu, raichu], "raichu")).toBe(raichu);
    expect(matchPick(world.pack, world.registry, [pikachu, raichu], "the Pikachu one")).toBe(pikachu);
  });

  it("matches the none option by its label only", () => {
    expect(matchPick(world.pack, world.registry, [speed, none], "something else")).toBe(none);
    expect(matchPick(world.pack, world.registry, [speed, none], "neither")).toBeUndefined();
  });

  it("a subject question answered with a certified subject the model did not list is a pick of that subject", () => {
    // Found live (2026-09-05): "the fast one" drew Electrode, Caterpie and
    // Dragonite as options, and the trainer said "Pikachu".
    expect(matchPick(world.pack, world.registry, [pikachu, raichu], "Onix")).toEqual({ kind: "entity", label: "Onix", entityId: "onix" });
    expect(matchPick(world.pack, world.registry, [pikachu, raichu], "Mr. Mime please")).toEqual({ kind: "entity", label: "Mr. Mime please", entityId: "mr-mime" });
    // Two named is no pick; a field question takes no unlisted subject.
    expect(matchPick(world.pack, world.registry, [pikachu, raichu], "Onix or Geodude")).toBeUndefined();
    expect(matchPick(world.pack, world.registry, [speed, attack], "Onix")).toBeUndefined();
  });

  it("binds the exact label of one option even when the other option's alias sits inside it (live, 2026-09-11)", () => {
    // "At what level does Charmander evolve?" drew How it evolves or Evolves
    // into; the trainer said "How it evolves" and was asked again, because
    // "evolves" is an alias of Evolves into and every tier counted alike.
    const methods = { kind: "field", label: "How it evolves", fieldId: "evolution-methods" } as const;
    const into = { kind: "field", label: "Evolves into", fieldId: "evolves-to" } as const;
    expect(matchPick(world.pack, world.registry, [methods, into], "How it evolves")).toBe(methods);
    expect(matchPick(world.pack, world.registry, [methods, into], "Evolves into")).toBe(into);
    expect(matchPick(world.pack, world.registry, [methods, into], "how it evolves, please")).toBe(methods);
  });

  it("reads evidence by tier — a label outranks a name, a name outranks an alias — and ties only inside a tier", () => {
    const defense = { kind: "field", label: "Defense", fieldId: "base-defense" } as const;
    const special = { kind: "field", label: "Special Defense", fieldId: "base-special-defense" } as const;
    // "Special Defense" carries both labels; the label tier ties, so no pick.
    expect(matchPick(world.pack, world.registry, [defense, special], "Special Defense")).toBeUndefined();
    // "defense" is the label of one and inside the other's label: one label match wins the tier.
    expect(matchPick(world.pack, world.registry, [defense, special], "defense")).toBe(defense);
    // An alias shared with the other option's words says nothing: "def" is an
    // alias of Defense and sits inside Special Defense's "sp. def", so it is
    // ignored for this question, and "sp def" picks by the discriminating one.
    expect(matchPick(world.pack, world.registry, [defense, special], "sp def")).toBe(special);
  });

  it("is no pick when the reply names two options, or none, or nothing", () => {
    expect(matchPick(world.pack, world.registry, [speed, attack], "speed and attack")).toBeUndefined();
    expect(matchPick(world.pack, world.registry, [speed, attack], "what's its HP?")).toBeUndefined();
    expect(matchPick(world.pack, world.registry, [speed, attack], "   ")).toBeUndefined();
  });
});

describe("scopeOptions — the pack's approved values as clicks", () => {
  it("lists one label per value, spelled as the vocabulary reads it", () => {
    expect(scopeOptions(world.pack, "version")).toEqual(["red-blue", "yellow"]);
    expect(scopeOptions(world.pack, "region")).toEqual(["kanto"]);
    expect(scopeOptions(world.pack, "badgeLevel")).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
    // Two terms share base-speed; one click.
    expect(scopeOptions(world.pack, "comparisonBasis")).toEqual(["speed", "attack", "defense", "hp", "total"]);
  });
});

describe("the chain cap", () => {
  it("is two — the bot may ask twice and never interrogate", () => {
    expect(MAX_CLARIFICATIONS).toBe(2);
  });
});
