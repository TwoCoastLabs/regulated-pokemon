/**
 * The browser-backed affidavit (IA-6): what a real layout does to a certified
 * page, after the structural walk has vouched for its markup.
 *
 * `src/kernel/dom.ts` reads structure — which governed units are in the
 * document, what text is legible inside each, and one digest for the whole. It
 * reads *inline* style and the shape of the tree, and nothing else, because
 * that is all that replays: a `display:none` in a `style` attribute means the
 * same thing on every machine, so it can enter the digest a confirmation binds
 * (IA-10). What it cannot see is everything a stylesheet, a font stack and a
 * viewport decide at paint time — a class that sets `display:none`, a warning
 * shrunk to four pixels, a disclosure positioned a screen away from the claim
 * it qualifies, a box collapsed to nothing. Those are real, and they are how a
 * page passes every structural check and still shows the trainer nothing.
 *
 * This module is the production authority for that layer. It reads the FTC's
 * "four Ps" — prominence, placement, proximity — as geometry: computed font
 * size and opacity against a floor, layout boxes against the viewport, the gap
 * between a triggered disclosure and what triggered it. Each failure is a named
 * IA-6 denial, exactly as the structural verifier's are.
 *
 * Two boundaries are deliberate and load-bearing.
 *
 * 1. **It only ever tightens.** It judges units the structural walk already
 *    found *visible* — a unit hidden by markup is denied upstream, and saying
 *    it twice would report one fault as two. So a page this module clears is a
 *    page the structural walk already cleared; it can add denials, never remove
 *    them.
 * 2. **It is not on the replayable chain.** Pixels depend on the machine, so a
 *    geometry verdict cannot be reproduced bit-for-bit on another one, and
 *    folding it into a digest would poison Article X rather than strengthen
 *    Article VI. It runs live, at the edge, against the real browser — and the
 *    deterministic offline gate keeps its own separate, replayable job. The
 *    essay states this ceiling honestly; this module sits right beneath it.
 *
 * Pure and total, like the structural walk: it takes an observation (the
 * injected {@link Geometry}) and a policy, and reports. It reads the browser
 * through an interface for the same reason the mounting adapter does — the
 * browser supplies one wrapping `getBoundingClientRect` and `getComputedStyle`,
 * a test supplies scripted boxes, and the judgement is identical to both. So
 * the four-pixel warning is denied in CI, with no browser in the test path.
 */

import type { ArticleId } from "../kernel/accord.js";
import type { Verdict, Violation } from "../kernel/contracts.js";
import type { ArtifactWalk } from "../kernel/dom.js";
import { verdictOf, violation } from "../kernel/violation.js";
import type { DisplayPolicy } from "../kernel/pack.js";

/** A layout box in CSS pixels, origin top-left — a `getBoundingClientRect`. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in the same coordinates as the boxes. */
export interface Point {
  x: number;
  y: number;
}

/** The computed legibility of one element — the parts of `getComputedStyle`
 * that decide whether text can be read, rather than merely be present. */
export interface VisualStyle {
  /** Computed `font-size`, in CSS pixels. */
  fontSizePx: number;
  /** Computed `opacity`, the product down the ancestor chain, in `[0, 1]`. */
  opacity: number;
}

/**
 * A reading of the real layout, keyed by the same paths the structural walk
 * reports — child indices from the artifact root. The browser resolves a path
 * to a `Node` and measures it; a test hands over a map. `undefined` means the
 * path names no measurable element, which on a mounted page is a fault rather
 * than an absence, and is denied as one.
 */
export interface Geometry {
  /** The visible viewport the page is laid out in, in the same coordinates as
   * the boxes — normally `{ x: 0, y: 0, width, height }`. */
  viewport: Box;
  box(path: readonly number[]): Box | undefined;
  style(path: readonly number[]): VisualStyle | undefined;
  /**
   * What, if anything, is painted on top of the element at `path` at `point`.
   *
   * A raw observation, like `box` and `style`: it answers "what would a click
   * here hit?" and `undefined` means the element itself, or one of its own
   * descendants, is the topmost thing there — nothing is covering it. A string
   * is a short description of the intruding element, for the denial to name.
   * The affidavit decides that an intruder is a fault; this only reports one.
   */
  occluderAt(path: readonly number[], point: Point): string | undefined;
}

const IA6: ArticleId = "IA-6";

/**
 * Judge a mounted certified page against the geometry floors — or refuse it.
 *
 * `walk` is the structural reading (from `walkArtifact`); `discloses` maps a
 * triggered disclosure's unit id to the unit id it must sit beside, taken from
 * the render plan. Only structurally-visible units and disclosure blocks are
 * measured, for the reason above: this layer tightens the structural verdict,
 * it does not re-litigate it.
 */
export function attestGeometry(
  walk: ArtifactWalk,
  geometry: Geometry,
  policy: DisplayPolicy,
  discloses: ReadonlyMap<string, string> = new Map(),
): Verdict {
  const violations: Violation[] = [];
  const unitBoxes = new Map<string, Box>();
  // Units that are visible, measured, and sitting cleanly in the viewport.
  // Occlusion is only asked about a disclosure inside one of these: a warning
  // whose unit is off-screen or collapsed is already denied on placement, and
  // sampling a point inside a clipped or displaced unit would resolve to some
  // unrelated element and cry "occluded" about a fault that is really the unit's.
  const wellPlaced = new Set<string>();

  // Placement: every governed unit the markup shows must occupy a real box on
  // the screen. A unit positioned off-screen or collapsed to nothing is present
  // in the document and absent from the page — the structural walk's own
  // definition of hidden, reached through the layout instead of the tree.
  for (const unit of walk.units) {
    if (!unit.visible) continue;
    const box = geometry.box(unit.path);
    if (box === undefined) {
      violations.push(unmeasured(`unit "${unit.id}"`, unit.path));
      continue;
    }
    unitBoxes.set(unit.id, box);
    const placement = placementOf(box, geometry.viewport);
    if (placement !== undefined) {
      violations.push(placementViolation(placement, `"${unit.id}"`, geometry.viewport));
    } else {
      wellPlaced.add(unit.id);
    }
  }

  // Prominence: the mandatory words must be large enough and solid enough to
  // read. Measured on the block itself, so a font size set on the warning or
  // inherited from an ancestor is caught the same way — the four-pixel warning
  // and the five-percent-opacity warning are one gate here.
  for (const block of walk.attributed) {
    if (block.kind !== "block" || !block.visible) continue;
    const label = `the "${block.name}" disclosure${block.unitId === undefined ? "" : ` in "${block.unitId}"`}`;

    const box = geometry.box(block.path);
    if (box === undefined) {
      violations.push(unmeasured(label, block.path));
    } else {
      const placement = placementOf(box, geometry.viewport);
      // A block collapsed inside an otherwise-visible unit is its own fault;
      // an off-screen block is already reported against its off-screen unit.
      if (placement?.kind === "zero-area") {
        violations.push(placementViolation(placement, label, geometry.viewport));
      } else if (placement === undefined && block.unitId !== undefined && wellPlaced.has(block.unitId)) {
        // Occlusion: the block is on the screen at a real size, inside a unit
        // that is itself cleanly placed — but is anything painted over it?
        // Sample its centre; a foreign element there means the text is behind
        // something, present and unreadable. The well-placed guard matters: a
        // block inside a collapsed or displaced unit is denied on that unit, and
        // its centre would land somewhere the disclosure was never shown.
        const occluder = geometry.occluderAt(block.path, centre(box));
        if (occluder !== undefined) {
          violations.push(
            violation(IA6, "occluded", `${label} is on the screen and painted over`, {
              expected: "nothing painted on top of it",
              actual: occluder,
            }),
          );
        }
      }
    }

    const style = geometry.style(block.path);
    if (style === undefined) {
      violations.push(unmeasured(label, block.path));
      continue;
    }
    if (style.fontSizePx < policy.minLegiblePx) {
      violations.push(
        violation(IA6, "insufficient-prominence", `${label} is rendered too small to read`, {
          expected: `at least ${policy.minLegiblePx}px`,
          actual: `${round(style.fontSizePx)}px`,
        }),
      );
    }
    if (style.opacity < policy.minLegibleOpacity) {
      violations.push(
        violation(IA6, "insufficient-prominence", `${label} is rendered too faint to read`, {
          expected: `at least ${policy.minLegibleOpacity} opacity`,
          actual: String(round(style.opacity)),
        }),
      );
    }
  }

  // Proximity: a triggered disclosure has to sit near what triggered it. The
  // structural verifier already requires adjacency in the tree; this is the
  // other half of it, because two elements can be siblings in the markup and a
  // screen apart in the layout, and a warning nobody scrolls to is a warning
  // nobody saw.
  for (const [unitId, anchorId] of discloses) {
    const box = unitBoxes.get(unitId);
    const anchorBox = unitBoxes.get(anchorId);
    // Either being absent is already a denial: the disclosure's against itself
    // (missing or off-screen), the anchor's against the anchor. Proximity is a
    // relation between two things that are both on the screen.
    if (box === undefined || anchorBox === undefined) continue;
    const gap = edgeGap(box, anchorBox);
    if (gap > policy.maxProximityPx) {
      violations.push(
        violation(IA6, "insufficient-proximity", `"${unitId}" is on the screen, and too far from the "${anchorId}" it discloses`, {
          expected: `within ${policy.maxProximityPx}px of ${anchorId}`,
          actual: `${round(gap)}px away`,
        }),
      );
    }
  }

  return verdictOf(violations);
}

/** A placement fault and the box that has it, or nothing when the box sits
 * legibly inside the viewport. */
interface Placement {
  kind: "zero-area" | "offscreen";
  box: Box;
}

function placementOf(box: Box, viewport: Box): Placement | undefined {
  // Zero-area first and more specific: a collapsed box is also, trivially,
  // outside the viewport, and "collapsed to nothing" is the truer name.
  if (box.width <= 0 || box.height <= 0) return { kind: "zero-area", box };
  if (!intersects(box, viewport)) return { kind: "offscreen", box };
  return undefined;
}

/** One placement fault, named, for a subject already quoted by the caller (a
 * unit id in quotes, or a disclosure's own label). */
function placementViolation(placement: Placement, subject: string, viewport: Box): Violation {
  const { box } = placement;
  if (placement.kind === "zero-area") {
    return violation(IA6, "rendered-zero-area", `${subject} is in the document and collapsed to no size on the screen`, {
      expected: "a box with width and height",
      actual: `${round(box.width)}×${round(box.height)}`,
    });
  }
  return violation(IA6, "rendered-offscreen", `${subject} is in the document and laid out beyond the viewport`, {
    expected: `inside the ${round(viewport.width)}×${round(viewport.height)} viewport`,
    actual: boxAt(box),
  });
}

function unmeasured(label: string, path: readonly number[]): Violation {
  // Fail closed: the affidavit cannot swear a page shows something it could not
  // measure. On a mounted page every element has a box, so this is a structural
  // mismatch between the walk and the DOM — a fault, not an empty result.
  return violation(IA6, "geometry-unmeasured", `${label} is on the page and could not be measured`, {
    expected: "a layout box and computed style",
    actual: `nothing at path ${path.join(".") || "root"}`,
  });
}

/** The middle of a box — the point a click lands on, and where occlusion is
 * sampled. */
function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Do two boxes overlap at all? Touching edges do not count as overlap. */
function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * The shortest gap between two boxes' edges, in pixels — zero when they overlap
 * or nest. Euclidean, so a box that is both far to the side and far below is
 * counted as far as it truly is, not merely as far along one axis.
 */
function edgeGap(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.sqrt(dx * dx + dy * dy);
}

function boxAt(box: Box): string {
  return `${round(box.width)}×${round(box.height)} at (${round(box.x)}, ${round(box.y)})`;
}

/** Layout numbers are fractional; a denial reads better whole-ish. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
