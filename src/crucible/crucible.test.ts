/**
 * Invariants of the crucible harness itself, asserted across every phase
 * rather than restated per phase.
 *
 * A phase-shaped test can only prove things about its own phase. These
 * assertions are the ones that must hold for the crucible as a whole, and the
 * one that carries the epic's acceptance criterion is `article coverage`:
 * every Accord article is denied by name somewhere, or is written down as
 * pending against the phase that will deny it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { type AccordArticle, ACCORD_ARTICLES, type ArticleId } from "../kernel/accord.js";
import { denialCode } from "../kernel/violation.js";
import { centerContext, manifestContext } from "../testing/fixtures.js";
import { type CrucibleWorld, type CrucibleWorldId, expectedDenial } from "./harness.js";
import {
  ALL_CONTROLS,
  ALL_MUTATIONS,
  CRUCIBLE_PHASES,
  coveredArticles,
  NOT_YET_COVERED,
  worldOf,
} from "./phases.js";

// Mutations run against the same world a real answer is judged in: registry,
// Accord pack, trainer scope and commit time — no private back door. Each
// phase declares which certified world it needs; the runner supplies it.
const worlds: Record<CrucibleWorldId, CrucibleWorld> = { standard: manifestContext(), center: centerContext() };
const KNOWN_ARTICLES = new Set<string>(ACCORD_ARTICLES.map((entry) => entry.id));

const everyMutation = ALL_MUTATIONS.map((mutation) => [mutation.id, mutation] as const);
const everyControl = ALL_CONTROLS.map((control) => [control.id, control] as const);
const everyPhase = CRUCIBLE_PHASES.map((phase) => [`phase ${phase.phase}`, phase] as const);

describe("every mutation is denied under the exact denial it declares", () => {
  it.each(everyMutation)("%s", (_id, mutation) => {
    const verdict = mutation.run(worlds[worldOf(mutation)]);

    expect(verdict.allowed, `${mutation.id} was allowed through`).toBe(false);
    // The declared denial, not merely *a* denial: a mutation refused for an
    // unrelated reason is a finding about the crucible, not a passing test.
    expect(verdict.violations.map(denialCode), `${mutation.id} expected ${expectedDenial(mutation)}`).toContain(
      expectedDenial(mutation),
    );
    for (const item of verdict.violations) {
      expect(KNOWN_ARTICLES.has(item.article), `${mutation.id} cites unknown article ${item.article}`).toBe(true);
      expect(item.rule, `${mutation.id} produced an unnamed denial`).not.toBe("");
      expect(item.message, `${mutation.id} produced a denial with no message`).not.toBe("");
    }
  });

  it("declares only articles that exist in the registry", () => {
    for (const mutation of ALL_MUTATIONS) {
      expect(KNOWN_ARTICLES.has(mutation.article), `${mutation.id} declares ${mutation.article}`).toBe(true);
    }
  });
});

describe("every control is allowed, with nothing denied at all", () => {
  it.each(everyControl)("%s", (_id, control) => {
    expect(control.run(worlds[worldOf(control)])).toEqual({ allowed: true, violations: [] });
  });

  it.each(everyPhase)("%s carries both kinds of control", (_label, phase) => {
    // Both, because they catch different lies. Without a clean path a kernel
    // that denies everything passes; without a no-op sabotage a harness that
    // denies everything passes.
    for (const kind of ["clean-path", "no-op-sabotage"] as const) {
      const owned = phase.controls.filter((control) => control.kind === kind);
      expect(owned.length, `phase ${phase.phase} has no ${kind} control`).toBeGreaterThan(0);
    }
  });
});

describe("article coverage", () => {
  const covered = coveredArticles();

  it("gives every Accord article either a mutation or a named future phase", () => {
    const uncounted = ACCORD_ARTICLES.map((entry) => entry.id).filter(
      (id) => !covered.has(id) && NOT_YET_COVERED[id] === undefined,
    );
    expect(
      uncounted,
      `no mutation denies ${uncounted.join(", ")}, and no phase claims to be about to`,
    ).toEqual([]);
  });

  it("does not list an article as pending once a mutation denies it", () => {
    // Shrinking NOT_YET_COVERED is how a phase is finished. Leaving an entry
    // behind would let a later phase inherit a gap that no longer exists and
    // hide a real one behind it.
    const stale = Object.keys(NOT_YET_COVERED).filter((id) => covered.has(id as ArticleId));
    expect(stale, `${stale.join(", ")} is covered but still listed as pending`).toEqual([]);
  });

  it("only lists real articles as pending, against phases that have not landed", () => {
    const landed = Math.max(...CRUCIBLE_PHASES.map((phase) => phase.phase));
    for (const [id, phase] of Object.entries(NOT_YET_COVERED)) {
      expect(KNOWN_ARTICLES.has(id), `${id} is not an Accord article`).toBe(true);
      // A landed phase that still owes an article is exactly the state this
      // gate exists to make impossible to tick.
      expect(phase, `${id} is owed by phase ${phase}, which has already landed`).toBeGreaterThan(landed);
    }
  });

  it.each(everyPhase)("%s covers exactly the articles it claims", (_label, phase) => {
    const actual = [...new Set(phase.mutations.map((mutation) => mutation.article))].sort();
    expect(actual).toEqual([...phase.articles].sort());
  });

  it.each(everyPhase)("%s gives every article it claims at least one mutation", (_label, phase) => {
    for (const article of phase.articles) {
      const owned = phase.mutations.filter((mutation) => mutation.article === article);
      expect(owned.length, `${article} has no mutation in phase ${phase.phase}`).toBeGreaterThan(0);
    }
  });
});

describe("the README publishes what the crucible actually covers", () => {
  // Same discipline as the article registry against the Accord document: a
  // hand-written table is a claim, and an unpinned claim goes stale the first
  // time a phase lands. Rows are compared verbatim, so the README's formatting
  // is part of the contract.
  const readme = readFileSync(resolve(import.meta.dirname, "../../README.md"), "utf8");

  function expectedRow(entry: AccordArticle): string {
    const mutations = ALL_MUTATIONS.filter((mutation) => mutation.article === entry.id).length;
    const owed = NOT_YET_COVERED[entry.id as ArticleId];
    const cell = mutations > 0 ? String(mutations) : `— phase ${owed}`;
    return `| ${entry.id} | ${entry.title} | ${cell} |`;
  }

  it.each(ACCORD_ARTICLES.map((entry) => [entry.id, entry] as const))("%s", (_id, entry) => {
    expect(readme, `README is missing or wrong for ${entry.id}`).toContain(expectedRow(entry));
  });

  it("publishes no coverage percentage", () => {
    // A deliberate non-goal. Enforcement is reported as hard zeros and
    // usefulness empirically per model; a hygiene figure blended into either
    // muddies the distinction the project exists to draw.
    const table = readme.slice(readme.indexOf("## How it is verified"));
    expect(table, "a coverage percentage has appeared in the README").not.toMatch(/\d+(\.\d+)?\s*%/);
  });
});

describe("the crucible's own bookkeeping", () => {
  it("has a unique id for every mutation and control", () => {
    const ids = [...ALL_MUTATIONS, ...ALL_CONTROLS].map((entry) => entry.id);
    expect(new Set(ids).size, `duplicate ids among ${ids.join(", ")}`).toBe(ids.length);
  });

  it.each(everyPhase)("%s tests a distinct denial with each mutation", (_label, phase) => {
    // Two mutations denied identically prove one thing twice; the second is
    // coverage on paper only.
    const denials = phase.mutations.map(expectedDenial);
    expect(new Set(denials).size, `repeated denials in phase ${phase.phase}`).toBe(denials.length);
  });

  it("has at least one mutation and one phase", () => {
    // A crucible that ran nothing would satisfy every assertion above.
    expect(CRUCIBLE_PHASES.length).toBeGreaterThan(0);
    expect(ALL_MUTATIONS.length).toBeGreaterThan(0);
  });
});
