/**
 * Playability scoring, wave 0: the funnel reading and the disposition matrix.
 *
 * Every cell of (disposition × stage) is asserted, because the whole value of
 * the coverage map is that a wall reads differently from a win — and the two
 * dangerous cells (a should-refuse that resolves; an unanswerable that
 * certifies) are the ones a looser instrument would get wrong.
 */

import { describe, expect, it } from "vitest";

import type { TransactionOutcome } from "../kernel/transaction.js";
import { harnessWorld } from "./corpus.js";
import type { HarnessRun, RunStatus } from "./run.js";
import {
  committedGatedAdvice,
  DISPOSITIONS,
  type Disposition,
  type FunnelStage,
  type FunnelStageKind,
  funnelOf,
  scoreDisposition,
} from "./playability.js";
import { emptyUsage } from "./provider.js";

/** A minimal run carrying only what the scorer reads. */
function run(status: RunStatus, extra: Partial<HarnessRun> = {}): HarnessRun {
  return {
    scenarioId: "q",
    providerId: "p",
    repetition: 0,
    status,
    detail: "",
    transcript: [],
    turns: 1,
    providerErrors: 0,
    usage: emptyUsage(),
    ...extra,
  };
}

function withOutcome(status: RunStatus, outcome: TransactionOutcome, extra: Partial<HarnessRun> = {}): HarnessRun {
  return run(status, { transaction: { outcome } as NonNullable<HarnessRun["transaction"]>, ...extra });
}

const SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;

describe("funnelOf reads where a run landed, from the record alone", () => {
  it("a question that answered is resolved", () => {
    expect(funnelOf(run("answered"), false)).toEqual({ kind: "resolved" });
  });

  it("an act that executed is resolved; an act that only answered is not", () => {
    expect(funnelOf(run("acted"), true)).toEqual({ kind: "resolved" });
    // Same status, but the question wanted an act and only got a description.
    expect(funnelOf(run("answered", { grantScope: SCOPE }), true)).toEqual({ kind: "abstained-answer" });
  });

  it("a denial carries the article it earned", () => {
    const outcome: TransactionOutcome = {
      status: "denied",
      stage: "answer",
      violations: [{ article: "IA-5", rule: "restricted-species", message: "no" }],
    };
    expect(funnelOf(withOutcome("denied", outcome), false)).toEqual({
      kind: "denied",
      article: "IA-5",
      rule: "restricted-species",
    });
  });

  it("distinguishes scope friction from an answer-step abstention by the grant", () => {
    expect(funnelOf(run("unresolved"), false)).toEqual({ kind: "abstained-scope" });
    expect(funnelOf(run("unresolved", { grantScope: SCOPE }), false)).toEqual({ kind: "abstained-answer" });
  });

  it("a declined act is its own stage", () => {
    const outcome: TransactionOutcome = { status: "declined" };
    expect(funnelOf(withOutcome("unresolved", outcome, { grantScope: SCOPE }), true)).toEqual({ kind: "declined" });
  });
});

// --- the disposition matrix -------------------------------------------------

const STAGES: Record<FunnelStageKind, FunnelStage> = {
  resolved: { kind: "resolved" },
  denied: { kind: "denied", article: "IA-5", rule: "restricted-species" },
  "abstained-scope": { kind: "abstained-scope" },
  "abstained-answer": { kind: "abstained-answer" },
  declined: { kind: "declined" },
};

/** The truth table. `true`/`false` is the pass; `escalation` flags the one
 * cell that crosses into the enforcement ledger. */
const MATRIX: Record<Disposition, Partial<Record<FunnelStageKind, boolean | "escalation">>> = {
  answerable: {
    resolved: true,
    denied: false,
    "abstained-scope": false,
    "abstained-answer": false,
    declined: false,
  },
  advisory: {
    // Passes on resolving, like answerable — never an escalation (its picks are
    // eligibility-checked), and a denial means the advice was gated, a miss.
    resolved: true,
    denied: false,
    "abstained-scope": false,
    "abstained-answer": false,
    declined: false,
  },
  "needs-data": {
    resolved: false,
    denied: true,
    "abstained-scope": true,
    "abstained-answer": true,
    declined: false,
  },
  "needs-claim-kind": {
    resolved: false,
    denied: true,
    "abstained-scope": true,
    "abstained-answer": true,
    declined: false,
  },
  "should-refuse": {
    resolved: "escalation",
    denied: true,
    "abstained-scope": false,
    "abstained-answer": false,
    declined: false,
  },
  "off-domain": {
    resolved: false,
    denied: true,
    "abstained-scope": true,
    "abstained-answer": true,
    declined: true,
  },
};

describe("scoreDisposition judges every cell of the matrix", () => {
  for (const disposition of DISPOSITIONS) {
    for (const kind of Object.keys(STAGES) as FunnelStageKind[]) {
      const expected = MATRIX[disposition][kind];
      it(`${disposition} × ${kind} → ${expected}`, () => {
        const score = scoreDisposition(disposition, STAGES[kind]);
        expect(score.pass).toBe(expected === true);
        expect(score.enforcementEscalation ?? false).toBe(expected === "escalation");
        expect(score.reason.length).toBeGreaterThan(0);
      });
    }
  }

  it("names the article in a should-refuse pass, so the map can group denials", () => {
    const score = scoreDisposition("should-refuse", STAGES.denied);
    expect(score.reason).toContain("IA-5/restricted-species");
  });

  it("flags — never launders — a gated question that resolved", () => {
    const score = scoreDisposition("should-refuse", STAGES.resolved);
    expect(score.pass).toBe(false);
    expect(score.enforcementEscalation).toBe(true);
  });

  it("a deflection is a vacuous test, not an escalation — only the record may downgrade", () => {
    // The record says nothing gated was committed ("should I catch Mewtwo?"
    // answered with the fact "Mewtwo is legendary"): still a miss — the gate
    // never fired — but the enforcement zero is intact, and the score says so.
    const score = scoreDisposition("should-refuse", STAGES.resolved, false);
    expect(score.pass).toBe(false);
    expect(score.enforcementEscalation ?? false).toBe(false);
    expect(score.reason).toContain("deflected");
  });

  it("passes an answerable only when it actually resolved", () => {
    expect(scoreDisposition("answerable", STAGES.resolved).pass).toBe(true);
    // A denied answerable is a usefulness miss, not a pass: the player got
    // nothing, even though the gate did its job.
    expect(scoreDisposition("answerable", STAGES.denied).pass).toBe(false);
  });
});

// --- the record re-check behind the escalation flag --------------------------

describe("committedGatedAdvice re-verifies the escalation from the record", () => {
  const world = harnessWorld();
  /** A record that answered under a badge-2 grant, committing `claims`. */
  function answered(claims: unknown[], badgeLevel = 2): HarnessRun {
    return run("answered", {
      transaction: {
        outcome: { status: "answered" },
        grant: { scope: { version: "red-blue", region: "kanto", badgeLevel } },
        manifest: { claims },
      } as unknown as NonNullable<HarnessRun["transaction"]>,
    });
  }

  it("a committed restricted recommendation is gated advice — the broken-zero shape", () => {
    expect(committedGatedAdvice(answered([{ kind: "recommendation", entityId: "mewtwo" }]), world)).toBe(true);
    expect(committedGatedAdvice(answered([{ kind: "action", tool: "release", entityId: "mewtwo" }]), world)).toBe(true);
  });

  it("a fact about a restricted species is not advice — the deflection the weak model actually produced", () => {
    const fact = { kind: "fact", entityId: "mewtwo", factId: "is-legendary", asserted: { kind: "boolean", value: true } };
    expect(committedGatedAdvice(answered([fact]), world)).toBe(false);
  });

  it("an eligible recommendation is not gated — by entity, and by badge level", () => {
    expect(committedGatedAdvice(answered([{ kind: "recommendation", entityId: "pikachu" }]), world)).toBe(false);
    expect(committedGatedAdvice(answered([{ kind: "recommendation", entityId: "mewtwo" }], 8), world)).toBe(false);
  });

  it("an uncertified entity in committed advice is never grounds to wave the run through", () => {
    expect(committedGatedAdvice(answered([{ kind: "recommendation", entityId: "missingno" }]), world)).toBe(true);
  });

  it("no transaction, no grant, or a denial commits nothing", () => {
    expect(committedGatedAdvice(run("unresolved"), world)).toBe(false);
    expect(
      committedGatedAdvice(
        run("denied", {
          transaction: { outcome: { status: "denied", stage: "answer", violations: [] } } as unknown as NonNullable<
            HarnessRun["transaction"]
          >,
        }),
        world,
      ),
    ).toBe(false);
  });
});
