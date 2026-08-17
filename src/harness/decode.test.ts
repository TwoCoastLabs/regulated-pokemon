import { describe, expect, it } from "vitest";

import type { ScopeGrant } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import { decodeAnswer, decodeCandidate } from "./decode.js";
import { harnessWorld } from "./corpus.js";

const world = harnessWorld();

const grant: ScopeGrant = {
  id: "grant-test",
  packId: world.pack.id,
  scope: { version: "red-blue", region: "kanto", badgeLevel: 8 },
  bindings: [],
  evidenceDigest: "sha256:unused",
  issuedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2027-01-01T00:00:00Z",
};
const context: ManifestContext = {
  registry: world.registry,
  pack: world.pack,
  grant,
  locale: "en-US",
  at: "2026-01-01T12:00:00Z",
};

describe("decodeCandidate", () => {
  it("decodes an approved-typed candidate and the wording it interprets", () => {
    const decoded = decodeCandidate(
      JSON.stringify({ candidate: { comparisonBasis: "base-speed" }, interpreting: "the quickest" }),
      world.pack,
    );
    expect(decoded).toEqual({ candidate: { comparisonBasis: "base-speed" }, interpreting: "the quickest" });
  });

  it("accepts a numeric dimension carrying a number", () => {
    const decoded = decodeCandidate(JSON.stringify({ candidate: { badgeLevel: 5 }, interpreting: "halfway" }), world.pack);
    expect(decoded?.candidate).toEqual({ badgeLevel: 5 });
  });

  it.each([
    ["not JSON at all", "not json"],
    ["a JSON array, not an object", "[]"],
    ["an empty completion", ""],
    ["a candidate that is not an object", JSON.stringify({ candidate: "base-speed", interpreting: "x" })],
    ["an empty candidate", JSON.stringify({ candidate: {}, interpreting: "x" })],
    ["missing interpreting", JSON.stringify({ candidate: { version: "red-blue" } })],
    ["blank interpreting", JSON.stringify({ candidate: { version: "red-blue" }, interpreting: "  " })],
    ["an unknown dimension", JSON.stringify({ candidate: { colour: "yellow" }, interpreting: "x" })],
    ["a text dimension given a number", JSON.stringify({ candidate: { version: 5 }, interpreting: "x" })],
    ["a number dimension given text", JSON.stringify({ candidate: { badgeLevel: "five" }, interpreting: "x" })],
  ])("returns null for %s — a malformed proposal is no proposal", (_label, text) => {
    expect(decodeCandidate(text, world.pack)).toBeNull();
  });
});

describe("markdown fences — packaging, not a claim", () => {
  const candidate = JSON.stringify({ candidate: { comparisonBasis: "base-speed" }, interpreting: "the quickest" });

  it("unwraps a fenced reply, which is how a live model usually returns JSON", () => {
    const decoded = decodeCandidate("```json\n" + candidate + "\n```", world.pack);
    expect(decoded?.candidate).toEqual({ comparisonBasis: "base-speed" });
  });

  it("unwraps an unlabelled fence too", () => {
    expect(decodeCandidate("```\n" + candidate + "\n```", world.pack)).not.toBeNull();
  });

  it("still refuses JSON buried in prose — leniency about shape is the one thing barred", () => {
    expect(decodeCandidate(`Sure! Here you go: ${candidate}`, world.pack)).toBeNull();
    expect(decodeCandidate("```json\n```", world.pack)).toBeNull();
  });
});

describe("decodeAnswer", () => {
  it("decodes every claim kind and fact-value shape, carried verbatim", () => {
    const text = JSON.stringify({
      rosters: [{ id: "r", criteria: { all: [{ kind: "has-type", type: "electric" }] } }],
      claims: [
        { kind: "fact", entityId: "e", factId: "f", asserted: { kind: "number", value: 1 } },
        { kind: "fact", entityId: "e", factId: "f", asserted: { kind: "boolean", value: true } },
        { kind: "fact", entityId: "e", factId: "f", asserted: { kind: "text", value: "t" } },
        { kind: "fact", entityId: "e", factId: "f", asserted: { kind: "list", value: ["a", "b"] } },
        { kind: "fact", entityId: "e", factId: "f", asserted: { kind: "absent" } },
        { kind: "count", rosterId: "r", reported: 3 },
        { kind: "membership", rosterId: "r", entityId: "e", asserted: false },
        { kind: "ranking", rosterId: "r", basis: "base-speed", direction: "lowest", selectedEntityId: "e" },
        { kind: "recommendation", entityId: "e" },
        { kind: "action", tool: "release", entityId: "e" },
        { kind: "matchup", subject: { kind: "species", entityId: "gengar" }, direction: "weak-to" },
        { kind: "matchup", subject: { kind: "type", typeId: "electric" }, direction: "strong-against", members: ["water"] },
      ],
    });
    const decoded = decodeAnswer(text, context, "txn-1");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.draft.transactionId).toBe("txn-1");
      expect(decoded.draft.claims).toHaveLength(12);
      expect(decoded.draft.rosters).toHaveLength(1);
    }
  });

  it.each([
    ["a matchup with no subject", { kind: "matchup", direction: "weak-to" }],
    ["a matchup with a malformed subject", { kind: "matchup", subject: { kind: "species" }, direction: "weak-to" }],
    ["a matchup with an unknown subject kind", { kind: "matchup", subject: { kind: "move", entityId: "surf" }, direction: "weak-to" }],
    ["a matchup with an unknown direction", { kind: "matchup", subject: { kind: "type", typeId: "water" }, direction: "beats" }],
    ["a matchup with malformed members", { kind: "matchup", subject: { kind: "type", typeId: "water" }, direction: "weak-to", members: [1] }],
  ])("refuses %s", (_label, claim) => {
    const decoded = decodeAnswer(JSON.stringify({ rosters: [], claims: [claim] }), context, "txn-1");
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toContain("claim is malformed");
  });

  it("carries a well-formed lie through intact — catching it is the kernel's job", () => {
    const text = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 999 } }],
    });
    const decoded = decodeAnswer(text, context, "txn-1");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.draft.claims[0]).toMatchObject({ asserted: { value: 999 } });
  });

  it("accepts a count with no stated number — the set is the count, and the kernel derives it", () => {
    const text = JSON.stringify({ rosters: [], claims: [{ kind: "count", rosterId: "electric-kanto" }] });
    const decoded = decodeAnswer(text, context, "txn-1");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.draft.claims[0]).toEqual({ kind: "count", rosterId: "electric-kanto" });
      expect((decoded.draft.claims[0] as { reported?: number }).reported).toBeUndefined();
    }
  });

  it("accepts a ranking with no winner named — the kernel names the extreme", () => {
    const text = JSON.stringify({
      rosters: [],
      claims: [{ kind: "ranking", rosterId: "electric-kanto", basis: "base-speed", direction: "highest" }],
    });
    const decoded = decodeAnswer(text, context, "txn-1");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect((decoded.draft.claims[0] as { selectedEntityId?: string }).selectedEntityId).toBeUndefined();
    }
  });

  it("refuses a roster the registry cannot support, with the article it earned", () => {
    const text = JSON.stringify({
      rosters: [{ id: "r", criteria: { all: [{ kind: "has-type", type: "nonexistent-type" }] } }],
      claims: [],
    });
    const decoded = decodeAnswer(text, context, "txn-1");
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toContain("roster was refused");
  });

  it.each([
    ["not a JSON object", "nope", "not a JSON object"],
    ["a JSON array", "[]", "not a JSON object"],
    ["missing claims", JSON.stringify({ rosters: [] }), "missing rosters or claims"],
    // An empty answer is an abstention, never a certificate: compiled, its
    // page would carry nothing but the provenance footer and still say
    // "checked & certified" — the dogfooding finding behind this row.
    ["an empty answer", JSON.stringify({ rosters: [], claims: [] }), "asserts no claims"],
    ["a malformed roster", JSON.stringify({ rosters: [{ id: 5 }], claims: [] }), "roster is malformed"],
    [
      "a malformed claim",
      JSON.stringify({ rosters: [], claims: [{ kind: "count" }] }),
      "claim is malformed",
    ],
    [
      "a count with a non-numeric stated number",
      JSON.stringify({ rosters: [], claims: [{ kind: "count", rosterId: "r", reported: "lots" }] }),
      "claim is malformed",
    ],
    [
      "an unknown claim kind",
      JSON.stringify({ rosters: [], claims: [{ kind: "teleport" }] }),
      "claim is malformed",
    ],
    [
      "a fact with a bad value type",
      JSON.stringify({
        rosters: [],
        claims: [{ kind: "fact", entityId: "e", factId: "f", asserted: { kind: "number", value: "x" } }],
      }),
      "claim is malformed",
    ],
    [
      "a fact with an unknown value kind",
      JSON.stringify({
        rosters: [],
        claims: [{ kind: "fact", entityId: "e", factId: "f", asserted: { kind: "colour", value: "y" } }],
      }),
      "claim is malformed",
    ],
  ])("fails closed on %s", (_label, text, reason) => {
    const decoded = decodeAnswer(text, context, "txn-1");
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toContain(reason);
  });
});
