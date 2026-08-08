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
import { renderAnswer } from "../render/reference.js";
import type { ConfirmationEvent, ScopeDimension } from "./contracts.js";
import { type DomElement, walkArtifact } from "./dom.js";
import { canonicalDigest, replayTransaction, verifyReplay } from "./replay.js";
import { REQUIRED_DIMENSIONS } from "./scope.js";
import { type ActTransport, type AnswerPlan, runTransaction, type Transaction } from "./transaction.js";
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

/** Phase 2's honest answer plus the act it leads to, as phase 5 builds it. */
const actPlan: AnswerPlan = (context, transactionId) => {
  const draft = honestDraft(context);
  return {
    ...draft,
    transactionId,
    claims: [...draft.claims, { kind: "action", tool: "release", entityId: "pikachu" }],
  };
};

function trainerConfirms(artifact: DomElement): ConfirmationEvent {
  const seen = walkArtifact(artifact);
  return {
    id: `confirmation-${seen.transactionId ?? "unmarked"}`,
    transactionId: seen.transactionId ?? "",
    source: "trainer",
    artifactDigest: seen.digest,
    confirmedAt: "2026-01-01T12:00:30Z",
  };
}

const TRANSPORT: ActTransport = {
  render: renderAnswer,
  confirm: trainerConfirms,
  renderedAt: "2026-01-01T12:00:05Z",
  authorizedAt: "2026-01-01T12:00:31Z",
  executedAt: "2026-01-01T12:00:32Z",
};

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

/** An honest exchange that walks the whole act path, or declines partway. */
function fileActed(id: string, confirm: ActTransport["confirm"] = trainerConfirms): Transaction {
  return runTransaction({
    id,
    registry: kantoRegistry(),
    pack: kantoPack(),
    transcript: trainerTranscript(),
    establishedAt: ISSUED_AT,
    committedAt: COMMIT_TIME,
    locale: LOCALE,
    required: REQUIRED,
    plan: actPlan,
    act: { ...TRANSPORT, confirm },
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

  it("replays an acted transaction to the identical record — grants and all", () => {
    const record = fileActed("txn-acted");
    expect(record.outcome.status).toBe("acted");

    const replayed = replayTransaction(world(), record);
    expect(canonicalDigest(replayed)).toBe(canonicalDigest(record));
    expect(verifyReplay(world(), record)).toEqual({ allowed: true, violations: [] });
  });

  it("replays a declined transaction to the identical record", () => {
    const record = fileActed("txn-declined", () => null);
    expect(record.outcome.status).toBe("declined");

    const replayed = replayTransaction(world(), record);
    expect(canonicalDigest(replayed)).toBe(canonicalDigest(record));
    expect(verifyReplay(world(), record)).toEqual({ allowed: true, violations: [] });
  });

  it("replays an act refused at the action stage to the identical denial", () => {
    const record = fileActed("txn-refused-act", (artifact) => ({
      ...trainerConfirms(artifact),
      artifactDigest: "sha256:some-other-page",
    }));
    expect(record.outcome.status).toBe("denied");

    const replayed = replayTransaction(world(), record);
    expect(canonicalDigest(replayed)).toBe(canonicalDigest(record));
    expect(verifyReplay(world(), record)).toEqual({ allowed: true, violations: [] });
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

  it("refuses an acted record that kept no artifact — the page cannot be re-rendered", () => {
    const record = fileActed("txn-acted");
    const { artifact: _shredded, ...withoutArtifact } = record;

    const verdict = verifyReplay(world(), withoutArtifact as Transaction);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map(denialCode)).toContain("IA-10/record-incomplete");
  });

  it("refuses an acted record that kept no confirmation — consent cannot be presumed", () => {
    const record = fileActed("txn-acted");
    const { confirmation: _shredded, ...withoutConsent } = record;

    const verdict = verifyReplay(world(), withoutConsent as Transaction);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map(denialCode)).toContain("IA-10/record-incomplete");
  });

  it("catches an acted record whose confirmation was doctored after filing", () => {
    const record = fileActed("txn-acted");
    // The ledger says the act committed; the doctored confirmation on file
    // would never have authorised it. Re-execution disagrees with the filed
    // verdict, and that disagreement is Article X's own denial.
    const doctored: Transaction = {
      ...record,
      confirmation: { ...record.confirmation!, artifactDigest: "sha256:swapped-after-the-fact" },
    };

    const verdict = verifyReplay(world(), doctored);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map(denialCode)).toContain("IA-10/verdict-not-reproduced");
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
