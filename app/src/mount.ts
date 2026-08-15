/** The browser's side of the adapter contract in src/ui/artifact-dom.ts:
 * real elements, real text nodes, nothing else. */
import type { DomFactory } from "../../src/ui/artifact-dom.js";
import type { Box, Geometry } from "../../src/ui/browser-affidavit.js";

export const browserFactory: DomFactory<Node> = {
  element(tag, attributes, children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  },
  text: (value) => document.createTextNode(value),
};

/**
 * The browser's side of the geometry contract in src/ui/browser-affidavit.ts:
 * the real layout, read by path.
 *
 * A walk path is child indices from the artifact root, and `adaptArtifact`
 * mounts children one-for-one, so the same indices walk the mounted DOM. The
 * viewport is the region the certified page is allotted — the container it is
 * mounted into — rather than the browser window, so "off the screen" means off
 * the page's own display region and stays stable across window sizes.
 *
 * This is glue, like `browserFactory`: no judgement lives here. It resolves a
 * path to a node and reports its box and legibility; `attestGeometry`, which is
 * tested with scripted readings and no browser, decides what any of it means.
 */
/** Resolve a walk path to the mounted node it names, or nothing. The same
 * child-index walk `browserGeometry` uses, exposed so a caller can find the
 * element a live sabotage should style. */
export function resolveNode(root: Node, path: readonly number[]): Node | undefined {
  let node: Node = root;
  for (const index of path) {
    const child = node.childNodes[index];
    if (child === undefined) return undefined;
    node = child;
  }
  return node;
}

export function browserGeometry(root: Node, container: Element): Geometry {
  const resolve = (path: readonly number[]): Node | undefined => resolveNode(root, path);

  const rectOf = (client: DOMRect): Box => ({
    x: client.x,
    y: client.y,
    width: client.width,
    height: client.height,
  });

  return {
    viewport: rectOf(container.getBoundingClientRect()),
    box(path) {
      const node = resolve(path);
      return node instanceof Element ? rectOf(node.getBoundingClientRect()) : undefined;
    },
    style(path) {
      const node = resolve(path);
      if (!(node instanceof Element)) return undefined;
      const computed = getComputedStyle(node);
      return {
        fontSizePx: Number.parseFloat(computed.fontSize) || 0,
        // The product down the ancestor chain, up to the mounted root: an
        // opacity set on the warning's card fades the warning inside it, and a
        // check reading only the warning's own computed opacity would miss it.
        opacity: cumulativeOpacity(node, root),
      };
    },
    occluderAt(path, point) {
      const node = resolve(path);
      if (!(node instanceof Element)) return undefined;
      // What a click at this point would actually hit. If it is the element
      // itself or one of its descendants, nothing is covering it; anything else
      // is painted on top, and its own markup names it in the denial.
      const top = document.elementFromPoint(point.x, point.y);
      if (top === null || node.contains(top)) return undefined;
      return describeElement(top);
    },
  };
}

/** A short, honest identifier for an intruding element — its tag and whatever
 * mark it wears — so a denial can say what covered the disclosure. */
function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : "";
  const cls = element.classList.length > 0 ? `.${[...element.classList].join(".")}` : "";
  return `<${element.tagName.toLowerCase()}${id}${cls}>`;
}

function cumulativeOpacity(node: Element, root: Node): number {
  let opacity = 1;
  let current: Element | null = node;
  while (current !== null) {
    const own = Number.parseFloat(getComputedStyle(current).opacity);
    if (Number.isFinite(own)) opacity *= own;
    if (current === root) break;
    current = current.parentElement;
  }
  return opacity;
}
