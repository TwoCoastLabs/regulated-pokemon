/**
 * The session tracer's entry point, and nothing more — argv, .env and the
 * vendored world in, lines out. Everything that decides is in trace.ts
 * (`parseTraceArgs`, `runTrace`), tested with scripted providers; this file
 * supplies disk, env and a terminal, following live-cli.ts.
 *
 * Never run in CI. With a real model behind it, it calls a real provider and
 * costs real money, exactly as the live harness does; a conversation of a few
 * turns costs well under a cent, and the summary line prints what it was.
 *
 * Grounded by retrieval with a gated grammar by default (findings §17, §19):
 * the proposer composes from only the facts each question needs, and the answer
 * schema is narrowed to the claim kinds the question nominates — which is what
 * lets a cheap model be the default. `--ungrounded` is the control-arm demo
 * (§14) — the model answers from memory, so a benign fabrication can be watched
 * hitting the gate; `--grounded` is the whole-registry variant; `--loose-grammar`
 * offers every claim kind (the pre-§19 behaviour, for the shape-deflection demo).
 * Enforcement is identical under all of them: the kernel recomputes every value,
 * and every gated kind stays representable so the refusal is never made vacuous.
 *
 *   npm run session:trace -- "what types of pokemons do you have?"
 *   npm run session:trace -- --weak "hi" "Red and Blue" /confirm
 *   npm run session:trace -- --ungrounded --adversarial "What is Pikachu's Speed?"
 *   npm run session:trace -- --center "how much is a potion" "red and blue" "kanto" "8"
 */

import { centerWorld, demoWorld } from "../demo/files.js";
import { loadEnv } from "../harness/live.js";
import { precedentStorePath, readPrecedentStore } from "../memory/files.js";
import { ADVERSARY_PERSONA, DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL, HONEST_PERSONA } from "../harness/models.js";
import { describeUpstreamPreference, OpenRouterProvider, parseUpstreamPreference } from "../harness/openrouter.js";
import { createDevTrace } from "./devtrace.js";
import { parseTraceArgs, runTrace } from "./trace.js";

const args = parseTraceArgs(process.argv.slice(2));
const model = args.model ?? (args.weak ? DEFAULT_WEAK_MODEL : DEFAULT_STRONG_MODEL);

const env = loadEnv(process.env, ".env");
const apiKey = env.OPENROUTER_API_KEY ?? "";
if (apiKey === "") {
  console.error("no OPENROUTER_API_KEY in the environment or .env — the tracer needs a real model behind it");
  process.exit(2);
}

// The operator's routing preference, from .env — the same setting the banks
// read, so a probe here reads what a leg would run under.
const upstream = parseUpstreamPreference(env.OPENROUTER_UPSTREAM);
const provider = new OpenRouterProvider({
  id: `trace:${model}`,
  model,
  apiKey,
  system: args.adversarial ? ADVERSARY_PERSONA : HONEST_PERSONA,
  structured: true,
  ...(upstream === undefined ? {} : { upstream }),
});

/** Strictly increasing, as the page's clock is: the kernel orders moments. */
function makeClock(): () => string {
  let last = 0;
  return () => {
    const t = Math.max(Date.now(), last + 1);
    last = t;
    return new Date(t).toISOString();
  };
}

// The product default is retrieval grounding with a gated grammar; the flags
// select the other grounding modes and loosen the grammar.
const grounded = args.grounding === "full";
const retrieval = args.grounding === "retrieval";
const world = args.center ? centerWorld() : demoWorld();
// The precedent door: the world's own store, when one is shipped and the
// flag has not shut it. Loaded fail-closed; a store that does not load
// stops the tracer by name rather than tracing against half a memory.
const store = args.memory ? readPrecedentStore(args.precedentStore ?? precedentStorePath(world.pack.id), world) : undefined;
console.log(
  `[config] model ${model} routed ${describeUpstreamPreference(upstream)}, world ${world.registry.snapshot.id} + ${world.pack.id}, grounding ${args.grounding}, grammar ${args.gatedGrammar ? "gated" : "loose"}, repair ${args.repair ? "on" : "off"}, feedback ${args.feedback ? "on" : "off"}, clarify ${args.clarify ? "on" : "off"}, suggest ${args.suggest ? "on" : "off"}, memory ${store === undefined ? (args.memory ? "off (no store shipped)" : "off") : `on (${store.precedents.length} precedents)`}, prompt ${args.prompt}, refused nomination ${args.refusalFeedback ? "fed back" : "withdrawn in silence"}, listing door ${args.offeredDoors ? "offered only when the driver would accept it" : "offered on every first call"}, lesson door ${args.lessonDoor ? `only the lessons the ask is about${args.lessonClassifier ? ", the model asked when none match" : ""}` : "the whole catalogue"}${args.adversarial ? ", adversarial" : ""}`,
);

// Every call through the same tap the live page's dev view uses, so the
// tracer can end on the calls themselves — wall time, tokens and the
// upstream that served each — the reading a latency probe is for
// (findings §27: one model id, 3 to 33 tok/s by route).
const trace = createDevTrace({ now: makeClock(), elapsedMs: () => performance.now() });

runTrace(args.inputs, {
  world,
  provider: trace.tap(provider),
  now: makeClock(),
  // The exchange in progress, on stderr as the driver takes each step — the
  // terminal's version of the live page's busy line. The summary on stdout
  // is unchanged, so a piped trace reads as before.
  onStep: (step) => console.error(`  … ${step.lane}: ${step.code} — ${step.text}`),
  grounded,
  retrieval,
  gatedGrammar: args.gatedGrammar,
  repair: args.repair,
  feedback: args.feedback,
  clarify: args.clarify,
  suggest: args.suggest,
  prompt: args.prompt,
  refusalFeedback: args.refusalFeedback,
  offeredDoors: args.offeredDoors,
  lessonDoor: args.lessonDoor,
  lessonClassifier: args.lessonClassifier,
  ...(store === undefined ? {} : { precedents: { store } }),
}).then((result) => {
  for (const line of result.lines) console.log(line);
  for (const call of trace.calls) {
    const usage = call.usage;
    console.log(
      `[call #${call.seq}] ${call.purpose} ${(call.latencyMs / 1000).toFixed(1)}s` +
        (call.servedBy === undefined ? "" : ` via ${call.servedBy}`) +
        (usage === undefined ? "" : ` · ${usage.promptTokens}→${usage.completionTokens} tok · ${call.latencyMs > 0 ? ((usage.completionTokens * 1000) / call.latencyMs).toFixed(1) : "?"} tok/s · $${usage.costUsd.toFixed(4)}`) +
        (call.error === undefined ? "" : ` · FAILED: ${call.error}`),
    );
  }
  process.exit(result.exitCode);
});
