/**
 * Test fixtures. Deterministic and offline: everything here reads the
 * vendored snapshot, never the network.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ScopeGrant, ScopeTranscript } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import { readPack } from "../kernel/files.js";
import { type AccordPack, loadPack } from "../kernel/pack.js";
import { CertifiedRegistry, loadRegistry } from "../kernel/registry.js";
import { candidateDigest, establishScope } from "../kernel/scope.js";
import type { SnapshotDocument } from "../kernel/snapshot-format.js";
import { AccordError } from "../kernel/violation.js";

export const SNAPSHOT_PATH = resolve(import.meta.dirname, "../../data/snapshots/kanto-red-blue.json");
export const PACK_PATH = resolve(import.meta.dirname, "../../data/accord-pack/v2.json");

let cached: CertifiedRegistry | undefined;
let cachedPack: AccordPack | undefined;

/** The certified Kanto/Red-Blue registry, loaded once and shared. */
export function kantoRegistry(): CertifiedRegistry {
  if (cached === undefined) {
    const loaded = loadRegistry(readSnapshot());
    if (!loaded.ok) throw new AccordError(loaded.violations);
    cached = loaded.value;
  }
  return cached;
}

/** The shipped Accord pack, validated against that registry. */
export function kantoPack(): AccordPack {
  cachedPack ??= readPack(PACK_PATH, kantoRegistry());
  return cachedPack;
}

/**
 * Fixed timestamps rather than a clock. A verdict must be a pure function of
 * recorded inputs, so a test that depends on `now()` is testing something the
 * kernel is not allowed to do.
 */
export const ISSUED_AT = "2026-01-01T00:00:00Z";
export const COMMIT_TIME = "2026-01-01T12:00:00Z";
export const EXPIRES_AT = "2026-01-02T00:00:00Z";

const PROPOSAL_ID = "proposal-basis-1";
const BASIS_CANDIDATE = { comparisonBasis: "base-speed" };

/**
 * The conversation that establishes the fixture trainer's scope.
 *
 * Deliberately mixed: version, region and badge level come straight from the
 * trainer's own words, while "whichever of them is quickest" is wording the
 * approved vocabulary does not cover and therefore goes through the ladder —
 * proposed as an untrusted candidate, bound only by the trainer's confirmation
 * of that exact candidate. A conversation where everything matched directly
 * would never exercise the half of IA-1 that matters.
 */
export function trainerTranscript(badgeLevel = 8): ScopeTranscript {
  return [
    {
      kind: "utterance",
      at: ISSUED_AT,
      source: "trainer",
      text: `I'm playing Red and Blue, travelling around the Kanto region, and I have ${badgeLevel} badges.`,
    },
    { kind: "utterance", at: ISSUED_AT, source: "trainer", text: "Which of them is the quickest?" },
    {
      kind: "proposal",
      at: ISSUED_AT,
      id: PROPOSAL_ID,
      candidate: BASIS_CANDIDATE,
      interpreting: "whichever of them is quickest",
    },
    {
      kind: "confirmation",
      at: ISSUED_AT,
      source: "trainer",
      proposalId: PROPOSAL_ID,
      candidateDigest: candidateDigest(PROPOSAL_ID, BASIS_CANDIDATE),
      decision: "confirm",
    },
  ];
}

/**
 * A trainer whose scope was established over this snapshot's version group,
 * minted through the propose/confirm ladder rather than typed out by hand.
 *
 * Phase 2's whole crucible runs against this grant, which is the only way to
 * find out whether the two phases agree about what a grant is.
 */
export function trainerGrant(badgeLevel = 8): ScopeGrant {
  const established = establishScope(
    { pack: kantoPack(), at: ISSUED_AT, required: ["version", "region", "badgeLevel", "comparisonBasis"] },
    trainerTranscript(badgeLevel),
  );
  if (!established.ok) throw new AccordError(established.violations);
  return established.value;
}

/** The locale the fixture transport presents in. Approved by the shipped pack. */
export const LOCALE = "en-US";

/** Registry, pack, grant, locale and commit time, as the kernel wants them. */
export function manifestContext(badgeLevel = 8): ManifestContext {
  return {
    registry: kantoRegistry(),
    pack: kantoPack(),
    grant: trainerGrant(badgeLevel),
    locale: LOCALE,
    at: COMMIT_TIME,
  };
}

export const CENTER_SNAPSHOT_PATH = resolve(import.meta.dirname, "../../data/snapshots/kanto-center.json");

let centerCache: CertifiedRegistry | undefined;

/** The Center world's registry (epic #94, slice 3): items beside the species. */
export function centerRegistry(): CertifiedRegistry {
  if (centerCache === undefined) {
    const loaded = loadRegistry(JSON.parse(readFileSync(CENTER_SNAPSHOT_PATH, "utf8")));
    if (!loaded.ok) throw new AccordError(loaded.violations);
    centerCache = loaded.value;
  }
  return centerCache;
}

export const CENTER_PACK_PATH = resolve(import.meta.dirname, "../../data/accord-pack/center-v2.json");

let centerPackCache: AccordPack | undefined;

/** The Center's own Accord pack (epic #94, slice 3, PR 3): the same articles,
 * plus controlled-item gates, item acts with their consent notice, the
 * Center curriculum, and a comparison basis that knows about money. */
export function centerPack(): AccordPack {
  if (centerPackCache === undefined) {
    const loaded = loadPack(JSON.parse(readFileSync(CENTER_PACK_PATH, "utf8")), centerRegistry());
    if (!loaded.ok) throw new AccordError(loaded.violations);
    centerPackCache = loaded.value;
  }
  return centerPackCache;
}

/** The manifest context over the Center world — its own pack, same grant and clock. */
export function centerContext(badgeLevel = 8): ManifestContext {
  return { ...manifestContext(badgeLevel), registry: centerRegistry(), pack: centerPack() };
}

/**
 * A fresh, mutable copy of the snapshot document. Mutation tests get their
 * own copy so that sabotaging one never leaks into another.
 */
export function readSnapshot(): SnapshotDocument {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as SnapshotDocument;
}
