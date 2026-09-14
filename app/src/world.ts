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
import { loadPrecedentStore, type Precedent, type PrecedentStore } from "../../src/memory/precedent.js";
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

let memory: PrecedentStore | null | undefined;

/** The operator's precedent store for this world (docs/precedent.md) —
 * the same vendored file the tracer and the banks read, bundled at build
 * time and loaded fail-closed against the world; `undefined` when none is
 * shipped. The live page reads it and never writes it. */
export function precedentStore(): PrecedentStore | undefined {
  if (memory === undefined) {
    const { pack } = demoWorld();
    const found = bundled[`../../data/precedents/${pack.id}.v1.json`];
    memory = found === undefined ? null : loadPrecedentStore(found, demoWorld());
  }
  return memory ?? undefined;
}

/** One precedent by id, for the panel under a call that held it. */
export function precedentById(id: string): Precedent | undefined {
  return precedentStore()?.precedents.find((one) => one.id === id);
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
