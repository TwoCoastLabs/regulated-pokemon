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
 * The division of labour is the point. Copy is the renderer's: the headings,
 * the connective sentences, the order of the cards on the page. Bound
 * fragments are not — they come from the certified answer and the Accord pack,
 * and the renderer's only job with them is to put them on the screen, in the
 * order given, inside the unit that owns them.
 */

import {
  type DomElement,
  type DomNode,
  element,
  text,
  TRANSACTION_ATTRIBUTE,
  UNIT_ATTRIBUTE,
} from "../kernel/dom.js";
import type { RenderPlan, RenderUnit, RenderUnitKind } from "../kernel/render.js";

/** Renderer-owned copy: a lead-in per kind of unit. Says nothing bound. */
const LEAD_IN: Record<RenderUnitKind, string> = {
  fact: "From the certified registry:",
  count: "Certified count for this set:",
  membership: "Membership in this set:",
  selection: "The one that comes out on top:",
  recommendation: "What I would go for, given your badges:",
  warning: "Before you do anything with this — mandatory handling notice:",
  provenance: "Where all of this comes from:",
};

/** Render a plan into a finished artifact. */
export function renderAnswer(plan: RenderPlan): DomElement {
  const disclosures = new Map<string, RenderUnit[]>();
  for (const unit of plan.units) {
    if (unit.discloses === undefined) continue;
    const beside = disclosures.get(unit.discloses) ?? [];
    beside.push(unit);
    disclosures.set(unit.discloses, beside);
  }

  const body: DomNode[] = [
    element("header", {}, [
      element("h1", {}, [text("Your certified answer")]),
      element("p", {}, [
        text("Everything below was recomputed from the pinned registry before it reached this page."),
      ]),
    ]),
  ];

  for (const unit of plan.units) {
    if (unit.discloses !== undefined) continue;
    body.push(card(unit, disclosures.get(unit.id) ?? []));
  }

  return element("article", { [TRANSACTION_ATTRIBUTE]: plan.transactionId }, body);
}

/** One governed unit, with any disclosure it triggered nested inside it. */
function card(unit: RenderUnit, disclosures: readonly RenderUnit[]): DomElement {
  const tag = unit.kind === "provenance" ? "footer" : "section";
  return element(tag, { [UNIT_ATTRIBUTE]: unit.id }, [
    element("p", {}, [text(LEAD_IN[unit.kind]), ...fragments(unit)]),
    ...disclosures.map((disclosure) =>
      element("aside", { [UNIT_ATTRIBUTE]: disclosure.id }, [
        element("p", {}, [text(LEAD_IN[disclosure.kind]), ...fragments(disclosure)]),
      ]),
    ),
  ]);
}

/**
 * The bound fragments, each in its own span, in the order the plan gave them,
 * with renderer-owned punctuation between. The spans exist so that a reader of
 * the DOM can see which words the renderer was not free to choose.
 */
function fragments(unit: RenderUnit): DomNode[] {
  return unit.requiredFragments.flatMap((fragment, index) => [
    text(index === 0 ? " " : " — "),
    element("span", { class: "bound" }, [text(display(fragment))]),
  ]);
}

/**
 * Capitalisation is copy: "pikachu" is an entity id and "Pikachu" is how a
 * page writes it. The words themselves are untouched, which is all the
 * fragment check reads.
 */
function display(fragment: string): string {
  if (!/^[a-z]/.test(fragment)) return fragment;
  return fragment.charAt(0).toUpperCase() + fragment.slice(1);
}
