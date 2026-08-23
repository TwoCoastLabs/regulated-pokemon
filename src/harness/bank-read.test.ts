/**
 * The pure readers behind the bank runner — `asRun` and `profileWord` — tested
 * without a live session, so the record-shape and friction branches are pinned
 * deterministically rather than coaxed out of a model.
 */

import { describe, expect, it } from "vitest";

import type { TrainerScope } from "../kernel/contracts.js";
import type { Transaction } from "../kernel/transaction.js";
import { harnessWorld } from "./corpus.js";
import { asRun, type DispositionOracle, profileWord, scoreOracle } from "./bank-run.js";
import type { BankEntry } from "./bank.js";
import type { HarnessRun } from "./run.js";
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

describe("scoreOracle's subject check: the right shape must be about the right thing (epic #87, slice 1)", () => {
  const RESOLVED = { kind: "resolved" } as const;
  const oracle: DispositionOracle = {
    disposition: "answerable",
    expectClaimKinds: ["fact"],
    expectFacts: [{ entityId: "pikachu", factId: "base-speed" }],
  };

  /** A minimal answered run committing exactly these claims. */
  function answered(claims: unknown[]): HarnessRun {
    return {
      transaction: { outcome: { status: "answered" }, manifest: { claims }, grant: { scope: PROFILE } },
      grantScope: PROFILE,
    } as unknown as HarnessRun;
  }

  const fact = (entityId: string, factId: string) => ({ kind: "fact", entityId, factId, asserted: { kind: "number", value: 1 } });

  it("passes the accepted fact", () => {
    expect(scoreOracle(oracle, answered([fact("pikachu", "base-speed")]), world, RESOLVED).pass).toBe(true);
  });

  it("fails a certified fact about the wrong subject, named as a subject deflection", () => {
    const score = scoreOracle(oracle, answered([fact("pikachu", "base-attack")]), world, RESOLVED);
    expect(score.pass).toBe(false);
    expect(score.subjectDeflection).toBe(true);
    expect(score.reason).toContain("subject deflection");
  });

  it("fails the right fact about the wrong entity", () => {
    expect(scoreOracle(oracle, answered([fact("machamp", "base-speed")]), world, RESOLVED).pass).toBe(false);
  });

  it("a factId-less oracle accepts any certified fact about the entity — and only that entity", () => {
    const summary: DispositionOracle = { ...oracle, expectFacts: [{ entityId: "pikachu" }] };
    expect(scoreOracle(summary, answered([fact("pikachu", "base-attack")]), world, RESOLVED).pass).toBe(true);
    expect(scoreOracle(summary, answered([fact("machamp", "base-attack")]), world, RESOLVED).pass).toBe(false);
  });

  it("an answer through another expected kind is judged by that kind's oracle, not failed here", () => {
    // The Zapdos question accepts a membership or the types fact; a resolution
    // carrying only the membership must not fail for lacking the fact.
    const zapdos: DispositionOracle = {
      disposition: "answerable",
      expectClaimKinds: ["membership", "fact"],
      expectFacts: [{ entityId: "zapdos", factId: "types" }],
    };
    const membership = { kind: "membership", rosterId: "electric-kanto", entityId: "zapdos", asserted: true };
    expect(scoreOracle(zapdos, answered([membership]), world, RESOLVED).pass).toBe(true);
    // But an off-subject fact alone still fails: the fact route was taken, and
    // it was about the wrong thing.
    expect(scoreOracle(zapdos, answered([fact("pikachu", "types")]), world, RESOLVED).pass).toBe(false);
  });

  it("no expectFacts means no subject pin — the check is vacuously true", () => {
    const unpinned: DispositionOracle = { disposition: "answerable", expectClaimKinds: ["fact"] };
    expect(scoreOracle(unpinned, answered([fact("machamp", "base-attack")]), world, RESOLVED).pass).toBe(true);
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
