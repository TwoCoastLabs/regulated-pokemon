/**
 * The reference renderer, held to the promise its module comment makes: it
 * arranges, and it does not write.
 *
 * The crucible attacks the finished page and never touches this file, which is
 * right — a real renderer is somebody else's component library. But the claim
 * that *this* renderer cannot compose a sentence needs its own test, because
 * the tempting shortcut is a fallback string. Every case below takes a word
 * away from it and checks that the page comes back short rather than
 * improvised, and that the kernel then refuses the page.
 */

import { describe, expect, it } from "vitest";

import type { AnswerManifest, Claim } from "../kernel/contracts.js";
import { compileManifest, type ManifestContext } from "../kernel/manifest.js";
import type { AccordPack } from "../kernel/pack.js";
import { attestRender, planRender, type RenderPlan, verifyRender } from "../kernel/render.js";
import { denialCode } from "../kernel/violation.js";
import { manifestContext } from "../testing/fixtures.js";
import { renderAnswer } from "./reference.js";

const world: ManifestContext = manifestContext();
const RENDERED_AT = "2026-01-01T12:00:00Z";

const SPEED: Claim = {
  kind: "fact",
  entityId: "pikachu",
  factId: "base-speed",
  asserted: { kind: "number", value: 90 },
};

function answer(): AnswerManifest {
  const compiled = compileManifest(world, { transactionId: "txn-reference", claims: [SPEED], rosters: [] });
  if (!compiled.ok) throw new Error(compiled.violations.map(denialCode).join(", "));
  return compiled.value;
}

function plan(): RenderPlan {
  const planned = planRender(world, answer());
  if (!planned.ok) throw new Error(planned.violations.map(denialCode).join(", "));
  return planned.value;
}

/** Verify a page against the *real* pack, whatever pack drew it. */
function denials(pack: AccordPack): string[] {
  const artifact = renderAnswer(pack, plan());
  const walked = attestRender(world, answer(), artifact, RENDERED_AT);
  if (walked.ok) return verifyRender(world, answer(), artifact, walked.value).violations.map(denialCode);
  return walked.violations.map(denialCode);
}

describe("the reference renderer", () => {
  it("draws a page the kernel signs without a single denial", () => {
    expect(denials(world.pack)).toEqual([]);
  });

  it("cannot invent copy the catalogue does not carry", () => {
    const withoutLeadIn: AccordPack = {
      ...world.pack,
      presentation: {
        ...world.pack.presentation,
        catalogue: world.pack.presentation.catalogue.filter((entry) => entry.id !== "lead-in.fact"),
      },
    };
    // Not "the renderer falls back to something sensible" — there is nothing
    // to fall back to, so the page is short and the kernel says so.
    expect(denials(withoutLeadIn)).toContain("IA-6/catalogue-drift");
  });

  it("cannot invent the words of a disclosure it has no approved text for", () => {
    const renamed: AccordPack = {
      ...world.pack,
      exhibits: world.pack.exhibits.map((rule) => ({ ...rule, block: { ...rule.block, id: `${rule.block.id}-v2` } })),
    };
    expect(denials(renamed)).toContain("IA-2/disclosure-block-altered");
  });
});
