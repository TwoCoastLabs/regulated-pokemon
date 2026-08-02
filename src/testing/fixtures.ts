/**
 * Test fixtures. Deterministic and offline: everything here reads the
 * vendored snapshot, never the network.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CertifiedRegistry, loadRegistry } from "../kernel/registry.js";
import type { SnapshotDocument } from "../kernel/snapshot-format.js";
import { AccordError } from "../kernel/violation.js";

export const SNAPSHOT_PATH = resolve(import.meta.dirname, "../../data/snapshots/kanto-red-blue.json");

let cached: CertifiedRegistry | undefined;

/** The certified Kanto/Red-Blue registry, loaded once and shared. */
export function kantoRegistry(): CertifiedRegistry {
  if (cached === undefined) {
    const loaded = loadRegistry(readSnapshot());
    if (!loaded.ok) throw new AccordError(loaded.violations);
    cached = loaded.value;
  }
  return cached;
}

/**
 * A fresh, mutable copy of the snapshot document. Mutation tests get their
 * own copy so that sabotaging one never leaks into another.
 */
export function readSnapshot(): SnapshotDocument {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as SnapshotDocument;
}
