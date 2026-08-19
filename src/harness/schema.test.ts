import { describe, expect, it } from "vitest";

import type { ManifestContext } from "../kernel/manifest.js";
import { harnessWorld } from "./corpus.js";
import { decodeAnswer } from "./decode.js";
import { answerSchema, FACT_IDS } from "./schema.js";

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

  it("offers exactly the lessons the pack teaches, so a fabricated one is unrepresentable", () => {
    const lessonClaim = (
      properties.claims?.items as { anyOf: { properties: Record<string, { enum?: string[] }> }[] }
    ).anyOf.find((entry) => entry.properties.kind?.enum?.[0] === "explanation");
    expect(lessonClaim?.properties.blockId?.enum).toEqual(world.pack.curriculum.map((entry) => entry.id));
  });

  it("offers no explanation shape at all for a pack that teaches nothing", () => {
    // An empty enum is a schema some providers reject wholesale; the variant
    // vanishes with the catalogue instead.
    const bare = answerSchema({ curriculum: [], gameRules: [] }) as { properties: Record<string, { items: unknown }> };
    expect(kindsOf(bare.properties.claims?.items)).not.toContain("explanation");
    expect(kindsOf(bare.properties.claims?.items)).not.toContain("gameRule");
  });

  it("keeps a forbidden act representable — a grammar that cannot express one makes the gate vacuous", () => {
    // The corpus does not ask for an action, but a model must still be *able* to
    // propose one: safety proven only because the attempt was impossible is not
    // safety proven at all.
    expect(claimKinds).toContain("action");
  });

  it("offers every roster criterion the kernel can build", () => {
    expect(new Set(criterionKinds)).toEqual(
      new Set(["has-type", "learns-move", "rarity", "stat-at-least", "stat-at-most"]),
    );
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

    const decoded = decodeAnswer(JSON.stringify({ rosters: [], claims }), context, "txn-schema");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.draft.claims).toHaveLength(claims.length);
  });

  it("decodes a roster built from every criterion kind", () => {
    const rosters = [
      { id: "everything", criteria: { all: [{ kind: "has-type", type: "electric" }] } },
      { id: "boomers", criteria: { all: [{ kind: "learns-move", move: "self-destruct" }] } },
      { id: "rare", criteria: { all: [{ kind: "rarity", rarity: "legendary" }] } },
      { id: "brisk", criteria: { all: [{ kind: "stat-at-least", stat: "speed", value: 100 }] } },
      { id: "sluggish", criteria: { all: [{ kind: "stat-at-most", stat: "speed", value: 30 }] } },
    ];
    // One claim rides along: an answer with no claims is refused as an
    // abstention, and this test is about the roster criteria.
    const claims = [{ kind: "count", rosterId: "everything" }];
    const decoded = decodeAnswer(JSON.stringify({ rosters, claims }), context, "txn-rosters");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.draft.rosters).toHaveLength(rosters.length);
  });
});
