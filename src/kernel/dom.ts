/**
 * The final rendered artifact, and an independent reading of what a browser
 * would actually show of it (IA-6).
 *
 * This module is deliberately not a renderer and knows nothing about one. It
 * takes a finished document and answers three questions about it: which
 * governed units are on the screen, what text is legible inside each, and what
 * digest identifies the whole thing. Everything it reports is derived by
 * walking the tree — never from an attribute in which a renderer asserts that
 * something is visible. A renderer that could vouch for its own output would
 * make Article VI unfalsifiable, which is precisely the failure the article
 * exists to describe.
 *
 * The tree here is the small, explicit shape a browser DOM presents, not a
 * parallel universe: tags, attributes, children, text. The web UI (phase 8)
 * adapts a real `Document` into it, and the walk below is the same walk. Two
 * marks are the only thing a renderer is asked to place, and neither of them
 * claims anything about compliance: `data-transaction` says which answer this
 * artifact is, and `data-unit` says which governed unit an element is.
 */

import { createHash } from "node:crypto";

/** A governed display unit's identity, placed by the renderer. */
export const UNIT_ATTRIBUTE = "data-unit";
/** The answer this artifact claims to be. Identity, not a compliance claim. */
export const TRANSACTION_ATTRIBUTE = "data-transaction";

export interface DomText {
  kind: "text";
  text: string;
}

export interface DomElement {
  kind: "element";
  tag: string;
  attributes: Readonly<Record<string, string>>;
  children: readonly DomNode[];
}

export type DomNode = DomText | DomElement;

export function element(
  tag: string,
  attributes: Readonly<Record<string, string>> = {},
  children: readonly DomNode[] = [],
): DomElement {
  return { kind: "element", tag, attributes, children };
}

export function text(value: string): DomText {
  return { kind: "text", text: value };
}

/**
 * The ways an element can be present in the document and absent from the
 * screen. Each is named, because a denial that says only "hidden" cannot be
 * argued with: the trainer's page, the renderer's stylesheet and the
 * component library are three different places to go looking, and the name
 * says which one.
 */
export type HidingTechnique =
  | "display-none"
  | "visibility-hidden"
  | "opacity-zero"
  | "attribute"
  | "aria-hidden"
  | "collapsed-details"
  | "template";

/**
 * Below this, text is present and not readable. A disclosure at five percent
 * opacity is the fine print's oldest trick with a stylesheet instead of a
 * printing press, so the threshold is a stated number rather than a strict
 * comparison against zero.
 */
const LEGIBLE_OPACITY = 0.1;

/** One marked unit, as the document actually presents it. */
export interface WalkedUnit {
  id: string;
  visible: boolean;
  /** How it is hidden, when it is. Absent exactly when `visible`. */
  hiddenBy?: HidingTechnique;
  /**
   * The text a trainer could read inside it, normalised. Computed from the
   * visible descendants only: a warning that is on screen with its second
   * sentence in a `display:none` span has shown half a warning.
   */
  text: string;
  /** Child indices from the root — where in the document the element sits. */
  path: readonly number[];
}

export interface ArtifactWalk {
  /** What the root says this artifact is. Undefined when it is unmarked. */
  transactionId: string | undefined;
  /** Marked units in document order. */
  units: readonly WalkedUnit[];
  /** Unit ids marked on more than one element. */
  duplicated: readonly string[];
  /** Digest over the visible content, in document order. */
  digest: string;
}

// Control characters, so that no text a renderer can emit collides with a
// separator. The digest is a structured record rather than a concatenation
// for one specific reason: text that reflows across a component boundary must
// not be able to produce the digest of a different document. "Selfdestruct"
// beside an empty warning and an empty card beside "Selfdestruct" are two
// different artifacts and hash differently.
const DOCUMENT_MARK = "\u001c";
const UNIT_MARK = "\u001d";
const ELEMENT_MARK = "\u001e";
const TEXT_MARK = "\u001f";

/**
 * Read a finished artifact and report what it shows.
 *
 * Pure and total: no clock, no manifest, no policy. It cannot deny anything,
 * which is the point — the observation and the judgement are separate, so the
 * judgement can be re-run against a fresh observation and disagree.
 */
export function walkArtifact(root: DomElement): ArtifactWalk {
  const units: WalkedUnit[] = [];
  const records: string[] = [];
  const transactionId = root.attributes[TRANSACTION_ATTRIBUTE];

  records.push(`${DOCUMENT_MARK}${transactionId ?? ""}`);
  visit(root, [], undefined, units, records);

  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.id)) duplicated.add(unit.id);
    seen.add(unit.id);
  }

  return {
    transactionId,
    units,
    duplicated: [...duplicated],
    digest: `sha256:${createHash("sha256").update(records.join("")).digest("hex")}`,
  };
}

/**
 * Walk one node, returning the text it contributes to the screen.
 *
 * `hiddenBy` is inherited: an element that hides nothing itself shows nothing
 * when an ancestor is hidden. That inheritance is where a naive check fails —
 * inspecting the disclosure's own attributes and finding them innocent while
 * the section around it is `display:none`.
 */
function visit(
  node: DomNode,
  path: readonly number[],
  hiddenBy: HidingTechnique | undefined,
  units: WalkedUnit[],
  records: string[],
): string {
  if (node.kind === "text") {
    const content = normalise(node.text);
    if (hiddenBy !== undefined || content.length === 0) return "";
    records.push(`${TEXT_MARK}${content}`);
    return content;
  }

  const hidden = hiddenBy ?? hidesItself(node);
  const unitId = node.attributes[UNIT_ATTRIBUTE];
  if (hidden === undefined) {
    records.push(`${ELEMENT_MARK}${node.tag}${unitId === undefined ? "" : UNIT_MARK + unitId}`);
  }

  // A closed <details> shows its summary and nothing else. The content is in
  // the document, is one click away, and has not been disclosed.
  const collapsed = node.tag === "details" && node.attributes["open"] === undefined;

  const parts: string[] = [];
  node.children.forEach((child, index) => {
    const inherited =
      hidden ??
      (collapsed && !(child.kind === "element" && child.tag === "summary")
        ? ("collapsed-details" as const)
        : undefined);
    parts.push(visit(child, [...path, index], inherited, units, records));
  });

  // Joined with a space rather than concatenated, so that two sibling elements
  // cannot spell a required fragment between them. A fragment has to be
  // legible inside one unit, not assembled out of the layout.
  const content = parts.filter((part) => part.length > 0).join(" ");

  if (unitId !== undefined) {
    units.push({
      id: unitId,
      visible: hidden === undefined,
      ...(hidden === undefined ? {} : { hiddenBy: hidden }),
      text: content,
      path,
    });
  }
  return content;
}

/** Why this element shows nothing, ignoring its ancestors. */
function hidesItself(node: DomElement): HidingTechnique | undefined {
  // <template> content is parsed, inert and never rendered — a payload that
  // passes any "is it in the document?" check and shows the trainer nothing.
  if (node.tag === "template") return "template";
  if (node.attributes["hidden"] !== undefined) return "attribute";
  if (node.attributes["aria-hidden"] === "true") return "aria-hidden";

  const style = declarations(node.attributes["style"]);
  if (style["display"] === "none") return "display-none";
  if (style["visibility"] === "hidden" || style["visibility"] === "collapse") return "visibility-hidden";

  const opacity = style["opacity"];
  if (opacity !== undefined) {
    const value = Number(opacity);
    if (Number.isFinite(value) && value < LEGIBLE_OPACITY) return "opacity-zero";
  }
  return undefined;
}

/** Inline style declarations, lowercased. Unparseable pieces are ignored. */
function declarations(style: string | undefined): Record<string, string> {
  if (style === undefined) return {};
  const parsed: Record<string, string> = {};
  for (const piece of style.split(";")) {
    const at = piece.indexOf(":");
    if (at < 0) continue;
    parsed[piece.slice(0, at).trim().toLowerCase()] = piece.slice(at + 1).trim().toLowerCase();
  }
  return parsed;
}

export function normalise(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
