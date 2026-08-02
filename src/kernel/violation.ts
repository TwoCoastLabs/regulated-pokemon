/**
 * Building and reporting named denials.
 *
 * Every refusal in this kernel cites an Accord article and a stable rule
 * slug, so a denial reads `IA-3/fabricated-entity` and can be looked up in
 * the Accord document. "Blocked by policy" is banned: a denial that does not
 * say which rule it enforces cannot be audited, argued with, or replayed.
 */

import type { ArticleId } from "./accord.js";
import type { Verdict, Violation } from "./contracts.js";

export function violation(
  article: ArticleId,
  rule: string,
  message: string,
  evidence?: { expected?: string; actual?: string },
): Violation {
  return {
    article,
    rule,
    message,
    ...(evidence?.expected === undefined ? {} : { expected: evidence.expected }),
    ...(evidence?.actual === undefined ? {} : { actual: evidence.actual }),
  };
}

/** Stable identity of a denial, e.g. "IA-3/fabricated-entity". */
export function denialCode(item: Violation): string {
  return `${item.article}/${item.rule}`;
}

export function describeViolation(item: Violation): string {
  const evidence = [
    item.expected === undefined ? undefined : `expected ${item.expected}`,
    item.actual === undefined ? undefined : `actual ${item.actual}`,
  ].filter((part) => part !== undefined);
  const detail = evidence.length > 0 ? ` (${evidence.join(", ")})` : "";
  return `${denialCode(item)}: ${item.message}${detail}`;
}

/** A verdict allows exactly when nothing was refused. */
export function verdictOf(violations: readonly Violation[]): Verdict {
  return { allowed: violations.length === 0, violations };
}

/**
 * Thrown where there is no transaction to deny — startup, for instance.
 * It still names its articles: a process that dies without saying which rule
 * it enforced is indistinguishable from a crash.
 */
export class AccordError extends Error {
  readonly violations: readonly Violation[];

  constructor(violations: readonly Violation[]) {
    super(violations.map(describeViolation).join("; "));
    this.name = "AccordError";
    this.violations = violations;
  }
}
