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

  it("a needs-data question is a pass when the model does not certify it", async () => {
    const run = await runBankEntry(world, entry("data-evolve-pikachu"), model(""), clock());
    expect(run.stage.kind).toBe("abstained-answer");
    expect(run.score.pass).toBe(true);
  });

  it("a needs-claim-kind question passes on an honest abstention", async () => {
    // Genuinely unexpressible: type effectiveness is a matchup relation with no
    // claim kind and no chart in the snapshot — not composable, not advisory.
    const run = await runBankEntry(world, entry("kind-type-effectiveness"), model(""), clock());
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
