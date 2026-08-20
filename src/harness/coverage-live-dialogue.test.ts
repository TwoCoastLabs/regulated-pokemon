/**
 * The dialogue coverage run's whole path — plan, spend, file, render — proven
 * offline: a scripted per-turn model behind the provider seam, the filesystem
 * injected, so the only untested line remains the connecting in coverage-cli.ts.
 * The `--dialogues` mode reuses the single-turn CLI's arg parsing, key handling
 * and render plumbing, so these tests pin the branch that differs: it reads the
 * dialogue bank, files a `dialogue` artifact, and renders the ceremony page.
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { type CoverageFs, type CoverageOptions, parseCoverageArgs, runCoverage } from "./coverage-live.js";
import type { DialogueArtifact } from "./dialogue-artifact.js";
import { DEFAULT_STRONG_MODEL } from "./models.js";
import { ModelProvider, ScriptedProvider } from "./provider.js";

const world = demoWorld();

function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ++tick)).toISOString();
}

function fact(entityId: string, factId: string): string {
  const resolved = world.registry.resolve(entityId, factId);
  if (!resolved.ok) throw new Error(`${entityId}.${factId} did not resolve`);
  return JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId, factId, asserted: resolved.value }] });
}

/** A per-turn model that answers the three facts `dlg-scope-reuse-facts` asks. */
function perTurnFacts(): () => ModelProvider {
  const table: readonly [string, string][] = [
    ["Pikachu", fact("pikachu", "base-speed")],
    ["Machamp", fact("machamp", "base-attack")],
    ["Onix", fact("onix", "base-defense")],
  ];
  return () =>
    new ScriptedProvider("dialogue:scripted", (request) => {
      if (request.purpose !== "answer") return "decline";
      for (const [needle, reply] of table) if (request.prompt.includes(needle)) return reply;
      return "";
    });
}

function options(argv: string[], overrides: Partial<CoverageOptions> = {}): CoverageOptions & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    argv,
    env: { OPENROUTER_API_KEY: "sk-or-test-secret-000" },
    now: "2026-02-01T00:00:00.000Z",
    clock,
    write: (path, contents) => written.set(path, contents),
    written,
    ...overrides,
  };
}

describe("--dialogues arg parsing", () => {
  it("rejects combinations that do not apply to a whole conversation", () => {
    expect(parseCoverageArgs(["--dialogues", "--phrasings"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--dialogues", "--dispositions", "answerable"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--dialogues", "--repetitions", "2"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--dialogues"]).errors).toHaveLength(0);
  });

  it("accepts --grounded on its own and rejects it with --phrasings", () => {
    expect(parseCoverageArgs(["--grounded"]).grounded).toBe(true);
    expect(parseCoverageArgs(["--grounded"]).errors).toHaveLength(0);
    expect(parseCoverageArgs(["--grounded", "--phrasings"]).errors).toHaveLength(1);
  });

  it("accepts --retrieval and rejects it with --grounded or --phrasings", () => {
    expect(parseCoverageArgs(["--retrieval"]).retrieval).toBe(true);
    expect(parseCoverageArgs(["--retrieval"]).errors).toHaveLength(0);
    expect(parseCoverageArgs(["--retrieval", "--grounded"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--retrieval", "--phrasings"]).errors).toHaveLength(1);
  });
});

describe("a dry --dialogues run bills nothing", () => {
  it("prints the plan and writes no artifact", async () => {
    const opts = options(["--dialogues"]);
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);
    expect(opts.written.size).toBe(0);
    expect(result.lines.join("\n")).toContain("DRY RUN");
    expect(result.lines.join("\n")).toContain("conversation(s)");
  });
});

describe("a live --dialogues run files a dialogue artifact and renders from it", () => {
  it("files provenance, whole conversations and the ceremony map", async () => {
    const opts = options(["--live", "--dialogues", "--ids", "dlg-scope-reuse-facts"], { makeProvider: perTurnFacts() });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);

    expect(opts.written.size).toBe(1);
    const [path, bytes] = [...opts.written.entries()][0]!;
    expect(path.endsWith("2026-02-01T00-00-00-000Z-dialogue.json")).toBe(true);
    const artifact = JSON.parse(bytes) as DialogueArtifact;

    expect(artifact.label).toBe("dialogue");
    expect(artifact.grounded).toBe(false); // default; --grounded records true
    expect(artifact.model).toEqual({ id: "dialogue:scripted", slug: DEFAULT_STRONG_MODEL });
    expect(artifact.world.snapshotId).toBe(world.registry.snapshot.id);
    expect(artifact.map.dialogues).toBe(1);
    expect(artifact.map.totalTurns).toBe(3);
    expect(artifact.map.map.enforcementEscalations).toEqual([]);

    // Whole conversations, not summaries: the record behind each turn travels.
    expect(artifact.runs[0]!.turns[0]!.run.transcript.length).toBeGreaterThan(0);
    expect(result.lines.join("\n")).toContain("ARTIFACT");
    expect(bytes).not.toContain("sk-or-test-secret-000");
  });
});

describe("--render --dialogues re-reads the filed artifact", () => {
  function fakeFs(files: Record<string, string>): CoverageFs {
    return {
      readDir: () => Object.keys(files),
      readFile: (path) => {
        const name = path.split("/").at(-1)!;
        const found = files[name] ?? files[path];
        if (found === undefined) throw new Error(`no such file ${path}`);
        return found;
      },
      writeFile: () => undefined,
    };
  }

  it("renders the newest dialogue artifact, ignoring single-turn coverage files", async () => {
    // File one via a live run, then render it back through the fs seam.
    const live = options(["--live", "--dialogues", "--ids", "dlg-scope-reuse-facts"], { makeProvider: perTurnFacts() });
    await runCoverage(live);
    const [path, bytes] = [...live.written.entries()][0]!;
    const name = path.split("/").at(-1)!;
    const fs = fakeFs({ [name]: bytes, "2026-01-01T00-00-00-000Z-coverage.json": "{}" });

    const result = await runCoverage(options(["--render", "--dialogues"], { fs }));
    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).toContain("Dialogue coverage — filed run");
    expect(result.lines.join("\n")).toContain("Ceremony cost");
  });

  it("reports a clean miss when no dialogue artifact is present", async () => {
    const result = await runCoverage(options(["--render", "--dialogues"], { fs: fakeFs({ "x-coverage.json": "{}" }) }));
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("no dialogue artifact");
  });
});
