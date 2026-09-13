/**
 * How each certified claim was formed, and at what scale — the layer under
 * the trail's "N claim(s) certified" line (dogfood, 2026-09-13: "for a
 * 1-vs-N selection, what is N? for a list, what does it hold?").
 *
 * Everything here is read from the manifest the kernel committed: a
 * ranking's winner, a count's number, a comparison's two values, a matchup's
 * members and an eligibility finding are all filled by `compileManifest` and
 * travel in the record, and every roster a claim cites travels inside it
 * with its criteria and members (IA-4: the roster *is* the count). The one
 * thing the record does not carry is the *field* of a ranking — each
 * member's value on the basis — because the kernel re-resolves it at verify
 * time rather than trusting a stated one. A caller that holds the certified
 * registry may pass it as the `source`, and the view then lists the field
 * the way the kernel ranked it; without one the view still names the set,
 * its size and its members. A lesson's text is the pack's, likewise
 * optional. Nothing is derived here that the kernel did not derive first:
 * the view orders and formats, it never decides.
 */

import type { AnswerManifest, Claim, ClosedRoster, FactValue, Resolution } from "../kernel/contracts.js";
import { describeFinding } from "../kernel/eligibility.js";
import { describeCriteria } from "../kernel/roster.js";
import { formatFactValue } from "../kernel/registry.js";
import { describeClaim } from "./viewmodel.js";

/** Where a view may look up what the record does not carry — the certified
 * registry's `resolve`, and the pack's reviewed lesson text by block id. */
export interface ClaimSource {
  resolve(entityId: string, factId: string): Resolution<FactValue>;
  lesson?(blockId: string, locale: string): string | undefined;
}

/** One certified claim: its line, the scale it worked at, and the lines
 * under it that show what it was formed from. */
export interface ClaimView {
  kind: Claim["kind"];
  /** The console's one line for the claim ({@link describeClaim}). */
  summary: string;
  /** The claim's scale in the record's own numbers — "1 of 9", "9 members",
   * "2 values", "4 types" — or nothing for a claim with no set behind it. */
  scale?: string;
  /** What the claim was formed from: the ranked field, the set's members,
   * the two values compared, the finding, the lesson's size. */
  lines: readonly string[];
}

/** One roster the manifest carries, as the closed set it is. */
export interface RosterView {
  id: string;
  /** "9 members". */
  scale: string;
  /** The set definition, in the kernel's own wording. */
  criteria: string;
  members: readonly string[];
}

export interface ManifestView {
  claims: readonly ClaimView[];
  rosters: readonly RosterView[];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function rosterView(roster: ClosedRoster): RosterView {
  return {
    id: roster.id,
    scale: plural(roster.cardinality, "member"),
    criteria: describeCriteria(roster.criteria),
    members: roster.memberIds,
  };
}

/** The ranked field: every member's value on the basis, in the direction
 * the claim ranked, the winner first. A member the registry cannot resolve
 * is listed as such — the kernel would have refused the ranking; the view
 * shows the reader why, never a guessed number. */
function rankedField(roster: ClosedRoster, basis: string, direction: "highest" | "lowest", source: ClaimSource): string[] {
  const scored = roster.memberIds.map((entityId) => {
    const resolved = source.resolve(entityId, basis);
    return { entityId, value: resolved.ok ? resolved.value : undefined };
  });
  const numeric = scored.every((entry) => entry.value?.kind === "number");
  if (!numeric) {
    return scored.map((entry) => `${entry.entityId} — ${basis} ${entry.value === undefined ? "unresolved" : formatFactValue(entry.value)}`);
  }
  const ordered = [...scored].sort((a, b) => {
    const left = a.value?.kind === "number" ? a.value.value : 0;
    const right = b.value?.kind === "number" ? b.value.value : 0;
    return direction === "highest" ? right - left : left - right;
  });
  return ordered.map((entry, index) => `${index + 1}. ${entry.entityId} — ${basis} ${entry.value === undefined ? "?" : formatFactValue(entry.value)}`);
}

function claimView(claim: Claim, rosters: readonly ClosedRoster[], locale: string, source: ClaimSource | undefined): ClaimView {
  const summary = describeClaim(claim);
  const roster = (id: string): ClosedRoster | undefined => rosters.find((entry) => entry.id === id);
  const value = (entityId: string, factId: string, stated: FactValue | undefined): string => {
    if (stated !== undefined) return formatFactValue(stated);
    const resolved = source?.resolve(entityId, factId);
    return resolved === undefined ? "derived by the kernel" : resolved.ok ? formatFactValue(resolved.value) : "unresolved";
  };
  switch (claim.kind) {
    case "fact":
      return { kind: claim.kind, summary, scale: "1 value", lines: [`${claim.entityId} · ${claim.factId} = ${value(claim.entityId, claim.factId, claim.asserted)}`] };
    case "count": {
      const set = roster(claim.rosterId);
      return {
        kind: claim.kind,
        summary,
        ...(set === undefined ? {} : { scale: plural(set.cardinality, "member") }),
        lines: set === undefined ? [`roster ${claim.rosterId} is not in the record`] : [`the set: species ${describeCriteria(set.criteria)}`, `members: ${set.memberIds.join(", ")}`],
      };
    }
    case "typeCount":
      return { kind: claim.kind, summary, ...(claim.reported === undefined ? {} : { scale: plural(claim.reported, "type") }), lines: ["the certified type chart's closed set of types"] };
    case "gameRule":
      return { kind: claim.kind, summary, scale: "1 rule", lines: [`${claim.ruleId} = ${claim.reported ?? "derived by the kernel"} — from the pack's reviewed game rules`] };
    case "membership": {
      const set = roster(claim.rosterId);
      return {
        kind: claim.kind,
        summary,
        ...(set === undefined ? {} : { scale: `1 of ${set.cardinality}` }),
        lines: set === undefined ? [] : [`${claim.entityId} ${claim.asserted ? "is" : "is not"} among the ${set.cardinality} species ${describeCriteria(set.criteria)}`],
      };
    }
    case "treats":
      return {
        kind: claim.kind,
        summary,
        lines: [`${claim.itemId} ${claim.asserted === undefined ? "— derived by the kernel from the item's certified effects" : claim.asserted ? "treats" : "does not treat"} ${claim.condition}`],
      };
    case "comparison": {
      const left = claim.left ?? (source?.resolve(claim.leftId, claim.factId).ok === true ? (source.resolve(claim.leftId, claim.factId) as { ok: true; value: FactValue }).value : undefined);
      const right = claim.right ?? (source?.resolve(claim.rightId, claim.factId).ok === true ? (source.resolve(claim.rightId, claim.factId) as { ok: true; value: FactValue }).value : undefined);
      const lines = [
        `${claim.leftId} · ${claim.factId} = ${left === undefined ? "derived by the kernel" : formatFactValue(left)}`,
        `${claim.rightId} · ${claim.factId} = ${right === undefined ? "derived by the kernel" : formatFactValue(right)}`,
      ];
      if (left?.kind === "number" && right?.kind === "number") {
        lines.push(left.value === right.value ? "equal" : `${left.value > right.value ? claim.leftId : claim.rightId} leads by ${Math.abs(left.value - right.value)}`);
      }
      return { kind: claim.kind, summary, scale: "2 values", lines };
    }
    case "ranking": {
      const set = roster(claim.rosterId);
      if (set === undefined) return { kind: claim.kind, summary, lines: [`roster ${claim.rosterId} is not in the record`] };
      const lines =
        source === undefined
          ? [`the set: species ${describeCriteria(set.criteria)}`, `members (Pokédex order): ${set.memberIds.join(", ")}`, `the field's ${claim.basis} values are re-resolved by the kernel, not carried in the record`]
          : [`the set: species ${describeCriteria(set.criteria)}`, ...rankedField(set, claim.basis, claim.direction, source)];
      return { kind: claim.kind, summary, scale: `1 of ${set.cardinality}`, lines };
    }
    case "matchup": {
      const subject = claim.subject.kind === "species" ? claim.subject.entityId : claim.subject.typeId;
      return {
        kind: claim.kind,
        summary,
        ...(claim.members === undefined ? {} : { scale: plural(claim.members.length, "type") }),
        lines: claim.members === undefined ? ["derived by the kernel from the certified type chart"] : [`${subject} ${claim.direction}: ${claim.members.length === 0 ? "nothing" : claim.members.join(", ")} — read off the certified type chart`],
      };
    }
    case "eligibility":
      return {
        kind: claim.kind,
        summary,
        lines: claim.finding === undefined ? ["derived by the kernel from the pack, the snapshot and the grant"] : [describeFinding(claim.finding)],
      };
    case "explanation": {
      const text = source?.lesson?.(claim.blockId, locale);
      const words = text === undefined ? undefined : text.trim().split(/\s+/).filter((word) => word.length > 0).length;
      return {
        kind: claim.kind,
        summary,
        ...(words === undefined ? {} : { scale: plural(words, "word") }),
        lines:
          text === undefined
            ? ["a reviewed, digest-pinned text from the pack's curriculum, shown verbatim"]
            : [`${plural(words ?? 0, "word")} of reviewed text, shown verbatim`, `“${text.trim().slice(0, 120)}${text.trim().length > 120 ? "…" : ""}”`],
      };
    }
    case "recommendation":
      return { kind: claim.kind, summary, lines: ["advice — gated by IA-5 against the trainer's accreditation"] };
    case "action":
      return { kind: claim.kind, summary, lines: ["an act — rendered on the page and executed only behind the trainer's consent"] };
  }
}

/** Every claim and roster of a committed manifest, as the reader sees them. */
export function manifestView(manifest: Pick<AnswerManifest, "claims" | "rosters" | "locale">, source?: ClaimSource): ManifestView {
  return {
    claims: manifest.claims.map((claim) => claimView(claim, manifest.rosters, manifest.locale, source)),
    rosters: manifest.rosters.map(rosterView),
  };
}
