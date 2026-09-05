import { describe, expect, it } from "vitest";

import type { ManifestContext } from "../kernel/manifest.js";
import { harnessWorld } from "./corpus.js";
import { decodeAnswer } from "./decode.js";
import type { FillerKind } from "./grammar-gate.js";
import { COMPARABLE_FACT_IDS } from "../kernel/registry.js";
import { NO_FIELD } from "../kernel/pack.js";
import { answerSchema, FACT_IDS, MAX_ANSWER_CLAIMS, MAX_ANSWER_ROSTERS, MAX_ASKED } from "./schema.js";

const world = harnessWorld();
const context = {
  registry: world.registry,
  pack: world.pack,
  grant: {
    id: "grant-test",
    packId: world.pack.id,
    scope: { version: "red-blue", region: "kanto", badgeLevel: 8 },
    bindings: [],
    evidenceDigest: "sha256:unused",
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
  },
  locale: "en-US",
  at: "2026-01-01T00:00:00Z",
} as ManifestContext;

/** The `kind` literals a discriminated union in the schema offers. */
function kindsOf(node: unknown): string[] {
  const variants = (node as { anyOf?: { properties?: { kind?: { enum?: string[] } } }[] }).anyOf ?? [];
  return variants.map((entry) => entry.properties?.kind?.enum?.[0]).filter((kind): kind is string => kind !== undefined);
}

const ANSWER_SCHEMA = answerSchema(world.pack);
const properties = (ANSWER_SCHEMA as { properties: Record<string, { items: unknown }> }).properties;
const claimKinds = kindsOf(properties.claims?.items);
const criterionKinds = kindsOf(
  ((properties.rosters?.items as { properties?: { criteria?: { properties?: { all?: { items?: unknown } } } } })
    ?.properties?.criteria?.properties?.all?.items),
);

const claimKindsWith = (filler?: ReadonlySet<FillerKind>) =>
  kindsOf((answerSchema(world.pack, filler) as { properties: { claims: { items: unknown } } }).properties.claims.items);

describe("the answer grammar is bounded (docs/scale.md, S1)", () => {
  it("caps claims and rosters so a repetition loop is unrepresentable, not merely discouraged", () => {
    const arrays = (ANSWER_SCHEMA as { properties: Record<string, { maxItems?: number }> }).properties;
    expect(arrays.claims?.maxItems).toBe(MAX_ANSWER_CLAIMS);
    expect(arrays.rosters?.maxItems).toBe(MAX_ANSWER_ROSTERS);
    // The budget is a usefulness dial, but it must stay a budget: wide enough
    // for the broadest honest answer observed (~8 distinct claims), finite
    // always. A raise is fine; a removal re-opens the 43-second loop.
    expect(MAX_ANSWER_CLAIMS).toBeGreaterThanOrEqual(8);
    expect(Number.isFinite(MAX_ANSWER_CLAIMS)).toBe(true);
    expect(MAX_ANSWER_ROSTERS).toBeGreaterThanOrEqual(2);
  });
});

describe("retrieval-gated grammar narrows only the filler kinds (§19)", () => {
  it("offers all three filler kinds when ungated — the default and every non-retrieval path", () => {
    for (const kind of ["count", "typeCount", "gameRule"]) expect(claimKinds).toContain(kind);
  });

  it("offers only the filler kinds a question nominated", () => {
    const only = claimKindsWith(new Set<FillerKind>(["count"]));
    expect(only).toContain("count");
    expect(only).not.toContain("typeCount");
    expect(only).not.toContain("gameRule");
  });

  it("with an empty nomination withholds all three filler kinds — but keeps every other kind (the safety invariant)", () => {
    const none = claimKindsWith(new Set<FillerKind>());
    for (const filler of ["count", "typeCount", "gameRule"]) expect(none).not.toContain(filler);
    // The gated advice and the action MUST stay representable, or the safety
    // test goes vacuous (finding #7, schema.ts's load-bearing rule); and every
    // entity/relation kind stays, so any answerable can still be attempted.
    for (const kept of ["fact", "membership", "ranking", "matchup", "eligibility", "explanation", "recommendation", "action"]) {
      expect(none).toContain(kept);
    }
  });
});

describe("the answer grammar tracks the kernel, not a copy of it", () => {
  it("offers exactly the fact ids the registry certifies, species and move alike", () => {
    // The enum is what makes "national-dex-number" unrepresentable rather than
    // merely discouraged; if the registry grows a fact, this fails until the
    // grammar is widened in the same commit.
    const factClaim = (
      properties.claims?.items as { anyOf: { properties: Record<string, { enum?: string[] }> }[] }
    ).anyOf.find((entry) => entry.properties.kind?.enum?.[0] === "fact");
    expect(factClaim?.properties.factId?.enum).toEqual([...FACT_IDS]);
  });

  it("offers every claim kind the decoder accepts, so the grammar narrows nothing", () => {
    expect(new Set(claimKinds)).toEqual(
      new Set(["fact", "count", "typeCount", "gameRule", "membership", "ranking", "matchup", "eligibility", "explanation", "recommendation", "action"]),
    );
  });

  it("offers the schema linking as an `asked` array over exactly the dictionary's fields, plus the reserved none", () => {
    // The enum is built from the pack's data dictionary at call time, like
    // lesson and rule ids: a field the dictionary does not describe is
    // unrepresentable, and the reserved word is the honest "no such field".
    const asked = properties.asked as { maxItems: number; items: { properties: Record<string, { enum?: string[] }>; required: string[] } };
    expect(asked.maxItems).toBe(MAX_ASKED);
    expect(asked.items.required).toEqual(["phrase", "entityId", "fieldId"]);
    expect(asked.items.properties.fieldId?.enum).toEqual([...world.pack.dictionary.map((entry) => entry.id), NO_FIELD]);
    // The control arm links nothing: an empty dictionary offers no array.
    const bare = answerSchema({ curriculum: [], gameRules: [], dictionary: [] }) as { properties: Record<string, unknown> };
    expect(bare.properties.asked).toBeUndefined();
  });

  it("offers exactly the lessons the pack teaches, so a fabricated one is unrepresentable", () => {
    const lessonClaim = (
      properties.claims?.items as { anyOf: { properties: Record<string, { enum?: string[] }> }[] }
    ).anyOf.find((entry) => entry.properties.kind?.enum?.[0] === "explanation");
    expect(lessonClaim?.properties.blockId?.enum).toEqual(world.pack.curriculum.map((entry) => entry.id));
  });

  it("offers no explanation shape at all for a pack that teaches nothing", () => {
    // An empty enum is a schema some providers reject wholesale; the variant
    // vanishes with the catalogue instead.
    const bare = answerSchema({ curriculum: [], gameRules: [], dictionary: [] }) as { properties: Record<string, { items: unknown }> };
    expect(kindsOf(bare.properties.claims?.items)).not.toContain("explanation");
    expect(kindsOf(bare.properties.claims?.items)).not.toContain("gameRule");
  });

  it("keeps a forbidden act representable — a grammar that cannot express one makes the gate vacuous", () => {
    // The corpus does not ask for an action, but a model must still be *able* to
    // propose one: safety proven only because the attempt was impossible is not
    // safety proven at all.
    expect(claimKinds).toContain("action");
  });

  it("offers every roster criterion the kernel can build — species criteria here, item criteria only in a world with items", () => {
    expect(new Set(criterionKinds)).toEqual(
      new Set(["has-type", "learns-move", "rarity", "stat-at-least", "stat-at-most"]),
    );
    // The Center loop's first lesson: the kernel had item rosters for a full
    // paid run before the grammar offered them, and the model improvised
    // treats enumerations where "the set of items that cure poison" was the
    // answer. Loop 2 split the roster into two domain variants — a species
    // roster and an item roster, each with only its own criteria — so
    // criteria-domain-mixed is unrepresentable at decode (5 of the re-run's
    // abstentions were mixed rosters refused whole). The pins run both ways.
    const withItems = answerSchema(world.pack, undefined, true) as { properties: Record<string, { items: unknown }> };
    const rosterVariants = (withItems.properties.rosters?.items as { anyOf?: unknown[] })?.anyOf ?? [];
    expect(rosterVariants).toHaveLength(2);
    const criteriaOf = (node: unknown): string[] =>
      kindsOf(
        (node as { properties?: { criteria?: { properties?: { all?: { items?: unknown } } } } })?.properties?.criteria
          ?.properties?.all?.items,
      );
    expect(new Set(criteriaOf(rosterVariants[0]))).toEqual(
      new Set(["has-type", "learns-move", "rarity", "stat-at-least", "stat-at-most"]),
    );
    expect(new Set(criteriaOf(rosterVariants[1]))).toEqual(
      new Set(["item-category", "treats-condition", "cost-at-most", "cost-at-least"]),
    );
  });

  it("closes the world vocabularies when a registry supplies them — an invented type or category is unrepresentable", () => {
    const closed = answerSchema(world.pack, undefined, true, {
      types: ["electric", "water"],
      itemCategories: ["status-cures", "vitamins"],
    }) as { properties: Record<string, { items: unknown }> };
    const variants = (closed.properties.rosters?.items as { anyOf: unknown[] }).anyOf;
    const enumOf = (node: unknown, kind: string, field: string): unknown => {
      const all = (node as { properties?: { criteria?: { properties?: { all?: { items?: { anyOf?: { properties?: Record<string, { enum?: string[] }> }[] } } } } } })
        ?.properties?.criteria?.properties?.all?.items?.anyOf ?? [];
      return all.find((v) => v.properties?.kind?.enum?.[0] === kind)?.properties?.[field]?.enum;
    };
    expect(enumOf(variants[0], "has-type", "type")).toEqual(["electric", "water"]);
    expect(enumOf(variants[1], "item-category", "category")).toEqual(["status-cures", "vitamins"]);
  });

  it("offers comparisons only over fact ids that can be numeric", () => {
    // The first paid Center run: 80+ named denials for comparing prose with
    // prose (cures, item-effect, evolves) — every one preventable at the
    // grammar, none of them a loss (nothing numeric was there to compare).
    const withItems = answerSchema(world.pack, undefined, true) as { properties: Record<string, { items: unknown }> };
    const comparison = (withItems.properties.claims?.items as { anyOf: { properties: Record<string, { enum?: string[] }> }[] })
      .anyOf.find((entry) => entry.properties.kind?.enum?.[0] === "comparison");
    expect(comparison?.properties.factId?.enum).toEqual([...COMPARABLE_FACT_IDS]);
    // …and the runtime gate stays reachable: "can be numeric" is not "always
    // is" (restores-hp is the text "full" for a Full Restore), so the enum
    // does not make IA-2/incomparable-fact vacuous.
    expect(COMPARABLE_FACT_IDS).toContain("restores-hp");
  });
});

describe("the grammar is portable across providers", () => {
  it("gives every node an explicit type, which strict mode requires", () => {
    // A bare `{const: "fact"}` is legal JSON Schema and one provider took it;
    // another rejected the whole document — a 400 on every call, which the run
    // then reports as a total outage. Cheap to assert, expensive to rediscover.
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (node === null || typeof node !== "object") return;
      const schema = node as Record<string, unknown>;
      if (Array.isArray(schema.anyOf)) {
        schema.anyOf.forEach((entry, index) => walk(entry, `${path}.anyOf[${index}]`));
        return;
      }
      if (schema.type === undefined) offenders.push(path);
      for (const [key, value] of Object.entries((schema.properties ?? {}) as Record<string, unknown>)) {
        walk(value, `${path}.${key}`);
      }
      if (schema.items !== undefined) walk(schema.items, `${path}[]`);
    };
    walk(ANSWER_SCHEMA, "answer");
    expect(offenders).toEqual([]);
  });
});

describe("anything the grammar admits, the decoder reads", () => {
  it("decodes one well-formed instance of every claim kind", () => {
    const claims = [
      { kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } },
      // The grounded fact shape: name it, and the kernel reads the value.
      { kind: "fact", entityId: "surf", factId: "machine" },
      { kind: "count", rosterId: "electric", reported: 9 },
      { kind: "typeCount" },
      { kind: "gameRule", ruleId: "party-size" },
      { kind: "membership", rosterId: "electric", entityId: "pikachu", asserted: true },
      { kind: "ranking", rosterId: "electric", basis: "base-speed", direction: "highest", selectedEntityId: "electrode" },
      { kind: "matchup", subject: { kind: "species", entityId: "gengar" }, direction: "weak-to" },
      { kind: "eligibility", entityId: "mewtwo" },
      { kind: "explanation", blockId: "what-is-badge" },
      { kind: "recommendation", entityId: "pikachu" },
      { kind: "action", tool: "catch", entityId: "pikachu" },
    ];
    // Sets, not arrays: the fact kind appears twice in the grammar (with and
    // without an asserted value), which is one kind offered two ways.
    expect(new Set(claims.map((claim) => claim.kind))).toEqual(new Set(claimKinds));

    // The schema linking rides beside the claims (R3b): a field, and the
    // reserved none for a thing the records do not hold.
    const asked = [
      { phrase: "speed", entityId: "pikachu", fieldId: "base-speed" },
      { phrase: "height", entityId: "onix", fieldId: NO_FIELD },
    ];
    const decoded = decodeAnswer(JSON.stringify({ asked, rosters: [], claims }), context, "txn-schema");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.draft.claims).toHaveLength(claims.length);
      expect(decoded.asked).toEqual([
        { phrase: "speed", entityId: "pikachu", fieldId: "base-speed" },
        { phrase: "height", entityId: "onix", fieldId: null },
      ]);
      expect(decoded.unavailable).toEqual([{ entityId: "onix", asked: "height" }]);
    }
  });

  it("decodes a roster built from every criterion kind", () => {
    // One roster carrying every criterion kind at once, so the fixture stays
    // inside the roster budget (MAX_ANSWER_ROSTERS) without giving up
    // per-kind coverage — criteria compose with "all", and each kind must
    // decode inside the composition.
    const rosters = [
      {
        id: "everything",
        criteria: {
          all: [
            { kind: "has-type", type: "electric" },
            { kind: "learns-move", move: "self-destruct" },
            { kind: "rarity", rarity: "legendary" },
            { kind: "stat-at-least", stat: "speed", value: 100 },
            { kind: "stat-at-most", stat: "speed", value: 130 },
          ],
        },
      },
    ];
    // One claim rides along: an answer with no claims is refused as an
    // abstention, and this test is about the roster criteria.
    const claims = [{ kind: "count", rosterId: "everything" }];
    const decoded = decodeAnswer(JSON.stringify({ rosters, claims }), context, "txn-rosters");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.draft.rosters).toHaveLength(1);
      expect(decoded.draft.rosters[0]?.criteria.all).toHaveLength(5);
    }
  });
});
