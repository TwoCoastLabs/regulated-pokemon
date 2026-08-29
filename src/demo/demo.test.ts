/**
 * What the slice is for.
 *
 * Two things had no test anywhere before this: that the landed phases agree
 * about what they hand each other when run as one exchange, and that a denial
 * means something to a reader who is not an `expect`. Both are asserted here,
 * and the second one is asserted against *every* mutation the crucible knows
 * about — so a new sabotage cannot land with a refusal no human-facing surface
 * can explain.
 */

import { describe, expect, it } from "vitest";

import { ACCORD_ARTICLES, article } from "../kernel/accord.js";
import { expectedDenial } from "../crucible/harness.js";
import { ALL_MUTATIONS } from "../crucible/phases.js";
import { verifyManifest } from "../kernel/manifest.js";
import { verifyScopeGrant } from "../kernel/scope.js";
import { runTransaction } from "../kernel/transaction.js";
import { denialCode } from "../kernel/violation.js";
import { play, playAndCheck, playSabotage, runDemo, sabotageWorldFor } from "./demo.js";
import { demoWorld } from "./files.js";
import {
  COMMITTED_AT,
  CONVERSATIONS,
  conversation,
  demoPlan,
  ESTABLISHED_AT,
  LOCALE,
  REQUIRED,
} from "./script.js";
import { describeDenial, describeTransaction } from "./trace.js";

const everyConversation = CONVERSATIONS.map((entry) => [entry.id, entry] as const);
const everyMutation = ALL_MUTATIONS.map((mutation) => [mutation.id, mutation] as const);

describe("the seam runs the landed phases as one exchange", () => {
  it.each(everyConversation)("%s ends the way it declares", (_id, entry) => {
    const transaction = play(entry);
    expect(transaction.outcome.status).toBe(entry.expects);
  });

  it("a clean conversation produces a grant and a manifest bound to each other", () => {
    const transaction = play(CONVERSATIONS[0]!);

    expect(transaction.outcome.status).toBe("answered");
    expect(transaction.manifest?.scopeGrantId).toBe(transaction.grant?.id);
    expect(transaction.manifest?.transactionId).toBe(transaction.id);
    expect(transaction.manifest?.packId).toBe(transaction.packId);
    expect(transaction.manifest?.snapshotId).toBe(transaction.snapshotId);
    expect(transaction.verdicts.map((entry) => entry.stage)).toEqual(["scope", "answer"]);
    for (const entry of transaction.verdicts) expect(entry.verdict.allowed).toBe(true);
  });

  it("both stage verdicts survive independent re-verification", () => {
    // The seam is a record, not an authority. If it were quietly deciding
    // anything, the kernel's own verifiers would disagree with it here.
    const transaction = play(CONVERSATIONS[0]!);
    const { registry, pack } = demoWorld();
    const grant = transaction.grant!;

    const scope = verifyScopeGrant(
      { pack, at: ESTABLISHED_AT, required: REQUIRED },
      transaction.transcript,
      grant,
    );
    const answer = verifyManifest(
      { registry, pack, grant, locale: LOCALE, at: COMMITTED_AT },
      transaction.manifest!,
    );

    expect(scope.violations).toEqual([]);
    expect(answer.violations).toEqual([]);
  });

  it("a hostile conversation reaches the same answer as the clean one", () => {
    // The claim IA-8 actually makes. Not "the injection was blocked" — the
    // injected wording never had the authority to move anything, so the two
    // transactions differ only in what the record contains.
    const clean = play(conversation("clean")!);
    const injected = play(conversation("injected")!);

    expect(injected.outcome.status).toBe("answered");
    expect(injected.grant?.scope).toEqual(clean.grant?.scope);
    expect(injected.manifest?.claims).toEqual(clean.manifest?.claims);
  });

  it("reads the hostile wording rather than filtering it out", () => {
    const injected = play(conversation("injected")!);
    const ignored = injected.derivation.ignored;

    // Every attempt to move scope to Yellow is present in the record with a
    // named reason. A resolver that had simply not seen them would look
    // identical from the outcome and be a different, weaker thing.
    expect(ignored.filter((match) => match.value === "yellow").length).toBeGreaterThanOrEqual(3);
    expect(new Set(ignored.map((match) => match.blockedBy))).toContain("reported");
    expect(new Set(ignored.map((match) => match.blockedBy))).toContain("foreign-channel");
  });

  it("asks for exactly one thing when scope is incomplete", () => {
    const outcome = play(conversation("incomplete")!).outcome;

    expect(outcome.status).toBe("clarifying");
    if (outcome.status !== "clarifying") return;
    expect(outcome.missing.length).toBeGreaterThan(1);
    expect(outcome.asking).toBe(outcome.missing[0]);
    expect(outcome.question).not.toBe("");
  });

  it("compiles nothing when scope is incomplete", () => {
    const transaction = play(conversation("incomplete")!);

    expect(transaction.manifest).toBeUndefined();
    expect(transaction.grant).toBeUndefined();
    // A clarification is not a denial dressed up as a question, and not a
    // verdict either: no stage ruled, so no stage is recorded as having ruled.
    expect(transaction.verdicts).toEqual([]);
  });
});

describe("the seam stops at the stage that could not proceed", () => {
  function transactionWith(overrides: Partial<Parameters<typeof runTransaction>[0]>) {
    const { registry, pack } = demoWorld();
    return runTransaction({
      id: "txn-demo-test",
      registry,
      pack,
      transcript: conversation("clean")!.transcript,
      establishedAt: ESTABLISHED_AT,
      committedAt: COMMITTED_AT,
      locale: LOCALE,
      required: REQUIRED,
      plan: demoPlan,
      ...overrides,
    });
  }

  it("refuses an answer whose plan claims something the snapshot does not certify", () => {
    // The plan is the propose step, and the propose step is untrusted. Here it
    // is simply wrong, which is what a model getting a stat wrong looks like
    // from the kernel's side.
    const transaction = transactionWith({
      plan: (context, id) => {
        const draft = demoPlan(context, id);
        return {
          ...draft,
          claims: draft.claims.map((claim) =>
            claim.kind === "fact" ? { ...claim, asserted: { kind: "number" as const, value: 200 } } : claim,
          ),
        };
      },
    });

    expect(transaction.outcome.status).toBe("denied");
    if (transaction.outcome.status !== "denied") return;
    expect(transaction.outcome.stage).toBe("answer");
    expect(transaction.outcome.violations.map(denialCode)).toContain("IA-2/fact-mismatch");
    // Scope was established and is recorded as such. The stages are side by
    // side, not fused: one refusal does not retroactively unestablish scope.
    expect(transaction.grant).toBeDefined();
    expect(transaction.verdicts.map((entry) => entry.verdict.allowed)).toEqual([true, false]);
    expect(transaction.manifest).toBeUndefined();
    expect(describeTransaction(transaction).join("\n")).toContain("IA-2/fact-mismatch");
  });

  it("refuses scope established before the conversation it rests on", () => {
    const transaction = transactionWith({ establishedAt: "2025-12-31T00:00:00Z" });

    expect(transaction.outcome.status).toBe("denied");
    if (transaction.outcome.status !== "denied") return;
    expect(transaction.outcome.stage).toBe("scope");
    expect(transaction.outcome.violations.map(denialCode)).toContain("IA-1/grant-predates-evidence");
    // Nothing downstream ran: an answer compiled against scope that was never
    // established would be an answer to a question nobody asked.
    expect(transaction.verdicts.map((entry) => entry.stage)).toEqual(["scope"]);
    expect(transaction.manifest).toBeUndefined();
  });

  it("shows a contradiction as a contradiction", () => {
    const transaction = play(conversation("contradicted")!);

    expect(transaction.derivation.contradicted).toContain("version");
    expect(describeTransaction(transaction).join("\n")).toContain("established two ways");
  });
});

describe("the demo's own self-check can fail", () => {
  // The self-check is what makes `npm run demo` evidence rather than
  // decoration, so it needs the same treatment the crucible's controls get:
  // proof that it is capable of saying no.
  const world = { title: "t", description: "d", run: () => ({ allowed: true, violations: [] }) };

  it("fails when a conversation ends the wrong way", () => {
    const result = playAndCheck({ ...conversation("clean")!, expects: "clarifying" });

    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("DEMO FAILED");
  });

  it("fails when a sabotage is allowed through", () => {
    const result = playSabotage({ ...world, id: "allowed", article: "IA-3", rule: "fabricated-entity" });

    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("DEMO FAILED");
  });

  it("fails when a sabotage is refused for a different reason", () => {
    const result = playSabotage({
      ...world,
      id: "wrong-reason",
      article: "IA-3",
      rule: "fabricated-entity",
      run: () => ({
        allowed: false,
        violations: [{ article: "IA-2" as const, rule: "fact-mismatch", message: "something else" }],
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("DEMO FAILED");
  });
});

describe("every denial explains itself to a reader", () => {
  it.each(everyMutation)("%s", (_id, mutation) => {
    const verdict = mutation.run(sabotageWorldFor(mutation));
    expect(verdict.allowed, `${mutation.id} was allowed through`).toBe(false);

    for (const item of verdict.violations) {
      const found = article(item.article);
      const rendered = describeDenial(item).join("\n");

      expect(rendered, "the grep-able code").toContain(denialCode(item));
      expect(rendered, "the article's number").toContain(found.id);
      expect(rendered, "the article's title").toContain(found.title);
      // The analog is the line that makes a Pokémon denial mean something
      // outside Pokémon, which is the entire point of the exercise.
      expect(rendered, "the real-world analog").toContain(found.analog);
      expect(rendered, "the message").toContain(item.message);
      // "Blocked by policy" is banned in the kernel; a console that printed
      // only a slug would reintroduce it one layer up.
      expect(rendered.split("\n").length).toBeGreaterThan(2);
    }
  });

  it("renders every article in the registry the same way", () => {
    // Guards the mapping rather than the mutations: an article added to the
    // registry with no title or analog would render a hollow denial, and no
    // mutation exercising it yet would hide that until phase 5 or 6.
    for (const entry of ACCORD_ARTICLES) {
      const rendered = describeDenial({
        article: entry.id,
        rule: "specimen",
        message: "specimen",
      }).join("\n");
      expect(rendered).toContain(entry.title);
      expect(rendered).toContain(entry.analog);
    }
  });
});

describe("the demo is self-checking", () => {
  it("plays every conversation and succeeds", () => {
    const result = runDemo([]);

    expect(result.exitCode).toBe(0);
    for (const entry of CONVERSATIONS) expect(result.lines.join("\n")).toContain(entry.title);
  });

  it.each(everyMutation)("--sabotage %s is refused under what it declared", (_id, mutation) => {
    const result = runDemo(["--sabotage", mutation.id]);

    expect(result.exitCode, result.lines.join("\n")).toBe(0);
    expect(result.lines.join("\n")).toContain(expectedDenial(mutation));
  });

  it("lists every conversation and every sabotage", () => {
    const listed = runDemo(["--list"]);

    expect(listed.exitCode).toBe(0);
    for (const mutation of ALL_MUTATIONS) expect(listed.lines.join("\n")).toContain(mutation.id);
    for (const entry of CONVERSATIONS) expect(listed.lines.join("\n")).toContain(entry.id);
  });

  it("refuses an id it does not know rather than playing something else", () => {
    expect(runDemo(["--sabotage", "not-a-mutation"]).exitCode).toBe(1);
    expect(runDemo(["--conversation", "not-a-conversation"]).exitCode).toBe(1);
  });

  it("plays one conversation on request", () => {
    const result = runDemo(["--conversation", "incomplete"]);

    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).not.toContain(CONVERSATIONS[0]!.title);
  });

  it("explains itself", () => {
    const help = runDemo(["--help"]);

    expect(help.exitCode).toBe(0);
    expect(help.lines.join("\n")).toContain("--sabotage");
  });
});
