import { describe, expect, it } from "vitest";

import type { ScopeEvent, TrainerScope } from "../kernel/contracts.js";
import { candidateDigest } from "../kernel/scope.js";
import { candidateIsTrue, respondToProposal } from "./trainer.js";

const TRUTH: TrainerScope = { version: "red-blue", region: "kanto", badgeLevel: 8, comparisonBasis: "base-speed" };
const AT = "2026-01-01T00:00:00Z";

function proposal(candidate: Record<string, unknown>, id = "prop-1"): Extract<ScopeEvent, { kind: "proposal" }> {
  return { kind: "proposal", at: AT, id, candidate: candidate as never, interpreting: "the quickest" };
}

describe("candidateIsTrue", () => {
  it("is true when every stated dimension matches the trainer's meaning", () => {
    expect(candidateIsTrue({ comparisonBasis: "base-speed" }, TRUTH)).toBe(true);
  });

  it("is false on the one dimension that disagrees", () => {
    expect(candidateIsTrue({ comparisonBasis: "base-attack" }, TRUTH)).toBe(false);
  });

  it("checks every pinned dimension, not only the interesting one", () => {
    // Right about the basis, wrong about the version: confirming this would let
    // the wrong version commit under cover of the right basis.
    expect(candidateIsTrue({ comparisonBasis: "base-speed", version: "yellow" }, TRUTH)).toBe(false);
  });
});

describe("respondToProposal", () => {
  it("confirms a true candidate, naming the digest of exactly what was shown", () => {
    const event = proposal({ comparisonBasis: "base-speed" });
    const reply = respondToProposal(event, TRUTH, AT);
    expect(reply.decision).toBe("confirm");
    expect(reply.source).toBe("trainer");
    expect(reply.proposalId).toBe("prop-1");
    expect(reply.candidateDigest).toBe(candidateDigest("prop-1", event.candidate));
  });

  it("rejects a false candidate rather than being talked into it", () => {
    const reply = respondToProposal(proposal({ comparisonBasis: "base-defense" }), TRUTH, AT);
    expect(reply.decision).toBe("reject");
  });
});
