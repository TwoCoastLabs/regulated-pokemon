/**
 * Unit coverage for answer compilation. The crucible sabotages a compiled
 * manifest; these tests exercise the pieces directly, including the ones a
 * mutation cannot reach because the compiler refuses to build them.
 */

import { describe, expect, it } from "vitest";

import type { AnswerManifest, Claim, ClosedRoster } from "./contracts.js";
import { digestText } from "./digest.js";
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

describe("pokedex-count stays the registry's own number", () => {
  it("matches the certified species count, so the reviewed value cannot drift from the snapshot", () => {
    const rule = context.pack.gameRules.find((entry) => entry.id === "pokedex-count");
    expect(rule?.value).toBe(context.registry.speciesIds.length);
  });
});

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
    expect(manifest.scopeGrantId).toBe(context.grant!.id);
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

  it("derives an unstated count from the certified set, so a set-definer cannot get it wrong", () => {
    // The count with no number: the model defined the set and the kernel counts
    // it. compileManifest fills the cardinality, and the committed count is the
    // set's — arithmetic taken off the proposer entirely.
    const result = compile([{ kind: "count", rosterId: "electric-kanto" }], [ELECTRIC]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const count = result.value.claims.find((claim) => claim.kind === "count");
      expect(count).toEqual({ kind: "count", rosterId: "electric-kanto", reported: ELECTRIC.cardinality });
    }
  });

  it("counts the type universe, and refuses a forged total (epic #64, slice 3b)", () => {
    const universe = context.registry.typeChart.types.length;
    const manifest = compiled([{ kind: "typeCount" }]);
    // Derived from the chart, exactly like a roster count from its set.
    expect(manifest.claims[0]).toEqual({ kind: "typeCount", reported: universe });
    expect(verifyManifest(context, manifest)).toEqual({ allowed: true, violations: [] });
    // A stated number that disagrees with the chart is a different claim.
    expect(denialsOf({ ...manifest, claims: [{ kind: "typeCount", reported: universe + 3 }] })).toContain(
      "IA-4/type-count-mismatch",
    );
  });

  it("answers a game-rule constant as a number, refusing a forged or invented one (epic #64)", () => {
    const partySize = context.pack.gameRules.find((rule) => rule.id === "party-size")!.value;
    const manifest = compiled([{ kind: "gameRule", ruleId: "party-size" }]);
    // Filled from the pack's reviewed value, like a count from its set.
    expect(manifest.claims[0]).toEqual({ kind: "gameRule", ruleId: "party-size", reported: partySize });
    expect(verifyManifest(context, manifest)).toEqual({ allowed: true, violations: [] });
    // A stated number that disagrees with the pack.
    expect(denialsOf({ ...manifest, claims: [{ kind: "gameRule", ruleId: "party-size", reported: 99 }] })).toContain(
      "IA-4/game-rule-mismatch",
    );
    // A rule the pack never set — refused at compile as at verify, so the
    // fill step cannot quietly invent a value the auditor would then miss.
    expect(denialsOf({ ...manifest, claims: [{ kind: "gameRule", ruleId: "unlimited-team" }] })).toContain(
      "IA-3/fabricated-game-rule",
    );
    expect(compile([{ kind: "gameRule", ruleId: "unlimited-team" }]).ok).toBe(false);
  });

  it("commits a game-rule constant with no grant — it is the same for every trainer (epic #64)", () => {
    const bare: ManifestContext = { registry: context.registry, pack: context.pack, locale: context.locale, at: context.at };
    const result = compile([{ kind: "gameRule", ruleId: "party-size" }], [], bare);
    expect(result.ok).toBe(true);
    // A fact, by contrast, still needs scope even here.
    expect(compile([PIKACHU_SPEED], [], bare).ok).toBe(false);
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

  it("derives the winner when none is named, so an orderer cannot pick wrong", () => {
    // Declare the set, the basis and the direction; the kernel names the
    // extreme. compileManifest fills electrode — the arithmetic taken off the
    // proposer exactly as the count's was.
    const { selectedEntityId: _omitted, ...unnamed } = ranking;
    const result = compile([unnamed as Claim], [ELECTRIC]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claims[0]).toMatchObject({ kind: "ranking", selectedEntityId: "electrode" });
    }
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
    expect(result.violations.find((entry) => entry.rule === "ranking-tie")?.actual).toBe("lapras, vaporeon");
  });

  it("denies a ranking over an empty set", () => {
    const empty: ClosedRoster = { ...ELECTRIC, id: "empty", memberIds: [], cardinality: 0 };
    const claim: Claim = { ...ranking, rosterId: "empty" };
    expect(denialsOf({ ...manifest, claims: [claim], rosters: [empty] })).toContain("IA-4/ranking-over-empty-roster");
  });
});

describe("a ranking's basis is scope, not content", () => {
  const ranking: Claim = {
    kind: "ranking",
    rosterId: "electric-kanto",
    basis: "base-speed",
    direction: "highest",
    selectedEntityId: "electrode",
  };
  const manifest = compiled([ranking], [ELECTRIC]);

  it("commits a ranking on the basis the grant establishes", () => {
    // The fixture trainer confirmed "the quickest" as base-speed through the
    // ladder; ranking on it is the answer to the question that was asked.
    expect(verifyManifest(context, manifest)).toEqual({ allowed: true, violations: [] });
  });

  it("denies a self-consistent ranking on a basis the trainer never confirmed", () => {
    // The treacherous case: winner omitted, so the kernel's own derivation
    // would name the right member for this ordering — nothing about the
    // content is false, and the question was still swapped.
    const swapped: Claim = { kind: "ranking", rosterId: "electric-kanto", basis: "base-special-attack", direction: "highest" };
    const denials = denialsOf({ ...manifest, claims: [swapped] });
    expect(denials).toContain("IA-1/ranking-basis-not-established");
    expect(denials.filter((code) => code.startsWith("IA-4"))).toEqual([]);
  });

  it("denies a ranking when no basis was ever established", () => {
    // The same grant minus its comparisonBasis: a scope in which no ranking
    // question was ever asked, so no basis the claim picks can be right.
    const grant = trainerGrant();
    const { comparisonBasis: _unbound, ...scope } = grant.scope;
    const unestablished: ManifestContext = { ...context, grant: { ...grant, scope } };
    expect(denialsOf(manifest, unestablished)).toContain("IA-1/ranking-basis-not-established");
  });

  it("refuses at compile as at verify, so the compiler cannot outrank the auditor", () => {
    const result = compile([{ ...ranking, basis: "base-attack" }], [ELECTRIC]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map(denialCode)).toContain("IA-1/ranking-basis-not-established");
  });
});

describe("material scope is derived from the answer's own claims (epic #64)", () => {
  // The fixture grant minus its badge binding: a scope in which a version was
  // established and the trainer's accreditation never was.
  const noBadge = (): ManifestContext => {
    const grant = trainerGrant();
    const scope = { ...grant.scope };
    delete (scope as { badgeLevel?: number }).badgeLevel;
    return { ...context, grant: { ...grant, scope } };
  };

  it("commits a world fact under a grant that establishes only what a fact needs", () => {
    // A fact depends on the version and nothing about the trainer, so a grant
    // that never bound a badge level is complete *for this answer*.
    const manifest = compiled([{ kind: "fact", entityId: "pikachu", factId: "base-speed" }]);
    expect(verifyManifest(noBadge(), manifest)).toEqual({ allowed: true, violations: [] });
  });

  it("refuses an eligibility ruling when the grant never established badges", () => {
    const manifest = compiled([{ kind: "eligibility", entityId: "mewtwo" }]);
    expect(denialsOf(manifest, noBadge())).toContain("IA-1/scope-dimension-missing");
  });

  it("closes the unbound-badge hole: a restricted recommendation is refused, not waved through", () => {
    // Without the coverage check, checkAccreditation would read the unbound
    // badgeLevel, compare `undefined < 6` (false), and allow the legendary.
    const manifest = compiled([{ kind: "recommendation", entityId: "mewtwo" }]);
    expect(denialsOf(manifest, noBadge())).toContain("IA-1/scope-dimension-missing");
    expect(verifyManifest(noBadge(), manifest).allowed).toBe(false);
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

  it("gates an act by the same accreditation as the advice to acquire one", () => {
    // An act that hands over a restricted species is at least as consequential
    // as being told to go and get one, so it meets the identical gate.
    const novice = manifestContext(2);
    const result = compile([{ kind: "action", tool: "add-to-team", entityId: "articuno" }], [], novice);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map(denialCode)).toContain("IA-5/restricted-species");
  });

  it("refuses an act the pack's closed action registry does not declare", () => {
    const result = compile([{ kind: "action", tool: "delete-save-file", entityId: "pikachu" }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map(denialCode)).toEqual(["IA-7/unknown-action"]);
  });

  it("refuses to act on something that does not exist", () => {
    const result = compile([{ kind: "action", tool: "release", entityId: "missingno" }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map(denialCode)).toContain("IA-3/fabricated-entity");
  });

  it("owes one consent notice per irreversible act, not per rule", () => {
    const exhibits = requiredExhibits(
      context,
      [
        { kind: "action", tool: "release", entityId: "pikachu" },
        { kind: "action", tool: "release", entityId: "raichu" },
        // Reversible: the same rule must not fire for it.
        { kind: "action", tool: "add-to-team", entityId: "zapdos" },
        // The same act twice is one thing to consent to.
        { kind: "action", tool: "release", entityId: "pikachu" },
      ],
      [],
    );
    expect(exhibits.map((exhibit) => exhibit.id)).toEqual([
      "release-irreversibility:pikachu",
      "release-irreversibility:raichu",
      "provenance",
    ]);
    expect(exhibits[0]?.tool).toBe("release");
    expect(exhibits[0]?.rule).toBe("release-irreversibility");
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

  it("denies an exhibit pointed at an older revision of its own text", () => {
    // The block id is right, the words behind that version are not the ones
    // the pack approves now, and a record naming it would satisfy any check
    // that only asked whether a disclosure was listed.
    const manifest = compiled([PIKACHU_SPEED]);
    const stale = manifest.exhibits.map((exhibit) => ({
      ...exhibit,
      block: { ...exhibit.block, version: exhibit.block.version + 1 },
    }));
    expect(denialsOf({ ...manifest, exhibits: stale })).toContain("IA-2/exhibit-block-mismatch");
  });

  it("denies an exhibit carrying another locale's translation", () => {
    const manifest = compiled([PIKACHU_SPEED]);
    const foreign = manifest.exhibits.map((exhibit) => ({
      ...exhibit,
      block: { ...exhibit.block, locale: "en-GB" },
    }));
    expect(denialsOf({ ...manifest, exhibits: foreign })).toContain("IA-2/exhibit-block-mismatch");
  });

  it("denies an answer whose disclosure has no approved text in its locale", () => {
    // Fail closed rather than falling back to another translation: an
    // obligation nobody can discharge stops the answer, it does not soften it.
    const manifest = compiled([PIKACHU_SPEED]);
    const untranslated: ManifestContext = {
      ...context,
      pack: {
        ...context.pack,
        exhibits: context.pack.exhibits.map((rule) => ({
          ...rule,
          block: { ...rule.block, content: rule.block.content.filter((entry) => entry.locale !== manifest.locale) },
        })),
      },
    };
    expect(verifyManifest(untranslated, manifest).violations.map(denialCode)).toContain(
      "IA-2/exhibit-block-unavailable",
    );
  });

  it("denies an exhibit no rule asked for", () => {
    const manifest = compiled([PIKACHU_SPEED]);
    const extra = [
      ...manifest.exhibits,
      {
        id: "sponsored-message",
        rule: "silph-co-partnership",
        kind: "warning" as const,
        block: { id: "silph", version: 1, locale: manifest.locale, digest: digestText("buy now") },
      },
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
    expect(denialsOf({ ...manifest, packId: "indigo-accord-v0-never" })).toEqual(["IA-5/pack-mismatch"]);
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

  it("still teaches across a version boundary — a lesson-only manifest reads nothing from this snapshot", () => {
    // The same property that lets a lesson commit grantless: reviewed text is
    // the same for every trainer, so a trainer who honestly plays Yellow may
    // be taught what these records do and do not cover — while anything
    // derived from the snapshot still refuses by name (the cases above and
    // below). Found live: the boundary lesson written for exactly this
    // situation was itself denied.
    const elsewhere: ManifestContext = {
      ...context,
      grant: { ...trainerGrant(), scope: { ...trainerGrant().scope, version: "yellow" } },
    };
    const lesson = compileManifest(elsewhere, {
      transactionId: "txn-boundary",
      claims: [{ kind: "explanation", blockId: "red-blue-vs-yellow" }],
      rosters: [],
    });
    expect(lesson.ok).toBe(true);
    if (lesson.ok) expect(verifyManifest(elsewhere, lesson.value)).toEqual({ allowed: true, violations: [] });
  });

  it("denies a game rule across the version boundary — pack numbers are certified for this world only", () => {
    const elsewhere: ManifestContext = {
      ...context,
      grant: { ...trainerGrant(), scope: { ...trainerGrant().scope, version: "yellow" } },
    };
    // Compiled under the home context (compilation itself may read scope),
    // verified under the foreign grant — the same shape as the fact case.
    const rule = compileManifest(context, {
      transactionId: "txn-foreign-rule",
      claims: [{ kind: "gameRule", ruleId: "party-size" }],
      rosters: [],
    });
    expect(rule.ok).toBe(true);
    if (rule.ok) {
      const verdict = verifyManifest(elsewhere, rule.value);
      expect(verdict.allowed).toBe(false);
      expect(verdict.violations.map((v) => `${v.article}/${v.rule}`)).toContain("IA-2/scope-version-mismatch");
    }
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

describe("a routed lesson: the one claim that asserts nothing, checked all the same", () => {
  it("compiles and verifies a lesson beside ordinary claims — the hybrid answer", () => {
    const result = compile([
      { kind: "explanation", blockId: "what-is-type" },
      { kind: "fact", entityId: "pikachu", factId: "base-speed" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("refuses a lesson the catalogue does not contain, by name", () => {
    const result = compile([{ kind: "explanation", blockId: "how-to-win-every-battle" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.map(denialCode)).toEqual(["IA-3/fabricated-lesson"]);
  });
});

describe("the lazy half of IA-1: a grantless context certifies lessons and nothing else", () => {
  const bare: ManifestContext = { registry: context.registry, pack: context.pack, locale: context.locale, at: context.at };

  it("commits a lessons-only answer with no grant, and the manifest cites none", () => {
    const result = compile([{ kind: "explanation", blockId: "what-is-badge" }], [], bare);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.scopeGrantId).toBeUndefined();
  });

  it("refuses every personalized claim kind by name when no scope is established", () => {
    for (const claim of [
      { kind: "fact", entityId: "pikachu", factId: "base-speed" },
      { kind: "eligibility", entityId: "mewtwo" },
      { kind: "recommendation", entityId: "pikachu" },
      { kind: "action", tool: "catch", entityId: "pikachu" },
    ] as const) {
      const result = compile([claim], [], bare);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.map(denialCode)).toContain("IA-1/scope-not-established");
    }
  });

  it("a grantless verdict may not adopt a granted manifest, nor the reverse", () => {
    const granted = compiled([{ kind: "explanation", blockId: "what-is-badge" }]);
    expect(denialsOf(granted, bare)).toContain("IA-1/scope-grant-mismatch");

    const bareResult = compile([{ kind: "explanation", blockId: "what-is-badge" }], [], bare);
    if (!bareResult.ok) throw new Error("fixture: grantless lesson refused");
    expect(denialsOf(bareResult.value, context)).toContain("IA-1/scope-grant-mismatch");
  });

  it("refuses a routed lesson with no approved text in the answer's locale", () => {
    // Approved words exist in some locale, none in the one this answer is
    // planned for — the same failure an undischargeable disclosure gets.
    const doctored = structuredClone(context.pack);
    const lesson = doctored.curriculum.find((rule) => rule.id === "what-is-badge")!;
    (lesson.block as unknown as { content: { locale: string }[] }).content = lesson.block.content.filter(
      (entry) => entry.locale !== "en-US",
    );
    const manifest = compiled([{ kind: "explanation", blockId: "what-is-badge" }]);
    expect(denialsOf(manifest, { ...context, pack: doctored })).toContain("IA-6/lesson-block-unavailable");
  });
});

it("a grantless draft naming an eligibility leaves the finding underived and refuses by name", () => {
  // deriveClaims must not consult a badge level that does not exist; the
  // claim reaches the checker unfilled and dies at the scope gate instead.
  const bare: ManifestContext = { registry: context.registry, pack: context.pack, locale: context.locale, at: context.at };
  const result = compile([{ kind: "eligibility", entityId: "mewtwo" }], [], bare);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.violations.map(denialCode)).toEqual(["IA-1/scope-not-established"]);
});
