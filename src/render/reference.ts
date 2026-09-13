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
  TEMPLATE_ATTRIBUTE,
  COPY_ATTRIBUTE,
  type DomElement,
  type DomNode,
  element,
  LOCALE_ATTRIBUTE,
  SLOT_ATTRIBUTE,
  SUGGESTION_ATTRIBUTE,
  text,
  TRANSACTION_ATTRIBUTE,
  UNIT_ATTRIBUTE,
} from "../kernel/dom.js";
import { type AccordPack, blockFor, copyFor, templateFor } from "../kernel/pack.js";
import type { RenderPlan, RenderSlot, RenderUnit, RenderUnitKind } from "../kernel/render.js";

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
  // A listing is several memberships in one sentence; with no template it
  // falls back to the membership lead-in over its bound slots.
  listing: "lead-in.membership",
  // A profile is several facts about one entity, introduced once and laid
  // out as a labelled list — see `profileCard`.
  profile: "lead-in.profile",
  // The Center kinds ship with sentence templates in their own pack; with no
  // template and no catalogued lead-in they render bare bound slots, which is
  // ugly and safe — the pack that owns them is where their words live.
  treats: undefined,
  comparison: undefined,
  selection: "lead-in.selection",
  matchup: "lead-in.matchup",
  eligibility: "lead-in.eligibility",
  // A lesson introduces itself the way a warning does: its block is the whole
  // of what it has to say, and a lead-in would be prose about prose.
  explanation: undefined,
  recommendation: "lead-in.recommendation",
  action: "lead-in.action",
  warning: undefined,
  provenance: "provenance.snapshot",
  // The suggestion register (R3b step 4) is introduced by the one line that
  // labels it as the Advisor's own, uncertified — the label is the closure.
  suggestions: "suggestions.lead",
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
  if (unit.kind === "suggestions") return suggestionRegister(pack, plan, unit);
  const tag = unit.kind === "provenance" ? "footer" : "section";
  return element(tag, { [UNIT_ATTRIBUTE]: unit.id }, [
    ...block(pack, plan, unit),
    ...(unit.kind === "profile"
      ? profileCard(pack, plan, unit)
      : unit.sentence !== undefined
        ? [sentence(pack, plan, unit)]
        : unit.slots.length === 0
          ? []
          : [element("p", {}, [...leadIn(pack, plan, unit), ...slots(unit)])]),
    ...disclosures.map((disclosure) =>
      element("aside", { [UNIT_ATTRIBUTE]: disclosure.id }, [
        ...block(pack, plan, disclosure),
        ...(disclosure.sentence !== undefined
          ? [sentence(pack, plan, disclosure)]
          : disclosure.slots.length === 0
            ? []
            : [element("p", {}, [...leadIn(pack, plan, disclosure), ...slots(disclosure)])]),
      ]),
    ),
  ]);
}

/**
 * The suggestion register (R3b step 4): the catalogued label that says whose
 * words these are, then each follow-up question as a marked item, numbered
 * in the manifest's order. The words are the model's, recorded in the
 * manifest; the mark is what lets the verifier hold each one to the record
 * by equality and refuse any the record does not carry. Plain list items —
 * the mount allows no button — and a page that wants them clickable wires
 * the click itself, sending the text as the trainer's own utterance.
 */
function suggestionRegister(pack: AccordPack, plan: RenderPlan, unit: RenderUnit): DomElement {
  return element("section", { [UNIT_ATTRIBUTE]: unit.id, class: "suggestions" }, [
    element("p", {}, [...leadIn(pack, plan, unit)]),
    element(
      "ul",
      {},
      (unit.suggestions ?? []).map((suggestion, index) =>
        element("li", { [SUGGESTION_ATTRIBUTE]: String(index + 1) }, [text(suggestion)]),
      ),
    ),
  ]);
}

/**
 * A profile: the lead-in and the entity on one line, then the facts as a
 * definition list — each label and each value in its own marked span, the
 * pairs matched by the fact id the plan put in the slot names. Layout is the
 * renderer's; every word in it is a catalogued lead-in or a bound slot.
 */
function profileCard(pack: AccordPack, plan: RenderPlan, unit: RenderUnit): DomNode[] {
  const byName = new Map(unit.slots.map((slot) => [slot.name, slot]));
  const mark = (slot: RenderSlot): DomElement => element("span", { [SLOT_ATTRIBUTE]: slot.name }, [text(slot.expected)]);
  const entity = byName.get("entity");
  const facts = unit.slots.filter((slot) => slot.name.startsWith("fact:")).map((slot) => slot.name.slice("fact:".length));
  return [
    element("p", {}, [...leadIn(pack, plan, unit), ...(entity === undefined ? [] : [mark(entity)])]),
    element(
      "dl",
      {},
      facts.flatMap((factId) => {
        const label = byName.get(`fact:${factId}`);
        const value = byName.get(`value:${factId}`);
        return [
          element("dt", {}, label === undefined ? [] : [mark(label)]),
          element("dd", {}, value === undefined ? [] : [mark(value)]),
        ];
      }),
    ),
  ];
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
  const rule =
    pack.exhibits.find((entry) => entry.block.id === unit.block?.id) ??
    pack.curriculum.find((entry) => entry.block.id === unit.block?.id);
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


/**
 * The approved sentence, assembled and never written.
 *
 * The fragments are the template's own words, read from the pack; the values
 * are the plan's slot strings, each in its marked span exactly as in the
 * labelled presentation. This function chooses nothing: a template the pack
 * does not carry renders nothing (and the plan's sentence check denies the
 * page), and a placeholder with no slot behind it was refused at plan time.
 */
function sentence(pack: AccordPack, plan: RenderPlan, unit: RenderUnit): DomElement {
  const planned = unit.sentence;
  const template = templateFor(pack, unit.kind, plan.locale);
  if (planned === undefined || template === undefined) return element("p", { [TEMPLATE_ATTRIBUTE]: planned?.templateId ?? "" }, []);
  const byName = new Map(unit.slots.map((slot) => [slot.name, slot]));
  const children: DomNode[] = [];
  let cursor = 0;
  for (const match of template.text.matchAll(/\{([a-z]+)\}/g)) {
    const fragment = template.text.slice(cursor, match.index);
    if (fragment.length > 0) children.push(text(fragment));
    const slot = byName.get(match[1] as string);
    if (slot !== undefined) children.push(element("span", { [SLOT_ATTRIBUTE]: slot.name }, [text(slot.expected)]));
    cursor = match.index + match[0].length;
  }
  const tail = template.text.slice(cursor);
  if (tail.length > 0) children.push(text(tail));
  return element("p", { [TEMPLATE_ATTRIBUTE]: planned.templateId }, children);
}

/** One catalogued string, marked with the entry it came from. */
function copy(pack: AccordPack, plan: RenderPlan, id: string): DomElement {
  const approved = copyFor(pack, id, plan.locale);
  return element("span", { [COPY_ATTRIBUTE]: id }, approved === undefined ? [] : [text(approved)]);
}
