/**
 * The dialogue bank loader, held to the same discipline as `loadBank`: a
 * malformed or self-contradictory conversation is refused by name at load,
 * before a run is ever paid for. The shipped bank must load; every way of
 * corrupting it must fail with a named violation, one level deeper than the
 * single-turn bank (the bank holds dialogues, each holds turns, and it is the
 * turn that carries the disposition oracle).
 */

import { describe, expect, it } from "vitest";

import { AccordError } from "../kernel/violation.js";
import { ADVERSARIAL_BANK_PATH, type DialogueBank, loadDialogues, readDialogues } from "./dialogues.js";

/** A minimal valid bank, cloned per test so a mutation cannot leak. */
function valid(): DialogueBank {
  return {
    bankVersion: 1,
    id: "test-dialogues",
    dialogues: [
      {
        id: "d1",
        profile: { version: "red-blue", region: "kanto", badgeLevel: 8 },
        turns: [
          {
            say: "What's Pikachu's Speed stat?",
            disposition: "answerable",
            expectClaimKinds: ["fact"],
            expectFacts: [{ entityId: "pikachu", factId: "base-speed" }],
          },
          { say: "What's Snorlax's catch rate?", disposition: "needs-data", notes: "not in the snapshot" },
        ],
      },
    ],
  };
}

/** The rule the refusal named, or a failure if it was not an AccordError. */
function ruleOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AccordError) return error.violations[0]!.rule;
    throw error;
  }
  throw new Error("expected loadDialogues to refuse, but it accepted the input");
}

describe("readDialogues loads the shipped bank", () => {
  it("the shipped dialogue bank is valid and non-empty", () => {
    const bank = readDialogues();
    expect(bank.dialogues.length).toBeGreaterThan(0);
    expect(bank.dialogues.every((d) => d.turns.length > 0)).toBe(true);
  });

  it("every shipped conversation establishes a complete scope profile", () => {
    for (const dialogue of readDialogues().dialogues) {
      expect(dialogue.profile.version).toBeDefined();
      expect(dialogue.profile.region).toBeDefined();
      expect(dialogue.profile.badgeLevel).toBeDefined();
    }
  });
});

describe("loadDialogues accepts a well-formed bank", () => {
  it("returns the bank when every turn is well-formed", () => {
    expect(loadDialogues(valid()).id).toBe("test-dialogues");
  });
});

describe("loadDialogues refuses a malformed bank by name", () => {
  it("rejects a non-object, a wrong schema version, and an empty bank", () => {
    expect(ruleOf(() => loadDialogues(null))).toBe("dialogues-malformed");
    expect(ruleOf(() => loadDialogues({ ...valid(), bankVersion: 2 }))).toBe("dialogues-schema-unsupported");
    expect(ruleOf(() => loadDialogues({ ...valid(), dialogues: [] }))).toBe("dialogues-malformed");
  });

  it("rejects a duplicate dialogue id", () => {
    const bank = valid();
    bank.dialogues = [bank.dialogues[0]!, bank.dialogues[0]!];
    expect(ruleOf(() => loadDialogues(bank))).toBe("dialogue-duplicate-id");
  });

  it("rejects an incomplete scope profile", () => {
    const bank = valid();
    bank.dialogues[0]!.profile = { version: "red-blue", region: "kanto" } as never;
    expect(ruleOf(() => loadDialogues(bank))).toBe("dialogue-profile-incomplete");
  });

  it("rejects a conversation with no turns", () => {
    const bank = valid();
    bank.dialogues[0]!.turns = [];
    expect(ruleOf(() => loadDialogues(bank))).toBe("dialogue-empty");
  });
});

describe("loadDialogues refuses a malformed turn by name", () => {
  it("rejects an empty utterance and an unknown disposition", () => {
    const empty = valid();
    empty.dialogues[0]!.turns[0]!.say = "   ";
    expect(ruleOf(() => loadDialogues(empty))).toBe("dialogue-turn-empty");

    const unknown = valid();
    unknown.dialogues[0]!.turns[0]!.disposition = "made-up" as never;
    expect(ruleOf(() => loadDialogues(unknown))).toBe("dialogue-turn-unknown-disposition");
  });

  it("rejects a resolving turn that names no claim kind, and an unknown claim kind", () => {
    const missing = valid();
    delete missing.dialogues[0]!.turns[0]!.expectClaimKinds;
    expect(ruleOf(() => loadDialogues(missing))).toBe("dialogue-turn-claims-missing");

    const bad = valid();
    bad.dialogues[0]!.turns[0]!.expectClaimKinds = ["not-a-kind"] as never;
    expect(ruleOf(() => loadDialogues(bad))).toBe("dialogue-turn-claim-kind-unknown");
  });

  it("ties lessons to an explanation, both directions", () => {
    const noLessons = valid();
    noLessons.dialogues[0]!.turns[0]!.expectClaimKinds = ["explanation"];
    expect(ruleOf(() => loadDialogues(noLessons))).toBe("dialogue-turn-lessons-missing");

    const strayLessons = valid();
    strayLessons.dialogues[0]!.turns[0]!.expectBlockIds = ["what-is-badge"];
    expect(ruleOf(() => loadDialogues(strayLessons))).toBe("dialogue-turn-lessons-unexpected");
  });

  it("ties facts to a fact expectation, both directions (epic #87, slice 1)", () => {
    const noFacts = valid();
    delete noFacts.dialogues[0]!.turns[0]!.expectFacts;
    expect(ruleOf(() => loadDialogues(noFacts))).toBe("dialogue-turn-facts-missing");

    const strayFacts = valid();
    strayFacts.dialogues[0]!.turns[1]!.expectFacts = [{ entityId: "snorlax" }];
    expect(ruleOf(() => loadDialogues(strayFacts))).toBe("dialogue-turn-facts-unexpected");
  });

  it("rejects an acceptable fact with no entity, and an empty fact id", () => {
    const noEntity = valid();
    noEntity.dialogues[0]!.turns[0]!.expectFacts = [{ entityId: " " }];
    expect(ruleOf(() => loadDialogues(noEntity))).toBe("dialogue-turn-fact-empty");

    const emptyFact = valid();
    emptyFact.dialogues[0]!.turns[0]!.expectFacts = [{ entityId: "pikachu", factId: " " }];
    expect(ruleOf(() => loadDialogues(emptyFact))).toBe("dialogue-turn-fact-empty");
  });

  it("requires an unanswerable turn to name its ceiling", () => {
    const bank = valid();
    delete bank.dialogues[0]!.turns[1]!.notes;
    expect(ruleOf(() => loadDialogues(bank))).toBe("dialogue-turn-ceiling-unstated");
  });
});

describe("the adversarial bank and its oracles (epic #94, slice 1)", () => {
  const adversarial = readDialogues(ADVERSARIAL_BANK_PATH);

  it("loads from disk and every attack turn carries what must not move", () => {
    let attacks = 0;
    for (const dialogue of adversarial.dialogues) {
      for (const turn of dialogue.turns) {
        if (turn.attack === undefined) continue;
        attacks += 1;
        if (turn.attack === "scope") expect(turn.expectScope, `${dialogue.id}: ${turn.say}`).toBeDefined();
        else expect(["gated-advisory", "should-refuse"]).toContain(turn.disposition);
      }
    }
    expect(attacks).toBeGreaterThanOrEqual(6);
  });

  function sabotaged(mutate: (turn: Record<string, unknown>) => void): () => unknown {
    const draft = structuredClone(adversarial) as DialogueBank;
    const turn = draft.dialogues[0]?.turns[1] as unknown as Record<string, unknown> | undefined;
    if (turn === undefined) throw new Error("no attack turn to sabotage");
    mutate(turn);
    return () => loadDialogues(draft);
  }

  it("refuses an empty scope oracle", () => {
    expect(sabotaged((turn) => Object.assign(turn, { expectScope: {} }))).toThrow("dialogue-turn-scope-malformed");
  });
  it("refuses a scope oracle naming a dimension that does not exist", () => {
    expect(sabotaged((turn) => Object.assign(turn, { expectScope: { mood: "grumpy" } }))).toThrow("dialogue-turn-scope-dimension-unknown");
  });
  it("refuses an attack kind it does not know", () => {
    expect(sabotaged((turn) => Object.assign(turn, { attack: "vibes" }))).toThrow("dialogue-turn-attack-unknown");
  });
  it("refuses a scope attack with no scope oracle", () => {
    expect(sabotaged((turn) => { delete turn.expectScope; })).toThrow("dialogue-turn-attack-unoracled");
  });
  it("refuses an advice attack on a turn the gate is not expected to judge", () => {
    expect(sabotaged((turn) => Object.assign(turn, { attack: "advice", disposition: "answerable" }))).toThrow("dialogue-turn-attack-unoracled");
  });
});
