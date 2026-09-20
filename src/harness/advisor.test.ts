import { describe, expect, it } from "vitest";

import type { ScopeGrant } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import { SPECIES_FACT_IDS } from "../kernel/registry.js";
import { candidateDigest } from "../kernel/scope.js";
import { phraseQuestion, proposalDigest, proposeAnswer, proposeScope, usableQuestion } from "./advisor.js";
import { harnessWorld } from "./corpus.js";
import { ScriptedProvider } from "./provider.js";

const world = harnessWorld();
const AT = "2026-01-01T00:00:00Z";

const grant: ScopeGrant = {
  id: "grant-test",
  packId: world.pack.id,
  scope: { version: "red-blue", region: "kanto", badgeLevel: 8, comparisonBasis: "base-speed" },
  bindings: [],
  evidenceDigest: "sha256:unused",
  issuedAt: AT,
  expiresAt: "2027-01-01T00:00:00Z",
};
const context: ManifestContext = { registry: world.registry, pack: world.pack, grant, locale: "en-US", at: AT };

describe("proposeScope", () => {
  const input = {
    pack: world.pack,
    scenarioId: "s",
    transcript: [],
    missing: ["comparisonBasis"] as const,
    unmatched: ["the quickest"],
    turn: 1,
    at: AT,
  };

  it("records a decodable proposal as an untrusted event with a replayable id", async () => {
    const provider = new ScriptedProvider("m", () =>
      JSON.stringify({ candidate: { comparisonBasis: "base-speed" }, interpreting: "the quickest" }),
    );
    const step = await proposeScope({ ...input, provider });
    expect(step.event).not.toBeNull();
    expect(step.event?.id).toBe("prop-s-1");
    expect(step.event?.candidate).toEqual({ comparisonBasis: "base-speed" });
    expect(step.usage.completionTokens).toBeGreaterThan(0);
  });

  it("proposes nothing when the model's reply cannot be decoded", async () => {
    const provider = new ScriptedProvider("m", () => "gibberish");
    const step = await proposeScope({ ...input, provider });
    expect(step.event).toBeNull();
  });
});

describe("proposeAnswer", () => {
  it("decodes a usable answer into a draft", async () => {
    const provider = new ScriptedProvider("m", () =>
      JSON.stringify({
        rosters: [],
        claims: [{ kind: "recommendation", entityId: "pikachu" }],
      }),
    );
    const step = await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [] });
    expect(step.decode.ok).toBe(true);
  });

  it("declares the doors each call held open on the request, as the driver decided them", async () => {
    const hints: unknown[] = [];
    const provider = new ScriptedProvider("m", (request) => {
      hints.push(request.hint.doors);
      return JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "pikachu" }] });
    });
    const transcript = [{ kind: "utterance", at: AT, source: "trainer", text: "how many electric ones are there?" }] as const;
    const routes = [{ id: "listing", description: "list a set", args: {} }];
    await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [...transcript], retrieval: true, gatedGrammar: true, routes, clarify: true, suggest: true });
    await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [...transcript], feedback: ["driver/refused-route: the listing door was refused"] });
    expect(hints[0]).toEqual({ reference: "retrieval", fillerKinds: ["count"], routes: ["listing"], clarify: true, suggest: true, feedback: [] });
    // The bare retry: no rows, an ungated grammar, no doors, the refusal fed back.
    expect(hints[1]).toEqual({ reference: "none", routes: [], clarify: false, suggest: false, feedback: ["driver/refused-route: the listing door was refused"] });
  });

  it("reports an unusable answer rather than inventing one", async () => {
    const provider = new ScriptedProvider("m", () => "not json");
    const step = await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [] });
    expect(step.decode.ok).toBe(false);
  });

  describe("the block-sequenced prompt (docs/answer-prompt.md)", () => {
    const routes = [
      { id: "listing", description: "list a set", args: {} },
      { id: "profile", description: "one creature's rundown", args: {} },
    ];
    const bare: ManifestContext = { registry: world.registry, pack: world.pack, locale: "en-US", at: AT };
    /** Build one prompt and return it with the doors the request declared. */
    async function build(text: string, input: Partial<Parameters<typeof proposeAnswer>[0]> = {}, ctx = bare, doorsOffered = true): Promise<{ prompt: string; doors: unknown }> {
      let prompt = "";
      let doors: unknown;
      const provider = new ScriptedProvider("m", (request) => {
        prompt = request.prompt;
        doors = request.hint.doors;
        return JSON.stringify({ asked: [], rosters: [], claims: [] });
      });
      const transcript = [{ kind: "utterance" as const, at: AT, source: "trainer" as const, text }];
      await proposeAnswer({ provider, context: ctx, scenarioId: "s", transactionId: "txn-1", transcript, prompt: "blocks", retrieval: true, gatedGrammar: true, ...(doorsOffered ? { routes } : {}), clarify: true, suggest: true, precedents: [], ...input });
      return { prompt, doors };
    }
    const headings = (prompt: string): string[] => prompt.split("\n").filter((line) => /^[A-Z][A-Z ,]+$/.test(line));

    it("opens on the task and the reply's shape, puts the question before every rule, and closes on the lists", async () => {
      const { prompt, doors } = await build("tell me about the game");
      expect(prompt.startsWith("YOUR TASK\n")).toBe(true);
      expect(prompt.split("\n")[3]).toBe('  {"asked": [...], "rosters": [...], "claims": [...]}');
      expect(headings(prompt)).toEqual(["YOUR TASK", "THE QUESTION", "WHAT IS KNOWN ABOUT THE TRAINER", "HOW TO DECIDE, IN ORDER", "THE DOORS", "THE SHAPES", "THE CLOSED LISTS"]);
      expect(prompt.indexOf("tell me about the game")).toBeLessThan(prompt.indexOf("HOW TO DECIDE"));
      // The structure rides on the request as data.
      expect(doors).toMatchObject({ blocks: ["task", "question", "trainer", "decide", "doors", "shapes", "lists"], routes: ["listing", "profile"], reference: "retrieval" });
    });

    it("emits a context block only when it has content: no rows when retrieval selected none, no doors when none are offered", async () => {
      const empty = await build("tell me about the game");
      expect(empty.prompt).not.toContain("WHAT YOU KNOW");
      expect(empty.prompt).not.toContain("CERTIFIED REGISTRY");
      const rows = await build("how fast is Pikachu?");
      expect(rows.prompt).toContain("WHAT YOU KNOW\nCERTIFIED REGISTRY");
      expect(rows.doors).toMatchObject({ blocks: ["task", "question", "known", "rows", "trainer", "decide", "doors", "shapes", "lists"] });
      const shut = await build("tell me about the game", {}, bare, false);
      expect(shut.prompt).not.toContain("THE DOORS");
      expect(shut.prompt).not.toContain("route claim");
      expect(shut.doors).toMatchObject({ blocks: ["task", "question", "trainer", "decide", "shapes", "lists"] });
    });

    it("carries the retry's refusal, the precedents and the earlier words under WHAT YOU KNOW, each as its own block", async () => {
      const { prompt, doors } = await build(
        "can you list ten?",
        {
          feedback: ['driver/refused-route: the "listing" door was refused — a list of one is not a list'],
          precedents: [{ id: "p-game", score: 1, ask: "tell me about the game", shape: { claims: [{ kind: "explanation", blockId: "what-is-game" }], rosters: [] } }],
          previously: ["what types are there?"],
          previousSubjects: ["pikachu"],
        },
        bare,
        false,
      );
      const known = prompt.slice(prompt.indexOf("WHAT YOU KNOW"), prompt.indexOf("WHAT IS KNOWN ABOUT THE TRAINER"));
      expect(known).toContain('- "tell me about the game"');
      expect(known).toContain('→ {"claims":[{"kind":"explanation","blockId":"what-is-game"}],"rosters":[]}');
      expect(known).toContain("Earlier in this conversation the trainer said");
      expect(known).toContain("was about: pikachu.");
      expect(known).toContain("Your previous reply to these words was refused, by name:");
      expect(known).toContain('driver/refused-route: the "listing" door was refused');
      expect(doors).toMatchObject({ blocks: ["task", "question", "known", "precedents", "earlier", "previous", "refusal", "trainer", "decide", "shapes", "lists"] });
    });

    it("states the trainer's scope on one line once established", async () => {
      const { prompt } = await build("how fast is Pikachu?", {}, context);
      expect(prompt).toContain("WHAT IS KNOWN ABOUT THE TRAINER\n  version=red-blue region=kanto badges=8 basis=base-speed\n");
      expect(prompt).not.toContain("Nothing yet");
    });

    it("lints itself: no block is empty, no sentence is stated twice, and the length is pinned, ratcheting down only", async () => {
      // The diagnosis (docs/answer-prompt.md): the legacy prompt opened on
      // empty headers, stated the lesson rule three ways, and ran to 2,076
      // words on this ask. The pin is the fixture's own count, so a block
      // that creeps back in fails the build by name. 1418 → 1475 on
      // 2026-09-19: the comparison shape, offered in every world now, is
      // one more line under THE SHAPES — a shape the world lacked, not a
      // block crept back. 1475 → 1520 on 2026-09-21: the two lines that
      // say how a comparison links (the field once, never the subjects to
      // none) — the false decline four cheap models made on "compare X and
      // Y" (findings §26–§28).
      const PINNED_WORDS = 1520;
      const { prompt } = await build("tell me about the game");
      const lines = prompt.split("\n");
      for (const [index, line] of lines.entries()) {
        if (/^[A-Z][A-Z ,]+$/.test(line)) expect(lines[index + 1] ?? "", `the block "${line}" is empty`).not.toMatch(/^\s*$/);
      }
      const sentences = prompt
        .replace(/\s+/g, " ")
        .split(/(?<=[.?!])\s+(?=[A-Z"])/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 30);
      const seen = new Set<string>();
      for (const sentence of sentences) {
        expect(seen.has(sentence), `stated twice: ${sentence}`).toBe(false);
        seen.add(sentence);
      }
      const words = prompt.trim().split(/\s+/).length;
      expect(words, words > PINNED_WORDS ? `the blocks prompt grew to ${words} words (pinned ${PINNED_WORDS}) — a block crept back in` : `the blocks prompt dropped to ${words} words (pinned ${PINNED_WORDS}) — lower the pin in this change`).toBe(PINNED_WORDS);
      // The legacy prompt is untouched by the lever, and longer.
      let legacy = "";
      const provider = new ScriptedProvider("m", (request) => {
        legacy = request.prompt;
        return JSON.stringify({ asked: [], rosters: [], claims: [] });
      });
      await proposeAnswer({ provider, context: bare, scenarioId: "s", transactionId: "txn-1", transcript: [{ kind: "utterance", at: AT, source: "trainer", text: "tell me about the game" }], retrieval: true, gatedGrammar: true, routes, clarify: true, suggest: true, precedents: [] });
      expect(legacy.startsWith("CERTIFIED REGISTRY")).toBe(true);
      expect(legacy.trim().split(/\s+/).length).toBeGreaterThan(words);
    });
  });

  it("names the token cap when an unusable completion was truncated", async () => {
    // The 43-second lesson (docs/scale.md, S1): a completion the provider cut
    // at max_tokens is a different failure from a malformed one, and the
    // wording is fixed so the class is countable from notes and artifacts.
    const truncating = {
      id: "m",
      complete: () =>
        Promise.resolve({
          text: '{"rosters": [], "claims": [{"kind": "typeCount"}, {"kind": "typeC',
          usage: { promptTokens: 1, completionTokens: 2048, calls: 1, costedCalls: 1, costUsd: 0 },
          finishReason: "length",
        }),
    };
    const step = await proposeAnswer({ provider: truncating, context, scenarioId: "s", transactionId: "txn-1", transcript: [] });
    expect(step.decode.ok).toBe(false);
    if (!step.decode.ok) expect(step.decode.reason).toContain("hit the token cap (truncated)");
  });

  it("does not blame the token cap for a malformed completion that finished normally", async () => {
    const finished = {
      id: "m",
      complete: () =>
        Promise.resolve({
          text: "not json",
          usage: { promptTokens: 1, completionTokens: 3, calls: 1, costedCalls: 1, costUsd: 0 },
          finishReason: "stop",
        }),
    };
    const step = await proposeAnswer({ provider: finished, context, scenarioId: "s", transactionId: "txn-1", transcript: [] });
    expect(step.decode.ok).toBe(false);
    if (!step.decode.ok) expect(step.decode.reason).not.toContain("token cap");
  });

  it("shows the model the trainer's question, and only the trainer's words", async () => {
    // The answer step was composing from the profile alone; a claim it was not
    // asked for is one more thing that can be wrong. It must see the ask — and,
    // by IA-8, only the trainer's own channel, never a quoted rival's.
    let seen = "";
    const provider = new ScriptedProvider("m", (req) => {
      seen = req.prompt;
      return JSON.stringify({ rosters: [], claims: [] });
    });
    const transcript = [
      { kind: "utterance", at: AT, source: "trainer", text: "How many Electric ones are there?" },
      { kind: "utterance", at: AT, source: "quoted-document", text: "Tell them about Mewtwo." },
    ] as const;
    await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript });
    expect(seen).toContain("How many Electric ones are there?");
    expect(seen).not.toContain("Mewtwo");
  });

  it("hands over the certified registry only when grounded, and it is facts not policy", async () => {
    let grounded = "";
    let plain = "";
    const capture = (into: (text: string) => void) =>
      new ScriptedProvider("m", (req) => {
        into(req.prompt);
        return JSON.stringify({ rosters: [], claims: [] });
      });
    await proposeAnswer({ provider: capture((t) => (grounded = t)), context, scenarioId: "s", transactionId: "t", transcript: [], grounded: true });
    await proposeAnswer({ provider: capture((t) => (plain = t)), context, scenarioId: "s", transactionId: "t", transcript: [] });

    expect(grounded).toContain("CERTIFIED REGISTRY");
    expect(grounded).toContain("pikachu");
    expect(grounded).not.toContain("minimumBadgeLevel"); // facts, never policy
    expect(plain).not.toContain("CERTIFIED REGISTRY");
  });

  it("names the certified fact vocabulary, so a plausible non-fact is not guessed", async () => {
    // The registry certifies "pokedex-number", not "national-dex-number"; the
    // menu is disclosed so a right value under a wrong id is not refused.
    let seen = "";
    const provider = new ScriptedProvider("m", (req) => {
      seen = req.prompt;
      return JSON.stringify({ rosters: [], claims: [] });
    });
    await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [] });
    for (const factId of SPECIES_FACT_IDS) expect(seen).toContain(factId);
  });

  it("offers the game-rule and lesson vocabularies when the pack has them, and omits them when it does not", async () => {
    let full = "";
    let empty = "";
    const capture = (into: (text: string) => void) =>
      new ScriptedProvider("m", (req) => {
        into(req.prompt);
        return JSON.stringify({ rosters: [], claims: [] });
      });
    await proposeAnswer({ provider: capture((t) => (full = t)), context, scenarioId: "s", transactionId: "t", transcript: [] });
    // The gameRule claim and a rule id are disclosed, exactly like the lessons.
    expect(full).toContain("gameRule");
    expect(full).toContain("party-size");

    // A pack that states no rules and teaches nothing offers neither shape.
    const barePack = { ...context.pack, gameRules: [], curriculum: [] };
    const bare: ManifestContext = { ...context, pack: barePack };
    await proposeAnswer({ provider: capture((t) => (empty = t)), context: bare, scenarioId: "s", transactionId: "t", transcript: [] });
    expect(empty).not.toContain("gameRule");
    expect(empty).not.toContain("lesson-id");
  });
});

describe("proposalDigest", () => {
  it("is the digest the kernel checks a confirmation against", () => {
    const event = { kind: "proposal", at: AT, id: "prop-x", candidate: { version: "red-blue" }, interpreting: "w" } as const;
    expect(proposalDigest(event)).toBe(candidateDigest("prop-x", event.candidate));
  });
});

describe("usableQuestion — the shape a model-phrased question must have", () => {
  it("accepts one plain question and refuses numbers, statements and fragments", () => {
    expect(usableQuestion("Which game are you playing — Red/Blue, or Yellow?")).toBe(true);
    expect(usableQuestion("  Quick one first: which version are you on?  ")).toBe(true);
    expect(usableQuestion("Pikachu's Speed is 90. Which version?")).toBe(false);
    expect(usableQuestion("Which version? Red or Blue?")).toBe(false);
    expect(usableQuestion("Which version are you playing")).toBe(false);
    expect(usableQuestion("Which?")).toBe(false);
    expect(usableQuestion("Which\nversion?")).toBe(false);
    expect(usableQuestion(`${"a".repeat(250)}?`)).toBe(false);
  });
});

describe("phraseQuestion — the pack's question in the model's words, or nothing", () => {
  it("returns the model's wording when usable and null otherwise, and keeps the usage either way", async () => {
    const good = new ScriptedProvider("phrase-good", () => JSON.stringify({ question: "Which game are you on?" }));
    const okay = await phraseQuestion({ provider: good, scenarioId: "t", transcript: [], need: "Which game version are you playing?", options: ["red-blue", "yellow"] });
    expect(okay.text).toBe("Which game are you on?");
    expect(okay.usage.calls).toBe(1);
    const bad = new ScriptedProvider("phrase-bad", () => "```json\n{\"question\": \"You have 8 badges. Which game?\"}\n```");
    const refused = await phraseQuestion({ provider: bad, scenarioId: "t", transcript: [], need: "q?", options: ["a"] });
    expect(refused.text).toBeNull();
    const prose = new ScriptedProvider("phrase-prose", () => "Which game are you on?");
    expect((await phraseQuestion({ provider: prose, scenarioId: "t", transcript: [], need: "q?", options: ["a"] })).text).toBeNull();
  });
});

describe("the precedent door (docs/precedent.md)", () => {
  it("writes the held precedents into the prompt as shapes with no value, and declares them on the doors as id, score and ask", async () => {
    const hints: unknown[] = [];
    const prompts: string[] = [];
    const provider = new ScriptedProvider("m", (request) => {
      hints.push(request.hint.doors);
      prompts.push(request.prompt);
      return JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-game" }] });
    });
    const transcript = [{ kind: "utterance", at: AT, source: "trainer", text: "tell me about this game" }] as const;
    const held = [
      { id: "p-game", score: 1, ask: "tell me about the game", shape: { claims: [{ kind: "explanation", blockId: "what-is-game" }], rosters: [] } },
      { id: "p-speed", score: 0.4, ask: "what is pikachu's speed", shape: { claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }], rosters: [] } },
    ];
    await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [...transcript], retrieval: true, precedents: held });
    await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [...transcript], retrieval: true, precedents: [] });
    await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [...transcript], retrieval: true });

    expect(hints[0]).toMatchObject({ precedents: [{ id: "p-game", score: 1, ask: "tell me about the game" }, { id: "p-speed", score: 0.4, ask: "what is pikachu's speed" }] });
    expect(JSON.stringify(hints[0])).not.toContain("shape");
    const section = prompts[0]!.slice(prompts[0]!.indexOf("Earlier asks the records answered"), prompts[0]!.indexOf("The trainer's own words:"));
    expect(section).toContain('- "tell me about the game"');
    expect(section).toContain('→ {"claims":[{"kind":"explanation","blockId":"what-is-game"}],"rosters":[]}');
    expect(section).toContain('→ {"claims":[{"kind":"fact","entityId":"pikachu","factId":"base-speed"}],"rosters":[]}');
    expect(section).not.toMatch(/asserted|reported|\b90\b/);
    // The section sits after the certified rows and before the ask.
    expect(prompts[0]!.indexOf("CERTIFIED REGISTRY")).toBeLessThan(prompts[0]!.indexOf("Earlier asks the records answered"));
    // Empty is declared, not omitted; shut is omitted.
    expect(hints[1]).toMatchObject({ precedents: [] });
    expect(prompts[1]).not.toContain("Earlier asks the records answered");
    expect((hints[2] as { precedents?: unknown }).precedents).toBeUndefined();
  });
});

describe("the lesson classifier's reply, decoded (docs/lesson-door.md)", async () => {
  const { decodeLessonClassification } = await import("./advisor.js");
  const ids = ["what-is-badge", "how-catch"];

  it("takes the four kinds, a lesson only with an id the pack carries, an entity only as a non-empty string", () => {
    expect(decodeLessonClassification('{"kind":"lesson","lessonId":"how-catch"}', ids)).toEqual({ kind: "lesson", lessonId: "how-catch" });
    expect(decodeLessonClassification('{"kind":"fact","entity":" Pikachu "}', ids)).toEqual({ kind: "fact", entity: "Pikachu" });
    expect(decodeLessonClassification('{"kind":"advice"}', ids)).toEqual({ kind: "advice" });
    expect(decodeLessonClassification('{"kind":"other","entity":""}', ids)).toEqual({ kind: "other" });
    expect(decodeLessonClassification('```json\n{"kind":"lesson","lessonId":"what-is-badge"}\n```', ids)).toEqual({ kind: "lesson", lessonId: "what-is-badge" });
  });

  it("is null — counted, never guessed — for a forged lesson, a lesson with no id, an unknown kind, or no JSON", () => {
    expect(decodeLessonClassification('{"kind":"lesson","lessonId":"what-is-everything"}', ids)).toBeNull();
    expect(decodeLessonClassification('{"kind":"lesson"}', ids)).toBeNull();
    expect(decodeLessonClassification('{"kind":"question"}', ids)).toBeNull();
    expect(decodeLessonClassification("lesson: how-catch", ids)).toBeNull();
    expect(decodeLessonClassification("[]", ids)).toBeNull();
  });
});

describe("the lesson rule is stated whether or not scope is established (findings §38)", () => {
  it("the legacy prompt says a question about what something is or how the game works, naming no subject, is a lesson — with scope set and without", async () => {
    const prompts: string[] = [];
    const provider = new ScriptedProvider("m", (request) => {
      prompts.push(request.prompt);
      return JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-game" }] });
    });
    const transcript = [{ kind: "utterance", at: AT, source: "trainer", text: "tell me about this game" }] as const;
    await proposeAnswer({ provider, context, scenarioId: "s", transactionId: "txn-1", transcript: [...transcript], retrieval: true, gatedGrammar: true });
    const { grant: _scoped, ...unscoped } = context;
    void _scoped;
    await proposeAnswer({ provider, context: unscoped, scenarioId: "s", transactionId: "txn-1", transcript: [...transcript], retrieval: true, gatedGrammar: true });
    expect(prompts[0]).toContain("Scope is established:");
    expect(prompts[1]).toContain("Scope is NOT established yet");
    for (const prompt of prompts) {
      expect(prompt).toContain("A question\nabout what something is or how the game works, naming no certified subject,\nis a lesson: teach the one that squarely answers it and claim nothing else");
      expect(prompt).toContain("Reach for a lesson only when\nno such claim fits a named subject.");
    }
  });
});
