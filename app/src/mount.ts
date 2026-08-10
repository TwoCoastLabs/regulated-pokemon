/** The browser's side of the adapter contract in src/ui/artifact-dom.ts:
 * real elements, real text nodes, nothing else. */
import type { DomFactory } from "../../src/ui/artifact-dom.js";

export const browserFactory: DomFactory<Node> = {
  element(tag, attributes, children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  },
  text: (value) => document.createTextNode(value),
};
