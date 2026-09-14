/**
 * The promotion's entry point — a filed coverage artifact in, a precedent
 * store out (docs/precedent.md). Key-free and deterministic: the same
 * artifact yields the same store, and the diff is a pull request the
 * steward approves. Everything that decides is in promote.ts, tested; this
 * file supplies disk and a terminal.
 *
 *   npm run precedents:promote -- runs/coverage/<artifact>.json
 *   npm run precedents:promote -- runs/coverage/<artifact>.json --reset      # start the store over
 *   npm run precedents:promote -- runs/coverage/<artifact>.json --out path   # somewhere else
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { demoWorld } from "../demo/files.js";
import { precedentStorePath, readPrecedentStore } from "./files.js";
import { loadPrecedentStore } from "./precedent.js";
import { type PromotableRun, promoteFromRuns } from "./promote.js";

const argv = process.argv.slice(2);
const files = argv.filter((arg) => !arg.startsWith("--") && argv[argv.indexOf(arg) - 1] !== "--out");
const outFlag = argv.indexOf("--out");
const reset = argv.includes("--reset");
if (files.length === 0) {
  console.error("usage: precedents:promote -- <coverage artifact.json> [--out <store.json>] [--reset]");
  process.exit(2);
}

const world = demoWorld();
const out = outFlag >= 0 && argv[outFlag + 1] !== undefined ? resolve(argv[outFlag + 1]!) : precedentStorePath(world.pack.id);
let existing = reset ? undefined : readPrecedentStore(out, world);

for (const file of files) {
  const artifact = JSON.parse(readFileSync(file, "utf8")) as { runs: PromotableRun[]; world: { snapshotId: string; packId: string } };
  const promotion = promoteFromRuns(artifact.runs, {
    artifact: file,
    packId: world.pack.id,
    at: new Date().toISOString(),
    ...(existing === undefined ? {} : { existing }),
  });
  // Validate before writing: a store the loader would refuse is never filed.
  existing = loadPrecedentStore(promotion.store, world);
  console.log(`${file}: ${promotion.added.length} precedent(s) added from ${artifact.runs.length} run(s)`);
  for (const [reason, count] of Object.entries(promotion.skipped).sort(([, a], [, b]) => b - a)) console.log(`  skipped ${count}: ${reason}`);
}

writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
console.log(`store: ${out} (${existing?.precedents.length ?? 0} precedents, pack ${world.pack.id})`);
