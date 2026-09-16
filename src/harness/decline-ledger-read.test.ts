/**
 * Reading artifacts into the decline ledger, over a filesystem that is not a
 * disk (epic #170, K1).
 *
 * The whole command runs here — locating artifacts, naming each leg by the
 * levers it recorded, refusing a pack this build does not carry, printing or
 * filing — so the only thing left uncovered is decline-ledger-cli.ts's connection to a
 * terminal. Key-free, and no temporary directory.
 */

import { describe, expect, it } from "vitest";

import type { CoverageArtifact } from "./coverage-artifact.js";
import type { DeclineLedgerFs } from "./decline-ledger-read.js";
import { boundaryLessonFor, carriedBoundaries, coverageArtifactsIn, legName, parseDeclineLedgerArgs, runDeclineLedger } from "./decline-ledger-read.js";

function memFs(files: Record<string, string>): { fs: DeclineLedgerFs; written: Record<string, string> } {
  const written: Record<string, string> = {};
  const fs: DeclineLedgerFs = {
    readDir: (directory) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${directory}/`))
        .map((path) => path.slice(directory.length + 1)),
    readFile: (path) => {
      const found = files[path];
      if (found === undefined) throw new Error(`no such file: ${path}`);
      return found;
    },
    writeFile: (path, contents) => {
      written[path] = contents;
    },
  };
  return { fs, written };
}

const BOUNDARIES = new Map<string, string | undefined>([["indigo-accord-v3", "what-the-records-hold"]]);

function fakeArtifact(overrides: Partial<CoverageArtifact> = {}): CoverageArtifact {
  return {
    schemaVersion: 1,
    label: "coverage",
    startedAt: "2026-09-15T00:00:00.000Z",
    world: { snapshotId: "kanto-red-blue", snapshotDigest: "sha256:x", sourceCommit: "abc", packId: "indigo-accord-v3" },
    bankId: "bank.v1",
    model: { id: "coverage:m", slug: "m" },
    structuredOutput: true,
    grounded: false,
    retrieval: true,
    gatedGrammar: true,
    repair: true,
    repetitions: 3,
    stoppedEarly: false,
    runs: [
      {
        entryId: "data-gym-leader-pewter",
        disposition: "needs-data",
        opening: "Who is the Pewter City gym leader?",
        repetition: 0,
        stage: { kind: "resolved" },
        score: { pass: false, reason: "certified an answer to a question the snapshot cannot ground" },
        turns: 2,
        run: { transaction: { manifest: { claims: [{ kind: "explanation", blockId: "what-is-gym-leader" }], rosters: [] } } },
      },
    ],
    map: { total: 1, pass: 0 },
    ...overrides,
  } as unknown as CoverageArtifact;
}

describe("the command's arguments", () => {
  it("takes artifact paths and an output file", () => {
    expect(parseDeclineLedgerArgs(["a.json", "b.json", "--out", "docs/x.md"])).toEqual({ sources: ["a.json", "b.json"], out: "docs/x.md", help: false, errors: [] });
  });

  it("names an unknown flag rather than ignoring it", () => {
    expect(parseDeclineLedgerArgs(["--nope"]).errors).toEqual(["unknown argument: --nope"]);
    expect(parseDeclineLedgerArgs(["--out"]).errors).toEqual(["--out needs a file path"]);
  });

  it("prints usage on --help and exits clean", () => {
    const result = runDeclineLedger({ argv: ["--help"], fs: memFs({}).fs, boundaries: BOUNDARIES });
    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).toContain("The decline ledger");
  });
});

describe("naming a leg by what it ran with", () => {
  it("reads the legacy prompt as a lever, not as an absence", () => {
    expect(legName(fakeArtifact())).toBe("legacy prompt, N=3");
  });

  it("names every lever the artifact recorded", () => {
    const named = legName(
      fakeArtifact({
        prompt: "blocks",
        refusalFeedback: true,
        offeredDoors: true,
        precedents: { mode: "nearest", store: "s", digest: "sha256:y", k: 3, threshold: 0.25 },
      } as Partial<CoverageArtifact>),
    );
    expect(named).toBe("blocks prompt, refusal fed back, offered doors, precedents nearest, N=3");
  });
});

describe("finding the artifacts", () => {
  it("takes every coverage artifact in a directory, in a stable order", () => {
    const { fs } = memFs({ "runs/coverage/b-coverage.json": "{}", "runs/coverage/a-coverage.json": "{}", "runs/coverage/notes.txt": "x" });
    expect(coverageArtifactsIn("runs/coverage", fs)).toEqual(["runs/coverage/a-coverage.json", "runs/coverage/b-coverage.json"]);
  });

  it("says so when there is nothing to read", () => {
    const result = runDeclineLedger({ argv: [], fs: memFs({}).fs, boundaries: BOUNDARIES });
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toContain("no coverage artifact found");
  });
});

describe("refusing what it cannot classify", () => {
  it("refuses an artifact whose pack this build does not carry, by name", () => {
    const files = { "x.json": JSON.stringify(fakeArtifact({ world: { snapshotId: "s", snapshotDigest: "d", sourceCommit: "c", packId: "some-other-pack" } } as Partial<CoverageArtifact>)) };
    const result = runDeclineLedger({ argv: ["x.json"], fs: memFs(files).fs, boundaries: BOUNDARIES });
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toContain("some-other-pack");
    expect(result.lines[0]).toContain("cannot be classified");
  });

  it("says which file would not parse", () => {
    const result = runDeclineLedger({ argv: ["x.json"], fs: memFs({ "x.json": "{not json" }).fs, boundaries: BOUNDARIES });
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toContain("could not read a coverage artifact from x.json");
  });

  it("tells a pack it carries from one it does not", () => {
    expect(boundaryLessonFor("indigo-accord-v3", BOUNDARIES)).toBe("what-the-records-hold");
    expect(boundaryLessonFor("nope", BOUNDARIES)).toBe("unknown");
  });

  it("carries both of this build's worlds, each with its boundary lesson", () => {
    const carried = carriedBoundaries();
    expect(carried.get("indigo-accord-v3")).toBe("what-the-records-hold");
    expect(carried.size).toBe(2);
  });
});

describe("the ledger it produces", () => {
  it("prints the miss it read, with the layer that owes the fix", () => {
    const result = runDeclineLedger({ argv: ["x.json"], fs: memFs({ "x.json": JSON.stringify(fakeArtifact()) }).fs, boundaries: BOUNDARIES });
    expect(result.exitCode).toBe(0);
    const page = result.lines.join("\n");
    expect(page).toContain("1/1 (100%)");
    expect(page).toContain("topical-lesson");
    expect(page).toContain("grammar");
    expect(page).toContain("data-gym-leader-pewter");
  });

  it("files the page instead of printing it, and says where from", () => {
    const { fs, written } = memFs({ "x.json": JSON.stringify(fakeArtifact()) });
    const result = runDeclineLedger({ argv: ["x.json", "--out", "docs/ledger.md"], fs, boundaries: BOUNDARIES });
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain("docs/ledger.md");
    expect(result.lines[1]).toContain("x.json");
    expect(written["docs/ledger.md"]).toContain("# The decline ledger");
    expect(written["docs/ledger.md"]?.endsWith("\n")).toBe(true);
  });

  it("names the artifact behind every leg, so a filed ledger stays traceable", () => {
    // The same discipline the results page keeps: a number on a page has to
    // lead back to the paid run that produced it, never to a hand edit.
    const { fs, written } = memFs({ "runs/coverage/x-coverage.json": JSON.stringify(fakeArtifact()) });
    runDeclineLedger({ argv: ["--out", "docs/ledger.md"], fs, boundaries: BOUNDARIES });
    expect(written["docs/ledger.md"]).toContain("`runs/coverage/x-coverage.json`");
  });
});
