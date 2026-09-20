import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import type { Claim } from "../kernel/contracts.js";
import {
  askTokens,
  canonicalShape,
  claimShape,
  DEFAULT_PRECEDENT_LEVERS,
  fixedPrecedents,
  followed,
  loadPrecedentStore,
  overlap,
  type Precedent,
  type PrecedentStore,
  precedentStoreDigest,
  renderShape,
  retrievePrecedents,
  shapeOf,
} from "./precedent.js";

const world = harnessWorld();
const SNAPSHOT = world.registry.snapshot.id;

function precedent(id: string, ask: string, claims: readonly Claim[], extra: Partial<Precedent> = {}): Precedent {
  return {
    id,
    snapshotId: SNAPSHOT,
    ask,
    shape: shapeOf({ claims, rosters: [] }),
    source: { kind: "bank-run", artifact: "runs/coverage/test.json", transactionId: `txn-${id}` },
    promoted: { by: "oracle", at: "2026-09-14T00:00:00.000Z" },
    ...extra,
  };
}

const GAME = precedent("p-game", "tell me about the game", [{ kind: "explanation", blockId: "what-is-game" }]);
const SPEED = precedent("p-speed", "what is pikachu's speed", [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } }]);
const CATCH = precedent("p-catch", "how do I catch one?", [{ kind: "explanation", blockId: "how-catch" }]);

function store(precedents: readonly Precedent[]): PrecedentStore {
  return { schemaVersion: 1, packId: world.pack.id, precedents };
}

describe("shapeOf", () => {
  it("keeps kinds and ids and drops every value", () => {
    const claims: Claim[] = [
      { kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } },
      { kind: "count", rosterId: "r", reported: 151 },
      { kind: "ranking", rosterId: "r", basis: "base-speed", direction: "highest", selectedEntityId: "electrode" },
      { kind: "matchup", subject: { kind: "species", entityId: "gengar" }, direction: "weak-to", members: ["ghost"] },
      { kind: "eligibility", entityId: "mewtwo", finding: { eligible: false, badgeLevel: 2 } },
      { kind: "membership", rosterId: "r", entityId: "pikachu", asserted: true },
      { kind: "comparison", factId: "base-speed", leftId: "pikachu", rightId: "raichu", left: { kind: "number", value: 90 } },
    ];
    expect(shapeOf({ claims, rosters: [] }).claims).toEqual([
      { kind: "fact", entityId: "pikachu", factId: "base-speed" },
      { kind: "count", rosterId: "r" },
      { kind: "ranking", rosterId: "r", basis: "base-speed", direction: "highest" },
      { kind: "matchup", subject: { kind: "species", entityId: "gengar" }, direction: "weak-to" },
      { kind: "eligibility", entityId: "mewtwo" },
      { kind: "membership", rosterId: "r", entityId: "pikachu" },
      { kind: "comparison", factId: "base-speed", leftId: "pikachu", rightId: "raichu" },
    ]);
    expect(JSON.stringify(shapeOf({ claims, rosters: [] }))).not.toMatch(/asserted|reported|selectedEntityId|"members"|finding|"left"/);
  });

  it("keeps a roster's criteria (the question's parameters) and a served route's arguments", () => {
    const shape = shapeOf(
      { claims: [{ kind: "count", rosterId: "electric" }], rosters: [{ id: "electric", snapshotId: SNAPSHOT, criteria: { all: [{ kind: "has-type", type: "electric" }] }, memberIds: ["pikachu"], cardinality: 1 }] },
      { routeId: "listing", args: { subject: "catalogue", n: 10 } },
    );
    expect(shape.rosters).toEqual([{ id: "electric", criteria: { all: [{ kind: "has-type", type: "electric" }] } }]);
    expect(shape.route).toEqual({ routeId: "listing", args: { subject: "catalogue", n: 10 } });
    expect(renderShape(shape)).toBe('{"claims":[{"kind":"route","routeId":"listing","subject":"catalogue","n":10},{"kind":"count","rosterId":"electric"}],"rosters":[{"id":"electric","criteria":{"all":[{"kind":"has-type","type":"electric"}]}}]}');
  });

  it("an unknown kind keeps only its kind", () => {
    expect(claimShape({ kind: "mystery", secret: 1 } as unknown as Claim)).toEqual({ kind: "mystery" });
  });
});

describe("canonicalShape", () => {
  it("reads two shapes as one when only roster names and claim order differ", () => {
    const a = shapeOf({
      claims: [{ kind: "count", rosterId: "all-pokemon" }, { kind: "explanation", blockId: "what-is-game" }],
      rosters: [{ id: "all-pokemon", snapshotId: SNAPSHOT, criteria: { all: [] }, memberIds: [], cardinality: 0 }],
    });
    const b = shapeOf({
      claims: [{ kind: "explanation", blockId: "what-is-game" }, { kind: "count", rosterId: "all_pokemon", reported: 151 }],
      rosters: [{ id: "all_pokemon", snapshotId: SNAPSHOT, criteria: { all: [] }, memberIds: [], cardinality: 0 }],
    });
    expect(canonicalShape(a)).toBe(canonicalShape(b));
    const c = shapeOf({ claims: [{ kind: "count", rosterId: "x" }], rosters: [{ id: "x", snapshotId: SNAPSHOT, criteria: { all: [{ kind: "has-type", type: "fire" }] }, memberIds: [], cardinality: 0 }] });
    expect(canonicalShape(a)).not.toBe(canonicalShape(c));
  });
});

describe("loadPrecedentStore", () => {
  it("accepts a store of value-free shapes the world certifies", () => {
    const loaded = loadPrecedentStore(store([GAME, SPEED, CATCH]), world);
    expect(loaded.precedents).toHaveLength(3);
    expect(precedentStoreDigest(loaded)).toMatch(/^sha256:/);
    expect(precedentStoreDigest(loaded)).toBe(precedentStoreDigest(store([GAME, SPEED, CATCH])));
  });

  it.each([
    ["precedent-schema-unsupported", { ...store([GAME]), schemaVersion: 2 }],
    ["precedent-pack-mismatch", { ...store([GAME]), packId: "another-pack" }],
    ["precedent-store-malformed", { ...store([GAME]), precedents: "none" }],
    ["precedent-unnamed", store([{ ...GAME, id: "" }])],
    ["precedent-duplicate-id", store([GAME, GAME])],
    ["precedent-world-unnamed", store([{ ...GAME, snapshotId: "" }])],
    ["precedent-ask-empty", store([{ ...GAME, ask: "  " }])],
    ["precedent-shape-malformed", store([{ ...GAME, shape: { claims: "x", rosters: [] } as never }])],
    ["precedent-source-missing", store([{ ...GAME, source: {} as never }])],
    ["precedent-unpromoted", store([{ ...GAME, promoted: { by: "model", at: "t" } as never }])],
    ["precedent-unknown-kind", store([{ ...GAME, shape: { claims: [{ kind: "guess" }], rosters: [] } }])],
    ["precedent-value-carried", store([{ ...GAME, shape: { claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } }], rosters: [] } }])],
    ["precedent-uncertified-entity", store([{ ...GAME, shape: { claims: [{ kind: "fact", entityId: "missingno", factId: "base-speed" }], rosters: [] } }])],
    ["precedent-uncertified-entity", store([{ ...GAME, shape: { claims: [{ kind: "matchup", subject: { kind: "type", typeId: "fairy" }, direction: "weak-to" }], rosters: [] } }])],
    ["precedent-uncertified-fact", store([{ ...GAME, shape: { claims: [{ kind: "fact", entityId: "pikachu", factId: "height" }], rosters: [] } }])],
    ["precedent-unknown-block", store([{ ...GAME, shape: { claims: [{ kind: "explanation", blockId: "how-to-cheat" }], rosters: [] } }])],
    ["precedent-unknown-rule", store([{ ...GAME, shape: { claims: [{ kind: "gameRule", ruleId: "no-such-rule" }], rosters: [] } }])],
    ["precedent-unknown-tool", store([{ ...GAME, shape: { claims: [{ kind: "action", tool: "sell", entityId: "pikachu" }], rosters: [] } }])],
    ["precedent-shape-malformed", store([{ ...GAME, shape: { claims: [], rosters: [{ id: "r" }] as never } }])],
    ["precedent-shape-malformed", store([{ ...GAME, shape: { claims: [], rosters: [], route: { args: {} } as never } }])],
  ])("refuses %s by name", (rule, input) => {
    expect(() => loadPrecedentStore(input, world)).toThrow(new RegExp(rule));
  });

  it("refuses something that is not a store at all", () => {
    expect(() => loadPrecedentStore(null, world)).toThrow(/precedent-store-malformed/);
  });
});

describe("retrievePrecedents", () => {
  const all = store([GAME, SPEED, CATCH]);

  it("folds the ask to its carrying words", () => {
    expect([...askTokens("Tell me about THIS game, please!")]).toEqual(["tell", "game"]);
    // A contraction's "'s" folds like a possessive's: the words are read, not parsed.
    expect([...askTokens("what's Pikachu's base-speed?")]).toEqual(["what", "pikachu", "base", "speed"]);
    expect(overlap(new Set(), new Set(["a"]))).toBe(0);
  });

  it("holds the nearest precedents above the threshold, in score order", () => {
    const result = retrievePrecedents(all, "tell me about this game", { snapshotId: SNAPSHOT });
    expect(result.held.map((held) => [held.id, held.score])).toEqual([["p-game", 1]]);
    expect(result.held[0]?.shape.claims).toEqual([{ kind: "explanation", blockId: "what-is-game" }]);
    expect(result.withheld).toEqual([]);
    expect(result.nearestMiss).toBeUndefined();
  });

  it("comes up empty below the threshold and names the nearest miss", () => {
    const result = retrievePrecedents(all, "does pikachu run fast", { snapshotId: SNAPSHOT });
    expect(result.held).toEqual([]);
    expect(result.nearestMiss).toEqual({ id: "p-speed", score: 0.2, ask: "what is pikachu's speed" });
  });

  it("holds nothing when no word is shared", () => {
    const result = retrievePrecedents(all, "weather today", { snapshotId: SNAPSHOT });
    expect(result).toEqual({ held: [], withheld: [] });
  });

  it("never offers a precedent from another snapshot", () => {
    const foreign = store([{ ...GAME, snapshotId: "another-world" }]);
    expect(retrievePrecedents(foreign, "tell me about the game", { snapshotId: SNAPSHOT }).held).toEqual([]);
  });

  it("withholds a precedent made from the entry under test, or worded as it, and says so", () => {
    const fromEntry = { ...GAME, source: { ...GAME.source, entryId: "meta-what-is-game" } };
    const result = retrievePrecedents(store([fromEntry, CATCH]), "tell me about the game", {
      snapshotId: SNAPSHOT,
      holdOut: { entryId: "meta-what-is-game" },
    });
    expect(result.held).toEqual([]);
    expect(result.withheld).toEqual([{ id: "p-game", reason: "made from this same bank entry" }]);
    const worded = retrievePrecedents(all, "tell me about the game", {
      snapshotId: SNAPSHOT,
      holdOut: { entryId: "other", phrasings: ["Tell me about the game"] },
    });
    expect(worded.withheld).toEqual([{ id: "p-game", reason: "its ask is a wording of this same bank entry" }]);
  });

  it("caps at k, ranks a shared subject first among equals, then by id", () => {
    const a = precedent("p-a", "is pikachu fast", [{ kind: "fact", entityId: "raichu", factId: "base-speed" }]);
    const b = precedent("p-b", "is pikachu fast", [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }]);
    const c = precedent("p-c", "is pikachu fast", [{ kind: "fact", entityId: "pikachu", factId: "base-attack" }]);
    const d = precedent("p-d", "is pikachu fast", [{ kind: "explanation", blockId: "what-is-game" }]);
    const result = retrievePrecedents(store([a, b, c, d]), "is pikachu fast?", { snapshotId: SNAPSHOT, entities: new Set(["pikachu"]) });
    expect(result.held.map((held) => held.id)).toEqual(["p-b", "p-c", "p-a"]);
    const two = retrievePrecedents(store([a, b, c, d]), "is pikachu fast?", { snapshotId: SNAPSHOT, levers: { k: 2, threshold: DEFAULT_PRECEDENT_LEVERS.threshold } });
    expect(two.held).toHaveLength(2);
  });

  it("the fixed arm holds the named precedents whatever the ask, skipping unknown ids", () => {
    expect(fixedPrecedents(all, ["p-catch", "p-none", "p-game"], SNAPSHOT).map((held) => [held.id, held.score])).toEqual([["p-catch", 1], ["p-game", 1]]);
    expect(fixedPrecedents(all, ["p-game"], "another-world")).toEqual([]);
  });
});

describe("followed", () => {
  it("names the held precedent whose shape the accepted draft took, or nothing", () => {
    const held = retrievePrecedents(store([GAME, SPEED]), "tell me about the game", { snapshotId: SNAPSHOT }).held;
    expect(followed({ claims: [{ kind: "explanation", blockId: "what-is-game" }], rosters: [] }, held)?.id).toBe("p-game");
    expect(followed({ claims: [{ kind: "explanation", blockId: "how-to-play" }], rosters: [] }, held)).toBeUndefined();
    expect(followed({ claims: [], rosters: [] }, [])).toBeUndefined();
  });
});

describe("the shipped store", () => {
  it("loads under the shipped world, if one is shipped", () => {
    const directory = resolve(import.meta.dirname, "../../data/precedents");
    let files: string[] = [];
    try {
      files = readdirSync(directory).filter((name) => name.endsWith(".json"));
    } catch {
      files = [];
    }
    for (const name of files) {
      const parsed = JSON.parse(readFileSync(resolve(directory, name), "utf8")) as { packId: string };
      if (parsed.packId !== world.pack.id) continue;
      const loaded = loadPrecedentStore(parsed, world);
      expect(loaded.precedents.length).toBeGreaterThan(0);
      for (const entry of loaded.precedents) expect(entry.snapshotId).toBe(SNAPSHOT);
    }
  });
});

describe("the verifier never reads the store", () => {
  it("no kernel module imports from src/memory — a precedent is prompt context, and the verdict never depends on it", () => {
    const kernel = resolve(import.meta.dirname, "../kernel");
    const offenders = readdirSync(kernel)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => /from\s+["'][^"']*memory\//.test(readFileSync(resolve(kernel, name), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("the bare-ask rule (findings §38): an ask naming no certified subject is shown no precedent about one", () => {
  const all = store([GAME, SPEED, CATCH]);

  it("sets aside precedents about a named subject when the caller read the ask and found none, and counts them", () => {
    // "what is the speed" overlaps "what is pikachu's speed" well above the
    // threshold; about Pikachu, it is not offered for an ask about no one.
    const bare = retrievePrecedents(all, "what is the speed", { snapshotId: SNAPSHOT, entities: new Set() });
    expect(bare.held).toEqual([]);
    expect(bare.setAside).toBe(1);
    expect(bare.withheld).toEqual([]);
    expect(bare.nearestMiss).toBeUndefined();
    // The same ask, read as naming Pikachu: offered, and first among equals.
    const named = retrievePrecedents(all, "what is the speed", { snapshotId: SNAPSHOT, entities: new Set(["pikachu"]) });
    expect(named.held.map((held) => held.id)).toEqual(["p-speed"]);
    expect(named.setAside).toBeUndefined();
  });

  it("still offers a lesson for a bare ask, and withholds nothing when the caller never read the ask", () => {
    const bare = retrievePrecedents(all, "tell me about this game", { snapshotId: SNAPSHOT, entities: new Set() });
    expect(bare.held.map((held) => held.id)).toEqual(["p-game"]);
    expect(bare.setAside).toBe(1);
    const unread = retrievePrecedents(all, "what is the speed", { snapshotId: SNAPSHOT });
    expect(unread.held.map((held) => held.id)).toEqual(["p-speed"]);
    expect(unread.setAside).toBeUndefined();
  });
});
