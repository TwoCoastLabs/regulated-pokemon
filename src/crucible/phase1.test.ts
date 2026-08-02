/**
 * Phase 1 crucible: every mutation denied by name, and a clean path that
 * passes with nothing denied at all.
 *
 * The control matters as much as the mutations. A kernel that refuses
 * everything is trivially safe and useless, so fail-closed theater is itself
 * a failure mode this suite is built to catch.
 */

import { describe, expect, it } from "vitest";

import { ACCORD_ARTICLES } from "../kernel/accord.js";
import { readRegistry } from "../kernel/registry.js";
import { buildRoster, verifyRoster } from "../kernel/roster.js";
import { denialCode } from "../kernel/violation.js";
import { kantoRegistry, SNAPSHOT_PATH } from "../testing/fixtures.js";
import { expectedDenial, PHASE_1_ARTICLES, PHASE_1_CONTROL, PHASE_1_MUTATIONS } from "./mutations.js";

const registry = kantoRegistry();

describe("every mutation is denied by its named article", () => {
  it.each(PHASE_1_MUTATIONS.map((mutation) => [mutation.id, mutation] as const))(
    "%s",
    (_id, mutation) => {
      const verdict = mutation.run(registry);
      expect(verdict.allowed, `${mutation.id} was allowed through`).toBe(false);
      expect(verdict.violations.map(denialCode)).toContain(expectedDenial(mutation));
    },
  );

  it("names articles that actually exist in the registry", () => {
    const known = new Set(ACCORD_ARTICLES.map((entry) => entry.id));
    for (const mutation of PHASE_1_MUTATIONS) {
      expect(known.has(mutation.article), `${mutation.id} cites ${mutation.article}`).toBe(true);
    }
  });

  it("covers exactly the articles this phase claims, no more and no fewer", () => {
    // Pinned so the epic's checkboxes cannot drift ahead of the crucible:
    // extending coverage means extending this list deliberately.
    const covered = [...new Set(PHASE_1_MUTATIONS.map((mutation) => mutation.article))].sort();
    expect(covered).toEqual([...PHASE_1_ARTICLES].sort());
  });

  it("gives every article in this phase at least one mutation", () => {
    for (const article of PHASE_1_ARTICLES) {
      const owned = PHASE_1_MUTATIONS.filter((mutation) => mutation.article === article);
      expect(owned.length, `${article} has no mutation`).toBeGreaterThan(0);
    }
  });

  it("has unique ids and distinct denials", () => {
    const ids = PHASE_1_MUTATIONS.map((mutation) => mutation.id);
    expect(new Set(ids).size).toBe(ids.length);
    const denials = PHASE_1_MUTATIONS.map(expectedDenial);
    expect(new Set(denials).size).toBe(denials.length);
  });
});

describe("the clean path is allowed, with nothing denied", () => {
  it("passes the identical harness when the sabotage is removed", () => {
    // Guards against the crucible's own failure mode: a harness that denies
    // everything would make all ten mutations above pass for free.
    expect(PHASE_1_CONTROL.run(registry)).toEqual({ allowed: true, violations: [] });
  });

  it("loads the vendored snapshot without a single violation", () => {
    expect(() => readRegistry(SNAPSHOT_PATH)).not.toThrow();
  });

  it("certifies and verifies a roster end to end", () => {
    const built = buildRoster(registry, "electric-kanto", { all: [{ kind: "has-type", type: "electric" }] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(verifyRoster(registry, built.value)).toEqual({ allowed: true, violations: [] });
    expect(built.value.cardinality).toBe(9);
  });

  it("resolves a fact of every certified kind without refusing", () => {
    for (const [entityId, factId] of [
      ["pikachu", "base-speed"],
      ["pikachu", "types"],
      ["mew", "is-mythical"],
      ["self-destruct", "move-power"],
      ["growl", "move-power"],
    ] as const) {
      expect(registry.resolve(entityId, factId).ok, `${entityId}/${factId} was refused`).toBe(true);
    }
  });

  it("verifies every certified roster shape the phase supports", () => {
    for (const criteria of [
      { all: [] },
      { all: [{ kind: "learns-move", move: "self-destruct" }] },
      { all: [{ kind: "rarity", rarity: "legendary" }] },
      { all: [{ kind: "stat-at-least", stat: "speed", value: 120 }] },
      { all: [{ kind: "stat-at-most", stat: "hp", value: 30 }] },
    ] as const) {
      const built = buildRoster(registry, "control", criteria);
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      expect(verifyRoster(registry, built.value).violations).toEqual([]);
    }
  });
});
