/**
 * Editing a finished document, and swearing to it.
 *
 * The sabotage in phases 4 and 5 is applied to the artifact rather than to the
 * renderer. A real renderer is a component library, a design system and a
 * stylesheet nobody in this repository controls, so the attacks are written the
 * way they would actually arrive: as edits to the page after everything
 * trustworthy has already run.
 *
 * These live here rather than inside one phase because two phases attack the
 * same page for different reasons — phase 4 asks whether the trainer could read
 * it, phase 5 asks whether what they confirmed is what executes — and a shared
 * edit is the only way the two are attacking the same thing.
 */

import type { RenderAffidavit } from "../kernel/contracts.js";
import { type DomElement, type DomNode, element, text, UNIT_ATTRIBUTE, walkArtifact } from "../kernel/dom.js";

/**
 * Replace the element marked as one unit. Returning `undefined` deletes it.
 * Everything else in the document is left byte-identical, so each mutation is
 * exactly one edit.
 */
function editUnit(node: DomNode, unitId: string, change: (found: DomElement) => DomNode | undefined): DomNode | undefined {
  if (node.kind === "text") return node;
  if (node.attributes[UNIT_ATTRIBUTE] === unitId) return change(node);
  const children = node.children
    .map((child) => editUnit(child, unitId, change))
    .filter((child): child is DomNode => child !== undefined);
  return { ...node, children };
}

export function edit(
  artifact: DomElement,
  unitId: string,
  change: (found: DomElement) => DomNode | undefined,
): DomElement {
  return editUnit(artifact, unitId, change) as DomElement;
}

/** Add attributes to the unit's own element — the direct hiding techniques. */
export function withAttributes(artifact: DomElement, unitId: string, extra: Record<string, string>): DomElement {
  return edit(artifact, unitId, (found) => ({ ...found, attributes: { ...found.attributes, ...extra } }));
}

/** Put the unit inside something. The unit itself is left untouched. */
export function inside(artifact: DomElement, unitId: string, wrapper: DomElement): DomElement {
  return edit(artifact, unitId, (found) => ({ ...wrapper, children: [...wrapper.children, found] }));
}

/**
 * Rewrite the text inside the element carrying one attribution mark.
 *
 * The mark itself is left alone, which is the point: these are attacks by a
 * renderer that fills a slot, a block or a catalogue entry with something other
 * than what it was given, not by one that forgets to mark its output.
 */
function rewriteMark(node: DomNode, attribute: string, name: string, replacement: string): DomNode {
  if (node.kind === "text") return node;
  if (node.attributes[attribute] === name) return { ...node, children: [text(replacement)] };
  return { ...node, children: node.children.map((child) => rewriteMark(child, attribute, name, replacement)) };
}

/** Rewrite a mark inside one unit, so that repeated slot names stay distinct. */
export function retext(
  artifact: DomElement,
  unitId: string,
  attribute: string,
  name: string,
  to: string,
): DomElement {
  return edit(artifact, unitId, (found) => rewriteMark(found, attribute, name, to));
}

/** Add a child to the element marked as one unit. */
export function append(artifact: DomElement, unitId: string, extra: DomNode): DomElement {
  return edit(artifact, unitId, (found) => ({ ...found, children: [...found.children, extra] }));
}

/** Move a unit out of where it was rendered and onto the end of the page. */
export function exile(artifact: DomElement, unitId: string): DomElement {
  let removed: DomElement | undefined;
  const without = edit(artifact, unitId, (found) => {
    removed = found;
    return undefined;
  });
  if (removed === undefined) throw new Error(`nothing marked ${unitId} to exile`);
  return { ...without, children: [...without.children, element("footer", {}, [removed])] };
}

export function paragraph(...content: string[]): DomElement {
  return element("p", {}, content.map((piece) => text(piece)));
}

/**
 * The affidavit a renderer would produce for the document in front of it.
 *
 * Deliberately not `attestRender`, which refuses to sign a page that will not
 * verify. This is the other side of that door: a witness with no scruples and
 * no policy, reporting exactly what the walk found. The kernel is not entitled
 * to assume the record was produced by something on its side.
 */
export function swearTo(artifact: DomElement, renderedAt: string): RenderAffidavit {
  const walk = walkArtifact(artifact);
  return {
    transactionId: walk.transactionId ?? "",
    artifactDigest: walk.digest,
    renderedAt,
    units: walk.units.map((unit) => ({ id: unit.id, visible: unit.visible })),
  };
}
