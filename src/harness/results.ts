/**
 * The results page, generated from a filed run artifact and nothing else.
 *
 * A published number has to be traceable to the run that produced it, so this
 * never measures anything: it reads a {@link HarnessArtifact} — the whole
 * record a billable run files — and renders it as Markdown. Hand-transcribing
 * the table is exactly the failure this closes; the page names the artifact it
 * came from and says "do not hand-edit" so that the only way to change a number
 * is to produce a new run.
 *
 * It keeps the split the metrics keep. Enforcement is structural and must read
 * zero; usefulness is empirical and per model; deterministic-gate recall says
 * which trainer wordings the front door routed before any model saw them; cost
 * is money and stays in its own row. Blending any two of them here would undo
 * on the page the discipline the harness holds everywhere else.
 *
 * Pure render plus a thin file step. `renderResultsPage` is a function of the
 * artifact alone; `runResults` locates an artifact on disk and, optionally,
 * files the page — both with their filesystem injected, so the whole path is
 * exercised without a real run, a key or a temporary directory.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRecall, Metrics } from "./metrics.js";
import type { HarnessArtifact } from "./artifact.js";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function money(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function list(items: readonly string[], empty: string): string {
  return items.length === 0 ? empty : items.join(", ");
}

function enforcementSection(metrics: Metrics): string[] {
  const { enforcement } = metrics;
  const denials =
    enforcement.blockedDenials.length === 0
      ? "0"
      : `${enforcement.blockedDenials.length} (${[...new Set(enforcement.blockedDenials)].join(", ")})`;
  return [
    "## Enforcement",
    "",
    "Structural — the same on every model, and a non-zero is a kernel bug, not a metric.",
    "",
    "| answers committed | committed violations | committed wrong-scope | denials the gate fired |",
    "| ---: | ---: | ---: | ---: |",
    `| ${enforcement.answered} | ${enforcement.committedViolations} | ${enforcement.committedWrongScope} | ${denials} |`,
  ];
}

function usefulnessSection(metrics: Metrics): string[] {
  const lines = [
    "## Usefulness",
    "",
    "Empirical, per model, sample-bounded — allowed to differ, and the difference is the point. Never blended with enforcement.",
    "",
    "| model | resolved | abstained | avg turns to answer |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const use of metrics.usefulness) {
    lines.push(
      `| \`${use.providerId}\` | ${use.answered}/${use.runs} (${percent(use.resolutionRate)}) | ` +
        `${use.unresolved}/${use.runs} (${percent(use.abstentionRate)}) | ${use.avgTurnsToAnswer.toFixed(1)} |`,
    );
  }
  return lines;
}

function gateRow(entry: GateRecall): string {
  const routed = entry.resolvedWithoutModel
    ? "— (resolved without the model)"
    : entry.unmatched.length === 0
      ? "**nothing — a silent ceiling**"
      : entry.unmatched.map((wording) => `"${wording}"`).join("; ");
  return (
    `| \`${entry.scenarioId}\` | ${list(entry.boundDirectly, "nothing")} | ` +
    `${list(entry.escalated, "—")} | ${routed} |`
  );
}

function gateSection(metrics: Metrics): string[] {
  return [
    "## Deterministic-gate recall",
    "",
    "Which trainer wordings the closed-vocabulary front door routed before any model saw them. A regex front door that never engages is a silent usefulness ceiling; measured here, not assumed.",
    "",
    "| scenario | bound directly | escalated to the ladder | routed to the model |",
    "| --- | --- | --- | --- |",
    ...metrics.gate.map(gateRow),
  ];
}

function healthAndCostSection(metrics: Metrics): string[] {
  const lines = [
    "## Provider health and cost",
    "",
    "Infrastructure failures are counted apart, never folded into a usefulness rate; cost is priced by the provider, never inferred from a table.",
    "",
    "| model | runs | provider errors | cost | calls | tokens in / out |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const health of metrics.health) {
    const cost = metrics.cost.find((entry) => entry.providerId === health.providerId);
    const usage = cost?.usage;
    const dollars = usage === undefined ? "—" : `${money(usage.costUsd)}${cost?.fullyPriced ? "" : " (floor)"}`;
    const errors = `${health.providerErrors}${health.allFailed ? " — EVERY CALL FAILED" : ""}`;
    lines.push(
      `| \`${health.providerId}\` | ${health.runs} | ${errors} | ${dollars} | ` +
        `${usage?.calls ?? 0} | ${usage?.promptTokens ?? 0} / ${usage?.completionTokens ?? 0} |`,
    );
  }
  return lines;
}

/** Render a filed run as a Markdown results page. A function of the artifact
 * alone: same bytes in, same page out. */
export function renderResultsPage(artifact: HarnessArtifact): string {
  const { world, metrics, verdict } = artifact;
  const models = artifact.models
    .map((model) => `\`${model.id}\` (${model.role}${model.slug === undefined ? "" : ` — \`${model.slug}\``})`)
    .join(", ");

  const header = [
    "# Indigo Accord — harness results",
    "",
    "<!-- Generated from a run artifact; do not hand-edit. Regenerate with `npm run harness:results`. -->",
    "",
    `Generated from a **${artifact.label}** run started \`${artifact.startedAt}\`, ` +
      `${artifact.repetitions} repetition(s)${artifact.stoppedEarly ? " — **stopped early**, the corpus below is smaller than requested" : ""}.`,
    "",
    "## Provenance",
    "",
    `Measured against snapshot \`${world.snapshotId}\` (\`${world.snapshotDigest}\`), derived from upstream commit \`${world.sourceCommit}\`, under Accord pack \`${world.packId}\`. A result against an unnamed world is not a result.`,
    "",
    `**Models:** ${models}`,
    "",
    "**Scenarios:** " + artifact.scenarios.map((scenario) => `\`${scenario.id}\` (${scenario.title})`).join("; ") + ".",
  ];

  const verdictSection = [
    "## Verdict",
    "",
    verdict.ok
      ? "✅ Enforcement held on every model; usefulness varied and was reported per model. The run is what it declared it would be."
      : "❌ The run failed its own self-check:",
    ...(verdict.ok ? [] : ["", ...verdict.failures.map((failure) => `- ${failure}`)]),
  ];

  return (
    [
      ...header,
      "",
      ...enforcementSection(metrics),
      "",
      ...usefulnessSection(metrics),
      "",
      ...gateSection(metrics),
      "",
      ...healthAndCostSection(metrics),
      "",
      ...verdictSection,
    ].join("\n") + "\n"
  );
}

// --- locating an artifact and filing the page -------------------------------

export interface ResultsFs {
  readDir: (directory: string) => readonly string[];
  readFile: (path: string) => string;
  writeFile: (path: string, contents: string) => void;
}

const diskFs: ResultsFs = {
  readDir: (directory) => readdirSync(directory),
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
};

/**
 * The newest artifact in a directory, by filename.
 *
 * Artifact filenames lead with the flattened timestamp, so lexical order is
 * chronological and the last one is the most recent — no clock read here, which
 * keeps this reproducible.
 */
export function latestArtifact(directory: string, fs: ResultsFs): string | undefined {
  const files = fs
    .readDir(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const newest = files.at(-1);
  return newest === undefined ? undefined : join(directory, newest);
}

export interface ResultsArgs {
  /** An explicit artifact path, or a directory to take the newest from. */
  source: string;
  /** Where to write the page; when absent it is printed rather than filed. */
  out?: string;
  help: boolean;
  errors: readonly string[];
}

export function parseResultsArgs(argv: readonly string[]): ResultsArgs {
  const args: { source: string; out?: string; help: boolean; errors: string[] } = {
    source: "runs",
    help: false,
    errors: [],
  };
  let positional: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      args.help = true;
    } else if (flag === "--out") {
      const value = argv[index + 1];
      if (value === undefined) args.errors.push("--out needs a path");
      else args.out = value;
      index++;
    } else if (flag?.startsWith("-")) {
      args.errors.push(`unknown argument: ${flag}`);
    } else if (positional === undefined) {
      positional = flag;
    } else {
      args.errors.push(`unexpected extra argument: ${flag}`);
    }
  }

  if (positional !== undefined) args.source = positional;
  return {
    source: args.source,
    help: args.help,
    errors: args.errors,
    ...(args.out === undefined ? {} : { out: args.out }),
  };
}

const USAGE = [
  "Generate the results page from a filed run artifact. Reads no clock and no network.",
  "",
  "  npm run harness:results                       # newest artifact in runs/, printed",
  "  npm run harness:results -- runs/<file>.json   # a specific artifact",
  "  npm run harness:results -- --out docs/results.md",
  "",
  "  <path>        an artifact file, or a directory to take the newest from (default: runs/).",
  "  --out PATH    write the page there instead of printing it.",
].join("\n");

export interface ResultsOptions {
  argv: readonly string[];
  fs?: ResultsFs;
}

export interface ResultsResult {
  lines: readonly string[];
  exitCode: number;
}

/** Resolve an artifact, render it, and either file or print the page. */
export function runResults(options: ResultsOptions): ResultsResult {
  const fs = options.fs ?? diskFs;
  const args = parseResultsArgs(options.argv);
  if (args.help) return { lines: [USAGE], exitCode: 0 };
  if (args.errors.length > 0) return { lines: [...args.errors, "", USAGE], exitCode: 1 };

  // A path ending .json is an artifact; anything else is a directory to take the
  // newest from. The newest-in-a-directory default is the common case: file a
  // run, then render the run you just filed.
  const path = args.source.endsWith(".json") ? args.source : latestArtifact(args.source, fs);
  if (path === undefined) {
    return { lines: [`no artifact found in ${args.source}; run the live harness first, or pass a path`], exitCode: 1 };
  }

  let artifact: HarnessArtifact;
  try {
    artifact = JSON.parse(fs.readFile(path)) as HarnessArtifact;
  } catch (error) {
    return { lines: [`could not read an artifact from ${path}: ${(error as Error).message}`], exitCode: 1 };
  }

  const page = renderResultsPage(artifact);
  if (args.out === undefined) return { lines: [page.replace(/\n$/, "")], exitCode: 0 };

  fs.writeFile(args.out, page);
  return { lines: [`results page written to ${args.out}`, `  from ${path}`], exitCode: 0 };
}
