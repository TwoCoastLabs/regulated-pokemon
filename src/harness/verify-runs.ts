/**
 * Replay as a metric step (epic #87, slice 2): every filed artifact whose
 * pinned world this tree can reproduce is re-executed, offline and key-free,
 * and its verdicts re-derived from the record.
 *
 * Why this exists: the harness's enforcement zeros for gated advice and
 * unauthorized actions were already re-verified from records, but the
 * fabrication and wrong-scope zeros rested on the kernel that ran in the same
 * process that produced the artifact — the referee was also the scorekeeper.
 * Every artifact is replayable by construction (IA-10, `verifyReplay`); this
 * module makes CI actually do it, so a published zero is re-derived from the
 * filed record by a process that had no hand in producing it.
 *
 * The skip rule is the no-silent-caps rule: an artifact pinned to a snapshot
 * digest or pack this tree does not carry is **skipped, counted and named** —
 * IA-10's own third breakage, reported rather than silently passed over. And
 * the leg is anti-vacuous (lesson 7): a sweep that verified nothing proves
 * nothing, so the caller must check `verified > 0`, and the CI test does.
 */

import { verifyReplay } from "../kernel/replay.js";
import type { Transaction } from "../kernel/transaction.js";
import type { Violation } from "../kernel/contracts.js";
import type { AccordPack } from "../kernel/pack.js";
import type { DemoWorld } from "../demo/script.js";
import { committedGatedAdvice } from "./playability.js";
import type { HarnessRun } from "./run.js";

/** The provenance block every artifact kind files (artifact.ts,
 * coverage-artifact.ts, dialogue-artifact.ts share the shape). */
interface ArtifactWorld {
  snapshotId: string;
  snapshotDigest: string;
  packId: string;
}

/** One recorded run located inside an artifact, addressable for a report. */
export interface LocatedRun {
  /** Where in the artifact this run sits, e.g. `ans-fact-speed-pikachu#2` or
   * `dlg-scope-reuse-facts#1` — so a failure names the exact record. */
  where: string;
  run: HarnessRun;
}

export type ArtifactVerification =
  | {
      kind: "verified";
      /** Transactions re-executed and compared. */
      transactions: number;
      /** Runs re-checked for committed gated advice (every run, not only the
       * gated ones — a clean run must have nothing IA-5 gates). */
      gatedRechecks: number;
      failures: readonly { where: string; violations: readonly Violation[] }[];
      /**
       * Records this sweep's first run caught as unreplayable by the kernel's
       * own completeness rule: denied at the answer stage with no manifest —
       * the shape the session seam files when *compilation* refuses the
       * model's draft, so no manifest ever existed to record. The crucible
       * seam always kept the (doctored) manifest, and the completeness rule
       * was written for that seam; the denial verdict in these records is
       * real but cannot be re-derived from the record alone. Counted and
       * named apart (the no-silent-caps rule), never folded into `failures`:
       * epic #87 slice 2b owes the recorder fix (file the denied draft), and
       * when it lands this class goes back to being a hard failure.
       */
      incompleteDenials: readonly string[];
    }
  | {
      kind: "skipped";
      /** The named reason — which pin this tree cannot reproduce. */
      reason: string;
    };

/**
 * When the recorder learned to file the refused draft (epic #87 slice 2b).
 * Artifacts started before this moment may carry denial records with neither
 * a manifest nor the draft — the shape the first sweep counted 176 of; they
 * stay tolerated, counted and named, because their findings pin them by
 * name. An artifact started *after* it has no excuse: an incomplete denial
 * there is a recorder regression and fails the sweep hard.
 */
export const REFUSED_DRAFTS_RECORDED_SINCE = "2026-08-23T00:00:00.000Z";

/** The legacy shape slice 2b eliminated at the recorder: a denial at the
 * answer stage, neither manifest nor refused draft kept, flagged by replay
 * only as incomplete. */
function isIncompleteDenial(transaction: Transaction, violations: readonly Violation[]): boolean {
  const { outcome } = transaction;
  return (
    outcome.status === "denied" &&
    outcome.stage === "answer" &&
    transaction.manifest === undefined &&
    transaction.refused === undefined &&
    violations.every((entry) => entry.article === "IA-10" && entry.rule === "record-incomplete")
  );
}

/**
 * Locate every recorded run in a parsed artifact, whatever its kind.
 *
 * The three artifact schemas are distinguished by structure, not by filename:
 * a dialogue artifact's runs carry `turns[].run`, a coverage artifact's carry
 * `run`, and a live artifact's runs *are* the runs. Anything else returns
 * empty — a caller that fed a non-artifact gets zero runs, and the anti-vacuity
 * check catches a sweep that found nothing.
 */
export function locateRuns(artifact: unknown): LocatedRun[] {
  const doc = artifact as { runs?: unknown[] };
  if (!Array.isArray(doc.runs)) return [];
  const located: LocatedRun[] = [];
  for (const entry of doc.runs) {
    const record = entry as {
      dialogueId?: string;
      entryId?: string;
      scenarioId?: string;
      repetition?: number;
      turns?: unknown;
      run?: HarnessRun;
    };
    if (record.dialogueId !== undefined && Array.isArray(record.turns)) {
      for (const [index, turn] of (record.turns as { run?: HarnessRun }[]).entries()) {
        if (turn.run !== undefined) located.push({ where: `${record.dialogueId}#${index}`, run: turn.run });
      }
    } else if (record.run !== undefined) {
      located.push({ where: `${record.entryId ?? "?"}#${record.repetition ?? 0}`, run: record.run });
    } else if (record.scenarioId !== undefined) {
      located.push({ where: `${record.scenarioId}#${record.repetition ?? 0}`, run: record as unknown as HarnessRun });
    }
  }
  return located;
}

/**
 * Verify one parsed artifact against the bundled world, or skip it by name.
 *
 * Verification is two independent re-derivations per record: `verifyReplay`
 * re-executes the whole transaction from its recorded inputs and compares the
 * result to the filed one (which re-runs manifest verification — the
 * fabrication and wrong-scope zeros — and the action chain), and
 * `committedGatedAdvice` re-reads the committed claims against the pack (the
 * IA-5 zero). Neither consults the artifact's own summary numbers.
 */
export function verifyArtifact(
  world: DemoWorld,
  artifact: unknown,
  packs: ReadonlyMap<string, AccordPack> = new Map([[world.pack.id, world.pack]]),
): ArtifactVerification {
  const pin = (artifact as { world?: ArtifactWorld }).world;
  if (pin === undefined) return { kind: "skipped", reason: "no world provenance block" };
  const document = world.registry.document;
  if (pin.snapshotId !== document.id || pin.snapshotDigest !== document.contentDigest) {
    return {
      kind: "skipped",
      reason: `pinned to snapshot ${pin.snapshotId} ${pin.snapshotDigest.slice(0, 15)}…, tree carries ${document.id} ${document.contentDigest.slice(0, 15)}…`,
    };
  }
  // Policy is versioned data, and the versions are kept: a record pinned to an
  // earlier pack replays under *that* pack, read from the tree, not under
  // whatever the pack has since become (epic #94, slice 4 — the sentence
  // templates changed how a page plans, and re-planning yesterday's records
  // under today's presentation would fail every one of them for lacking
  // sentences nobody had approved yet). Skipped only when no carried pack
  // bears the pinned id — the same no-silent-caps rule, one shelf wider.
  const pack = packs.get(pin.packId);
  if (pack === undefined) {
    return { kind: "skipped", reason: `pinned to pack ${pin.packId}, tree carries ${[...packs.keys()].join(", ")}` };
  }
  const pinned: DemoWorld = { ...world, pack };

  // The legacy tolerance is bounded in time, not open-ended: only artifacts
  // filed before the recorder fix may carry incomplete denials.
  const startedAt = (artifact as { startedAt?: string }).startedAt ?? "";
  const legacy = startedAt !== "" && startedAt < REFUSED_DRAFTS_RECORDED_SINCE;

  const failures: { where: string; violations: readonly Violation[] }[] = [];
  const incompleteDenials: string[] = [];
  let transactions = 0;
  let gatedRechecks = 0;
  for (const { where, run } of locateRuns(artifact)) {
    if (run.transaction !== undefined) {
      transactions += 1;
      const verdict = verifyReplay(pinned, run.transaction as Transaction);
      if (!verdict.allowed) {
        if (legacy && isIncompleteDenial(run.transaction as Transaction, verdict.violations)) incompleteDenials.push(where);
        else failures.push({ where, violations: verdict.violations });
      }
    }
    gatedRechecks += 1;
    if (committedGatedAdvice(run, pinned)) {
      failures.push({
        where,
        violations: [
          {
            article: "IA-5",
            rule: "gated-advice-in-record",
            message: `record ${where} committed advice the pack gates — a broken zero, found by re-reading the record`,
          } as Violation,
        ],
      });
    }
  }
  return { kind: "verified", transactions, gatedRechecks, failures, incompleteDenials };
}
