/**
 * The chain from a confirmed page to an executed act, on its own.
 *
 * The crucible breaks one link at a time in a full, honestly rendered run and
 * asserts the named denial. These tests are about the joints a mutation cannot
 * reach: the front door refusing to mint a grant at all, a record whose page
 * never mentioned the act, and the handful of degenerate records — no
 * timestamps, a scope window nobody can read — that a plausible implementation
 * would quietly let through rather than refuse.
 */

import { describe, expect, it } from "vitest";

import { type ActionRecord, authorizeAction, verifyAction } from "./action.js";
import type { AnswerManifest, Claim, ConfirmationEvent, RenderAffidavit } from "./contracts.js";
import type { DomElement } from "./dom.js";
import { compileManifest, type ManifestContext } from "./manifest.js";
import { attestRender, planRender } from "./render.js";
import { buildRoster } from "./roster.js";
import { denialCode } from "./violation.js";
import { renderAnswer } from "../render/reference.js";
import { manifestContext } from "../testing/fixtures.js";

const world: ManifestContext = manifestContext();

const RENDERED_AT = "2026-01-01T12:00:00Z";
const CONFIRMED_AT = "2026-01-01T12:00:30Z";
const AUTHORIZED_AT = "2026-01-01T12:00:31Z";
const EXECUTED_AT = "2026-01-01T12:00:32Z";

const RELEASE: Claim = { kind: "action", tool: "release", entityId: "pikachu" };
const ACTION_UNIT = "action:release:pikachu";

function answer(claims: readonly Claim[]): AnswerManifest {
  const electric = buildRoster(world.registry, "electric-kanto", { all: [{ kind: "has-type", type: "electric" }] });
  if (!electric.ok) throw new Error("the fixture roster does not build");
  const compiled = compileManifest(world, { transactionId: "txn-act", claims, rosters: [electric.value] });
  if (!compiled.ok) throw new Error(compiled.violations.map(denialCode).join(", "));
  return compiled.value;
}

function page(manifest: AnswerManifest): { artifact: DomElement; affidavit: RenderAffidavit } {
  const planned = planRender(world, manifest);
  if (!planned.ok) throw new Error(planned.violations.map(denialCode).join(", "));
  const artifact = renderAnswer(world.pack, planned.value);
  const attested = attestRender(world, manifest, artifact, RENDERED_AT);
  if (!attested.ok) throw new Error(attested.violations.map(denialCode).join(", "));
  return { artifact, affidavit: attested.value };
}

function confirmation(affidavit: RenderAffidavit): ConfirmationEvent {
  return {
    id: "confirmation-1",
    transactionId: affidavit.transactionId,
    source: "trainer",
    artifactDigest: affidavit.artifactDigest,
    confirmedAt: CONFIRMED_AT,
  };
}

/** One honest chain, end to end, through the kernel's own entry points. */
function chain(claims: readonly Claim[] = [RELEASE]): ActionRecord {
  const manifest = answer(claims);
  const { artifact, affidavit } = page(manifest);
  const confirmed = confirmation(affidavit);
  const authorized = authorizeAction(world, {
    manifest,
    artifact,
    affidavit,
    confirmation: confirmed,
    tool: "release",
    entityId: "pikachu",
    authorizedAt: AUTHORIZED_AT,
    executedAt: EXECUTED_AT,
  });
  if (!authorized.ok) throw new Error(authorized.violations.map(denialCode).join(", "));
  return { manifest, artifact, affidavit, confirmation: confirmed, grant: authorized.value, executedAt: EXECUTED_AT };
}

function denials(record: ActionRecord): string[] {
  return verifyAction(world, record).violations.map(denialCode);
}

describe("an act is authorized only if the whole chain behind it holds", () => {
  it("mints a grant bound to the answer, the consent and the trainer's scope", () => {
    const { grant, manifest, confirmation: confirmed } = chain();

    expect(grant).toEqual({
      transactionId: manifest.transactionId,
      confirmationEventId: confirmed.id,
      tool: "release",
      entityId: "pikachu",
      scopeGrantId: world.grant!.id,
      authorizedAt: AUTHORIZED_AT,
    });
    expect(verifyAction(world, chain())).toEqual({ allowed: true, violations: [] });
  });

  it("refuses to mint one for an act the answer never proposed", () => {
    const manifest = answer([RELEASE]);
    const { artifact, affidavit } = page(manifest);
    const authorized = authorizeAction(world, {
      manifest,
      artifact,
      affidavit,
      confirmation: confirmation(affidavit),
      // Certified, on the page, and not the subject of any proposed act.
      tool: "release",
      entityId: "zapdos",
      authorizedAt: AUTHORIZED_AT,
      executedAt: EXECUTED_AT,
    });

    expect(authorized.ok).toBe(false);
    expect(authorized.ok ? [] : authorized.violations.map(denialCode)).toContain("IA-7/action-never-shown");
  });

  it("names the acts the answer did propose, so a refusal can be argued with", () => {
    const record = chain();
    const verdict = verifyAction(world, { ...record, grant: { ...record.grant, entityId: "zapdos" } });
    const denied = verdict.violations.find((item) => item.rule === "action-never-shown");
    expect(denied?.actual).toBe("release pikachu");
  });
});

describe("the act has to have been on the page the trainer confirmed", () => {
  it("denies an act the record does not say was shown", () => {
    // Two articles, one edit, and that is the point: Article VI catches the
    // affidavit disagreeing with the page, and Article VII refuses the act on
    // the record's own terms. Neither is standing in for the other, so an
    // affidavit that agreed with a page missing the card would still not
    // authorise anything.
    const record = chain();
    expect(
      denials({
        ...record,
        affidavit: { ...record.affidavit, units: record.affidavit.units.filter((unit) => unit.id !== ACTION_UNIT) },
      }),
    ).toEqual(["IA-6/affidavit-visibility-mismatch", "IA-7/action-not-visible"]);
  });

  it("says which of the two it was: absent from the page, or hidden on it", () => {
    const record = chain();
    const absent = verifyAction(world, {
      ...record,
      affidavit: { ...record.affidavit, units: record.affidavit.units.filter((unit) => unit.id !== ACTION_UNIT) },
    });
    const hidden = verifyAction(world, {
      ...record,
      affidavit: {
        ...record.affidavit,
        units: record.affidavit.units.map((unit) => (unit.id === ACTION_UNIT ? { ...unit, visible: false } : unit)),
      },
    });

    expect(absent.violations.find((item) => item.rule === "action-not-visible")?.actual).toBe("not in the artifact");
    expect(hidden.violations.find((item) => item.rule === "action-not-visible")?.actual).toBe("hidden");
  });

  it("does not add a chain denial when the answer itself is what fell over", () => {
    // The plan cannot be derived at all, so "was the act visible?" has no
    // honest answer. Reporting one would describe a page nobody may rely on.
    const record = chain();
    const broken = { ...record, manifest: { ...record.manifest, snapshotId: "kanto-yellow" } };

    expect(denials(broken)).toEqual(["IA-2/snapshot-mismatch"]);
  });
});

describe("the chain is in order, and the scope is still good when it matters", () => {
  it("denies a record that cannot be put in order at all", () => {
    const record = chain();
    const verdict = verifyAction(world, {
      ...record,
      confirmation: { ...record.confirmation, confirmedAt: "" },
      executedAt: "whenever",
    });

    expect(verdict.violations.map(denialCode)).toEqual(["IA-7/action-time-unreadable"]);
    // Both, not the first one found: a record missing two timestamps is not
    // one timestamp away from being a record.
    expect(verdict.violations[0]?.actual).toContain("the trainer confirmed");
    expect(verdict.violations[0]?.actual).toContain("the act would execute");
  });

  it("denies an act executed before the scope it cites was ever established", () => {
    const record = chain();
    // Ordered among themselves and every one of them before the grant existed.
    expect(
      denials({
        ...record,
        affidavit: { ...record.affidavit, renderedAt: "2025-12-31T09:00:00Z" },
        confirmation: { ...record.confirmation, confirmedAt: "2025-12-31T09:00:01Z" },
        grant: { ...record.grant, authorizedAt: "2025-12-31T09:00:02Z" },
        executedAt: "2025-12-31T09:00:03Z",
      }),
    ).toEqual(["IA-7/scope-expired-at-action"]);
  });

  it("says nothing about a window it cannot read, rather than allowing it", () => {
    // A grant with an unreadable window is already denied by name at commit
    // time (IA-1/scope-window-unreadable), which the render verification
    // reports here. A second, differently-named denial from this layer would
    // report one fault as two.
    const record = chain();
    const undated = {
      ...world,
      grant: { ...world.grant!, expiresAt: "sometime next week" },
    };
    const verdict = verifyAction(undated, record);

    expect(verdict.violations.map(denialCode)).toEqual(["IA-1/scope-window-unreadable"]);
  });
});
