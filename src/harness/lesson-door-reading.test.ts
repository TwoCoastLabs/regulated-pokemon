/**
 * The lesson door's live reading, run with a scripted model so the harness
 * is proven before a dollar is spent (docs/lesson-door.md, the classifier).
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { readLessonParaphrases } from "./activation.js";
import { BANK_PATH, readBank } from "./bank.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type LessonDoorReadingArtifact, readingWordings, readingWorld, readLessonDoor, renderLessonDoorReading, rescoreWithFoothold, summarize } from "./lesson-door-reading.js";
import { ScriptedProvider } from "./provider.js";

const world = demoWorld();
const bank = readBank(BANK_PATH);
const paraphrases = readLessonParaphrases(bank);

describe("the wordings the reading covers", () => {
  it("is the two held-out sets, the canonical intents and every must-not-answer wording", () => {
    const wordings = readingWordings(bank, paraphrases);
    const by = (set: string) => wordings.filter((item) => item.set === set).length;
    expect(by("recall-canonical")).toBe(18);
    expect(by("recall-paraphrase")).toBe(25);
    expect(by("recall-held-out")).toBe(72);
    expect(by("precision-canonical")).toBe(45);
    expect(by("precision-paraphrase")).toBe(32);
  });
});

describe("the reading with a scripted classifier", () => {
  // A model that names the lesson whose id shares a word with the ask, else
  // calls it a fact — enough to prove the harness reads both sides.
  const provider = new ScriptedProvider("reading", (request) => {
    if (request.purpose !== "lesson") throw new Error(`unexpected purpose ${request.purpose}`);
    const ask = /asked: "([^"]+)"/.exec(request.prompt)![1]!.toLowerCase();
    const ids = (request.schema?.schema as { properties: { lessonId: { enum: string[] } } }).properties.lessonId.enum;
    const named = ids.find((id) => id.split("-").some((word) => word.length > 3 && ask.includes(word)));
    return named === undefined ? JSON.stringify({ kind: "fact", entity: "something" }) : JSON.stringify({ kind: "lesson", lessonId: named });
  });

  it("asks the classifier only where the matcher offered the boundary alone, and reads its share apart", async () => {
    const readings = await readLessonDoor(world, provider, bank, paraphrases, { classifier: true, repetitions: 1 });
    expect(readings).toHaveLength(192);
    // Never asked where the deterministic door already placed the ask.
    const canonical = readings.filter((reading) => reading.set === "recall-canonical");
    expect(canonical.every((reading) => reading.ok && !reading.asked)).toBe(true);
    // Asked on the alias matcher's misses that left the boundary alone — not
    // on the two where it offered a wrong lesson, since an offer of two is
    // not "nothing found" — and on every must-not-answer wording it left at
    // the boundary (44 of 45 and 32 of 32).
    const summary = summarize(readings);
    expect(summary.rates["recall-paraphrase"].asked).toBe(4);
    expect(summary.rates["recall-held-out"].asked).toBe(23);
    expect(summary.rates["precision-canonical"].asked).toBe(44);
    expect(summary.rates["precision-paraphrase"].asked).toBe(32);
    expect(summary.classifier.asked).toBe(4 + 23 + 44 + 32);
    expect(summary.classifier.lesson + summary.classifier.fact + summary.classifier.advice + summary.classifier.other + summary.classifier.unusable).toBe(summary.classifier.asked);
    // The scripted model names a lesson for "what is a mvoe"? No — "mvoe"
    // shares no word; "wat is a tm" — "tm" is too short. A typo the model
    // reads: "what is evoluton" shares nothing either. So its lift is small
    // and honest; what matters here is that every asked reading is counted.
    expect(readings.filter((reading) => reading.asked).every((reading) => reading.classified !== undefined)).toBe(true);
    expect(summary.usage.calls).toBe(summary.classifier.asked);
    expect(summary.providerErrors).toBe(0);
  });

  it("with the classifier off is the activation gauge's reading, live: nothing asked, no calls", async () => {
    const readings = await readLessonDoor(world, provider, bank, paraphrases, { classifier: false, repetitions: 1 });
    const summary = summarize(readings);
    expect(summary.classifier.asked).toBe(0);
    expect(summary.usage.calls).toBe(0);
    expect(summary.rates["recall-paraphrase"]).toEqual({ ok: 20, total: 25, asked: 0, askedOk: 0 });
    expect(summary.rates["recall-held-out"]).toEqual({ ok: 48, total: 72, asked: 0, askedOk: 0 });
    expect(summary.rates["precision-canonical"]).toEqual({ ok: 44, total: 45, asked: 0, askedOk: 0 });
  });

  it("renders every number beside its denominator and names the misses with the classifier's word", async () => {
    const readings = await readLessonDoor(world, provider, bank, paraphrases, { classifier: true, repetitions: 1 });
    const artifact: LessonDoorReadingArtifact = {
      schemaVersion: 1,
      label: "lesson-door-reading",
      startedAt: "2026-09-17T00:00:00.000Z",
      model: { id: "scripted", slug: "scripted" },
      world: readingWorld(world),
      matcher: "alias",
      classifier: true,
      repetitions: 1,
      readings,
      summary: summarize(readings),
    };
    const text = renderLessonDoorReading(artifact);
    expect(text).toContain("| recall, canonical intents | 18/18 (100%) |");
    expect(text).toContain("| precision, must-not-answer, canonical |");
    expect(text).toContain("(classifier: ");
    for (const match of text.matchAll(/\((\d+)%\)/g)) expect(text.slice(Math.max(0, match.index - 12), match.index)).toMatch(/\d+\/\d+ $/);
  });

  it("counts a provider failure as an error and leaves the boundary alone", async () => {
    const failing = new ScriptedProvider("reading-down", () => {
      throw new Error("down");
    });
    const readings = await readLessonDoor(world, failing, bank, paraphrases, { classifier: true, repetitions: 1 });
    const summary = summarize(readings);
    expect(summary.providerErrors).toBe(summary.classifier.asked);
    expect(summary.classifier.unusable).toBe(summary.classifier.asked);
    expect(summary.rates["precision-canonical"].ok).toBe(44);
  });
});

describe("the filed classifier readings, re-read under the foothold rule (the free leg)", () => {
  const filed = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "../../runs/lesson-door", name), "utf8")) as LessonDoorReadingArtifact;
  const perRepetition = (readings: LessonDoorReadingArtifact["readings"], set: string) =>
    [0, 1, 2].map((repetition) => readings.filter((reading) => reading.set === set && reading.repetition === repetition).filter((reading) => reading.ok).length);

  it("strong model: precision back to 43–44 of 45, one recall point per set (findings §24, the foothold)", () => {
    const artifact = filed("2026-09-17T00-27-21-672Z-lesson-door.json");
    expect(artifact.model.slug).toBe("qwen/qwen3-235b-a22b-2507");
    const rescored = rescoreWithFoothold(world.pack, artifact.readings);
    expect(perRepetition(artifact.readings, "precision-canonical")).toEqual([42, 42, 41]);
    expect(perRepetition(rescored, "precision-canonical")).toEqual([44, 44, 43]);
    expect(perRepetition(artifact.readings, "recall-held-out")).toEqual([70, 70, 69]);
    expect(perRepetition(rescored, "recall-held-out")).toEqual([69, 69, 68]);
    expect(perRepetition(rescored, "recall-paraphrase")).toEqual([23, 23, 23]);
    expect(perRepetition(rescored, "precision-paraphrase")).toEqual([32, 32, 32]);
    expect(summarize(rescored).classifier.noFoothold).toBe(12);
    // The two correct readings the check withdraws, three times each: a
    // compound misspelling and a synonym — the price of a lexical check.
    const withdrawn = rescored.filter((reading, index) => reading.ok !== artifact.readings[index]!.ok && !reading.ok).map((reading) => reading.wording);
    expect(new Set(withdrawn)).toEqual(new Set(["what is a pokebal", "what are a Pokémon's attacks?"]));
  });

  it("weak model: precision from 38 to 42–43 of 45 — the off-domain lessons it named share no word with the ask", () => {
    const artifact = filed("2026-09-17T00-36-48-341Z-lesson-door.json");
    expect(artifact.model.slug).toBe("mistralai/mistral-nemo");
    const rescored = rescoreWithFoothold(world.pack, artifact.readings);
    expect(perRepetition(artifact.readings, "precision-canonical")).toEqual([38, 38, 38]);
    expect(perRepetition(rescored, "precision-canonical")).toEqual([42, 42, 43]);
    expect(perRepetition(rescored, "recall-held-out")).toEqual([67, 64, 64]);
    expect(perRepetition(rescored, "recall-paraphrase")).toEqual([23, 22, 22]);
    expect(summarize(rescored).classifier.noFoothold).toBe(23);
    const recovered = rescored.filter((reading, index) => reading.ok !== artifact.readings[index]!.ok && reading.ok).map((reading) => reading.wording);
    expect(recovered).toContain("How do I cook pasta?");
    expect(recovered).toContain("Write me a poem about the ocean.");
  });

  it("leaves a reading alone unless its named lesson was offered without a foothold", () => {
    const artifact = filed("2026-09-17T00-24-10-105Z-lesson-door.json");
    const rescored = rescoreWithFoothold(world.pack, artifact.readings);
    for (const [index, reading] of rescored.entries()) {
      const before = artifact.readings[index]!;
      if (reading === before) continue;
      expect(before.classified?.startsWith("lesson:")).toBe(true);
      expect(reading.classified?.endsWith(":no-foothold")).toBe(true);
      expect(reading.offered).not.toContain(before.classified!.slice("lesson:".length));
    }
    // Idempotent: a reading already marked is not re-judged.
    expect(rescoreWithFoothold(world.pack, rescored)).toEqual(rescored);
  });
});
