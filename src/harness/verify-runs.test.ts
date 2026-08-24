/**
 * The replay-verification leg (epic #87, slice 2), in two halves.
 *
 * The sweep: every filed artifact under `runs/` whose pinned world this tree
 * carries is re-executed and its zeros re-derived from the records — the CI
 * gate that makes a published zero independently earned. Skips are counted and
 * named, and the sweep must verify something (lesson 7: a leg that never fired
 * proves nothing).
 *
 * The theater check: the same verifier must *fail* a doctored record. A
 * verification that cannot fail is fail-closed theater, which is the thing the
 * crucible discipline exists to catch — so a filed transaction with a value
 * swapped after the fact has to come back with a named violation.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { REQUIRED_DIMENSIONS } from "../kernel/scope.js";
import { runTransaction } from "../kernel/transaction.js";
import { COMMIT_TIME, ISSUED_AT, LOCALE, trainerTranscript } from "../testing/fixtures.js";
import { locateRuns, verifyArtifact } from "./verify-runs.js";

const RUNS_DIR = resolve(import.meta.dirname, "../../runs");
const world = demoWorld();

/** Every filed artifact, recursively — the evidence base this repo publishes. */
function artifactPaths(dir: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...artifactPaths(path));
    else if (entry.name.endsWith(".json")) paths.push(path);
  }
  return paths.sort();
}

function readArtifact(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("the filed evidence base replays (epic #87, slice 2)", () => {
  const paths = artifactPaths(RUNS_DIR);

  it("re-executes every artifact the tree can reproduce, and every verdict holds", () => {
    let verified = 0;
    let transactions = 0;
    const skipped: string[] = [];
    const failures: string[] = [];
    const incompleteDenials: string[] = [];

    for (const path of paths) {
      const name = relative(RUNS_DIR, path);
      const outcome = verifyArtifact(world, readArtifact(path));
      if (outcome.kind === "skipped") {
        skipped.push(`${name}: ${outcome.reason}`);
        continue;
      }
      verified += 1;
      transactions += outcome.transactions;
      incompleteDenials.push(...outcome.incompleteDenials.map((where) => `${name} at ${where}`));
      for (const failure of outcome.failures) {
        failures.push(`${name} at ${failure.where}: ${failure.violations.map((v) => `${v.article}/${v.rule}`).join(", ")}`);
      }
    }

    // The no-silent-caps rule: what was not verified is stated, in the test
    // output, every run. A skip is expected for artifacts pinned to worlds
    // this tree has moved past; the incomplete-denial class is the known
    // recorder gap slice 2b owes a fix for; a failure never is.
    // eslint-disable-next-line no-console
    console.info(
      `replay leg: ${verified} artifact(s) verified (${transactions} transactions re-executed), ` +
        `${incompleteDenials.length} unreplayable denial record(s) (epic #87 slice 2b), ${skipped.length} skipped:\n  ` +
        (skipped.join("\n  ") || "(none)"),
    );

    expect(failures, `re-derived verdicts disagree with the filed records:\n${failures.join("\n")}`).toEqual([]);
    // Anti-vacuity: a sweep that verified nothing proves nothing. At least the
    // newest filed artifacts must be against the bundled world.
    expect(verified, "no artifact was verifiable against the bundled world — the leg is vacuous").toBeGreaterThan(0);
    expect(transactions).toBeGreaterThan(0);
  });

  it("fails a doctored record — the leg is not fail-closed theater", () => {
    // Find any reproducible artifact carrying a committed numeric fact with a
    // stated value ("asserted" went optional in §17 iteration 5, so not every
    // record has one), swap the value in the record, and the re-execution must
    // disagree by name — the doctored-ledger case IA-10 exists for.
    const hasNumericFact = ({ run }: { run: { transaction?: unknown } }): boolean => {
      const manifest = (run.transaction as { manifest?: { claims: { kind: string; asserted?: { kind: string; value: number } }[] } } | undefined)
        ?.manifest;
      return manifest?.claims.some((claim) => claim.kind === "fact" && claim.asserted?.kind === "number") ?? false;
    };
    const reproducible = paths
      .map((path) => ({ path, artifact: readArtifact(path) }))
      .find(({ artifact }) => verifyArtifact(world, artifact).kind === "verified" && locateRuns(artifact).some(hasNumericFact));
    if (reproducible === undefined) throw new Error("no reproducible artifact with a stated numeric fact to doctor");

    const doctored = JSON.parse(JSON.stringify(reproducible.artifact)) as unknown;
    const run = locateRuns(doctored).find(hasNumericFact)!;
    const claims = (run.run.transaction as unknown as { manifest: { claims: { kind: string; asserted?: { kind: string; value: number } }[] } })
      .manifest.claims;
    const target = claims.find((claim) => claim.kind === "fact" && claim.asserted?.kind === "number")!;
    target.asserted!.value += 100;

    const outcome = verifyArtifact(world, doctored);
    if (outcome.kind !== "verified") throw new Error("doctored artifact unexpectedly skipped");
    expect(outcome.failures.length).toBeGreaterThan(0);
    expect(outcome.failures.some(({ where }) => where === run.where)).toBe(true);
  });

  it("skips an artifact pinned to a world this tree does not carry, by name", () => {
    const foreign = {
      world: { snapshotId: "kanto-red-blue", snapshotDigest: "sha256:0000", packId: world.pack.id },
      runs: [],
    };
    const outcome = verifyArtifact(world, foreign);
    expect(outcome.kind).toBe("skipped");
    if (outcome.kind !== "skipped") throw new Error("unreachable");
    expect(outcome.reason).toContain("pinned to snapshot");
  });

  it("the incomplete-denial tolerance is bounded in time (epic #87, slice 2b)", () => {
    // Today's recorder files the refused draft with every denial; strip it to
    // fake the legacy shape, then file that record in artifacts on both sides
    // of the recorder-fix cutoff. Before: counted and named. After: a recorder
    // regression, failed hard.
    const denied = runTransaction({
      id: "txn-legacy-shape",
      registry: world.registry,
      pack: world.pack,
      transcript: trainerTranscript(),
      establishedAt: ISSUED_AT,
      committedAt: COMMIT_TIME,
      locale: LOCALE,
      required: [...REQUIRED_DIMENSIONS, "comparisonBasis"],
      plan: (_context, transactionId) => ({
        transactionId,
        rosters: [],
        claims: [{ kind: "fact", entityId: "missingno", factId: "base-speed" }],
      }),
    });
    expect(denied.outcome.status).toBe("denied");
    const { refused: _stripped, ...legacyShaped } = denied;

    const document = world.registry.document;
    const artifactAt = (startedAt: string) => ({
      startedAt,
      world: { snapshotId: document.id, snapshotDigest: document.contentDigest, packId: world.pack.id },
      runs: [{ entryId: "legacy", repetition: 0, run: { scenarioId: "legacy", transaction: legacyShaped } }],
    });

    const before = verifyArtifact(world, artifactAt("2026-08-20T00:00:00.000Z"));
    if (before.kind !== "verified") throw new Error("unexpectedly skipped");
    expect(before.failures).toEqual([]);
    expect(before.incompleteDenials).toEqual(["legacy#0"]);

    const after = verifyArtifact(world, artifactAt("2026-08-24T00:00:00.000Z"));
    if (after.kind !== "verified") throw new Error("unexpectedly skipped");
    expect(after.failures.length).toBe(1);
    expect(after.incompleteDenials).toEqual([]);

    // And the unstripped record — what the recorder files now — verifies
    // cleanly on either side of the cutoff.
    const complete = verifyArtifact(world, {
      ...artifactAt("2026-08-24T00:00:00.000Z"),
      runs: [{ entryId: "fixed", repetition: 0, run: { scenarioId: "fixed", transaction: denied } }],
    });
    if (complete.kind !== "verified") throw new Error("unexpectedly skipped");
    expect(complete.failures).toEqual([]);
    expect(complete.incompleteDenials).toEqual([]);
  });

  it("locates runs in all three artifact shapes", () => {
    const dialogue = { runs: [{ dialogueId: "d", turns: [{ run: { a: 1 } }, {}] }] };
    const coverage = { runs: [{ entryId: "q", repetition: 2, run: { a: 1 } }] };
    const live = { runs: [{ scenarioId: "s", repetition: 1, transcript: [] }] };
    expect(locateRuns(dialogue).map((r) => r.where)).toEqual(["d#0"]);
    expect(locateRuns(coverage).map((r) => r.where)).toEqual(["q#2"]);
    expect(locateRuns(live).map((r) => r.where)).toEqual(["s#1"]);
    expect(locateRuns({})).toEqual([]);
  });
});
