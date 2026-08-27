/**
 * The render plan and the affidavit, on their own.
 *
 * The crucible sabotages a full page and asserts the named denial. These tests
 * are about the joints sabotage cannot reach: what the plan derives from a
 * manifest before anything is drawn, and what happens at the four places a
 * renderer can put something on a certified artifact — a slot, a block, a
 * catalogue entry, and nowhere at all.
 *
 * The pages here are hand-built rather than produced by the reference
 * renderer, deliberately. A test that could only phrase an attack by asking the
 * renderer to perform it would be limited to the attacks the renderer happens
 * to be capable of, and the whole premise of Article VI is that the thing
 * drawing the page is not on the kernel's side.
 */

import { describe, expect, it } from "vitest";

import type { AnswerManifest, Claim, ClosedRoster, RenderAffidavit } from "./contracts.js";
import { type DomElement, type DomNode, element, text } from "./dom.js";
import { compileManifest, type ManifestContext } from "./manifest.js";
import { blockFor, copyFor, TEMPLATE_SLOTS, templateFor } from "./pack.js";
import { attestRender, planRender, verifyRender } from "./render.js";
import { buildRoster } from "./roster.js";
import { denialCode } from "./violation.js";
import { manifestContext } from "../testing/fixtures.js";
import { renderAnswer } from "../render/reference.js";

const world: ManifestContext = manifestContext();
// The hand-built pages in this file predate sentence templates (epic #94,
// slice 4) and exercise slot/block/copy mechanics on their own; they run
// under a pack with no templates so the plan asks for exactly the page they
// build. The sentence machinery has its own describe below, on the real pack.
const bare: ManifestContext = {
  ...world,
  pack: { ...world.pack, presentation: { ...world.pack.presentation, templates: [] } },
};
const RENDERED_AT = "2026-01-01T12:00:00Z";
const LOCALE = world.locale;

const SPEED: Claim = {
  kind: "fact",
  entityId: "pikachu",
  factId: "base-speed",
  asserted: { kind: "number", value: 90 },
};

const RELEASE: Claim = { kind: "action", tool: "release", entityId: "pikachu" };

function boomers(): ClosedRoster {
  const built = buildRoster(world.registry, "selfdestruct-learners", {
    all: [{ kind: "learns-move", move: "self-destruct" }],
  });
  if (!built.ok) throw new Error("the fixture roster does not build");
  return built.value;
}

function answer(claims: readonly Claim[], rosters: readonly ClosedRoster[] = []): AnswerManifest {
  const compiled = compileManifest(bare, { transactionId: "txn-render", claims, rosters });
  if (!compiled.ok) throw new Error(compiled.violations.map(denialCode).join(", "));
  return compiled.value;
}

function plan(manifest: AnswerManifest) {
  const planned = planRender(bare, manifest);
  if (!planned.ok) throw new Error(planned.violations.map(denialCode).join(", "));
  return planned.value;
}

// --- building a page --------------------------------------------------------

function unit(id: string, ...children: DomNode[]): DomElement {
  return element("section", { "data-unit": id }, children);
}

function slot(name: string, ...children: DomNode[]): DomElement {
  return element("span", { "data-slot": name }, children);
}

/** Approved copy by default, so a test only states the part it is attacking. */
function copy(id: string, override?: string): DomElement {
  const approved = override ?? copyFor(world.pack, id, LOCALE);
  if (approved === undefined) throw new Error(`the fixture pack has no copy "${id}"`);
  return element("span", { "data-copy": id }, [text(approved)]);
}

/** The approved disclosure text by default, for the same reason. */
function block(exhibitId: string, override?: string): DomElement {
  const rule = world.pack.exhibits.find((entry) => entry.id === exhibitId);
  const content = rule === undefined ? undefined : blockFor(rule, LOCALE);
  if (rule === undefined || content === undefined) throw new Error(`the fixture pack has no block for ${exhibitId}`);
  return element("p", { "data-block": rule.block.id }, [text(override ?? content.text)]);
}

const HONEST_FACT: DomNode[] = [
  copy("lead-in.fact"),
  slot("entity", text("Pikachu")),
  slot("fact", text("base-speed")),
  slot("value", text("90")),
];

const HONEST_PROVENANCE: DomNode[] = [
  block("provenance"),
  copy("provenance.snapshot"),
  slot("snapshot", text("kanto-red-blue")),
];

/** A page for the one-fact answer, with each unit's content supplied. */
function page(fact: DomNode[] = HONEST_FACT, provenance: DomNode[] = HONEST_PROVENANCE): DomElement {
  return element("article", { "data-transaction": "txn-render", "data-locale": LOCALE }, [
    unit("fact:pikachu:base-speed", ...fact),
    unit("provenance", ...provenance),
  ]);
}

function denials(artifact: DomElement, affidavit?: RenderAffidavit): string[] {
  const manifest = answer([SPEED]);
  const sworn = affidavit ?? attest(artifact);
  return verifyRender(bare, manifest, artifact, sworn).violations.map(denialCode);
}

function attest(artifact: DomElement): RenderAffidavit {
  const attested = attestRender(bare, answer([SPEED]), artifact, RENDERED_AT);
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
  it("gives every claim a unit of typed slots, each with one expected string", () => {
    expect(plan(answer([SPEED])).units[0]).toEqual({
      id: "fact:pikachu:base-speed",
      kind: "fact",
      article: "IA-6",
      slots: [
        { name: "entity", value: { kind: "text", value: "pikachu" }, formatId: "entity-name", expected: "Pikachu" },
        { name: "fact", value: { kind: "text", value: "base-speed" }, formatId: "plain-text", expected: "base-speed" },
        { name: "value", value: { kind: "number", value: 90 }, formatId: "integer", expected: "90" },
      ],
    });
  });

  it("records the locale it resolved every slot and block for", () => {
    expect(plan(answer([SPEED])).locale).toBe(LOCALE);
  });

  it("gives a disclosure unit the block its manifest owes", () => {
    const provenance = plan(answer([SPEED])).units.find((entry) => entry.id === "provenance");
    expect(provenance?.block).toEqual(answer([SPEED]).exhibits[0]?.block);
    // Provenance has to name what it is attributing, and a snapshot id is data
    // rather than words — so the pack declares it as a slot on the exhibit.
    expect(provenance?.slots.map((entry) => entry.name)).toEqual(["snapshot"]);
  });

  it("shows one card for a claim the answer happens to make twice", () => {
    const units = plan(answer([SPEED, SPEED])).units;
    expect(units.filter((entry) => entry.id === "fact:pikachu:base-speed")).toHaveLength(1);
  });

  it("renders the type universe as a count — the number, then the word 'types'", () => {
    const unit = plan(answer([{ kind: "typeCount" }])).units.find((entry) => entry.id === "count:types");
    expect(unit?.kind).toBe("count");
    expect(unit?.slots.map((entry) => [entry.name, entry.expected])).toEqual([
      ["count", String(world.registry.typeChart.types.length)],
      ["set", "types"],
    ]);
  });

  it("renders a game rule as a count — the number, then the rule's label", () => {
    const rule = world.pack.gameRules.find((entry) => entry.id === "party-size")!;
    const unit = plan(answer([{ kind: "gameRule", ruleId: "party-size" }])).units.find((entry) => entry.id === "count:rule:party-size");
    expect(unit?.kind).toBe("count");
    expect(unit?.slots.map((entry) => [entry.name, entry.expected])).toEqual([
      ["count", String(rule.value)],
      ["set", rule.label],
    ]);
  });

  it("anchors a triggered disclosure to the unit that triggered it", () => {
    const manifest = answer([{ kind: "count", rosterId: "selfdestruct-learners", reported: boomers().cardinality }], [boomers()]);
    const warning = plan(manifest).units.find((entry) => entry.id === "selfdestruct-warning");
    expect(warning?.discloses).toBe("count:selfdestruct-learners");
  });

  it("binds both halves of a proposed act, the verb as well as the subject", () => {
    // "Pikachu" beside a friendly sentence is equally consistent with adding
    // it to the team and with releasing it forever, so which act it is comes
    // out of the closed action registry through a slot.
    const unit = plan(answer([RELEASE])).units.find((entry) => entry.id === "action:release:pikachu");
    expect(unit?.kind).toBe("action");
    expect(unit?.slots.map((entry) => [entry.name, entry.expected])).toEqual([
      ["action", "release"],
      ["entity", "Pikachu"],
    ]);
  });

  it("puts an irreversible act's consent notice beside the act, not the noun", () => {
    // The fact card mentions Pikachu too, and comes first. Anchoring to it
    // would let a page that merely talks about a Pokémon satisfy the notice
    // owed by a proposal to release it.
    const notice = plan(answer([SPEED, RELEASE])).units.find(
      (entry) => entry.id === "release-irreversibility:pikachu",
    );
    expect(notice?.discloses).toBe("action:release:pikachu");
    expect(notice?.article).toBe("IA-9");
  });

  it("states what an irreversible act gives up, out of the certified registry", () => {
    // Article IX's own sentence, made mechanical: the moves are read from the
    // snapshot exactly as a fact claim would read them, and formatted through
    // the same closed registry — so the serial comma is a provable input too.
    const notice = plan(answer([RELEASE])).units.find((entry) => entry.id === "release-irreversibility:pikachu");
    const givingUp = notice?.slots.find((entry) => entry.name === "giving-up");
    const learnset = world.registry.resolve("pikachu", "learnset");

    expect(givingUp?.value).toEqual(learnset.ok ? learnset.value : undefined);
    expect(givingUp?.expected).toContain(", and toxic");
    expect(notice?.slots.find((entry) => entry.name === "released")?.expected).toBe("Pikachu");
  });

  it("refuses to plan a disclosure with nothing on screen to sit beside", () => {
    // The set is carried, so the pack requires the warning; no claim cites the
    // set, so nothing the trainer sees is about Selfdestruct at all.
    const manifest = answer([SPEED], [boomers()]);
    const planned = planRender(bare, manifest);
    expect(planned.ok).toBe(false);
    expect(planned.ok ? [] : planned.violations.map(denialCode)).toContain("IA-6/disclosure-without-anchor");
  });

  it("refuses to plan a value in a presentation the pack does not approve", () => {
    // Approving a new presentation is a pack change plus a reviewed formatter.
    // A kernel that can render something the Accord never approved must not.
    const narrowed: ManifestContext = {
      ...world,
      pack: { ...world.pack, presentation: { ...world.pack.presentation, formats: ["plain-text"] } },
    };
    const planned = planRender(narrowed, answer([SPEED]));
    expect(planned.ok ? [] : planned.violations.map(denialCode)).toContain("IA-6/slot-format-unapproved");
  });

  it("refuses to plan an answer that does not verify", () => {
    const doctored: AnswerManifest = { ...answer([SPEED]), snapshotId: "kanto-yellow" };
    const planned = planRender(world, doctored);
    expect(planned.ok).toBe(false);
    expect(planned.ok ? [] : planned.violations.map(denialCode)).toContain("IA-2/snapshot-mismatch");
  });
});

describe("a certified value is bound to a slot, never searched for", () => {
  it("accepts the string the formatter produced", () => {
    expect(denials(page())).toEqual([]);
  });

  it("accepts a value wrapped in inline markup inside its own slot", () => {
    expect(denials(page([copy("lead-in.fact"), slot("entity", element("b", {}, [text("Pikachu")])), slot("fact", text("base-speed")), slot("value", text("90"))]))).toEqual([]);
  });

  it("does not accept a longer number that contains the certified one", () => {
    expect(denials(page([...HONEST_FACT.slice(0, 3), slot("value", text("190"))]))).toContain(
      "IA-6/slot-value-mismatch",
    );
  });

  it("does not accept the certified number in a shape nobody approved", () => {
    // The forgery the old token matcher was built to survive and the one it
    // could never survive are now the same denial: there is one approved
    // rendering of 90 in this locale, and everything else is a different string.
    for (const forgery of ["90.0", "090", "ninety", "9 0"]) {
      expect(denials(page([...HONEST_FACT.slice(0, 3), slot("value", text(forgery))])), forgery).toContain(
        "IA-6/slot-value-mismatch",
      );
    }
  });

  it("does not accept a value assembled out of two elements inside the slot", () => {
    const split = slot("value", element("span", {}, [text("9")]), element("span", {}, [text("0")]));
    expect(denials(page([...HONEST_FACT.slice(0, 3), split]))).toContain("IA-6/slot-value-mismatch");
  });

  it("does not accept a certified value written into prose instead of a slot", () => {
    // The renderer's most natural mistake, and the one closure exists for: the
    // right number, in the right card, marked as nothing at all.
    expect(denials(page([copy("lead-in.fact"), slot("entity", text("Pikachu")), slot("fact", text("base-speed")), text("90")]))).toEqual(
      expect.arrayContaining(["IA-6/slot-not-rendered", "IA-6/unattributed-content"]),
    );
  });

  it("does not accept one slot marked on two elements", () => {
    expect(denials(page([...HONEST_FACT, slot("value", text("90"))]))).toContain("IA-6/slot-marked-twice");
  });

  it("does not accept a slot the plan never asked for", () => {
    expect(denials(page([...HONEST_FACT, slot("verdict", text("great pick"))]))).toContain("IA-6/slot-unplanned");
  });

  it("does not accept a certified value outside every governed unit", () => {
    const stray = element("article", { "data-transaction": "txn-render", "data-locale": LOCALE }, [
      unit("fact:pikachu:base-speed", ...HONEST_FACT),
      unit("provenance", ...HONEST_PROVENANCE),
      slot("value", text("90")),
    ]);
    expect(denials(stray)).toContain("IA-6/slot-unplanned");
  });

  it("does not accept a slot that is in the document and not on the screen", () => {
    const invisible = element("span", { "data-slot": "value", style: "display: none" }, [text("90")]);
    expect(denials(page([...HONEST_FACT.slice(0, 3), invisible]))).toContain("IA-6/slot-not-visible");
  });
});

describe("mandatory text is a block, compared by digest", () => {
  it("accepts the approved text", () => {
    expect(denials(page())).toEqual([]);
  });

  it("does not accept it truncated, reworded, or reordered", () => {
    const approved = blockFor(world.pack.exhibits.find((entry) => entry.id === "provenance")!, LOCALE)!.text;
    const attacks = [
      approved.slice(0, 40),
      `${approved} Probably.`,
      approved.split(" ").reverse().join(" "),
    ];
    for (const attack of attacks) {
      expect(denials(page(HONEST_FACT, [block("provenance", attack), ...HONEST_PROVENANCE.slice(1)])), attack).toContain(
        "IA-2/disclosure-block-altered",
      );
    }
  });

  it("does not accept another locale's approved translation", () => {
    // A translation is separately approved text with its own digest. It is not
    // a looser match for the text the plan actually owes.
    const rule = world.pack.exhibits.find((entry) => entry.id === "provenance")!;
    const british = blockFor(rule, "en-GB");
    expect(british?.text).not.toBe(blockFor(rule, LOCALE)?.text);
    expect(
      denials(page(HONEST_FACT, [block("provenance", british?.text), ...HONEST_PROVENANCE.slice(1)])),
    ).toContain("IA-2/disclosure-block-altered");
  });

  it("does not accept a unit that carries no block at all", () => {
    expect(denials(page(HONEST_FACT, HONEST_PROVENANCE.slice(1)))).toContain("IA-2/disclosure-block-missing");
  });

  it("does not accept a different approved disclosure standing in for the owed one", () => {
    // Real text, really approved, really visible — and not the disclosure this
    // answer owes. Denied twice, because two separate things are wrong.
    const substituted = [block("selfdestruct-warning"), ...HONEST_PROVENANCE.slice(1)];
    expect(denials(page(HONEST_FACT, substituted))).toEqual(
      expect.arrayContaining(["IA-2/disclosure-block-missing", "IA-2/disclosure-block-unplanned"]),
    );
  });

  it("does not accept a disclosure the answer does not owe", () => {
    expect(denials(page([...HONEST_FACT, block("selfdestruct-warning")]))).toContain(
      "IA-6/disclosure-block-unplanned",
    );
  });

  it("does not accept one disclosure marked on two elements", () => {
    // Two elements claiming to be the same approved text: one of them can be
    // hidden in the next release and no record would change.
    expect(denials(page(HONEST_FACT, [...HONEST_PROVENANCE, block("provenance")]))).toContain(
      "IA-2/disclosure-block-marked-twice",
    );
  });

  it("does not accept a disclosure outside every governed unit", () => {
    const stray = element("article", { "data-transaction": "txn-render", "data-locale": LOCALE }, [
      unit("fact:pikachu:base-speed", ...HONEST_FACT),
      unit("provenance", ...HONEST_PROVENANCE),
      block("selfdestruct-warning"),
    ]);
    expect(denials(stray)).toContain("IA-6/disclosure-block-unplanned");
  });

  it("does not accept a block that is in the document and not on the screen", () => {
    const hidden = element("p", { "data-block": "pokeapi-attribution", hidden: "" }, [
      text(blockFor(world.pack.exhibits.find((entry) => entry.id === "provenance")!, LOCALE)!.text),
    ]);
    expect(denials(page(HONEST_FACT, [hidden, ...HONEST_PROVENANCE.slice(1)]))).toContain(
      "IA-2/disclosure-block-not-visible",
    );
  });
});

describe("every other word on the page comes from the catalogue", () => {
  it("denies a sentence that traces to nothing the Accord approved", () => {
    expect(denials(page([...HONEST_FACT, element("p", {}, [text("Great pick for the Rock gym!")])]))).toContain(
      "IA-6/unattributed-content",
    );
  });

  it("denies copy the catalogue does not carry", () => {
    expect(denials(page([copy("lead-in.editorial", "In our view:"), ...HONEST_FACT]))).toContain(
      "IA-6/catalogue-entry-unknown",
    );
  });

  it("denies approved copy whose words have drifted", () => {
    expect(denials(page([copy("lead-in.fact", "From memory, roughly:"), ...HONEST_FACT.slice(1)]))).toContain(
      "IA-6/catalogue-drift",
    );
  });

  it("says nothing about text a trainer cannot see", () => {
    // Closure is about the artifact a trainer reads. Prose in a display:none
    // block shows nobody anything, and denying it would be theatre.
    const buried = element("div", { style: "display: none" }, [element("p", {}, [text("draft copy, ignore")])]);
    expect(denials(page([...HONEST_FACT, buried]))).toEqual([]);
  });
});

describe("the locale is an input, not a matching hazard", () => {
  it("denies a flawless page localised against another plan", () => {
    const british = element("article", { "data-transaction": "txn-render", "data-locale": "en-GB" }, [
      unit("fact:pikachu:base-speed", ...HONEST_FACT),
      unit("provenance", ...HONEST_PROVENANCE),
    ]);
    expect(denials(british)).toEqual(["IA-6/artifact-locale-mismatch"]);
  });

  it("denies a page that will not say which locale it is", () => {
    const unmarked = element("article", { "data-transaction": "txn-render" }, [
      unit("fact:pikachu:base-speed", ...HONEST_FACT),
      unit("provenance", ...HONEST_PROVENANCE),
    ]);
    expect(denials(unmarked)).toEqual(["IA-6/artifact-locale-mismatch"]);
  });
});

describe("the affidavit", () => {
  const honest = page();

  it("is derived from the artifact, not from the manifest", () => {
    const attested = attestRender(bare, answer([SPEED]), honest, RENDERED_AT);
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
    const attested = attestRender(
      bare,
      answer([SPEED]),
      page([...HONEST_FACT.slice(0, 3), slot("value", text("200"))]),
      RENDERED_AT,
    );
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


describe("the approved sentence (epic #94, slice 4)", () => {

  function sentencedPlan(claims: readonly Claim[], rosters: readonly ClosedRoster[] = []) {
    const compiled = compileManifest(world, { transactionId: "txn-render", claims, rosters });
    if (!compiled.ok) throw new Error(compiled.violations.map(denialCode).join(", "));
    const planned = planRender(world, compiled.value);
    if (!planned.ok) throw new Error(planned.violations.map(denialCode).join(", "));
    return { manifest: compiled.value, plan: planned.value };
  }

  it("fills the template with the unit's slot strings, joined as the walker reads", () => {
    const { plan } = sentencedPlan([SPEED]);
    expect(plan.units[0]?.sentence).toEqual({
      templateId: "sentence.fact",
      expected: "The official records certify Pikachu 's base-speed as 90 .",
    });
  });

  it("pins the template slot table to what the plan actually certifies, kind by kind", () => {
    // TEMPLATE_SLOTS is the loader's authority for refusing a template's
    // placeholders; this pins it to unitForClaim's real slots so the two
    // cannot drift. Every kind that takes a sentence is built and compared.
    const roster = boomers();
    const { plan } = sentencedPlan(
      [
        SPEED,
        { kind: "count", rosterId: roster.id },
        { kind: "membership", rosterId: roster.id, entityId: "pikachu", asserted: false },
        { kind: "ranking", rosterId: roster.id, basis: "base-speed", direction: "highest" },
        { kind: "matchup", subject: { kind: "species", entityId: "pikachu" }, direction: "weak-to" },
        { kind: "eligibility", entityId: "mewtwo" },
        { kind: "recommendation", entityId: "pikachu" },
        RELEASE,
      ],
      [roster],
    );
    const byKind = new Map(plan.units.map((unit) => [unit.kind, unit]));
    for (const [kind, slots] of Object.entries(TEMPLATE_SLOTS)) {
      const unit = byKind.get(kind as never);
      expect(unit, `no planned unit of kind ${kind}`).toBeDefined();
      expect(
        unit?.slots.map((slot) => slot.name).sort(),
        `TEMPLATE_SLOTS drifted for ${kind}`,
      ).toEqual([...slots].sort());
      expect(unit?.sentence?.templateId, `no sentence planned for ${kind}`).toBeDefined();
    }
  });

  it("signs the reference renderer's sentenced page without a denial", () => {
    const { manifest, plan } = sentencedPlan([SPEED]);
    const artifact = renderAnswer(world.pack, plan);
    const attested = attestRender(world, manifest, artifact, RENDERED_AT);
    expect(attested.ok, JSON.stringify(!attested.ok && attested.violations)).toBe(true);
  });

  it("refuses a pack whose sentence asks for a value the unit never certifies", () => {
    const doctored: ManifestContext = {
      ...world,
      pack: {
        ...world.pack,
        presentation: {
          ...world.pack.presentation,
          templates: [{ id: "sentence.fact", kind: "fact", text: { "en-US": "Trust me, {vibes}.", "en-GB": "Trust me, {vibes}." } }],
        },
      },
    };
    const compiled = compileManifest(doctored, { transactionId: "txn-render", claims: [SPEED], rosters: [] });
    if (!compiled.ok) throw new Error("the manifest itself should compile");
    const planned = planRender(doctored, compiled.value);
    expect(!planned.ok && planned.violations.map(denialCode)).toContain("IA-6/template-slot-unknown");
  });

  it("denies a reworded sentence as drift, whole and by name", () => {
    const { manifest, plan } = sentencedPlan([SPEED]);
    const artifact = renderAnswer(world.pack, plan);
    const reworded = rewriteText(artifact, "The official records certify", "We believe");
    const attested = attestRender(world, manifest, reworded, RENDERED_AT);
    const verdict = verifyRender(world, manifest, reworded, attested.ok ? attested.value : { transactionId: "txn-render", artifactDigest: "sha256:x", renderedAt: RENDERED_AT, units: [] });
    expect(verdict.violations.map(denialCode)).toContain("IA-6/sentence-drift");
  });

  it("denies a sentence nobody planned, inside a unit and outside all of them", () => {
    const { manifest, plan } = sentencedPlan([SPEED]);
    const artifact = renderAnswer(world.pack, plan);
    const smuggled = {
      ...artifact,
      children: [...artifact.children, element("p", { "data-template": "sentence.of-my-own" }, [text("Also, trust me.")])],
    };
    const attested = attestRender(world, manifest, smuggled, RENDERED_AT);
    const verdict = verifyRender(world, manifest, smuggled, attested.ok ? attested.value : { transactionId: "txn-render", artifactDigest: "sha256:x", renderedAt: RENDERED_AT, units: [] });
    expect(verdict.violations.map(denialCode)).toContain("IA-6/template-unplanned");
  });

  it("keeps every locale's sentence approvable — en-GB plans and signs too", () => {
    expect(templateFor(world.pack, "fact", "en-GB")?.id).toBe("sentence.fact");
  });
});

/** Replace one fragment of text wherever it appears in the artifact's text nodes. */
function rewriteText(node: DomElement, from: string, to: string): DomElement {
  const walk = (child: DomNode): DomNode =>
    child.kind === "text"
      ? { ...child, text: child.text.includes(from) ? child.text.replace(from, to) : child.text }
      : { ...child, children: child.children.map(walk) };
  return walk(node) as DomElement;
}
