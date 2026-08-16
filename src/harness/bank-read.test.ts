/**
 * The pure readers behind the bank runner — `asRun` and `profileWord` — tested
 * without a live session, so the record-shape and friction branches are pinned
 * deterministically rather than coaxed out of a model.
 */

import { describe, expect, it } from "vitest";

import type { TrainerScope } from "../kernel/contracts.js";
import type { Transaction } from "../kernel/transaction.js";
import { harnessWorld } from "./corpus.js";
import { asRun, profileWord } from "./bank-run.js";
import type { BankEntry } from "./bank.js";
import { startSession, type SessionState } from "../session/session.js";

const world = harnessWorld();
const PROFILE: TrainerScope = { version: "red-blue", region: "kanto", badgeLevel: 8 };
const entry: BankEntry = { id: "q", intent: "?", profile: PROFILE, disposition: "answerable", expectClaimKinds: ["fact"] };

function state(extra: Partial<SessionState>): SessionState {
  return { ...startSession(), ...extra };
}

function trainerSaid(text: string) {
  return { kind: "utterance", at: "2026-01-01T00:00:00Z", source: "trainer", text } as const;
}

describe("asRun reads a settled session as a funnelable run", () => {
  it("maps a declined act to unresolved, keeping the grant it rested on", () => {
    const record = { outcome: { status: "declined" }, grant: { scope: PROFILE } } as unknown as Transaction;
    const run = asRun(entry, state({ records: [record] }), world);
    expect(run.status).toBe("unresolved");
    expect(run.grantScope).toEqual(PROFILE);
  });

  it("maps a denied record to denied, with no grant when none was minted", () => {
    const record = { outcome: { status: "denied", stage: "answer", violations: [] } } as unknown as Transaction;
    const run = asRun(entry, state({ records: [record] }), world);
    expect(run.status).toBe("denied");
    expect(run.grantScope).toBeUndefined();
  });

  it("reads an abstention with closed scope as answer-step, carrying the profile", () => {
    // A transcript that establishes all three required dimensions, then no answer.
    const transcript = [
      trainerSaid("I'm playing Red and Blue, in the Kanto region, with 8 badges."),
    ];
    const run = asRun(entry, state({ transcript, notes: [{ at: "t", text: "no answer", tone: "abstention" }] }), world);
    expect(run.status).toBe("unresolved");
    expect(run.grantScope).toEqual(PROFILE);
  });

  it("reads an abstention with open scope as friction — no grant", () => {
    const run = asRun(entry, state({ transcript: [trainerSaid("what types are there?")], notes: [] }), world);
    expect(run.status).toBe("unresolved");
    expect(run.grantScope).toBeUndefined();
  });
});

describe("profileWord speaks a profile value the answer route can bind", () => {
  it("says the version, region and badge count plainly", () => {
    expect(profileWord("version", PROFILE)).toBe("red-blue");
    expect(profileWord("region", PROFILE)).toBe("kanto");
    expect(profileWord("badgeLevel", PROFILE)).toBe("8");
  });

  it("turns a comparison basis into its bindable words, defaulting when absent", () => {
    expect(profileWord("comparisonBasis", { ...PROFILE, comparisonBasis: "base-stat-total" })).toBe("stat total");
    expect(profileWord("comparisonBasis", PROFILE)).toBe("speed");
  });
});
