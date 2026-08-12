import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Transaction } from "../kernel/transaction.js";
import type { HarnessArtifact } from "../harness/artifact.js";
import type { HarnessRun } from "../harness/run.js";
import { adaptArtifact, type DomFactory } from "./artifact-dom.js";
import {
  describeClaim,
  enforcementCounters,
  groupRuns,
  modelOf,
  outcomeLine,
  readArtifact,
  scopePins,
  stageViews,
  transcriptLines,
  violationView,
} from "./viewmodel.js";

const AT = "2026-01-01T00:00:00Z";

const emptyUsage = { promptTokens: 0, completionTokens: 0, calls: 0, costedCalls: 0, costUsd: 0 };

/** The seam fields every fixture transaction shares. */
const seam = {
  snapshotId: "snap-1",
  packId: "pack-1",
  locale: "en-US",
  establishedAt: AT,
  committedAt: AT,
  transcript: [],
  derivation: { bindings: [], contradicted: [], ignored: [], unmatched: [] },
} as const;

const answered: Transaction = {
  ...seam,
  id: "txn-answered",
  verdicts: [
    { stage: "scope", verdict: { allowed: true, violations: [] } },
    { stage: "answer", verdict: { allowed: true, violations: [] } },
  ],
  outcome: { status: "answered" },
};

const denied: Transaction = {
  ...seam,
  id: "txn-denied",
  verdicts: [
    { stage: "scope", verdict: { allowed: true, violations: [] } },
    {
      stage: "answer",
      verdict: {
        allowed: false,
        violations: [
          {
            article: "IA-5",
            rule: "restricted-species",
            message: "mewtwo is restricted and this trainer is not accredited for it",
            expected: "badge level 6",
            actual: "badge level 2",
          },
        ],
      },
    },
  ],
  outcome: {
    status: "denied",
    stage: "answer",
    violations: [
      {
        article: "IA-5",
        rule: "restricted-species",
        message: "mewtwo is restricted and this trainer is not accredited for it",
      },
    ],
  },
};

const acted: Transaction = {
  ...seam,
  id: "txn-acted",
  verdicts: [
    { stage: "scope", verdict: { allowed: true, violations: [] } },
    { stage: "answer", verdict: { allowed: true, violations: [] } },
    { stage: "render", verdict: { allowed: true, violations: [] } },
    { stage: "action", verdict: { allowed: true, violations: [] } },
  ],
  actionGrants: [
    {
      transactionId: "txn-acted",
      confirmationEventId: "confirmation-txn-acted",
      tool: "release",
      entityId: "raticate",
      scopeGrantId: "grant-1",
      authorizedAt: AT,
    },
  ],
  outcome: { status: "acted" },
};

const declined: Transaction = {
  ...seam,
  id: "txn-declined",
  verdicts: [
    { stage: "scope", verdict: { allowed: true, violations: [] } },
    { stage: "answer", verdict: { allowed: true, violations: [] } },
  ],
  outcome: { status: "declined" },
};

const clarifying: Transaction = {
  ...seam,
  id: "txn-clarifying",
  verdicts: [],
  outcome: {
    status: "clarifying",
    asking: "version",
    question: "Which version are you playing?",
    missing: ["version"],
  },
};

function fixtureRun(scenarioId: string, status: HarnessRun["status"], transaction?: Transaction): HarnessRun {
  return {
    scenarioId,
    providerId: "scripted:strong",
    repetition: 0,
    status,
    detail: `fixture run that ${status}`,
    transcript: [{ kind: "utterance", at: AT, source: "trainer", text: "hello" }],
    turns: 1,
    providerErrors: 0,
    usage: emptyUsage,
    ...(transaction === undefined ? {} : { transaction }),
  };
}

const fixture: HarnessArtifact = {
  schemaVersion: 1,
  label: "fixture",
  startedAt: AT,
  world: { snapshotId: "snap-1", snapshotDigest: "sha256:feed", sourceCommit: "abc123", packId: "pack-1" },
  repetitions: 1,
  structuredOutput: false,
  grounded: false,
  stoppedEarly: false,
  scenarios: [
    { id: "s1", title: "A scenario that answers" },
    { id: "s2", title: "A scenario that acts" },
  ],
  models: [{ id: "scripted:strong", role: "strong" }],
  runs: [
    fixtureRun("s1", "answered", answered),
    fixtureRun("s1", "denied", denied),
    fixtureRun("s1", "unresolved"),
    fixtureRun("s2", "acted", acted),
    fixtureRun("s2", "unresolved", declined),
    fixtureRun("s2", "unresolved", clarifying),
  ],
  metrics: {
    enforcement: {
      answered: 1,
      acted: 1,
      committedViolations: 0,
      committedWrongScope: 0,
      committedUnauthorizedActions: 0,
      blockedDenials: ["IA-5/restricted-species"],
      blockedByProvider: { "scripted:strong": ["IA-5/restricted-species"] },
      byProvider: {},
    },
    usefulness: [],
    health: [],
    cost: [],
    gate: [],
    adversaries: [],
    pressure: [],
  },
  verdict: { ok: true, failures: [] },
};

describe("readArtifact", () => {
  it("admits a filed artifact, via a JSON round trip", () => {
    const parsed = readArtifact(JSON.parse(JSON.stringify(fixture)));
    expect(parsed.runs).toHaveLength(6);
  });

  it("refuses a value that is not an object", () => {
    expect(() => readArtifact("a string")).toThrow(/not a filed run artifact: not an object/);
  });

  it("refuses a schema this reader does not speak, naming both versions", () => {
    expect(() => readArtifact({ ...fixture, schemaVersion: 2 })).toThrow(/schemaVersion is 2; this reader knows 1/);
  });

  it("refuses a record with no world, no runs, or a malformed run", () => {
    const { world: _world, ...worldless } = fixture;
    expect(() => readArtifact(worldless)).toThrow(/"world" is missing/);
    expect(() => readArtifact({ ...fixture, runs: "nope" })).toThrow(/"runs" is not an array/);
    expect(() => readArtifact({ ...fixture, runs: [{ scenarioId: "s1" }] })).toThrow(/a run has no "providerId"/);
    expect(() =>
      readArtifact({ ...fixture, runs: [{ ...fixture.runs[0], status: "committed" }] }),
    ).toThrow(/a run's status is "committed"/);
  });

  it("refuses a record with no verdict to stand behind", () => {
    expect(() => readArtifact({ ...fixture, verdict: {} })).toThrow(/"verdict.ok" is missing/);
  });
});

describe("groupRuns", () => {
  it("groups by scenario in filed order, losing nothing", () => {
    const groups = groupRuns(fixture);
    expect(groups.map((group) => group.id)).toEqual(["s1", "s2"]);
    expect(groups[0]?.title).toBe("A scenario that answers");
    expect(groups.flatMap((group) => group.runs)).toHaveLength(fixture.runs.length);
  });

  it("finds a model by provider id", () => {
    expect(modelOf(fixture, "scripted:strong")?.role).toBe("strong");
    expect(modelOf(fixture, "scripted:missing")).toBeUndefined();
  });
});

describe("transcriptLines", () => {
  it("keeps the channel the transport assigned on each utterance", () => {
    const lines = transcriptLines([
      { kind: "utterance", at: AT, source: "trainer", text: "I have 8 badges." },
      { kind: "utterance", at: AT, source: "quoted-document", text: "the guide says yellow" },
    ]);
    expect(lines[0]).toMatchObject({ speaker: "trainer", text: "I have 8 badges." });
    expect(lines[1]?.speaker).toBe("quoted-document");
  });

  it("shows a proposal as the Advisor's, with the wording it interprets", () => {
    const [line] = transcriptLines([
      {
        kind: "proposal",
        at: AT,
        id: "p1",
        candidate: { version: "red-blue", comparisonBasis: "base-speed" },
        interpreting: "the classic games",
      },
    ]);
    expect(line).toMatchObject({
      speaker: "advisor",
      text: "Proposes an interpretation: version = red-blue, comparisonBasis = base-speed",
      detail: 'interpreting "the classic games"',
    });
  });

  it("shows both decisions a confirmation can carry", () => {
    const lines = transcriptLines([
      { kind: "confirmation", at: AT, source: "trainer", proposalId: "p1", candidateDigest: "sha256:1", decision: "confirm" },
      { kind: "confirmation", at: AT, source: "trainer", proposalId: "p2", candidateDigest: "sha256:2", decision: "reject" },
    ]);
    expect(lines[0]?.text).toBe("Confirms that interpretation.");
    expect(lines[1]?.text).toBe("Rejects that interpretation.");
  });
});

describe("scopePins", () => {
  it("pins every bound dimension, basis only when bound", () => {
    expect(scopePins({ version: "red-blue", region: "kanto", badgeLevel: 8 })).toEqual([
      { dimension: "version", value: "red-blue" },
      { dimension: "region", value: "kanto" },
      { dimension: "badgeLevel", value: "8" },
    ]);
    expect(
      scopePins({ version: "red-blue", region: "kanto", badgeLevel: 2, comparisonBasis: "base-speed" }),
    ).toContainEqual({ dimension: "comparisonBasis", value: "base-speed" });
  });
});

describe("describeClaim", () => {
  it("states each kind of claim, including the derived-value forms", () => {
    expect(describeClaim({ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } })).toBe(
      "pikachu: base-speed = 90",
    );
    expect(describeClaim({ kind: "fact", entityId: "onix", factId: "types", asserted: { kind: "list", value: ["rock", "ground"] } })).toBe(
      "onix: types = rock, ground",
    );
    expect(describeClaim({ kind: "fact", entityId: "ditto", factId: "legendary", asserted: { kind: "boolean", value: false } })).toBe(
      "ditto: legendary = false",
    );
    expect(describeClaim({ kind: "fact", entityId: "mew", factId: "note", asserted: { kind: "text", value: "mythical" } })).toBe(
      "mew: note = mythical",
    );
    expect(describeClaim({ kind: "fact", entityId: "splash", factId: "power", asserted: { kind: "absent" } })).toBe(
      "splash: power = absent (certified)",
    );
    expect(describeClaim({ kind: "count", rosterId: "poison-types" })).toBe("count(poison-types) — derived by the kernel");
    expect(describeClaim({ kind: "count", rosterId: "poison-types", reported: 33 })).toBe("count(poison-types) = 33");
    expect(describeClaim({ kind: "membership", rosterId: "poison-types", entityId: "grimer", asserted: true })).toBe(
      "grimer ∈ poison-types",
    );
    expect(describeClaim({ kind: "membership", rosterId: "poison-types", entityId: "pikachu", asserted: false })).toBe(
      "pikachu ∉ poison-types",
    );
    expect(describeClaim({ kind: "ranking", rosterId: "kanto", basis: "base-speed", direction: "highest" })).toBe(
      "highest base-speed of kanto — winner derived by the kernel",
    );
    expect(
      describeClaim({ kind: "ranking", rosterId: "kanto", basis: "base-speed", direction: "highest", selectedEntityId: "electrode" }),
    ).toBe("highest base-speed of kanto → electrode");
    expect(describeClaim({ kind: "recommendation", entityId: "snorlax" })).toBe("recommend snorlax");
    expect(describeClaim({ kind: "action", tool: "release", entityId: "raticate" })).toBe("release(raticate)");
  });
});

describe("stageViews and violationView", () => {
  it("carries each stage's ruling in order, denials joined to their article", () => {
    const stages = stageViews(fixture.runs[1] as HarnessRun);
    expect(stages.map((stage) => [stage.stage, stage.allowed])).toEqual([
      ["scope", true],
      ["answer", false],
    ]);
    const [violation] = stages[1]?.violations ?? [];
    expect(violation).toMatchObject({
      code: "IA-5/restricted-species",
      articleTitle: "Restricted Species",
      analog: "Accredited-investor / complex-product gating",
      expected: "badge level 6",
      actual: "badge level 2",
    });
  });

  it("omits expected/actual when the denial carried none", () => {
    const view = violationView({ article: "IA-3", rule: "fabricated-entity", message: "no such species" });
    expect(view.code).toBe("IA-3/fabricated-entity");
    expect("expected" in view).toBe(false);
  });

  it("reports no stages for a run that never reached the seam", () => {
    expect(stageViews(fixture.runs[2] as HarnessRun)).toEqual([]);
  });
});

describe("outcomeLine", () => {
  it("gives each ending its own line and tone", () => {
    expect(outcomeLine(fixture.runs[0] as HarnessRun)).toEqual({ tone: "committed", text: "Certified answer committed." });
    expect(outcomeLine(fixture.runs[1] as HarnessRun)).toEqual({ tone: "refused", text: "Refused at the answer stage." });
    expect(outcomeLine(fixture.runs[3] as HarnessRun)).toEqual({
      tone: "committed",
      text: "Acted: 1 grant executed behind the trainer's confirmation.",
    });
    expect(outcomeLine(fixture.runs[4] as HarnessRun)).toEqual({
      tone: "open",
      text: "The trainer declined the page. The answer stands; nothing executed.",
    });
    expect(outcomeLine(fixture.runs[5] as HarnessRun)).toEqual({
      tone: "open",
      text: "Asking about version: “Which version are you playing?”",
    });
  });

  it("falls back to the run's own detail when no transaction was reached", () => {
    expect(outcomeLine(fixture.runs[2] as HarnessRun)).toEqual({ tone: "open", text: "fixture run that unresolved" });
  });
});

describe("enforcementCounters", () => {
  it("reports the three zeros as zeros, beside what they are over", () => {
    const counters = enforcementCounters(fixture);
    expect(counters.filter((counter) => counter.mustBeZero).map((counter) => counter.value)).toEqual([0, 0, 0]);
    expect(counters[0]).toEqual({ label: "answers committed", value: 1, mustBeZero: false });
  });
});

describe("the filed artifact in runs/", () => {
  const runsDir = fileURLToPath(new URL("../../runs/", import.meta.url));
  const files = readdirSync(runsDir).filter((file) => file.endsWith(".json"));

  const recorder: DomFactory<unknown> = {
    element: (tag, attributes, children) => ({ tag, attributes, children }),
    text: (value) => ({ value }),
  };

  it("is admitted by the reader and projects cleanly, end to end", () => {
    // The published record is the UI's real input, so the whole projection is
    // exercised against it: every page it carries must mount, every
    // transcript must read, every outcome must have a line.
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const artifact = readArtifact(JSON.parse(readFileSync(join(runsDir, file), "utf8")));
      const groups = groupRuns(artifact);
      expect(groups.flatMap((group) => group.runs)).toHaveLength(artifact.runs.length);

      let pages = 0;
      for (const run of artifact.runs) {
        expect(transcriptLines(run.transcript)).toHaveLength(run.transcript.length);
        expect(outcomeLine(run).text.length).toBeGreaterThan(0);
        stageViews(run);
        if (run.transaction?.artifact !== undefined) {
          expect(() => adaptArtifact(run.transaction!.artifact!, recorder)).not.toThrow();
          pages += 1;
        }
      }
      expect(pages).toBeGreaterThan(0);
    }
  });
});
