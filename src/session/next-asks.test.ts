import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import type { Claim } from "../kernel/contracts.js";
import { PRECEDENT_SCHEMA_VERSION, type PrecedentStore } from "../memory/precedent.js";
import { answerable, answerSubjects, offerNextAsks, packCandidates, sameAsk } from "./next-asks.js";

const world = harnessWorld();

const pikachuSpeed = { claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }] as Claim[], rosters: [] };
const badgeLesson = { claims: [{ kind: "explanation", blockId: "what-is-badge" }] as Claim[], rosters: [] };
const thunderboltPower = { claims: [{ kind: "fact", entityId: "thunderbolt", factId: "move-power" }] as Claim[], rosters: [] };

describe("the answerable check: a suggestion is shown only when the records would answer it (docs/suggestions.md)", () => {
  it("drops what the model suggested on the live page that nothing in the pack answers — the dogfood dead ends", () => {
    // Each of these was shown to a visitor between 2026-09-06 and 09-20;
    // "which ones are rare?" was clicked and answered with twelve starter facts.
    for (const text of ["which ones are rare?", "what are good places to train my team?", "do evolved Pokémon perform better in battle?", "what can I do with them?", "How do I earn one?"]) {
      expect({ text, read: answerable(world, badgeLesson, text) }).toEqual({ text, read: { kind: "none", reason: "asks for nothing the lessons cover or the records certify" } });
    }
  });

  it("keeps what a lesson covers — read by the same alias matcher the lesson door uses", () => {
    expect(answerable(world, badgeLesson, "what are types for?")).toMatchObject({ kind: "lesson", lessonIds: expect.arrayContaining(["what-is-type"]) });
    expect(answerable(world, badgeLesson, "how do I catch Pokémon?")).toMatchObject({ kind: "lesson", lessonIds: expect.arrayContaining(["how-catch"]) });
    expect(answerable(world, badgeLesson, "what should I do first?")).toMatchObject({ kind: "lesson", lessonIds: expect.arrayContaining(["first-steps"]) });
  });

  it("keeps a field asked about the answer's subject, and drops the same field asked about no one", () => {
    expect(answerable(world, pikachuSpeed, "how does its speed compare to others?")).toEqual({ kind: "field", fieldId: "base-speed" });
    expect(answerable(world, pikachuSpeed, "What is it weak to?")).toEqual({ kind: "field", fieldId: "type-chart" });
    expect(answerable(world, thunderboltPower, "how accurate is it?")).toEqual({ kind: "field", fieldId: "move-accuracy" });
    // A species field beside a move answer: "it" is the move, which has no speed.
    expect(answerable(world, thunderboltPower, "how fast is it?")).toEqual({ kind: "none", reason: "asks for Speed of a species the answer did not name" });
    expect(answerable(world, badgeLesson, "how fast is it?")).toEqual({ kind: "none", reason: "asks for Speed of a species the answer did not name" });
  });

  it("never answers with the boundary lesson", () => {
    const boundary = world.pack.recordsBoundary!.lessonId;
    for (const [, entry] of Object.entries(world.pack.presentation.nextAsks!.lessons)) {
      const read = answerable(world, badgeLesson, entry.ask);
      expect(read.kind).toBe("lesson");
      if (read.kind === "lesson") expect(read.lessonIds).not.toContain(boundary);
    }
  });

  it("reads subjects from the claims through the registry, so a stray id names nothing", () => {
    const draft = { claims: [{ kind: "fact", entityId: "not-a-species", factId: "base-speed" }, ...pikachuSpeed.claims] as Claim[], rosters: [] };
    expect(answerSubjects(world.registry, draft)).toEqual({ species: ["pikachu"], moves: [], items: [] });
  });
});

describe("the pack's own next steps", () => {
  it("after a lesson: the lessons the pack declares follow it, by their own wordings, never one just taught", () => {
    const both = { claims: [{ kind: "explanation", blockId: "what-is-badge" }, { kind: "explanation", blockId: "what-is-gym-leader" }] as Claim[], rosters: [] };
    // Badge → gym leader (taught), league, objective; gym leader → badge
    // (taught), league (already listed), types.
    expect(packCandidates(world, both).map((one) => one.text)).toEqual(["what is the League?", "what is the goal of the game?", "what do types do?"]);
  });

  it("after facts about one subject: its other fields, the ones the operator's memory has answered for it first", () => {
    const plain = packCandidates(world, pikachuSpeed).map((one) => one.text);
    expect(plain[0]).toBe("what type is it?");
    expect(plain).not.toContain("how fast is it?");
    expect(plain).not.toContain("how much power does it have?");
    const store: PrecedentStore = {
      schemaVersion: PRECEDENT_SCHEMA_VERSION,
      packId: world.pack.id,
      precedents: [
        {
          id: "p-1",
          snapshotId: world.registry.snapshot.id,
          ask: "Where can I find Pikachu?",
          shape: { claims: [{ kind: "fact", entityId: "pikachu", factId: "locations" }], rosters: [] },
          source: { kind: "bank-run", artifact: "runs/x.json", transactionId: "t" },
          promoted: { by: "oracle", at: "2026-09-20T00:00:00.000Z" },
        },
        {
          id: "p-2",
          snapshotId: "another-snapshot",
          ask: "What type is Pikachu?",
          shape: { claims: [{ kind: "fact", entityId: "pikachu", factId: "types" }], rosters: [] },
          source: { kind: "bank-run", artifact: "runs/x.json", transactionId: "t" },
          promoted: { by: "oracle", at: "2026-09-20T00:00:00.000Z" },
        },
      ],
    };
    const remembered = packCandidates(world, pikachuSpeed, { store }).map((one) => one.text);
    // The remembered field leads; the other snapshot's precedent counts for nothing.
    expect(remembered[0]).toBe("where can I find it?");
    expect(remembered[1]).toBe("what type is it?");
  });

  it("after facts about the same two subjects: the pair on the fields not certified for both; nothing after none", () => {
    const two = { claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }, { kind: "fact", entityId: "charmander", factId: "base-speed" }] as Claim[], rosters: [] };
    const texts = packCandidates(world, two).map((one) => one.text);
    expect(texts[0]).toBe("what are their types?");
    expect(texts).not.toContain("which of the two is faster?");
    expect(texts).not.toContain("how fast is it?");
    expect(packCandidates(world, { claims: [], rosters: [] })).toEqual([]);
  });

  it("never steps back: a lesson taught or a field certified earlier in the session is not offered again", () => {
    const history = { lessons: ["how-to-play"], fields: [{ entityId: "pikachu", factId: "types" }] };
    const lesson = { claims: [{ kind: "explanation", blockId: "what-is-game" }] as Claim[], rosters: [] };
    expect(packCandidates(world, lesson, { history }).map((one) => one.text)).toEqual(["what is the goal of the game?", "what is a Pokémon?"]);
    const facts = packCandidates(world, pikachuSpeed, { history }).map((one) => one.text);
    expect(facts).not.toContain("what type is it?");
    expect(facts[0]).toBe("what does it evolve into?");
  });

  it("after the records-boundary lesson — a decline — the pack's own way back in", () => {
    const boundary = { claims: [{ kind: "explanation", blockId: world.pack.recordsBoundary!.lessonId }] as Claim[], rosters: [] };
    expect(packCandidates(world, boundary).map((one) => one.text)).toEqual(["what can I ask you?", "what is this game?"]);
    expect(offerNextAsks(world, boundary, []).kept.map((one) => one.source)).toEqual(["pack", "pack"]);
  });

  it("a pack without the table offers nothing of its own", () => {
    const { nextAsks: _table, ...presentation } = world.pack.presentation;
    const bare = { registry: world.registry, pack: { ...world.pack, presentation } };
    expect(packCandidates(bare, pikachuSpeed)).toEqual([]);
    expect(offerNextAsks(bare, pikachuSpeed, ["What is it weak to?"]).kept.map((one) => one.text)).toEqual(["What is it weak to?"]);
  });
});

describe("the register for one answer", () => {
  it("the model's kept suggestions lead, the pack's fill to the cap, and every drop says why", () => {
    const offer = offerNextAsks(world, pikachuSpeed, ["How does it evolve?", "which ones are rare?", "Does it reach 90?", "how does it evolve?"]);
    expect(offer.kept.map((one) => [one.text, one.source])).toEqual([
      ["How does it evolve?", "model"],
      ["what type is it?", "pack"],
      ["what does it evolve into?", "pack"],
    ]);
    expect(offer.dropped.map((one) => [one.text, one.cause])).toEqual([
      ["which ones are rare?", "unanswerable"],
      ["Does it reach 90?", "value"],
      ["how does it evolve?", "duplicate"],
    ]);
  });

  it("a model suggestion that steps back — the lesson taught, the field certified — is dropped as answered", () => {
    const lesson = { claims: [{ kind: "explanation", blockId: "what-is-type" }] as Claim[], rosters: [] };
    const offer = offerNextAsks(world, lesson, ["what types are there?"], { history: { lessons: ["how-to-play"], fields: [] } });
    expect(offer.dropped[0]).toMatchObject({ text: "what types are there?", cause: "answered" });
    const facts = offerNextAsks(world, pikachuSpeed, ["how fast is it?", "what type is it?"], { history: { lessons: [], fields: [{ entityId: "pikachu", factId: "types" }] } });
    expect(facts.dropped.map((one) => [one.text, one.cause])).toEqual([
      ["how fast is it?", "answered"],
      ["what type is it?", "answered"],
    ]);
  });

  it("a text shown or asked earlier is not offered again", () => {
    const offer = offerNextAsks(world, pikachuSpeed, ["What type is it?"], { excluded: ["what type is it?", "What does it evolve into?"] });
    expect(offer.kept.map((one) => one.text)).toEqual(["how does it evolve?", "what is its previous form?", "what is it weak to?"]);
    expect(offer.dropped[0]).toMatchObject({ text: "What type is it?", cause: "duplicate" });
  });

  it("the same question said two ways is one question", () => {
    expect(sameAsk("What type is it?", "what type is it")).toBe(true);
    expect(sameAsk("How do Poké Balls work?", "how do poke balls work?")).toBe(true);
    expect(sameAsk("what type is it?", "what type is that?")).toBe(false);
  });
});
