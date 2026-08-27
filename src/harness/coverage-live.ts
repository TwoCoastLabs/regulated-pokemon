/**
 * The billable coverage run, and the render of one already paid for — wave 4's
 * instrument, shaped like live.ts so the CLI stays a connector.
 *
 * Three modes, one function:
 *
 *  - **dry** (default): print the plan — which entries, which model, how many
 *    passes — and spend nothing. A script whose default behaviour bills an
 *    account is a footgun no README fixes.
 *  - **`--live`**: run the selected bank entries through the real session
 *    spine, file the whole record as a {@link CoverageArtifact}, and render
 *    the map *from the filed artifact* — the page and the file cannot
 *    disagree, because one is a function of the other.
 *  - **`--render`**: re-render a filed artifact (the newest coverage artifact
 *    in `runs/coverage/` by default). Reads no clock, no key, no network.
 *
 * Coverage artifacts live in `runs/coverage/`, not `runs/`: the harness's
 * directory has consumers — the app bundles its newest file as the run ledger
 * and `harness:results` renders it — that assume every artifact there is a
 * filed *harness* run, and a coverage record is a different schema.
 *
 * The paid design the epic settled on is expressible from the flags: the full
 * bank at `--repetitions 1`, then the enforcement slice at
 * `--dispositions should-refuse --repetitions 3` — two artifacts per model,
 * each naming what it is. Repetitions run pass-major, and an enforcement
 * escalation stops the run before the next pass is paid for (the harness's
 * repetition discipline, applied here).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { fileArtifact, type WriteFile } from "./artifact.js";
import { CENTER_BANK_PATH, readBank } from "./bank.js";
import { phrasingsOf, runBank, runIntentRobustness, type IntentRobustness, type RecordedBankRun } from "./bank-run.js";
import {
  buildCoverageArtifact,
  type CoverageArtifact,
  latestCoverageArtifact,
  renderCoverageArtifact,
} from "./coverage-artifact.js";
import {
  buildDialogueArtifact,
  type DialogueArtifact,
  latestDialogueArtifact,
  renderDialogueArtifact,
} from "./dialogue-artifact.js";
import { runDialogues } from "./dialogue-run.js";
import { ADVERSARIAL_BANK_PATH, readDialogues } from "./dialogues.js";
import { centerWorld, demoWorld } from "../demo/files.js";
import type { Env } from "./live.js";
import { DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL, HONEST_PERSONA } from "./models.js";
import { OpenRouterProvider } from "./openrouter.js";
import { type Disposition, DISPOSITIONS } from "./playability.js";
import type { ModelProvider } from "./provider.js";

// --- arguments --------------------------------------------------------------

export interface CoverageArgs {
  live: boolean;
  render: boolean;
  weak: boolean;
  /** Run the multi-turn dialogue bank instead of the single-turn one. Its
   * output is a `dialogue` artifact, aggregated per turn with the ceremony
   * cost of each whole conversation. */
  dialogues: boolean;
  /** With `--dialogues`: run the adversarial bank — the trainer as the attacker. */
  adversarial: boolean;
  /** Run the Center world: kanto-center, its own pack, the migrated bank. */
  center: boolean;
  /** Hand the proposer the certified facts to compose from (a retrieval lever
   * on the *value* errors a model makes recalling). Enforcement is unaffected —
   * every value is still recomputed — so it is a usefulness dial, and it travels
   * with the artifact because it changes what the number measures. */
  grounded: boolean;
  /** Ground with only the rows each question needs (retrieval) rather than the
   * whole registry — grounding's usefulness at a fraction of the tokens. */
  retrieval: boolean;
  /** Narrow the answer grammar to the filler kinds each question nominates — the
   * shape-deflection fix (§19). Composes with any grounding mode. */
  gatedGrammar: boolean;
  /** Strip-assertion resubmit (docs/recovery.md, channel 2): on an all-IA-2
   * fact-mismatch denial the driver strips the assertions and re-runs the full
   * gate once, so the kernel reads the certified value. Recorded per entry
   * (`repaired`) and in the map, so post-repair is never blended with
   * first-attempt. */
  repair: boolean;
  model?: string;
  limit?: number;
  ids?: readonly string[];
  dispositions?: readonly Disposition[];
  phrasings: boolean;
  repetitions: number;
  /** Where a live run files its artifact. */
  out: string;
  /** Where `--render` writes the page; printed when absent. */
  page?: string;
  /** `--render`'s artifact file, or a directory to take the newest from. */
  source?: string;
  help: boolean;
  errors: readonly string[];
}

export function parseCoverageArgs(argv: readonly string[]): CoverageArgs {
  const args: {
    live: boolean;
    render: boolean;
    weak: boolean;
    dialogues: boolean;
    adversarial: boolean;
    center: boolean;
    grounded: boolean;
    retrieval: boolean;
    gatedGrammar: boolean;
    repair: boolean;
    model?: string;
    limit?: number;
    ids?: string[];
    dispositions?: Disposition[];
    phrasings: boolean;
    repetitions: number;
    out: string;
    page?: string;
    source?: string;
    help: boolean;
    errors: string[];
  } = { live: false, render: false, weak: false, dialogues: false, adversarial: false, center: false, grounded: false, retrieval: false, gatedGrammar: false, repair: false, phrasings: false, repetitions: 1, out: "runs/coverage", help: false, errors: [] };

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--live":
        args.live = true;
        break;
      case "--render":
        args.render = true;
        break;
      case "--weak":
        args.weak = true;
        break;
      case "--dialogues":
        args.dialogues = true;
        break;
      case "--adversarial":
        args.adversarial = true;
        break;
      case "--center":
        args.center = true;
        break;
      case "--grounded":
        args.grounded = true;
        break;
      case "--retrieval":
        args.retrieval = true;
        break;
      case "--gated-grammar":
        args.gatedGrammar = true;
        break;
      case "--repair":
        args.repair = true;
        break;
      case "--phrasings":
        args.phrasings = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--model":
        if (value === undefined) args.errors.push("--model needs an OpenRouter slug");
        else args.model = value;
        index++;
        break;
      case "--limit": {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) args.errors.push(`--limit needs a positive integer, got ${value}`);
        else args.limit = count;
        index++;
        break;
      }
      case "--repetitions": {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) args.errors.push(`--repetitions needs a positive integer, got ${value}`);
        else args.repetitions = count;
        index++;
        break;
      }
      case "--ids":
        if (value === undefined) args.errors.push("--ids needs a comma-separated list of bank entry ids");
        else args.ids = value.split(",").map((id) => id.trim()).filter((id) => id !== "");
        index++;
        break;
      case "--dispositions": {
        if (value === undefined) {
          args.errors.push("--dispositions needs a comma-separated list");
          index++;
          break;
        }
        const wanted = value.split(",").map((d) => d.trim()).filter((d) => d !== "");
        const unknown = wanted.filter((d) => !(DISPOSITIONS as readonly string[]).includes(d));
        if (unknown.length > 0) {
          args.errors.push(`unknown disposition(s): ${unknown.join(", ")} — the bank speaks ${DISPOSITIONS.join(", ")}`);
        } else {
          args.dispositions = wanted as Disposition[];
        }
        index++;
        break;
      }
      case "--out":
        if (value === undefined) args.errors.push("--out needs a directory");
        else args.out = value;
        index++;
        break;
      case "--page":
        if (value === undefined) args.errors.push("--page needs a path");
        else args.page = value;
        index++;
        break;
      default:
        if (flag === undefined || flag.startsWith("-")) args.errors.push(`unknown argument: ${flag}`);
        else if (args.source === undefined) args.source = flag;
        else args.errors.push(`unexpected extra argument: ${flag}`);
    }
  }

  if (args.live && args.render) args.errors.push("--live and --render are different modes; pick one");
  if (args.phrasings && args.repetitions > 1) {
    args.errors.push("--repetitions applies to the coverage run; a robustness pass already runs each phrasing once");
  }
  if (args.dialogues && args.phrasings) {
    args.errors.push("--dialogues and --phrasings are different banks; pick one");
  }
  if (args.adversarial && !args.dialogues) {
    args.errors.push("--adversarial is a dialogue bank; add --dialogues");
  }
  if (args.center && (args.dialogues || args.phrasings)) {
    args.errors.push("--center runs the single-turn Center bank; the dialogue and robustness banks are the red-blue world's");
  }
  if (args.dialogues && args.dispositions !== undefined) {
    args.errors.push("--dispositions filters single-turn questions; a dialogue's disposition is per turn, not per conversation");
  }
  // --dialogues --repetitions is allowed since epic #94 slice 5: a
  // deterministic script is not a deterministic model (§21/§22), and the
  // cross-turn zero deserves the same band the single-turn one has.
  if (args.grounded && args.phrasings) {
    args.errors.push("--grounded is not threaded through the robustness pass; run it on the coverage or dialogue banks");
  }
  if (args.retrieval && args.phrasings) {
    args.errors.push("--retrieval is not threaded through the robustness pass; run it on the coverage or dialogue banks");
  }
  if (args.repair && args.phrasings) {
    args.errors.push("--repair is not threaded through the robustness pass; run it on the coverage or dialogue banks");
  }
  if (args.grounded && args.retrieval) {
    args.errors.push("--grounded (whole registry) and --retrieval (only what each question needs) are different grounding modes; pick one");
  }
  if (!args.render && args.source !== undefined) {
    args.errors.push(`an artifact path only makes sense with --render, got: ${args.source}`);
  }
  if (!args.render && args.page !== undefined) args.errors.push("--page only makes sense with --render");

  return {
    live: args.live,
    render: args.render,
    weak: args.weak,
    dialogues: args.dialogues,
    adversarial: args.adversarial,
    center: args.center,
    grounded: args.grounded,
    retrieval: args.retrieval,
    gatedGrammar: args.gatedGrammar,
    repair: args.repair,
    phrasings: args.phrasings,
    repetitions: args.repetitions,
    out: args.out,
    help: args.help,
    errors: args.errors,
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.ids === undefined ? {} : { ids: args.ids }),
    ...(args.dispositions === undefined ? {} : { dispositions: args.dispositions }),
    ...(args.page === undefined ? {} : { page: args.page }),
    ...(args.source === undefined ? {} : { source: args.source }),
  };
}

const USAGE = [
  "The playability coverage run. --live calls OpenRouter and costs money; everything else is free.",
  "",
  "  npm run coverage:map                                  # dry run: prints the plan, calls nothing",
  "  npm run coverage:map -- --live                        # the full bank, one pass, filed to runs/coverage/",
  "  npm run coverage:map -- --live --dispositions should-refuse --repetitions 3",
  "  npm run coverage:map -- --live --weak --limit 20",
  "  npm run coverage:map -- --live --phrasings            # the robustness leg, over entries with paraphrases",
  "  npm run coverage:map -- --dialogues                   # dry run of the multi-turn dialogue bank",
  "  npm run coverage:map -- --live --dialogues            # the dialogue bank, filed as a dialogue artifact",
  "  npm run coverage:map -- --render                      # re-render the newest filed coverage artifact",
  "  npm run coverage:map -- --render --dialogues          # re-render the newest filed dialogue artifact",
  "  npm run coverage:map -- --render runs/<file>.json --page docs/coverage.md",
  "",
  "  --live              actually call the provider and file the artifact. Nothing is billed without it.",
  "  --center            the Center world: kanto-center + pokemon-center-v1 + the migrated realistic bank",
  "  --adversarial       with --dialogues: the adversarial bank — the trainer's own channel attacking",
  "                      scope and the gate; wrong-scope commits and attack reach are reported",
  "  --dialogues         run the multi-turn dialogue bank: per-turn coverage plus each conversation's",
  "                      ceremony cost (prompts-to-answer over a whole task). Filed as a dialogue artifact.",
  "  --grounded          hand the proposer the *whole* certified registry to compose from (a lever on the",
  "                      value errors a model makes recalling). Enforcement is unchanged; the flag is recorded.",
  "  --retrieval         ground with only the rows each question needs, not the whole registry — grounding's",
  "                      usefulness at a fraction of the tokens. Recorded in the artifact; not with --grounded.",
  "  --gated-grammar     narrow the answer schema to the claim kinds each question nominates (the shape-",
  "                      deflection fix). Composes with any grounding mode; recorded in the artifact.",
  "  --repair            strip-assertion resubmit: on an all-IA-2 fact-mismatch denial, strip the asserted",
  "                      values and run the full gate once more (docs/recovery.md). Counted apart, recorded.",
  "  --render [PATH]     render a filed coverage artifact (a file, or a directory to take the newest",
  "                      coverage artifact from; default runs/coverage/). Reads no clock, no key, no network.",
  "  --page PATH         with --render, write the page there instead of printing it.",
  "  --model SLUG        the OpenRouter slug (default: the harness's strong model; --weak for the weak one).",
  "  --repetitions N     passes over the selected entries (default 1). Pass-major, and an enforcement",
  "                      escalation stops the run before the next pass is paid for.",
  "  --dispositions a,b  run only entries with these dispositions (e.g. should-refuse).",
  "  --ids a,b           run exactly these entries, in the order named.",
  "  --limit N           first N of the selection — the fail-fast probe.",
  "  --phrasings         robustness mode: every frozen paraphrase of each entry that carries them.",
  "  --out DIR           where a live run files its artifact (default: runs/coverage/ — kept apart from",
  "                      the harness's runs/, whose consumers assume every file there is a run record).",
  "",
  "The key is read from OPENROUTER_API_KEY, in the environment or in .env.",
].join("\n");

// --- the run ----------------------------------------------------------------

export interface CoverageFs {
  readDir: (directory: string) => readonly string[];
  readFile: (path: string) => string;
  writeFile: (path: string, contents: string) => void;
}

const diskFs: CoverageFs = {
  readDir: (directory) => readdirSync(directory),
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
};

export interface CoverageOptions {
  argv: readonly string[];
  env: Env;
  /** The caller's clock — when the run started. This module reads none. */
  now: string;
  /** A fresh, strictly increasing per-entry clock, injected so ids and digests
   * never collide between questions and a test can pin them. */
  clock: () => () => string;
  /** Injected so the live path is exercised without a network or a key. */
  makeProvider?: (config: { model: string; apiKey: string }) => ModelProvider;
  /** The per-pass runner, injected because the one outcome the early-stop
   * exists for — an enforcement escalation — is unreachable through the real
   * spine while the kernel works, and the stop must be tested anyway. */
  runPass?: typeof runBank;
  write?: WriteFile;
  fs?: CoverageFs;
}

export interface CoverageResult {
  lines: readonly string[];
  exitCode: number;
  artifactPath?: string;
}

function renderMode(args: CoverageArgs, fs: CoverageFs): CoverageResult {
  const source = args.source ?? "runs/coverage";
  const kind = args.dialogues ? "dialogue" : "coverage";
  const path = source.endsWith(".json")
    ? source
    : args.dialogues
      ? latestDialogueArtifact(source, fs.readDir)
      : latestCoverageArtifact(source, fs.readDir);
  if (path === undefined) {
    return { lines: [`no ${kind} artifact found in ${source}; run --live first, or pass a path`], exitCode: 1 };
  }

  let page: string;
  try {
    const parsed = JSON.parse(fs.readFile(path)) as CoverageArtifact | DialogueArtifact;
    page = args.dialogues ? renderDialogueArtifact(parsed as DialogueArtifact) : renderCoverageArtifact(parsed as CoverageArtifact);
  } catch (error) {
    return { lines: [`could not read a ${kind} artifact from ${path}: ${(error as Error).message}`], exitCode: 1 };
  }

  if (args.page === undefined) return { lines: [page.replace(/\n$/, "")], exitCode: 0 };
  fs.writeFile(args.page, page);
  return { lines: [`${kind} page written to ${args.page}`, `  from ${path}`], exitCode: 0 };
}

/**
 * The multi-turn dialogue run — the same three modes as the single-turn path,
 * over the dialogue bank. Dry by default; `--live` bills the key and files a
 * `dialogue` artifact whose map carries both the per-turn coverage and each
 * conversation's ceremony cost.
 */
async function runDialogueMode(args: CoverageArgs, options: CoverageOptions, model: string): Promise<CoverageResult> {
  const bank = readDialogues(args.adversarial ? ADVERSARIAL_BANK_PATH : undefined);
  let all = bank.dialogues;
  if (args.ids !== undefined) {
    const byId = new Map(all.map((entry) => [entry.id, entry]));
    all = args.ids.map((id) => byId.get(id)).filter((entry): entry is (typeof bank.dialogues)[number] => entry !== undefined);
  }
  const entries = args.limit === undefined ? all : all.slice(0, args.limit);

  if (!args.live) {
    const turns = entries.reduce((sum, entry) => sum + entry.turns.length, 0);
    return {
      lines: [
        "Playability dialogue coverage — DRY RUN (nothing billed).",
        `  bank:          ${bank.id} (${bank.dialogues.length} conversations)`,
        `  running:       ${entries.length} conversation(s), ${turns} turn(s) in total` +
          (args.repetitions > 1 ? `, x${args.repetitions} repetitions` : ""),
        `  grounding:     ${args.retrieval ? "retrieval — only the facts each question needs" : args.grounded ? "full — the whole certified registry" : "none — the model answers from its own knowledge"}`,
        `  gated grammar: ${args.gatedGrammar ? "yes — the answer schema narrows to the kinds each question nominates" : "no — every claim kind is offered"}`,
        `  repair:        ${args.repair ? "yes — an all-fact-mismatch denial is stripped and re-verified once" : "no — a mis-recalled value stays a denial"}`,
        `  model:         ${model}`,
        `  artifact:      filed under ${args.out}/`,
        `  add --live to run it against the model and bill your key.`,
      ],
      exitCode: 0,
    };
  }

  const apiKey = (options.env.OPENROUTER_API_KEY ?? "").trim();
  if (apiKey === "") {
    return {
      lines: ["no OPENROUTER_API_KEY in the environment or .env — a live dialogue run needs a real model"],
      exitCode: 2,
    };
  }
  const makeProvider =
    options.makeProvider ??
    (({ model: slug, apiKey: key }: { model: string; apiKey: string }): ModelProvider =>
      new OpenRouterProvider({ id: `dialogue:${slug}`, model: slug, apiKey: key, system: HONEST_PERSONA, structured: true }));
  const provider = makeProvider({ model, apiKey });
  const world = args.center ? centerWorld() : demoWorld();

  const runs = await runDialogues(world, entries, provider, options.clock, args.grounded, args.retrieval, args.gatedGrammar, args.repair, args.repetitions);
  const artifact = buildDialogueArtifact({
    startedAt: options.now,
    world,
    bankId: bank.id,
    model: { id: provider.id, slug: model },
    // The dialogue run, like the single-turn one, always offers the answer
    // grammar as a decoding constraint — the measured default (findings §4).
    structuredOutput: true,
    grounded: args.grounded,
    retrieval: args.retrieval,
    gatedGrammar: args.gatedGrammar,
    repair: args.repair,
    repetitions: args.repetitions,
    runs,
  });
  const artifactPath = fileArtifact(artifact, resolve(args.out), options.write);

  return {
    lines: [renderDialogueArtifact(artifact), "", "ARTIFACT", `  ${artifactPath}`],
    // The cross-turn enforcement zero is the gate: a turn that committed gated
    // advice mid-conversation fails the run, exactly as it does single-turn.
    exitCode: artifact.map.map.enforcementEscalations.length > 0 ? 1 : 0,
    artifactPath,
  };
}

export async function runCoverage(options: CoverageOptions): Promise<CoverageResult> {
  const args = parseCoverageArgs(options.argv);
  if (args.help) return { lines: [USAGE], exitCode: 0 };
  if (args.errors.length > 0) return { lines: [...args.errors, "", USAGE], exitCode: 1 };

  if (args.render) return renderMode(args, options.fs ?? diskFs);

  const model = args.model ?? (args.weak ? DEFAULT_WEAK_MODEL : DEFAULT_STRONG_MODEL);
  if (args.dialogues) return runDialogueMode(args, options, model);

  const bank = args.center ? readBank(CENTER_BANK_PATH) : readBank();

  let all = args.phrasings ? bank.entries.filter((entry) => phrasingsOf(entry).length > 1) : bank.entries;
  if (args.dispositions !== undefined) {
    const wanted = args.dispositions;
    all = all.filter((entry) => wanted.includes(entry.disposition));
  }
  if (args.ids !== undefined) {
    const byId = new Map(all.map((entry) => [entry.id, entry]));
    all = args.ids.map((id) => byId.get(id)).filter((entry): entry is (typeof bank.entries)[number] => entry !== undefined);
  }
  const entries = args.limit === undefined ? all : all.slice(0, args.limit);

  if (!args.live) {
    const wordings = entries.reduce((sum, entry) => sum + phrasingsOf(entry).length, 0);
    return {
      lines: [
        `Playability ${args.phrasings ? "robustness" : "coverage"} — DRY RUN (nothing billed).`,
        `  bank:          ${bank.id} (${bank.entries.length} questions)`,
        args.phrasings
          ? `  running:       ${entries.length} entries with paraphrases, ${wordings} wordings in total`
          : `  running:       ${entries.length} questions`,
        `  dispositions:  ${args.dispositions?.join(", ") ?? "all"}`,
        `  repetitions:   ${args.repetitions}`,
        `  grounding:     ${args.retrieval ? "retrieval — only the facts each question needs" : args.grounded ? "full — the whole certified registry" : "none — the model answers from its own knowledge"}`,
        `  gated grammar: ${args.gatedGrammar ? "yes — the answer schema narrows to the kinds each question nominates" : "no — every claim kind is offered"}`,
        `  repair:        ${args.repair ? "yes — an all-fact-mismatch denial is stripped and re-verified once" : "no — a mis-recalled value stays a denial"}`,
        `  model:         ${model}`,
        `  artifact:      filed under ${args.out}/`,
        `  add --live to run it against the model and bill your key.`,
      ],
      exitCode: 0,
    };
  }

  const apiKey = (options.env.OPENROUTER_API_KEY ?? "").trim();
  if (apiKey === "") {
    return {
      lines: ["no OPENROUTER_API_KEY in the environment or .env — a live coverage run needs a real model"],
      exitCode: 2,
    };
  }
  const makeProvider =
    options.makeProvider ??
    (({ model: slug, apiKey: key }: { model: string; apiKey: string }): ModelProvider =>
      new OpenRouterProvider({ id: `coverage:${slug}`, model: slug, apiKey: key, system: HONEST_PERSONA, structured: true }));
  const provider = makeProvider({ model, apiKey });
  const world = args.center ? centerWorld() : demoWorld();

  let runs: RecordedBankRun[] = [];
  let reports: IntentRobustness[] | undefined;
  let stoppedEarly = false;

  if (args.phrasings) {
    reports = [];
    for (const entry of entries) reports.push(await runIntentRobustness(world, entry, provider, options.clock));
    runs = reports.flatMap((report) => report.runs);
  } else {
    const runPass = options.runPass ?? runBank;
    for (let pass = 0; pass < args.repetitions; pass++) {
      const sampled = await runPass(world, entries, provider, options.clock, pass, args.grounded, args.retrieval, args.gatedGrammar, args.repair);
      runs.push(...sampled);
      if (sampled.some((run) => run.score.enforcementEscalation === true)) {
        // The repetition discipline: a broken enforcement zero stops the run
        // before the next pass is paid for.
        stoppedEarly = pass < args.repetitions - 1;
        break;
      }
    }
  }

  const artifact = buildCoverageArtifact({
    label: args.phrasings ? "coverage-robustness" : "coverage",
    startedAt: options.now,
    world,
    bankId: bank.id,
    model: { id: provider.id, slug: model },
    // The coverage run always offers the answer grammar as a decoding
    // constraint — the measured default configuration (findings §4).
    structuredOutput: true,
    grounded: args.grounded,
    retrieval: args.retrieval,
    gatedGrammar: args.gatedGrammar,
    repair: args.repair,
    repetitions: args.repetitions,
    ...(args.dispositions === undefined ? {} : { dispositions: args.dispositions }),
    stoppedEarly,
    runs,
    ...(reports === undefined ? {} : { robustness: reports }),
  });
  const artifactPath = fileArtifact(artifact, resolve(args.out), options.write);

  return {
    lines: [renderCoverageArtifact(artifact), "", "ARTIFACT", `  ${artifactPath}`],
    exitCode: artifact.map.enforcementEscalations.length > 0 ? 1 : 0,
    artifactPath,
  };
}
