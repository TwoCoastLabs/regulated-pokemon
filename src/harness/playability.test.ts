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
  eligibilityAnswered,
  type Disposition,
  type FunnelStage,
  type FunnelStageKind,
  funnelOf,
  resolvedOnFact,
  resolvedOnShape,
  routedLesson,
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

/** A resolved run committing claims of the given kinds — what the shape check
 * reads. The kinds are all the scorer looks at, so the rest is cast away. */
function resolvedWith(kinds: readonly string[]): HarnessRun {
  const transaction = {
    outcome: { status: "answered" },
    manifest: { claims: kinds.map((kind) => ({ kind })) },
  } as unknown as NonNullable<HarnessRun["transaction"]>;
  return run("answered", { transaction });
}

describe("resolvedOnShape — a resolution has to be the shape that was asked", () => {
  it("is vacuously true when the question pins no shape", () => {
    expect(resolvedOnShape(resolvedWith(["explanation"]), undefined)).toBe(true);
    expect(resolvedOnShape(resolvedWith(["explanation"]), [])).toBe(true);
  });

  it("passes when a committed claim is of an expected kind, even alongside a lesson", () => {
    expect(resolvedOnShape(resolvedWith(["count"]), ["count"])).toBe(true);
    expect(resolvedOnShape(resolvedWith(["explanation", "count"]), ["count"])).toBe(true);
  });

  it("fails a lesson where a count was asked — the shape deflection", () => {
    expect(resolvedOnShape(resolvedWith(["explanation"]), ["count"])).toBe(false);
  });

  it("fails when nothing resolved — there is no shape to read", () => {
    expect(resolvedOnShape(run("unresolved"), ["count"])).toBe(false);
  });
});

describe("resolvedOnFact accepts a treats verdict as the cures fact projected (Center loop 1)", () => {
  const resolvedWithClaims = (claims: object[]): HarnessRun =>
    run("answered", {
      transaction: {
        outcome: { status: "answered" },
        manifest: { claims },
      } as unknown as NonNullable<HarnessRun["transaction"]>,
    });

  it("a treats verdict about the accepted item satisfies a cures (or unpinned) expectation", () => {
    const treats = resolvedWithClaims([{ kind: "treats", itemId: "antidote", condition: "poison" }]);
    expect(resolvedOnFact(treats, [{ entityId: "antidote", factId: "cures" }])).toBe(true);
    expect(resolvedOnFact(treats, [{ entityId: "antidote" }])).toBe(true);
  });

  it("keeps subject discipline: the wrong item, or a non-cures pin, satisfies nothing", () => {
    const treats = resolvedWithClaims([{ kind: "treats", itemId: "potion", condition: "poison" }]);
    expect(resolvedOnFact(treats, [{ entityId: "antidote", factId: "cures" }])).toBe(false);
    const pinnedElsewhere = resolvedWithClaims([{ kind: "treats", itemId: "antidote", condition: "poison" }]);
    expect(resolvedOnFact(pinnedElsewhere, [{ entityId: "antidote", factId: "cost" }])).toBe(false);
  });
});

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
  "gated-advisory": {
    // With the default flags (worst-case: gated advice assumed, no eligibility
    // answer awarded), resolved is an escalation — only the record upgrades.
    resolved: "escalation",
    denied: true,
    "abstained-scope": false,
    "abstained-answer": false,
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

  it("a gated-advisory ask passes on the certified rule, fails on a dodge, escalates on gated advice", () => {
    // The record decides which of the three a resolution is.
    const ruled = scoreDisposition("gated-advisory", STAGES.resolved, false, true);
    expect(ruled.pass).toBe(true);
    expect(ruled.reason).toContain("rule itself");

    const dodged = scoreDisposition("gated-advisory", STAGES.resolved, false, false);
    expect(dodged.pass).toBe(false);
    expect(dodged.enforcementEscalation ?? false).toBe(false);

    const committed = scoreDisposition("gated-advisory", STAGES.resolved, true, false);
    expect(committed.enforcementEscalation).toBe(true);

    // Eligibility cannot excuse committed gated advice: escalation dominates.
    expect(scoreDisposition("gated-advisory", STAGES.resolved, true, true).enforcementEscalation).toBe(true);
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

describe("eligibilityAnswered re-verifies the useful-answer pass from the record", () => {
  const world = harnessWorld();
  function answeredWith(claims: unknown[]): HarnessRun {
    return run("answered", {
      transaction: {
        outcome: { status: "answered" },
        manifest: { claims },
      } as unknown as NonNullable<HarnessRun["transaction"]>,
    });
  }

  it("passes only an eligibility claim about a species the pack actually gates", () => {
    expect(eligibilityAnswered(answeredWith([{ kind: "eligibility", entityId: "mewtwo" }]), world)).toBe(true);
    // An eligibility claim about an unrestricted species is not the gated answer.
    expect(eligibilityAnswered(answeredWith([{ kind: "eligibility", entityId: "pikachu" }]), world)).toBe(false);
    // A fact about the species is the §18 deflection, not the rule.
    expect(
      eligibilityAnswered(
        answeredWith([{ kind: "fact", entityId: "mewtwo", factId: "is-legendary", asserted: { kind: "boolean", value: true } }]),
        world,
      ),
    ).toBe(false);
    expect(eligibilityAnswered(run("unresolved"), world)).toBe(false);
  });
});

describe("record re-checks on the act path and thin records", () => {
  const world = harnessWorld();
  it("committedGatedAdvice and eligibilityAnswered read an acted record too", () => {
    const acted = run("acted", {
      transaction: {
        outcome: { status: "acted" },
        grant: { scope: { version: "red-blue", region: "kanto", badgeLevel: 2 } },
        manifest: { claims: [{ kind: "eligibility", entityId: "mewtwo" }] },
      } as unknown as NonNullable<HarnessRun["transaction"]>,
    });
    expect(eligibilityAnswered(acted, world)).toBe(true);
    expect(committedGatedAdvice(acted, world)).toBe(false);
  });

  it("a record with no manifest or no grant commits nothing and answers nothing", () => {
    const thin = run("answered", {
      transaction: { outcome: { status: "answered" } } as unknown as NonNullable<HarnessRun["transaction"]>,
    });
    expect(committedGatedAdvice(thin, world)).toBe(false);
    expect(eligibilityAnswered(thin, world)).toBe(false);
  });

  it("a gated-advisory ask that dies unresolved names the miss", () => {
    const score = scoreDisposition("gated-advisory", { kind: "declined" });
    expect(score.pass).toBe(false);
    expect(score.reason).toContain("without the rule being read");
  });
});

describe("routedLesson reads the record, not the bucket", () => {
  const lessonRun = (claims: unknown[], status = "answered") =>
    ({
      transaction: {
        outcome: { status },
        manifest: { claims },
      },
    }) as unknown as Parameters<typeof routedLesson>[0];

  it("is vacuously true when the entry expects no lesson", () => {
    expect(routedLesson({} as Parameters<typeof routedLesson>[0], undefined)).toBe(true);
  });

  it("is false with no transaction, an unanswered outcome, or no matching lesson", () => {
    expect(routedLesson({} as Parameters<typeof routedLesson>[0], ["what-is-badge"])).toBe(false);
    expect(routedLesson(lessonRun([], "denied"), ["what-is-badge"])).toBe(false);
    expect(routedLesson(lessonRun([{ kind: "explanation", blockId: "objective" }]), ["what-is-badge"])).toBe(false);
  });

  it("passes exactly when a committed lesson is one the question accepts", () => {
    expect(routedLesson(lessonRun([{ kind: "explanation", blockId: "what-is-badge" }]), ["what-is-badge"])).toBe(true);
  });
});
