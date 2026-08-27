/**
 * The certified world, in the browser. The same vendored bytes CI reads —
 * the pinned snapshot and the Accord pack — bundled at build time and handed
 * to the same loaders (`loadDemoWorld`), then the clean conversation is
 * played for its grant (`sabotageWorld`). Nothing here is a browser copy of
 * kernel logic; the only thing this file supplies is delivery.
 */
import type { ManifestContext } from "../../src/kernel/manifest.js";
import { type DemoWorld, loadDemoWorld, sabotageWorld } from "../../src/demo/script.js";

const bundled = import.meta.glob("../../data/**/*.json", { eager: true, import: "default" });

function datum(path: string): unknown {
  const found = bundled[`../../data/${path}`];
  if (found === undefined) throw new Error(`the app bundled no ${path}`);
  return found;
}

let world: DemoWorld | undefined;

/** The certified world itself — registry loaded (digest recomputed and
 * checked) and pack validated against it — once, then shared. The live
 * session runs against exactly this. */
export function demoWorld(): DemoWorld {
  world ??= loadDemoWorld(datum("snapshots/kanto-red-blue.json"), datum("accord-pack/v2.json"));
  return world;
}

let cached: ManifestContext | undefined;

/** The world with the clean conversation played for its grant — what the
 * crucible's mutations run against. */
export function sabotageContext(): ManifestContext {
  cached ??= sabotageWorld(demoWorld());
  return cached;
}
