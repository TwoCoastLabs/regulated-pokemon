/**
 * Re-scoring a filed coverage artifact under the current oracles — the free
 * leg of the improvement loop (epic #94, Center loop 1).
 *
 * The loop's discipline is causal: every treatment must be tied to the miss
 * class it targets, and its effect measured. Treatments that change the
 * *instrument* (a bank oracle widened, a scorer taught that a treats verdict
 * is the cures fact projected) can be re-measured on the already-paid records
 * — same runs, same funnel, new judgement — which isolates exactly the share
 * of the miss rate the instrument owned, at zero spend. Treatments that
 * change the *proposer* (a prompt line, a narrowed grammar) cannot: those
 * need a new paid run, and the delta that remains after this rescoring is
 * the ceiling on what they can claim.
 *
 * Everything here is read from the record — the same discipline replay and
 * the funnel keep. No model, no clock, no network.
 */

import type { Claim } from "../kernel/contracts.js";
import type { BankEntry } from "./bank.js";
import { type BankRun, type RecordedBankRun, scoreOracle } from "./bank-run.js";
import { type CoverageMap, coverageMap } from "./coverage.js";
import type { DemoWorld } from "../demo/script.js";
import { funnelOf } from "./playability.js";

/**
 * Score the filed runs again, against the bank as it stands now.
 *
 * The stage is re-read from the record too (`funnelOf`), not copied from the
 * filed verdict, so a scorer fix that moves a bucket is also visible. A run
 * whose entry the current bank no longer carries is returned exactly as
 * filed: an oracle that vanished is not an oracle that passed.
 */
export function rescoreRuns(
  world: DemoWorld,
  entries: readonly BankEntry[],
  runs: readonly RecordedBankRun[],
): readonly BankRun[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return runs.map((filed) => {
    const entry = byId.get(filed.entryId);
    if (entry === undefined) return filed;
    // The same rule runBankEntry applies: an action question resolves only
    // when the act executed.
    const wantsAct = (entry.expectClaimKinds ?? []).includes("action");
    const stage = funnelOf(filed.run, wantsAct);
    return { ...filed, stage, score: scoreOracle(entry, filed.run, world, stage) };
  });
}

/** The filed runs under today's oracles, aggregated the same way a live run
 * files its map — so the free re-measurement and the paid one are the same
 * numbers from the same code. */
export function rescoreMap(
  world: DemoWorld,
  entries: readonly BankEntry[],
  runs: readonly RecordedBankRun[],
): CoverageMap {
  return coverageMap(rescoreRuns(world, entries, runs));
}

// --- the miss decomposition -------------------------------------------------

/**
 * Where the answerable misses actually are, by the layer that owes the fix.
 *
 * The classes follow the funnel first (a denial is not an abstention), then
 * split resolutions by which oracle failed them (`shapeDeflection` /
 * `subjectDeflection` from the score, read — never re-inferred). Denials are
 * kept per named rule, because "denied" flattens exactly the distinction the
 * loop needs: an `IA-2/incomparable-fact` is the grammar's to prevent, an
 * `IA-3/fabricated-entity` the model's.
 */
export interface MissBreakdown {
  /** Answerable samples that did not pass — the denominator's complement. */
  misses: number;
  /** Misses that were denials, by `article/rule` — each a named layer. */
  deniedByRule: Record<string, number>;
  /** Resolved, but committed no expected claim kind. */
  resolvedOffShape: number;
  /** Resolved in an expected kind, but about no accepted subject. */
  resolvedOffSubject: number;
  /** Resolved and on-oracle by both checks, yet failed — the residue a new
   * class must be named for before it can be treated. */
  resolvedOther: number;
  abstainedScope: number;
  abstainedAnswer: number;
  declined: number;
}

/** One comparison pathology, counted apart because two treatments aim at it:
 * pairs comparing an entity with itself, in committed certificates and in
 * refused drafts (the record keeps both — `Transaction.refused`). Counted
 * over every answerable sample, pass or fail: a degenerate pair that slipped
 * into a passing certificate would be the worse finding. */
export interface DegenerateComparisons {
  committed: number;
  refusedDrafts: number;
}

const isSelfComparison = (claim: Claim): boolean =>
  claim.kind === "comparison" && claim.leftId === claim.rightId;

export function degenerateComparisons(runs: readonly RecordedBankRun[]): DegenerateComparisons {
  let committed = 0;
  let refusedDrafts = 0;
  for (const filed of runs) {
    if (filed.disposition !== "answerable") continue;
    const transaction = filed.run.transaction;
    committed += (transaction?.manifest?.claims ?? []).filter(isSelfComparison).length;
    refusedDrafts += ((transaction?.refused?.claims ?? []) as readonly Claim[]).filter(isSelfComparison).length;
  }
  return { committed, refusedDrafts };
}

export function missBreakdown(runs: readonly BankRun[]): MissBreakdown {
  const breakdown: MissBreakdown = {
    misses: 0,
    deniedByRule: {},
    resolvedOffShape: 0,
    resolvedOffSubject: 0,
    resolvedOther: 0,
    abstainedScope: 0,
    abstainedAnswer: 0,
    declined: 0,
  };
  for (const run of runs) {
    if (run.disposition !== "answerable" || run.score.pass) continue;
    breakdown.misses += 1;
    const stage = run.stage;
    switch (stage.kind) {
      case "denied": {
        const code = `${stage.article}/${stage.rule}`;
        breakdown.deniedByRule[code] = (breakdown.deniedByRule[code] ?? 0) + 1;
        break;
      }
      case "resolved":
        if (run.score.shapeDeflection === true) breakdown.resolvedOffShape += 1;
        else if (run.score.subjectDeflection === true) breakdown.resolvedOffSubject += 1;
        else breakdown.resolvedOther += 1;
        break;
      case "abstained-scope":
        breakdown.abstainedScope += 1;
        break;
      case "abstained-answer":
        breakdown.abstainedAnswer += 1;
        break;
      case "declined":
        breakdown.declined += 1;
        break;
    }
  }
  return breakdown;
}
