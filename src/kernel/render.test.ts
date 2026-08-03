/**
 * The render plan and the affidavit, on their own.
 *
 * The crucible sabotages a full page and asserts the named denial. These tests
 * are about the two joints that sabotage cannot reach: what the plan derives
 * from a manifest before anything is drawn, and how a fragment is matched once
 * it is. The matching rule is where a plausible implementation quietly fails —
 * a substring check accepts a card reading 190 as proof that the certified 90
 * was shown.
 */

import { describe, expect, it } from "vitest";

import type { AnswerManifest, Claim, ClosedRoster, RenderAffidavit } from "./contracts.js";
import { type DomElement, type DomNode, element, text } from "./dom.js";
import { compileManifest, type ManifestContext } from "./manifest.js";
import { attestRender, planRender, verifyRender } from "./render.js";
import { buildRoster } from "./roster.js";
import { denialCode } from "./violation.js";
import { manifestContext } from "../testing/fixtures.js";

const world: ManifestContext = manifestContext();
const RENDERED_AT = "2026-01-01T12:00:00Z";

const SPEED: Claim = {
  kind: "fact",
  entityId: "pikachu",
  factId: "base-speed",
  asserted: { kind: "number", value: 90 },
};

function boomers(): ClosedRoster {
  const built = buildRoster(world.registry, "selfdestruct-learners", {
    all: [{ kind: "learns-move", move: "self-destruct" }],
  });
  if (!built.ok) throw new Error("the fixture roster does not build");
  return built.value;
}

function answer(claims: readonly Claim[], rosters: readonly ClosedRoster[] = []): AnswerManifest {
  const compiled = compileManifest(world, { transactionId: "txn-render", claims, rosters });
  if (!compiled.ok) throw new Error(compiled.violations.map(denialCode).join(", "));
  return compiled.value;
}

function plan(manifest: AnswerManifest) {
  const planned = planRender(world, manifest);
  if (!planned.ok) throw new Error(planned.violations.map(denialCode).join(", "));
  return planned.value;
}

function unit(id: string, ...children: DomNode[]): DomElement {
  return element("section", { "data-unit": id }, children);
}

/** A page for the one-fact answer, with each unit's text supplied by the test. */
function page(fact: DomNode[], provenance = [text("PokeAPI BSD-3-Clause kanto-red-blue")]): DomElement {
  return element("article", { "data-transaction": "txn-render" }, [
    unit("fact:pikachu:base-speed", ...fact),
    unit("provenance", ...provenance),
  ]);
}

function denials(artifact: DomElement, affidavit?: RenderAffidavit): string[] {
  const manifest = answer([SPEED]);
  const sworn = affidavit ?? attest(artifact);
  return verifyRender(world, manifest, artifact, sworn).violations.map(denialCode);
}

function attest(artifact: DomElement): RenderAffidavit {
  const attested = attestRender(world, answer([SPEED]), artifact, RENDERED_AT);
  // Deliberately permissive: several tests attest a page that will not verify,
  // and want the affidavit that honestly describes it.
  if (attested.ok) return attested.value;
  return {
    transactionId: "txn-render",
    artifactDigest: "sha256:unattested",
    renderedAt: RENDERED_AT,
    units: [],
  };
}

describe("the plan derived from a manifest", () => {
  it("gives every claim a unit with its bound values", () => {
    expect(plan(answer([SPEED])).units).toEqual([
      {
        id: "fact:pikachu:base-speed",
        kind: "fact",
        requiredFragments: ["pikachu", "90"],
        article: "IA-6",
      },
      {
        id: "provenance",
        kind: "provenance",
        requiredFragments: ["PokeAPI", "BSD-3-Clause", "kanto-red-blue"],
        article: "IA-2",
      },
    ]);
  });

  it("shows one card for a claim the answer happens to make twice", () => {
    const units = plan(answer([SPEED, SPEED])).units;
    expect(units.filter((entry) => entry.id === "fact:pikachu:base-speed")).toHaveLength(1);
  });

  it("anchors a triggered disclosure to the unit that triggered it", () => {
    const manifest = answer([{ kind: "count", rosterId: "selfdestruct-learners", reported: boomers().cardinality }], [boomers()]);
    const warning = plan(manifest).units.find((entry) => entry.id === "selfdestruct-warning");
    expect(warning?.discloses).toBe("count:selfdestruct-learners");
  });

  it("refuses to plan a disclosure with nothing on screen to sit beside", () => {
    // The set is carried, so the pack requires the warning; no claim cites the
    // set, so nothing the trainer sees is about Selfdestruct at all.
    const manifest = answer([SPEED], [boomers()]);
    const planned = planRender(world, manifest);
    expect(planned.ok).toBe(false);
    expect(planned.ok ? [] : planned.violations.map(denialCode)).toContain("IA-6/disclosure-without-anchor");
  });

  it("refuses to plan an answer that does not verify", () => {
    const doctored: AnswerManifest = { ...answer([SPEED]), snapshotId: "kanto-yellow" };
    const planned = planRender(world, doctored);
    expect(planned.ok).toBe(false);
    expect(planned.ok ? [] : planned.violations.map(denialCode)).toContain("IA-2/snapshot-mismatch");
  });
});

describe("matching a bound fragment against what is on the screen", () => {
  it("accepts the certified value", () => {
    expect(denials(page([text("Pikachu — base speed 90")]))).toEqual([]);
  });

  it("accepts a fragment wrapped in inline markup", () => {
    expect(
      denials(
        page([
          element("b", {}, [text("Pikachu")]),
          text(" — base speed "),
          element("strong", {}, [text("90")]),
        ]),
      ),
    ).toEqual([]);
  });

  it("does not accept a longer number that contains the certified one", () => {
    expect(denials(page([text("Pikachu — base speed 190")]))).toContain("IA-6/exhibit-fragment-not-visible");
  });

  it("does not accept a word assembled out of two sibling elements", () => {
    const split = page([
      text("Pikachu — base speed "),
      element("span", {}, [text("9")]),
      element("span", {}, [text("0")]),
    ]);
    expect(denials(split)).toContain("IA-6/exhibit-fragment-not-visible");
  });

  it("does not accept the right words in the wrong order", () => {
    expect(denials(page([text("Pikachu — base speed 90")], [text("kanto-red-blue BSD-3-Clause PokeAPI")]))).toContain(
      "IA-2/exhibit-fragments-out-of-order",
    );
  });

  it("names the article of the rule that required the fragment", () => {
    // Provenance is an IA-2 obligation the pack expresses as an exhibit, so a
    // missing licence is denied as an attribution failure, not as prominence.
    expect(denials(page([text("Pikachu — base speed 90")], [text("PokeAPI kanto-red-blue")]))).toContain(
      "IA-2/exhibit-fragment-not-visible",
    );
  });
});

describe("the affidavit", () => {
  const honest = page([text("Pikachu — base speed 90")]);

  it("is derived from the artifact, not from the manifest", () => {
    const attested = attestRender(world, answer([SPEED]), honest, RENDERED_AT);
    expect(attested.ok && attested.value).toMatchObject({
      transactionId: "txn-render",
      renderedAt: RENDERED_AT,
      units: [
        { id: "fact:pikachu:base-speed", visible: true },
        { id: "provenance", visible: true },
      ],
    });
  });

  it("is refused rather than signed when the artifact would not verify", () => {
    const attested = attestRender(world, answer([SPEED]), page([text("Pikachu — base speed 200")]), RENDERED_AT);
    expect(attested.ok).toBe(false);
  });

  it("is refused when it does not say when the artifact was shown", () => {
    const attested = attestRender(world, answer([SPEED]), honest, "whenever");
    expect(attested.ok ? [] : attested.violations.map(denialCode)).toContain("IA-6/affidavit-time-unreadable");
  });

  it("cannot be sworn over one artifact and presented with another", () => {
    const elsewhere: RenderAffidavit = { ...attest(honest), transactionId: "txn-somewhere-else" };
    expect(denials(honest, elsewhere)).toContain("IA-6/affidavit-transaction-mismatch");
  });

  it("cannot omit a unit the artifact marked", () => {
    const sworn = attest(honest);
    const short: RenderAffidavit = { ...sworn, units: sworn.units.slice(0, 1) };
    expect(denials(honest, short)).toContain("IA-6/affidavit-visibility-mismatch");
  });
});
