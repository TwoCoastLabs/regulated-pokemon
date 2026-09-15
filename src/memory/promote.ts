/**
 * Promotion: how a filed record becomes a precedent (docs/precedent.md).
 *
 * Two sources, both reviewed acts, neither on the live path. This module
 * is the first — from a filed bank run: every run the kernel accepted *and*
 * the bank's oracle passed on subject and shape becomes a candidate, with
 * its values stripped and its bank entry named (the hold-out key). The
 * certified non-sequitur is excluded by construction: the oracle's subject
 * check is the promotion's reward, exactly as landscape.md H1 requires of
 * a training reward. A denied draft, a refused nomination, an emptied reply
 * never enter — the store is a set of things that were right, and nothing
 * about what was wrong, which is the line that keeps it memory and not
 * search.
 *
 * Deterministic and key-free: the same artifact yields the same store, and
 * the diff it produces is a pull request the steward approves. The second
 * source — a session exchange a reviewer marks on target — takes the same
 * shape through {@link promoteExchange}.
 */

import type { ScopeTranscript } from "../kernel/contracts.js";
import type { AnswerManifest } from "../kernel/contracts.js";
import { canonicalShape, type Precedent, type PrecedentStore, PRECEDENT_SCHEMA_VERSION, shapeOf } from "./precedent.js";

/** The slice of a filed coverage run promotion reads — named here so the
 * memory module never imports the harness. */
export interface PromotableRun {
  entryId: string;
  opening: string;
  stage: { kind: string };
  score: { pass: boolean };
  run: {
    transcript: ScopeTranscript;
    transaction?: { id: string; snapshotId: string; manifest?: Pick<AnswerManifest, "claims" | "rosters">; outcome: { status: string } };
  };
}

export interface Promotion {
  store: PrecedentStore;
  /** Candidates written, by entry. */
  added: readonly string[];
  /** Runs left out, by reason, as counts — every exclusion is a number. */
  skipped: Readonly<Record<string, number>>;
}

function profileOf(transcript: ScopeTranscript): Precedent["profile"] | undefined {
  for (const event of transcript) {
    if (event.kind === "profile" && event.source === "trainer") {
      const { version, region, badgeLevel } = event.scope;
      if (typeof version === "string" && typeof region === "string" && typeof badgeLevel === "number") return { version, region, badgeLevel };
    }
  }
  return undefined;
}

/**
 * One accepted exchange as a precedent — the shape from the certified
 * manifest (values stripped by construction), the ask verbatim, the record
 * it came from. Shared by both promotion sources.
 */
export function promoteExchange(input: {
  id: string;
  ask: string;
  transcript: ScopeTranscript;
  transaction: { id: string; snapshotId: string; manifest: Pick<AnswerManifest, "claims" | "rosters"> };
  source: Precedent["source"];
  promoted: Precedent["promoted"];
}): Precedent {
  const profile = profileOf(input.transcript);
  return {
    id: input.id,
    snapshotId: input.transaction.snapshotId,
    ask: input.ask,
    ...(profile === undefined ? {} : { profile }),
    shape: shapeOf(input.transaction.manifest),
    source: input.source,
    promoted: input.promoted,
  };
}

/**
 * Promote a filed bank run into a store — merged into `existing` when one
 * is given, so a second artifact adds what the first lacked. One precedent
 * per distinct ask (case-folded): a bank entry accepted in more than one
 * shape across the passes keeps the commonest, first-seen on a tie — the
 * M1 porch reading found three shapes of one ask crowding the door's k for
 * any ask that shared a word with it (findings §21), and the door teaches
 * which door to take, not every way it was once taken. An ask the store
 * already holds is left as it is.
 */
export function promoteFromRuns(
  runs: readonly PromotableRun[],
  input: { artifact: string; packId: string; at: string; existing?: PrecedentStore },
): Promotion {
  const precedents: Precedent[] = [...(input.existing?.precedents ?? [])];
  const known = new Set(precedents.map((one) => one.ask.trim().toLowerCase()));
  const ids = new Set(precedents.map((one) => one.id));
  const skipped: Record<string, number> = {};
  const skip = (reason: string, count = 1): void => {
    skipped[reason] = (skipped[reason] ?? 0) + count;
  };
  const added: string[] = [];

  // Every accepted, on-target shape per ask, in run order.
  const byAsk = new Map<string, { candidate: Precedent; shape: string }[]>();
  for (const run of runs) {
    const transaction = run.run.transaction;
    if (run.stage.kind !== "resolved") {
      skip(`not resolved (${run.stage.kind})`);
      continue;
    }
    if (!run.score.pass) {
      skip("resolved, but the oracle did not pass it (off subject or off shape)");
      continue;
    }
    if (transaction === undefined || transaction.manifest === undefined || transaction.outcome.status !== "answered") {
      skip("no certified manifest on the record");
      continue;
    }
    const candidate = promoteExchange({
      id: run.entryId,
      ask: run.opening,
      transcript: run.run.transcript,
      transaction: { id: transaction.id, snapshotId: transaction.snapshotId, manifest: transaction.manifest },
      source: { kind: "bank-run", artifact: input.artifact, transactionId: transaction.id, entryId: run.entryId },
      promoted: { by: "oracle", at: input.at },
    });
    const ask = candidate.ask.trim().toLowerCase();
    if (known.has(ask)) {
      skip("already in the store (same ask)");
      continue;
    }
    const shapes = byAsk.get(ask) ?? [];
    shapes.push({ candidate, shape: canonicalShape(candidate.shape) });
    byAsk.set(ask, shapes);
  }

  for (const [ask, shapes] of byAsk) {
    // The commonest shape; the first seen breaks a tie, so the choice replays.
    const counts = new Map<string, number>();
    for (const one of shapes) counts.set(one.shape, (counts.get(one.shape) ?? 0) + 1);
    const best = [...counts.entries()].reduce((top, entry) => (entry[1] > top[1] ? entry : top));
    const chosen = shapes.find((one) => one.shape === best[0])!.candidate;
    if (shapes.length > 1) skip("the same ask accepted again (the commonest shape was kept)", shapes.length - 1);
    // A stable id per entry; a second entry with the same ask is numbered.
    let id = `p-${chosen.id}`;
    for (let n = 2; ids.has(id); n += 1) id = `p-${chosen.id}-${n}`;
    ids.add(id);
    known.add(ask);
    precedents.push({ ...chosen, id });
    added.push(id);
  }

  return {
    store: { schemaVersion: PRECEDENT_SCHEMA_VERSION, packId: input.packId, precedents },
    added,
    skipped,
  };
}
