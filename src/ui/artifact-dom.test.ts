import { describe, expect, it } from "vitest";

import type { Claim } from "../kernel/contracts.js";
import { element, text, type DomNode } from "../kernel/dom.js";
import { compileManifest } from "../kernel/manifest.js";
import { planRender } from "../kernel/render.js";
import { buildRoster } from "../kernel/roster.js";
import { denialCode } from "../kernel/violation.js";
import { renderAnswer } from "../render/reference.js";
import { manifestContext } from "../testing/fixtures.js";
import { adaptArtifact, type DomFactory } from "./artifact-dom.js";

/** A mounted node as the recorder sees it — structure, nothing else. */
interface Recorded {
  tag?: string;
  attributes?: Readonly<Record<string, string>>;
  text?: string;
  children?: readonly Recorded[];
}

const recorder: DomFactory<Recorded> = {
  element: (tag, attributes, children) => ({ tag, attributes, children }),
  text: (value) => ({ text: value }),
};

describe("adaptArtifact", () => {
  it("mounts the shape the reference renderer emits, faithfully", () => {
    const artifact = element("article", { "data-transaction": "txn-1", "data-locale": "en-US" }, [
      element("section", { "data-unit": "fact:pikachu" }, [
        element("p", {}, [
          element("span", { "data-copy": "lead-in.fact" }, [text("Certified: ")]),
          element("span", { "data-slot": "fact:pikachu:base-speed" }, [text("90")]),
        ]),
      ]),
    ]);

    const mounted = adaptArtifact(artifact, recorder);

    expect(mounted.tag).toBe("article");
    expect(mounted.attributes).toEqual({ "data-transaction": "txn-1", "data-locale": "en-US" });
    const slot = mounted.children?.[0]?.children?.[0]?.children?.[1];
    expect(slot?.attributes).toEqual({ "data-slot": "fact:pikachu:base-speed" });
    expect(slot?.children).toEqual([{ text: "90" }]);
  });

  it("mounts the hiding machinery the walker knows how to see", () => {
    const sabotaged = element("article", {}, [
      element("p", { style: "display: none" }, [text("hidden warning")]),
      element("div", { hidden: "", "aria-hidden": "true" }, []),
      element("details", {}, [element("summary", {}, [text("more")])]),
      element("template", {}, [text("inert payload")]),
    ]);

    expect(() => adaptArtifact(sabotaged, recorder)).not.toThrow();
  });

  it("mounts a profile card's definition list — the reference renderer's own tags", () => {
    const profile = element("article", {}, [
      element("section", { "data-unit": "profile:charmander" }, [
        element("dl", {}, [element("dt", {}, [element("span", { "data-slot": "fact:types" }, [text("Type")])]), element("dd", {}, [element("span", { "data-slot": "value:types" }, [text("fire")])])]),
      ]),
    ]);
    expect(() => adaptArtifact(profile, recorder)).not.toThrow();
  });

  it("mounts every unit the reference renderer emits under the shipped pack — the three layers that know tags agree", () => {
    // The walker reads any tag and the kernel signs what it reads; only this
    // adapter lists tags. So a unit the renderer learns to draw is a unit the
    // mount must learn to mount, and the night the compare table shipped
    // (2026-09-19) it had not: the kernel certified the page, the live page
    // said "refusing to mount <table>". This test renders one of everything
    // the planner groups — a lone fact, a profile card, a listing, a compare
    // table with a tie row, a lesson, the provenance footer — and mounts it.
    const world = manifestContext();
    const electric = buildRoster(world.registry, "electric", { all: [{ kind: "has-type", type: "electric" }] });
    if (!electric.ok) throw new Error("the electric roster does not build");
    const claims: Claim[] = [
      { kind: "fact", entityId: "pikachu", factId: "base-speed" },
      { kind: "fact", entityId: "charmander", factId: "types" },
      { kind: "fact", entityId: "charmander", factId: "base-hp" },
      { kind: "membership", rosterId: "electric", entityId: "pikachu", asserted: true },
      { kind: "membership", rosterId: "electric", entityId: "raichu", asserted: true },
      { kind: "count", rosterId: "electric" },
      { kind: "comparison", factId: "base-hp", leftId: "ivysaur", rightId: "venusaur" },
      { kind: "comparison", factId: "base-hp", leftId: "ivysaur", rightId: "raichu" },
      { kind: "explanation", blockId: "what-is-badge" },
    ];
    const compiled = compileManifest(world, { transactionId: "txn-mount", claims, rosters: [electric.value] });
    if (!compiled.ok) throw new Error(compiled.violations.map(denialCode).join(", "));
    const plan = planRender(world, compiled.value);
    if (!plan.ok) throw new Error(plan.violations.map(denialCode).join(", "));
    expect(plan.value.units.map((unit) => unit.kind)).toEqual(expect.arrayContaining(["fact", "profile", "listing", "count", "compare", "explanation", "provenance"]));
    expect(() => adaptArtifact(renderAnswer(world.pack, plan.value), recorder)).not.toThrow();
  });

  it("refuses a tag a certified artifact may not carry, by name", () => {
    const hostile = element("article", {}, [element("script", {}, [text("alert(1)")])]);
    expect(() => adaptArtifact(hostile, recorder)).toThrow(/refusing to mount <script>/);

    const embedded = element("article", {}, [element("iframe", { src: "https://example.test" }, [])]);
    expect(() => adaptArtifact(embedded, recorder)).toThrow(/refusing to mount <iframe>/);
  });

  it("refuses an attribute that could execute or navigate, by name", () => {
    const handler = element("article", { onclick: "steal()" }, []);
    expect(() => adaptArtifact(handler, recorder)).toThrow(/refusing to mount attribute "onclick"/);

    const link = element("article", {}, [element("span", { href: "javascript:void(0)" }, [])]);
    expect(() => adaptArtifact(link, recorder)).toThrow(/refusing to mount attribute "href"/);
  });

  it("refuses the whole artifact rather than mounting an unfaithful part", () => {
    // A sabotage buried three levels down still stops the mount: a page that
    // silently dropped it would no longer be the page the affidavit describes.
    const buried: DomNode = element("article", {}, [
      element("section", { "data-unit": "u" }, [element("p", {}, [element("button", {}, [text("release")])])]),
    ]);
    expect(() => adaptArtifact(buried as never, recorder)).toThrow(/refusing to mount <button>/);
  });
});
