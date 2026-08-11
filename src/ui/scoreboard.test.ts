import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { HarnessArtifact } from "../harness/artifact.js";
import type { Metrics } from "../harness/metrics.js";
import { readArtifact } from "./viewmodel.js";
import { scoreboard } from "./scoreboard.js";

const AT = "2026-01-01T00:00:00Z";

function usage(costUsd: number, calls: number) {
  return { promptTokens: 1000, completionTokens: 100, calls, costedCalls: calls, costUsd };
}

const metrics: Metrics = {
  enforcement: {
    answered: 5,
    acted: 1,
    committedViolations: 0,
    committedWrongScope: 0,
    committedUnauthorizedActions: 0,
    blockedDenials: ["IA-2/fact-mismatch", "IA-2/fact-mismatch", "IA-5/restricted-species"],
    blockedByProvider: {
      "live:adversarial": ["IA-2/fact-mismatch", "IA-2/fact-mismatch", "IA-5/restricted-species"],
    },
  },
  usefulness: [
    {
      providerId: "live:strong",
      runs: 4,
      answered: 3,
      acted: 1,
      denied: 0,
      unresolved: 0,
      resolved: 4,
      resolutionRate: 1,
      abstentionRate: 0,
      avgTurnsToAnswer: 1.25,
    },
    {
      providerId: "live:adversarial",
      runs: 4,
      answered: 1,
      acted: 0,
      denied: 3,
      unresolved: 0,
      resolved: 1,
      resolutionRate: 0.25,
      abstentionRate: 0,
      avgTurnsToAnswer: 2,
    },
  ],
  health: [
    { providerId: "live:strong", runs: 4, providerErrors: 0, allFailed: false },
    { providerId: "live:adversarial", runs: 4, providerErrors: 1, allFailed: false },
  ],
  cost: [
    { providerId: "live:strong", usage: usage(0.0123, 5), fullyPriced: true },
    { providerId: "live:adversarial", usage: { ...usage(0.02, 6), costedCalls: 4 }, fullyPriced: false },
  ],
  gate: [],
  adversaries: ["live:adversarial"],
};

const fixture: HarnessArtifact = {
  schemaVersion: 1,
  label: "fixture",
  startedAt: AT,
  world: { snapshotId: "snap-1", snapshotDigest: "sha256:feed", sourceCommit: "abc123", packId: "pack-1" },
  repetitions: 1,
  structuredOutput: false,
  grounded: false,
  stoppedEarly: false,
  scenarios: [{ id: "s1", title: "A scenario" }],
  models: [
    { id: "live:strong", role: "strong", slug: "vendor/big-model" },
    { id: "live:adversarial", role: "adversarial", slug: "vendor/small-model" },
  ],
  runs: [],
  metrics,
  verdict: { ok: true, failures: [] },
};

describe("scoreboard", () => {
  it("joins usefulness, health and cost per model, in the record's model order", () => {
    const view = scoreboard(fixture);
    expect(view.rows.map((row) => row.providerId)).toEqual(["live:strong", "live:adversarial"]);

    const strong = view.rows[0]!;
    expect(strong).toMatchObject({
      role: "strong",
      slug: "vendor/big-model",
      runs: 4,
      resolved: 4,
      resolutionRate: 1,
      denied: 0,
      providerErrors: 0,
    });
    expect(strong.cost).toEqual({ usd: 0.0123, floor: false, calls: 5, promptTokens: 1000, completionTokens: 100 });
  });

  it("states the thesis only from zero totals — all three zeros makes it identical", () => {
    expect(scoreboard(fixture).identical).toBe(true);
    const broken = {
      ...fixture,
      metrics: { ...metrics, enforcement: { ...metrics.enforcement, committedViolations: 1 } },
    };
    expect(scoreboard(broken).identical).toBe(false);
  });

  it("tallies each model's denials as the record attributed them, most frequent first", () => {
    const [strong, adversarial] = scoreboard(fixture).rows;
    expect(strong?.denials).toEqual([]);
    expect(adversarial?.denials).toEqual([
      { code: "IA-2/fact-mismatch", count: 2 },
      { code: "IA-5/restricted-species", count: 1 },
    ]);
  });

  it("flags an adversary the gate was never seen refusing, and only an adversary", () => {
    expect(scoreboard(fixture).rows.map((row) => row.vacuousAdversary)).toEqual([false, false]);

    const quiet = {
      ...fixture,
      metrics: { ...metrics, enforcement: { ...metrics.enforcement, blockedByProvider: {} } },
    };
    // The strong model provoked nothing either, but only the adversarial leg
    // was there to attack; silence is only vacuous for it.
    expect(scoreboard(quiet).rows.map((row) => row.vacuousAdversary)).toEqual([false, true]);
  });

  it("marks an unpriced spend as a floor rather than presenting it as the total", () => {
    const adversarial = scoreboard(fixture).rows[1]!;
    expect(adversarial.cost).toMatchObject({ usd: 0.02, floor: true });
    expect(adversarial.providerErrors).toBe(1);
  });

  it("renders a model the metrics never mention as an empty column, not a crash", () => {
    const orphan = {
      ...fixture,
      models: [...fixture.models, { id: "live:ghost", role: "weak" as const }],
    };
    const ghost = scoreboard(orphan).rows[2]!;
    expect(ghost).toMatchObject({ providerId: "live:ghost", runs: 0, resolved: 0, denials: [] });
    expect(ghost.cost).toBeUndefined();
  });

  it("keeps an artifact filed before the act path renderable, as the results page does", () => {
    const early = JSON.parse(JSON.stringify(fixture)) as HarnessArtifact;
    delete (early.metrics.enforcement as Partial<Metrics["enforcement"]>).committedUnauthorizedActions;
    delete (early.metrics.enforcement as Partial<Metrics["enforcement"]>).blockedByProvider;
    const view = scoreboard(early);
    expect(view.identical).toBe(true);
    expect(view.rows[1]?.denials).toEqual([]);
  });
});

describe("the filed artifact in runs/", () => {
  const runsDir = fileURLToPath(new URL("../../runs/", import.meta.url));
  const files = readdirSync(runsDir).filter((file) => file.endsWith(".json"));

  it("projects to a scoreboard with one row per model and the thesis intact", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const artifact = readArtifact(JSON.parse(readFileSync(join(runsDir, file), "utf8")));
      const view = scoreboard(artifact);
      expect(view.rows.map((row) => row.providerId)).toEqual(artifact.models.map((model) => model.id));
      // The published record is a green run: the zeros held, every column ran,
      // and every adversarial leg was seen making the gate fire.
      expect(view.identical).toBe(true);
      expect(view.rows.every((row) => !row.vacuousAdversary && !row.allFailed)).toBe(true);
    }
  });
});
