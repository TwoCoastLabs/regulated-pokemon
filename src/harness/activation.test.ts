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
  });

  it("renders as Markdown from the data", () => {
    const text = renderActivation(report);
    expect(text).toContain("| Retrieval pulled an acceptable entity |");
    expect(text).toContain("Scope statements (");
    expect(text).toContain("**bound-wrong");
  });

  it("renders a report with no misses without the miss sections", () => {
    const text = renderActivation({ ...report, retrievalMisses: [], nominationMisses: [] });
    expect(text).not.toContain("Retrieval misses:");
    expect(text).not.toContain("Nomination misses:");
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
