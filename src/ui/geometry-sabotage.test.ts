/**
 * The geometry menu, built in the browser the way the crucible page builds it —
 * the vendored bytes loaded, the clean conversation played for its grant, the
 * honest answer rendered — and then read the way a real layout would be. No
 * browser here: `attestGeometry`'s pixel behaviour is proven in
 * browser-affidavit.test.ts, so this checks the scene the page hands it and the
 * projection it hands back.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PACK_PATH, SNAPSHOT_PATH } from "../demo/files.js";
import { loadDemoWorld, sabotageWorld } from "../demo/script.js";
import type { Box, Geometry, VisualStyle } from "./browser-affidavit.js";
import {
  GEOMETRY_SABOTAGES,
  GEOMETRY_TARGET,
  geometryOutcome,
  geometryScene,
} from "./geometry-sabotage.js";

const world = sabotageWorld(
  loadDemoWorld(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")), JSON.parse(readFileSync(PACK_PATH, "utf8"))),
);

const scene = geometryScene(world);

/** A scripted layout for the scene: every visible unit and disclosure block
 * given an honest box and legible style, so the clean scene attests clean. */
function honestLayout(): Geometry {
  const viewport: Box = { x: 0, y: 0, width: 1000, height: 4000 };
  const boxes = new Map<string, Box>();
  const styles = new Map<string, VisualStyle>();
  let y = 0;
  for (const unit of scene.walk.units) {
    if (!unit.visible) continue;
    boxes.set(unit.path.join("."), { x: 10, y, width: 400, height: 80 });
    y += 40; // nested and overlapping, as the renderer lays them out
  }
  for (const block of scene.walk.attributed) {
    if (block.kind !== "block" || !block.visible) continue;
    boxes.set(block.path.join("."), { x: 14, y: 4, width: 390, height: 40 });
    styles.set(block.path.join("."), { fontSizePx: 14, opacity: 1 });
  }
  return {
    viewport,
    box: (path) => boxes.get(path.join(".")),
    style: (path) => styles.get(path.join(".")),
    occluderAt: () => undefined,
  };
}

describe("the scene the crucible page hands the affidavit", () => {
  it("renders the honest answer, with the warning that the attacks target", () => {
    const warning = scene.walk.units.find((unit) => unit.id === GEOMETRY_TARGET);
    expect(warning?.visible).toBe(true);
  });

  it("knows which unit the warning discloses, so proximity has an anchor", () => {
    expect(scene.discloses.get(GEOMETRY_TARGET)).toBeDefined();
  });

  it("carries the pack's live floors, not an invented set", () => {
    expect(scene.policy).toEqual(world.pack.presentation.display);
  });

  it("attests clean under an honest layout — the denials on the page are earned", () => {
    const outcome = geometryOutcome(scene, honestLayout(), GEOMETRY_SABOTAGES[0]!);
    expect(outcome.allowed).toBe(true);
    expect(outcome.violations).toEqual([]);
  });
});

describe("the menu is honest about what it will do", () => {
  it("targets a unit that is actually on the certified page", () => {
    const shown = new Set(scene.walk.units.filter((unit) => unit.visible).map((unit) => unit.id));
    for (const card of GEOMETRY_SABOTAGES) {
      expect(shown.has(card.target), `${card.id} targets ${card.target}`).toBe(true);
    }
  });

  it("promises only geometry denials the affidavit can actually raise", () => {
    const raisable = new Set([
      "IA-6/insufficient-prominence",
      "IA-6/rendered-offscreen",
      "IA-6/rendered-zero-area",
      "IA-6/insufficient-proximity",
      "IA-6/occluded",
    ]);
    for (const card of GEOMETRY_SABOTAGES) {
      expect(raisable.has(card.expectedDenial), `${card.id} promises ${card.expectedDenial}`).toBe(true);
    }
  });
});

describe("the projection the console reads back", () => {
  it("marks a run denied-as-declared when the promised denial lands, and keeps the structural contrast", () => {
    // A layout that shrinks the warning's block below the floor, everything
    // else honest — the shrink-to-4px card's promised failure.
    const base = honestLayout();
    const card = GEOMETRY_SABOTAGES.find((entry) => entry.id === "shrink-to-4px")!;
    const blockPath = scene.walk.attributed.find((entry) => entry.kind === "block" && entry.visible)!.path.join(".");
    const hostile: Geometry = {
      viewport: base.viewport,
      box: base.box,
      style: (path) => (path.join(".") === blockPath ? { fontSizePx: 4, opacity: 1 } : base.style(path)),
      occluderAt: base.occluderAt,
    };
    const outcome = geometryOutcome(scene, hostile, card);
    expect(outcome.allowed).toBe(false);
    expect(outcome.deniedAsDeclared).toBe(true);
    // The whole point of the section: the structural walk still clears it.
    expect(outcome.structurallyVisible).toBe(true);
  });
});
