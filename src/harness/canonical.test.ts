/**
 * Canonical surface forms, held to their three lines: same name only (never a
 * nearest neighbour), content verbatim, deterministic. The cases are the ones
 * the live runs actually produced (findings §20's residual): "Bulbasaur",
 * "selfdestruct", a type name in the species slot — plus the ones that must
 * NOT map: a person, a concept, a dex number, an invented species.
 */

import { describe, expect, it } from "vitest";

import type { Claim } from "../kernel/contracts.js";
import { canonicalizeClaims } from "./canonical.js";
import { harnessWorld } from "./corpus.js";

const world = harnessWorld();
const one = (claim: Claim): Claim => canonicalizeClaims(world.registry, [claim])[0]!;

describe("canonicalizeClaims reads the same name in its certified spelling", () => {
  it("folds case: Bulbasaur is bulbasaur", () => {
    const read = one({ kind: "recommendation", entityId: "Bulbasaur" });
    expect(read).toEqual({ kind: "recommendation", entityId: "bulbasaur" });
  });

  it("folds separators: selfdestruct is self-destruct — the §20 residual case", () => {
    const read = one({ kind: "fact", entityId: "selfdestruct", factId: "move-power" });
    expect(read).toEqual({ kind: "fact", entityId: "self-destruct", factId: "move-power" });
  });

  it("keeps content verbatim: a wrong asserted value survives the fold untouched", () => {
    const read = one({ kind: "fact", entityId: "Pikachu", factId: "base-speed", asserted: { kind: "number", value: 42 } });
    expect(read).toEqual({ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 42 } });
  });

  it("re-slots a matchup whose species subject names a type — the same name, right variant", () => {
    const read = one({ kind: "matchup", subject: { kind: "species", entityId: "Electric" }, direction: "strong-against" });
    expect(read).toEqual({ kind: "matchup", subject: { kind: "type", typeId: "electric" }, direction: "strong-against" });
  });

  it("a certified id passes through untouched, and the fold is deterministic", () => {
    const claim: Claim = { kind: "eligibility", entityId: "mewtwo" };
    expect(one(claim)).toEqual(claim);
    expect(canonicalizeClaims(world.registry, [claim])).toEqual(canonicalizeClaims(world.registry, [claim]));
  });
});

describe("canonicalizeClaims never guesses — the doctrine's line", () => {
  it("maps nothing for fabrications, concepts, people and dex numbers", () => {
    // Each of these is a real IA-3 from the filed §20 artifacts. None is a
    // surface form of a certified id, so each passes through unchanged and the
    // kernel denies it exactly as before.
    for (const entityId of ["brock", "elite-four", "gym-badge", "oran-berry", "144", "025", "shadowmon", "starter_pokemon"]) {
      const read = one({ kind: "fact", entityId, factId: "base-speed" });
      expect(read).toEqual({ kind: "fact", entityId, factId: "base-speed" });
    }
  });
});
