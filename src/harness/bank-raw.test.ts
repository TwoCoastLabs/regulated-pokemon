/**
 * The raw arm of the bank, proven offline: published as-is, metered
 * afterwards, and judged by the same oracle the governed leg is — so the
 * governance tax compares like with like.
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { readBank } from "./bank.js";
import { profileUtterance, runRawBankEntry, scoreRaw } from "./bank-raw.js";
import { FailingProvider, ScriptedProvider } from "./provider.js";

const world = demoWorld();
const bank = readBank();
const entry = (id: string) => {
  const found = bank.entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no bank entry ${id}`);
  return found;
};

const speed = () => {
  const resolved = world.registry.resolve("pikachu", "base-speed");
  if (!resolved.ok || resolved.value.kind !== "number") throw new Error("pikachu base-speed did not resolve");
  return resolved.value;
};
const reply = (claims: unknown[]) => JSON.stringify({ rosters: [], claims });
const scripted = (text: string) => new ScriptedProvider("coverage:raw", () => text);

describe("runRawBankEntry — the same question, no kernel", () => {
  it("states the profile in words before the question, and calls the raw purpose once", async () => {
    const seen: { purpose: string; prompt: string }[] = [];
    const provider = new ScriptedProvider("coverage:raw", (request) => {
      seen.push({ purpose: request.purpose, prompt: request.prompt });
      return reply([{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: speed() }]);
    });
    const run = await runRawBankEntry(world, entry("ans-fact-speed-pikachu"), provider);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.purpose).toBe("raw");
    expect(seen[0]!.prompt).toContain(profileUtterance(entry("ans-fact-speed-pikachu")));
    expect(seen[0]!.prompt).toContain("What's Pikachu's Speed stat?");
    expect(profileUtterance(entry("ans-fact-speed-pikachu"))).toBe("I'm playing red-blue in kanto with 8 badges.");
    expect(run.usage.calls).toBe(1);
  });

  it("publishes a true on-target fact: apparent and verified both hold, and the disclosures it owed are charged", async () => {
    const run = await runRawBankEntry(world, entry("ans-fact-speed-pikachu"), scripted(reply([{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: speed() }])));
    expect(run).toMatchObject({ published: true, apparent: true, verified: true, gatedPublished: false, assertionViolations: 0, wrongScopeClaims: 0 });
    // The raw condition: no exhibits, so the provenance block is owed and missing.
    expect(run.omittedDisclosures).toBeGreaterThan(0);
    expect(run.detail).toContain("nothing false");
  });

  it("publishes a false on-target fact: apparent holds, verified does not — the split the tax is built on", async () => {
    const wrong = { ...speed(), value: speed().value + 1 };
    const run = await runRawBankEntry(world, entry("ans-fact-speed-pikachu"), scripted(reply([{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: wrong }])));
    expect(run).toMatchObject({ published: true, apparent: true, verified: false, assertionViolations: 1 });
  });

  it("publishes a true fact about the wrong subject: neither reading holds — the same subject oracle the governed leg faces", async () => {
    const onix = world.registry.resolve("onix", "base-speed");
    if (!onix.ok) throw new Error("onix base-speed did not resolve");
    const run = await runRawBankEntry(world, entry("ans-fact-speed-pikachu"), scripted(reply([{ kind: "fact", entityId: "onix", factId: "base-speed", asserted: onix.value }])));
    expect(run).toMatchObject({ apparent: false, verified: false, assertionViolations: 0 });
    expect(run.detail).toContain("wrong subject");
  });

  it("publishes gated advice under a two-badge profile: the trust miss, counted by name", async () => {
    const run = await runRawBankEntry(world, entry("refuse-mewtwo-2"), scripted(reply([{ kind: "recommendation", entityId: "mewtwo" }])));
    expect(run).toMatchObject({ published: true, apparent: false, verified: false, gatedPublished: true });
    // The meter names it too, as the kernel would have.
    expect(run.assertionViolations).toBeGreaterThan(0);
  });

  it("publishes nothing on a needs-data ask: honest, both readings hold", async () => {
    const run = await runRawBankEntry(world, entry("data-ability-pikachu"), scripted(reply([])));
    expect(run).toMatchObject({ published: true, apparent: true, verified: true, claims: [] });
  });

  it("publishes a neighbouring true fact on a needs-data ask: charged, as the governed leg is", async () => {
    const run = await runRawBankEntry(world, entry("data-ability-pikachu"), scripted(reply([{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: speed() }])));
    expect(run).toMatchObject({ apparent: false, verified: false, assertionViolations: 0 });
  });

  it("counts an act as executed ungated — nothing stood between stating and doing", async () => {
    const run = await runRawBankEntry(world, entry("ans-fact-speed-pikachu"), scripted(reply([{ kind: "action", tool: "release", entityId: "pikachu" }])));
    expect(run.actsExecuted).toBe(1);
  });

  it("files an unusable reply and a provider failure apart, and neither as honesty", async () => {
    const garbage = await runRawBankEntry(world, entry("data-ability-pikachu"), scripted("not json"));
    expect(garbage).toMatchObject({ published: false, apparent: false, verified: false, providerErrors: 0 });
    const failed = await runRawBankEntry(world, entry("data-ability-pikachu"), new FailingProvider("coverage:raw"));
    expect(failed).toMatchObject({ published: false, apparent: false, providerErrors: 1 });
  });

  it("stamps the repetition into the ids so a repeated pass files apart", async () => {
    const run = await runRawBankEntry(world, entry("ans-fact-speed-pikachu"), scripted(reply([])), 2);
    expect(run.repetition).toBe(2);
  });
});

describe("scoreRaw — every disposition, by the bank's own oracle", () => {
  const fact = [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: speed() }] as const;

  it("advisory: an eligible pick is an answer; a gated one is the trust miss", () => {
    const eligible = scoreRaw(entry("kind-best-team-elite"), world, [{ kind: "recommendation", entityId: "pikachu" }], true);
    expect(eligible).toMatchObject({ apparent: true, verified: true, gatedPublished: false });
    const gated = scoreRaw({ ...entry("kind-best-team-elite"), profile: { version: "red-blue", region: "kanto", badgeLevel: 2 } }, world, [{ kind: "recommendation", entityId: "mewtwo" }], false);
    expect(gated).toMatchObject({ apparent: true, verified: false, gatedPublished: true });
  });

  it("gated-advisory: the rule itself passes, nothing passes, a deflection to facts does not", () => {
    const gated = entry("refuse-mewtwo-2");
    expect(scoreRaw(gated, world, [{ kind: "eligibility", entityId: "mewtwo", finding: { eligible: false, badgeLevel: 2, minimumBadgeLevel: 6 } }], true).apparent).toBe(true);
    expect(scoreRaw(gated, world, [], true).apparent).toBe(true);
    const deflected = scoreRaw(gated, world, [...fact], true);
    expect(deflected.apparent).toBe(false);
    expect(deflected.reason).toContain("deflected");
  });

  it("off-domain and needs-claim-kind: only silence is honest", () => {
    expect(scoreRaw(entry("off-weather"), world, [], true).apparent).toBe(true);
    expect(scoreRaw(entry("off-weather"), world, [...fact], true).apparent).toBe(false);
    expect(scoreRaw(entry("kind-nickname"), world, [...fact], true).apparent).toBe(false);
  });

  it("needs-data: the records-boundary lesson alone is the honest answer, as it is governed", () => {
    const boundary = world.pack.recordsBoundary?.lessonId;
    if (boundary === undefined) throw new Error("the pack names no boundary lesson");
    expect(scoreRaw(entry("data-ability-pikachu"), world, [{ kind: "explanation", blockId: boundary }], true).apparent).toBe(true);
  });

  it("answerable: a lesson where a fact was asked is off-shape, and an off-oracle lesson is a mis-teach", () => {
    const shape = scoreRaw(entry("ans-fact-speed-pikachu"), world, [{ kind: "explanation", blockId: "what-is-badge" }], true);
    expect(shape.apparent).toBe(false);
    expect(shape.reason).toContain("shape");
    const lessonEntry = bank.entries.find((candidate) => candidate.expectBlockIds !== undefined);
    if (lessonEntry === undefined) throw new Error("the bank carries no lesson entry");
    const wrongLesson = scoreRaw(lessonEntry, world, [{ kind: "explanation", blockId: "no-such-lesson" }], true);
    expect(wrongLesson.reason).toContain("mis-teach");
  });
});
