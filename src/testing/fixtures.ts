/**
 * Test fixtures. Deterministic and offline: everything here reads the
 * vendored snapshot, never the network.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ScopeGrant } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import { type AccordPack, readPack } from "../kernel/pack.js";
import { CertifiedRegistry, loadRegistry } from "../kernel/registry.js";
import type { SnapshotDocument } from "../kernel/snapshot-format.js";
import { AccordError } from "../kernel/violation.js";

export const SNAPSHOT_PATH = resolve(import.meta.dirname, "../../data/snapshots/kanto-red-blue.json");
export const PACK_PATH = resolve(import.meta.dirname, "../../data/accord-pack/v1.json");

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

/**
 * A trainer whose scope was established over this snapshot's version group.
 * Phase 3 mints these through the propose/confirm ladder; phase 2 only has to
 * verify one, so the fixture constructs it directly.
 */
export function trainerGrant(badgeLevel = 8): ScopeGrant {
  return {
    id: "grant-kanto-trainer",
    scope: { version: "red-blue", region: "kanto", badgeLevel },
    // Stands in for a digest over the conversation that established scope;
    // phase 3 derives it from real evidence.
    evidenceDigest: `sha256:${"a1".repeat(32)}`,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  };
}

/** Registry, pack, grant and commit time, assembled the way the kernel wants. */
export function manifestContext(badgeLevel = 8): ManifestContext {
  return {
    registry: kantoRegistry(),
    pack: kantoPack(),
    grant: trainerGrant(badgeLevel),
    at: COMMIT_TIME,
  };
}

/**
 * A fresh, mutable copy of the snapshot document. Mutation tests get their
 * own copy so that sabotaging one never leaks into another.
 */
export function readSnapshot(): SnapshotDocument {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as SnapshotDocument;
}
