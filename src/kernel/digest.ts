/**
 * One way of naming a piece of text, used wherever two layers have to agree
 * that they are talking about the same words.
 *
 * Deliberately trivial and deliberately shared. A disclosure block is digested
 * in the Accord pack, carried in the manifest, and recomputed from the screen
 * by the render affidavit; if any of those three did its own hashing, the
 * agreement between them would be a coincidence rather than a check.
 *
 * The normalisation is the important half. Whitespace is the renderer's — a
 * line break inside a paragraph is layout, not content — so it is collapsed
 * before hashing. Everything else, including punctuation and case, is content.
 */

import { normalise } from "./dom.js";
import { sha256Hex } from "./sha256.js";

export function digestText(value: string): string {
  return `sha256:${sha256Hex(normalise(value))}`;
}
