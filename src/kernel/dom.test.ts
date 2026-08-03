/**
 * The walker, on its own.
 *
 * The crucible proves the hiding techniques are denied end to end. These tests
 * are about the walk itself: inheritance, the edges of each rule, and the two
 * properties the digest has to have — it covers what is visible, and text
 * cannot reflow across a component boundary into a colliding one.
 */

import { describe, expect, it } from "vitest";

import { type DomElement, type DomNode, element, normalise, text, walkArtifact } from "./dom.js";

const TRANSACTION = { "data-transaction": "txn-1" };

function page(...children: DomNode[]): DomElement {
  return element("article", TRANSACTION, children);
}

function unit(id: string, attributes: Record<string, string>, ...children: DomNode[]): DomElement {
  return element("section", { "data-unit": id, ...attributes }, children);
}

function visibilityOf(artifact: DomElement, id: string) {
  const found = walkArtifact(artifact).units.find((entry) => entry.id === id);
  expect(found, `no unit ${id} in the walk`).toBeDefined();
  return found!;
}

describe("what a browser would show", () => {
  it("reads the transaction the artifact says it is", () => {
    expect(walkArtifact(page()).transactionId).toBe("txn-1");
    expect(walkArtifact(element("article", {}, [])).transactionId).toBeUndefined();
  });

  it.each([
    ["display-none", { style: "display: none" }],
    ["display-none", { style: "color: red; display:none; margin: 0" }],
    ["visibility-hidden", { style: "visibility: hidden" }],
    ["visibility-hidden", { style: "visibility: collapse" }],
    ["opacity-zero", { style: "opacity: 0" }],
    ["opacity-zero", { style: "opacity: 0.05" }],
    ["attribute", { hidden: "" }],
    ["aria-hidden", { "aria-hidden": "true" }],
  ])("names %s", (technique, attributes) => {
    const walked = visibilityOf(page(unit("u", attributes, text("hello"))), "u");
    expect(walked.visible).toBe(false);
    expect(walked.hiddenBy).toBe(technique);
  });

  it.each([
    ["a readable opacity", { style: "opacity: 0.9" }],
    ["an unparseable opacity", { style: "opacity: inherit" }],
    ["a style with no declarations in it", { style: "not-a-declaration" }],
    ["aria-hidden set to false", { "aria-hidden": "false" }],
  ])("leaves %s alone", (_label, attributes) => {
    expect(visibilityOf(page(unit("u", attributes, text("hello"))), "u").visible).toBe(true);
  });

  it("hides a unit whose ancestor is hidden, however innocent its own markup", () => {
    const artifact = page(element("div", { style: "display: none" }, [unit("u", {}, text("hello"))]));
    expect(visibilityOf(artifact, "u")).toMatchObject({ visible: false, hiddenBy: "display-none", text: "" });
  });

  it("shows a closed details' summary and nothing else", () => {
    const artifact = page(
      element("details", {}, [
        element("summary", {}, [text("More about this")]),
        unit("u", {}, text("the disclosure")),
      ]),
    );
    expect(visibilityOf(artifact, "u")).toMatchObject({ visible: false, hiddenBy: "collapsed-details" });
    expect(walkArtifact(artifact).digest).not.toBe(walkArtifact(page()).digest);
  });

  it("shows an open details in full", () => {
    const artifact = page(
      element("details", { open: "" }, [
        element("summary", {}, [text("More about this")]),
        unit("u", {}, text("the disclosure")),
      ]),
    );
    expect(visibilityOf(artifact, "u").visible).toBe(true);
  });

  it("reads only the visible part of a unit that is itself visible", () => {
    const artifact = page(
      unit(
        "u",
        {},
        text("Selfdestruct"),
        element("span", { style: "display: none" }, [text("User faints")]),
      ),
    );
    expect(visibilityOf(artifact, "u")).toMatchObject({ visible: true, text: "Selfdestruct" });
  });

  it("records where each unit sits, and which ids were marked twice", () => {
    const artifact = page(unit("u", {}, text("one")), element("div", {}, [unit("u", {}, text("two"))]));
    const walk = walkArtifact(artifact);
    expect(walk.units.map((entry) => entry.path)).toEqual([[0], [1, 0]]);
    expect(walk.duplicated).toEqual(["u"]);
  });

  it("normalises whitespace and ignores text that is only whitespace", () => {
    expect(normalise("  a \n  b  ")).toBe("a b");
    expect(visibilityOf(page(unit("u", {}, text("  Selfdestruct \n  now "))), "u").text).toBe("Selfdestruct now");
  });
});

describe("the artifact digest", () => {
  const shown = page(unit("u", {}, text("User faints")));

  it("changes when visible text changes", () => {
    expect(walkArtifact(page(unit("u", {}, text("User is fine")))).digest).not.toBe(walkArtifact(shown).digest);
  });

  it("changes when a visible unit becomes hidden", () => {
    expect(walkArtifact(page(unit("u", { hidden: "" }, text("User faints")))).digest).not.toBe(
      walkArtifact(shown).digest,
    );
  });

  it("changes when the same text moves to a different unit", () => {
    expect(walkArtifact(page(unit("v", {}, text("User faints")))).digest).not.toBe(walkArtifact(shown).digest);
  });

  it("does not let text reflow across a boundary into a colliding digest", () => {
    // "Selfdestruct" beside an empty warning and an empty card beside
    // "Selfdestruct" concatenate identically and are two different pages.
    const left = page(unit("card", {}, text("Selfdestruct")), unit("warning", {}, text("")));
    const right = page(unit("card", {}, text("")), unit("warning", {}, text("Selfdestruct")));
    expect(walkArtifact(left).digest).not.toBe(walkArtifact(right).digest);
  });

  it("is the same for the same document walked twice", () => {
    expect(walkArtifact(shown).digest).toBe(walkArtifact(page(unit("u", {}, text("User faints")))).digest);
  });
});
