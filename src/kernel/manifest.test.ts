/**
 * Unit coverage for answer compilation. The crucible sabotages a compiled
 * manifest; these tests exercise the pieces directly, including the ones a
 * mutation cannot reach because the compiler refuses to build them.
 */

import { describe, expect, it } from "vitest";

import type { AnswerManifest, Claim, ClosedRoster } from "./contracts.js";
import { compileManifest, type ManifestContext, requiredExhibits, verifyManifest } from "./manifest.js";
import { buildRoster } from "./roster.js";
import { denialCode } from "./violation.js";
import { COMMIT_TIME, manifestContext, trainerGrant } from "../testing/fixtures.js";

const context = manifestContext();

function roster(id: string, criteria: ClosedRoster["criteria"]): ClosedRoster {
  const built = buildRoster(context.registry, id, criteria);
  if (!built.ok) throw new Error(`fixture roster ${id} did not build`);
  return built.value;
}

const ELECTRIC = roster("electric-kanto", { all: [{ kind: "has-type", type: "electric" }] });
const BOOMERS = roster("selfdestruct-learners", { all: [{ kind: "learns-move", move: "self-destruct" }] });

function compile(claims: readonly Claim[], rosters: readonly ClosedRoster[] = [], ctx: ManifestContext = context) {
  return compileManifest(ctx, { transactionId: "txn-1", claims, rosters });
}

/** Compile something that must succeed, so a test can then sabotage it. */
function compiled(claims: readonly Claim[], rosters: readonly ClosedRoster[] = []): AnswerManifest {
  const result = compile(claims, rosters);
  if (!result.ok) throw new Error(`fixture manifest was refused: ${result.violations.map(denialCode).join(", ")}`);
  return result.value;
}

function denialsOf(manifest: AnswerManifest, ctx: ManifestContext = context): string[] {
  return verifyManifest(ctx, manifest).violations.map(denialCode);
}

const PIKACHU_SPEED: Claim = {
  kind: "fact",
  entityId: "pikachu",
  factId: "base-speed",
  asserted: { kind: "number", value: 90 },
};

describe("a manifest is compiled only if it would survive verification", () => {
  it("compiles an answer that makes every kind of claim", () => {
    const manifest = compiled(
      [
        PIKACHU_SPEED,
        { kind: "count", rosterId: "electric-kanto", reported: ELECTRIC.cardinality },
        { kind: "membership", rosterId: "electric-kanto", entityId: "zapdos", asserted: true },
        { kind: "membership", rosterId: "electric-kanto", entityId: "snorlax", asserted: false },
        {
          kind: "ranking",
          rosterId: "electric-kanto",
          basis: "base-speed",
          direction: "highest",
          selectedEntityId: "electrode",
        },
        { kind: "recommendation", entityId: "raichu" },
      ],
      [ELECTRIC],
    );

    expect(verifyManifest(context, manifest)).toEqual({ allowed: true, violations: [] });
    expect(manifest.snapshotId).toBe(context.registry.snapshot.id);
    expect(manifest.packId).toBe(context.pack.id);
    expect(manifest.scopeGrantId).toBe(context.grant.id);
  });

  it("refuses to emit a manifest it would itself deny", () => {
    const result = compile([{ ...PIKACHU_SPEED, asserted: { kind: "number", value: 200 } }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map(denialCode)).toContain("IA-2/fact-mismatch");
  });
});

describe("claims are recomputed, not believed", () => {
  it("denies a fact claim whose value the snapshot does not certify", () => {
    const manifest = compiled([PIKACHU_SPEED]);
    const tampered = {
      ...manifest,
      claims: [{ ...PIKACHU_SPEED, asserted: { kind: "number", value: 200 } } satisfies Claim],
    };
    expect(denialsOf(tampered)).toContain("IA-2/fact-mismatch");
  });

  it("passes the registry's own refusals through unchanged", () => {
    const manifest = compiled([PIKACHU_SPEED]);
    expect(
      denialsOf({ ...manifest, claims: [{ ...PIKACHU_SPEED, entityId: "missingno" }] }),
    ).toContain("IA-3/fabricated-entity");
    expect(
      denialsOf({ ...manifest, claims: [{ ...PIKACHU_SPEED, factId: "favourite-colour" }] }),
    ).toContain("IA-2/uncertified-fact");
  });

  it("denies a count that disagrees with the set it came from", () => {
    const manifest = compiled([{ kind: "count", rosterId: "electric-kanto", reported: 9 }], [ELECTRIC]);
    expect(
      denialsOf({ ...manifest, claims: [{ kind: "count", rosterId: "electric-kanto", reported: 12 }] }),
    ).toContain("IA-4/count-mismatch");
  });

  it("denies membership asserted the wrong way round", () => {
    const claim: Claim = { kind: "membership", rosterId: "electric-kanto", entityId: "zapdos", asserted: true };
    const manifest = compiled([claim], [ELECTRIC]);
    expect(denialsOf({ ...manifest, claims: [{ ...claim, asserted: false }] })).toContain("IA-4/membership-mismatch");
    expect(denialsOf({ ...manifest, claims: [{ ...claim, entityId: "snorlax" }] })).toContain(
      "IA-4/membership-mismatch",
    );
  });

  it("denies membership of an entity that does not exist", () => {
    const claim: Claim = { kind: "membership", rosterId: "electric-kanto", entityId: "zapdos", asserted: true };
    const manifest = compiled([claim], [ELECTRIC]);
    expect(denialsOf({ ...manifest, claims: [{ ...claim, entityId: "missingno" }] })).toContain(
      "IA-3/fabricated-entity",
    );
  });

  it("denies a claim citing a roster the manifest does not carry", () => {
    const manifest = compiled([{ kind: "count", rosterId: "electric-kanto", reported: 9 }], [ELECTRIC]);
    expect(denialsOf({ ...manifest, rosters: [] })).toContain("IA-4/roster-not-in-manifest");
  });

  it("denies a roster carried twice", () => {
    const manifest = compiled([{ kind: "count", rosterId: "electric-kanto", reported: 9 }], [ELECTRIC]);
    expect(denialsOf({ ...manifest, rosters: [ELECTRIC, ELECTRIC] })).toContain("IA-4/duplicate-roster");
  });

  it("re-verifies every roster it carries, so phase 1's denials still apply", () => {
    const manifest = compiled([{ kind: "count", rosterId: "electric-kanto", reported: 9 }], [ELECTRIC]);
    const doctored: ClosedRoster = { ...ELECTRIC, memberIds: [...ELECTRIC.memberIds, "missingno"] };
    expect(denialsOf({ ...manifest, rosters: [doctored] })).toContain("IA-3/fabricated-entity");
  });
});

describe("ranking is recomputed over the declared basis", () => {
  const ranking: Claim = {
    kind: "ranking",
    rosterId: "electric-kanto",
    basis: "base-speed",
    direction: "highest",
    selectedEntityId: "electrode",
  };
  const manifest = compiled([ranking], [ELECTRIC]);

  it("denies the wrong winner", () => {
    expect(denialsOf({ ...manifest, claims: [{ ...ranking, selectedEntityId: "pikachu" }] })).toContain(
      "IA-4/ranking-mismatch",
    );
  });

  it("denies the right winner ranked the wrong way round", () => {
    expect(denialsOf({ ...manifest, claims: [{ ...ranking, direction: "lowest" }] })).toContain(
      "IA-4/ranking-mismatch",
    );
  });

  it("ranks lowest as readily as highest", () => {
    const slowest: Claim = { ...ranking, direction: "lowest", selectedEntityId: "magnemite" };
    expect(verifyManifest(context, { ...manifest, claims: [slowest] }).allowed).toBe(true);
  });

  it("refuses a basis that is not a certified fact", () => {
    expect(denialsOf({ ...manifest, claims: [{ ...ranking, basis: "coolness" }] })).toContain("IA-2/uncertified-fact");
  });

  it("refuses a basis that is not a quantity", () => {
    expect(denialsOf({ ...manifest, claims: [{ ...ranking, basis: "types" }] })).toContain(
      "IA-4/ranking-basis-not-ordered",
    );
  });

  it("denies a winner drawn from outside the roster", () => {
    expect(denialsOf({ ...manifest, claims: [{ ...ranking, selectedEntityId: "mewtwo" }] })).toContain(
      "IA-4/ranking-outside-roster",
    );
  });

  it("denies a tie presented as a unique answer", () => {
    // Below the Chansey tier, Lapras and Vaporeon share the highest base HP at
    // 130. "The toughest of these" has no single right answer, and argmax over
    // an array would confidently return whichever the Pokédex lists first.
    const sturdy = roster("hp-130-or-less", { all: [{ kind: "stat-at-most", stat: "hp", value: 130 }] });
    const tied: Claim = {
      kind: "ranking",
      rosterId: "hp-130-or-less",
      basis: "base-hp",
      direction: "highest",
      selectedEntityId: "lapras",
    };
    const result = compile([tied], [sturdy]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map(denialCode)).toContain("IA-4/ranking-tie");
    expect(result.violations[0]?.actual).toBe("lapras, vaporeon");
  });

  it("denies a ranking over an empty set", () => {
    const empty: ClosedRoster = { ...ELECTRIC, id: "empty", memberIds: [], cardinality: 0 };
    const claim: Claim = { ...ranking, rosterId: "empty" };
    expect(denialsOf({ ...manifest, claims: [claim], rosters: [empty] })).toContain("IA-4/ranking-over-empty-roster");
  });
});

describe("the Accord pack decides who may be told what", () => {
  it("allows a recommendation the trainer is accredited for", () => {
    expect(compile([{ kind: "recommendation", entityId: "mewtwo" }]).ok).toBe(true);
  });

  it("denies a restricted species to a trainer below the threshold", () => {
    const novice = manifestContext(2);
    const result = compile([{ kind: "recommendation", entityId: "articuno" }], [], novice);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map(denialCode)).toContain("IA-5/restricted-species");
    expect(result.violations[0]?.message).toContain("legendary-acquisition");
  });

  it("gates mythical species more tightly than legendary ones", () => {
    const sixBadges = manifestContext(6);
    expect(compile([{ kind: "recommendation", entityId: "zapdos" }], [], sixBadges).ok).toBe(true);
    expect(compile([{ kind: "recommendation", entityId: "mew" }], [], sixBadges).ok).toBe(false);
  });

  it("refuses to recommend something that does not exist", () => {
    const result = compile([{ kind: "recommendation", entityId: "missingno" }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map(denialCode)).toContain("IA-3/fabricated-entity");
  });

  it("attaches a triggered warning when the answer is about the move", () => {
    const manifest = compiled([{ kind: "count", rosterId: "selfdestruct-learners", reported: 20 }], [BOOMERS]);
    expect(manifest.exhibits.map((exhibit) => exhibit.id)).toEqual(["selfdestruct-warning", "provenance"]);
  });

  it("attaches provenance to every answer, triggered by nothing at all", () => {
    expect(compiled([PIKACHU_SPEED]).exhibits.map((exhibit) => exhibit.id)).toEqual(["provenance"]);
  });

  it("denies a manifest that drops an obligation it owes", () => {
    const manifest = compiled([{ kind: "count", rosterId: "selfdestruct-learners", reported: 20 }], [BOOMERS]);
    const stripped = manifest.exhibits.filter((exhibit) => exhibit.id !== "selfdestruct-warning");
    expect(denialsOf({ ...manifest, exhibits: stripped })).toContain("IA-6/exhibit-not-manifested");
  });

  it("denies an exhibit hollowed out to nothing", () => {
    const manifest = compiled([PIKACHU_SPEED]);
    const hollow = manifest.exhibits.map((exhibit) => ({ ...exhibit, requiredFragments: [] }));
    expect(denialsOf({ ...manifest, exhibits: hollow })).toContain("IA-2/exhibit-fragments-dropped");
  });

  it("denies an exhibit no rule asked for", () => {
    const manifest = compiled([PIKACHU_SPEED]);
    const extra = [
      ...manifest.exhibits,
      { id: "sponsored-message", kind: "warning" as const, requiredFragments: ["buy now"] },
    ];
    expect(denialsOf({ ...manifest, exhibits: extra })).toContain("IA-6/exhibit-unrequired");
  });

  it("derives obligations from the criteria of a set, not only from claims", () => {
    // Nothing claims anything *about* Selfdestruct here; the move is in the
    // definition of the set, which is what makes the answer about it.
    const exhibits = requiredExhibits(context, [], [BOOMERS]).map((exhibit) => exhibit.id);
    expect(exhibits).toContain("selfdestruct-warning");
  });
});

describe("the manifest is bound to one snapshot, pack, trainer and window", () => {
  const manifest = compiled([PIKACHU_SPEED]);

  it("denies an answer certified against another snapshot", () => {
    expect(denialsOf({ ...manifest, snapshotId: "kanto-yellow" })).toEqual(["IA-2/snapshot-mismatch"]);
  });

  it("denies an answer governed by another pack version", () => {
    expect(denialsOf({ ...manifest, packId: "indigo-accord-v2" })).toEqual(["IA-5/pack-mismatch"]);
  });

  it("denies an answer citing another trainer's scope", () => {
    expect(denialsOf({ ...manifest, scopeGrantId: "grant-someone-else" })).toEqual(["IA-1/scope-grant-mismatch"]);
  });

  it("denies an answer with no transaction identity", () => {
    expect(denialsOf({ ...manifest, transactionId: "" })).toContain("IA-10/transaction-unidentified");
  });

  it("denies scope established over a different version group", () => {
    const elsewhere: ManifestContext = {
      ...context,
      grant: { ...trainerGrant(), scope: { ...trainerGrant().scope, version: "yellow" } },
    };
    expect(denialsOf(manifest, elsewhere)).toContain("IA-2/scope-version-mismatch");
  });

  it("checks the validity window at commit time, not at issue time", () => {
    const grant = trainerGrant();
    const late: ManifestContext = { ...context, at: "2026-02-01T00:00:00Z" };
    const early: ManifestContext = { ...context, at: "2025-12-01T00:00:00Z" };
    expect(denialsOf(manifest, late)).toContain("IA-1/scope-window-expired");
    expect(denialsOf(manifest, early)).toContain("IA-1/scope-window-expired");
    expect(verifyManifest({ ...context, at: grant.issuedAt }, manifest).allowed).toBe(true);
  });

  it("denies a window that is unreadable or inside out", () => {
    const unreadable: ManifestContext = { ...context, at: "the day before yesterday" };
    expect(denialsOf(manifest, unreadable)).toContain("IA-1/scope-window-unreadable");

    const inverted: ManifestContext = {
      ...context,
      grant: { ...trainerGrant(), issuedAt: COMMIT_TIME, expiresAt: "2026-01-01T00:00:00Z" },
    };
    expect(denialsOf(manifest, inverted)).toContain("IA-1/scope-window-empty");
  });
});
