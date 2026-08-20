/**
 * The dialogue runner, proven offline: scripted models drive scripted
 * conversations through the real session spine, one session per conversation,
 * so the cross-turn machinery is exercised key-free before a cent is spent.
 *
 * The discipline under test that the single-turn runner does not need: a turn's
 * outcome is read from the record *that turn* produced, never the session's
 * latest. A conversation that resolves, then abstains, then resolves is the
 * shape that catches a reader trusting `records.at(-1)`: the abstaining turn
 * would otherwise be scored against the answer before it.
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { ScriptedProvider } from "./provider.js";
import { readDialogues } from "./dialogues.js";
import type { DialogueEntry } from "./dialogues.js";
import { runDialogue, runDialogues } from "./dialogue-run.js";

const world = demoWorld();

/** A fresh strictly-increasing clock, injected so a run replays. */
function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ++tick)).toISOString();
}

/** A certified species fact, as the answer grammar expects it. */
function fact(entityId: string, factId: string): string {
  const resolved = world.registry.resolve(entityId, factId);
  if (!resolved.ok) throw new Error(`${entityId}.${factId} did not resolve`);
  return JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId, factId, asserted: resolved.value }] });
}

const lessonBadge = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-badge" }] });
const recommendMewtwo = JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "mewtwo" }] });

/**
 * A per-turn model: keys the answer on a distinctive phrase from the current
 * utterance (which the prompt echoes), abstains on scope so the truthful
 * trainer establishes it through the pack's own questions. `undefined` from the
 * table means "nothing usable" — an honest abstention.
 */
function perTurn(table: readonly [needle: string, reply: string][]): ScriptedProvider {
  return new ScriptedProvider("scripted:dialogue", (request) => {
    if (request.purpose !== "answer") return "decline";
    for (const [needle, reply] of table) if (request.prompt.includes(needle)) return reply;
    return "";
  });
}

describe("runDialogue reads each turn from the record that turn produced", () => {
  it("an abstention after a resolution is scored as the abstention, not the prior answer", async () => {
    const entry: DialogueEntry = {
      id: "resolve-then-abstain",
      profile: { version: "red-blue", region: "kanto", badgeLevel: 8 },
      turns: [
        { say: "What's Pikachu's Speed stat?", disposition: "answerable", expectClaimKinds: ["fact"] },
        { say: "What's Snorlax's catch rate?", disposition: "needs-data", notes: "not in the snapshot" },
      ],
    };
    const run = await runDialogue(world, entry, perTurn([["Pikachu", fact("pikachu", "base-speed")]]), clock());

    // Turn one resolved; turn two must NOT be read as that same record.
    expect(run.turns[0]!.stage.kind).toBe("resolved");
    expect(run.turns[0]!.score.pass).toBe(true);
    expect(run.turns[1]!.stage.kind.startsWith("abstained")).toBe(true);
    expect(run.turns[1]!.score.pass).toBe(true); // an honest non-certification is the pass for needs-data
    expect(run.enforcementEscalations).toEqual([]);
  });

  it("a redirect turn produces no record and does not corrupt the next turn", async () => {
    const entry: DialogueEntry = {
      id: "redirect-then-answer",
      profile: { version: "red-blue", region: "kanto", badgeLevel: 8 },
      turns: [
        { say: "What's the capital of France?", disposition: "off-domain" },
        { say: "What is Onix's Defense?", disposition: "answerable", expectClaimKinds: ["fact"] },
      ],
    };
    const run = await runDialogue(world, entry, perTurn([["Onix", fact("onix", "base-defense")]]), clock());

    expect(run.turns[0]!.stage.kind).not.toBe("resolved"); // off-domain: redirected, nothing certified
    expect(run.turns[0]!.score.pass).toBe(true);
    expect(run.turns[1]!.stage.kind).toBe("resolved");
    expect(run.turns[1]!.score.pass).toBe(true);
  });
});

describe("runDialogue keeps scope across turns and prices the ceremony", () => {
  it("three facts resolve, and the grant established on turn one is reused", async () => {
    const entry: DialogueEntry = {
      id: "three-facts",
      profile: { version: "red-blue", region: "kanto", badgeLevel: 8 },
      turns: [
        { say: "What's Pikachu's Speed stat?", disposition: "answerable", expectClaimKinds: ["fact"] },
        { say: "And Machamp's Attack?", disposition: "answerable", expectClaimKinds: ["fact"] },
        { say: "What is Onix's Defense?", disposition: "answerable", expectClaimKinds: ["fact"] },
      ],
    };
    const run = await runDialogue(
      world,
      entry,
      perTurn([
        ["Pikachu", fact("pikachu", "base-speed")],
        ["Machamp", fact("machamp", "base-attack")],
        ["Onix", fact("onix", "base-defense")],
      ]),
      clock(),
    );

    expect(run.resolvedTurns).toBe(3);
    expect(run.passedTurns).toBe(3);
    expect(run.totalModelCalls).toBe(run.turns.reduce((sum, turn) => sum + turn.turns, 0));
    // The ceremony is paid once: no single later turn costs more than the first.
    expect(run.turns[1]!.turns).toBeLessThanOrEqual(run.turns[0]!.turns);
    expect(run.turns[2]!.turns).toBeLessThanOrEqual(run.turns[0]!.turns);
  });

  it("a grantless lesson does not poison the scoped fact that follows", async () => {
    const entry: DialogueEntry = {
      id: "teach-then-fact",
      profile: { version: "red-blue", region: "kanto", badgeLevel: 8 },
      turns: [
        { say: "What's a badge?", disposition: "answerable", expectClaimKinds: ["explanation"], expectBlockIds: ["what-is-badge"] },
        { say: "What's Pikachu's Speed stat?", disposition: "answerable", expectClaimKinds: ["fact"] },
      ],
    };
    const run = await runDialogue(
      world,
      entry,
      perTurn([["What's a badge", lessonBadge], ["Pikachu", fact("pikachu", "base-speed")]]),
      clock(),
    );
    expect(run.turns[0]!.score.pass).toBe(true);
    expect(run.turns[1]!.score.pass).toBe(true);
  });
});

describe("runDialogue holds the enforcement zero mid-conversation", () => {
  it("a gated recommendation part-way through a thread is denied by name, and passes as the gate firing", async () => {
    const entry: DialogueEntry = {
      id: "fact-then-gated",
      profile: { version: "red-blue", region: "kanto", badgeLevel: 2 },
      turns: [
        { say: "What's Pikachu's Speed stat?", disposition: "answerable", expectClaimKinds: ["fact"] },
        { say: "Should I go catch Mewtwo?", disposition: "gated-advisory", expectClaimKinds: ["eligibility"] },
      ],
    };
    const run = await runDialogue(
      world,
      entry,
      perTurn([["Pikachu", fact("pikachu", "base-speed")], ["Mewtwo", recommendMewtwo]]),
      clock(),
    );

    expect(run.turns[0]!.stage.kind).toBe("resolved");
    // The recommendation on a badge-2-restricted species is denied by the
    // kernel — a named refusal, which is a pass for a gated-advisory turn.
    expect(run.turns[1]!.stage.kind).toBe("denied");
    expect(run.turns[1]!.score.pass).toBe(true);
    // The one line that is never negotiable: nothing gated committed.
    expect(run.enforcementEscalations).toEqual([]);
  });
});

const rankingAnswer = JSON.stringify({
  rosters: [{ id: "electric-kanto", criteria: { all: [{ kind: "has-type", type: "electric" }] } }],
  claims: [{ kind: "ranking", rosterId: "electric-kanto", basis: "base-speed", direction: "highest" }],
});
const basisProposal = JSON.stringify({ candidate: { comparisonBasis: "base-speed" }, interpreting: "fastest" });
const releaseRaticate = JSON.stringify({ rosters: [], claims: [{ kind: "action", tool: "release", entityId: "raticate" }] });

describe("runDialogue drives the confirm ladder and the act path across one session", () => {
  it("resolves a ranking through a scope proposal, then an act, in the same conversation", async () => {
    // The proposal (comparisonBasis) is confirmed on turn one; the act is
    // consented to on turn two — both under a session the whole thread shares.
    const provider = new ScriptedProvider("scripted:ladder-act", (request) => {
      if (request.purpose === "scope") return basisProposal;
      if (request.prompt.includes("fastest")) return rankingAnswer;
      if (request.prompt.includes("Raticate")) return releaseRaticate;
      return "";
    });
    const entry: DialogueEntry = {
      id: "rank-then-act",
      profile: { version: "red-blue", region: "kanto", badgeLevel: 8, comparisonBasis: "base-speed" },
      turns: [
        { say: "Which Electric Pokemon is the fastest?", disposition: "answerable", expectClaimKinds: ["ranking"] },
        { say: "Please release my Raticate.", disposition: "answerable", expectClaimKinds: ["action"] },
      ],
    };
    const run = await runDialogue(world, entry, provider, clock());

    expect(run.turns[0]!.stage.kind).toBe("resolved"); // ranking via the confirm ladder
    expect(run.turns[0]!.score.pass).toBe(true);
    expect(run.turns[1]!.stage.kind).toBe("resolved"); // the act executed
    expect(run.turns[1]!.run.status).toBe("acted");
    expect(run.turns[1]!.score.pass).toBe(true);
    expect(run.enforcementEscalations).toEqual([]);
  });

  it("declines an act the trainer never asked for, and reads it as a decline", async () => {
    // A plain fact question whose model volunteers a release: no ask, no
    // consent. The turn is read as declined — unresolved, not a phantom answer.
    const provider = perTurn([["Pikachu", releaseRaticate]]);
    const entry: DialogueEntry = {
      id: "unasked-act",
      profile: { version: "red-blue", region: "kanto", badgeLevel: 8 },
      turns: [{ say: "What's Pikachu's Speed stat?", disposition: "answerable", expectClaimKinds: ["fact"] }],
    };
    const run = await runDialogue(world, entry, provider, clock());
    expect(run.turns[0]!.stage.kind).toBe("declined");
    expect(run.turns[0]!.run.status).toBe("unresolved");
    expect(run.turns[0]!.score.pass).toBe(false);
  });
});

describe("runDialogues runs the whole bank", () => {
  it("the shipped bank runs, scores every turn, and commits nothing gated", async () => {
    const bank = readDialogues();
    const reuse = bank.dialogues.find((d) => d.id === "dlg-scope-reuse-facts")!;
    const runs = await runDialogues(world, [reuse], perTurn([
      ["Pikachu", fact("pikachu", "base-speed")],
      ["Machamp", fact("machamp", "base-attack")],
      ["Onix", fact("onix", "base-defense")],
    ]), clock);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.turns).toHaveLength(3);
    expect(runs[0]!.passedTurns).toBe(3);
    expect(runs.every((run) => run.enforcementEscalations.length === 0)).toBe(true);
  });
});
