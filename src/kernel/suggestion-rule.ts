/**
 * The suggestion register's one rule (R3b step 4): a suggestion names a
 * topic, never a value. Its own module so the three places that hold a
 * suggestion to it — the kernel's manifest gate, the driver's filter, and
 * the pack loader reading the operator's own wordings — import one
 * function and cannot disagree about what "may name a topic" means.
 */

import type { CertifiedRegistry } from "./registry.js";

/** The most follow-ups one answer may offer; a next step is one to three
 * questions, never a menu. */
export const MAX_SUGGESTIONS = 3;

/** The longest a suggestion may run — a short question in the trainer's
 * voice, not a paragraph a value could hide in. */
export const MAX_SUGGESTION_LENGTH = 120;

/**
 * Why a suggestion may not be shown, or nothing when it may. Structural, and
 * the one rule the register lives by: a suggestion names a topic, never a
 * value. A digit is a value stated; a certified id — a species, a move, an
 * item, a type — is a value too, since the whole point of the register is
 * that nothing on it was checked against the records. Shared by the kernel's
 * gate and the driver's filter so the two cannot disagree about what "may
 * name a topic" means.
 */
export function suggestionProblem(registry: CertifiedRegistry, text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > MAX_SUGGESTION_LENGTH) return `longer than ${MAX_SUGGESTION_LENGTH} characters`;
  if (/\d/.test(trimmed)) return "states a number";
  const haystack = ` ${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const names = (id: string): boolean => haystack.includes(` ${id.replace(/-/g, " ")} `);
  const named =
    registry.speciesIds.find(names) ?? registry.moveIds.find(names) ?? registry.itemIds.find(names) ?? [...registry.typeNames].find(names);
  if (named !== undefined) return `names the certified id "${named}"`;
  return undefined;
}
