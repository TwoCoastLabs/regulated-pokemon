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
import { loadDemoWorld } from "./script.js";
import { readFileSync } from "node:fs";

import { readPack, readRegistry } from "../kernel/files.js";
import type { DemoWorld } from "./script.js";

const DATA = resolve(import.meta.dirname, "../../data");
export const SNAPSHOT_PATH = resolve(DATA, "snapshots/kanto-red-blue.json");
export const PACK_PATH = resolve(DATA, "accord-pack/v2.json");

let loaded: DemoWorld | undefined;

/** The certified world, read once from disk. Throws named, never silently. */
export const CENTER_SNAPSHOT_PATH = resolve(DATA, "snapshots/kanto-center.json");
// v1 stays on the shelf: the filed Center records pin pokemon-center-v1 and
// the replay sweep resolves by that pin. New runs speak v2 (the bag rules).
export const CENTER_PACK_PATH = resolve(DATA, "accord-pack/center-v2.json");

let centerCached: DemoWorld | undefined;

/** The Center world (epic #94, slice 3): kanto-center under its own pack. */
export function centerWorld(): DemoWorld {
  if (centerCached === undefined) {
    centerCached = loadDemoWorld(
      JSON.parse(readFileSync(CENTER_SNAPSHOT_PATH, "utf8")),
      JSON.parse(readFileSync(CENTER_PACK_PATH, "utf8")),
    );
  }
  return centerCached;
}

export function demoWorld(): DemoWorld {
  if (loaded === undefined) {
    const registry = readRegistry(SNAPSHOT_PATH);
    loaded = { registry, pack: readPack(PACK_PATH, registry) };
  }
  return loaded;
}
