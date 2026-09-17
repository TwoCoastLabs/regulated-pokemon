/**
 * The lesson door's live reading, run with a scripted model so the harness
 * is proven before a dollar is spent (docs/lesson-door.md, the classifier).
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { readLessonParaphrases } from "./activation.js";
import { BANK_PATH, readBank } from "./bank.js";
import { type LessonDoorReadingArtifact, readingWordings, readingWorld, readLessonDoor, renderLessonDoorReading, summarize } from "./lesson-door-reading.js";
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
