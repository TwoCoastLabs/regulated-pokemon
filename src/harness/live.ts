/**
 * The billable run: real models behind the same seam, and everything that has
 * to be true before one is allowed to spend money.
 *
 * Three models take the corpus, per the project's doctrine:
 *
 *  - a **capable** one, because a result only on a weak model proves nothing;
 *  - a **deliberately weak, cheap** one, because an invariant that holds only
 *    on the good model is evidence the architecture is leaning on behaviour it
 *    does not control;
 *  - an **adversary**, which is the same capable slug under a persona that
 *    actually tries to slip a false certified value past the gate. Attacking
 *    our own kernel is the point of the exercise: a safety number nobody
 *    attacked is not a safety number.
 *
 * The one thing a live adversary can do that a scripted one cannot is refuse.
 * A model too timid to attack passes the safety test vacuously, so the metrics
 * attribute denials per model and the self-check names that model when it never
 * made the gate fire. The run fails; it does not quietly congratulate itself.
 *
 * Posture: **a dry run by default.** Printing the plan is free, and a script
 * whose default behaviour bills an account is a footgun no amount of README
 * fixes. `--live` is the word that spends.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildArtifact, fileArtifact, type WriteFile } from "./artifact.js";
import { harnessWorld, type HarnessModel, SCENARIOS } from "./corpus.js";
import { ADVERSARY_PERSONA, DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL, HONEST_PERSONA } from "./models.js";
import { OpenRouterProvider, parseUpstreamPreference, type UpstreamPreference } from "./openrouter.js";
import type { ModelProvider } from "./provider.js";
import { type HarnessReport, runModels } from "./report.js";
import { MAX_SCOPE_TURNS } from "./run.js";

export { ADVERSARY_PERSONA, DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL, HONEST_PERSONA } from "./models.js";

// --- configuration ----------------------------------------------------------

export type Env = Record<string, string | undefined>;

export interface LiveConfig {
  /** The upstream routing preference, from OPENROUTER_UPSTREAM; absent means
   * the gateway's default. Recorded on every artifact. */
  upstream?: UpstreamPreference;
  apiKey: string;
  strong: string;
  weak: string;
  adversary: string;
  /** Hand the answer grammar to the endpoint as a decoding constraint. */
  structured: boolean;
}

/**
 * Parse a `.env` file: `KEY=value` lines, `#` comments, optional quotes.
 *
 * Hand-rolled rather than a dependency — the kernel ships with none, and this
 * is fifteen lines. It never overrides a variable already in the environment,
 * so CI and a shell export win over a file on disk.
 */
export function parseEnvFile(text: string): Env {
  const found: Env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const [, key, rawValue = ""] = match;
    if (key === undefined) continue;
    const value = rawValue.trim();
    const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
    found[key] = quoted?.[2] ?? value.replace(/\s+#.*$/, "");
  }
  return found;
}

export function loadEnv(processEnv: Env, path: string): Env {
  let fromFile: Env = {};
  try {
    fromFile = parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    // No .env is normal — the key may well be exported in the shell.
  }
  return { ...fromFile, ...processEnv };
}

export type ConfigResult = { ok: true; config: LiveConfig } | { ok: false; reason: string };

export function liveConfig(env: Env, structured = true): ConfigResult {
  const apiKey = (env.OPENROUTER_API_KEY ?? "").trim();
  if (apiKey === "") {
    return {
      ok: false,
      reason:
        "OPENROUTER_API_KEY is not set. Put it in .env (see .env.example) or export it; " +
        "it is never read from anywhere else and never written to an artifact.",
    };
  }
  const strong = env.HARNESS_STRONG_MODEL ?? DEFAULT_STRONG_MODEL;
  let upstream: UpstreamPreference | undefined;
  try {
    upstream = parseUpstreamPreference(env.OPENROUTER_UPSTREAM);
  } catch (cause) {
    return { ok: false, reason: (cause as Error).message };
  }
  return {
    ok: true,
    config: {
      apiKey,
      strong,
      weak: env.HARNESS_WEAK_MODEL ?? DEFAULT_WEAK_MODEL,
      structured,
      // The adversary is the capable model by default: a weak attacker that
      // fails to fabricate would prove nothing about the gate.
      adversary: env.HARNESS_ADVERSARY_MODEL ?? strong,
      ...(upstream === undefined ? {} : { upstream }),
    },
  };
}

// --- the models -------------------------------------------------------------

export type ProviderFactory = (config: LiveConfig) => readonly HarnessModel[];

/** A live model declares no expected outcome: its behaviour is the measurement.
 * The enforcement legs still apply — those are not predictions. */
export const liveModels: ProviderFactory = (config) => {
  const live = (id: string, model: string, system: string): ModelProvider =>
    new OpenRouterProvider({ id, model, system, apiKey: config.apiKey, structured: config.structured, ...(config.upstream === undefined ? {} : { upstream: config.upstream }) });

  return [
    { provider: live("live:strong", config.strong, HONEST_PERSONA), role: "strong", slug: config.strong },
    { provider: live("live:weak", config.weak, HONEST_PERSONA), role: "weak", slug: config.weak },
    {
      provider: live("live:adversarial", config.adversary, ADVERSARY_PERSONA),
      role: "adversarial",
      slug: config.adversary,
    },
  ];
};

// --- arguments --------------------------------------------------------------

export interface LiveArgs {
  live: boolean;
  /**
   * Constrain the answer's shape at decode time. On by default.
   *
   * Measured before it was adopted: on the weak model it took resolution from
   * 4/12 to 9/12 and left committed violations at zero, because it constrains
   * shape and never content. `--no-structured` restores the old behaviour, and
   * is how that comparison stays reproducible rather than becoming folklore.
   */
  structured: boolean;
  /** Hand the proposer the certified registry to compose from — a measured
   * variable, facts only and never policy (see reference.ts). Off by default:
   * ungrounded, a wrong fact is the model misremembering; grounded, it is a
   * composition error, and the two are worth telling apart. */
  grounded: boolean;
  /** Run the control arm: the same models ungoverned, published as-is and
   * metered afterwards. On by default — the A/B is the thesis's experiment,
   * and a paid run without its control arm supports a weaker claim. */
  raw: boolean;
  repetitions: number;
  out: string;
  roles: readonly string[];
  help: boolean;
  errors: readonly string[];
}

export function parseArgs(argv: readonly string[]): LiveArgs {
  const args: {
    live: boolean;
    structured: boolean;
    grounded: boolean;
    raw: boolean;
    repetitions: number;
    out: string;
    roles: string[];
    help: boolean;
    errors: string[];
  } = {
    live: false,
    structured: true,
    grounded: false,
    raw: true,
    repetitions: 1,
    out: "runs",
    roles: [],
    help: false,
    errors: [],
  };

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--live":
        args.live = true;
        break;
      case "--structured":
        args.structured = true;
        break;
      case "--no-structured":
        args.structured = false;
        break;
      case "--grounded":
        args.grounded = true;
        break;
      case "--raw":
        args.raw = true;
        break;
      case "--no-raw":
        args.raw = false;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--repetitions": {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) args.errors.push(`--repetitions needs a positive integer, got ${value}`);
        else args.repetitions = count;
        index++;
        break;
      }
      case "--out":
        if (value === undefined) args.errors.push("--out needs a directory");
        else args.out = value;
        index++;
        break;
      case "--models":
        if (value === undefined) args.errors.push("--models needs a comma-separated list of roles");
        else args.roles = value.split(",").map((role) => role.trim()).filter((role) => role !== "");
        index++;
        break;
      default:
        args.errors.push(`unknown argument: ${flag}`);
    }
  }
  return args;
}

const USAGE = [
  "The billable live-model harness. It calls OpenRouter and costs money.",
  "",
  "  npm run harness:live                    # a dry run: prints the plan, calls nothing",
  "  npm run harness:live -- --live          # spend, one pass over the corpus",
  "  npm run harness:live -- --live --repetitions 3",
  "  npm run harness:live -- --live --models strong,weak",
  "",
  "  --live              actually call the provider. Without it nothing is billed.",
  "  --repetitions N     samples per model per scenario (default 1). A provider is",
  "                      nondeterministic even at temperature 0; N=1 first, then N=3.",
  "  --models a,b,c      roles to run: strong, weak, adversarial (default: all three).",
  "  --no-structured     stop enforcing the answer grammar at decode time. On by",
  "                      default because it lifts a weak model (4/12 -> 9/12) while",
  "                      leaving enforcement at zero: it constrains shape, not content.",
  "  --grounded          hand the proposer the certified registry to compose from",
  "                      instead of recall. Facts only, never policy; every value is",
  "                      still re-verified, so enforcement is untouched.",
  "  --no-raw            skip the control arm (the same models ungoverned, published",
  "                      as-is, metered afterwards). On by default: the A/B is the",
  "                      experiment, and it costs one extra call per model-scenario.",
  "  --out DIR           where the run artifact is filed (default: runs/).",
  "",
  "The key is read from OPENROUTER_API_KEY, in the environment or in .env.",
  "The models are OpenRouter slugs, overridable with HARNESS_STRONG_MODEL,",
  "HARNESS_WEAK_MODEL and HARNESS_ADVERSARY_MODEL.",
].join("\n");

// --- the run ----------------------------------------------------------------

export interface LiveOptions {
  argv: readonly string[];
  env: Env;
  /** The caller's clock: this module reads none of its own. */
  now: string;
  /** Injected so the whole path, including filing, is exercised without a
   * network, a key or a temporary directory. */
  makeModels?: ProviderFactory;
  write?: WriteFile;
}

export interface LiveResult {
  lines: readonly string[];
  exitCode: number;
  artifactPath?: string;
  report?: HarnessReport;
}

/** The upper bound on calls: every scope turn plus the answer, for every model
 * on every scenario, on every pass — plus one ungoverned call per cell when the
 * control arm runs. Honest about being a bound — a model that resolves scope
 * immediately makes far fewer. */
export function plannedCalls(models: number, scenarios: number, repetitions: number, raw = false): number {
  return models * scenarios * repetitions * (MAX_SCOPE_TURNS + 1 + (raw ? 1 : 0));
}

export async function runLive(options: LiveOptions): Promise<LiveResult> {
  const args = parseArgs(options.argv);
  if (args.help) return { lines: [USAGE], exitCode: 0 };
  if (args.errors.length > 0) return { lines: [...args.errors, "", USAGE], exitCode: 1 };

  const config = liveConfig(options.env, args.structured);
  if (!config.ok) return { lines: [config.reason], exitCode: 1 };

  const all = (options.makeModels ?? liveModels)(config.config);
  const selected = args.roles.length === 0 ? all : all.filter((model) => args.roles.includes(model.role));
  if (selected.length === 0) {
    return { lines: [`no model matches --models ${args.roles.join(",")}; roles are strong, weak, adversarial`], exitCode: 1 };
  }

  const plan = [
    `models        ${selected.map((model) => `${model.provider.id} (${model.slug ?? "—"})`).join(", ")}`,
    `scenarios     ${SCENARIOS.map((scenario) => scenario.id).join(", ")}`,
    `repetitions   ${args.repetitions}`,
    `structured    ${args.structured ? "yes — the answer grammar is enforced at decode time" : "no — prose only, the pre-grammar baseline"}`,
    `grounded      ${args.grounded ? "yes — the certified registry is handed to the proposer (facts, not policy)" : "no — the model answers from its own knowledge"}`,
    `raw control   ${args.raw ? "yes — each model also answers each scenario ungoverned, published as-is and metered" : "no — governed leg only; the A/B has no control arm"}`,
    `calls         at most ${plannedCalls(selected.length, SCENARIOS.length, args.repetitions, args.raw)}`,
    "cost          unknown until it is spent — priced by the provider, never estimated here",
  ];

  if (!args.live) {
    return {
      lines: [
        "PLAN (dry run — nothing was called and nothing was billed)",
        ...plan.map((line) => `  ${line}`),
        "",
        "Re-run with --live to spend. Run N=1 before paying for N=3.",
      ],
      exitCode: 0,
    };
  }

  const world = harnessWorld();
  const report = await runModels({
    world,
    models: selected,
    scenarios: SCENARIOS,
    repetitions: args.repetitions,
    grounded: args.grounded,
    raw: args.raw,
    title: "Indigo Accord — live-model harness (billable)",
  });

  const artifact = buildArtifact(report, {
    label: args.grounded ? "live-grounded" : args.structured ? "live" : "live-unconstrained",
    startedAt: options.now,
    world,
    structured: args.structured,
    grounded: args.grounded,
  });
  const artifactPath = fileArtifact(artifact, resolve(args.out), options.write);

  return {
    lines: [...report.lines, "", `ARTIFACT`, `  ${artifactPath}`],
    exitCode: report.exitCode,
    artifactPath,
    report,
  };
}
