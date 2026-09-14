/**
 * The precedent store on disk — the node-only door, following
 * kernel/files.ts: everything that decides is in precedent.ts, a pure
 * function of parsed data; this module supplies the path and the read.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AccordPack } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import { AccordError, violation } from "../kernel/violation.js";
import { loadPrecedentStore, type PrecedentStore } from "./precedent.js";

const DATA = resolve(import.meta.dirname, "../../data/precedents");

/** Where a pack's store lives: one file per pack id, schema-versioned. */
export function precedentStorePath(packId: string): string {
  return resolve(DATA, `${packId}.v1.json`);
}

/** The store, read and validated against the world; `undefined` when no
 * store is shipped for it (a world without memory is the off arm, not an
 * error). A store that exists and does not load throws, named. */
export function readPrecedentStore(path: string, world: { registry: CertifiedRegistry; pack: AccordPack }): PrecedentStore | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([violation("IA-8", "precedent-store-unreadable", `cannot read the precedent store at ${path}: ${(cause as Error).message}`)]);
  }
  return loadPrecedentStore(parsed, world);
}
