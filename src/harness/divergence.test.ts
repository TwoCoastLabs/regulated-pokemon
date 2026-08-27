/**
 * The divergence probe reads filed artifacts, so its numbers over the two
 * committed raw-arm artifacts are pinned here — the free re-measurement the
 * epic promises (#94 slice 2, absorbing #87 slice 4). A change to the
 * decoder, the registry, or the pairing that moves the published rate has to
 * move this file in the same change.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { divergence, type DivergenceInput, renderDivergence } from "./divergence.js";

const { registry } = demoWorld();

function artifact(name: string): DivergenceInput {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "../../runs", name), "utf8")) as DivergenceInput;
}

describe("pairing and comparison", () => {
  const governedRun = (providerId: string, scenarioId: string, claims: object[], rosterMembers: string[] = []) => ({
    providerId,
    scenarioId,
    repetition: 0,
    transaction: {
      manifest: {
        claims,
        rosters: rosterMembers.length === 0 ? [] : [{ id: "r", memberIds: rosterMembers }],
      },
    },
  });

  it("pairs a raw run to the governed run of the same provider, never another arm's", () => {
    const input = {
      runs: [
        // The weak arm reached no certificate; the strong arm did. A raw weak
        // answer must pair with nothing rather than with the strong certificate.
        { providerId: "live:weak", scenarioId: "s", repetition: 0 },
        governedRun("live:strong", "s", [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }]),
      ],
      raw: {
        runs: [
          {
            providerId: "live:weak",
            scenarioId: "s",
            repetition: 0,
            claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 1 } }],
          },
        ],
      },
    } as unknown as DivergenceInput;
    const report = divergence(registry, input);
    expect(report.scenarios).toBe(0);
    expect(report.comparable).toBe(0);
  });

  it("counts an agreement, a divergence, a raw-only entity and a name-only claim, each where it belongs", () => {
    const speed = registry.resolve("pikachu", "base-speed");
    if (!speed.ok || speed.value.kind !== "number") throw new Error("fixture fact should resolve");
    const input = {
      runs: [
        governedRun("p", "s", [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }], ["voltorb"]),
      ],
      raw: {
        runs: [
          {
            providerId: "p",
            scenarioId: "s",
            repetition: 0,
            claims: [
              // Agreement — and spelled the way a model spells it, so the fold is in the loop.
              { kind: "fact", entityId: "Pikachu", factId: "base-speed", asserted: { kind: "number", value: speed.value.value } },
              // Divergence on a roster member the certificate displays.
              { kind: "fact", entityId: "voltorb", factId: "base-speed", asserted: { kind: "number", value: 1 } },
              // An entity the certificate never mentioned.
              { kind: "fact", entityId: "snorlax", factId: "base-hp", asserted: { kind: "number", value: 160 } },
              // A name-only claim carries nothing to compare.
              { kind: "fact", entityId: "pikachu", factId: "base-attack" },
            ],
          },
        ],
      },
    } as unknown as DivergenceInput;
    const report = divergence(registry, input);
    expect(report.scenarios).toBe(1);
    expect(report.comparable).toBe(2);
    expect(report.agreements).toBe(1);
    expect(report.divergences.map((point) => point.entityId)).toEqual(["voltorb"]);
    expect(report.rawOnly).toBe(1);
    expect(report.nameOnly).toBe(1);
  });

  it("renders from the data, with and without divergences", () => {
    const empty = divergence(registry, { runs: [], raw: { runs: [] } });
    expect(renderDivergence(empty, "test")).toContain("**—** — a floor");
    expect(renderDivergence(empty, "test")).not.toContain("Divergences, named:");
  });
});

describe("the filed artifacts, pinned (findings iteration 32)", () => {
  it("N=1 artifact: 2/19 comparable facts diverge", () => {
    const report = divergence(registry, artifact("2026-08-12T09-22-46-379Z-live.json"));
    expect(report.scenarios).toBe(15);
    expect(report.comparable).toBe(19);
    expect(report.agreements).toBe(17);
    expect(report.divergences.length).toBe(2);
    expect(report.rawOnly).toBe(0);
    expect(report.nameOnly).toBe(0);
  });

  it("N=3 artifact: 4/53 comparable facts diverge, and the points are the two known values", () => {
    const report = divergence(registry, artifact("2026-08-12T09-31-19-377Z-live.json"));
    expect(report.scenarios).toBe(44);
    expect(report.comparable).toBe(53);
    expect(report.agreements).toBe(49);
    expect(report.divergences.map((point) => `${point.entityId}/${point.factId}: ${point.asserted} vs ${point.certified}`).sort()).toEqual([
      "electrode/base-speed: 140 vs 150",
      "electrode/base-speed: 140 vs 150",
      "electrode/base-speed: 140 vs 150",
      "thunderbolt/move-power: 90 vs 95",
    ]);
  });

  it("the adversarial arm contributes nothing — its governed leg released no certificate to diverge from", () => {
    const art = artifact("2026-08-12T09-31-19-377Z-live.json");
    const adversarial = {
      runs: art.runs.filter((run) => run.providerId === "live:adversarial"),
      raw: { runs: art.raw?.runs.filter((run) => run.providerId === "live:adversarial") ?? [] },
    };
    const report = divergence(registry, adversarial);
    expect(report.scenarios).toBe(0);
  });
});
