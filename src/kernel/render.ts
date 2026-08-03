/**
 * The render affidavit (IA-6): proving that what was certified is what the
 * trainer could actually read.
 *
 * The manifest layer proves an answer is true and that every disclosure it
 * owes is attached to it. Neither of those facts survives contact with a
 * stylesheet. Article VI is the one article in the Accord that cannot be
 * enforced anywhere upstream of the screen, because everything upstream is
 * about what the answer *says* and this is about what the trainer *sees*.
 *
 * Three pieces, deliberately separate.
 *
 * 1. {@link planRender} turns a verified manifest into the closed list of
 *    governed display units and, for each, the text that must be legible
 *    inside it. It is a pure function of the manifest, so the verifier
 *    re-derives it rather than being handed one — a plan supplied alongside
 *    an artifact would be the renderer marking its own homework.
 * 2. `walkArtifact` (see ./dom.ts) reads the finished document and reports
 *    what it shows, knowing nothing about the plan.
 * 3. {@link verifyRender} puts the two beside each other and names every
 *    disagreement. {@link attestRender} produces the affidavit by doing
 *    exactly that and refusing to sign anything that would not survive it.
 *
 * What this layer can and cannot prove is worth stating plainly. It proves
 * that every bound value and every mandatory fragment was visible, in order,
 * inside the unit that owns it, adjacent to what triggered it. It does not
 * read the prose around them: copy is the renderer's, and a renderer is free
 * to be charming in the gaps. That is why every value that matters is a bound
 * fragment inside a marked unit rather than a sentence — the boundary is drawn
 * where a deterministic check can actually hold it.
 */

import type { ArticleId } from "./accord.js";
import type {
  AnswerManifest,
  Claim,
  ClosedRoster,
  RenderAffidavit,
  Resolution,
  Verdict,
  Violation,
} from "./contracts.js";
import { type ArtifactWalk, type DomElement, walkArtifact, type WalkedUnit } from "./dom.js";
import { type ManifestContext, verifyManifest } from "./manifest.js";
import { formatFactValue } from "./registry.js";
import { verdictOf, violation } from "./violation.js";

/** What a governed unit is for. Drives nothing but the console and the copy. */
export type RenderUnitKind =
  | "fact"
  | "count"
  | "membership"
  | "selection"
  | "recommendation"
  | "warning"
  | "provenance";

/**
 * One thing the trainer has to be able to read.
 *
 * `requiredFragments` are bound: they come from the certified answer or from
 * the Accord pack, and a renderer may surround them but not edit them. The
 * order is part of the requirement — a disclosure whose words are all present
 * in a shuffled order is a different sentence.
 */
export interface RenderUnit {
  id: string;
  kind: RenderUnitKind;
  requiredFragments: readonly string[];
  /** The article a denial about this unit cites. */
  article: ArticleId;
  /**
   * For a triggered disclosure: the unit it must appear beside. Article VI
   * requires adjacency to what triggered it, so the anchor is derived here
   * rather than left to the layout.
   */
  discloses?: string;
}

export interface RenderPlan {
  transactionId: string;
  units: readonly RenderUnit[];
}

/**
 * Derive the display plan for a manifest, or refuse.
 *
 * The manifest is verified first and the plan is abandoned if it does not
 * hold up: planning how to show an answer that cannot be proved is a way of
 * shipping it. Same discipline as `compileManifest`, one layer down.
 */
export function planRender(context: ManifestContext, manifest: AnswerManifest): Resolution<RenderPlan> {
  const verdict = verifyManifest(context, manifest);
  if (!verdict.allowed) return { ok: false, violations: verdict.violations };

  const claimUnits: Array<{ unit: RenderUnit; mentions: readonly string[] }> = [];
  for (const claim of manifest.claims) {
    const built = unitForClaim(claim, manifest.rosters);
    // Two identical claims are one thing to show. They cannot disagree — the
    // verifier has already recomputed both against the snapshot — so the
    // second is a duplicate sentence, not a second obligation.
    if (claimUnits.some((entry) => entry.unit.id === built.unit.id)) continue;
    claimUnits.push(built);
  }

  const units: RenderUnit[] = claimUnits.map((entry) => entry.unit);
  const violations: Violation[] = [];

  for (const exhibit of manifest.exhibits) {
    const article = exhibit.triggeredBy ?? "IA-6";
    if (exhibit.entityId === undefined) {
      units.push({ id: exhibit.id, kind: exhibit.kind, requiredFragments: exhibit.requiredFragments, article });
      continue;
    }
    const anchor = claimUnits.find((entry) => entry.mentions.includes(exhibit.entityId as string));
    if (anchor === undefined) {
      // Fail closed rather than quietly dropping the adjacency requirement:
      // a warning with nothing on screen to be beside is a warning about
      // nothing, and the answer that owes it is the thing to fix.
      violations.push(
        violation(article, "disclosure-without-anchor", `exhibit "${exhibit.id}" discloses "${exhibit.entityId}", which this answer shows nowhere`, {
          expected: `a claim about ${exhibit.entityId}`,
          actual: claimUnits.map((entry) => entry.unit.id).join(", ") || "no claims",
        }),
      );
      continue;
    }
    units.push({
      id: exhibit.id,
      kind: exhibit.kind,
      requiredFragments: exhibit.requiredFragments,
      article,
      discloses: anchor.unit.id,
    });
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: { transactionId: manifest.transactionId, units } };
}

/**
 * One claim as a display unit, plus the entities it puts on screen.
 *
 * The bound fragments are what a trainer must be able to read: the entity by
 * name and the value asserted about it. `membership` carries a short bound
 * phrase for its polarity, because "Zapdos" alone on the screen is equally
 * consistent with the answer and with its negation.
 */
function unitForClaim(claim: Claim, rosters: readonly ClosedRoster[]): { unit: RenderUnit; mentions: readonly string[] } {
  switch (claim.kind) {
    case "fact":
      return {
        unit: {
          id: `fact:${claim.entityId}:${claim.factId}`,
          kind: "fact",
          requiredFragments: [claim.entityId, formatFactValue(claim.asserted)],
          article: "IA-6",
        },
        mentions: [claim.entityId],
      };
    case "count":
      return {
        unit: {
          id: `count:${claim.rosterId}`,
          kind: "count",
          requiredFragments: [String(claim.reported)],
          article: "IA-6",
        },
        mentions: definedBy(claim.rosterId, rosters),
      };
    case "membership":
      return {
        unit: {
          id: `membership:${claim.rosterId}:${claim.entityId}`,
          kind: "membership",
          requiredFragments: [claim.entityId, claim.asserted ? "is a member" : "is not a member"],
          article: "IA-6",
        },
        mentions: [claim.entityId, ...definedBy(claim.rosterId, rosters)],
      };
    case "ranking":
      return {
        unit: {
          id: `selection:${claim.rosterId}:${claim.basis}:${claim.direction}`,
          kind: "selection",
          requiredFragments: [claim.selectedEntityId],
          article: "IA-6",
        },
        mentions: [claim.selectedEntityId, ...definedBy(claim.rosterId, rosters)],
      };
    case "recommendation":
      return {
        unit: {
          id: `recommendation:${claim.entityId}`,
          kind: "recommendation",
          requiredFragments: [claim.entityId],
          article: "IA-6",
        },
        mentions: [claim.entityId],
      };
  }
}

/**
 * Entities a set's own definition puts on screen. "Twelve of them learn
 * Selfdestruct" is a sentence about Selfdestruct, so the count that carries it
 * is what the handling warning has to sit beside.
 */
function definedBy(rosterId: string, rosters: readonly ClosedRoster[]): readonly string[] {
  const roster = rosters.find((entry) => entry.id === rosterId);
  if (roster === undefined) return [];
  return roster.criteria.all.flatMap((criterion) => (criterion.kind === "learns-move" ? [criterion.move] : []));
}

// --- attestation ------------------------------------------------------------

/**
 * Walk the finished artifact and sign for what it shows — or refuse to.
 *
 * Every field of the affidavit is read out of the document. Nothing is copied
 * from the manifest or from the renderer, so an affidavit is a claim about the
 * artifact that {@link verifyRender} can independently disagree with.
 */
export function attestRender(
  context: ManifestContext,
  manifest: AnswerManifest,
  artifact: DomElement,
  renderedAt: string,
): Resolution<RenderAffidavit> {
  const walk = walkArtifact(artifact);
  const affidavit: RenderAffidavit = {
    transactionId: walk.transactionId ?? "",
    artifactDigest: walk.digest,
    renderedAt,
    units: walk.units.map((unit) => ({ id: unit.id, visible: unit.visible })),
  };

  const verdict = verifyRender(context, manifest, artifact, affidavit);
  if (!verdict.allowed) return { ok: false, violations: verdict.violations };
  return { ok: true, value: affidavit };
}

/**
 * Judge a rendered artifact against the answer it claims to be showing.
 *
 * Knows nothing about how the artifact was produced: a document from the
 * reference renderer, from a component library, from a mutated fixture or one
 * day from a browser is read identically.
 */
export function verifyRender(
  context: ManifestContext,
  manifest: AnswerManifest,
  artifact: DomElement,
  affidavit: RenderAffidavit,
): Verdict {
  const planned = planRender(context, manifest);
  if (!planned.ok) return verdictOf(planned.violations);
  const plan = planned.value;
  const walk = walkArtifact(artifact);

  // Identity first and alone. An artifact rendered for another answer may be
  // internally perfect, and reporting which of its fragments are missing would
  // describe a document nobody is being asked about.
  if (walk.transactionId !== plan.transactionId) {
    return verdictOf([
      violation("IA-6", "artifact-transaction-mismatch", "the rendered artifact is not the answer being verified", {
        expected: plan.transactionId,
        actual: walk.transactionId ?? "no transaction mark",
      }),
    ]);
  }

  return verdictOf([
    ...checkUnits(plan, walk),
    ...checkClosure(plan, walk),
    ...checkAffidavit(walk, affidavit),
  ]);
}

function checkUnits(plan: RenderPlan, walk: ArtifactWalk): Violation[] {
  const violations: Violation[] = [];
  const shown = new Map(walk.units.map((unit) => [unit.id, unit]));

  for (const unit of plan.units) {
    const rendered = shown.get(unit.id);
    if (rendered === undefined) {
      violations.push(
        violation(unit.article, "exhibit-not-rendered", `the artifact shows no "${unit.id}" at all`, {
          expected: unit.id,
          actual: [...shown.keys()].join(", ") || "nothing marked",
        }),
      );
      continue;
    }
    if (!rendered.visible) {
      violations.push(
        violation(unit.article, `exhibit-hidden-${rendered.hiddenBy}`, `"${unit.id}" is in the document and not on the screen`, {
          expected: "visible in the final artifact",
          actual: `hidden by ${rendered.hiddenBy}`,
        }),
      );
      continue;
    }
    violations.push(...checkFragments(unit, rendered));
    violations.push(...checkAdjacency(unit, rendered, shown));
  }

  return violations;
}

/**
 * Every required fragment legible inside this unit, in the order declared.
 *
 * Matching is over word tokens rather than raw substrings, and the difference
 * matters twice. A base speed of 90 is not shown by a card reading 190, which
 * a substring check would accept; and a fragment split across inline markup is
 * still shown, which a raw comparison would reject.
 */
function checkFragments(unit: RenderUnit, rendered: WalkedUnit): Violation[] {
  const shown = tokenize(rendered.text);
  let cursor = 0;

  for (const fragment of unit.requiredFragments) {
    const wanted = tokenize(fragment);
    const at = indexOfSequence(shown, wanted, cursor);
    if (at >= 0) {
      cursor = at + wanted.length;
      continue;
    }
    const anywhere = indexOfSequence(shown, wanted, 0);
    if (anywhere >= 0) {
      return [
        violation(unit.article, "exhibit-fragments-out-of-order", `"${unit.id}" shows the words the Accord requires in an order that says something else`, {
          expected: unit.requiredFragments.join(" | "),
          actual: rendered.text || "nothing",
        }),
      ];
    }
    return [
      violation(unit.article, "exhibit-fragment-not-visible", `"${unit.id}" does not show "${fragment}"`, {
        expected: fragment,
        actual: rendered.text || "nothing",
      }),
    ];
  }
  return [];
}

/**
 * A triggered disclosure sits with what triggered it: inside that unit, or
 * beside it under the same parent. Anything else is a warning on a page that
 * happens to also contain the recommendation, which is the arrangement the
 * article was written about.
 */
function checkAdjacency(
  unit: RenderUnit,
  rendered: WalkedUnit,
  shown: ReadonlyMap<string, WalkedUnit>,
): Violation[] {
  if (unit.discloses === undefined) return [];
  const anchor = shown.get(unit.discloses);
  // The anchor's own absence is already denied against the anchor; saying it
  // twice would report one fault as two.
  if (anchor === undefined) return [];

  if (nests(anchor.path, rendered.path) || nests(rendered.path, anchor.path) || siblings(anchor.path, rendered.path)) {
    return [];
  }
  return [
    violation(unit.article, "exhibit-not-adjacent", `"${unit.id}" is on the screen, and not beside the "${unit.discloses}" it discloses`, {
      expected: `inside or beside ${unit.discloses} (at ${anchor.path.join(".")})`,
      actual: `at ${rendered.path.join(".")}`,
    }),
  ];
}

function nests(outer: readonly number[], inner: readonly number[]): boolean {
  return outer.length < inner.length && outer.every((step, index) => step === inner[index]);
}

function siblings(left: readonly number[], right: readonly number[]): boolean {
  const parent = left.slice(0, -1);
  const other = right.slice(0, -1);
  return parent.length === other.length && parent.every((step, index) => step === other[index]);
}

/**
 * The artifact carries the plan and nothing beyond it.
 *
 * Closed, like the rosters and the manifest's exhibits. A governed unit nobody
 * can trace to the certified answer is a claim that entered at the last
 * possible moment, when every check upstream has already run.
 */
function checkClosure(plan: RenderPlan, walk: ArtifactWalk): Violation[] {
  const violations: Violation[] = [];
  const planned = new Set(plan.units.map((unit) => unit.id));

  for (const id of walk.duplicated) {
    // Two elements marked as the same unit make the affidavit ambiguous: one
    // may be visible and one hidden, and there is no honest answer to "was it
    // shown?" — so there is no answer given.
    violations.push(
      violation("IA-6", "exhibit-marked-twice", `the artifact marks "${id}" on more than one element`, { actual: id }),
    );
  }

  for (const unit of walk.units) {
    if (planned.has(unit.id)) continue;
    violations.push(
      violation("IA-6", "unmanifested-exhibit", `the artifact shows a governed unit "${unit.id}" that this answer does not certify`, {
        expected: [...planned].join(", "),
        actual: unit.id,
      }),
    );
  }

  return violations;
}

/** The affidavit says about this artifact exactly what the artifact says. */
function checkAffidavit(walk: ArtifactWalk, affidavit: RenderAffidavit): Violation[] {
  const violations: Violation[] = [];

  if (affidavit.transactionId !== walk.transactionId) {
    violations.push(
      violation("IA-6", "affidavit-transaction-mismatch", "the affidavit is sworn over another artifact", {
        expected: walk.transactionId ?? "no transaction mark",
        actual: affidavit.transactionId,
      }),
    );
  }
  if (affidavit.artifactDigest !== walk.digest) {
    violations.push(
      violation("IA-6", "affidavit-digest-mismatch", "the affidavit's digest is not the digest of what is on the screen", {
        expected: walk.digest,
        actual: affidavit.artifactDigest,
      }),
    );
  }
  if (Number.isNaN(Date.parse(affidavit.renderedAt))) {
    violations.push(
      violation("IA-6", "affidavit-time-unreadable", "the affidavit does not say when the artifact was shown", {
        expected: "an RFC 3339 timestamp",
        actual: affidavit.renderedAt || "nothing",
      }),
    );
  }

  const shown = new Map(walk.units.map((unit) => [unit.id, unit.visible]));
  const sworn = new Map(affidavit.units.map((unit) => [unit.id, unit.visible]));
  for (const id of new Set([...shown.keys(), ...sworn.keys()])) {
    if (shown.get(id) === sworn.get(id)) continue;
    violations.push(
      violation("IA-6", "affidavit-visibility-mismatch", `the affidavit and the artifact disagree about "${id}"`, {
        expected: describeVisibility(shown.get(id)),
        actual: describeVisibility(sworn.get(id)),
      }),
    );
  }

  return violations;
}

function describeVisibility(visible: boolean | undefined): string {
  if (visible === undefined) return "not in the artifact";
  return visible ? "visible" : "hidden";
}

// --- token matching ---------------------------------------------------------

/** Words, lowercased. Punctuation and case are the renderer's; words are not. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function indexOfSequence(haystack: readonly string[], needle: readonly string[], from: number): number {
  if (needle.length === 0) return from;
  for (let at = from; at + needle.length <= haystack.length; at += 1) {
    if (needle.every((token, offset) => haystack[at + offset] === token)) return at;
  }
  return -1;
}
