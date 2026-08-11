import { describe, expect, it } from "vitest";

import { buildArtifact, type HarnessArtifact } from "./artifact.js";
import { harnessWorld, models, SCENARIOS } from "./corpus.js";
import { runModels } from "./report.js";
import { parseResultsArgs, renderResultsPage, type ResultsFs, runResults } from "./results.js";

const world = harnessWorld();
const STARTED = "2026-08-06T09:30:00.123Z";

async function artifact(): Promise<HarnessArtifact> {
  const report = await runModels({ world, models: models(world), scenarios: SCENARIOS });
  return buildArtifact(report, { label: "scripted", startedAt: STARTED, world });
}

/** A filesystem that pretends `files` are on disk and captures what is written. */
function memFs(files: Record<string, string>): { fs: ResultsFs; written: Record<string, string> } {
  const written: Record<string, string> = {};
  const fs: ResultsFs = {
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

describe("renderResultsPage — the page is the artifact, nothing added", () => {
  it("names the certified world so a number is never quoted against an unnamed one", async () => {
    const page = renderResultsPage(await artifact());
    expect(page).toContain(`snapshot \`${world.registry.snapshot.id}\``);
    expect(page).toContain(world.registry.document.contentDigest);
    expect(page).toContain(world.registry.snapshot.sourceCommit);
    expect(page).toContain(`pack \`${world.pack.id}\``);
    expect(page).toContain("do not hand-edit");
  });

  it("keeps the split: enforcement zeros, usefulness per model, gate recall, all present and apart", async () => {
    const page = renderResultsPage(await artifact());
    expect(page).toContain("## Enforcement");
    expect(page).toContain("## Usefulness");
    expect(page).toContain("## Deterministic-gate recall");

    // Enforcement reads zero on both counters, whatever committed, and every
    // model has a usefulness row.
    expect(page).toMatch(/\| \d+ \| 0 \| 0 \|/);
    expect(page).toContain("`scripted:strong`");
    expect(page).toContain("`scripted:weak`");

    // Gate recall shows the ladder scenario routing its wording to the model.
    expect(page).toContain("quickest");
    expect(page).toContain("resolved without the model");
  });

  it("renders the pressure section, and the raw control arm only when the artifact carries one", async () => {
    const withoutRaw = renderResultsPage(await artifact());
    expect(withoutRaw).toContain("## Adversarial pressure");
    expect(withoutRaw).toContain("`scripted:adversarial`");
    // Absence of the arm is absence of the section — never a row of zeros
    // implying an arm that ran clean.
    expect(withoutRaw).not.toContain("## Raw control arm");

    const report = await runModels({ world, models: models(world), scenarios: SCENARIOS, raw: true });
    const page = renderResultsPage(buildArtifact(report, { label: "scripted", startedAt: STARTED, world }));
    expect(page).toContain("## Raw control arm");
    expect(page).toContain("`IA-2/fact-mismatch`");
    expect(page).toContain("unasked");
  });

  it("carries the verdict, so a failed run cannot be dressed as a passing page", async () => {
    const clean = renderResultsPage(await artifact());
    expect(clean).toContain("✅");

    const failed = await artifact();
    const page = renderResultsPage({ ...failed, verdict: { ok: false, failures: ["HARNESS FAILED: something."] } });
    expect(page).toContain("❌");
    expect(page).toContain("HARNESS FAILED: something.");
  });

  it("cannot leak a key: it renders only what the artifact carries", async () => {
    expect(renderResultsPage(await artifact())).not.toMatch(/sk-or-|Bearer |apiKey|authorization/i);
  });
});

describe("runResults — locating and filing", () => {
  it("takes the newest artifact in a directory by chronological filename", async () => {
    const filed = JSON.stringify(await artifact());
    const { fs } = memFs({
      "runs/2026-08-05T00-00-00-000Z-live.json": "{}",
      "runs/2026-08-06T09-30-00-123Z-scripted.json": filed,
    });
    const result = runResults({ argv: [], fs });
    expect(result.exitCode).toBe(0);
    // The newer file wins, so the page is the real one, not the empty stub.
    expect(result.lines.join("\n")).toContain("## Enforcement");
  });

  it("writes the page to --out and reports where both ends went", async () => {
    const path = "runs/2026-08-06T09-30-00-123Z-scripted.json";
    const { fs, written } = memFs({ [path]: JSON.stringify(await artifact()) });
    const result = runResults({ argv: ["--out", "docs/results.md"], fs });
    expect(result.exitCode).toBe(0);
    expect(written["docs/results.md"]).toContain("# Indigo Accord — harness results");
    expect(result.lines.join("\n")).toContain("docs/results.md");
  });

  it("reads a specific artifact path when handed one", async () => {
    const path = "archive/some-run.json";
    const { fs } = memFs({ [path]: JSON.stringify(await artifact()) });
    expect(runResults({ argv: [path], fs }).exitCode).toBe(0);
  });

  it("fails cleanly when there is no artifact to render", () => {
    const { fs } = memFs({});
    const result = runResults({ argv: [], fs });
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("no artifact found");
  });

  it("fails cleanly on a file that is not an artifact", () => {
    const { fs } = memFs({ "runs/broken.json": "not json" });
    const result = runResults({ argv: ["runs/broken.json"], fs });
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("could not read an artifact");
  });

  it("prints usage on --help and refuses unknown flags", () => {
    expect(runResults({ argv: ["--help"], fs: memFs({}).fs }).lines.join("\n")).toContain("Generate the results page");
    const bad = runResults({ argv: ["--nope"], fs: memFs({}).fs });
    expect(bad.exitCode).toBe(1);
    expect(bad.lines.join("\n")).toContain("unknown argument");
  });
});

describe("parseResultsArgs", () => {
  it("defaults to the runs directory and printing", () => {
    const args = parseResultsArgs([]);
    expect(args.source).toBe("runs");
    expect(args.out).toBeUndefined();
  });

  it("takes a positional source and an --out target", () => {
    expect(parseResultsArgs(["runs/x.json", "--out", "docs/results.md"])).toMatchObject({
      source: "runs/x.json",
      out: "docs/results.md",
    });
  });
});
