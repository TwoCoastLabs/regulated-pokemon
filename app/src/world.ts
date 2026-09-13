/**
 * The certified world, in the browser. The same vendored bytes CI reads —
 * the pinned snapshot and the Accord pack — bundled at build time and handed
 * to the same loaders (`loadDemoWorld`), then the clean conversation is
 * played for its grant (`sabotageWorld`). Nothing here is a browser copy of
 * kernel logic; the only thing this file supplies is delivery.
 */
import type { ManifestContext } from "../../src/kernel/manifest.js";
import { blockFor, curriculumRule } from "../../src/kernel/pack.js";
import { type DemoWorld, loadDemoWorld, sabotageWorld } from "../../src/demo/script.js";
import type { ClaimSource } from "../../src/ui/claims.js";

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
  world ??= loadDemoWorld(datum("snapshots/kanto-red-blue.json"), datum("accord-pack/v3.json"));
  return world;
}

let source: ClaimSource | undefined;

/** The world as the claim view reads it: the registry's `resolve` for a
 * ranking's field, the pack's curriculum for a lesson's text. Only for a
 * record certified against this snapshot — `claimSourceFor` checks. */
export function claimSource(): ClaimSource {
  const { registry, pack } = demoWorld();
  source ??= {
    resolve: (entityId, factId) => registry.resolve(entityId, factId),
    lesson: (blockId, locale) => {
      const rule = curriculumRule(pack, blockId);
      return rule === undefined ? undefined : blockFor(rule, locale)?.text;
    },
  };
  return source;
}

/** The bundled world's source when a filed record was certified against
 * the same snapshot, else nothing — a ranking's field from another snapshot
 * would be a different world's numbers. */
export function claimSourceFor(snapshotId: string): ClaimSource | undefined {
  return snapshotId === demoWorld().registry.snapshot.id ? claimSource() : undefined;
}

let cached: ManifestContext | undefined;

/** The world with the clean conversation played for its grant — what the
 * crucible's mutations run against. */
export function sabotageContext(): ManifestContext {
  cached ??= sabotageWorld(demoWorld());
  return cached;
}
