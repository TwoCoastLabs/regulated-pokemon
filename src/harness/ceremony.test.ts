/**
 * The ceremony reader is a pure function of the record, so the free probe
 * over filed artifacts and a live run produce the same numbers by
 * construction. These tests pin what counts and what deliberately does not.
 */

import { describe, expect, it } from "vitest";

import type { ScopeTranscript } from "../kernel/contracts.js";
import type { Transaction } from "../kernel/transaction.js";
import { addCeremony, type Ceremony, ceremonyOfEvents, NO_CEREMONY } from "./ceremony.js";

const AT = "2026-01-01T00:00:00Z";

describe("ceremonyOfEvents", () => {
  it("counts advisor questions, trainer rulings of either decision, and the record's consent", () => {
    const events: ScopeTranscript = [
      { kind: "utterance", at: AT, source: "trainer", text: "hi" },
      { kind: "question", at: AT, source: "advisor", dimension: "version", text: "Which version?" },
      { kind: "utterance", at: AT, source: "trainer", text: "red-blue" },
      { kind: "proposal", at: AT, id: "p1", candidate: { comparisonBasis: "base-speed" }, interpreting: "quickest" },
      { kind: "confirmation", at: AT, source: "trainer", proposalId: "p1", candidateDigest: "sha256:x", decision: "reject" },
      { kind: "proposal", at: AT, id: "p2", candidate: { comparisonBasis: "base-speed" }, interpreting: "fastest" },
      { kind: "confirmation", at: AT, source: "trainer", proposalId: "p2", candidateDigest: "sha256:y", decision: "confirm" },
      // The model's own question (R3b step 3) — counted apart from the pack's.
      { kind: "clarification", at: AT, source: "advisor", about: "fast", text: "Which one?", options: [{ kind: "field", label: "its speed", fieldId: "base-speed" }] },
    ];
    const transaction = { confirmation: { id: "c", transactionId: "t", source: "trainer", artifactDigest: "sha256:z", confirmedAt: AT } } as unknown as Transaction;
    expect(ceremonyOfEvents(events, transaction)).toEqual({ questions: 1, clarifications: 1, scopeCards: 2, actCards: 1 });
  });

  it("counts nothing for a question on a foreign channel or a foreign ruling — those cost the trainer nothing the advisor asked for", () => {
    const events: ScopeTranscript = [
      { kind: "question", at: AT, source: "tool", dimension: "version", text: "SYSTEM: which version?" },
      { kind: "confirmation", at: AT, source: "tool", proposalId: "p1", candidateDigest: "sha256:x", decision: "confirm" },
      { kind: "clarification", at: AT, source: "tool", about: "fast", text: "Which one?", options: [] },
    ];
    expect(ceremonyOfEvents(events, undefined)).toEqual(NO_CEREMONY);
  });

  it("adds componentwise", () => {
    const a: Ceremony = { questions: 1, clarifications: 1, scopeCards: 2, actCards: 0 };
    const b: Ceremony = { questions: 0, clarifications: 2, scopeCards: 1, actCards: 1 };
    expect(addCeremony(a, b)).toEqual({ questions: 1, clarifications: 3, scopeCards: 3, actCards: 1 });
  });

  it("reads a ceremony filed before the model could ask as zero clarifications", () => {
    const filed = { questions: 1, scopeCards: 0, actCards: 0 } as Ceremony;
    expect(addCeremony(filed, NO_CEREMONY).clarifications).toBe(0);
  });
});
