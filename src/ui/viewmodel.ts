/**
 * What the console states, computed from the kernel's record alone.
 *
 * Two projections the live page's console, the step trail and the tracer
 * share: a claim as one terse ledger line, and a named denial joined to its
 * article for the tooltip. Pure on purpose — no clock, no network, no state
 * — so a line on screen is always traceable to the record that produced it,
 * never recomputed from something fresher.
 */

import { article } from "../kernel/accord.js";
import type { Claim, FactValue, Violation } from "../kernel/contracts.js";

function factValue(value: FactValue): string {
  switch (value.kind) {
    case "number":
      return String(value.value);
    case "boolean":
      return String(value.value);
    case "text":
      return value.value;
    case "list":
      return value.value.join(", ");
    case "absent":
      return "absent (certified)";
  }
}

/** One claim, as the console states it. Terse on purpose: this is the ledger
 * line, and the certified page is where the answer reads as prose. */
export function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case "fact":
      return `${claim.entityId}: ${claim.factId}${claim.asserted === undefined ? " — derived by the kernel" : ` = ${factValue(claim.asserted)}`}`;
    case "treats":
      return `${claim.itemId} vs ${claim.condition}${claim.asserted === undefined ? " — derived by the kernel" : claim.asserted ? ": treats" : ": does not treat"}`;
    case "comparison":
      return `${claim.leftId} vs ${claim.rightId} by ${claim.factId} — derived by the kernel`;
    case "count":
      return `count(${claim.rosterId})${claim.reported === undefined ? " — derived by the kernel" : ` = ${claim.reported}`}`;
    case "typeCount":
      return `typeCount()${claim.reported === undefined ? " — derived by the kernel" : ` = ${claim.reported}`}`;
    case "gameRule":
      return `gameRule(${claim.ruleId})${claim.reported === undefined ? " — derived by the kernel" : ` = ${claim.reported}`}`;
    case "membership":
      return `${claim.entityId} ${claim.asserted ? "∈" : "∉"} ${claim.rosterId}`;
    case "ranking":
      return (
        `${claim.direction} ${claim.basis} of ${claim.rosterId}` +
        (claim.selectedEntityId === undefined ? " — winner derived by the kernel" : ` → ${claim.selectedEntityId}`)
      );
    case "matchup":
      return (
        `${claim.subject.kind === "species" ? claim.subject.entityId : claim.subject.typeId} ${claim.direction}` +
        (claim.members === undefined ? " — derived by the kernel" : ` ${claim.members.join(", ")}`)
      );
    case "eligibility":
      return (
        `eligibility of ${claim.entityId}` +
        (claim.finding === undefined
          ? " — derived by the kernel"
          : claim.finding.eligible
            ? " — within accreditation"
            : ` — requires badge ${claim.finding.minimumBadgeLevel}, holds ${claim.finding.badgeLevel}`)
      );
    case "explanation":
      return `lesson ${claim.blockId} — reviewed text, shown verbatim`;
    case "recommendation":
      return `recommend ${claim.entityId}`;
    case "action":
      return `${claim.tool}(${claim.entityId})`;
  }
}

/** A named denial, joined to its article for the console's tooltip. */
export interface ViolationView {
  code: string;
  articleTitle: string;
  analog: string;
  message: string;
  expected?: string;
  actual?: string;
}

export function violationView(violation: Violation): ViolationView {
  const entry = article(violation.article);
  return {
    code: `${violation.article}/${violation.rule}`,
    articleTitle: entry.title,
    analog: entry.analog,
    message: violation.message,
    ...(violation.expected === undefined ? {} : { expected: violation.expected }),
    ...(violation.actual === undefined ? {} : { actual: violation.actual }),
  };
}
