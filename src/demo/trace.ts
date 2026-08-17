/**
 * The compliance trace: a transaction, rendered for a person.
 *
 * Every denial in this repository has so far been read by an `expect`. The
 * demo's entire proposition is that a *visitor* reads one and understands what
 * the kernel refused and why, so this is the first place the question gets
 * asked. A violation that renders as an opaque slug is a finding about the
 * denial, not about the renderer — which is why `describeDenial` is pinned by
 * a test against every mutation the crucible knows about.
 *
 * Pure: strings in, strings out, no clock, no console, no process. The CLI
 * prints what this returns and does nothing else, so the thing a human reads
 * is the thing a test can assert on.
 */

import { article } from "../kernel/accord.js";
import type { Claim, Exhibit, ScopeEvent, Violation } from "../kernel/contracts.js";
import { formatFactValue } from "../kernel/registry.js";
import { describeCriteria } from "../kernel/roster.js";
import { BLOCK_DENIALS, type ScopeDerivation } from "../kernel/scope.js";
import type { Transaction } from "../kernel/transaction.js";
import { denialCode } from "../kernel/violation.js";

const INDENT = "  ";

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

// --- denials ----------------------------------------------------------------

/**
 * One refusal, in full: the code you can grep for, the article it enforces,
 * the real-world rule it stands in for, and the evidence.
 *
 * "Blocked by policy" is banned in this kernel, and a console that printed
 * only `IA-3/fabricated-entity` would be reintroducing it one layer up — the
 * slug is precise and it is not an explanation.
 */
export function describeDenial(item: Violation): string[] {
  const found = article(item.article);
  const lines = [
    `DENIED  ${denialCode(item)}`,
    `${INDENT}article  ${found.id} — ${found.title}`,
    `${INDENT}analog   ${found.analog}`,
    `${INDENT}because  ${item.message}`,
  ];
  if (item.expected !== undefined) lines.push(`${INDENT}expected ${item.expected}`);
  if (item.actual !== undefined) lines.push(`${INDENT}actual   ${item.actual}`);
  return lines;
}

export function describeDenials(violations: readonly Violation[]): string[] {
  return violations.flatMap(describeDenial);
}

// --- the record -------------------------------------------------------------

function describeEvent(event: ScopeEvent, index: number): string {
  const at = `${INDENT}[${index}] `;
  switch (event.kind) {
    case "utterance":
      return `${at}${pad(event.source, 16)} ${event.text}`;
    case "question":
      return `${at}${pad(`${event.source} asks`, 16)} ${event.text}  — about ${event.dimension}`;
    case "proposal": {
      const candidate = Object.entries(event.candidate)
        .map(([dimension, value]) => `${dimension}=${String(value)}`)
        .join(", ");
      return `${at}${pad("proposal", 16)} ${candidate}  — interpreting "${event.interpreting}"`;
    }
    case "confirmation":
      return `${at}${pad(`${event.source} ${event.decision}s`, 16)} ${event.proposalId}`;
  }
}

function describeScope(derivation: ScopeDerivation): string[] {
  const lines = [`${INDENT}bound`];
  if (derivation.bindings.length === 0) lines.push(`${INDENT}${INDENT}nothing`);
  for (const binding of derivation.bindings) {
    lines.push(
      `${INDENT}${INDENT}${pad(binding.dimension, 16)}= ${pad(String(binding.value), 12)}` +
        `${pad(binding.route, 10)} event ${binding.evidenceIndex}: "${binding.matchedText}"`,
    );
  }

  if (derivation.contradicted.length > 0) {
    lines.push(`${INDENT}established two ways, so established neither`);
    for (const dimension of derivation.contradicted) lines.push(`${INDENT}${INDENT}${dimension}`);
  }

  // The most instructive part of the whole trace: what the resolver read and
  // refused to believe. Nothing here was filtered out or flagged as hostile.
  if (derivation.ignored.length > 0) {
    lines.push(`${INDENT}seen, and not believed`);
    for (const match of derivation.ignored) {
      const denial = BLOCK_DENIALS[match.blockedBy];
      lines.push(
        `${INDENT}${INDENT}${pad(`${match.dimension}=${String(match.value)}`, 26)}` +
          `${denial.article}/${denial.rule} — ${denial.because}`,
      );
      lines.push(`${INDENT}${INDENT}${" ".repeat(26)}event ${match.evidenceIndex}: "${match.matchedText}"`);
    }
  }

  // A deterministic front door that never engages is a silent usefulness
  // ceiling, so what it never opened for is printed rather than discarded.
  if (derivation.unmatched.length > 0) {
    lines.push(`${INDENT}wording no dimension covers`);
    for (const text of derivation.unmatched) lines.push(`${INDENT}${INDENT}"${text}"`);
  }

  return lines;
}

function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case "fact":
      return `fact         ${claim.entityId}.${claim.factId} = ${formatFactValue(claim.asserted)}`;
    case "count":
      return `count        ${claim.rosterId} = ${claim.reported}`;
    case "membership":
      return `membership   ${claim.entityId} ${claim.asserted ? "is in" : "is not in"} ${claim.rosterId}`;
    case "ranking":
      return `ranking      ${claim.selectedEntityId} has the ${claim.direction} ${claim.basis} in ${claim.rosterId}`;
    case "matchup":
      return `matchup      ${claim.subject.kind === "species" ? claim.subject.entityId : claim.subject.typeId} ${claim.direction} ${claim.members?.join(", ") ?? "(derived by the kernel)"}`;
    case "eligibility":
      return `eligibility  ${claim.entityId} ${claim.finding === undefined ? "(derived by the kernel)" : claim.finding.eligible ? "eligible" : `requires badge ${claim.finding.minimumBadgeLevel}, holds ${claim.finding.badgeLevel}`}`;
    case "recommendation":
      return `advice       ${claim.entityId}`;
    case "action":
      return `act          ${claim.tool} ${claim.entityId}`;
  }
}

function describeExhibit(exhibit: Exhibit): string {
  const owed = exhibit.triggeredBy === undefined ? "" : ` (owed under ${exhibit.triggeredBy})`;
  const block = exhibit.block;
  // The block id and digest rather than the words: what a manifest owes is a
  // named, versioned text, and printing a copy of it here would suggest the
  // record carries the words it has to show.
  return `${exhibit.id}${owed}: block ${block.id} v${block.version} ${block.locale} ${block.digest}`;
}

/** The whole exchange, top to bottom. */
export function describeTransaction(transaction: Transaction): string[] {
  const lines = [
    `transaction  ${transaction.id}`,
    `snapshot     ${transaction.snapshotId}`,
    `pack         ${transaction.packId}`,
    `locale       ${transaction.locale}`,
    `established  ${transaction.establishedAt}   committed ${transaction.committedAt}`,
    "",
    "RECORD",
    ...transaction.transcript.map(describeEvent),
    "",
    "SCOPE  (IA-1 material scope, IA-8 who may establish it)",
    ...describeScope(transaction.derivation),
  ];

  if (transaction.grant !== undefined) {
    const grant = transaction.grant;
    lines.push(
      `${INDENT}grant ${grant.id}, valid ${grant.issuedAt} … ${grant.expiresAt}`,
      `${INDENT}evidence ${grant.evidenceDigest}`,
    );
  }

  const manifest = transaction.manifest;
  if (manifest !== undefined) {
    lines.push("", "ANSWER  (IA-2 … IA-6, every claim recomputed from the snapshot)");
    for (const roster of manifest.rosters) {
      lines.push(`${INDENT}set ${roster.id}: ${roster.cardinality} members where ${describeCriteria(roster.criteria)}`);
    }
    for (const claim of manifest.claims) lines.push(`${INDENT}${describeClaim(claim)}`);
    lines.push(`${INDENT}disclosures owed`);
    for (const exhibit of manifest.exhibits) lines.push(`${INDENT}${INDENT}${describeExhibit(exhibit)}`);
  }

  lines.push("", "VERDICT");
  const outcome = transaction.outcome;
  switch (outcome.status) {
    case "answered":
      for (const entry of transaction.verdicts) {
        lines.push(`${INDENT}${pad(entry.stage, 8)} allowed`);
      }
      lines.push(`${INDENT}the Advisor may commit exactly the manifest above, and nothing else.`);
      break;
    case "clarifying":
      // Not a denial, and not dressed up as one. A kernel that refused every
      // under-specified conversation would be trivially safe and useless.
      lines.push(
        `${INDENT}scope    incomplete — still needed: ${outcome.missing.join(", ")}`,
        `${INDENT}asking   "${outcome.question}"`,
        `${INDENT}no answer is compiled, and no partial answer is released.`,
      );
      break;
    case "denied":
      lines.push(`${INDENT}refused at the ${outcome.stage} stage`);
      lines.push(...describeDenials(outcome.violations).map((line) => `${INDENT}${line}`));
      break;
  }

  return lines;
}
