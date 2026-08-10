import { describe, expect, it } from "vitest";

import { element, text, type DomNode } from "../kernel/dom.js";
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
