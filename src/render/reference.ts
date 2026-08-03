/**
 * The reference renderer.
 *
 * Deliberately outside `src/kernel/`. This is the *untrusted* half of Article
 * VI: the thing that turns a plan into a page, and the thing the walker is
 * built to disbelieve. Nothing it emits is taken on trust, it has no way to
 * assert that anything is visible, and the crucible sabotages its output
 * without touching it — because a real renderer is a component library, a
 * design system and a stylesheet, none of which this project controls.
 *
 * The division of labour used to be "copy is the renderer's, bound fragments
 * are not". It is stricter now, and simpler to state: **the renderer chooses
 * arrangement and nothing else.** Certified values go into named slots it does
 * not compute, mandatory disclosures are blocks it does not word, and every
 * other string on the page is an entry it looks up in the pack's copy
 * catalogue. There is no sentence this file can compose, which is what makes
 * text closure enforceable one layer up.
 */

import {
  BLOCK_ATTRIBUTE,
  COPY_ATTRIBUTE,
  type DomElement,
  type DomNode,
  element,
  LOCALE_ATTRIBUTE,
  SLOT_ATTRIBUTE,
  text,
  TRANSACTION_ATTRIBUTE,
  UNIT_ATTRIBUTE,
} from "../kernel/dom.js";
import { type AccordPack, blockFor, copyFor } from "../kernel/pack.js";
import type { RenderPlan, RenderUnit, RenderUnitKind } from "../kernel/render.js";

/**
 * Which catalogued string introduces each kind of unit.
 *
 * The ids are the renderer's choice; the words behind them are not. A warning
 * introduces itself — its block is the whole of what it has to say — and a
 * provenance notice labels the snapshot it names.
 */
const LEAD_IN: Record<RenderUnitKind, string | undefined> = {
  fact: "lead-in.fact",
  count: "lead-in.count",
  membership: "lead-in.membership",
  selection: "lead-in.selection",
  recommendation: "lead-in.recommendation",
  warning: undefined,
  provenance: "provenance.snapshot",
};

/** Render a plan into a finished artifact. */
export function renderAnswer(pack: AccordPack, plan: RenderPlan): DomElement {
  const disclosures = new Map<string, RenderUnit[]>();
  for (const unit of plan.units) {
    if (unit.discloses === undefined) continue;
    const beside = disclosures.get(unit.discloses) ?? [];
    beside.push(unit);
    disclosures.set(unit.discloses, beside);
  }

  const body: DomNode[] = [
    element("header", {}, [
      element("h1", {}, [copy(pack, plan, "page.title")]),
      element("p", {}, [copy(pack, plan, "page.lead")]),
    ]),
  ];

  for (const unit of plan.units) {
    if (unit.discloses !== undefined) continue;
    body.push(card(pack, plan, unit, disclosures.get(unit.id) ?? []));
  }

  return element(
    "article",
    { [TRANSACTION_ATTRIBUTE]: plan.transactionId, [LOCALE_ATTRIBUTE]: plan.locale },
    body,
  );
}

/** One governed unit, with any disclosure it triggered nested inside it. */
function card(pack: AccordPack, plan: RenderPlan, unit: RenderUnit, disclosures: readonly RenderUnit[]): DomElement {
  const tag = unit.kind === "provenance" ? "footer" : "section";
  return element(tag, { [UNIT_ATTRIBUTE]: unit.id }, [
    ...block(pack, plan, unit),
    ...(unit.slots.length === 0 ? [] : [element("p", {}, [...leadIn(pack, plan, unit), ...slots(unit)])]),
    ...disclosures.map((disclosure) =>
      element("aside", { [UNIT_ATTRIBUTE]: disclosure.id }, [
        ...block(pack, plan, disclosure),
        ...(disclosure.slots.length === 0
          ? []
          : [element("p", {}, [...leadIn(pack, plan, disclosure), ...slots(disclosure)])]),
      ]),
    ),
  ]);
}

/**
 * The mandatory text, marked as the block it is.
 *
 * The words are read out of the pack rather than held here, so this file has no
 * copy of a disclosure that could drift from the approved one. If the pack has
 * nothing to say in this locale the paragraph is emitted empty and the digest
 * check denies it — a renderer inventing replacement wording is exactly the
 * failure the block exists to prevent.
 */
function block(pack: AccordPack, plan: RenderPlan, unit: RenderUnit): DomNode[] {
  if (unit.block === undefined) return [];
  const rule = pack.exhibits.find((entry) => entry.block.id === unit.block?.id);
  const content = rule === undefined ? undefined : blockFor(rule, plan.locale);
  return [element("p", { [BLOCK_ATTRIBUTE]: unit.block.id }, content === undefined ? [] : [text(content.text)])];
}

function leadIn(pack: AccordPack, plan: RenderPlan, unit: RenderUnit): DomNode[] {
  const id = LEAD_IN[unit.kind];
  return id === undefined ? [] : [copy(pack, plan, id)];
}

/**
 * The certified values, each in its own marked span, in plan order.
 *
 * The string is the plan's, character for character. A renderer that "tidied"
 * one would be writing a value the kernel never approved, and the equality
 * check is deliberately unforgiving about it.
 */
function slots(unit: RenderUnit): DomNode[] {
  return unit.slots.map((slot) => element("span", { [SLOT_ATTRIBUTE]: slot.name }, [text(slot.expected)]));
}

/** One catalogued string, marked with the entry it came from. */
function copy(pack: AccordPack, plan: RenderPlan, id: string): DomElement {
  const approved = copyFor(pack, id, plan.locale);
  return element("span", { [COPY_ATTRIBUTE]: id }, approved === undefined ? [] : [text(approved)]);
}
