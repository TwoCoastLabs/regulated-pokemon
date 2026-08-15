/**
 * The geometry layer, tested the way the mounting adapter is: against an
 * injected reading rather than a real browser, so the four-pixel warning is
 * denied in CI with no layout engine in the loop. Every case builds a genuine
 * artifact, walks it with the same `walkArtifact` the kernel uses, and then
 * hands `attestGeometry` a scripted layout — the seam a real browser fills with
 * `getBoundingClientRect` and `getComputedStyle`.
 *
 * The through-line is the module's own promise: it *tightens* the structural
 * verdict and never contradicts it. A page the structural walk clears, with an
 * honest layout, is cleared here too; every denial it adds is a fault the
 * structural walk was blind to by design.
 */

import { describe, expect, it } from "vitest";

import {
  BLOCK_ATTRIBUTE,
  COPY_ATTRIBUTE,
  type DomElement,
  element,
  LOCALE_ATTRIBUTE,
  SLOT_ATTRIBUTE,
  text,
  TRANSACTION_ATTRIBUTE,
  UNIT_ATTRIBUTE,
  walkArtifact,
} from "../kernel/dom.js";
import { denialCode } from "../kernel/violation.js";
import type { DisplayPolicy } from "../kernel/pack.js";
import { attestGeometry, type Box, type Geometry, type VisualStyle } from "./browser-affidavit.js";

/** The shipped pack's floors, as a literal so the test says what it means. */
const POLICY: DisplayPolicy = { minLegiblePx: 12, minLegibleOpacity: 0.5, maxProximityPx: 320 };

const VIEWPORT: Box = { x: 0, y: 0, width: 1000, height: 800 };

/**
 * A recommendation with the release warning nested beside it — the shape the
 * reference renderer emits for a triggered disclosure. `hideWarning` lets a
 * case make the warning structurally hidden (an inline `display:none`), so the
 * structural walk denies it upstream and the geometry layer must stay quiet.
 */
function page(hideWarning = false): DomElement {
  return element("article", { [TRANSACTION_ATTRIBUTE]: "tx-1", [LOCALE_ATTRIBUTE]: "en-US" }, [
    element("section", { [UNIT_ATTRIBUTE]: "rec" }, [
      element("p", {}, [
        element("span", { [COPY_ATTRIBUTE]: "lead-in.recommendation" }, [text("We recommend")]),
        element("span", { [SLOT_ATTRIBUTE]: "entity" }, [text("Pikachu")]),
      ]),
    ]),
    element("aside", { [UNIT_ATTRIBUTE]: "warn", ...(hideWarning ? { style: "display:none" } : {}) }, [
      element("p", { [BLOCK_ATTRIBUTE]: "release-warning" }, [text("Releasing a Pokémon is forever.")]),
    ]),
  ]);
}

const DISCLOSES = new Map([["warn", "rec"]]);

/** Where each measured element sits, by the path the walk assigned it. */
function paths(artifact: DomElement) {
  const walk = walkArtifact(artifact);
  const unit = (id: string) => walk.units.find((entry) => entry.id === id)?.path.join(".") ?? `no-unit-${id}`;
  const block = (name: string) =>
    walk.attributed.find((entry) => entry.kind === "block" && entry.name === name)?.path.join(".") ?? `no-block-${name}`;
  return { walk, rec: unit("rec"), warn: unit("warn"), block: block("release-warning") };
}

/** A scripted layout: boxes and styles keyed by path, the viewport fixed, and
 * an optional map of paths that have something painted over them. */
function geometry(
  boxes: Record<string, Box>,
  styles: Record<string, VisualStyle>,
  occluders: Record<string, string> = {},
): Geometry {
  return {
    viewport: VIEWPORT,
    box: (path) => boxes[path.join(".")],
    style: (path) => styles[path.join(".")],
    occluderAt: (path) => occluders[path.join(".")],
  };
}

/** A clean layout for {@link page}: everything on-screen, legible, adjacent. */
function cleanLayout(artifact: DomElement) {
  const { rec, warn, block } = paths(artifact);
  const boxes: Record<string, Box> = {
    [rec]: { x: 10, y: 10, width: 400, height: 100 },
    [warn]: { x: 10, y: 120, width: 400, height: 60 },
    [block]: { x: 14, y: 124, width: 390, height: 44 },
  };
  const styles: Record<string, VisualStyle> = {
    [block]: { fontSizePx: 14, opacity: 1 },
  };
  return { rec, warn, block, boxes, styles };
}

function codes(artifact: DomElement, geo: Geometry): string[] {
  const walk = walkArtifact(artifact);
  const verdict = attestGeometry(walk, geo, POLICY, DISCLOSES);
  return verdict.violations.map(denialCode);
}

describe("a certified page, laid out honestly, is cleared", () => {
  it("adds no denial to a page the structural walk already passes", () => {
    const artifact = page();
    const { boxes, styles } = cleanLayout(artifact);
    const verdict = attestGeometry(walkArtifact(artifact), geometry(boxes, styles), POLICY, DISCLOSES);
    expect(verdict.allowed).toBe(true);
    expect(verdict.violations).toEqual([]);
  });
});

describe("prominence: text too small or too faint to read is denied", () => {
  it("denies the warning shrunk to four pixels, and names the size", () => {
    const artifact = page();
    const { block, boxes, styles } = cleanLayout(artifact);
    styles[block] = { fontSizePx: 4, opacity: 1 };
    const verdict = attestGeometry(walkArtifact(artifact), geometry(boxes, styles), POLICY, DISCLOSES);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map(denialCode)).toContain("IA-6/insufficient-prominence");
    const shrunk = verdict.violations.find((v) => v.rule === "insufficient-prominence");
    expect(shrunk?.actual).toContain("4px");
    expect(shrunk?.expected).toContain("12px");
  });

  it("denies a warning faded below the opacity floor", () => {
    const artifact = page();
    const { block, boxes, styles } = cleanLayout(artifact);
    styles[block] = { fontSizePx: 14, opacity: 0.05 };
    expect(codes(artifact, geometry(boxes, styles))).toContain("IA-6/insufficient-prominence");
  });

  it("clears text exactly at the floor — the floor is a floor, not a fence", () => {
    const artifact = page();
    const { block, boxes, styles } = cleanLayout(artifact);
    styles[block] = { fontSizePx: POLICY.minLegiblePx, opacity: POLICY.minLegibleOpacity };
    expect(codes(artifact, geometry(boxes, styles))).toEqual([]);
  });
});

describe("placement: a unit off the screen or collapsed to nothing is denied", () => {
  it("denies a warning positioned beyond the viewport", () => {
    const artifact = page();
    const { warn, boxes, styles } = cleanLayout(artifact);
    boxes[warn] = { x: -9999, y: 120, width: 400, height: 60 };
    const found = codes(artifact, geometry(boxes, styles));
    expect(found).toContain("IA-6/rendered-offscreen");
    expect(found).not.toContain("IA-6/rendered-zero-area");
  });

  it("denies a warning collapsed to no size, by its truer name", () => {
    const artifact = page();
    const { warn, boxes, styles } = cleanLayout(artifact);
    boxes[warn] = { x: 10, y: 120, width: 0, height: 0 };
    const found = codes(artifact, geometry(boxes, styles));
    expect(found).toContain("IA-6/rendered-zero-area");
    // Collapsed is more specific than off-screen; only one name is reported.
    expect(found).not.toContain("IA-6/rendered-offscreen");
  });

  it("denies a disclosure block collapsed inside an otherwise-visible unit", () => {
    // The unit is on the screen at full size; the block carrying the mandatory
    // text is the thing collapsed to nothing, so the fault is the block's.
    const artifact = page();
    const { block, boxes, styles } = cleanLayout(artifact);
    boxes[block] = { x: 14, y: 124, width: 0, height: 0 };
    expect(codes(artifact, geometry(boxes, styles))).toContain("IA-6/rendered-zero-area");
  });
});

describe("occlusion: a disclosure painted over by something is denied", () => {
  it("denies a warning with a foreign element covering its centre, and names it", () => {
    const artifact = page();
    const { block, boxes, styles } = cleanLayout(artifact);
    const found = attestGeometry(
      walkArtifact(artifact),
      geometry(boxes, styles, { [block]: "<div class=\"overlay\">" }),
      POLICY,
      DISCLOSES,
    );
    expect(found.allowed).toBe(false);
    const covered = found.violations.find((v) => v.rule === "occluded");
    expect(covered).toBeDefined();
    expect(covered?.actual).toContain("overlay");
  });

  it("clears a warning whose own text is the topmost thing at its centre", () => {
    // occluderAt returns undefined when the element or a descendant is on top.
    const artifact = page();
    const { boxes, styles } = cleanLayout(artifact);
    expect(codes(artifact, geometry(boxes, styles, {}))).toEqual([]);
  });

  it("does not ask about occlusion for a block that is not on the screen", () => {
    // A collapsed block is denied for its size; "what is painted over a box
    // with no area?" is not a question, so occlusion is not also reported.
    const artifact = page();
    const { block, boxes, styles } = cleanLayout(artifact);
    boxes[block] = { x: 14, y: 124, width: 0, height: 0 };
    const found = codes(artifact, geometry(boxes, styles, { [block]: "<div class=\"overlay\">" }));
    expect(found).toContain("IA-6/rendered-zero-area");
    expect(found).not.toContain("IA-6/occluded");
  });

  it("does not cry occlusion about a block whose own unit is collapsed", () => {
    // The unit is 0×0 and denied for it; the block keeps a real box, so its
    // centre resolves to some unrelated element the browser paints there. That
    // is the unit's fault, not a foreign overlay — occlusion must stay silent.
    const artifact = page();
    const { warn, block, boxes, styles } = cleanLayout(artifact);
    boxes[warn] = { x: 10, y: 120, width: 0, height: 0 };
    const found = codes(artifact, geometry(boxes, styles, { [block]: "<p class=\"unrelated\">" }));
    expect(found).toContain("IA-6/rendered-zero-area");
    expect(found).not.toContain("IA-6/occluded");
  });
});

describe("proximity: a disclosure a screen away from its claim is denied", () => {
  it("denies a warning laid out far below what it discloses", () => {
    const artifact = page();
    const { warn, block, boxes, styles } = cleanLayout(artifact);
    // Both on-screen, but the warning sits 600px below the recommendation —
    // adjacent in the markup, a scroll away in the layout.
    boxes[warn] = { x: 10, y: 720, width: 400, height: 60 };
    boxes[block] = { x: 14, y: 724, width: 390, height: 44 };
    const found = codes(artifact, geometry(boxes, styles));
    expect(found).toContain("IA-6/insufficient-proximity");
    // Far is not the same fault as off-screen: the warning is fully on screen.
    expect(found).not.toContain("IA-6/rendered-offscreen");
  });

  it("clears a warning nested inside the box of its anchor — zero gap", () => {
    const artifact = page();
    const { rec, warn, boxes, styles } = cleanLayout(artifact);
    boxes[rec] = { x: 10, y: 10, width: 400, height: 300 };
    boxes[warn] = { x: 20, y: 200, width: 380, height: 80 }; // inside rec
    expect(codes(artifact, geometry(boxes, styles))).toEqual([]);
  });
});

describe("the layer tightens the structural verdict and never contradicts it", () => {
  it("stays silent about a unit the structural walk already found hidden", () => {
    // The warning is `display:none` in the markup, so `walkArtifact` marks it
    // not-visible and the structural verifier denies it. The geometry layer
    // must not measure it, must not report it a second time, and must not
    // demand a box for a unit that has none.
    const artifact = page(true);
    const walk = walkArtifact(artifact);
    expect(walk.units.find((u) => u.id === "warn")?.visible).toBe(false);
    // Supply geometry only for the visible unit; the hidden warning has none.
    const { rec } = paths(artifact);
    const geo = geometry(
      { [rec]: { x: 10, y: 10, width: 400, height: 100 } },
      {},
    );
    const verdict = attestGeometry(walk, geo, POLICY, DISCLOSES);
    expect(verdict.allowed).toBe(true);
    expect(verdict.violations).toEqual([]);
  });

  it("fails closed when a visible unit cannot be measured at all", () => {
    // On a real mounted page every element has a box; a missing one is a
    // mismatch between the walk and the DOM, not a lenient pass.
    const artifact = page();
    const { rec, boxes, styles } = cleanLayout(artifact);
    delete boxes[rec];
    // The recommendation is on the page and unmeasurable; failing closed here
    // is the difference between "could not swear" and "swore it was fine".
    expect(codes(artifact, geometry(boxes, styles))).toContain("IA-6/geometry-unmeasured");
  });
});
