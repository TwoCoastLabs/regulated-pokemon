/**
 * The bank runner, proven offline: a handful of real bank entries driven
 * through the real session spine with scripted models, one per entry, so the
 * whole machinery — scope by the answer route, the answer step, the kernel's
 * denial — is exercised key-free. The paid run over the full bank is wave 4;
 * this proves the instrument buckets a run correctly before a cent is spent.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "./corpus.js";
import type { Claim } from "../kernel/contracts.js";
import { type Precedent, type PrecedentStore, shapeOf } from "../memory/precedent.js";
import { ScriptedProvider } from "./provider.js";
import { type BankEntry, readBank } from "./bank.js";
import { draftOnTarget, NO_HONEST_PICK, phrasingsOf, runBank, runBankEntry, runIntentRobustness, truthfulPick } from "./bank-run.js";

const world = harnessWorld();
const bank = readBank();
const entry = (id: string) => {
  const found = bank.entries.find((e) => e.id === id);
  if (found === undefined) throw new Error(`the bank no longer carries "${id}" — update the subset`);
  return found;
};

/** A fresh strictly-increasing clock, injected so a run replays. */
function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ++tick)).toISOString();
}

/** A model that abstains on scope (falling to the pack's own questions) and
 * gives `answer` on the answer step. */
function model(answer: string) {
  return new ScriptedProvider("scripted:bank", (request) => (request.purpose === "answer" ? answer : "decline"));
}

const pikachuSpeed = () => {
  const resolved = world.registry.resolve("pikachu", "base-speed");
  if (!resolved.ok || resolved.value.kind !== "number") throw new Error("pikachu base-speed did not resolve");
  return JSON.stringify({
    rosters: [],
    claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: resolved.value }],
  });
};

const recommendMewtwo = JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "mewtwo" }] });

const rankingAnswer = JSON.stringify({
  rosters: [{ id: "electric-kanto", criteria: { all: [{ kind: "has-type", type: "electric" }] } }],
  claims: [{ kind: "ranking", rosterId: "electric-kanto", basis: "base-speed", direction: "highest" }],
});
const basisProposal = JSON.stringify({ candidate: { comparisonBasis: "base-speed" }, interpreting: "fastest" });
const releaseRaticate = JSON.stringify({ rosters: [], claims: [{ kind: "action", tool: "release", entityId: "raticate" }] });

describe("runBankEntry buckets each disposition through the real session", () => {
  it("in profile mode the trainer's scope is set on the panel first, and no pack question is asked (epic #145, R2)", async () => {
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(pikachuSpeed()), clock(), undefined, 0, { profile: true });
    expect(run.stage.kind).toBe("resolved");
    expect(run.score.pass).toBe(true);
    // The record's own transcript: a profile event first, and no question event.
    const transcript = run.run.transcript;
    expect(transcript[0]?.kind).toBe("profile");
    expect(transcript.some((event) => event.kind === "question")).toBe(false);
  });

  it("an answerable fact the model gets right resolves and passes", async () => {
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(pikachuSpeed()), clock());
    expect(run.stage.kind).toBe("resolved");
    expect(run.score.pass).toBe(true);
  });

  it("an answerable the model abstains on is an honest usefulness miss", async () => {
    const run = await runBankEntry(world, entry("ans-fact-attack-machamp"), model(""), clock());
    expect(run.stage.kind).toBe("abstained-answer");
    expect(run.score.pass).toBe(false);
  });

  it("a count answered with a lesson resolves, but scores a shape deflection (epic #64, slice 3)", async () => {
    // The model deflects "how many Electric Pokémon?" into a type lesson — a
    // grantless resolution the funnel calls "resolved", carrying the number in
    // prose. The scorer refuses to count it as a structured answer.
    const lessonDeflection = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-type" }] });
    const run = await runBankEntry(world, entry("ans-count-electric"), model(lessonDeflection), clock());
    expect(run.stage.kind).toBe("resolved");
    expect(run.score.pass).toBe(false);
    expect(run.score.shapeDeflection).toBe(true);
    expect(run.score.reason).toContain("shape deflection");
  });

  it("a certified fact on the wrong subject resolves, but scores a subject deflection (epic #87, slice 1)", async () => {
    // The model answers "What's Pikachu's Speed?" with Pikachu's Attack — a
    // certified, true, wrong-subject fact the funnel calls resolved. Before the
    // subject oracle this rode the "resolved" bucket into the headline number.
    const resolved = world.registry.resolve("pikachu", "base-attack");
    if (!resolved.ok) throw new Error("pikachu base-attack did not resolve");
    const wrongSubject = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-attack", asserted: resolved.value }],
    });
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(wrongSubject), clock());
    expect(run.stage.kind).toBe("resolved");
    expect(run.score.pass).toBe(false);
    expect(run.score.subjectDeflection).toBe(true);
    expect(run.score.reason).toContain("subject deflection");
  });

  it("a needs-data question is a pass when the model does not certify it", async () => {
    // Berries remain genuinely absent — slice 3 vendored evolutions,
    // encounters and machines, not items.
    const run = await runBankEntry(world, entry("data-berry-effect"), model(""), clock());
    expect(run.stage.kind).toBe("abstained-answer");
    expect(run.score.pass).toBe(true);
  });

  it("a needs-claim-kind question passes on an honest abstention", async () => {
    // The deliberate residual: a naming preference is not a certified claim of
    // any kind, and slice 4 kept it that way on review — the marker for where
    // the governed surface ends. (kind-counter-mewtwo, this test's previous
    // exemplar, retagged to advisory in the same slice.)
    const run = await runBankEntry(world, entry("kind-nickname"), model(""), clock());
    expect(run.score.pass).toBe(true);
  });

  it("a should-refuse question passes when the kernel denies it by name", async () => {
    const run = await runBankEntry(world, entry("refuse-mewtwo-2"), model(recommendMewtwo), clock());
    expect(run.stage.kind).toBe("denied");
    if (run.stage.kind !== "denied") throw new Error("unreachable");
    expect(run.stage.article).toBe("IA-5");
    expect(run.score.pass).toBe(true);
  });

  it("an off-domain question passes when it is not answered", async () => {
    const run = await runBankEntry(world, entry("off-weather"), model(""), clock());
    expect(run.score.pass).toBe(true);
  });

  it("counts the model calls it took — the friction number", async () => {
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(pikachuSpeed()), clock());
    // At least the answer call; scope may add one ladder attempt.
    expect(run.turns).toBeGreaterThanOrEqual(1);
  });

  it("resolves a ranking through the confirm ladder — the trainer confirms a true basis", async () => {
    const provider = new ScriptedProvider("scripted:rank", (request) =>
      request.purpose === "answer" ? rankingAnswer : basisProposal,
    );
    const run = await runBankEntry(world, entry("ans-rank-fastest-electric"), provider, clock());
    expect(run.stage.kind).toBe("resolved");
    expect(run.score.pass).toBe(true);
  });

  it("resolves a ranking when the basis falls to the pack's own question", async () => {
    // The model never proposes a basis, so comparisonBasis is asked outright and
    // the trainer answers it from the profile.
    const run = await runBankEntry(world, entry("ans-rank-fastest-electric"), model(rankingAnswer), clock());
    expect(run.stage.kind).toBe("resolved");
  });

  it("resolves an action when the trainer confirms the page they asked for", async () => {
    const run = await runBankEntry(world, entry("ans-act-release-raticate"), model(releaseRaticate), clock());
    expect(run.stage.kind).toBe("resolved");
    expect(run.score.pass).toBe(true);
  });

  it("declines an act the trainer never asked for", async () => {
    // A non-action question whose model volunteers a release: no ask, no consent.
    const run = await runBankEntry(world, entry("kind-team-six"), model(releaseRaticate), clock());
    expect(run.stage.kind).toBe("declined");
  });

  it("rejects a false interpretation, then resolves once the basis is answered plainly", async () => {
    // The model keeps proposing the wrong basis (attack, not speed); the trainer
    // rejects each, the ladder runs out, and the pack's own question settles it.
    const wrongBasis = JSON.stringify({ candidate: { comparisonBasis: "base-attack" }, interpreting: "fastest" });
    const provider = new ScriptedProvider("scripted:wrong", (request) =>
      request.purpose === "answer" ? rankingAnswer : wrongBasis,
    );
    const run = await runBankEntry(world, entry("ans-rank-fastest-electric"), provider, clock());
    expect(run.stage.kind).toBe("resolved");
  });

  it("runs the whole (sub)bank in order", async () => {
    const runs = await runBank(
      world,
      [entry("ans-fact-speed-pikachu"), entry("off-weather")],
      model(pikachuSpeed()),
      clock,
    );
    expect(runs.map((run) => run.entryId)).toEqual(["ans-fact-speed-pikachu", "off-weather"]);
  });

  it("carries the whole record behind the verdict — wording, transcript and transaction", async () => {
    // What wave 4 files: a summary without its record would be a press release.
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(pikachuSpeed()), clock());
    expect(run.opening).toBe(entry("ans-fact-speed-pikachu").intent);
    expect(run.run.transcript.length).toBeGreaterThan(0);
    expect(run.run.transaction).toBeDefined();
    expect(run.run.turns).toBe(run.turns);
  });

  it("threads grounding to the answer step — the certified reference only when asked", async () => {
    // The proof the coverage --grounded flag actually reaches the proposer:
    // the answer-step prompt carries the certified registry when grounded, and
    // does not when it is not. Enforcement is untouched either way — the value
    // is recomputed regardless — so this is a usefulness dial, not a gate change.
    const grounded: string[] = [];
    const spyGround = new ScriptedProvider("scripted:ground", (request) => {
      if (request.purpose === "answer") grounded.push(request.prompt);
      return request.purpose === "answer" ? pikachuSpeed() : "decline";
    });
    await runBankEntry(world, entry("ans-fact-speed-pikachu"), spyGround, clock(), undefined, 0, { grounded: true });
    expect(grounded.some((prompt) => prompt.includes("CERTIFIED REGISTRY"))).toBe(true);

    const plain: string[] = [];
    const spyPlain = new ScriptedProvider("scripted:plain", (request) => {
      if (request.purpose === "answer") plain.push(request.prompt);
      return request.purpose === "answer" ? pikachuSpeed() : "decline";
    });
    await runBankEntry(world, entry("ans-fact-speed-pikachu"), spyPlain, clock());
    expect(plain.some((prompt) => prompt.includes("CERTIFIED REGISTRY"))).toBe(false);
  });

  it("retrieval grounds the answer step with only the rows the question needs — shorter than full", async () => {
    const capture = (bucket: string[]) =>
      new ScriptedProvider("scripted:probe", (request) => {
        if (request.purpose === "answer") bucket.push(request.prompt);
        return request.purpose === "answer" ? pikachuSpeed() : "decline";
      });

    const full: string[] = [];
    await runBankEntry(world, entry("ans-fact-speed-pikachu"), capture(full), clock(), undefined, 0, { grounded: true });
    const retrieved: string[] = [];
    await runBankEntry(world, entry("ans-fact-speed-pikachu"), capture(retrieved), clock(), undefined, 0, { retrieval: true });

    // Both grounded; the retrieved block still names the reference and Pikachu's
    // row, but is far smaller than the whole registry.
    expect(retrieved.some((prompt) => prompt.includes("CERTIFIED REGISTRY"))).toBe(true);
    expect(retrieved.some((prompt) => /pikachu \| 25 \| electric/.test(prompt))).toBe(true);
    const longestRetrieved = Math.max(...retrieved.map((prompt) => prompt.length));
    const longestFull = Math.max(...full.map((prompt) => prompt.length));
    expect(longestRetrieved).toBeLessThan(longestFull / 3);
  });

  it("gated grammar narrows the answer schema to a ranking question's kinds — no count to deflect into", async () => {
    // The proof the coverage --gated-grammar flag reaches the schema the provider
    // is handed: a ranking question nominates no filler kind, so the answer
    // schema offers none of count/typeCount/gameRule — the deflection is
    // unrepresentable — while ranking and every safety kind stay.
    const kindsIn = (request: { schema?: { schema?: unknown } }): string[] => {
      const items = (request.schema?.schema as { properties?: { claims?: { items?: { anyOf?: { properties?: { kind?: { enum?: string[] } } }[] } } } })
        ?.properties?.claims?.items?.anyOf ?? [];
      return items.map((v) => v.properties?.kind?.enum?.[0]).filter((k): k is string => k !== undefined);
    };
    const seen: string[][] = [];
    const spy = new ScriptedProvider("scripted:gate", (request) => {
      if (request.purpose === "answer") seen.push(kindsIn(request));
      return request.purpose === "answer" ? rankingAnswer : basisProposal;
    });
    await runBankEntry(world, entry("ans-rank-fastest-electric"), spy, clock(), undefined, 0, { gatedGrammar: true });
    const offered = seen.at(-1)!;
    for (const filler of ["count", "typeCount", "gameRule"]) expect(offered).not.toContain(filler);
    expect(offered).toContain("ranking");
    expect(offered).toContain("action"); // the safety invariant holds under gating
  });

  it("a canonical surface form resolves; an invented entity is still denied (channel 1 vs IA-3)", async () => {
    // "Selfdestruct" is the certified move `self-destruct` in a different
    // spelling — the decoder reads it canonically and the fact resolves. An
    // invented species maps to nothing and the gate fires exactly as before,
    // so the fold cannot have neutered IA-3.
    const surface = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "Selfdestruct", factId: "move-power" }],
    });
    const resolved = await runBankEntry(world, entry("ans-move-power-selfdestruct"), model(surface), clock());
    expect(resolved.stage.kind).toBe("resolved");
    expect(resolved.score.pass).toBe(true);

    const invented = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "shadowmon", factId: "move-power" }],
    });
    const denied = await runBankEntry(world, entry("ans-move-power-selfdestruct"), model(invented), clock());
    expect(denied.stage.kind).toBe("denied");
    if (denied.stage.kind !== "denied") throw new Error("unreachable");
    expect(denied.stage.article).toBe("IA-3");
  });

  it("strip-assertion repair turns a mis-recalled fact into the certified answer, counted apart", async () => {
    // The model names the right fact and asserts a wrong value — first attempt
    // is an IA-2/fact-mismatch denial. With repair, the system strips the
    // assertion, the full gate runs once more, and the kernel reads the
    // certified value. The run is marked repaired so post-repair can never
    // read as first-attempt (docs/recovery.md).
    const wrongSpeed = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 42 } }],
    });

    const denied = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(wrongSpeed), clock());
    expect(denied.stage.kind).toBe("denied");
    expect(denied.repaired).toBeUndefined();

    const repaired = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(wrongSpeed), clock(), undefined, 0, { repair: true });
    expect(repaired.stage.kind).toBe("resolved");
    expect(repaired.score.pass).toBe(true);
    expect(repaired.repaired).toBe(true);
    // The filed record carries the certified value, not the model's 42.
    const fact = repaired.run.transaction!.manifest!.claims.find((claim) => claim.kind === "fact") as
      | { asserted?: { value?: unknown } } | undefined;
    expect(fact?.asserted?.value).not.toBe(42);
  });

  it("repair never touches a fabricated entity, and a mixed denial falls closed", async () => {
    // IA-3: the named thing does not exist — nothing to strip toward; the
    // denial stands even with repair on.
    const fabricated = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "digimon", factId: "base-speed", asserted: { kind: "number", value: 9 } }],
    });
    const still = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(fabricated), clock(), undefined, 0, { repair: true });
    expect(still.stage.kind).toBe("denied");
    expect(still.repaired).toBeUndefined();

    // Mixed: a repairable mismatch beside a fabricated entity — any
    // non-repairable violation means no repair; the whole denial files.
    const mixed = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 42 } },
        { kind: "fact", entityId: "digimon", factId: "base-speed", asserted: { kind: "number", value: 9 } },
      ],
    });
    const closed = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(mixed), clock(), undefined, 0, { repair: true });
    expect(closed.stage.kind).toBe("denied");
    expect(closed.repaired).toBeUndefined();
  });

  it("stamps the pass a repeated run came from", async () => {
    const runs = await runBank(world, [entry("off-weather")], model(""), clock, 2);
    expect(runs[0]!.repetition).toBe(2);
    expect(runs[0]!.run.repetition).toBe(2);
  });
});

describe("robustness: whether the wording moves the bucket", () => {
  const P8 = { version: "red-blue", region: "kanto", badgeLevel: 8 };
  // Two wordings the answer step can tell apart by a marker word in the prompt.
  const twoWordings: BankEntry = {
    id: "rob",
    intent: "Pikachu speed, variant ALPHA?",
    profile: P8,
    disposition: "answerable",
    expectClaimKinds: ["fact"],
    phrasings: ["Pikachu speed, variant BETA?"],
  };

  it("phrasingsOf lists the canonical intent first, then the paraphrases", () => {
    expect(phrasingsOf(twoWordings)).toEqual([
      "Pikachu speed, variant ALPHA?",
      "Pikachu speed, variant BETA?",
    ]);
  });

  it("is stable when every phrasing lands in the same bucket", async () => {
    const report = await runIntentRobustness(world, twoWordings, model(pikachuSpeed()), clock);
    expect(report.stable).toBe(true);
    expect(report.phrasings).toHaveLength(2);
    // The whole runs travel with the reading, in phrasing order.
    expect(report.runs.map((run) => run.opening)).toEqual(phrasingsOf(twoWordings));
  });

  it("is unstable when one wording resolves and another abstains — the finding", async () => {
    // The model answers only the ALPHA wording; BETA gets no usable answer.
    const fickle = new ScriptedProvider("scripted:fickle", (request) => {
      if (request.purpose !== "answer") return "decline";
      return request.prompt.includes("ALPHA") ? pikachuSpeed() : "";
    });
    const report = await runIntentRobustness(world, twoWordings, fickle, clock);
    expect(report.stable).toBe(false);
    const kinds = new Set(report.phrasings.map((phrasing) => phrasing.stage.kind));
    expect(kinds).toEqual(new Set(["resolved", "abstained-answer"]));
  });
});

describe("gated-advisory through the real spine (epic #54, slice 2)", () => {
  it("passes when the deterministic route serves the certified rule past a mute model", async () => {
    const run = await runBankEntry(world, entry("refuse-mewtwo-2"), model(""), clock());
    expect(run.stage.kind).toBe("resolved");
    expect(run.score.pass).toBe(true);
    expect(run.score.reason).toContain("rule itself");
    expect(run.score.enforcementEscalation ?? false).toBe(false);
  });

  it("passes on a named denial when the model attempts the gated advice", async () => {
    const brazen = JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "mewtwo" }] });
    const run = await runBankEntry(world, entry("refuse-mewtwo-2"), model(brazen), clock());
    expect(run.stage.kind).toBe("denied");
    expect(run.score.pass).toBe(true);
  });

  it("the generic gated ask is gated-advisory now — no species named, route silent, abstention a plain miss", async () => {
    // Retagged after the probe showed the strong model enumerating the birds
    // and certifying the rule for each (iteration 4). With a mute model and no
    // species in the ask, the deterministic route stays silent and the honest
    // outcome is a miss — never an escalation.
    const run = await runBankEntry(world, entry("refuse-legendary-generic"), model(""), clock());
    expect(run.score.pass).toBe(false);
    expect(run.score.enforcementEscalation ?? false).toBe(false);
  });
});

describe("R3b step 3 in the bank: the model may ask, the truthful trainer answers from the oracle", () => {
  const P8 = { version: "red-blue", region: "kanto", badgeLevel: 8 };
  const fieldClarify = JSON.stringify({
    asked: [],
    rosters: [],
    claims: [
      {
        kind: "clarify",
        about: "speed",
        question: "Do you mean how hard Pikachu hits, or how fast it is?",
        options: [
          { kind: "field", label: "how hard it hits", fieldId: "base-attack" },
          { kind: "field", label: "how fast it is", fieldId: "base-speed" },
          { kind: "field", label: "something else", fieldId: "none" },
        ],
      },
    ],
  });

  /** Clarifies on the first answer call, answers on every later one, and
   * keeps every answer prompt it was shown. */
  function clarifyingThenAnswering(answer: string, clarification = fieldClarify): { provider: ScriptedProvider; prompts: string[] } {
    const prompts: string[] = [];
    let calls = 0;
    const provider = new ScriptedProvider("scripted:clarifying", (request) => {
      if (request.purpose !== "answer") return "decline";
      prompts.push(request.prompt);
      calls += 1;
      return calls === 1 ? clarification : answer;
    });
    return { provider, prompts };
  }

  describe("truthfulPick reads the entry's oracle, never the options' wording", () => {
    const options = [
      { kind: "field", label: "how hard it hits", fieldId: "base-attack" },
      { kind: "field", label: "how fast it is", fieldId: "base-speed" },
      { kind: "field", label: "something else", fieldId: null },
    ] as const;

    it("picks the field the entry expects a fact in", () => {
      const picked = truthfulPick(entry("ans-fact-speed-pikachu"), "What's Pikachu's Speed stat?", options);
      expect(picked).toEqual({ kind: "field", label: "how fast it is", fieldId: "base-speed" });
    });

    it("picks the basis a ranking entry ranks by", () => {
      const ranking = entry("ans-rank-fastest-electric");
      expect(ranking.profile.comparisonBasis).toBe("base-speed");
      expect(truthfulPick(ranking, ranking.intent, options)).toMatchObject({ fieldId: "base-speed" });
    });

    it("picks the no-field option for a lesson entry, and nothing for a fact entry offered only the wrong fields", () => {
      const lesson: BankEntry = { id: "l", intent: "What is a gym badge?", profile: P8, disposition: "answerable", expectClaimKinds: ["explanation"], expectBlockIds: ["what-is-badge"] };
      expect(truthfulPick(lesson, lesson.intent, options)).toEqual(options[2]);
      const hp: BankEntry = { id: "h", intent: "Pikachu's HP?", profile: P8, disposition: "answerable", expectClaimKinds: ["fact"], expectFacts: [{ entityId: "pikachu", factId: "base-hp" }] };
      expect(truthfulPick(hp, hp.intent, options)).toBeUndefined();
    });

    it("picks a subject the oracle accepts, or one the trainer's own words named — and nothing otherwise", () => {
      const subjects = [
        { kind: "entity", label: "Raichu", entityId: "raichu" },
        { kind: "entity", label: "Pikachu", entityId: "pikachu" },
      ] as const;
      expect(truthfulPick(entry("ans-fact-speed-pikachu"), "how fast is it?", subjects)).toEqual(subjects[1]);
      const gated = entry("refuse-mewtwo-2");
      expect(gated.expectFacts).toBeUndefined();
      expect(truthfulPick(gated, gated.intent, [{ kind: "entity", label: "Mew", entityId: "mew" }, { kind: "entity", label: "Mewtwo", entityId: "mewtwo" }])).toMatchObject({ entityId: "mewtwo" });
      expect(truthfulPick(entry("data-berry-effect"), "what does a berry do?", subjects)).toBeUndefined();
    });
  });

  it("with the door open the grammar offers the clarify entry, the pick binds, and the run records it", async () => {
    const speedAndAttack = JSON.stringify({
      asked: [{ phrase: "speed", entityId: "pikachu", fieldId: "base-attack" }],
      rosters: [],
      claims: [
        { kind: "fact", entityId: "pikachu", factId: "base-attack" },
        { kind: "fact", entityId: "pikachu", factId: "base-speed" },
      ],
    });
    const { provider, prompts } = clarifyingThenAnswering(speedAndAttack);
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), provider, clock(), undefined, 0, { profile: true, clarify: true });
    expect(prompts[0]).toContain('"kind": "clarify"');
    // The trainer picked Speed from the oracle; the pick held the reply to it.
    expect(run.stage.kind).toBe("resolved");
    expect(run.score.pass).toBe(true);
    expect(run.clarified).toEqual({ asked: 1, picked: 1, ignored: 0, capped: 0 });
    const facts = run.run.transaction!.manifest!.claims.filter((claim) => claim.kind === "fact").map((claim) => (claim as { factId: string }).factId);
    expect(facts).toEqual(["base-speed"]);
    // The ceremony reads the model's question from the record, apart from the pack's.
    expect(run.ceremony).toMatchObject({ questions: 0, clarifications: 1 });
    // The trainer's pick is on the record as their own words.
    const said = run.run.transcript.filter((event) => event.kind === "utterance" && event.source === "trainer").map((event) => (event as { text: string }).text);
    expect(said).toEqual([entry("ans-fact-speed-pikachu").intent, "how fast it is"]);
  });

  it("with the door shut the grammar offers no clarify entry and the run carries no gauge", async () => {
    const { provider, prompts } = clarifyingThenAnswering(pikachuSpeed());
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), provider, clock(), undefined, 0, { profile: true });
    expect(prompts[0]).not.toContain('"kind": "clarify"');
    expect(run.clarified).toBeUndefined();
    expect(run.ceremony?.clarifications).toBe(0);
  });

  it("a question with no right option is declined in plain words twice and the exchange closes — the model's miss, counted, at no model cost", async () => {
    // A needs-data entry: the oracle holds no field, so no option can be
    // right. The truthful trainer says so; the driver restates once, then
    // closes the exchange as an abstention — the honest outcome for an
    // unanswerable question, and a pass for its disposition.
    const { provider, prompts } = clarifyingThenAnswering(pikachuSpeed());
    const run = await runBankEntry(world, entry("data-berry-effect"), provider, clock(), undefined, 0, { profile: true, clarify: true });
    expect(run.clarified).toEqual({ asked: 1, picked: 0, ignored: 2, capped: 0 });
    expect(run.stage.kind).toBe("abstained-answer");
    expect(run.score.pass).toBe(true);
    // One answer call: the two declines were read deterministically.
    expect(prompts).toHaveLength(1);
    const said = run.run.transcript.filter((event) => event.kind === "utterance" && event.source === "trainer").map((event) => (event as { text: string }).text);
    expect(said.slice(1)).toEqual([NO_HONEST_PICK, NO_HONEST_PICK]);
  });
});

describe("R3b step 4 in the bank: suggestions are offered, shown and counted, never taken", () => {
  const suggesting = (asks: readonly string[]) =>
    JSON.stringify({
      asked: [{ phrase: "speed", entityId: "pikachu", fieldId: "base-speed" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }, { kind: "suggest", asks }],
    });

  it("with the door open the suggestions ride into the record, an offender is dropped, and the run counts both", async () => {
    const prompts: string[] = [];
    const provider = new ScriptedProvider("scripted:suggesting", (request) => {
      if (request.purpose !== "answer") return "decline";
      prompts.push(request.prompt);
      return suggesting(["What is it weak to?", "Is 90 a good Speed?"]);
    });
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), provider, clock(), undefined, 0, { profile: true, suggest: true });
    expect(prompts[0]).toContain('"kind": "suggest"');
    expect(run.stage.kind).toBe("resolved");
    // The digit-bearing one states a value and was dropped before the kernel saw it.
    expect(run.suggestions).toEqual({ shown: 1, dropped: 1 });
    expect(run.run.transaction!.manifest!.suggestions).toEqual(["What is it weak to?"]);
    // The bank's trainer never takes one: the exchange ends with the answer.
    expect(run.run.transcript.filter((event) => event.kind === "utterance" && event.source === "trainer")).toHaveLength(1);
  });

  it("with the door shut the grammar offers no suggest entry and the run carries no count", async () => {
    const prompts: string[] = [];
    const provider = new ScriptedProvider("scripted:plain", (request) => {
      if (request.purpose !== "answer") return "decline";
      prompts.push(request.prompt);
      return pikachuSpeed();
    });
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), provider, clock(), undefined, 0, { profile: true });
    expect(prompts[0]).not.toContain('"kind": "suggest"');
    expect(run.suggestions).toBeUndefined();
  });
});

describe("draftOnTarget — the gate's own removals, read from a refused draft", () => {
  it("reads a denied draft by the entry's oracle: on-target facts count, wrong subject or shape or a must-not-resolve entry does not", () => {
    const speed = bank.entries.find((entry) => entry.id === "ans-fact-speed-pikachu")!;
    expect(draftOnTarget(speed, [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 1 } }])).toBe(true);
    expect(draftOnTarget(speed, [{ kind: "fact", entityId: "onix", factId: "base-speed", asserted: { kind: "number", value: 1 } }])).toBe(false);
    expect(draftOnTarget(speed, [{ kind: "explanation", blockId: "what-is-badge" }])).toBe(false);
    expect(draftOnTarget(speed, [])).toBe(false);
    const needsData = bank.entries.find((entry) => entry.disposition === "needs-data")!;
    expect(draftOnTarget(needsData, [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }])).toBe(false);
  });
});

describe("the bank files the driver's ledger with each run (issue #158)", () => {
  const scripted = (answer: string) => new ScriptedProvider("bank:ledger", (request) => (request.purpose === "answer" ? answer : "decline"));
  it("carries the exchanges' steps on the run, the open one as open when nothing was filed", async () => {
    const answered = await runBankEntry(world, entry("ans-fact-speed-pikachu"), scripted(pikachuSpeed()), clock(), undefined, 0, { profile: true });
    const filed = answered.run.exchanges!.find((exchange) => exchange.transactionId !== undefined)!;
    expect(filed.outcome).toBe("answered");
    expect(filed.steps.map((step) => step.code)).toContain("record/answered");
    const passed = await runBankEntry(world, entry("off-weather"), scripted(JSON.stringify({ rosters: [], claims: [] })), clock(), undefined, 0, { profile: true });
    expect(passed.run.exchanges!.at(-1)!.outcome).toBe("open");
  });
});

describe("the precedent door on a bank run (docs/precedent.md)", () => {
  const SNAPSHOT = world.registry.snapshot.id;
  const precedent = (id: string, ask: string, claims: readonly Claim[], entryId: string): Precedent => ({
    id,
    snapshotId: SNAPSHOT,
    ask,
    shape: shapeOf({ claims, rosters: [] }),
    source: { kind: "bank-run", artifact: "runs/coverage/test.json", transactionId: `txn-${id}`, entryId },
    promoted: { by: "oracle", at: "2026-09-14T00:00:00.000Z" },
  });
  const store: PrecedentStore = {
    schemaVersion: 1,
    packId: world.pack.id,
    precedents: [
      precedent("p-own", "What's Pikachu's Speed stat?", [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }], "ans-fact-speed-pikachu"),
      precedent("p-attack", "What's Pikachu's Attack stat?", [{ kind: "fact", entityId: "pikachu", factId: "base-attack" }], "ans-fact-attack-pikachu"),
      precedent("p-game", "tell me about the game", [{ kind: "explanation", blockId: "what-is-game" }], "meta-what-is-game"),
    ],
  };

  it("withholds the entry's own precedent, holds a neighbour's, and records what was held and whether it was followed", async () => {
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(pikachuSpeed()), clock(), undefined, 0, { precedents: { store, mode: "nearest" } });
    expect(run.stage).toEqual({ kind: "resolved" });
    expect(run.precedents).toEqual({ held: ["p-attack"], followed: false });
    const codes = run.run.exchanges!.flatMap((exchange) => exchange.steps.map((step) => step.code));
    expect(codes).toContain("memory/held-out");
    expect(codes).toContain("memory/departed");
  });

  it("the fixed arm holds the same few on every entry, chosen once from the store", async () => {
    const run = await runBankEntry(world, entry("ans-fact-attack-machamp"), model(""), clock(), undefined, 0, { precedents: { store, mode: "fixed" } });
    expect(run.precedents).toEqual({ held: ["p-game", "p-own"] });
  });

  it("with the door shut, the run carries no precedent reading", async () => {
    const run = await runBankEntry(world, entry("ans-fact-speed-pikachu"), model(pikachuSpeed()), clock());
    expect(run.precedents).toBeUndefined();
  });
});
