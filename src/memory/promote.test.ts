import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import type { ScopeTranscript } from "../kernel/contracts.js";
import { loadPrecedentStore } from "./precedent.js";
import { type PromotableRun, promoteExchange, promoteFromRuns } from "./promote.js";

const world = harnessWorld();
const SNAPSHOT = world.registry.snapshot.id;

const transcript: ScopeTranscript = [
  { kind: "profile", at: "t0", source: "trainer", scope: { version: "red-blue", region: "kanto", badgeLevel: 8 } },
  { kind: "utterance", at: "t1", source: "trainer", text: "What's Pikachu's Speed stat?" },
];

function run(entryId: string, opening: string, claims: unknown[], overrides: Partial<PromotableRun> = {}): PromotableRun {
  return {
    entryId,
    opening,
    stage: { kind: "resolved" },
    score: { pass: true },
    run: {
      transcript,
      transaction: { id: "session-1", snapshotId: SNAPSHOT, outcome: { status: "answered" }, manifest: { claims: claims as never, rosters: [] } },
    },
    ...overrides,
  };
}

const SPEED = run("ans-fact-speed-pikachu", "What's Pikachu's Speed stat?", [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } }]);

describe("promoteFromRuns", () => {
  it("promotes an accepted, oracle-passed run with its values stripped, its entry named, and the profile read from the trainer's channel", () => {
    const promotion = promoteFromRuns([SPEED], { artifact: "runs/coverage/a.json", packId: world.pack.id, at: "2026-09-14T00:00:00.000Z" });
    expect(promotion.added).toEqual(["p-ans-fact-speed-pikachu"]);
    expect(promotion.skipped).toEqual({});
    const [one] = promotion.store.precedents;
    expect(one).toEqual({
      id: "p-ans-fact-speed-pikachu",
      snapshotId: SNAPSHOT,
      ask: "What's Pikachu's Speed stat?",
      profile: { version: "red-blue", region: "kanto", badgeLevel: 8 },
      shape: { claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }], rosters: [] },
      source: { kind: "bank-run", artifact: "runs/coverage/a.json", transactionId: "session-1", entryId: "ans-fact-speed-pikachu" },
      promoted: { by: "oracle", at: "2026-09-14T00:00:00.000Z" },
    });
    // What promotion writes, the loader accepts — the two cannot drift.
    expect(() => loadPrecedentStore(promotion.store, world)).not.toThrow();
  });

  it("leaves out what was not right, by reason, as counts", () => {
    const promotion = promoteFromRuns(
      [
        run("a", "a?", [], { stage: { kind: "denied" } }),
        run("b", "b?", [], { stage: { kind: "abstained-answer" } }),
        run("c", "c?", [{ kind: "explanation", blockId: "what-is-game" }], { score: { pass: false } }),
        run("d", "d?", [], { run: { transcript, transaction: { id: "x", snapshotId: SNAPSHOT, outcome: { status: "denied" } } } }),
        run("e", "e?", [], { run: { transcript } }),
      ],
      { artifact: "a.json", packId: world.pack.id, at: "t" },
    );
    expect(promotion.added).toEqual([]);
    expect(promotion.skipped).toEqual({
      "not resolved (denied)": 1,
      "not resolved (abstained-answer)": 1,
      "resolved, but the oracle did not pass it (off subject or off shape)": 1,
      "no certified manifest on the record": 2,
    });
  });

  it("keeps one precedent per ask — the commonest accepted shape across the passes, the first seen on a tie", () => {
    // The M1 porch reading (findings §21): three shapes of "Tell me
    // everything about Pikachu." crowded k=3 for any ask sharing a word
    // with it. One ask, one shape; the store teaches which door, not every
    // way it was once taken.
    const wide = run("ans-fact-speed-pikachu", "What's Pikachu's Speed stat?", [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }, { kind: "fact", entityId: "pikachu", factId: "types" }]);
    const promotion = promoteFromRuns([wide, SPEED, { ...SPEED, opening: "what's pikachu's speed stat?" }], { artifact: "a.json", packId: world.pack.id, at: "t" });
    expect(promotion.added).toEqual(["p-ans-fact-speed-pikachu"]);
    expect(promotion.skipped).toEqual({ "the same ask accepted again (the commonest shape was kept)": 2 });
    expect(promotion.store.precedents[0]?.shape.claims).toEqual([{ kind: "fact", entityId: "pikachu", factId: "base-speed" }]);
    // A tie keeps the first seen, so the store replays from the artifact.
    const tied = promoteFromRuns([wide, SPEED], { artifact: "a.json", packId: world.pack.id, at: "t" });
    expect(tied.store.precedents[0]?.shape.claims).toHaveLength(2);
  });

  it("merges into an existing store: an ask already held is left as it is, and a second entry with the same ask is numbered", () => {
    const first = promoteFromRuns([SPEED], { artifact: "a.json", packId: world.pack.id, at: "t" });
    const again = promoteFromRuns(
      [
        SPEED,
        run("ans-fact-speed-pikachu", "What's Pikachu's Speed stat?", [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }, { kind: "fact", entityId: "pikachu", factId: "types" }]),
        run("ans-fact-types-pikachu", "What type is Pikachu?", [{ kind: "fact", entityId: "pikachu", factId: "types" }]),
      ],
      { artifact: "b.json", packId: world.pack.id, at: "t2", existing: first.store },
    );
    expect(again.added).toEqual(["p-ans-fact-types-pikachu"]);
    expect(again.skipped).toEqual({ "already in the store (same ask)": 2 });
    expect(again.store.precedents.map((one) => one.id)).toEqual(["p-ans-fact-speed-pikachu", "p-ans-fact-types-pikachu"]);
    expect(again.store.precedents[0]?.source.artifact).toBe("a.json");
    // Two entries worded alike: the second's id is numbered, never dropped.
    const alike = promoteFromRuns(
      [run("ans-one", "How fast is Pikachu?", [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }]), run("ans-two", "how fast is pikachu?", [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }])],
      { artifact: "c.json", packId: world.pack.id, at: "t" },
    );
    expect(alike.added).toEqual(["p-ans-one"]);
  });

  it("promotes a session exchange the same way, without a profile when none was set", () => {
    const one = promoteExchange({
      id: "p-session-3",
      ask: "tell me about the game",
      transcript: [{ kind: "utterance", at: "t", source: "trainer", text: "tell me about the game" }],
      transaction: { id: "session-3", snapshotId: SNAPSHOT, manifest: { claims: [{ kind: "explanation", blockId: "what-is-game" }], rosters: [] } },
      source: { kind: "session", artifact: ".dev-trace.jsonl", transactionId: "session-3" },
      promoted: { by: "reviewer", at: "t" },
    });
    expect(one.profile).toBeUndefined();
    expect(one.shape.claims).toEqual([{ kind: "explanation", blockId: "what-is-game" }]);
    expect(one.source.kind).toBe("session");
  });
});
