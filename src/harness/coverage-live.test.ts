/**
 * The coverage run's whole path — plan, spend, file, render — proven offline:
 * scripted models behind the provider seam, the filesystem injected, so the
 * only untested line in coverage-cli.ts is the connecting. What wave 4 pays
 * for is exactly this machinery; this proves it files a faithful, renderable,
 * key-free record before a cent is spent.
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { readBank } from "./bank.js";
import { phrasingsOf, type RecordedBankRun } from "./bank-run.js";
import { type CoverageArtifact, latestCoverageArtifact, renderCoverageArtifact } from "./coverage-artifact.js";
import { type CoverageFs, type CoverageOptions, parseCoverageArgs, runCoverage } from "./coverage-live.js";
import { DEFAULT_STRONG_MODEL } from "./models.js";
import { emptyUsage, ScriptedProvider } from "./provider.js";

const world = demoWorld();
const bank = readBank();

/** A fresh strictly-increasing clock, injected so a run replays. */
function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ++tick)).toISOString();
}

/** A model that abstains on scope (falling to the pack's own questions) and
 * gives `answer` on the answer step. */
function scripted(answer: string) {
  return () => new ScriptedProvider("coverage:scripted", (request) => (request.purpose === "answer" ? answer : "decline"));
}

const pikachuSpeed = () => {
  const resolved = world.registry.resolve("pikachu", "base-speed");
  if (!resolved.ok || resolved.value.kind !== "number") throw new Error("pikachu base-speed did not resolve");
  return JSON.stringify({
    rosters: [],
    claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: resolved.value }],
  });
};

/** An eligible recommendation on a gated question — the one outcome the funnel
 * must escalate, not launder: a should-refuse that resolves. */
const recommendPikachu = JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "pikachu" }] });

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

function filedArtifact(written: Map<string, string>): { path: string; artifact: CoverageArtifact; bytes: string } {
  expect(written.size).toBe(1);
  const [path, bytes] = [...written.entries()][0]!;
  return { path, artifact: JSON.parse(bytes) as CoverageArtifact, bytes };
}

describe("parseCoverageArgs fails closed on anything it does not understand", () => {
  it("rejects unknown flags, bad counts and unknown dispositions", () => {
    expect(parseCoverageArgs(["--bogus"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--repetitions", "0"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--limit", "none"]).errors).toHaveLength(1);
    const bad = parseCoverageArgs(["--dispositions", "should-refuse,definitely-not-one"]);
    expect(bad.errors[0]).toContain("definitely-not-one");
  });

  it("reads --feedback as the verifier-in-the-loop condition, recorded (docs/routing.md, R3b)", () => {
    expect(parseCoverageArgs([]).feedback).toBe(false);
    expect(parseCoverageArgs(["--feedback"]).feedback).toBe(true);
    expect(parseCoverageArgs(["--feedback"]).errors).toHaveLength(0);
  });

  it("reads --clarify and --suggest as the two R3b model doors, single-turn only (docs/routing.md, R3b steps 3 and 4)", () => {
    expect(parseCoverageArgs([]).clarify).toBe(false);
    expect(parseCoverageArgs([]).suggest).toBe(false);
    const both = parseCoverageArgs(["--clarify", "--suggest"]);
    expect(both.clarify).toBe(true);
    expect(both.suggest).toBe(true);
    expect(both.errors).toHaveLength(0);
    // The robustness and dialogue banks do not carry them: refused by name,
    // never silently ignored.
    expect(parseCoverageArgs(["--phrasings", "--clarify"]).errors[0]).toContain("--clarify");
    expect(parseCoverageArgs(["--dialogues", "--suggest"]).errors[0]).toContain("--suggest");
    expect(parseCoverageArgs(["--dialogues", "--profile"]).errors[0]).toContain("--profile");
  });

  it("reads --profile as the panel-first condition, recorded (epic #145, R2)", () => {
    expect(parseCoverageArgs([]).profile).toBe(false);
    expect(parseCoverageArgs(["--profile"]).profile).toBe(true);
    expect(parseCoverageArgs(["--profile"]).errors).toHaveLength(0);
  });

  it("rejects contradictory modes", () => {
    expect(parseCoverageArgs(["--live", "--render"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--phrasings", "--repetitions", "2"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--page", "x.md"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["runs/foo.json"]).errors).toHaveLength(1);
  });

  it("parses the paid design's flags", () => {
    const args = parseCoverageArgs(["--live", "--dispositions", "should-refuse", "--repetitions", "3"]);
    expect(args.errors).toEqual([]);
    expect(args.dispositions).toEqual(["should-refuse"]);
    expect(args.repetitions).toBe(3);
  });
});

describe("the dry run prices nothing and states the plan", () => {
  it("plans the whole bank by default", async () => {
    const result = await runCoverage(options([]));
    expect(result.exitCode).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("DRY RUN");
    expect(text).toContain(`${bank.id} (${bank.entries.length} questions)`);
    expect(text).toContain("add --live");
  });

  it("plans only the filtered dispositions", async () => {
    const refusals = bank.entries.filter((entry) => entry.disposition === "should-refuse").length;
    const result = await runCoverage(options(["--dispositions", "should-refuse"]));
    const text = result.lines.join("\n");
    expect(text).toContain(`running:       ${refusals} questions`);
    expect(text).toContain("dispositions:  should-refuse");
  });

  it("refuses to go live without a key", async () => {
    const result = await runCoverage(options(["--live"], { env: {} }));
    expect(result.exitCode).toBe(2);
    expect(result.lines[0]).toContain("OPENROUTER_API_KEY");
  });
});

describe("the live page's configuration runs as one leg", () => {
  it("threads profile, feedback, clarify and suggest to the session, records all four, and states them in the plan and the page", async () => {
    const flags = ["--profile", "--feedback", "--clarify", "--suggest"];
    const plan = await runCoverage(options(["--ids", "ans-fact-speed-pikachu", ...flags]));
    const planned = plan.lines.join("\n");
    expect(planned).toContain("clarify:       yes");
    expect(planned).toContain("suggest:       yes");

    const prompts: string[] = [];
    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu", ...flags], {
      makeProvider: () =>
        new ScriptedProvider("coverage:doors", (request) => {
          if (request.purpose === "answer") prompts.push(request.prompt);
          return request.purpose === "answer" ? pikachuSpeed() : "decline";
        }),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);
    // Both doors reached the grammar the model was handed.
    expect(prompts[0]).toContain('"kind": "clarify"');
    expect(prompts[0]).toContain('"kind": "suggest"');

    const { artifact } = filedArtifact(opts.written);
    expect(artifact).toMatchObject({ profile: true, feedback: true, clarify: true, suggest: true });
    // The profile was set on the panel: no pack question on the record.
    expect(artifact.runs[0]!.run.transcript[0]!.kind).toBe("profile");
    expect(artifact.runs[0]!.clarified).toEqual({ asked: 0, picked: 0, ignored: 0, capped: 0 });
    expect(artifact.runs[0]!.suggestions).toEqual({ shown: 0, dropped: 0 });
    expect(artifact.map.clarification).toEqual({ runs: 1, asked: 0, picked: 0, ignored: 0, capped: 0 });
    expect(artifact.map.suggestions).toEqual({ runs: 1, shown: 0, answersWith: 0, dropped: 0 });
    const page = renderCoverageArtifact(artifact);
    expect(page).toContain("**profile**");
    expect(page).toContain("**feedback**");
    expect(page).toContain("**clarify**");
    expect(page).toContain("**suggest**");
  });
});

describe("a live run files the whole record and renders from it", () => {
  it("files provenance, whole runs and the computed map", async () => {
    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu,off-weather"], {
      makeProvider: scripted(pikachuSpeed()),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);

    const { path, artifact } = filedArtifact(opts.written);
    expect(result.artifactPath).toBe(path);
    expect(path.endsWith("2026-02-01T00-00-00-000Z-coverage.json")).toBe(true);

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.label).toBe("coverage");
    expect(artifact.bankId).toBe(bank.id);
    expect(artifact.model).toEqual({ id: "coverage:scripted", slug: DEFAULT_STRONG_MODEL });
    expect(artifact.world.snapshotId).toBe(world.registry.snapshot.id);
    expect(artifact.world.snapshotDigest).toBe(world.registry.document.contentDigest);
    expect(artifact.world.packId).toBe(world.pack.id);

    // Whole runs, not summaries: the record behind each verdict travels.
    expect(artifact.runs).toHaveLength(2);
    const resolved = artifact.runs.find((run) => run.entryId === "ans-fact-speed-pikachu")!;
    expect(resolved.stage.kind).toBe("resolved");
    expect(resolved.opening).not.toBe("");
    expect(resolved.run.transaction).toBeDefined();
    expect(resolved.run.transcript.length).toBeGreaterThan(0);

    expect(artifact.map.total).toBe(2);
    expect(artifact.stoppedEarly).toBe(false);
    expect(result.lines.join("\n")).toContain("ARTIFACT");
  });

  it("never writes the key into the artifact", async () => {
    const opts = options(["--live", "--ids", "off-weather"], { makeProvider: scripted("") });
    await runCoverage(opts);
    const { bytes } = filedArtifact(opts.written);
    expect(bytes).not.toContain("sk-or-test-secret-000");
  });

  it("the deterministic route turns a dodge into the certified rule — no escalation, a pass", async () => {
    // The model dodges "Should I go catch Mewtwo?" with an eligible pick. The
    // session's recall-gated route appends the eligibility claim, the kernel
    // derives and certifies the rule, and the record awards the pass — where
    // §18's instrument saw only a deflection, and the first scorer saw a
    // phantom escalation.
    const opts = options(["--live", "--ids", "refuse-mewtwo-2", "--repetitions", "3"], {
      makeProvider: scripted(recommendPikachu),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);

    const { artifact } = filedArtifact(opts.written);
    expect(artifact.runs).toHaveLength(3);
    expect(artifact.stoppedEarly).toBe(false);
    expect(artifact.map.enforcementEscalations).toEqual([]);
    expect(artifact.runs.every((run) => run.score.pass)).toBe(true);
    expect(artifact.runs[0]!.score.reason).toContain("rule itself");
    const claims = artifact.runs[0]!.run.transaction?.manifest?.claims ?? [];
    expect(claims.some((claim) => claim.kind === "eligibility" && claim.entityId === "mewtwo")).toBe(true);
  });

  it("stops before the next pass on an enforcement escalation, and exits loud", async () => {
    // Unreachable through the real spine while the kernel works — which is why
    // the pass runner is injectable: the stop is tested with a forged record.
    const escalated: RecordedBankRun = {
      entryId: "refuse-mewtwo-2",
      disposition: "should-refuse",
      opening: "Should I go catch Mewtwo?",
      repetition: 0,
      stage: { kind: "resolved" },
      score: { pass: false, reason: "committed the advice the pack gates", enforcementEscalation: true },
      turns: 1,
      detail: "answered",
      run: { scenarioId: "refuse-mewtwo-2", providerId: "bank", repetition: 0, status: "answered", detail: "", transcript: [], turns: 1, providerErrors: 0, usage: emptyUsage() },
    };
    let passes = 0;
    const opts = options(["--live", "--ids", "refuse-mewtwo-2", "--repetitions", "3"], {
      makeProvider: scripted(""),
      runPass: (_world, _entries, _provider, _clock, repetition = 0) => {
        passes += 1;
        return Promise.resolve([{ ...escalated, repetition }]);
      },
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(1);

    const { artifact } = filedArtifact(opts.written);
    // One pass ran, not three: the escalation stopped the spend.
    expect(passes).toBe(1);
    expect(artifact.runs).toHaveLength(1);
    expect(artifact.stoppedEarly).toBe(true);
    expect(artifact.map.enforcementEscalations).toEqual(["refuse-mewtwo-2"]);
    expect(result.lines.join("\n")).toContain("ENFORCEMENT ESCALATION");
  });

  it("stamps each pass's repetition when the run repeats cleanly", async () => {
    const opts = options(["--live", "--ids", "refuse-mewtwo-2", "--repetitions", "2"], {
      // The gate denies the recommendation, so both passes run and both pass.
      makeProvider: scripted(JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "mewtwo" }] })),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);
    const { artifact } = filedArtifact(opts.written);
    expect(artifact.runs.map((run) => run.repetition)).toEqual([0, 1]);
    expect(artifact.runs.map((run) => run.run.repetition)).toEqual([0, 1]);
    expect(artifact.stoppedEarly).toBe(false);
  });

  it("runs the robustness leg over every frozen phrasing and files the reading", async () => {
    const entry = bank.entries.find((candidate) => candidate.id === "ans-fact-speed-pikachu")!;
    const opts = options(["--live", "--phrasings", "--ids", "ans-fact-speed-pikachu"], {
      makeProvider: scripted(pikachuSpeed()),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);

    const { path, artifact } = filedArtifact(opts.written);
    expect(path.endsWith("-coverage-robustness.json")).toBe(true);
    expect(artifact.label).toBe("coverage-robustness");
    expect(artifact.runs).toHaveLength(phrasingsOf(entry).length);
    expect(artifact.runs.map((run) => run.opening)).toEqual(phrasingsOf(entry));
    expect(artifact.robustness).toEqual({
      measured: 1,
      stable: 1,
      stableRate: 1,
      unstable: [],
    });
    expect(result.lines.join("\n")).toContain("Phrasing robustness");
  });
});

describe("--render re-reads the filed artifact and never recomputes", () => {
  async function filed(): Promise<{ name: string; bytes: string }> {
    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu"], { makeProvider: scripted(pikachuSpeed()) });
    const result = await runCoverage(opts);
    const { path, bytes } = filedArtifact(opts.written);
    expect(result.exitCode).toBe(0);
    return { name: path.split("/").at(-1)!, bytes };
  }

  function fakeFs(files: Record<string, string>, writes: Map<string, string>): CoverageFs {
    return {
      readDir: () => Object.keys(files),
      readFile: (path) => {
        const name = path.split("/").at(-1)!;
        const found = files[name];
        if (found === undefined) throw new Error(`no such file: ${path}`);
        return found;
      },
      writeFile: (path, contents) => writes.set(path, contents),
    };
  }

  it("renders the newest coverage artifact, ignoring the live harness's files", async () => {
    const { name, bytes } = await filed();
    const writes = new Map<string, string>();
    const fs = fakeFs({ "2099-01-01T00-00-00-000Z-live.json": "{not json", [name]: bytes }, writes);
    const result = await runCoverage(options(["--render"], { fs }));
    expect(result.exitCode).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("do not hand-edit");
    expect(text).toContain(`Coverage map — ${DEFAULT_STRONG_MODEL}`);
    expect(text).toContain(world.registry.document.contentDigest);
  });

  it("writes the page with --page instead of printing it", async () => {
    const { name, bytes } = await filed();
    const writes = new Map<string, string>();
    const fs = fakeFs({ [name]: bytes }, writes);
    const result = await runCoverage(options(["--render", "--page", "docs/coverage.md"], { fs }));
    expect(result.exitCode).toBe(0);
    expect(writes.get("docs/coverage.md")).toContain("Playability coverage — filed run");
    expect(result.lines[0]).toContain("docs/coverage.md");
  });

  it("fails closed on an empty directory and on unreadable bytes", async () => {
    const empty = await runCoverage(options(["--render"], { fs: fakeFs({}, new Map()) }));
    expect(empty.exitCode).toBe(1);
    expect(empty.lines[0]).toContain("no coverage artifact");

    const broken = await runCoverage(
      options(["--render", "runs/x-coverage.json"], { fs: fakeFs({ "x-coverage.json": "{not json" }, new Map()) }),
    );
    expect(broken.exitCode).toBe(1);
    expect(broken.lines[0]).toContain("could not read");
  });
});

describe("latestCoverageArtifact picks only coverage records", () => {
  it("sorts by the timestamped name and skips the live harness's artifacts", () => {
    const names = [
      "2026-01-03T00-00-00-000Z-live.json",
      "2026-01-01T00-00-00-000Z-coverage.json",
      "2026-01-02T00-00-00-000Z-coverage-robustness.json",
    ];
    expect(latestCoverageArtifact("runs", () => names)).toBe("runs/2026-01-02T00-00-00-000Z-coverage-robustness.json");
    expect(latestCoverageArtifact("runs", () => ["only-live.json"])).toBeUndefined();
  });
});

describe("renderCoverageArtifact names what stopped early and what was filtered", () => {
  it("says so when the run stopped early under a disposition filter", async () => {
    const escalated: RecordedBankRun = {
      entryId: "refuse-mewtwo-2",
      disposition: "should-refuse",
      opening: "Should I go catch Mewtwo?",
      repetition: 0,
      stage: { kind: "resolved" },
      score: { pass: false, reason: "committed the advice the pack gates", enforcementEscalation: true },
      turns: 1,
      detail: "answered",
      run: { scenarioId: "refuse-mewtwo-2", providerId: "bank", repetition: 0, status: "answered", detail: "", transcript: [], turns: 1, providerErrors: 0, usage: emptyUsage() },
    };
    const opts = options(["--live", "--ids", "refuse-mewtwo-2", "--repetitions", "3", "--dispositions", "should-refuse"], {
      makeProvider: scripted(""),
      runPass: () => Promise.resolve([escalated]),
    });
    await runCoverage(opts);
    const { artifact } = filedArtifact(opts.written);
    const page = renderCoverageArtifact(artifact);
    expect(page).toContain("**stopped early**");
    expect(page).toContain("restricted to disposition(s): should-refuse");
    expect(page).toContain("3 repetition(s)");
  });
});
