/**
 * The bank runner, proven offline: a handful of real bank entries driven
 * through the real session spine with scripted models, one per entry, so the
 * whole machinery — scope by the answer route, the answer step, the kernel's
 * denial — is exercised key-free. The paid run over the full bank is wave 4;
 * this proves the instrument buckets a run correctly before a cent is spent.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "./corpus.js";
import { ScriptedProvider } from "./provider.js";
import { type BankEntry, readBank } from "./bank.js";
import { phrasingsOf, runBank, runBankEntry, runIntentRobustness } from "./bank-run.js";

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
    await runBankEntry(world, entry("ans-fact-speed-pikachu"), spyGround, clock(), undefined, 0, true);
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
    await runBankEntry(world, entry("ans-fact-speed-pikachu"), capture(full), clock(), undefined, 0, true, false);
    const retrieved: string[] = [];
    await runBankEntry(world, entry("ans-fact-speed-pikachu"), capture(retrieved), clock(), undefined, 0, false, true);

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
    await runBankEntry(world, entry("ans-rank-fastest-electric"), spy, clock(), undefined, 0, false, false, true);
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

    const repaired = await runBankEntry(
      world, entry("ans-fact-speed-pikachu"), model(wrongSpeed), clock(), undefined, 0, false, false, false, true);
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
    const still = await runBankEntry(
      world, entry("ans-fact-speed-pikachu"), model(fabricated), clock(), undefined, 0, false, false, false, true);
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
    const closed = await runBankEntry(
      world, entry("ans-fact-speed-pikachu"), model(mixed), clock(), undefined, 0, false, false, false, true);
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
