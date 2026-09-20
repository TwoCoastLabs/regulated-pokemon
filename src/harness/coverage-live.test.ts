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
import { DEFAULT_STRONG_MODEL, RAW_PERSONA } from "./models.js";
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
    expect(artifact.followSuggestion).toBe(false);
    // The profile was set on the panel: no pack question on the record.
    expect(artifact.runs[0]!.run.transcript[0]!.kind).toBe("profile");
    expect(artifact.runs[0]!.clarified).toEqual({ asked: 0, picked: 0, ignored: 0, capped: 0 });
    // The pack's own next steps fill the register even when the model offers none.
    expect(artifact.runs[0]!.suggestions).toMatchObject({ shown: 3, dropped: 0, unanswerable: 0, supplied: 3 });
    expect(artifact.map.clarification).toEqual({ runs: 1, asked: 0, picked: 0, ignored: 0, capped: 0 });
    expect(artifact.map.suggestions).toEqual({ runs: 1, shown: 3, answersWith: 1, dropped: 0, unanswerable: 0, supplied: 3 });
    const page = renderCoverageArtifact(artifact);
    expect(page).toContain("**profile**");
    expect(page).toContain("**feedback**");
    expect(page).toContain("**clarify**");
    expect(page).toContain("**suggest**");
  });
});

describe("the raw arm rides beside the governed leg (docs/generalization.md §11, the governance tax)", () => {
  it("parses --raw, states it in the plan, and refuses it on the banks that do not carry it", () => {
    expect(parseCoverageArgs(["--raw"]).raw).toBe(true);
    expect(parseCoverageArgs(["--raw", "--phrasings"]).errors.join("\n")).toContain("--raw");
    expect(parseCoverageArgs(["--raw", "--dialogues"]).errors.join("\n")).toContain("--raw");
  });

  it("runs the same entries ungoverned after the governed passes, files them whole, and renders the tax from the artifact", async () => {
    const plan = await runCoverage(options(["--ids", "ans-fact-speed-pikachu", "--raw"]));
    expect(plan.lines.join("\n")).toContain("raw arm:       yes");

    const purposes: string[] = [];
    const providers: { system: string | undefined; structured: boolean | undefined }[] = [];
    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu,data-ability-pikachu", "--raw", "--repetitions", "2"], {
      makeProvider: ({ system, structured }) =>
        (providers.push({ system, structured }), new ScriptedProvider("coverage:raw", (request) => {
          purposes.push(request.purpose);
          if (request.purpose === "raw") return request.prompt.includes("Speed") ? pikachuSpeed() : JSON.stringify({ rosters: [], claims: [] });
          return request.purpose === "answer" ? pikachuSpeed() : "decline";
        })),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);
    // The governed leg's provider carries the default persona and the
    // enforced grammar; the raw arm's its own plain persona, told nothing
    // about verification, with the grammar asked for and never enforced.
    expect(providers).toEqual([{ system: undefined, structured: undefined }, { system: RAW_PERSONA, structured: false }]);
    // Two governed passes first, then two raw passes over the same two entries.
    expect(purposes.filter((purpose) => purpose === "raw")).toHaveLength(4);
    const lastGoverned = purposes.lastIndexOf("answer");
    expect(purposes.indexOf("raw")).toBeGreaterThan(lastGoverned);

    const { artifact } = filedArtifact(opts.written);
    expect(artifact.raw?.runs).toHaveLength(4);
    expect(artifact.raw?.structuredOutput).toBe(false);
    expect(artifact.raw?.runs.map((run) => run.repetition).sort()).toEqual([0, 0, 1, 1]);
    expect(artifact.raw?.tax.repetitions).toBe(2);
    const answerable = artifact.raw?.tax.rows.find((row) => row.disposition === "answerable");
    expect(answerable).toMatchObject({ entries: 1, rawApparent: { stable: 1 }, rawVerified: { stable: 1 } });
    const needsData = artifact.raw?.tax.rows.find((row) => row.disposition === "needs-data");
    expect(needsData).toMatchObject({ entries: 1, rawApparent: { stable: 1 } });
    const page = renderCoverageArtifact(artifact);
    expect(page).toContain("**raw**");
    expect(page).toContain("## The governance tax");
    expect(page).toContain("N=2");
  });

  it("files no raw arm and renders no tax when --raw was not paid for", async () => {
    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu"], { makeProvider: scripted(pikachuSpeed()) });
    await runCoverage(opts);
    const { artifact } = filedArtifact(opts.written);
    expect(artifact.raw).toBeUndefined();
    expect(renderCoverageArtifact(artifact)).not.toContain("governance tax");
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

describe("the precedent door rides as a lever (docs/precedent.md)", () => {
  const storeJson = JSON.stringify({
    schemaVersion: 1,
    packId: world.pack.id,
    precedents: [
      {
        id: "p-attack",
        snapshotId: world.registry.snapshot.id,
        ask: "What's Pikachu's Attack stat?",
        shape: { claims: [{ kind: "fact", entityId: "pikachu", factId: "base-attack" }], rosters: [] },
        source: { kind: "bank-run", artifact: "a.json", transactionId: "t", entryId: "ans-fact-attack-pikachu" },
        promoted: { by: "oracle", at: "t" },
      },
    ],
  });
  const memoryFs = (contents: string) => ({ readDir: () => [], readFile: () => contents, writeFile: () => undefined });

  it("parses --prompt legacy|blocks and --refusal-feedback, single-turn only, and refuses the rest by name", () => {
    expect(parseCoverageArgs(["--prompt", "blocks"]).prompt).toBe("blocks");
    expect(parseCoverageArgs(["--prompt", "legacy"]).prompt).toBe("legacy");
    expect(parseCoverageArgs([]).prompt).toBeUndefined();
    expect(parseCoverageArgs(["--prompt", "terse"]).errors[0]).toContain("blocks");
    expect(parseCoverageArgs(["--refusal-feedback"]).refusalFeedback).toBe(true);
    expect(parseCoverageArgs([]).refusalFeedback).toBe(false);
    expect(parseCoverageArgs(["--prompt", "blocks", "--phrasings"]).errors[0]).toContain("single-turn");
    expect(parseCoverageArgs(["--refusal-feedback", "--dialogues"]).errors[0]).toContain("single-turn");
  });

  it("threads the prompt shape and the fed-back refusal to the session, records both, and counts the nomination retry and the prompt tokens per run", async () => {
    // Arm C of docs/answer-prompt.md: the blocks prompt, and a refused
    // nomination carried back by name. A scripted model nominates the
    // listing door first and answers on the retry.
    const plan = await runCoverage(options(["--ids", "ans-fact-speed-pikachu", "--prompt", "blocks", "--refusal-feedback"]));
    const planned = plan.lines.join("\n");
    expect(planned).toContain("prompt:        blocks");
    expect(planned).toContain("refusal:       fed back");

    const prompts: string[] = [];
    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu", "--prompt", "blocks", "--refusal-feedback"], {
      makeProvider: () =>
        new ScriptedProvider("coverage:arm-c", (request) => {
          if (request.purpose !== "answer") return "decline";
          prompts.push(request.prompt);
          return request.prompt.includes("driver/refused-route") || request.hint.doors?.routes.length === 0
            ? pikachuSpeed()
            : JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 1 }] });
        }),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);
    expect(prompts[0]!.startsWith("YOUR TASK\n")).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('driver/refused-route: the "listing" door was refused'))).toBe(true);

    const { artifact } = filedArtifact(opts.written);
    expect(artifact).toMatchObject({ prompt: "blocks", refusalFeedback: true });
    expect(artifact.runs[0]!.nominationRetried).toBe(true);
    expect(artifact.runs[0]!.promptTokens).toBeGreaterThan(0);
    expect(artifact.map.nominationRetried).toEqual(["ans-fact-speed-pikachu"]);
    expect(artifact.map.prompting?.calls).toBe(artifact.runs[0]!.turns);
    const page = renderCoverageArtifact(artifact);
    expect(page).toContain("**prompt: blocks**");
    expect(page).toContain("**refusal fed back**");
    expect(page).toContain("repeated the answer call after a refused nomination");
    expect(page).toContain("Prompt tokens per model call");
    // The default leg records neither lever: the legacy prompt, the door
    // withdrawn in silence — and older artifacts read the same way.
    const plain = options(["--live", "--ids", "ans-fact-speed-pikachu"], { makeProvider: scripted(pikachuSpeed()) });
    await runCoverage(plain);
    const filed = filedArtifact(plain.written).artifact;
    expect(filed.prompt).toBeUndefined();
    expect(filed.refusalFeedback).toBeUndefined();
    expect(renderCoverageArtifact(filed)).not.toContain("**prompt:");
  });

  it("threads --lesson-door to the session, single-turn only, records it, and counts the narrowed catalogue per sample", async () => {
    expect(parseCoverageArgs(["--lesson-door"]).lessonDoor).toBe(true);
    expect(parseCoverageArgs([]).lessonDoor).toBe(false);
    expect(parseCoverageArgs(["--lesson-door", "--dialogues"]).errors[0]).toContain("single-turn");
    const plan = await runCoverage(options(["--ids", "ans-fact-speed-pikachu", "--lesson-door"]));
    expect(plan.lines.join("\n")).toContain("lesson door:   only the lessons the ask is about");

    // "What's Pikachu's Speed stat?" names nothing a lesson explains: the
    // explanation route carries the boundary lesson alone.
    const lessons: (readonly string[] | undefined)[] = [];
    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu", "--lesson-door"], {
      makeProvider: () =>
        new ScriptedProvider("coverage:lesson-door", (request) => {
          if (request.purpose !== "answer") return "decline";
          lessons.push(request.hint.doors?.lessons);
          return pikachuSpeed();
        }),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);
    expect(lessons[0]).toEqual(["what-the-records-hold"]);
    const { artifact } = filedArtifact(opts.written);
    expect(artifact.lessonDoor).toBe(true);
    expect(artifact.runs[0]!.lessonDoor).toEqual({ narrowed: true, offered: 1, withheld: 23 });
    expect(artifact.map.lessonDoor).toEqual({ runs: 1, narrowed: 1, boundaryOnly: 1, offered: 1 });
    expect(renderCoverageArtifact(artifact)).toContain("**lesson door**");
    expect(renderCoverageArtifact(artifact)).toContain("The lesson door: the catalogue narrowed on 1/1");
    // Off: the whole catalogue, nothing recorded, no door declared.
    const plain = options(["--live", "--ids", "ans-fact-speed-pikachu"], { makeProvider: scripted(pikachuSpeed()) });
    await runCoverage(plain);
    const filed = filedArtifact(plain.written).artifact;
    expect(filed.lessonDoor).toBeUndefined();
    expect(filed.runs[0]!.lessonDoor).toBeUndefined();
    expect(filed.map.lessonDoor).toBeUndefined();
  });

  it("offers the door by default, single-turn only, records it, and counts the door's funnel per sample; --no-offered-doors is the off arm", async () => {
    // The default since the door passed its gate (findings §25); the off
    // arm is the lever now, and it is the one the multi-turn banks refuse.
    expect(parseCoverageArgs(["--offered-doors"]).offeredDoors).toBe(true);
    expect(parseCoverageArgs([]).offeredDoors).toBe(true);
    expect(parseCoverageArgs(["--no-offered-doors"]).offeredDoors).toBe(false);
    expect(parseCoverageArgs(["--no-offered-doors", "--dialogues"]).errors[0]).toContain("single-turn");
    const plan = await runCoverage(options(["--ids", "ans-fact-speed-pikachu", "--offered-doors"]));
    expect(plan.lines.join("\n")).toContain("listing door:  offered only when the driver would accept it");

    // "What's Pikachu's Speed stat?" names one thing: the door is withheld,
    // and a model that would have nominated it answers instead.
    const routes: (readonly string[])[] = [];
    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu", "--offered-doors"], {
      makeProvider: () =>
        new ScriptedProvider("coverage:offered", (request) => {
          if (request.purpose !== "answer") return "decline";
          routes.push(request.hint.doors?.routes ?? []);
          return pikachuSpeed();
        }),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);
    expect(routes[0]).toEqual(["profile"]);
    const { artifact } = filedArtifact(opts.written);
    expect(artifact.offeredDoors).toBe(true);
    expect(artifact.runs[0]!.listingDoor).toEqual({ offered: false, nominated: false, served: false });
    expect(artifact.map.listingDoor).toEqual({ runs: 1, offered: 0, nominated: 0, served: 0 });
    expect(renderCoverageArtifact(artifact)).toContain("**offered door**");
    expect(renderCoverageArtifact(artifact)).toContain("The listing door: offered on 0/1");
    // Off: the door is offered on every first call, and the run says so.
    const plain = options(["--live", "--ids", "ans-fact-speed-pikachu", "--no-offered-doors"], { makeProvider: scripted(pikachuSpeed()) });
    await runCoverage(plain);
    const filed = filedArtifact(plain.written).artifact;
    expect(filed.offeredDoors).toBe(false);
    expect(filed.runs[0]!.listingDoor).toEqual({ offered: true, nominated: false, served: false });
  });

  it("parses --precedents nearest|fixed and refuses the rest by name", () => {
    expect(parseCoverageArgs(["--precedents", "nearest"]).precedents).toBe("nearest");
    expect(parseCoverageArgs(["--precedents", "fixed", "--fixed-precedents", "a,b"]).fixedPrecedents).toEqual(["a", "b"]);
    expect(parseCoverageArgs(["--precedents", "sometimes"]).errors[0]).toContain("nearest");
    expect(parseCoverageArgs(["--precedent-store", "x.json"]).errors[0]).toContain("--precedents");
    expect(parseCoverageArgs(["--precedents", "nearest", "--fixed-precedents", "a"]).errors[0]).toContain("fixed");
    expect(parseCoverageArgs(["--precedents", "nearest", "--phrasings"]).errors[0]).toContain("single-turn");
    expect(parseCoverageArgs([]).precedents).toBeUndefined();
  });

  it("states the door in the plan, loads the store fail-closed, pins its digest with the number, and records the reading per run", async () => {
    const plan = await runCoverage(options(["--ids", "ans-fact-speed-pikachu", "--precedents", "nearest"]));
    expect(plan.lines.join("\n")).toContain("precedents:    nearest");

    const opts = options(["--live", "--ids", "ans-fact-speed-pikachu", "--precedents", "nearest", "--precedent-store", "memory.json"], {
      makeProvider: scripted(pikachuSpeed()),
      fs: memoryFs(storeJson),
    });
    const result = await runCoverage(opts);
    expect(result.exitCode).toBe(0);
    const { artifact } = filedArtifact(opts.written);
    expect(artifact.precedents).toMatchObject({ mode: "nearest", store: "memory.json", k: 3, threshold: 0.25 });
    expect(artifact.precedents?.digest).toMatch(/^sha256:/);
    expect(artifact.runs[0]!.precedents).toEqual({ held: ["p-attack"], followed: false });
    expect(renderCoverageArtifact(artifact)).toContain("**precedents: nearest**");

    const broken = options(["--live", "--ids", "ans-fact-speed-pikachu", "--precedents", "fixed", "--precedent-store", "memory.json"], {
      makeProvider: scripted(pikachuSpeed()),
      fs: memoryFs(JSON.stringify({ schemaVersion: 1, packId: "another-pack", precedents: [] })),
    });
    const refused = await runCoverage(broken);
    expect(refused.exitCode).toBe(1);
    expect(refused.lines[0]).toContain("precedent-pack-mismatch");
    expect(broken.written.size).toBe(0);
  });
});
