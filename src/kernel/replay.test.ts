/**
 * Replay (IA-10): the harness re-executes a recorded transaction and reproduces
 * its verdict bit-for-bit.
 *
 * The crucible (src/crucible/phase6.ts) proves the denials — a doctored ledger,
 * an incomplete record, a drifted pin. These tests prove the other half: that
 * genuine transactions of every shape the seam can reach — an answered one, a
 * clarifying one — come back byte-identical, and that the one input replay
 * refuses to invent is refused by name rather than guessed.
 */

import { describe, expect, it } from "vitest";

import { honestDraft } from "../crucible/phase2.js";
import type { ScopeDimension } from "./contracts.js";
import { canonicalDigest, replayTransaction, verifyReplay } from "./replay.js";
import { REQUIRED_DIMENSIONS } from "./scope.js";
import { type AnswerPlan, runTransaction, type Transaction } from "./transaction.js";
import { denialCode } from "./violation.js";
import {
  COMMIT_TIME,
  ISSUED_AT,
  kantoPack,
  kantoRegistry,
  LOCALE,
  trainerTranscript,
} from "../testing/fixtures.js";

const REQUIRED: readonly ScopeDimension[] = [...REQUIRED_DIMENSIONS, "comparisonBasis"];
const plan: AnswerPlan = (context, transactionId) => ({ ...honestDraft(context), transactionId });

function world() {
  return { registry: kantoRegistry(), pack: kantoPack() };
}

/** An honest exchange, filed through the kernel's own front door. */
function file(id: string, transcript = trainerTranscript(), required = REQUIRED): Transaction {
  return runTransaction({
    id,
    registry: kantoRegistry(),
    pack: kantoPack(),
    transcript,
    establishedAt: ISSUED_AT,
    committedAt: COMMIT_TIME,
    locale: LOCALE,
    required,
    plan,
  });
}

describe("a genuine record reproduces bit-for-bit", () => {
  it("replays an answered transaction to the identical record", () => {
    const record = file("txn-answered");
    expect(record.outcome.status).toBe("answered");

    const replayed = replayTransaction(world(), record);
    expect(canonicalDigest(replayed)).toBe(canonicalDigest(record));
    expect(verifyReplay(world(), record)).toEqual({ allowed: true, violations: [] });
  });

  it("replays a clarifying transaction to the identical record", () => {
    // A transcript that never establishes the version: fail-closed here is a
    // question, not a refusal, and the question has to replay like anything else.
    const record = file("txn-clarifying", [
      { kind: "utterance", at: ISSUED_AT, source: "trainer", text: "I'm somewhere in the Kanto region with 8 badges." },
      { kind: "utterance", at: ISSUED_AT, source: "trainer", text: "Which is quickest?" },
    ]);
    expect(record.outcome.status).toBe("clarifying");

    const replayed = replayTransaction(world(), record);
    expect(canonicalDigest(replayed)).toBe(canonicalDigest(record));
    expect(verifyReplay(world(), record)).toEqual({ allowed: true, violations: [] });
  });

  it("reproduces the same record across two independent replays", () => {
    const record = file("txn-twice");
    const once = replayTransaction(world(), record);
    const twice = replayTransaction(world(), record);
    expect(canonicalDigest(once)).toBe(canonicalDigest(twice));
  });
});

describe("replay refuses to invent what the record does not carry", () => {
  it("throws a named denial when a granted record kept no answer", () => {
    const record = file("txn-answered");
    const { manifest: _dropped, ...withoutManifest } = record;

    expect(() => replayTransaction(world(), withoutManifest as Transaction)).toThrowError(/record-incomplete/);
  });

  it("turns that throw into a verdict when it goes through the gate", () => {
    const record = file("txn-answered");
    const { manifest: _dropped, ...withoutManifest } = record;

    const verdict = verifyReplay(world(), withoutManifest as Transaction);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map(denialCode)).toContain("IA-10/record-incomplete");
  });
});

describe("the canonical digest is content, not construction", () => {
  it("ignores key order and absent-versus-undefined fields", () => {
    expect(canonicalDigest({ a: 1, b: 2 })).toBe(canonicalDigest({ b: 2, a: 1 }));
    expect(canonicalDigest({ a: 1 })).toBe(canonicalDigest({ a: 1, b: undefined }));
  });

  it("keeps array order, which a faithful replay must reproduce", () => {
    expect(canonicalDigest([1, 2])).not.toBe(canonicalDigest([2, 1]));
  });

  it("distinguishes records that differ only in a nested value", () => {
    const record = file("txn-answered");
    const nudged: Transaction = { ...record, committedAt: "2026-01-01T12:00:01Z" };
    expect(canonicalDigest(nudged)).not.toBe(canonicalDigest(record));
  });
});
