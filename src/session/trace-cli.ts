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
import { ADVERSARY_PERSONA, DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL, HONEST_PERSONA } from "../harness/models.js";
import { OpenRouterProvider } from "../harness/openrouter.js";
import { parseTraceArgs, runTrace } from "./trace.js";

const args = parseTraceArgs(process.argv.slice(2));
const model = args.model ?? (args.weak ? DEFAULT_WEAK_MODEL : DEFAULT_STRONG_MODEL);

const env = loadEnv(process.env, ".env");
const apiKey = env.OPENROUTER_API_KEY ?? "";
if (apiKey === "") {
  console.error("no OPENROUTER_API_KEY in the environment or .env — the tracer needs a real model behind it");
  process.exit(2);
}

const provider = new OpenRouterProvider({
  id: `trace:${model}`,
  model,
  apiKey,
  system: args.adversarial ? ADVERSARY_PERSONA : HONEST_PERSONA,
  structured: true,
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
console.log(
  `[config] model ${model}, world ${world.registry.snapshot.id} + ${world.pack.id}, grounding ${args.grounding}, grammar ${args.gatedGrammar ? "gated" : "loose"}, repair ${args.repair ? "on" : "off"}, feedback ${args.feedback ? "on" : "off"}, clarify ${args.clarify ? "on" : "off"}${args.adversarial ? ", adversarial" : ""}`,
);

runTrace(args.inputs, {
  world,
  provider,
  now: makeClock(),
  grounded,
  retrieval,
  gatedGrammar: args.gatedGrammar,
  repair: args.repair,
  feedback: args.feedback,
  clarify: args.clarify,
}).then((result) => {
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
});
