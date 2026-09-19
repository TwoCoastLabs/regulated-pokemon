/**
 * The lesson door's live reading, and nothing more (docs/lesson-door.md,
 * the classifier). Everything that decides is `readLessonDoor` and
 * `summarize` (lesson-door-reading.ts); this file supplies the model, the
 * key, the clock and the disk.
 *
 * Billable, never in CI. Files an artifact under runs/lesson-door/.
 *
 *   npm run lesson-door:read                       # strong model, classifier on, N=1
 *   npm run lesson-door:read -- --weak --repetitions 3
 *   npm run lesson-door:read -- --no-classifier    # the deterministic door alone, live (a control)
 */

import { demoWorld } from "../demo/files.js";
import { readLessonParaphrases } from "./activation.js";
import { BANK_PATH, readBank } from "./bank.js";
import { fileLessonDoorReading, type LessonDoorReadingArtifact, readingWorld, readLessonDoor, renderLessonDoorReading, summarize } from "./lesson-door-reading.js";
import { loadEnv } from "./live.js";
import { DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL, HONEST_PERSONA } from "./models.js";
import { OpenRouterProvider, parseUpstreamPreference } from "./openrouter.js";
import type { LessonMatcherId } from "../session/lesson-matcher.js";

const argv = process.argv.slice(2);
const weak = argv.includes("--weak");
const classifier = !argv.includes("--no-classifier");
const repetitionsAt = argv.indexOf("--repetitions");
const repetitions = repetitionsAt >= 0 ? Number(argv[repetitionsAt + 1]) : 1;
const matcherAt = argv.indexOf("--matcher");
const matcher = (matcherAt >= 0 ? argv[matcherAt + 1] : "alias") as LessonMatcherId;
const model = weak ? DEFAULT_WEAK_MODEL : DEFAULT_STRONG_MODEL;

const env = loadEnv(process.env, ".env");
const apiKey = env.OPENROUTER_API_KEY ?? "";
if (apiKey === "") {
  console.error("no OPENROUTER_API_KEY in the environment or .env");
  process.exit(2);
}
const upstream = parseUpstreamPreference(env.OPENROUTER_UPSTREAM);
const provider = new OpenRouterProvider({ id: `lesson-door:${model}`, model, apiKey, system: HONEST_PERSONA, structured: true, ...(upstream === undefined ? {} : { upstream }) });

const world = demoWorld();
const bank = readBank(BANK_PATH);
const paraphrases = readLessonParaphrases(bank);
const startedAt = new Date().toISOString();
console.log(`[config] model ${model}, matcher ${matcher}, classifier ${classifier ? "on" : "off"}, N=${repetitions}`);
const readings = await readLessonDoor(world, provider, bank, paraphrases, { matcher, classifier, repetitions });
const artifact: LessonDoorReadingArtifact = {
  schemaVersion: 1,
  label: "lesson-door-reading",
  startedAt,
  model: { id: `lesson-door:${model}`, slug: model },
  world: readingWorld(world),
  matcher,
  classifier,
  repetitions,
  readings,
  summary: summarize(readings),
};
const path = fileLessonDoorReading("runs/lesson-door", artifact);
console.log(renderLessonDoorReading(artifact));
console.log(`filed: ${path}`);
