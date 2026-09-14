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
 * is given, so a second artifact adds what the first lacked. Two precedents
 * are one when they share an ask (case-folded) and a canonical shape; a
 * bank entry that was accepted in more than one shape keeps each, numbered.
 */
export function promoteFromRuns(
  runs: readonly PromotableRun[],
  input: { artifact: string; packId: string; at: string; existing?: PrecedentStore },
): Promotion {
  const precedents: Precedent[] = [...(input.existing?.precedents ?? [])];
  const known = new Set(precedents.map((one) => `${one.ask.trim().toLowerCase()}|${canonicalShape(one.shape)}`));
  const ids = new Set(precedents.map((one) => one.id));
  const skipped: Record<string, number> = {};
  const skip = (reason: string): void => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const added: string[] = [];

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
    const key = `${candidate.ask.trim().toLowerCase()}|${canonicalShape(candidate.shape)}`;
    if (known.has(key)) {
      skip("already in the store (same ask, same shape)");
      continue;
    }
    // A stable id per entry; a second accepted shape for one entry is numbered.
    let id = `p-${run.entryId}`;
    for (let n = 2; ids.has(id); n += 1) id = `p-${run.entryId}-${n}`;
    ids.add(id);
    known.add(key);
    precedents.push({ ...candidate, id });
    added.push(id);
  }

  return {
    store: { schemaVersion: PRECEDENT_SCHEMA_VERSION, packId: input.packId, precedents },
    added,
    skipped,
  };
}
