/**
 * The demo's world, read from disk — the CLI's side of `loadDemoWorld`.
 *
 * Split from script.ts for the same reason the kernel's file readers live in
 * kernel/files.ts: everything that decides is a pure function of parsed data,
 * and the sabotage page imports script.ts in a browser, where there is no
 * disk. This module is the node-only door; it loads the same vendored bytes
 * CI reads, by the same public entry points anyone else would use.
 */

import { resolve } from "node:path";

import { readPack, readRegistry } from "../kernel/files.js";
import type { DemoWorld } from "./script.js";

const DATA = resolve(import.meta.dirname, "../../data");
export const SNAPSHOT_PATH = resolve(DATA, "snapshots/kanto-red-blue.json");
export const PACK_PATH = resolve(DATA, "accord-pack/v2.json");

let loaded: DemoWorld | undefined;

/** The certified world, read once from disk. Throws named, never silently. */
export function demoWorld(): DemoWorld {
  if (loaded === undefined) {
    const registry = readRegistry(SNAPSHOT_PATH);
    loaded = { registry, pack: readPack(PACK_PATH, registry) };
  }
  return loaded;
}
