/**
 * The tracer, proven offline the way the session module is: scripted models,
 * an injected clock, the visitor played by argv. What it defends is the
 * instrument's honesty — the lines a reader argues from must say what the
 * session actually did.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import { FailingProvider, type ModelProvider, ScriptedProvider } from "../harness/provider.js";
import type { SessionDeps } from "./session.js";
import * as trace from "./trace.js";
import { runTrace } from "./trace.js";

const world = harnessWorld();

function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ++tick)).toISOString();
}

function deps(provider: ModelProvider): SessionDeps {
  return { world, provider, now: clock() };
}

const PROFILE = "I'm playing Red and Blue, travelling around the Kanto region, and I have 8 badges.";

const rankingAnswer = JSON.stringify({
  rosters: [{ id: "electric-kanto", criteria: { all: [{ kind: "has-type", type: "electric" }] } }],
  claims: [{ kind: "ranking", rosterId: "electric-kanto", basis: "base-speed", direction: "highest" }],
});

const basisProposal = JSON.stringify({
  candidate: { comparisonBasis: "base-speed" },
  interpreting: "the quickest",
});

describe("runTrace narrates what the session did", () => {
  it("narrates a strip-assertion repair, and the record carries the certified value", async () => {
    // The model asserts a wrong Pikachu speed; with repair on, the trace shows
    // the [repair] line and the exchange still files an answered record.
    const wrongSpeed = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 42 } }],
    });
    const provider = new ScriptedProvider("scripted:misremember", (request) =>
      request.purpose === "answer" ? wrongSpeed : "decline",
    );
    const result = await runTrace(
      [`${PROFILE} What is Pikachu's Speed?`],
      { ...deps(provider), repair: true },
    );
    const page = result.lines.join("\n");
    expect(page).toContain("[repair]");
    expect(page).toContain("answered");
  });

  it("traces a whole exchange: proposal, confirmation, record, scope and cost", async () => {
    const provider = new ScriptedProvider("scripted:ranker", (request) =>
      request.purpose === "scope" ? basisProposal : rankingAnswer,
    );
    const result = await runTrace(
      [`${PROFILE} Which of the Electric ones is the quickest?`, "/confirm"],
      deps(provider),
    );

    expect(result.exitCode).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("[advisor proposes");
    expect(text).toContain("comparisonBasis=base-speed");
    expect(text).toContain('interpreting: "the quickest"');
    expect(text).toContain("[trainer decides] confirm");
    expect(text).toContain("[record · session-1] answered");
    expect(text).toContain("claim: ranking electric-kanto by base-speed (highest)");
    expect(text).toContain("scope: ");
    expect(text).toContain("1 record(s)");
  });

  it("traces the fall to the pack's own question", async () => {
    const provider = new ScriptedProvider("scripted:mute-scope", (request) =>
      request.purpose === "answer" ? rankingAnswer : "no JSON here",
    );
    const result = await runTrace([`${PROFILE} Which of the Electric ones is the quickest?`], deps(provider));

    expect(result.exitCode).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("[advisor asks · comparisonBasis]");
    expect(text).toContain("[phase] asking about comparisonBasis");
  });

  it("traces the profile command: typed scope set once, no question, no card (epic #145, R2)", async () => {
    const provider = new ScriptedProvider("scripted:mute-scope", (request) =>
      request.purpose === "answer" ? rankingAnswer : "no JSON here",
    );
    const result = await runTrace(
      ["/profile version=red-blue,region=kanto,badgeLevel=8,comparisonBasis=base-speed", "Which of the Electric ones is the quickest?"],
      deps(provider),
    );
    expect(result.exitCode).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("[trainer profile] { version=red-blue, region=kanto, badgeLevel=8, comparisonBasis=base-speed }");
    expect(text).not.toContain("[advisor asks");
    expect(text).not.toContain("[advisor proposes");
    expect(text).toContain("answered");
  });

  it("refuses an unknown command by name, keeping the trace to that point", async () => {
    const provider = new ScriptedProvider("scripted:any", () => rankingAnswer);
    const result = await runTrace([`${PROFILE} What is Thunderbolt's power?`, "/frobnicate"], deps(provider));

    expect(result.exitCode).toBe(2);
    expect(result.lines.join("\n")).toContain('unknown command "/frobnicate"');
  });

  it("prints usage when given nothing to do", async () => {
    const result = await runTrace([], deps(new ScriptedProvider("scripted:idle", () => "")));
    expect(result.exitCode).toBe(2);
    expect(result.lines[0]).toContain("usage:");
  });

  it("traces a denial with its named violations, and a rejected proposal", async () => {
    const fabricator = new ScriptedProvider("scripted:adversary", (request) =>
      request.purpose === "scope"
        ? basisProposal
        : JSON.stringify({
            rosters: [],
            claims: [
              { kind: "fact", entityId: "thunderbolt", factId: "move-power", asserted: { kind: "number", value: 999 } },
            ],
          }),
    );
    const result = await runTrace(
      [`${PROFILE} What is Thunderbolt's power?`, "/reject"],
      deps(fabricator),
    );
    const text = result.lines.join("\n");
    expect(text).toContain("DENIED at answer");
    expect(text).toContain("IA-2/");
  });

  it("traces an infrastructure note and the /retry that recovers from it", async () => {
    // The provider dies on the first ask; the trace shows the error note and
    // the phase it left behind, and /retry is a first-class input.
    const down = new FailingProvider("scripted:down");
    const result = await runTrace([`${PROFILE} What is Thunderbolt's power?`, "/retry"], deps(down));
    const text = result.lines.join("\n");
    expect(text).toContain("[note · error]");
    expect(text).toContain("[button] /retry");
    expect(text).toContain("provider error(s)");
  });

  it("traces consent on the page: /act executes and /decline stands down", async () => {
    const releaser = new ScriptedProvider("scripted:release", () =>
      JSON.stringify({ rosters: [], claims: [{ kind: "action", tool: "release", entityId: "raticate" }] }),
    );
    const acted = await runTrace([`${PROFILE} Please release my Raticate.`, "/act"], deps(releaser));
    expect(acted.lines.join("\n")).toContain("[record · session-1] acted");
    expect(acted.lines.join("\n")).toContain("claim: action release raticate");

    const declined = await runTrace([`${PROFILE} Please release my Raticate.`, "/decline"], deps(releaser));
    expect(declined.lines.join("\n")).toContain("[record · session-1] declined");
  });
});

describe("parseTraceArgs keeps the entry point straight-line", () => {
  it("splits flags from inputs and honors --model over --weak", () => {
    const { parseTraceArgs } = trace;
    expect(parseTraceArgs(["hi", "/confirm"])).toEqual({ inputs: ["hi", "/confirm"], weak: false, adversarial: false, grounding: "retrieval", gatedGrammar: true, repair: true, center: false });
    expect(parseTraceArgs(["--weak", "hi"])).toEqual({ inputs: ["hi"], weak: true, adversarial: false, grounding: "retrieval", gatedGrammar: true, repair: true, center: false });
    expect(parseTraceArgs(["--adversarial", "--model", "acme/z-1", "hi"])).toEqual({
      inputs: ["hi"],
      model: "acme/z-1",
      weak: false,
      adversarial: true,
      grounding: "retrieval",
      gatedGrammar: true,
      repair: true,
      center: false,
    });
  });

  it("selects the Center world only when asked — the dogfooding door stays shut by default", () => {
    const { parseTraceArgs } = trace;
    const args = parseTraceArgs(["--center", "how much is a potion", "/confirm"]);
    expect(args.center).toBe(true);
    expect(args.inputs).toEqual(["how much is a potion", "/confirm"]);
    expect(parseTraceArgs(["hi"]).center).toBe(false);
  });

  it("repair defaults on and --no-repair files the first-attempt denial instead", () => {
    const { parseTraceArgs } = trace;
    expect(parseTraceArgs(["hi"]).repair).toBe(true);
    expect(parseTraceArgs(["--no-repair", "hi"]).repair).toBe(false);
  });

  it("defaults grounding to retrieval and the grammar to gated, and selects the others by flag", () => {
    const { parseTraceArgs } = trace;
    expect(parseTraceArgs(["hi"]).grounding).toBe("retrieval");
    expect(parseTraceArgs(["--ungrounded", "hi"]).grounding).toBe("none");
    expect(parseTraceArgs(["--grounded", "hi"]).grounding).toBe("full");
    // --ungrounded wins if both are somehow passed — the control arm is explicit.
    expect(parseTraceArgs(["--grounded", "--ungrounded", "hi"]).grounding).toBe("none");
    // The grammar is gated by default; --loose-grammar restores the pre-§19 schema.
    expect(parseTraceArgs(["hi"]).gatedGrammar).toBe(true);
    expect(parseTraceArgs(["--loose-grammar", "hi"]).gatedGrammar).toBe(false);
  });
});
