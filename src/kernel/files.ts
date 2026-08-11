/**
 * The kernel's two file-reading conveniences, quarantined.
 *
 * Everything the kernel decides is a pure function of parsed data —
 * `loadRegistry` and `loadPack` take values, not paths. These wrappers are the
 * only place the kernel touches a filesystem, split out so that every module
 * an enforcement path imports also runs in a browser: the sabotage page runs
 * the real kernel there, and a `node:fs` import in `registry.ts` would have
 * made that a bundler accident instead of a property. Node callers — the demo,
 * the harness, the fixtures — import this module; nothing else may.
 */

import { readFileSync } from "node:fs";

import { type AccordPack, loadPack } from "./pack.js";
import { CertifiedRegistry, loadRegistry } from "./registry.js";
import { AccordError, violation } from "./violation.js";

/** Read the vendored snapshot from disk, refusing loudly if it does not hold. */
export function readRegistry(path: string): CertifiedRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([
      violation("IA-2", "snapshot-unreadable", `cannot read snapshot at ${path}: ${(cause as Error).message}`),
    ]);
  }
  const loaded = loadRegistry(parsed);
  if (!loaded.ok) throw new AccordError(loaded.violations);
  return loaded.value;
}

/** Read a pack from disk, refusing loudly if it does not hold up. */
export function readPack(path: string, registry: CertifiedRegistry): AccordPack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([
      violation("IA-5", "pack-unreadable", `cannot read Accord pack at ${path}: ${(cause as Error).message}`),
    ]);
  }
  const loaded = loadPack(parsed, registry);
  if (!loaded.ok) throw new AccordError(loaded.violations);
  return loaded.value;
}
