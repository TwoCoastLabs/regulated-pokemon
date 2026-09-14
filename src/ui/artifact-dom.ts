/**
 * From the filed record to a real page: the adapter the web UI mounts.
 *
 * `src/kernel/dom.ts` states the contract from the other side: the artifact
 * tree "is the small, explicit shape a browser DOM presents", and the web UI
 * adapts between the two. This is that adapter, written against a factory
 * rather than `document` so the same walk is testable in Node and mountable in
 * a browser — the browser hands it `document.createElement`, a test hands it
 * a recorder.
 *
 * It is fail-closed the way the rest of the project is. A filed artifact is a
 * record, and a record can be hostile: the crucible's sabotaged pages travel
 * in records too. So mounting is by allow-list — the tags the reference
 * renderer emits plus the hiding machinery the walker knows how to see
 * (`hidden`, `aria-hidden`, inline `style`, `<details>`, `<template>`), and
 * nothing that could execute or navigate. A tag or attribute outside the list
 * is refused by name, never silently dropped: an artifact the UI cannot mount
 * faithfully is an artifact it must not mount at all, because the page on
 * screen would no longer be the page the affidavit describes.
 */

import type { DomElement, DomNode } from "../kernel/dom.js";

/** What a mounting environment must provide. The browser's `document` is one;
 * a test's recorder is another. */
export interface DomFactory<N> {
  element(tag: string, attributes: Readonly<Record<string, string>>, children: readonly N[]): N;
  text(value: string): N;
}

/**
 * The tags a certified artifact may carry: what the reference renderer emits,
 * and the inert or hiding elements the walker's techniques name. Nothing that
 * scripts, embeds, navigates, or submits.
 */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "article",
  "header",
  "footer",
  "section",
  "aside",
  "h1",
  "h2",
  "h3",
  "p",
  "span",
  "div",
  "ul",
  "ol",
  "li",
  // A profile card's labelled list (pack v3): the reference renderer's
  // definition list, label and value each a marked span inside.
  "dl",
  "dt",
  "dd",
  "strong",
  "em",
  "details",
  "summary",
  "template",
]);

/** Attributes with meaning to the walker or to plain presentation. Event
 * handlers, URLs and everything else are outside the list and refused. */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set(["style", "hidden", "open", "lang", "class"]);

function allowedAttribute(name: string): boolean {
  return name.startsWith("data-") || name.startsWith("aria-") || ALLOWED_ATTRIBUTES.has(name.toLowerCase());
}

/** Mount one recorded artifact through the factory, refusing anything the
 * record should not be able to say. Throws with the offender named. */
export function adaptArtifact<N>(root: DomElement, factory: DomFactory<N>): N {
  return adaptNode(root, factory);
}

function adaptNode<N>(node: DomNode, factory: DomFactory<N>): N {
  if (node.kind === "text") return factory.text(node.text);

  const tag = node.tag.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    throw new Error(`refusing to mount <${node.tag}>: not a tag a certified artifact may carry`);
  }
  for (const name of Object.keys(node.attributes)) {
    if (!allowedAttribute(name)) {
      throw new Error(`refusing to mount attribute "${name}" on <${node.tag}>: not presentation, not a walker mark`);
    }
  }
  return factory.element(
    tag,
    node.attributes,
    node.children.map((child) => adaptNode(child, factory)),
  );
}
