/**
 * The geometry sabotage menu: the attacks a stylesheet can mount that leave the
 * markup innocent, and what the browser affidavit says when a visitor lets one
 * loose live in the tab.
 *
 * The structural crucible (src/ui/sabotage.ts) runs the mutations CI runs, and
 * every one of them changes the *document* — a hidden node, a doctored digest,
 * a value the manifest never certified. These are different in kind: they leave
 * the certified markup exactly as the renderer emitted it and change only how a
 * browser *paints* it. A class that sets `display:none`, a font shrunk to four
 * pixels, a box moved off the screen — the structural walker reads inline style
 * and tree shape, so it clears the page, and the browser-backed affidavit is
 * the only thing standing between "structurally perfect" and "shown nothing".
 *
 * That is the whole point of the section, and why these cannot be crucible
 * mutations: a geometry attack that the offline gate could catch would not be
 * demonstrating the layer the offline gate cannot see. The enforcement *logic*
 * is still CI-gated — `attestGeometry` is tested against scripted layouts with
 * no browser in the loop (browser-affidavit.test.ts) — but the live theatre
 * needs a real layout engine, so it runs in the visitor's browser and this
 * module only supplies the scene, the menu, and the projection of a verdict.
 *
 * The menu covers three of the four P's live. Prominence and placement are
 * restyles of the disclosure; occlusion is the one attack a stylesheet cannot
 * mount by editing the warning — it needs a *second* element on top — so its
 * card lays an opaque overlay rather than restyling the target. Proximity is
 * the fourth, enforced all the same (the sibling-box case in
 * browser-affidavit.test.ts), but not on this menu: the reference renderer
 * nests every disclosure *inside* the unit it discloses, so their boxes always
 * overlap and no paint-only edit can pull them apart; a proximity breach needs
 * a renderer that does not nest, which is a document change, not a paint one.
 */

import type { ArtifactWalk, DomElement } from "../kernel/dom.js";
import { walkArtifact } from "../kernel/dom.js";
import type { ManifestContext } from "../kernel/manifest.js";
import type { DisplayPolicy } from "../kernel/pack.js";
import { planRender } from "../kernel/render.js";
import { AccordError, denialCode } from "../kernel/violation.js";
import { honestAnswer } from "../crucible/phase2.js";
import { renderAnswer } from "../render/reference.js";
import { attestGeometry, type Geometry } from "./browser-affidavit.js";
import { violationView, type ViolationView } from "./viewmodel.js";

/** The unit the live attacks target: the demo answer's triggered warning. */
export const GEOMETRY_TARGET = "selfdestruct-warning";

/**
 * The certified page the visitor sees, plus everything a verdict about it needs
 * that does not come off the screen: the structural walk (the offline reading
 * the geometry layer only ever tightens), which disclosure sits beside which
 * unit, and the pack's floors. Built from the same honest answer the structural
 * crucible attacks, through the same public planning and rendering path.
 */
export interface GeometryScene {
  artifact: DomElement;
  walk: ArtifactWalk;
  discloses: ReadonlyMap<string, string>;
  policy: DisplayPolicy;
  transactionId: string;
}

export function geometryScene(world: ManifestContext): GeometryScene {
  const manifest = honestAnswer(world);
  const planned = planRender(world, manifest);
  // A scene that cannot render its honest answer is measuring nothing, so it
  // fails loudly rather than degrading into a page with no warning to attack.
  if (!planned.ok) throw new AccordError(planned.violations);
  const plan = planned.value;

  const discloses = new Map<string, string>();
  for (const unit of plan.units) {
    if (unit.discloses !== undefined) discloses.set(unit.id, unit.discloses);
  }

  const artifact = renderAnswer(world.pack, plan);
  return {
    artifact,
    walk: walkArtifact(artifact),
    discloses,
    policy: world.pack.presentation.display,
    transactionId: plan.transactionId,
  };
}

/**
 * One live geometry attack: an inline style patch a visitor applies to the
 * target's real node, and the denial it has promised to earn.
 *
 * The patch is data, applied to the mounted DOM rather than the certified
 * `DomElement`, which is why the structural walk keeps clearing the page while
 * the browser affidavit denies it.
 */
export interface GeometrySabotageCard {
  id: string;
  title: string;
  description: string;
  /** The unit id the attack targets. */
  target: string;
  /**
   * Inline style properties — camelCase keys. For a normal card, applied to the
   * target's own node. For a `cover` card, applied to the overlay laid over it.
   */
  style: Readonly<Record<string, string>>;
  /**
   * When true, the attack does not touch the target: it lays a fresh, opaque
   * element over it. Occlusion is the one P a stylesheet cannot mount by
   * editing the disclosure — it needs a second element on top — so it is the
   * one live sabotage that adds a node rather than restyling one.
   */
  cover?: boolean;
  expectedDenial: string;
}

export const GEOMETRY_SABOTAGES: readonly GeometrySabotageCard[] = [
  {
    id: "shrink-to-4px",
    title: "Shrink the warning to four pixels",
    description:
      "The disclosure is present, unaltered, and in the right place. Its font " +
      "is four pixels tall. The structural walker never reads a font size, so " +
      "the page passes every offline check and no one can read the warning.",
    target: GEOMETRY_TARGET,
    style: { fontSize: "4px" },
    expectedDenial: "IA-6/insufficient-prominence",
  },
  {
    id: "shove-it-offscreen",
    title: "Position the warning off the screen",
    description:
      "position:absolute and a left of minus ten thousand pixels leave the " +
      "warning in the document, structurally visible, and nowhere a trainer " +
      "will ever see it. Only the layout box gives it away.",
    target: GEOMETRY_TARGET,
    style: { position: "absolute", left: "-10000px", top: "0" },
    expectedDenial: "IA-6/rendered-offscreen",
  },
  {
    id: "collapse-to-nothing",
    title: "Collapse the warning to no size",
    description:
      "width:0, height:0 and overflow:hidden keep the disclosure in the tree " +
      "and give it a box a browser paints nothing into. Present, and zero by " +
      "zero pixels on the screen.",
    target: GEOMETRY_TARGET,
    style: { width: "0", height: "0", padding: "0", border: "0", overflow: "hidden" },
    expectedDenial: "IA-6/rendered-zero-area",
  },
  {
    id: "cover-with-overlay",
    title: "Cover the warning with an overlay",
    description:
      "The disclosure is untouched: full size, legible, in place. An opaque box " +
      "is laid over it, higher in the paint order. A click at the warning's " +
      "centre lands on the cover, not the text — present, and behind something.",
    target: GEOMETRY_TARGET,
    cover: true,
    style: { background: "var(--seal-tint)", border: "1px solid var(--seal)" },
    expectedDenial: "IA-6/occluded",
  },
];

/** What the console shows after a live geometry run: the affidavit's verdict,
 * projected, and whether it landed under exactly the denial it promised. */
export interface GeometryOutcome {
  allowed: boolean;
  violations: readonly ViolationView[];
  deniedAsDeclared: boolean;
  /** What the offline structural walk still says about the target unit — the
   * contrast the whole section exists to draw. */
  structurallyVisible: boolean;
}

/**
 * Judge a live reading of the scene and project it for the console.
 *
 * `geometry` is a reading of the *mutated* page: the browser supplies one that
 * reflects the applied style patch, a test supplies a scripted layout. The
 * verdict is the browser affidavit's, unchanged — this only turns it into what
 * the page shows.
 */
export function geometryOutcome(
  scene: GeometryScene,
  geometry: Geometry,
  card: GeometrySabotageCard,
): GeometryOutcome {
  const verdict = attestGeometry(scene.walk, geometry, scene.policy, scene.discloses);
  const target = scene.walk.units.find((unit) => unit.id === card.target);
  return {
    allowed: verdict.allowed,
    violations: verdict.violations.map(violationView),
    deniedAsDeclared: !verdict.allowed && verdict.violations.some((entry) => denialCode(entry) === card.expectedDenial),
    structurallyVisible: target?.visible ?? false,
  };
}
