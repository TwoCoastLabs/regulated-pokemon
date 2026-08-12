import { describe, expect, it } from "vitest";

import { artifactFilename, buildArtifact, fileArtifact } from "./artifact.js";
import { harnessWorld, models, SCENARIOS } from "./corpus.js";
import { runModels } from "./report.js";

const world = harnessWorld();
const STARTED = "2026-08-06T09:30:00.123Z";

async function artifact() {
  const report = await runModels({ world, models: models(world), scenarios: SCENARIOS });
  return buildArtifact(report, { label: "scripted", startedAt: STARTED, world });
}

describe("buildArtifact", () => {
  it("names the certified world the numbers were measured in", async () => {
    const filed = await artifact();
    expect(filed.world.snapshotId).toBe(world.registry.snapshot.id);
    expect(filed.world.snapshotDigest).toBe(world.registry.document.contentDigest);
    expect(filed.world.sourceCommit).toBe(world.registry.snapshot.sourceCommit);
    expect(filed.world.packId).toBe(world.pack.id);
    expect(filed.schemaVersion).toBe(1);
    expect(filed.startedAt).toBe(STARTED);
  });

  it("records models by role and every run in full, transaction included", async () => {
    const filed = await artifact();
    expect(filed.models.map((model) => model.role)).toEqual(["strong", "weak", "adversarial"]);
    expect(filed.runs).toHaveLength(SCENARIOS.length * 3);

    // Whole records, because a filed run has to be re-verifiable by someone who
    // does not trust the verdict printed next to it.
    const answered = filed.runs.find((run) => run.status === "answered");
    expect(answered?.transaction?.manifest).toBeDefined();
    expect(answered?.transcript.length).toBeGreaterThan(0);
  });

  it("carries the verdict, so a failed run cannot be filed as a passing one", async () => {
    const filed = await artifact();
    expect(filed.verdict).toEqual({ ok: true, failures: [] });
  });

  it("survives a JSON round trip — an artifact nobody can re-read is not a record", async () => {
    const filed = await artifact();
    expect(JSON.parse(JSON.stringify(filed))).toEqual(filed);
  });

  it("carries the raw control arm when it ran, and omits the field when it did not", async () => {
    const withoutRaw = await artifact();
    expect(withoutRaw.raw).toBeUndefined();

    const report = await runModels({ world, models: models(world), scenarios: SCENARIOS, raw: true });
    const withRaw = buildArtifact(report, { label: "scripted", startedAt: STARTED, world });
    expect(withRaw.raw?.runs).toHaveLength(SCENARIOS.length * 3);
    expect(withRaw.raw?.metrics).toHaveLength(3);
    // Whole raw records too: the claims that published travel with the file,
    // so the meter's findings are re-derivable by a reader who distrusts them.
    expect(withRaw.raw?.runs.every((run) => !run.committed || (run.claims?.length ?? 0) > 0)).toBe(true);
  });
});

describe("filing it", () => {
  it("writes pretty JSON to a chronologically sortable path", async () => {
    const written: { path: string; contents: string }[] = [];
    const path = fileArtifact(await artifact(), "/tmp/runs", (target, contents) =>
      written.push({ path: target, contents }),
    );

    expect(path).toBe("/tmp/runs/2026-08-06T09-30-00-123Z-scripted.json");
    expect(written[0]?.contents.endsWith("\n")).toBe(true);
    expect(written[0]?.contents.split("\n").length).toBeGreaterThan(10);
  });

  it("puts the timestamp first so runs sort by when they happened", async () => {
    const filed = await artifact();
    expect(artifactFilename({ ...filed, startedAt: "2026-01-02T03:04:05.000Z", label: "live" })).toBe(
      "2026-01-02T03-04-05-000Z-live.json",
    );
  });

  it("cannot contain a key: nothing in it is derived from one", async () => {
    // The live path builds providers from a key and records only ids and slugs.
    // This asserts the property on the serialised bytes, which is where a
    // secret would actually leak — into a file someone later publishes.
    const text = JSON.stringify(await artifact());
    expect(text).not.toMatch(/sk-or-|Bearer |apiKey|authorization/i);
  });
});
