/**
 * Answer compilation and manifest verification (IA-1 … IA-6).
 *
 * The registry can certify one datum. This is the layer that assembles data
 * into an *answer* and then refuses to believe it. An `AnswerManifest` is the
 * closed set of what may be committed: every claim carries what it asserted,
 * every roster a claim cites travels inside the record, and every disclosure
 * the Accord pack demands is attached as an obligation.
 *
 * Verification recomputes all of it from the snapshot, and knows nothing about
 * how the manifest was produced. That is the whole point: a manifest from the
 * compiler, from a cache, from a mutated fixture, or eventually from a model
 * is checked identically, so nothing about the producer can be load-bearing.
 *
 * The compiler is deliberately built on top of the verifier rather than beside
 * it. `compileManifest` assembles a candidate and then submits it to exactly
 * the check a hostile manifest would face, so there is no path by which the
 * thing that produces answers can be more trusted than the thing that audits
 * them.
 */

import type {
  AnswerManifest,
  Claim,
  ClosedRoster,
  DisclosureBlockRef,
  Exhibit,
  Resolution,
  ScopeGrant,
  Verdict,
  Violation,
} from "./contracts.js";
import { type AccordPack, actionRule, approvesLocale, blockFor, type ExhibitRule, restrictionsFor } from "./pack.js";
import { type CertifiedRegistry, formatFactValue, sameFactValue } from "./registry.js";
import { verifyRoster } from "./roster.js";
import { verdictOf, violation } from "./violation.js";

/**
 * Everything an answer is judged against. Assembled by the caller and passed
 * whole, so that no stage can quietly consult a registry, pack, or clock other
 * than the one the verdict will record.
 */
export interface ManifestContext {
  registry: CertifiedRegistry;
  pack: AccordPack;
  grant: ScopeGrant;
  /**
   * The locale the answer will be presented in, assigned by the transport.
   *
   * Deliberately part of the context rather than of the draft: the thing that
   * proposes an answer does not get to choose which approved translation of a
   * mandatory disclosure it will have to satisfy.
   */
  locale: string;
  /**
   * RFC 3339. The moment the answer commits, supplied rather than read from a
   * clock: a verdict must be a pure function of recorded inputs (IA-10), and a
   * validity window checked against `now()` cannot be replayed.
   */
  at: string;
}

/** What a caller brings: the claims it wants to make and the sets behind them. */
export interface ManifestDraft {
  transactionId: string;
  claims: readonly Claim[];
  rosters: readonly ClosedRoster[];
}

/**
 * Assemble a manifest, attach the disclosures the pack requires, and refuse to
 * emit it if it would not survive verification.
 */
/**
 * Fill in the values a claim leaves to the kernel to derive, from the certified
 * sets the same draft defines.
 *
 * Two today, both arithmetic the model should not be redoing: a `count` with no
 * `reported` becomes the roster's cardinality (the roster is the count), and a
 * `ranking` with no `selectedEntityId` becomes the extreme member the set,
 * basis and direction already determine. Deriving here is not trust — it is
 * computation, and `verifyManifest` recomputes both afterwards exactly as it
 * would values the model had stated. A claim over a roster the draft never
 * defined, or a ranking with no unique winner (a tie, an unorderable basis), is
 * left unfilled, so the check can report the real reason rather than this
 * quietly inventing one.
 */
function deriveClaims(context: ManifestContext, claims: readonly Claim[], rosters: readonly ClosedRoster[]): Claim[] {
  const roster = (id: string): ClosedRoster | undefined => rosters.find((entry) => entry.id === id);
  return claims.map((claim) => {
    if (claim.kind === "count" && claim.reported === undefined) {
      const set = roster(claim.rosterId);
      return set === undefined ? claim : { ...claim, reported: set.cardinality };
    }
    if (claim.kind === "ranking" && claim.selectedEntityId === undefined) {
      const set = roster(claim.rosterId);
      if (set === undefined) return claim;
      const outcome = rankRoster(context, set, claim.basis, claim.direction);
      return outcome.ok ? { ...claim, selectedEntityId: outcome.winner } : claim;
    }
    return claim;
  });
}

export function compileManifest(context: ManifestContext, draft: ManifestDraft): Resolution<AnswerManifest> {
  const claims = deriveClaims(context, draft.claims, draft.rosters);
  const manifest: AnswerManifest = {
    transactionId: draft.transactionId,
    scopeGrantId: context.grant.id,
    snapshotId: context.registry.snapshot.id,
    packId: context.pack.id,
    locale: context.locale,
    claims,
    rosters: draft.rosters,
    exhibits: requiredExhibits(context, claims, draft.rosters),
  };

  const verdict = verifyManifest(context, manifest);
  if (!verdict.allowed) return { ok: false, violations: verdict.violations };
  return { ok: true, value: manifest };
}

/**
 * Recompute every claim in a manifest and report every disagreement by name.
 * This is the commit gate for answers, and the only thing standing between a
 * plausible sentence and a certified one.
 */
export function verifyManifest(context: ManifestContext, manifest: AnswerManifest): Verdict {
  // Binding first, and alone: if the manifest is certified against another
  // snapshot, pack, or trainer, then recomputing its claims against *these*
  // would be answering a question nobody asked.
  const binding = checkBinding(context, manifest);
  if (binding.length > 0) return verdictOf(binding);

  const violations = [
    ...checkRosters(context, manifest),
    ...checkExhibits(context, manifest),
    ...manifest.claims.flatMap((claim) => checkClaim(context, manifest, claim)),
  ];
  return verdictOf(violations);
}

// --- binding ----------------------------------------------------------------

function checkBinding(context: ManifestContext, manifest: AnswerManifest): Violation[] {
  const violations: Violation[] = [];

  if (manifest.transactionId.length === 0) {
    violations.push(violation("IA-10", "transaction-unidentified", "manifest has no transaction id"));
  }

  if (manifest.snapshotId !== context.registry.snapshot.id) {
    violations.push(
      violation("IA-2", "snapshot-mismatch", `manifest ${manifest.transactionId} was certified against another snapshot`, {
        expected: context.registry.snapshot.id,
        actual: manifest.snapshotId,
      }),
    );
  }

  if (manifest.packId !== context.pack.id) {
    violations.push(
      violation("IA-5", "pack-mismatch", `manifest ${manifest.transactionId} was governed by another Accord pack`, {
        expected: context.pack.id,
        actual: manifest.packId,
      }),
    );
  }

  // Which locale an answer was certified for decides which formatter turns its
  // values into strings and which translation of a disclosure satisfies it, so
  // an answer judged under another locale is an answer to a different question.
  if (manifest.locale !== context.locale) {
    violations.push(
      violation("IA-6", "locale-mismatch", `manifest ${manifest.transactionId} was certified for another locale`, {
        expected: context.locale,
        actual: manifest.locale || "no locale",
      }),
    );
  } else if (!approvesLocale(context.pack, manifest.locale)) {
    violations.push(
      violation("IA-6", "locale-unapproved", `pack ${context.pack.id} does not approve presentation in ${manifest.locale}`, {
        expected: context.pack.presentation.locales.join(", "),
        actual: manifest.locale || "no locale",
      }),
    );
  }

  if (manifest.scopeGrantId !== context.grant.id) {
    violations.push(
      violation("IA-1", "scope-grant-mismatch", `manifest ${manifest.transactionId} cites another trainer's scope`, {
        expected: context.grant.id,
        actual: manifest.scopeGrantId,
      }),
    );
  }

  // Facts are only facts within the version that certifies them, so a grant
  // establishing scope over a different version group cannot authorise an
  // answer drawn from this one.
  const versionGroup = context.registry.document.scope.versionGroup;
  if (context.grant.scope.version !== versionGroup) {
    violations.push(
      violation("IA-2", "scope-version-mismatch", "scope was established over a different version group", {
        expected: versionGroup,
        actual: context.grant.scope.version,
      }),
    );
  }

  violations.push(...checkWindow(context));
  return violations;
}

/**
 * Scope valid when it was issued is not scope valid when the answer commits,
 * so the window is checked here rather than trusted from construction.
 */
function checkWindow(context: ManifestContext): Violation[] {
  const at = Date.parse(context.at);
  const issued = Date.parse(context.grant.issuedAt);
  const expires = Date.parse(context.grant.expiresAt);

  if (Number.isNaN(at) || Number.isNaN(issued) || Number.isNaN(expires)) {
    return [
      violation("IA-1", "scope-window-unreadable", "scope grant has no readable validity window", {
        expected: "RFC 3339 timestamps",
        actual: `${context.grant.issuedAt}..${context.grant.expiresAt} at ${context.at}`,
      }),
    ];
  }
  if (issued >= expires) {
    return [
      violation("IA-1", "scope-window-empty", `scope grant ${context.grant.id} expires before it is issued`, {
        expected: `after ${context.grant.issuedAt}`,
        actual: context.grant.expiresAt,
      }),
    ];
  }
  if (at < issued || at > expires) {
    return [
      violation("IA-1", "scope-window-expired", `scope grant ${context.grant.id} is not valid at commit time`, {
        expected: `${context.grant.issuedAt}..${context.grant.expiresAt}`,
        actual: context.at,
      }),
    ];
  }
  return [];
}

// --- rosters ----------------------------------------------------------------

function checkRosters(context: ManifestContext, manifest: AnswerManifest): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();

  for (const roster of manifest.rosters) {
    if (seen.has(roster.id)) {
      violations.push(
        violation("IA-4", "duplicate-roster", `manifest carries roster "${roster.id}" more than once`, {
          actual: roster.id,
        }),
      );
    }
    seen.add(roster.id);
    violations.push(...verifyRoster(context.registry, roster).violations);
  }

  return violations;
}

function rosterIn(manifest: AnswerManifest, rosterId: string): ClosedRoster | undefined {
  return manifest.rosters.find((roster) => roster.id === rosterId);
}

function missingRoster(rosterId: string): Violation {
  return violation("IA-4", "roster-not-in-manifest", `no roster "${rosterId}" travels with this manifest`, {
    actual: rosterId,
  });
}

// --- claims -----------------------------------------------------------------

function checkClaim(context: ManifestContext, manifest: AnswerManifest, claim: Claim): Violation[] {
  switch (claim.kind) {
    case "fact":
      return checkFact(context, claim);
    case "count":
      return checkCount(manifest, claim);
    case "membership":
      return checkMembership(context, manifest, claim);
    case "ranking":
      return checkRanking(context, manifest, claim);
    case "recommendation":
      return checkRecommendation(context, claim);
    case "action":
      return checkAction(context, claim);
  }
}

function checkFact(context: ManifestContext, claim: Extract<Claim, { kind: "fact" }>): Violation[] {
  const resolved = context.registry.resolve(claim.entityId, claim.factId);
  if (!resolved.ok) return [...resolved.violations];

  if (sameFactValue(resolved.value, claim.asserted)) return [];
  return [
    violation(
      "IA-2",
      "fact-mismatch",
      `snapshot ${context.registry.snapshot.id} does not certify that ${claim.entityId}'s ${claim.factId} is what this answer says`,
      { expected: formatFactValue(resolved.value), actual: formatFactValue(claim.asserted) },
    ),
  ];
}

function checkCount(manifest: AnswerManifest, claim: Extract<Claim, { kind: "count" }>): Violation[] {
  const roster = rosterIn(manifest, claim.rosterId);
  if (roster === undefined) return [missingRoster(claim.rosterId)];

  // The roster is the count. An omitted number defers to the cardinality and so
  // can never disagree; a stated number that disagrees with the set it came from
  // is not a rounding error, it is a different claim.
  if (claim.reported === undefined || claim.reported === roster.cardinality) return [];
  return [
    violation("IA-4", "count-mismatch", `the count shown for "${roster.id}" is not the cardinality of its set`, {
      expected: String(roster.cardinality),
      actual: String(claim.reported),
    }),
  ];
}

function checkMembership(
  context: ManifestContext,
  manifest: AnswerManifest,
  claim: Extract<Claim, { kind: "membership" }>,
): Violation[] {
  if (context.registry.findSpecies(claim.entityId) === undefined) {
    return [
      violation("IA-3", "fabricated-entity", `"${claim.entityId}" is not certified by ${context.registry.snapshot.id}`, {
        expected: `a species in ${context.registry.snapshot.id}`,
        actual: claim.entityId,
      }),
    ];
  }
  const roster = rosterIn(manifest, claim.rosterId);
  if (roster === undefined) return [missingRoster(claim.rosterId)];

  const actual = roster.memberIds.includes(claim.entityId);
  if (actual === claim.asserted) return [];
  return [
    violation("IA-4", "membership-mismatch", `"${claim.entityId}" in "${roster.id}" is not what this answer says`, {
      expected: String(actual),
      actual: String(claim.asserted),
    }),
  ];
}

function checkRecommendation(
  context: ManifestContext,
  claim: Extract<Claim, { kind: "recommendation" }>,
): Violation[] {
  const species = context.registry.findSpecies(claim.entityId);
  if (species === undefined) return [fabricated(context, claim.entityId)];
  return checkAccreditation(context, claim.entityId, species);
}

/**
 * A consequential act, before anything about the trainer's page is known.
 *
 * Two questions here and one everywhere else. This layer asks whether the act
 * is one the Accord declares and whether this trainer may be its subject; that
 * it was shown, confirmed and executed in that order is Article VII's, and
 * lives in ./action.ts.
 */
function checkAction(context: ManifestContext, claim: Extract<Claim, { kind: "action" }>): Violation[] {
  const species = context.registry.findSpecies(claim.entityId);
  if (species === undefined) return [fabricated(context, claim.entityId)];

  const rule = actionRule(context.pack, claim.tool);
  if (rule === undefined) {
    // Closed, like every other list here. An unapproved tool is not an act the
    // Accord happens not to mention; it is a way of changing the trainer's
    // state that no rule — including Article IX's — was ever written about.
    return [
      violation("IA-7", "unknown-action", `pack ${context.pack.id} declares no action "${claim.tool}"`, {
        expected: context.pack.actions.map((entry) => entry.id).join(", ") || "no actions",
        actual: claim.tool,
      }),
    ];
  }

  // The same gate a recommendation faces. Advice to acquire a restricted
  // species is gated, so an act that hands one over is gated identically — and
  // where the direction of the transfer makes that read oddly (a trainer being
  // refused permission to release what they already hold), the refusal is on
  // the safe side of the error.
  return checkAccreditation(context, claim.entityId, species);
}

function fabricated(context: ManifestContext, entityId: string): Violation {
  return violation("IA-3", "fabricated-entity", `"${entityId}" is not certified by ${context.registry.snapshot.id}`, {
    expected: `a species in ${context.registry.snapshot.id}`,
    actual: entityId,
  });
}

/** Whether this trainer is accredited to be advised of, or handed, a species. */
function checkAccreditation(
  context: ManifestContext,
  entityId: string,
  species: { isLegendary: boolean; isMythical: boolean },
): Violation[] {
  const badgeLevel = context.grant.scope.badgeLevel;
  return restrictionsFor(context.pack, species)
    .filter((rule) => badgeLevel < rule.minimumBadgeLevel)
    .map((rule) =>
      // The rule id is in the denial because "blocked by policy" is banned:
      // a refusal that cannot be traced to the sentence that produced it
      // cannot be argued with or audited.
      violation(
        rule.article,
        "restricted-species",
        `${entityId} is a restricted species under "${rule.id}" and this trainer is not accredited for it`,
        { expected: `badge level ${rule.minimumBadgeLevel}`, actual: `badge level ${badgeLevel}` },
      ),
    );
}

// --- ranking ----------------------------------------------------------------

/**
 * The extreme member of a roster by a certified basis, or the reason there
 * isn't one. Shared by {@link checkRanking} and {@link deriveClaims}, so the
 * winner a manifest is filled with and the winner it is verified against are
 * computed the one way — the same discipline that lets a grant rest on the
 * derivation that audits it.
 *
 * The basis is re-resolved per member rather than trusted: a ranking is only as
 * certified as the facts it ordered. A tie is not a coin flip — "the fastest"
 * when two share the top speed is a wrong claim, and argmax over an array would
 * answer it with whichever the Pokédex happens to list first — so a shared
 * extreme is a refusal, not a winner.
 */
function rankRoster(
  context: ManifestContext,
  roster: ClosedRoster,
  basis: string,
  direction: "highest" | "lowest",
): { ok: true; winner: string; score: number } | { ok: false; violations: Violation[] } {
  if (roster.memberIds.length === 0) {
    return {
      ok: false,
      violations: [
        violation("IA-4", "ranking-over-empty-roster", `"${roster.id}" has no members, so nothing in it can be first`, {
          actual: roster.id,
        }),
      ],
    };
  }

  const scores: Array<{ entityId: string; score: number }> = [];
  for (const memberId of roster.memberIds) {
    const resolved = context.registry.resolve(memberId, basis);
    if (!resolved.ok) return { ok: false, violations: [...resolved.violations] };
    if (resolved.value.kind !== "number") {
      return {
        ok: false,
        violations: [
          violation("IA-4", "ranking-basis-not-ordered", `"${basis}" is not a quantity, so it cannot rank a set`, {
            expected: "a numeric certified fact",
            actual: `${basis} (${resolved.value.kind})`,
          }),
        ],
      };
    }
    scores.push({ entityId: memberId, score: resolved.value.value });
  }

  const best = scores.reduce(
    (chosen, candidate) => (direction === "highest" ? Math.max(chosen, candidate.score) : Math.min(chosen, candidate.score)),
    direction === "highest" ? -Infinity : Infinity,
  );
  const winners = scores.filter((entry) => entry.score === best).map((entry) => entry.entityId);
  if (winners.length > 1) {
    return {
      ok: false,
      violations: [
        violation(
          "IA-4",
          "ranking-tie",
          `${winners.length} members of "${roster.id}" share the ${direction} ${basis}, so none of them is the one`,
          { expected: `a unique ${direction} ${basis}`, actual: winners.join(", ") },
        ),
      ],
    };
  }
  return { ok: true, winner: winners[0]!, score: best };
}

function checkRanking(
  context: ManifestContext,
  manifest: AnswerManifest,
  claim: Extract<Claim, { kind: "ranking" }>,
): Violation[] {
  const roster = rosterIn(manifest, claim.rosterId);
  if (roster === undefined) return [missingRoster(claim.rosterId)];

  // The set, basis and direction decide the winner before the claim's own guess
  // is consulted: an empty set, an unorderable basis or a tie is refused whether
  // or not a member was named.
  const outcome = rankRoster(context, roster, claim.basis, claim.direction);
  if (!outcome.ok) return outcome.violations;

  // An omitted selection defers to the computed winner and cannot disagree.
  if (claim.selectedEntityId === undefined) return [];

  if (!roster.memberIds.includes(claim.selectedEntityId)) {
    return [
      violation(
        "IA-4",
        "ranking-outside-roster",
        `"${claim.selectedEntityId}" was ranked first in "${roster.id}", which does not contain it`,
        { expected: `a member of ${roster.id}`, actual: claim.selectedEntityId },
      ),
    ];
  }
  if (claim.selectedEntityId === outcome.winner) return [];
  return [
    violation("IA-4", "ranking-mismatch", `"${claim.selectedEntityId}" does not have the ${claim.direction} ${claim.basis} in "${roster.id}"`, {
      expected: `${outcome.winner} (${outcome.score})`,
      actual: claim.selectedEntityId,
    }),
  ];
}

// --- exhibits ---------------------------------------------------------------

/**
 * Which disclosures this answer owes, derived from the pack and the claims.
 *
 * Phase 2 can only prove an obligation was recorded. Whether the trainer saw
 * it is IA-6's other half, and belongs to the render affidavit.
 */
export function requiredExhibits(
  context: ManifestContext,
  claims: readonly Claim[],
  rosters: readonly ClosedRoster[],
): readonly Exhibit[] {
  return triggeredRules(context, claims, rosters).flatMap((triggered) => {
    const content = blockFor(triggered.rule, context.locale);
    // A rule with no approved text in this locale is denied by name in
    // `checkExhibits` rather than quietly satisfied with the words from
    // another one: a translation is separately approved, never substituted.
    if (content === undefined) return [];
    return [
      {
        id: triggered.id,
        rule: triggered.rule.id,
        kind: triggered.rule.kind,
        block: {
          id: triggered.rule.block.id,
          version: triggered.rule.block.version,
          locale: context.locale,
          digest: content.digest,
        },
        triggeredBy: triggered.rule.article,
        ...(triggered.entityId === undefined ? {} : { entityId: triggered.entityId }),
        ...(triggered.tool === undefined ? {} : { tool: triggered.tool }),
      },
    ];
  });
}

/**
 * One firing of one pack rule: the rule, the unit it owes, and what fired it.
 *
 * A rule and an obligation are not the same thing once acts are in the picture.
 * "Releasing is permanent" is one rule, and an answer proposing to release two
 * Pokémon owes two notices — each naming its own species, each beside its own
 * act — so the firing carries an id of its own rather than borrowing the
 * rule's.
 */
interface TriggeredExhibit {
  id: string;
  rule: ExhibitRule;
  entityId?: string;
  tool?: string;
}

/** The pack rules this answer fires, before any question of what they say. */
function triggeredRules(
  context: ManifestContext,
  claims: readonly Claim[],
  rosters: readonly ClosedRoster[],
): readonly TriggeredExhibit[] {
  const mentioned = entitiesMentioned(claims, rosters);
  const triggered: TriggeredExhibit[] = [];
  const seen = new Set<string>();

  const fire = (entry: TriggeredExhibit): void => {
    // Two identical acts in one answer are one thing to consent to. The
    // duplicate would otherwise reach the manifest as a second exhibit with
    // the same id, which nothing downstream could tell apart.
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    triggered.push(entry);
  };

  for (const rule of context.pack.exhibits) {
    switch (rule.when.kind) {
      case "always":
        fire({ id: rule.id, rule });
        break;
      case "entity-claimed":
        if (mentioned.has(rule.when.entityId)) fire({ id: rule.id, rule, entityId: rule.when.entityId });
        break;
      case "action-claimed": {
        const tool = rule.when.tool;
        for (const claim of claims) {
          if (claim.kind !== "action" || claim.tool !== tool) continue;
          fire({ id: `${rule.id}:${claim.entityId}`, rule, entityId: claim.entityId, tool });
        }
        break;
      }
    }
  }

  return triggered;
}

/** Every entity the answer touches, including via the criteria of its sets. */
function entitiesMentioned(claims: readonly Claim[], rosters: readonly ClosedRoster[]): ReadonlySet<string> {
  const mentioned = new Set<string>();
  for (const claim of claims) {
    if (
      claim.kind === "fact" ||
      claim.kind === "membership" ||
      claim.kind === "recommendation" ||
      claim.kind === "action"
    ) {
      mentioned.add(claim.entityId);
    }
    // Derived after this runs when omitted; a ranking with no winner yet (a tie
    // being refused) mentions nobody by selection.
    if (claim.kind === "ranking" && claim.selectedEntityId !== undefined) mentioned.add(claim.selectedEntityId);
  }
  // "Which Pokémon learn Selfdestruct" is an answer about Selfdestruct even
  // though no claim names it: the move is in the definition of the set.
  for (const roster of rosters) {
    for (const criterion of roster.criteria.all) {
      if (criterion.kind === "learns-move") mentioned.add(criterion.move);
    }
  }
  return mentioned;
}

function checkExhibits(context: ManifestContext, manifest: AnswerManifest): Violation[] {
  const violations: Violation[] = [];
  const required = requiredExhibits(context, manifest.claims, manifest.rosters);
  const carried = new Map(manifest.exhibits.map((exhibit) => [exhibit.id, exhibit]));

  for (const owed of required) {
    const found = carried.get(owed.id);
    if (found === undefined) {
      violations.push(
        violation(
          owed.triggeredBy ?? "IA-6",
          "exhibit-not-manifested",
          `this answer requires exhibit "${owed.id}" and does not carry it`,
          { expected: owed.id, actual: [...carried.keys()].join(", ") || "no exhibits" },
        ),
      );
      continue;
    }
    // A disclosure pointed at other words is a disclosure in name only, and
    // would satisfy a presence check while showing the trainer something else.
    // One comparison covers a stripped block, an older version of it, and a
    // translation smuggled in from another locale.
    if (!sameBlock(owed.block, found.block)) {
      violations.push(
        violation(owed.triggeredBy ?? "IA-6", "exhibit-block-mismatch", `exhibit "${owed.id}" no longer names the text the pack demands`, {
          expected: describeBlock(owed.block),
          actual: found.block === undefined ? "no block" : describeBlock(found.block),
        }),
      );
    }
    // What a disclosure is *about* is as load-bearing as what it says. A
    // consent notice re-aimed at a reversible act would carry the right words
    // and sit beside the wrong thing, and the page would look immaculate.
    if (!sameAttribution(owed, found)) {
      violations.push(
        violation(owed.triggeredBy ?? "IA-6", "exhibit-misattributed", `exhibit "${owed.id}" no longer discloses what the pack attached it to`, {
          expected: describeAttribution(owed),
          actual: describeAttribution(found),
        }),
      );
    }
  }

  // A rule that fires and has nothing approved to say in this locale is a
  // disclosure obligation nobody can discharge, so the answer stops here
  // rather than being released without it.
  for (const { rule } of triggeredRules(context, manifest.claims, manifest.rosters)) {
    if (blockFor(rule, manifest.locale) !== undefined) continue;
    violations.push(
      violation(rule.article, "exhibit-block-unavailable", `exhibit "${rule.id}" has no approved text in ${manifest.locale}`, {
        expected: rule.block.content.map((entry) => entry.locale).join(", ") || "nothing",
        actual: manifest.locale || "no locale",
      }),
    );
  }

  // Closed, like the rosters: an exhibit no rule triggered is an obligation
  // nobody can trace to a rule, and phase 4 would have to render it anyway.
  const owedIds = new Set(required.map((exhibit) => exhibit.id));
  for (const exhibit of manifest.exhibits) {
    if (owedIds.has(exhibit.id)) continue;
    violations.push(
      violation("IA-6", "exhibit-unrequired", `exhibit "${exhibit.id}" is not required by pack ${context.pack.id}`, {
        actual: exhibit.id,
      }),
    );
  }

  return violations;
}

function sameBlock(owed: DisclosureBlockRef, found: DisclosureBlockRef | undefined): boolean {
  if (found === undefined) return false;
  return (
    found.id === owed.id &&
    found.version === owed.version &&
    found.locale === owed.locale &&
    found.digest === owed.digest
  );
}

function describeBlock(block: DisclosureBlockRef): string {
  return `${block.id} v${block.version} ${block.locale} ${block.digest}`;
}

function sameAttribution(owed: Exhibit, found: Exhibit): boolean {
  return (
    found.rule === owed.rule &&
    found.kind === owed.kind &&
    found.entityId === owed.entityId &&
    found.tool === owed.tool &&
    found.triggeredBy === owed.triggeredBy
  );
}

function describeAttribution(exhibit: Exhibit): string {
  const about = [
    exhibit.entityId === undefined ? undefined : `about ${exhibit.entityId}`,
    exhibit.tool === undefined ? undefined : `for ${exhibit.tool}`,
  ].filter((part) => part !== undefined);
  return `${exhibit.rule} (${exhibit.kind}${about.length > 0 ? `, ${about.join(", ")}` : ""}) under ${exhibit.triggeredBy ?? "IA-6"}`;
}
