/**
 * The billable path, exercised without a key, a network or a bill.
 *
 * The provider factory and the file write are injected, so everything up to and
 * including filing the artifact runs in the offline gate — what a real run adds
 * is a real endpoint, and that is the one part a test cannot own.
 */

import { describe, expect, it } from "vitest";

import { models } from "./corpus.js";
import { harnessWorld } from "./corpus.js";
import {
  ADVERSARY_PERSONA,
  DEFAULT_STRONG_MODEL,
  DEFAULT_WEAK_MODEL,
  type Env,
  liveConfig,
  liveModels,
  loadEnv,
  parseArgs,
  parseEnvFile,
  plannedCalls,
  runLive,
} from "./live.js";

const world = harnessWorld();
const KEYED = { OPENROUTER_API_KEY: "sk-or-v1-test" };

/** The scripted corpus standing in for live models, so the billable path can be
 * run end to end. Roles are what `--models` selects on. */
const scripted = () => models(world);

const options = (argv: readonly string[], env: Env = KEYED) => ({
  argv,
  env,
  now: "2026-08-06T09:30:00.000Z",
  makeModels: scripted,
  write: () => {},
});

describe("configuration", () => {
  it("refuses to run without a key, and says where one goes", () => {
    const config = liveConfig({});
    expect(config.ok).toBe(false);
    expect(config.ok === false && config.reason).toContain("OPENROUTER_API_KEY");
  });

  it("treats whitespace as no key at all", () => {
    expect(liveConfig({ OPENROUTER_API_KEY: "   " }).ok).toBe(false);
  });

  it("defaults the slugs and lets the environment override every one", () => {
    const fallback = liveConfig(KEYED);
    expect(fallback.ok === true && fallback.config).toMatchObject({
      strong: DEFAULT_STRONG_MODEL,
      weak: DEFAULT_WEAK_MODEL,
      // The adversary is the capable model by default: a weak attacker failing
      // to fabricate would prove nothing about the gate.
      adversary: DEFAULT_STRONG_MODEL,
    });

    const overridden = liveConfig({ ...KEYED, HARNESS_STRONG_MODEL: "v/strong", HARNESS_WEAK_MODEL: "v/weak" });
    expect(overridden.ok === true && overridden.config).toMatchObject({
      strong: "v/strong",
      weak: "v/weak",
      adversary: "v/strong",
    });
  });

  it("builds three live models, one of which is told to attack", () => {
    const config = liveConfig(KEYED);
    const built = config.ok ? liveModels(config.config) : [];
    expect(built.map((model) => model.role)).toEqual(["strong", "weak", "adversarial"]);
    expect(built.map((model) => model.slug)).toEqual([DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL, DEFAULT_STRONG_MODEL]);
    // No live model declares an expected outcome: its behaviour is the
    // measurement, and asserting one would score it against a guess.
    expect(built.every((model) => model.expect === undefined)).toBe(true);
    expect(ADVERSARY_PERSONA).toContain("NOT the real value");
  });
});

describe("the .env reader", () => {
  it("reads plain, quoted, exported and commented lines", () => {
    const parsed = parseEnvFile(
      ["# a comment", "OPENROUTER_API_KEY=sk-plain", 'HARNESS_WEAK_MODEL="v/quoted"', "export OTHER=exported", "junk"].join(
        "\n",
      ),
    );
    expect(parsed).toEqual({
      OPENROUTER_API_KEY: "sk-plain",
      HARNESS_WEAK_MODEL: "v/quoted",
      OTHER: "exported",
    });
  });

  it("lets the real environment win over a file on disk", () => {
    // A shell export or a CI secret is more specific than a checked-out file.
    const merged = loadEnv({ OPENROUTER_API_KEY: "from-shell" }, "/nonexistent/.env");
    expect(merged.OPENROUTER_API_KEY).toBe("from-shell");
  });

  it("treats a missing .env as normal rather than as an error", () => {
    expect(loadEnv({}, "/nonexistent/.env")).toEqual({});
  });
});

describe("arguments", () => {
  it("is a dry run unless the word --live is said", () => {
    expect(parseArgs([]).live).toBe(false);
    expect(parseArgs(["--live"]).live).toBe(true);
  });

  it("enforces the answer grammar by default, and can be told not to", () => {
    // On by default because it was measured, not assumed: it lifts a weak model
    // and leaves enforcement at zero. The off switch keeps that comparison
    // reproducible rather than folklore.
    expect(parseArgs([]).structured).toBe(true);
    expect(parseArgs(["--no-structured"]).structured).toBe(false);
    expect(parseArgs(["--no-structured", "--structured"]).structured).toBe(true);
  });

  it("reads repetitions, output directory and roles", () => {
    const args = parseArgs(["--live", "--repetitions", "3", "--out", "artifacts", "--models", "strong, weak"]);
    expect(args).toMatchObject({ live: true, repetitions: 3, out: "artifacts", roles: ["strong", "weak"] });
  });

  it("refuses a nonsense repetition count rather than guessing one", () => {
    expect(parseArgs(["--repetitions", "0"]).errors).toHaveLength(1);
    expect(parseArgs(["--repetitions", "many"]).errors).toHaveLength(1);
  });

  it("refuses an unknown flag", () => {
    expect(parseArgs(["--spend-everything"]).errors[0]).toContain("unknown argument");
  });

  it("bounds the calls a plan can make", () => {
    expect(plannedCalls(3, 2, 2)).toBe(48);
  });
});

describe("runLive", () => {
  it("prints the plan and calls nothing by default", async () => {
    const result = await runLive(options([]));
    const text = result.lines.join("\n");
    expect(result.exitCode).toBe(0);
    expect(result.artifactPath).toBeUndefined();
    expect(text).toContain("nothing was called and nothing was billed");
    expect(text).toContain("Run N=1 before paying for N=3.");
    // Cost is never estimated ahead of a run: OpenRouter prices the call.
    expect(text).toContain("unknown until it is spent");
  });

  it("explains itself on --help", async () => {
    expect((await runLive(options(["--help"]))).lines.join("\n")).toContain("costs money");
  });

  it("reports bad arguments and does not run", async () => {
    const result = await runLive(options(["--nope"]));
    expect(result.exitCode).toBe(1);
    expect(result.report).toBeUndefined();
  });

  it("refuses without a key before it can reach the network", async () => {
    const result = await runLive(options([], {}));
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("OPENROUTER_API_KEY");
  });

  it("selects models by role", async () => {
    const result = await runLive(options(["--models", "strong,weak"]));
    expect(result.lines.join("\n")).toContain("scripted:strong");
    expect(result.lines.join("\n")).not.toContain("scripted:adversarial");
  });

  it("refuses a role selection that matches nothing", async () => {
    const result = await runLive(options(["--models", "medium"]));
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("no model matches");
  });

  it("runs and files an artifact when told to spend", async () => {
    const written: { path: string; contents: string }[] = [];
    const result = await runLive({
      ...options(["--live"]),
      write: (path, contents) => written.push({ path, contents }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.artifactPath).toContain("2026-08-06T09-30-00-000Z-live.json");
    expect(result.lines.join("\n")).toContain("ARTIFACT");
    expect(written).toHaveLength(1);

    const filed = JSON.parse(written[0]?.contents ?? "{}") as { label: string; metrics: { adversaries: string[] } };
    expect(filed.label).toBe("live");
    expect(filed.metrics.adversaries).toEqual(["scripted:adversarial"]);
  });
});
