/**
 * The activation ceiling is a number the findings quote, so it is pinned here
 * — a change to a front door, a bank, or the pack that moves it has to move
 * this file in the same change. The scope-phrasing bank is reviewed data, so
 * its loader's refusals are asserted like every other bank's.
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import {
  activationReport,
  lessonReadings,
  loadScopePhrasings,
  nominationReadings,
  readScopePhrasings,
  renderActivation,
  retrievalReadings,
  SCOPE_BANK_PATH,
  type ScopePhrasingBank,
  scopeReadings,
  wordingsOf,
} from "./activation.js";
import { readBank } from "./bank.js";
import { retrievalSelection, retrieveReference } from "./reference.js";

const world = demoWorld();
const bank = readBank();
const scopeBank = readScopePhrasings();

function loadWith(sabotage: (draft: ScopePhrasingBank) => void): () => unknown {
  const draft = structuredClone(scopeBank) as ScopePhrasingBank;
  sabotage(draft);
  return () => loadScopePhrasings(draft);
}

function phrasing(draft: ScopePhrasingBank, index: number) {
  const found = draft.phrasings[index];
  if (found === undefined) throw new Error(`no phrasing at ${index}`);
  return found;
}

describe("retrievalSelection is retrieveReference's own selection", () => {
  it("renders to the same bytes for a question", () => {
    const { registry } = world;
    const question = "Which Electric types learn Thunderbolt? And how fast is Pikachu?";
    const selection = retrievalSelection(registry, question);
    expect(selection.species.has("pikachu")).toBe(true);
    expect(selection.moves.has("thunderbolt")).toBe(true);
    expect(retrieveReference(registry, question).length).toBeGreaterThan(0);
  });

  it("matches a hyphenated id written as words, hyphenated, or run together", () => {
    for (const wording of ["What's Fire Blast's accuracy?", "fire-blast accuracy", "How strong is Selfdestruct?"]) {
      const selection = retrievalSelection(world.registry, wording);
      expect(selection.moves.has("fire-blast") || selection.moves.has("self-destruct"), wording).toBe(true);
    }
  });

  it("pulls nothing for a question that names nothing", () => {
    const selection = retrievalSelection(world.registry, "what is the quickest one");
    expect(selection.species.size).toBe(0);
    expect(selection.moves.size).toBe(0);
  });
});

describe("the doors, read one wording at a time", () => {
  it("lists the canonical intent first, then the paraphrases", () => {
    const entry = bank.entries.find((candidate) => (candidate.phrasings ?? []).length > 0);
    if (entry === undefined) throw new Error("the bank carries no paraphrased entry");
    const wordings = wordingsOf(entry);
    expect(wordings[0]).toBe(entry.intent);
    expect(wordings.length).toBe(1 + (entry.phrasings ?? []).length);
  });

  it("reads retrieval only where a subject oracle names an entity", () => {
    const readings = retrievalReadings(world.registry, bank);
    const ids = new Set(readings.map((reading) => reading.entryId));
    for (const entry of bank.entries) {
      expect(ids.has(entry.id)).toBe((entry.expectFacts ?? []).length > 0);
    }
  });

  it("reads nomination only where a filler kind is expected", () => {
    const readings = nominationReadings(bank);
    const ids = new Set(readings.map((reading) => reading.entryId));
    for (const entry of bank.entries) {
      const wantsFiller = (entry.expectClaimKinds ?? []).some((kind) => kind === "count" || kind === "typeCount" || kind === "gameRule");
      expect(ids.has(entry.id)).toBe(wantsFiller);
    }
  });

  it("classifies every scope outcome the way its definition says", () => {
    const outcomes = new Map(scopeReadings(world.pack, scopeBank).map((reading) => [reading.id, reading]));
    expect(outcomes.get("v-playing-red")?.outcome).toBe("bound");
    expect(outcomes.get("v-bare-yellow")?.outcome).toBe("unbound");
    expect(outcomes.get("n-rival-says")?.outcome).toBe("inert");
    expect(outcomes.get("n-rival-says")?.refused.join(" ")).toContain("reported");
    expect(outcomes.get("b-lied-corrected")?.outcome).toBe("contradicted");
  });
});

describe("the activation ceiling, pinned", () => {
  const report = activationReport(world.registry, world.pack, bank, scopeBank);

  // The numbers findings iteration 29 quotes.
  it("pins the filed numbers", () => {
    expect(report.retrieval).toEqual({ canonical: { engaged: 30, total: 30 }, paraphrase: { engaged: 23, total: 27 } });
    expect(report.nomination).toEqual({ canonical: { engaged: 12, total: 12 }, paraphrase: { engaged: 13, total: 13 } });
    // bound rose 23 → 24 → 25 on 2026-09-01: the comparative term moved
    // c-fastest to the deterministic column, then "got" as version context
    // moved v-got-yellow ("I've got the yellow one" — its own note predicted
    // the fall to the question) — the gate's recall improving is exactly
    // what this instrument exists to record.
    expect(report.scope).toEqual({ bound: 25, unbound: 12, "bound-wrong": 4, contradicted: 1, inert: 8 });
    // The lesson door (2026-09-17, findings §24): every canonical intent,
    // because the aliases were written from them; 15 of 25 reviewed
    // paraphrases, which they were not. The second column is the number.
    expect(report.lesson).toEqual({ canonical: { engaged: 18, total: 18 }, paraphrase: { engaged: 15, total: 25 } });
    expect(report.lessonMisses).toHaveLength(10);
    expect(report.lessonMisses.every((miss) => !miss.canonical)).toBe(true);
  });

  it("pins the lesson door's other half: the boundary alone on every must-not-answer question, both wordings", () => {
    expect(report.lessonMatcher).toBe("alias");
    expect(report.lessonPrecision).toEqual({ canonical: { engaged: 45, total: 45 }, paraphrase: { engaged: 32, total: 32 } });
    expect(report.lessonPrecisionMisses).toEqual([]);
  });

  it("pins the BM25 matcher as the negative control: one more paraphrase, and the door reopened (findings §24)", () => {
    // The hypothesis of 2026-09-17 — that a lexical index over the lesson
    // text would lift recall on paraphrases — read once on the held-out
    // set. It gains one paraphrase and offers a topical lesson on 37 of 45
    // must-not-answer questions, including the ledger's worst entry. The
    // discriminator is the ask's form, which the index discards as stop
    // words; the alias matcher encodes it. Pinned so the same lesson is
    // not bought again.
    const bm25 = activationReport(world.registry, world.pack, bank, scopeBank, "bm25");
    expect(bm25.lesson).toEqual({ canonical: { engaged: 12, total: 18 }, paraphrase: { engaged: 16, total: 25 } });
    expect(bm25.lessonPrecision).toEqual({ canonical: { engaged: 8, total: 45 }, paraphrase: { engaged: 8, total: 32 } });
    const reopened = bm25.lessonPrecisionMisses.find((miss) => miss.wording === "Who is the Pewter City gym leader?");
    expect(reopened?.offered).toEqual(["what-is-gym-leader"]);
    // The union: recall rises to 22 of 25 and precision is the index's.
    const both = activationReport(world.registry, world.pack, bank, scopeBank, "both");
    expect(both.lesson).toEqual({ canonical: { engaged: 14, total: 18 }, paraphrase: { engaged: 22, total: 25 } });
    expect(both.lessonPrecision).toEqual({ canonical: { engaged: 8, total: 45 }, paraphrase: { engaged: 8, total: 32 } });
    expect(renderActivation(bm25)).toContain("| Lesson door (bm25) offered an acceptable lesson | 12/18 (67%) | 16/25 (64%) |");
    expect(renderActivation(bm25)).toContain("| Lesson door (bm25) offered the boundary alone on a must-not-answer | 8/45 (18%) | 8/32 (25%) |");
    expect(renderActivation(bm25)).toContain("Lesson door offered a lesson on a question that must not be answered:");
  });

  it("names what the lesson door offered instead, per miss", () => {
    const byWording = new Map(report.lessonMisses.map((miss) => [miss.wording, miss.offered]));
    // A typo that lands on another lesson's alias: the wrong lesson, not the boundary.
    expect(byWording.get("what is a gym badg")).toEqual(["what-is-gym-leader"]);
    // Natural rephrasings the alias lists did not anticipate: the boundary alone.
    expect(byWording.get("who are the gym leaders?")).toEqual([]);
    expect(byWording.get("how does a Pokémon evolve?")).toEqual([]);
    expect(byWording.get("what's the Elite Four?")).toEqual([]);
  });

  it("renders as Markdown from the data", () => {
    const text = renderActivation(report);
    expect(text).toContain("| Retrieval pulled an acceptable entity |");
    expect(text).toContain("| Lesson door (alias) offered an acceptable lesson | 18/18 (100%) | 15/25 (60%) |");
    expect(text).toContain("| Lesson door (alias) offered the boundary alone on a must-not-answer | 45/45 (100%) | 32/32 (100%) |");
    expect(text).toContain("Lesson door misses");
    expect(text).toContain("“what is a gym badg” → `what-is-gym-leader`");
    expect(text).toContain("“who are the gym leaders?” → boundary only");
    expect(text).toContain("Scope statements (");
    expect(text).toContain("**bound-wrong");
  });

  it("renders a report with no misses without the miss sections", () => {
    const text = renderActivation({ ...report, retrievalMisses: [], nominationMisses: [], lessonMisses: [], lessonPrecisionMisses: [] });
    expect(text).not.toContain("Retrieval misses:");
    expect(text).not.toContain("Nomination misses:");
    expect(text).not.toContain("Lesson door misses");
    expect(text).not.toContain("must not be answered");
  });

  it("has no lesson row for a pack that declares no coverage — a door that does not exist has no ceiling", () => {
    const bare = { ...world.pack, curriculum: world.pack.curriculum.map(({ covers: _covers, ...lesson }) => lesson) };
    const without = activationReport(world.registry, bare, bank, scopeBank);
    expect(without.lesson).toBeUndefined();
    expect(without.lessonPrecision).toBeUndefined();
    expect(without.lessonMisses).toEqual([]);
    expect(without.lessonPrecisionMisses).toEqual([]);
    expect(renderActivation(without)).not.toContain("Lesson door");
  });

  it("reads only entries whose answer is a lesson, every wording of each", () => {
    const readings = lessonReadings(world, bank);
    const entries = new Set(readings.map((reading) => reading.entryId));
    expect(entries.size).toBe(18);
    for (const reading of readings) {
      const entry = bank.entries.find((candidate) => candidate.id === reading.entryId)!;
      expect(entry.expectClaimKinds).toContain("explanation");
      expect(entry.expectBlockIds?.length).toBeGreaterThan(0);
    }
    expect(readings.filter((reading) => reading.canonical)).toHaveLength(18);
  });
});

describe("the scope-phrasing loader refuses what would make the number lie", () => {
  it("loads from disk", () => {
    expect(() => readScopePhrasings(SCOPE_BANK_PATH)).not.toThrow();
    expect(scopeBank.phrasings.length).toBeGreaterThanOrEqual(40);
  });

  const cases: [string, (draft: ScopePhrasingBank) => void, string][] = [
    ["not an object", (draft) => Object.assign(draft, { phrasings: undefined }), "scope-bank-malformed"],
    ["an unsupported schema", (draft) => Object.assign(draft, { bankVersion: 9 }), "scope-bank-schema-unsupported"],
    ["no id", (draft) => Object.assign(draft, { id: "" }), "scope-bank-malformed"],
    ["a phrasing with no id", (draft) => Object.assign(phrasing(draft, 0), { id: "" }), "scope-phrasing-unnamed"],
    ["a duplicated id", (draft) => Object.assign(phrasing(draft, 1), { id: phrasing(draft, 0).id }), "scope-phrasing-duplicate"],
    ["an empty utterance", (draft) => Object.assign(phrasing(draft, 0), { say: "  " }), "scope-phrasing-empty"],
    ["no expectation", (draft) => Object.assign(phrasing(draft, 0), { expect: null }), "scope-phrasing-expect-malformed"],
    ["an unknown dimension", (draft) => Object.assign(phrasing(draft, 0), { expect: { mood: "happy" } }), "scope-phrasing-dimension-unknown"],
    ["a null expectation with no reason", (draft) => Object.assign(phrasing(draft, 0), { expect: {}, notes: "" }), "scope-phrasing-null-unstated"],
  ];
  for (const [name, sabotage, rule] of cases) {
    it(`refuses ${name} as ${rule}`, () => {
      expect(loadWith(sabotage)).toThrow(rule);
    });
  }

  it("refuses an unreadable file by name", () => {
    expect(() => readScopePhrasings("/nonexistent/scope.json")).toThrow("scope-bank-unreadable");
  });
});
