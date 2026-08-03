/**
 * Phase 4 crucible: sabotage of the page.
 *
 * Phase 1 attacked the datum, phase 2 the answer, phase 3 the authority behind
 * both. Every one of those attacks had to change something a verifier could
 * recompute. These do not. The manifest is honest here — every mutation below
 * leaves a certified, verified answer completely intact and goes after the
 * last three inches of the pipeline, where a true sentence becomes a page.
 *
 * That is the whole reason Article VI exists as a separate article. A
 * disclosure that is attached to the answer, listed in the record, and present
 * in the DOM inside a collapsed `<details>` has satisfied every check upstream
 * of the screen and disclosed nothing. Nothing in the manifest can catch it,
 * because nothing about the manifest is wrong.
 *
 * The sabotage is applied to the finished document rather than to the
 * renderer. A real renderer is a component library and a stylesheet nobody in
 * this repository controls, so the attacks are written the way they would
 * actually arrive: as edits to the artifact after everything trustworthy has
 * already run.
 */

import type { ArticleId } from "../kernel/accord.js";
import type { AnswerManifest, RenderAffidavit, Verdict } from "../kernel/contracts.js";
import { type DomElement, type DomNode, element, text, UNIT_ATTRIBUTE, walkArtifact } from "../kernel/dom.js";
import { attestRender, planRender, verifyRender } from "../kernel/render.js";
import { AccordError } from "../kernel/violation.js";
import { renderAnswer } from "../render/reference.js";
import type { Control, CrucibleWorld, Mutation } from "./harness.js";
import { honestAnswer } from "./phase2.js";

/** Supplied rather than read from a clock: a verdict is a pure function. */
const RENDERED_AT = "2026-01-01T12:00:00Z";

/** The units this phase attacks by name, so an id change breaks loudly. */
const WARNING = "selfdestruct-warning";
const PROVENANCE = "provenance";
const SPEED_CARD = "fact:pikachu:base-speed";
const BOOMERS_CARD = "count:selfdestruct-learners";

interface Rendered {
  manifest: AnswerManifest;
  artifact: DomElement;
  affidavit: RenderAffidavit;
}

/** Phase 2's answer, planned, rendered and sworn to, with nothing touched. */
function rendered(world: CrucibleWorld): Rendered {
  const manifest = honestAnswer(world);
  const planned = planRender(world, manifest);
  // A crucible that cannot render an honest answer is not measuring anything,
  // so this fails loudly rather than degrading into a passing denial.
  if (!planned.ok) throw new AccordError(planned.violations);

  const artifact = renderAnswer(planned.value);
  const attested = attestRender(world, manifest, artifact, RENDERED_AT);
  if (!attested.ok) throw new AccordError(attested.violations);
  return { manifest, artifact, affidavit: attested.value };
}

/** What a mutation replaces. Anything it leaves out is the honest article. */
type Sabotaged = Partial<Rendered>;

/**
 * Render honestly, tamper with the page, then submit it with a record that
 * agrees with it.
 *
 * The affidavit is re-derived from the sabotaged page unless the mutation
 * supplies its own, and that is the crucible's most important decision here.
 * Reusing the affidavit sworn over the clean page would deny every mutation
 * below twice — once on its merits and once because the record no longer
 * matched — and the second denial would do the work while looking like the
 * first. Every attack on the page therefore arrives with a record that is
 * perfectly honest about the page, and has to be caught for what it did.
 */
function sabotage(world: CrucibleWorld, change: (honest: Rendered) => Sabotaged): Verdict {
  const honest = rendered(world);
  const changed = change(honest);
  const artifact = changed.artifact ?? honest.artifact;
  return verifyRender(
    world,
    changed.manifest ?? honest.manifest,
    artifact,
    changed.affidavit ?? swearTo(artifact, honest.affidavit.renderedAt),
  );
}

/**
 * The affidavit a renderer would produce for the document in front of it.
 *
 * Deliberately not `attestRender`, which refuses to sign a page that will not
 * verify. This is the other side of that door: a witness with no scruples and
 * no policy, reporting exactly what the walk found. The kernel is not entitled
 * to assume the record was produced by something on its side.
 */
function swearTo(artifact: DomElement, renderedAt: string): RenderAffidavit {
  const walk = walkArtifact(artifact);
  return {
    transactionId: walk.transactionId ?? "",
    artifactDigest: walk.digest,
    renderedAt,
    units: walk.units.map((unit) => ({ id: unit.id, visible: unit.visible })),
  };
}

// --- editing a finished document --------------------------------------------

/**
 * Replace the element marked as one unit. Returning `undefined` deletes it.
 * Everything else in the document is left byte-identical, so each mutation
 * below is exactly one edit.
 */
function editUnit(node: DomNode, unitId: string, edit: (found: DomElement) => DomNode | undefined): DomNode | undefined {
  if (node.kind === "text") return node;
  if (node.attributes[UNIT_ATTRIBUTE] === unitId) return edit(node);
  const children = node.children
    .map((child) => editUnit(child, unitId, edit))
    .filter((child): child is DomNode => child !== undefined);
  return { ...node, children };
}

function edit(artifact: DomElement, unitId: string, change: (found: DomElement) => DomNode | undefined): DomElement {
  return editUnit(artifact, unitId, change) as DomElement;
}

/** Add attributes to the unit's own element — the direct hiding techniques. */
function withAttributes(artifact: DomElement, unitId: string, extra: Record<string, string>): DomElement {
  return edit(artifact, unitId, (found) => ({ ...found, attributes: { ...found.attributes, ...extra } }));
}

/** Put the unit inside something. The unit itself is left untouched. */
function inside(artifact: DomElement, unitId: string, wrapper: DomElement): DomElement {
  return edit(artifact, unitId, (found) => ({ ...wrapper, children: [...wrapper.children, found] }));
}

/** Rewrite text inside one unit. Used to truncate and to swap bound values. */
function retext(artifact: DomElement, unitId: string, from: string, to: string): DomElement {
  const rewrite = (node: DomNode): DomNode =>
    node.kind === "text"
      ? { ...node, text: node.text.replace(from, to) }
      : { ...node, children: node.children.map(rewrite) };
  return edit(artifact, unitId, (found) => rewrite(found));
}

/** Move a unit out of where it was rendered and onto the end of the page. */
function exile(artifact: DomElement, unitId: string): DomElement {
  let removed: DomElement | undefined;
  const without = edit(artifact, unitId, (found) => {
    removed = found;
    return undefined;
  });
  if (removed === undefined) throw new Error(`nothing marked ${unitId} to exile`);
  return { ...without, children: [...without.children, element("footer", {}, [removed])] };
}

function paragraph(...content: string[]): DomElement {
  return element("p", {}, content.map((piece) => text(piece)));
}

export const PHASE_4_MUTATIONS: readonly Mutation[] = [
  {
    id: "hide-the-section-around-it",
    title: "Leave the warning alone and hide the section it sits in",
    description:
      "Nothing about the disclosure changes: it has no style, no attribute " +
      "and no excuse. The card around it is display:none. A check that reads " +
      "the disclosure's own markup finds it innocent.",
    article: "IA-6",
    rule: "exhibit-hidden-display-none",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: inside(honest.artifact, WARNING, element("div", { style: "display: none" })),
      })),
  },
  {
    id: "style-it-invisible",
    title: "Keep the layout, remove the ink",
    description:
      "visibility:hidden leaves the disclosure occupying exactly the space it " +
      "should. The page looks right in every measurement except the one that " +
      "matters.",
    article: "IA-6",
    rule: "exhibit-hidden-visibility-hidden",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: withAttributes(honest.artifact, WARNING, { style: "visibility: hidden" }),
      })),
  },
  {
    id: "fade-it-out",
    title: "Set the disclosure to five percent opacity",
    description:
      "The fine print's oldest trick, with a stylesheet instead of a printing " +
      "press. It is technically legible and it is not a disclosure.",
    article: "IA-6",
    rule: "exhibit-hidden-opacity-zero",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: withAttributes(honest.artifact, WARNING, { style: "opacity: 0.05" }),
      })),
  },
  {
    id: "set-the-hidden-attribute",
    title: "Mark it hidden and ship it",
    description:
      "The bluntest instrument in the DOM. Present in the payload, present in " +
      "the record, absent from the page.",
    article: "IA-6",
    rule: "exhibit-hidden-attribute",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: withAttributes(honest.artifact, WARNING, { hidden: "" }),
      })),
  },
  {
    id: "hide-it-from-assistive-technology",
    title: "Show it to sighted trainers only",
    description:
      "aria-hidden takes the warning out of the accessibility tree. The " +
      "disclosure reaches some trainers and not others, which is a prominence " +
      "rule failing in exactly the way prominence rules are written for.",
    article: "IA-6",
    rule: "exhibit-hidden-aria-hidden",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: withAttributes(honest.artifact, WARNING, { "aria-hidden": "true" }),
      })),
  },
  {
    id: "collapse-it-into-details",
    title: "Put the warning one click away",
    description:
      "A closed <details> with a friendly summary. The text is in the " +
      "document, the trainer has not read it, and every payload-level check " +
      "in the pipeline is satisfied.",
    article: "IA-6",
    rule: "exhibit-hidden-collapsed-details",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: inside(
          honest.artifact,
          WARNING,
          element("details", {}, [element("summary", {}, [text("More about this move")])]),
        ),
      })),
  },
  {
    id: "park-it-in-a-template",
    title: "Ship the disclosure inert",
    description:
      "<template> content is parsed and never rendered. It survives every " +
      "'is it in the DOM?' assertion anyone will ever write and shows nothing.",
    article: "IA-6",
    rule: "exhibit-hidden-template",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: inside(honest.artifact, WARNING, element("template", {})),
      })),
  },
  {
    id: "drop-the-warning-from-the-page",
    title: "Certify the disclosure and never render it",
    description:
      "The manifest carries the exhibit, the plan requires it, and the page " +
      "does not have it. This is the gap between phase 2's obligation and " +
      "phase 4's proof, made concrete.",
    article: "IA-6",
    rule: "exhibit-not-rendered",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: edit(honest.artifact, WARNING, () => undefined),
      })),
  },
  {
    id: "scramble-the-disclosure",
    title: "Show every word of the warning in the wrong order",
    description:
      "Both required fragments are on the screen and the sentence they make " +
      "is not the one the pack requires. Presence is not disclosure; order is " +
      "part of the meaning.",
    article: "IA-6",
    rule: "exhibit-fragments-out-of-order",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: edit(honest.artifact, WARNING, (found) => ({
          ...found,
          children: [paragraph("User faints — and that is what Selfdestruct is for.")],
        })),
      })),
  },
  {
    id: "swap-a-bound-value",
    title: "Print a different number from the one that was certified",
    description:
      "The manifest still says 90 and verifies against the snapshot; the card " +
      "on the page says 200. Every check upstream of the render passes, " +
      "because nothing upstream of the render reads the page.",
    article: "IA-6",
    rule: "exhibit-fragment-not-visible",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: retext(honest.artifact, SPEED_CARD, "90", "200"),
      })),
  },
  {
    id: "truncate-the-licence",
    title: "Cut the attribution off mid-word",
    description:
      "The provenance exhibit is present, visible, adjacent and one ellipsis " +
      "short of naming the licence. Truncation is the failure that a presence " +
      "check cannot see, and it is what a narrow column does by default.",
    article: "IA-2",
    rule: "exhibit-fragment-not-visible",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: retext(honest.artifact, PROVENANCE, "BSD-3-Clause", "BSD-3…"),
      })),
  },
  {
    id: "exile-the-warning-to-the-footer",
    title: "Disclose it, at the bottom of the page",
    description:
      "Visible, complete, in order, and nowhere near the answer that triggered " +
      "it. The Accord requires the disclosure beside what triggered it because " +
      "regulators have always known the location is the whole game.",
    article: "IA-6",
    rule: "exhibit-not-adjacent",
    run: (world) => sabotage(world, (honest) => ({ artifact: exile(honest.artifact, WARNING) })),
  },
  {
    id: "inject-a-missingno-card",
    title: "Add a governed card for something that does not exist",
    description:
      "A card marked as a certified fact about MissingNo, injected into the " +
      "page after compilation. The plan is the closed list of what may be " +
      "shown, so an extra unit is a claim that entered at the last moment.",
    article: "IA-6",
    rule: "unmanifested-exhibit",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: {
          ...honest.artifact,
          children: [
            ...honest.artifact.children,
            element("section", { [UNIT_ATTRIBUTE]: "fact:missingno:base-speed" }, [
              paragraph("From the certified registry: MissingNo — 136"),
            ]),
          ],
        },
      })),
  },
  {
    id: "mark-the-warning-twice",
    title: "Render the disclosure twice under one id",
    description:
      "Two elements claiming to be the same unit. Once there are two, the " +
      "affidavit cannot answer 'was it shown?' — one of them could be hidden " +
      "in the next release and the record would not change.",
    article: "IA-6",
    rule: "exhibit-marked-twice",
    run: (world) =>
      sabotage(world, (honest) => ({
        artifact: edit(honest.artifact, BOOMERS_CARD, (found) => ({
          ...found,
          children: [...found.children, ...found.children.slice(-1)],
        })),
      })),
  },
  {
    id: "render-another-answer",
    title: "Show a perfectly good page for a different transaction",
    description:
      "Nothing on this page is false. It is a complete, compliant artifact " +
      "for an answer nobody asked about — the shape a localisation, a cache " +
      "or a re-render takes when it goes wrong.",
    article: "IA-6",
    rule: "artifact-transaction-mismatch",
    run: (world) =>
      sabotage(world, (honest) => {
        const planned = planRender(world, honest.manifest);
        if (!planned.ok) throw new AccordError(planned.violations);
        // The same answer, rendered for another transaction. Every fragment is
        // present, in order, adjacent; the affidavit sworn over it is honest.
        return { artifact: renderAnswer({ ...planned.value, transactionId: "txn-crucible-localised" }) };
      }),
  },
  {
    id: "swear-to-a-disclosure-that-is-not-there",
    title: "Sign an affidavit for a unit the page never marked",
    description:
      "The page is honest and the record is not. Phase 5 binds a confirmation " +
      "to this affidavit, so an affidavit that describes a different document " +
      "is the beginning of an action nobody authorised.",
    article: "IA-6",
    rule: "affidavit-visibility-mismatch",
    run: (world) =>
      sabotage(world, (honest) => ({
        affidavit: {
          ...honest.affidavit,
          units: [...honest.affidavit.units, { id: "explosion-warning", visible: true }],
        },
      })),
  },
  {
    id: "edit-the-page-after-swearing-to-it",
    title: "Change the artifact once the affidavit is signed",
    description:
      "Only renderer copy is touched — one word of a heading, nothing bound, " +
      "nothing certified. The digest is over what is visible, so 'we only " +
      "changed the wording' is a detectable statement rather than an excuse.",
    article: "IA-6",
    rule: "affidavit-digest-mismatch",
    run: (world) =>
      sabotage(world, (honest) => {
        const reworded = (node: DomNode): DomNode =>
          node.kind === "text"
            ? { ...node, text: node.text.replace("Your certified answer", "Your answer") }
            : { ...node, children: node.children.map(reworded) };
        // The one mutation that keeps the original affidavit: the record is
        // honest about the page that was signed, and the page has moved on.
        return { artifact: reworded(honest.artifact) as DomElement, affidavit: honest.affidavit };
      }),
  },
];

export const PHASE_4_CONTROLS: readonly Control[] = [
  {
    id: "render-clean-path",
    kind: "clean-path",
    title: "Plan, render, attest and verify one answer",
    description:
      "The certified answer from phase 2, through the reference renderer and " +
      "the walker, with nothing tampered: every bound value and every " +
      "mandatory fragment visible, in order, beside what triggered it.",
    run: (world) => {
      const { manifest, artifact, affidavit } = rendered(world);
      return verifyRender(world, manifest, artifact, affidavit);
    },
  },
  {
    id: "render-no-op-sabotage",
    kind: "no-op-sabotage",
    title: "Edit nothing, through the identical harness",
    description:
      "The same render-then-tamper harness every mutation above uses, with " +
      "the document rebuilt node for node and left exactly as rendered.",
    run: (world) =>
      sabotage(world, (honest) => ({
        // Through the edit machinery rather than around it: a harness that
        // rebuilt the tree wrongly would make every mutation above pass.
        artifact: edit(honest.artifact, WARNING, (found) => found),
      })),
  },
];

/** Articles the phase-4 crucible exercises. Pinned by test, both ways. */
export const PHASE_4_ARTICLES: readonly ArticleId[] = ["IA-2", "IA-6"];
