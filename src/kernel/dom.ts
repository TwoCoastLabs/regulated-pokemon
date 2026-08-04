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
 * adapts a real `Document` into it, and the walk below is the same walk.
 *
 * The marks a renderer places are identities, never compliance claims.
 * `data-transaction` and `data-locale` say which answer this artifact is and
 * how it was localised; `data-unit` says which governed unit an element is; and
 * `data-slot`, `data-block` and `data-copy` each say where a piece of text came
 * from — a certified value, an approved disclosure, or the copy catalogue.
 * Every one of them is a claim the walker can check and the kernel can refuse.
 */

import { createHash } from "node:crypto";

/** A governed display unit's identity, placed by the renderer. */
export const UNIT_ATTRIBUTE = "data-unit";
/** The answer this artifact claims to be. Identity, not a compliance claim. */
export const TRANSACTION_ATTRIBUTE = "data-transaction";
/** The locale this artifact claims to be presented in. */
export const LOCALE_ATTRIBUTE = "data-locale";
/** A certified value, named by the slot the plan asked for. */
export const SLOT_ATTRIBUTE = "data-slot";
/** Mandatory disclosure text, named by the block it claims to be. */
export const BLOCK_ATTRIBUTE = "data-block";
/** Renderer copy, named by its entry in the pack's catalogue. */
export const COPY_ATTRIBUTE = "data-copy";

/**
 * The three things visible text on a certified artifact may be.
 *
 * There is no fourth, and that is the whole of "text closure": every visible
 * character is either a certified value, an approved disclosure, or a
 * catalogued string, and anything else is denied. Default-deny for text, the
 * way a content security policy is default-deny for script — the model picks
 * components and fills slots, and cannot write onto the artifact at all.
 */
export type AttributionKind = "slot" | "block" | "copy";

const ATTRIBUTION_ATTRIBUTES: ReadonlyArray<readonly [AttributionKind, string]> = [
  ["slot", SLOT_ATTRIBUTE],
  ["block", BLOCK_ATTRIBUTE],
  ["copy", COPY_ATTRIBUTE],
];

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

/**
 * One piece of attributed text, as the document presents it.
 *
 * `unitId` is the governed unit it sits inside, or nothing when it sits outside
 * them all — a page heading is attributed copy that belongs to no unit, and a
 * *slot* that belongs to no unit is a certified value nobody planned.
 */
export interface WalkedText {
  kind: AttributionKind;
  /** The slot name, block id, or catalogue id the renderer claimed. */
  name: string;
  unitId: string | undefined;
  text: string;
  visible: boolean;
  path: readonly number[];
}

/** Visible text the renderer attributed to nothing at all. */
export interface UnattributedText {
  text: string;
  unitId: string | undefined;
  path: readonly number[];
}

export interface ArtifactWalk {
  /** What the root says this artifact is. Undefined when it is unmarked. */
  transactionId: string | undefined;
  /** What the root says it was localised for. Undefined when unmarked. */
  locale: string | undefined;
  /** Marked units in document order. */
  units: readonly WalkedUnit[];
  /** Unit ids marked on more than one element. */
  duplicated: readonly string[];
  /** Every attributed piece of text, in document order. */
  attributed: readonly WalkedText[];
  /** Every visible piece of text that claimed no origin. */
  unattributed: readonly UnattributedText[];
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
  const found: Found = { units: [], attributed: [], unattributed: [], records: [] };
  const transactionId = root.attributes[TRANSACTION_ATTRIBUTE];
  const locale = root.attributes[LOCALE_ATTRIBUTE];

  found.records.push(`${DOCUMENT_MARK}${transactionId ?? ""}${UNIT_MARK}${locale ?? ""}`);
  visit(root, [], { hiddenBy: undefined, unitId: undefined, attributed: false }, found);

  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const unit of found.units) {
    if (seen.has(unit.id)) duplicated.add(unit.id);
    seen.add(unit.id);
  }

  return {
    transactionId,
    locale,
    units: found.units,
    duplicated: [...duplicated],
    attributed: found.attributed,
    unattributed: found.unattributed,
    digest: `sha256:${createHash("sha256").update(found.records.join("")).digest("hex")}`,
  };
}

/** What the walk has learned so far. Accumulated, never consulted. */
interface Found {
  units: WalkedUnit[];
  attributed: WalkedText[];
  unattributed: UnattributedText[];
  records: string[];
}

/** What an element inherits from its ancestors. */
interface Inherited {
  hiddenBy: HidingTechnique | undefined;
  unitId: string | undefined;
  /** Whether some ancestor already said where this text came from. */
  attributed: boolean;
}

/**
 * Walk one node, returning the text it contributes to the screen.
 *
 * Everything in {@link Inherited} descends, and each piece of it is where a
 * naive check fails. `hiddenBy`: inspecting a disclosure's own attributes and
 * finding them innocent while the section around it is `display:none`.
 * `unitId`: reading a value that is on the page but not inside the unit that
 * owes it. `attributed`: accepting a sentence because it happens to sit next to
 * one the renderer was allowed to write.
 */
function visit(node: DomNode, path: readonly number[], inherited: Inherited, found: Found): string {
  if (node.kind === "text") {
    const content = normalise(node.text);
    if (inherited.hiddenBy !== undefined || content.length === 0) return "";
    found.records.push(`${TEXT_MARK}${content}`);
    // Default-deny for text: the walker only reports it, but nothing here
    // decides that free prose is harmless, and the verifier has no way to
    // overlook it.
    if (!inherited.attributed) {
      found.unattributed.push({ text: content, unitId: inherited.unitId, path });
    }
    return content;
  }

  const hidden = inherited.hiddenBy ?? hidesItself(node);
  const unitId = node.attributes[UNIT_ATTRIBUTE];
  const attribution = attributionOf(node);
  if (hidden === undefined) {
    found.records.push(
      `${ELEMENT_MARK}${node.tag}` +
        `${unitId === undefined ? "" : UNIT_MARK + unitId}` +
        `${attribution === undefined ? "" : UNIT_MARK + attribution.kind + ":" + attribution.name}`,
    );
  }

  // A closed <details> shows its summary and nothing else. The content is in
  // the document, is one click away, and has not been disclosed.
  const collapsed = node.tag === "details" && node.attributes["open"] === undefined;

  const descends: Inherited = {
    hiddenBy: hidden,
    unitId: unitId ?? inherited.unitId,
    attributed: inherited.attributed || attribution !== undefined,
  };

  const parts: string[] = [];
  node.children.forEach((child, index) => {
    const hiddenForChild =
      hidden ??
      (collapsed && !(child.kind === "element" && child.tag === "summary")
        ? ("collapsed-details" as const)
        : undefined);
    parts.push(visit(child, [...path, index], { ...descends, hiddenBy: hiddenForChild }, found));
  });

  // Joined with a space rather than concatenated, so that two sibling elements
  // cannot spell a bound value between them. A value has to be legible inside
  // the one element that claims to be showing it, not assembled out of layout.
  const content = parts.filter((part) => part.length > 0).join(" ");

  if (unitId !== undefined) {
    found.units.push({
      id: unitId,
      visible: hidden === undefined,
      ...(hidden === undefined ? {} : { hiddenBy: hidden }),
      text: content,
      path,
    });
  }
  if (attribution !== undefined) {
    found.attributed.push({
      kind: attribution.kind,
      name: attribution.name,
      unitId: unitId ?? inherited.unitId,
      text: content,
      visible: hidden === undefined,
      path,
    });
  }
  return content;
}

/** Where this element says its text came from, if it says anything. */
function attributionOf(node: DomElement): { kind: AttributionKind; name: string } | undefined {
  for (const [kind, attribute] of ATTRIBUTION_ATTRIBUTES) {
    const name = node.attributes[attribute];
    if (name !== undefined) return { kind, name };
  }
  return undefined;
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
