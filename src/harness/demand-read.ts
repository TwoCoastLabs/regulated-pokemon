/**
 * Reading filed coverage artifacts into the decline ledger (epic #170, K1).
 *
 * The split is the one results.ts keeps: {@link demandLedger} is a pure
 * function of parsed legs, and this file locates artifacts on disk, names each
 * leg by the levers the artifact itself records, and renders. The filesystem
 * is injected, so the whole path runs in a test without a real run or a
 * temporary directory.
 *
 * Key-free and safe in CI in principle — it reads files and no network — but
 * there is nothing to read without a filed run, so it stays a developer
 * command rather than a gate. It never spends money and never reads a key.
 *
 * One thing here fails closed. The classification turns on which pack lesson
 * *is* the records boundary — the lesson that, taught alone, is the honest
 * refusal — so an artifact whose pack this build does not carry is refused by
 * name rather than classified against a guess.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type DemandLeg, demandLedger, renderDemandLedger } from "./demand.js";
import { centerWorld, demoWorld } from "../demo/files.js";
import type { CoverageArtifact } from "./coverage-artifact.js";

export interface DemandFs {
  readFile(path: string): string;
  readDir(path: string): readonly string[];
  writeFile(path: string, contents: string): void;
}

const diskFs: DemandFs = {
  readFile: (path) => readFileSync(path, "utf8"),
  readDir: (path) => readdirSync(path),
  writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
};

/**
 * The records-boundary lesson of the pack an artifact ran under.
 *
 * Resolved by loading the world the pack id names, never by reading the id as
 * a path: the two carried worlds are the only ones whose records this build
 * can classify, and an unknown pack is an error, not a default.
 */
export function boundaryLessonFor(packId: string, worlds: ReadonlyMap<string, string | undefined>): string | undefined | "unknown" {
  return worlds.has(packId) ? worlds.get(packId) : "unknown";
}

/** The packs this build carries, by id, each with its boundary lesson. */
export function carriedBoundaries(): ReadonlyMap<string, string | undefined> {
  const carried = new Map<string, string | undefined>();
  for (const world of [demoWorld(), centerWorld()]) {
    carried.set(world.pack.id, world.pack.recordsBoundary?.lessonId);
  }
  return carried;
}

/**
 * A short name for a leg, built from the levers the artifact records.
 *
 * Nothing is inferred from the filename or the order the legs were given: two
 * legs that ran the same way get the same name, which is what makes a ledger
 * over six artifacts readable without a key to the runs directory.
 */
export function legName(artifact: CoverageArtifact): string {
  const levers: string[] = [artifact.prompt === undefined ? "legacy prompt" : `${artifact.prompt} prompt`];
  if (artifact.refusalFeedback === true) levers.push("refusal fed back");
  if (artifact.offeredDoors === true) levers.push("offered doors");
  if (artifact.precedents !== undefined) levers.push(`precedents ${artifact.precedents.mode}`);
  return `${levers.join(", ")}, N=${artifact.repetitions}`;
}

export interface DemandOptions {
  argv: readonly string[];
  fs?: DemandFs;
  /** The packs to classify against; defaults to the ones this build carries. */
  boundaries?: ReadonlyMap<string, string | undefined>;
}

export interface DemandResult {
  lines: readonly string[];
  exitCode: number;
}

const USAGE = [
  "npm run demand -- [artifact.json ...] [--out <file>]",
  "",
  "  The decline ledger (epic #170, K1): every sample on a question that must not",
  "  receive a certified answer, what the record certified when it answered anyway,",
  "  and the layer that owes the fix. Reads filed runs; recomputes nothing.",
  "",
  "  With no artifact given, reads every coverage artifact in runs/coverage.",
  "  --out <file>   write the ledger as Markdown instead of printing it",
].join("\n");

interface DemandArgs {
  sources: readonly string[];
  out: string | undefined;
  help: boolean;
  errors: readonly string[];
}

export function parseDemandArgs(argv: readonly string[]): DemandArgs {
  const sources: string[] = [];
  const errors: string[] = [];
  let out: string | undefined;
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined) errors.push("--out needs a file path");
      else out = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      errors.push(`unknown argument: ${arg}`);
    } else {
      sources.push(arg);
    }
  }
  return { sources, out, help, errors };
}

/** Every coverage artifact in a directory, oldest first — a stable order, so
 * the ledger's leg table is the same bytes on every run. */
export function coverageArtifactsIn(directory: string, fs: DemandFs): readonly string[] {
  return fs
    .readDir(directory)
    .filter((name) => name.endsWith("-coverage.json"))
    .slice()
    .sort()
    .map((name) => join(directory, name));
}

export function runDemand(options: DemandOptions): DemandResult {
  const fs = options.fs ?? diskFs;
  const args = parseDemandArgs(options.argv);
  if (args.help) return { lines: [USAGE], exitCode: 0 };
  if (args.errors.length > 0) return { lines: [...args.errors, "", USAGE], exitCode: 1 };

  const paths = args.sources.length > 0 ? args.sources : coverageArtifactsIn(join("runs", "coverage"), fs);
  if (paths.length === 0) return { lines: ["no coverage artifact found in runs/coverage; pass a path, or file a run first"], exitCode: 1 };

  const boundaries = options.boundaries ?? carriedBoundaries();
  const legs: DemandLeg[] = [];
  for (const path of paths) {
    let artifact: CoverageArtifact;
    try {
      artifact = JSON.parse(fs.readFile(path)) as CoverageArtifact;
    } catch (error) {
      return { lines: [`could not read a coverage artifact from ${path}: ${(error as Error).message}`], exitCode: 1 };
    }
    const boundary = boundaryLessonFor(artifact.world.packId, boundaries);
    if (boundary === "unknown") {
      // Fail closed: without the pack, "a lesson certified in place of a
      // decline" cannot be told from "the decline, taught as a lesson".
      return {
        lines: [`${path} ran under pack ${artifact.world.packId}, which this build does not carry — its records cannot be classified`],
        exitCode: 1,
      };
    }
    legs.push({ leg: legName(artifact), model: artifact.model.slug, runs: artifact.runs, boundaryLessonId: boundary, source: path });
  }

  const page = renderDemandLedger(demandLedger(legs));
  if (args.out === undefined) return { lines: page, exitCode: 0 };
  fs.writeFile(args.out, `${page.join("\n")}\n`);
  return { lines: [`decline ledger written to ${args.out}`, ...paths.map((path) => `  from ${path}`)], exitCode: 0 };
}
