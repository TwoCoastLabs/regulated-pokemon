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
 *    governed display units, the exact strings each must show, and the
 *    approved disclosure text each must carry. It is a pure function of the
 *    manifest, so the verifier re-derives it rather than being handed one — a
 *    plan supplied alongside an artifact would be the renderer marking its own
 *    homework.
 * 2. `walkArtifact` (see ./dom.ts) reads the finished document and reports
 *    what it shows, knowing nothing about the plan.
 * 3. {@link verifyRender} puts the two beside each other and names every
 *    disagreement. {@link attestRender} produces the affidavit by doing
 *    exactly that and refusing to sign anything that would not survive it.
 *
 * **Nothing here searches the page.** The first version of this layer hunted
 * certified words in the unit's text, and that needed three rules — every
 * fragment present, in order, not spelled out of two siblings — which still
 * could not survive a thousands separator or a translation. Regulated
 * industries bind instead of searching: Inline XBRL wraps the displayed figure
 * in a tag naming its concept and a closed transformation; an FDA boxed
 * warning is *the section carrying that code*, not a section whose text
 * contains certain words. So a certified value is a marked slot compared by
 * equality against a formatter's output, a disclosure is a marked block
 * compared by digest, and everything else on the artifact must be a string
 * from the pack's copy catalogue. Any other visible text is denied outright.
 *
 * That last rule — text closure — is what stops the renderer being able to
 * write on the artifact at all. Copy is still the renderer's: it picks which
 * catalogued lead-in goes where, and in what order the cards sit. It cannot
 * compose a new sentence, which is the difference between a component library
 * and a second, unverified author. The chat pane is deliberately not governed
 * this way; the Advisor may charm in conversation. The certified artifact is a
 * certificate, and that is the sales-call/prospectus split regulated
 * industries already live with.
 */

import type { ArticleId } from "./accord.js";
import type {
  AnswerManifest,
  Claim,
  ClosedRoster,
  DisclosureBlockRef,
  Exhibit,
  FactValue,
  RenderAffidavit,
  Resolution,
  Verdict,
  Violation,
} from "./contracts.js";
import { digestText } from "./digest.js";
import {
  type ArtifactWalk,
  type DomElement,
  normalise,
  walkArtifact,
  type WalkedText,
  type WalkedUnit,
} from "./dom.js";
import { formatForValue, type FormatId, formatValue } from "./format.js";
import { type ManifestContext, verifyManifest } from "./manifest.js";
import { approvesFormat, copyFor, type ExhibitSlotSource } from "./pack.js";
import { verdictOf, violation } from "./violation.js";

/** What a governed unit is for. Drives nothing but the console and the copy. */
export type RenderUnitKind =
  | "fact"
  | "count"
  | "membership"
  | "selection"
  | "recommendation"
  | "action"
  | "warning"
  | "provenance";

/**
 * One certified value, and the one string that displays it.
 *
 * `expected` is computed here, from the manifest, through the closed formatter
 * registry. The renderer is told the name and fills the slot; the verifier
 * recomputes the same string and compares. Neither of them searches, so there
 * is no wording, spacing or grouping that makes 190 evidence of 90.
 */
export interface RenderSlot {
  /** Unique within its unit. The mark the renderer places. */
  name: string;
  value: FactValue;
  formatId: FormatId;
  expected: string;
}

/**
 * One thing the trainer has to be able to read.
 *
 * A claim unit carries slots; a disclosure unit carries a block, and may carry
 * slots too — a provenance notice has to name the snapshot it is attributing,
 * and a snapshot id is data rather than words.
 */
export interface RenderUnit {
  id: string;
  kind: RenderUnitKind;
  slots: readonly RenderSlot[];
  /** Mandatory text this unit must show verbatim, for disclosure units. */
  block?: DisclosureBlockRef;
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
  /** The locale every slot and block in this plan was resolved for. */
  locale: string;
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

  const violations: Violation[] = [];
  const claimUnits: Array<{ unit: RenderUnit; mentions: readonly string[] }> = [];

  for (const claim of manifest.claims) {
    const built = unitForClaim(context, manifest, claim);
    if (!built.ok) {
      violations.push(...built.violations);
      continue;
    }
    // Two identical claims are one thing to show. They cannot disagree — the
    // verifier has already recomputed both against the snapshot — so the
    // second is a duplicate sentence, not a second obligation.
    if (claimUnits.some((entry) => entry.unit.id === built.value.unit.id)) continue;
    claimUnits.push(built.value);
  }

  const units: RenderUnit[] = claimUnits.map((entry) => entry.unit);

  for (const exhibit of manifest.exhibits) {
    const built = unitForExhibit(context, manifest, exhibit, claimUnits);
    if (!built.ok) {
      violations.push(...built.violations);
      continue;
    }
    units.push(built.value);
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: { transactionId: manifest.transactionId, locale: manifest.locale, units } };
}

/**
 * One certified value as a slot, or a refusal.
 *
 * Two gates, and they are different questions. The pack decides whether this
 * *Accord* permits a presentation at all; the formatter registry decides
 * whether this kernel can produce it for this value in this locale. A pack that
 * approved `list-oxford` would still not make a number presentable as a list.
 */
function slot(
  context: ManifestContext,
  locale: string,
  name: string,
  value: FactValue,
  formatId: FormatId = formatForValue(value),
): Resolution<RenderSlot> {
  if (!approvesFormat(context.pack, formatId)) {
    return {
      ok: false,
      violations: [
        violation("IA-6", "slot-format-unapproved", `pack ${context.pack.id} does not approve the "${formatId}" presentation`, {
          expected: context.pack.presentation.formats.join(", "),
          actual: formatId,
        }),
      ],
    };
  }
  const formatted = formatValue(formatId, locale, value);
  if (!formatted.ok) return formatted;
  return { ok: true, value: { name, value, formatId, expected: formatted.value } };
}

const entity = (id: string): FactValue => ({ kind: "text", value: id });

/** Collect slot resolutions, keeping every refusal rather than the first. */
function slots(...resolved: ReadonlyArray<Resolution<RenderSlot>>): Resolution<readonly RenderSlot[]> {
  const violations = resolved.flatMap((entry) => (entry.ok ? [] : entry.violations));
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: resolved.map((entry) => (entry as { value: RenderSlot }).value) };
}

/**
 * One claim as a display unit, plus the entities it puts on screen.
 *
 * Every value that carries meaning is a slot, including the ones that look like
 * prose. "Zapdos" beside the name of a set is equally consistent with the
 * answer and with its negation, so the words that decide which are bound
 * through the `member-of` formatter rather than left to the renderer.
 */
function unitForClaim(
  context: ManifestContext,
  manifest: AnswerManifest,
  claim: Claim,
): Resolution<{ unit: RenderUnit; mentions: readonly string[] }> {
  const locale = manifest.locale;
  const built = ((): Resolution<{ id: string; kind: RenderUnitKind; slots: readonly RenderSlot[]; mentions: readonly string[] }> => {
    switch (claim.kind) {
      case "fact": {
        const resolved = slots(
          slot(context, locale, "entity", entity(claim.entityId), "entity-name"),
          slot(context, locale, "fact", entity(claim.factId), "plain-text"),
          slot(context, locale, "value", claim.asserted),
        );
        if (!resolved.ok) return resolved;
        return {
          ok: true,
          value: {
            id: `fact:${claim.entityId}:${claim.factId}`,
            kind: "fact",
            slots: resolved.value,
            mentions: [claim.entityId],
          },
        };
      }
      case "count": {
        // The rendered count is the certified set's cardinality — the count is
        // the set (IA-4). `compileManifest` has already reconciled any stated
        // number with it and filled an omitted one, so there is one true value
        // to show, whether the model stated it or left it to be derived.
        const roster = manifest.rosters.find((entry) => entry.id === claim.rosterId);
        const shown = roster?.cardinality ?? claim.reported ?? 0;
        const resolved = slots(
          slot(context, locale, "set", entity(claim.rosterId), "plain-text"),
          slot(context, locale, "count", { kind: "number", value: shown }),
        );
        if (!resolved.ok) return resolved;
        return {
          ok: true,
          value: {
            id: `count:${claim.rosterId}`,
            kind: "count",
            slots: resolved.value,
            mentions: definedBy(claim.rosterId, manifest.rosters),
          },
        };
      }
      case "membership": {
        const resolved = slots(
          slot(context, locale, "entity", entity(claim.entityId), "entity-name"),
          slot(context, locale, "membership", { kind: "boolean", value: claim.asserted }, "member-of"),
          slot(context, locale, "set", entity(claim.rosterId), "plain-text"),
        );
        if (!resolved.ok) return resolved;
        return {
          ok: true,
          value: {
            id: `membership:${claim.rosterId}:${claim.entityId}`,
            kind: "membership",
            slots: resolved.value,
            mentions: [claim.entityId, ...definedBy(claim.rosterId, manifest.rosters)],
          },
        };
      }
      case "ranking": {
        // A rendered manifest is a verified one, and verification derives or
        // confirms the winner, so it is present here — a ranking whose winner
        // could not be resolved was refused and never reached render.
        const selected = claim.selectedEntityId ?? "";
        const resolved = slots(
          slot(context, locale, "entity", entity(selected), "entity-name"),
          slot(context, locale, "set", entity(claim.rosterId), "plain-text"),
          slot(context, locale, "basis", entity(claim.basis), "plain-text"),
        );
        if (!resolved.ok) return resolved;
        return {
          ok: true,
          value: {
            id: `selection:${claim.rosterId}:${claim.basis}:${claim.direction}`,
            kind: "selection",
            slots: resolved.value,
            mentions: [selected, ...definedBy(claim.rosterId, manifest.rosters)],
          },
        };
      }
      case "recommendation": {
        const resolved = slots(slot(context, locale, "entity", entity(claim.entityId), "entity-name"));
        if (!resolved.ok) return resolved;
        return {
          ok: true,
          value: {
            id: `recommendation:${claim.entityId}`,
            kind: "recommendation",
            slots: resolved.value,
            mentions: [claim.entityId],
          },
        };
      }
      case "action": {
        // Both halves are bound. "Pikachu" beside a friendly sentence is
        // equally consistent with adding it to the team and with releasing it
        // forever, and Article VII binds the trainer to the act as well as to
        // the subject — so which act it is comes out of the closed action
        // registry through a slot, not out of the renderer's prose.
        const resolved = slots(
          slot(context, locale, "action", entity(claim.tool), "plain-text"),
          slot(context, locale, "entity", entity(claim.entityId), "entity-name"),
        );
        if (!resolved.ok) return resolved;
        return {
          ok: true,
          value: {
            id: actionUnitId(claim.tool, claim.entityId),
            kind: "action",
            slots: resolved.value,
            mentions: [claim.entityId],
          },
        };
      }
    }
  })();

  if (!built.ok) return built;
  const { id, kind, slots: unitSlots, mentions } = built.value;
  return { ok: true, value: { unit: { id, kind, slots: unitSlots, article: "IA-6" }, mentions } };
}

/**
 * One disclosure as a display unit: its approved text, its values, and the
 * unit it has to sit beside.
 */
function unitForExhibit(
  context: ManifestContext,
  manifest: AnswerManifest,
  exhibit: Exhibit,
  claimUnits: ReadonlyArray<{ unit: RenderUnit; mentions: readonly string[] }>,
): Resolution<RenderUnit> {
  const article = exhibit.triggeredBy ?? "IA-6";
  const rule = context.pack.exhibits.find((entry) => entry.id === exhibit.rule);
  const resolved = slots(
    ...(rule?.slots ?? []).map((declared) => {
      const value = exhibitSlotValue(context, manifest, exhibit, declared.source);
      if (!value.ok) return value;
      return slot(context, manifest.locale, declared.name, value.value, declared.format);
    }),
  );
  if (!resolved.ok) return resolved;

  const unit: RenderUnit = {
    id: exhibit.id,
    kind: exhibit.kind,
    slots: resolved.value,
    block: exhibit.block,
    article,
  };

  if (exhibit.entityId === undefined) return { ok: true, value: unit };

  // A consent notice belongs beside the act it is consent for, not beside
  // whatever else on the page happens to name the same species. Anything else
  // and a page recommending Pikachu would satisfy the disclosure owed by a
  // proposal to release it.
  const anchor =
    exhibit.tool === undefined
      ? claimUnits.find((entry) => entry.mentions.includes(exhibit.entityId as string))
      : claimUnits.find((entry) => entry.unit.id === actionUnitId(exhibit.tool as string, exhibit.entityId as string));
  if (anchor === undefined) {
    // Fail closed rather than quietly dropping the adjacency requirement: a
    // warning with nothing on screen to be beside is a warning about nothing,
    // and the answer that owes it is the thing to fix.
    return {
      ok: false,
      violations: [
        violation(article, "disclosure-without-anchor", `exhibit "${exhibit.id}" discloses "${exhibit.entityId}", which this answer shows nowhere`, {
          expected: `a claim about ${exhibit.entityId}`,
          actual: claimUnits.map((entry) => entry.unit.id).join(", ") || "no claims",
        }),
      ],
    };
  }
  return { ok: true, value: { ...unit, discloses: anchor.unit.id } };
}

/**
 * The value behind one of an exhibit's declared slots.
 *
 * Three sources, closed and named in the pack, because some disclosures cannot
 * be written as fixed words: an attribution has to name the snapshot it is
 * attributing, and Article IX requires a consent notice to state what is being
 * given up *drawn from the Certified Registry*. The last one is the article's
 * own sentence made mechanical — the moves the species knows are read out of
 * the snapshot here, exactly as a fact claim would read them, rather than
 * summarised by whatever proposed the act.
 */
function exhibitSlotValue(
  context: ManifestContext,
  manifest: AnswerManifest,
  exhibit: Exhibit,
  source: ExhibitSlotSource,
): Resolution<FactValue> {
  if (source === "snapshot-id") return { ok: true, value: { kind: "text", value: manifest.snapshotId } };

  const entityId = exhibit.entityId;
  if (entityId === undefined) {
    // Unreachable through the pack loader, which refuses a rule reading the
    // acted-on species unless an action triggers it. Kept because the manifest
    // is not required to have come from that loader's world.
    return {
      ok: false,
      violations: [
        violation("IA-6", "slot-source-unavailable", `exhibit "${exhibit.id}" reads the acted-on species and discloses none`, {
          expected: `an entity for ${source}`,
          actual: exhibit.id,
        }),
      ],
    };
  }
  if (source === "action-entity") return { ok: true, value: { kind: "text", value: entityId } };
  return context.registry.resolve(entityId, "learnset");
}

/** The unit an act is shown in. One spelling, used by the plan and by IA-7. */
export function actionUnitId(tool: string, entityId: string): string {
  return `action:${tool}:${entityId}`;
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

  // Identity first and alone. An artifact rendered for another answer, or
  // localised against another plan, may be internally perfect, and reporting
  // which of its slots disagree would describe a document nobody is being
  // asked about.
  const identity = checkIdentity(plan, walk);
  if (identity.length > 0) return verdictOf(identity);

  return verdictOf([
    ...checkUnits(plan, walk),
    ...checkClosure(context, plan, walk),
    ...checkAffidavit(walk, affidavit),
  ]);
}

function checkIdentity(plan: RenderPlan, walk: ArtifactWalk): Violation[] {
  if (walk.transactionId !== plan.transactionId) {
    return [
      violation("IA-6", "artifact-transaction-mismatch", "the rendered artifact is not the answer being verified", {
        expected: plan.transactionId,
        actual: walk.transactionId ?? "no transaction mark",
      }),
    ];
  }
  // The hazard this retires: a page localised perfectly, into a locale this
  // answer was never certified for. Every slot on it would be formatted by the
  // wrong registry entry and every disclosure would be the wrong translation,
  // and both would look immaculate to anyone reading the page alone.
  if (walk.locale !== plan.locale) {
    return [
      violation("IA-6", "artifact-locale-mismatch", "the rendered artifact was localised against a different plan", {
        expected: plan.locale,
        actual: walk.locale ?? "no locale mark",
      }),
    ];
  }
  return [];
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
    violations.push(...checkSlots(unit, walk));
    violations.push(...checkBlock(unit, walk));
    violations.push(...checkAdjacency(unit, rendered, shown));
  }

  return violations;
}

/** Everything the artifact attributed to one origin, inside one unit. */
function marksIn(walk: ArtifactWalk, kind: WalkedText["kind"], unitId: string | undefined): readonly WalkedText[] {
  return walk.attributed.filter((entry) => entry.kind === kind && entry.unitId === unitId);
}

/**
 * Every planned slot filled with exactly the string the formatter produced.
 *
 * One rule, and it replaces three. There is no search, so a value cannot be
 * proved by a longer one that contains it or assembled out of two siblings;
 * there is no ordering rule, because a slot is a place rather than a position;
 * and there is no locale tolerance, because the locale was already fixed by
 * the plan and any other rendering is simply a different string.
 */
function checkSlots(unit: RenderUnit, walk: ArtifactWalk): Violation[] {
  const violations: Violation[] = [];
  const rendered = marksIn(walk, "slot", unit.id);

  for (const planned of unit.slots) {
    const [only, ...extra] = rendered.filter((entry) => entry.name === planned.name);
    if (only === undefined) {
      violations.push(
        violation(unit.article, "slot-not-rendered", `"${unit.id}" shows no "${planned.name}" slot`, {
          expected: `${planned.name} = "${planned.expected}"`,
          actual: rendered.map((entry) => entry.name).join(", ") || "no slots",
        }),
      );
      continue;
    }
    if (extra.length > 0) {
      // Two elements claiming to be the same slot make the artifact ambiguous
      // in exactly the way two elements claiming to be the same unit do.
      violations.push(
        violation(unit.article, "slot-marked-twice", `"${unit.id}" marks "${planned.name}" on more than one element`, {
          actual: [only, ...extra].map((entry) => entry.text).join(" | "),
        }),
      );
      continue;
    }
    if (!only.visible) {
      violations.push(
        violation(unit.article, "slot-not-visible", `the "${planned.name}" of "${unit.id}" is in the document and not on the screen`, {
          expected: planned.expected,
          actual: "hidden",
        }),
      );
      continue;
    }
    if (normalise(only.text) !== planned.expected) {
      violations.push(
        violation(unit.article, "slot-value-mismatch", `the "${planned.name}" of "${unit.id}" is not the certified value`, {
          expected: `${planned.expected} (${planned.formatId}, ${walk.locale ?? "no locale"})`,
          actual: normalise(only.text) || "nothing",
        }),
      );
    }
  }

  const planned = new Set(unit.slots.map((entry) => entry.name));
  for (const entry of rendered) {
    if (planned.has(entry.name)) continue;
    violations.push(
      violation(unit.article, "slot-unplanned", `"${unit.id}" fills a "${entry.name}" slot this answer does not certify`, {
        expected: [...planned].join(", ") || "no slots",
        actual: entry.name,
      }),
    );
  }

  return violations;
}

/**
 * The mandatory text, present and unaltered.
 *
 * Digest equality over the block's visible text, so truncation, reordering and
 * paraphrase are one failure rather than three. A translation does not soften
 * this: it is a separately approved block with its own digest, and the plan
 * already fixed which one this artifact owes.
 */
function checkBlock(unit: RenderUnit, walk: ArtifactWalk): Violation[] {
  const violations: Violation[] = [];
  const rendered = marksIn(walk, "block", unit.id);
  const owed = unit.block;

  if (owed !== undefined) {
    const [carried, ...extra] = rendered.filter((entry) => entry.name === owed.id);
    if (carried === undefined) {
      violations.push(
        violation(unit.article, "disclosure-block-missing", `"${unit.id}" carries no "${owed.id}" text`, {
          expected: owed.id,
          actual: rendered.map((entry) => entry.name).join(", ") || "no blocks",
        }),
      );
    } else if (extra.length > 0) {
      violations.push(
        violation(unit.article, "disclosure-block-marked-twice", `"${unit.id}" marks "${owed.id}" on more than one element`, {
          actual: owed.id,
        }),
      );
    } else if (!carried.visible) {
      violations.push(
        violation(unit.article, "disclosure-block-not-visible", `the "${owed.id}" text is in the document and not on the screen`, {
          expected: "visible in the final artifact",
          actual: "hidden",
        }),
      );
    } else {
      const shown = digestText(carried.text);
      if (shown !== owed.digest) {
        violations.push(
          violation(unit.article, "disclosure-block-altered", `the "${owed.id}" text on the screen is not the approved text`, {
            expected: `${owed.id} v${owed.version} ${owed.locale} ${owed.digest}`,
            actual: `${shown} — "${normalise(carried.text) || "nothing"}"`,
          }),
        );
      }
    }
  }

  for (const entry of rendered) {
    if (owed !== undefined && entry.name === owed.id) continue;
    violations.push(
      violation(unit.article, "disclosure-block-unplanned", `"${unit.id}" shows a "${entry.name}" disclosure this answer does not owe`, {
        expected: owed?.id ?? "no disclosure block",
        actual: entry.name,
      }),
    );
  }

  return violations;
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
 * The artifact carries the plan and nothing beyond it — no extra units, no
 * stray certified values, and no prose at all.
 *
 * Closed, like the rosters and the manifest's exhibits, and closed over *text*
 * as well as over units. A governed unit nobody can trace to the certified
 * answer is a claim that entered at the last possible moment, when every check
 * upstream has already run; a sentence nobody can trace to the pack is the same
 * thing wearing no mark whatsoever.
 */
function checkClosure(context: ManifestContext, plan: RenderPlan, walk: ArtifactWalk): Violation[] {
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

  // A certified value or a disclosure outside every governed unit belongs to
  // nothing, so no unit's rules apply to it and no unit's denial names it.
  for (const stray of marksIn(walk, "slot", undefined)) {
    violations.push(
      violation("IA-6", "slot-unplanned", `the artifact fills a "${stray.name}" slot outside every governed unit`, {
        actual: `${stray.name} = "${normalise(stray.text)}"`,
      }),
    );
  }
  for (const stray of marksIn(walk, "block", undefined)) {
    violations.push(
      violation("IA-6", "disclosure-block-unplanned", `the artifact shows a "${stray.name}" disclosure outside every governed unit`, {
        actual: stray.name,
      }),
    );
  }

  violations.push(...checkCatalogue(context, plan, walk));

  for (const stray of walk.unattributed) {
    violations.push(
      violation("IA-6", "unattributed-content", "the artifact shows text that comes from nothing the Accord approved", {
        expected: "a certified slot, an approved disclosure, or a catalogued string",
        actual: `"${stray.text}"${stray.unitId === undefined ? "" : ` in ${stray.unitId}`}`,
      }),
    );
  }

  return violations;
}

/**
 * Renderer copy, as approved.
 *
 * Copy asserts nothing, which is exactly why it needs a check: an unpinned
 * lead-in is a place to say "roughly" or "we think" beside a certified value,
 * and nothing else on this page would notice.
 */
function checkCatalogue(context: ManifestContext, plan: RenderPlan, walk: ArtifactWalk): Violation[] {
  const violations: Violation[] = [];

  for (const entry of walk.attributed) {
    if (entry.kind !== "copy" || !entry.visible) continue;
    const approved = copyFor(context.pack, entry.name, plan.locale);
    if (approved === undefined) {
      violations.push(
        violation("IA-6", "catalogue-entry-unknown", `the artifact shows copy "${entry.name}", which pack ${context.pack.id} does not carry in ${plan.locale}`, {
          expected: context.pack.presentation.catalogue.map((item) => item.id).join(", "),
          actual: entry.name,
        }),
      );
      continue;
    }
    if (normalise(entry.text) !== normalise(approved)) {
      violations.push(
        violation("IA-6", "catalogue-drift", `the copy shown as "${entry.name}" is not what the catalogue approved`, {
          expected: approved,
          actual: normalise(entry.text) || "nothing",
        }),
      );
    }
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
