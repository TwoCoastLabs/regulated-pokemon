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
import { type DialogueBank, loadDialogues, readDialogues } from "./dialogues.js";

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
          { say: "What's Pikachu's Speed stat?", disposition: "answerable", expectClaimKinds: ["fact"] },
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

  it("requires an unanswerable turn to name its ceiling", () => {
    const bank = valid();
    delete bank.dialogues[0]!.turns[1]!.notes;
    expect(ruleOf(() => loadDialogues(bank))).toBe("dialogue-turn-ceiling-unstated");
  });
});
