/**
 * The certified world, in the browser. The same vendored bytes CI reads —
 * the pinned snapshot and the Accord pack — bundled at build time and handed
 * to the same loaders (`loadDemoWorld`), then the clean conversation is
 * played for its grant (`sabotageWorld`). Nothing here is a browser copy of
 * kernel logic; the only thing this file supplies is delivery.
 */
import type { ManifestContext } from "../../src/kernel/manifest.js";
import { loadDemoWorld, sabotageWorld } from "../../src/demo/script.js";

const bundled = import.meta.glob("../../data/**/*.json", { eager: true, import: "default" });

function datum(path: string): unknown {
  const found = bundled[`../../data/${path}`];
  if (found === undefined) throw new Error(`the app bundled no ${path}`);
  return found;
}

let cached: ManifestContext | undefined;

/** Registry loaded (digest recomputed and checked), pack validated against
 * it, scope established through the ladder — once, then shared. */
export function sabotageContext(): ManifestContext {
  cached ??= sabotageWorld(loadDemoWorld(datum("snapshots/kanto-red-blue.json"), datum("accord-pack/v1.json")));
  return cached;
}
