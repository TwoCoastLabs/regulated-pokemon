import { describe, expect, it } from "vitest";

import type { ScopeEvent, TrainerScope } from "../kernel/contracts.js";
import {
  type DomElement,
  element,
  LOCALE_ATTRIBUTE,
  text,
  TRANSACTION_ATTRIBUTE,
  UNIT_ATTRIBUTE,
  walkArtifact,
} from "../kernel/dom.js";
import { candidateDigest } from "../kernel/scope.js";
import { candidateIsTrue, respondToArtifact, respondToProposal } from "./trainer.js";

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

describe("respondToArtifact", () => {
  const ASK = { tool: "release", entityId: "raticate" };

  /** A page proposing the given acts, marked the way the renderer marks one. */
  function page(actions: readonly { id: string; hidden?: boolean }[]): DomElement {
    return element("article", { [TRANSACTION_ATTRIBUTE]: "txn-release", [LOCALE_ATTRIBUTE]: "en-US" }, [
      ...actions.map((action) =>
        element("section", { [UNIT_ATTRIBUTE]: action.id, ...(action.hidden ? { hidden: "" } : {}) }, [
          text("release card"),
        ]),
      ),
    ]);
  }

  it("confirms exactly the act they asked for, digesting what they saw themselves", () => {
    const artifact = page([{ id: "action:release:raticate" }]);
    const reply = respondToArtifact(artifact, ASK, AT);

    expect(reply).not.toBeNull();
    expect(reply?.source).toBe("trainer");
    expect(reply?.transactionId).toBe("txn-release");
    // The digest is the trainer's own walk of the page — never copied from an
    // affidavit, which is the transport's evidence, not theirs.
    expect(reply?.artifactDigest).toBe(walkArtifact(artifact).digest);
  });

  it("declines an act aimed at a different Pokémon than the one they named", () => {
    expect(respondToArtifact(page([{ id: "action:release:pikachu" }]), ASK, AT)).toBeNull();
  });

  it("declines a page smuggling a second act beside the right one", () => {
    // The phase-3 confirmation trap, on a page: an extra act riding along on a
    // confirmed page would commit invisibly under cover of the asked-for one.
    const artifact = page([{ id: "action:release:raticate" }, { id: "action:release:pikachu" }]);
    expect(respondToArtifact(artifact, ASK, AT)).toBeNull();
  });

  it("declines any act when they came asking a question", () => {
    expect(respondToArtifact(page([{ id: "action:release:raticate" }]), undefined, AT)).toBeNull();
  });

  it("does not confirm an act it cannot see", () => {
    // The asked-for act is on the page but hidden; a trainer cannot consent to
    // an invisible proposal, so no confirmation exists for the kernel to judge.
    expect(respondToArtifact(page([{ id: "action:release:raticate", hidden: true }]), ASK, AT)).toBeNull();
  });
});
