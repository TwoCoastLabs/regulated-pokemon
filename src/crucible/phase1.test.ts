/**
 * Phase 1 clean path: the certified registry doing its actual job.
 *
 * The generic assertions — every mutation denied by its declared article and
 * rule, every control allowed, every Accord article accounted for — belong to
 * the harness and live in crucible.test.ts. What is left here is what only
 * phase 1 can say: that this snapshot loads, that these facts resolve, and
 * that these rosters certify to these counts.
 */

import { describe, expect, it } from "vitest";

import { readRegistry } from "../kernel/registry.js";
import { buildRoster, verifyRoster } from "../kernel/roster.js";
import { kantoRegistry, SNAPSHOT_PATH } from "../testing/fixtures.js";

const registry = kantoRegistry();

describe("the certified registry serves facts it can stand behind", () => {
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
