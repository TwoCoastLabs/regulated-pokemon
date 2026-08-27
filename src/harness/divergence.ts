/**
 * Chat-versus-certificate divergence (epic #94, slice 2; absorbs epic #87
 * slice 4).
 *
 * The design draws a deliberate line — the sales-call/prospectus split: the
 * governed certificate is verified and is the product; the ungoverned reply
 * beside it (the "chat") may charm and carries no certificate. The visitor
 * reads both. This asks the number no filed run has: **when the ungoverned arm
 * states a value for something the certificate is also about, how often does it
 * contradict the certified value?** A high rate is a risk the essay must
 * disclose; a low one is the split holding in practice.
 *
 * The instrument is offline, deterministic, key-free — a pure function of a
 * filed artifact and the registry. It never runs a model; it reads the raw
 * arm's already-published claims, folds their names canonically (the same
 * decoder the governed path uses, so a spelling is not miscounted as a
 * divergence), and compares each asserted fact to the certified value for
 * entities the governed certificate mentions.
 *
 * Two honesty bounds, stated because they bound what the number means:
 *
 *  - **It is a floor, recall-gated.** Only a raw `fact` claim that carries an
 *    asserted value, resolves to a certified fact, and names an entity the
 *    certificate is about is comparable. Prose the model added around its
 *    claims is not in the record (the answer grammar strips it), and a count or
 *    a ranking the raw arm merely *stated* is measured elsewhere; so real
 *    chat-vs-certificate contradictions can only be more than this counts,
 *    never fewer.
 *  - **The certificate's entity set is what a visitor sees**: every entity a
 *    committed claim names, plus every member of a roster the answer committed
 *    (the visible list). A raw assertion about an entity outside that set is
 *    reported apart as `rawOnly` — the chat volunteering something the
 *    certificate never spoke to, a softer divergence than a contradiction on
 *    shared ground.
 */

import type { Claim, FactValue } from "../kernel/contracts.js";
import { type CertifiedRegistry, formatFactValue, sameFactValue } from "../kernel/registry.js";
import { canonicalizeClaims } from "./canonical.js";

interface CertificateManifest {
  claims?: readonly Claim[];
  rosters?: readonly { id: string; memberIds?: readonly string[] }[];
}

/** The minimal shape of a filed artifact this reads — coverage or live. */
export interface DivergenceInput {
  runs: readonly {
    providerId: string;
    scenarioId: string;
    repetition: number;
    transaction?: { manifest?: CertificateManifest };
  }[];
  raw?: { runs: readonly { providerId: string; scenarioId: string; repetition: number; claims?: readonly Claim[] }[] };
}

export interface DivergencePoint {
  scenarioId: string;
  repetition: number;
  entityId: string;
  factId: string;
  certified: string;
  asserted: string;
}

export interface DivergenceReport {
  /** Scenarios (by id+repetition) that carried both a governed certificate and a raw answer. */
  scenarios: number;
  /** Raw asserted facts about an entity the certificate is also about — the denominator. */
  comparable: number;
  /** …of those, the ones whose asserted value equals the certified value. */
  agreements: number;
  /** …and the ones that contradict it — the divergence a visitor could see. */
  divergences: readonly DivergencePoint[];
  /** Raw asserted facts about an entity the certificate never mentioned — reported apart. */
  rawOnly: number;
  /** Raw fact claims that carried no asserted value (name-only) — not comparable, counted for honesty. */
  nameOnly: number;
}

/** Every entity the governed certificate is about — claim subjects and the visible roster members. */
function certificateEntities(manifest: CertificateManifest | undefined): ReadonlySet<string> {
  const entities = new Set<string>();
  for (const claim of manifest?.claims ?? []) {
    if (
      claim.kind === "fact" ||
      claim.kind === "membership" ||
      claim.kind === "recommendation" ||
      claim.kind === "action" ||
      claim.kind === "eligibility"
    ) {
      entities.add(claim.entityId);
    }
    if (claim.kind === "ranking" && claim.selectedEntityId !== undefined) entities.add(claim.selectedEntityId);
    if (claim.kind === "matchup" && claim.subject.kind === "species") entities.add(claim.subject.entityId);
  }
  for (const roster of manifest?.rosters ?? []) for (const id of roster.memberIds ?? []) entities.add(id);
  return entities;
}

/** Compare each filed raw answer to the certificate beside it. Pure. */
export function divergence(registry: CertifiedRegistry, input: DivergenceInput): DivergenceReport {
  // Keyed by provider too: strong, weak and adversarial arms share a
  // scenario id and repetition, so the governed run must be paired to the raw
  // run of the *same* model, not whichever arm the map saw last.
  const governed = new Map(input.runs.map((run) => [`${run.providerId} ${run.scenarioId} ${run.repetition}`, run]));
  let scenarios = 0;
  let comparable = 0;
  let agreements = 0;
  let rawOnly = 0;
  let nameOnly = 0;
  const divergences: DivergencePoint[] = [];

  for (const rawRun of input.raw?.runs ?? []) {
    const key = `${rawRun.providerId} ${rawRun.scenarioId} ${rawRun.repetition}`;
    const govern = governed.get(key);
    const manifest = govern?.transaction?.manifest;
    if (manifest === undefined || rawRun.claims === undefined) continue;
    scenarios += 1;
    const entities = certificateEntities(manifest);
    for (const claim of canonicalizeClaims(registry, rawRun.claims)) {
      if (claim.kind !== "fact") continue;
      if (claim.asserted === undefined) {
        nameOnly += 1;
        continue;
      }
      if (!entities.has(claim.entityId)) {
        rawOnly += 1;
        continue;
      }
      const resolved = registry.resolve(claim.entityId, claim.factId);
      if (!resolved.ok) {
        // A raw claim about a certificate entity but an uncertified fact id:
        // not a value collision, and the fabrication meter counts it already.
        rawOnly += 1;
        continue;
      }
      comparable += 1;
      if (sameFactValue(resolved.value, claim.asserted)) {
        agreements += 1;
      } else {
        divergences.push({
          scenarioId: rawRun.scenarioId,
          repetition: rawRun.repetition,
          entityId: claim.entityId,
          factId: claim.factId,
          certified: formatFactValue(resolved.value),
          asserted: formatFactValue(claim.asserted),
        });
      }
    }
  }

  return { scenarios, comparable, agreements, divergences, rawOnly, nameOnly };
}

/** The report as Markdown, rendered from the data — never hand-transcribed. */
export function renderDivergence(report: DivergenceReport, sourceLabel: string): string {
  const rate =
    report.comparable === 0
      ? "—"
      : `${report.divergences.length}/${report.comparable} (${Math.round((report.divergences.length / report.comparable) * 100)}%)`;
  const lines: string[] = [];
  lines.push(`Source: ${sourceLabel}. ${report.scenarios} exchange(s) carried both a certificate and an ungoverned answer.`);
  lines.push("");
  lines.push(`- **Comparable asserted facts** (raw states a value for an entity the certificate is about): ${report.comparable}`);
  lines.push(`- **Agreements**: ${report.agreements}`);
  lines.push(`- **Divergences** (the ungoverned value contradicts the certified one): **${rate}** — a floor`);
  lines.push(`- Raw assertions about entities the certificate never mentioned (reported apart): ${report.rawOnly}`);
  lines.push(`- Raw fact claims with no asserted value (not comparable): ${report.nameOnly}`);
  if (report.divergences.length > 0) {
    lines.push("");
    lines.push("Divergences, named:");
    lines.push("");
    for (const point of report.divergences) {
      lines.push(
        `- \`${point.scenarioId}\`#${point.repetition + 1}: ${point.entityId}'s ${point.factId} — chat said **${point.asserted}**, certificate **${point.certified}**`,
      );
    }
  }
  return lines.join("\n");
}
