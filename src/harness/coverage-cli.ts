/**
 * The coverage map's entry point: run the playability bank through a real
 * model and render where every question landed. Thin, like live-cli — argv,
 * .env and the vendored world in, Markdown out; everything that decides is
 * `runBank` / `coverageMap` / `renderCoverage`, tested with scripted models.
 *
 * Never run in CI. It bills a real provider over the whole bank, so it is a
 * dry run by default: without `--live` it prints the plan and spends nothing.
 *
 *   npm run coverage:map                       # dry: what it would run
 *   npm run coverage:map -- --live             # the full bank, billed
 *   npm run coverage:map -- --live --weak --limit 20
 */

import { demoWorld } from "../demo/files.js";
import { readBank } from "./bank.js";
import { phrasingsOf, runBank, runIntentRobustness } from "./bank-run.js";
import { coverageMap, renderCoverage, renderRobustness, robustnessSummary } from "./coverage.js";
import { loadEnv } from "./live.js";
import { DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL, HONEST_PERSONA } from "./models.js";
import { OpenRouterProvider } from "./openrouter.js";

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const weak = argv.includes("--weak");
/** Robustness mode: run every phrasing of each entry and report whether the
 * wording moved the bucket, over the entries that carry paraphrases. */
const phrasingsMode = argv.includes("--phrasings");
const modelFlag = argv.indexOf("--model");
const model = modelFlag >= 0 ? argv[modelFlag + 1]! : weak ? DEFAULT_WEAK_MODEL : DEFAULT_STRONG_MODEL;
const limitFlag = argv.indexOf("--limit");
const limit = limitFlag >= 0 ? Number(argv[limitFlag + 1]) : undefined;

const bank = readBank();
const all = phrasingsMode ? bank.entries.filter((e) => phrasingsOf(e).length > 1) : bank.entries;
const entries = limit === undefined ? all : all.slice(0, limit);

if (!live) {
  const wordings = entries.reduce((sum, e) => sum + phrasingsOf(e).length, 0);
  console.log(
    [
      `Playability ${phrasingsMode ? "robustness" : "coverage"} — DRY RUN (nothing billed).`,
      `  bank:    ${bank.id} (${bank.entries.length} questions)`,
      phrasingsMode
        ? `  running: ${entries.length} entries with paraphrases, ${wordings} wordings in total`
        : `  running: ${entries.length} questions`,
      `  model:   ${model}`,
      `  add --live to run it against the model and bill your key.`,
    ].join("\n"),
  );
  process.exit(0);
}

const env = loadEnv(process.env, ".env");
const apiKey = env.OPENROUTER_API_KEY ?? "";
if (apiKey === "") {
  console.error("no OPENROUTER_API_KEY in the environment or .env — a live coverage run needs a real model");
  process.exit(2);
}

const provider = new OpenRouterProvider({ id: `coverage:${model}`, model, apiKey, system: HONEST_PERSONA, structured: true });

/** A fresh, strictly-increasing clock per entry, so ids and digests never
 * collide between questions. */
function makeClock(): () => string {
  let last = 0;
  return () => {
    const t = Math.max(Date.now(), last + 1);
    last = t;
    return new Date(t).toISOString();
  };
}

const world = demoWorld();

async function main(): Promise<string> {
  if (phrasingsMode) {
    const reports = [];
    for (const entry of entries) reports.push(await runIntentRobustness(world, entry, provider, makeClock));
    return renderRobustness(robustnessSummary(reports), `Phrasing robustness — ${model}`);
  }
  const runs = await runBank(world, entries, provider, makeClock);
  return renderCoverage(coverageMap(runs), `Playability coverage — ${model}`);
}

main()
  .then((markdown) => {
    console.log(markdown);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
