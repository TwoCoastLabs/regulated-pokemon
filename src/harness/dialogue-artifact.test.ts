/**
 * The dialogue artifact: a filed run must be a faithful, renderable, key-free
 * record whose map is a function of the conversations it stored. These tests
 * pin the provenance travelling with the number, the render being pure, the
 * newest-artifact reader ignoring single-turn coverage files, and the serialised
 * bytes carrying no secret.
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import {
  buildDialogueArtifact,
  DIALOGUE_LABEL,
  latestDialogueArtifact,
  renderDialogueArtifact,
} from "./dialogue-artifact.js";
import type { RecordedDialogueRun } from "./dialogue-run.js";
import type { HarnessRun } from "./run.js";

const world = demoWorld();

const runs: RecordedDialogueRun[] = [
  {
    repetition: 0,
  dialogueId: "d1",
    turns: [
      {
        turnIndex: 0,
        say: "What's Pikachu's Speed stat?",
        disposition: "answerable",
        stage: { kind: "resolved" },
        score: { pass: true, reason: "answered" },
        turns: 2,
        detail: "answered",
        run: {} as HarnessRun,
      },
    ],
    totalModelCalls: 2,
    resolvedTurns: 1,
    passedTurns: 1,
    enforcementEscalations: [],
    wrongScopeEscalations: [],
    attacks: { turns: 0, reached: 0 },
    providerErrors: 0,
  },
];

function artifact() {
  return buildDialogueArtifact({
    startedAt: "2026-02-01T00:00:00.000Z",
    world,
    bankId: "test-dialogues",
    model: { id: "dialogue:test-slug", slug: "test-slug" },
    structuredOutput: true,
    grounded: false,
    retrieval: false,
    gatedGrammar: false,
    repair: false,
    runs,
  });
}

describe("buildDialogueArtifact files a faithful record", () => {
  it("carries provenance and computes the map from the runs", () => {
    const filed = artifact();
    expect(filed.label).toBe(DIALOGUE_LABEL);
    expect(filed.bankId).toBe("test-dialogues");
    expect(filed.world.snapshotId).toBe(world.registry.snapshot.id);
    expect(filed.world.packId).toBe(world.pack.id);
    expect(filed.map.dialogues).toBe(1);
    expect(filed.map.totalTurns).toBe(1);
    expect(filed.map.map.enforcementEscalations).toEqual([]);
  });

  it("serialises without a secret and re-renders identically", () => {
    const filed = artifact();
    const bytes = JSON.stringify(filed);
    expect(bytes).not.toContain("sk-or-");
    // Pure: the same artifact renders to the same page every time.
    expect(renderDialogueArtifact(filed)).toBe(renderDialogueArtifact(JSON.parse(bytes)));
  });

  it("the rendered page names the world and the ceremony section", () => {
    const page = renderDialogueArtifact(artifact());
    expect(page).toContain("Provenance");
    expect(page).toContain("test-slug");
    expect(page).toContain(world.registry.snapshot.id);
    expect(page).toContain("Ceremony cost");
  });

  it("names the repair mode in the header when it was on", () => {
    const withRepair = { ...artifact(), repair: true };
    expect(renderDialogueArtifact(withRepair)).toContain("**repair**");
    expect(renderDialogueArtifact(artifact())).not.toContain("**repair**");
  });
});

describe("latestDialogueArtifact reads only dialogue files", () => {
  it("picks the newest dialogue artifact and ignores coverage ones", () => {
    const files = [
      "2026-02-01T00-00-00-000Z-coverage.json",
      "2026-02-01T00-00-00-000Z-dialogue.json",
      "2026-03-01T00-00-00-000Z-dialogue.json",
      "2026-04-01T00-00-00-000Z-coverage-robustness.json",
    ];
    const newest = latestDialogueArtifact("runs/coverage", () => files);
    expect(newest).toBe("runs/coverage/2026-03-01T00-00-00-000Z-dialogue.json");
  });

  it("returns undefined when no dialogue artifact is present", () => {
    expect(latestDialogueArtifact("runs/coverage", () => ["x-coverage.json"])).toBeUndefined();
  });
});
