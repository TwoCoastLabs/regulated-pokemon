/**
 * The step trail (issue #158): a projection of the driver's ledger and the
 * kernel's record into one ordered, laned sequence — never a narration.
 * Pinned here: a ledger-sourced trail keeps the ledger's steps and borrows
 * the record's named denials; a record-sourced trail reconstructs every
 * stage in order and says it is reconstructed; every filed run in `runs/`
 * renders without a missing step; and the dev view's model calls attach by
 * time, with the ones the trail cannot place still shown.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import { ScriptedProvider } from "../harness/provider.js";
import type { HarnessArtifact } from "../harness/artifact.js";
import type { HarnessRun } from "../harness/run.js";
import type { Transaction } from "../kernel/transaction.js";
import type { ModelCallTrace } from "../session/devtrace.js";
import type { ExchangeLedger } from "../session/ledger.js";
import { say, type SessionDeps, setProfile, startSession } from "../session/session.js";
import { laneLabel, sentBack, toneOf, trailFromLedger, trailFromRecord, trailsOfRun, trailsOfSession, withCalls, type Trail } from "./trail.js";

const AT = "2026-01-01T00:00:00Z";

const seam = {
  snapshotId: "snap-1",
  packId: "pack-1",
  locale: "en-US",
  establishedAt: AT,
  committedAt: AT,
  transcript: [],
  derivation: { bindings: [], contradicted: [], ignored: [], unmatched: [] },
} as const;

const violation = { article: "IA-3", rule: "fabricated-entity", message: "missingno is not in the records", expected: "a certified species", actual: "missingno" } as const;

const denied: Transaction = {
  ...seam,
  id: "txn-denied",
  transcript: [{ kind: "utterance", at: AT, source: "trainer", text: "How strong is Missingno?" }],
  verdicts: [
    { stage: "scope", verdict: { allowed: true, violations: [] } },
    { stage: "answer", verdict: { allowed: false, violations: [violation] } },
  ],
  refused: { transactionId: "txn-denied", claims: [{ kind: "fact", entityId: "missingno", factId: "base-attack", asserted: { kind: "number", value: 1 } }], rosters: [] },
  outcome: { status: "denied", stage: "answer", violations: [violation] },
};

const codes = (trail: Trail) => trail.steps.map((step) => step.code);

describe("tone and lane", () => {
  it("reads refusals by suffix, and names the lanes the console's way", () => {
    expect(toneOf("record/denied")).toBe("refused");
    expect(toneOf("scope/refused")).toBe("refused");
    expect(toneOf("note/error")).toBe("refused");
    expect(toneOf("model/retry-failed")).toBe("refused");
    expect(toneOf("route/withdrawn")).toBe("refused");
    expect(toneOf("memory/followed")).toBe("ok");
    expect(toneOf("memory/empty")).toBe("plain");
    expect(toneOf("memory/departed")).toBe("plain");
    expect(toneOf("model/retry")).toBe("plain");
    expect(toneOf("any/new-thing-denied")).toBe("plain");
    expect(toneOf("record/answered")).toBe("ok");
    expect(toneOf("note/abstention")).toBe("open");
    expect(toneOf("linking/off-ask-dropped")).toBe("plain");
    expect(["trainer", "driver", "kernel", "model"].map((lane) => laneLabel(lane as "trainer"))).toEqual(["trainer", "driver", "kernel", "model"]);
  });
});

describe("a trail from the driver's ledger", () => {
  const ledger: ExchangeLedger = {
    opening: "How strong is Missingno?",
    outcome: "denied",
    transactionId: "txn-denied",
    steps: [
      { at: "t1", lane: "trainer", code: "trainer/said", text: "How strong is Missingno?" },
      { at: "t2", lane: "kernel", code: "scope/granted", text: "scope granted: version=red-blue" },
      { at: "t3", lane: "model", code: "model/answer", text: "1 claim(s), 0 link(s)" },
      { at: "t4", lane: "driver", code: "linking/off-ask-dropped", text: "1 claim(s) dropped", count: 1 },
      { at: "t5", lane: "kernel", code: "record/denied", text: "denied: IA-3/fabricated-entity" },
    ],
  };

  it("keeps every step, its lane and its count, and attaches the record's named denials to the filing step", () => {
    const trail = trailFromLedger(ledger, [denied]);
    expect(trail.source).toBe("ledger");
    expect(trail.opening).toBe("How strong is Missingno?");
    expect(trail.outcome).toBe("denied");
    expect(trail.transactionId).toBe("txn-denied");
    expect(codes(trail)).toEqual(ledger.steps.map((step) => step.code));
    expect(trail.steps.map((step) => step.tone)).toEqual(["plain", "ok", "plain", "plain", "refused"]);
    expect(trail.steps[3]!.count).toBe(1);
    expect(trail.steps[4]!.violations).toEqual([
      { code: "IA-3/fabricated-entity", articleTitle: expect.any(String), analog: expect.any(String), message: violation.message, expected: violation.expected, actual: violation.actual },
    ]);
    expect(trail.steps[0]!.violations).toEqual([]);
  });

  it("carries a step's own lines through, and reads the rounds an exchange sent back from them", () => {
    const retried: ExchangeLedger = {
      opening: "what's a gym badge?",
      outcome: "answered",
      transactionId: "session-1",
      steps: [
        { at: "t1", lane: "trainer", code: "trainer/said", text: "what's a gym badge?" },
        { at: "t2", lane: "model", code: "model/nominated", text: '0 claim(s), 0 link(s), nominated listing — instead of answering, the model asked to use the "listing" door', lines: ["listing(subject=catalogue, n=1)"] },
        { at: "t3", lane: "driver", code: "route/withdrawn", text: 'the "listing" door was refused: a list of one is not a list — the door was withdrawn for one call and the model asked again; nothing about the refusal was sent to it' },
        { at: "t4", lane: "model", code: "model/answer", text: "1 claim(s), 0 link(s) — the reply with the door withdrawn; nothing was fed back" },
        { at: "t5", lane: "kernel", code: "verdict/denied", text: "the kernel denied the draft: IA-3/fabricated-entity — carried back to the model once", lines: ['IA-3/fabricated-entity: "gym-badge" is not certified'] },
        { at: "t6", lane: "model", code: "model/retry", text: "1 claim(s), 0 link(s) — the reply after 1 reason was fed back to the model" },
        { at: "t7", lane: "driver", code: "route/refused", text: 'the "profile" door was refused: "x" is not a species the records certify — the claims beside it stand on their own' },
        { at: "t8", lane: "driver", code: "route/refused-back", text: 'the "listing" door was refused: a list of one is not a list — the door was withdrawn for one call and the refusal was fed back to the model by name', lines: ['driver/refused-route: the "listing" door was refused — a list of one is not a list'] },
        { at: "t9", lane: "kernel", code: "record/answered", text: "answered: 1 claim(s) certified" },
      ],
    };
    const trail = trailFromLedger(retried, []);
    expect(trail.steps[1]!.lines).toEqual(["listing(subject=catalogue, n=1)"]);
    expect(trail.steps[4]!.lines).toEqual(['IA-3/fabricated-entity: "gym-badge" is not certified']);
    expect(trail.steps[4]!.tone).toBe("refused");
    expect(trail.steps[2]!.tone).toBe("refused");
    expect(trail.steps[6]!.tone).toBe("refused");
    expect(trail.steps[7]!.tone).toBe("refused");
    expect(trail.steps[0]!.lines).toEqual([]);
    // Each round says whether the model was told: withdrawn in silence, fed
    // back by name (the kernel's denial, or the driver's refused nomination
    // under the M3 policy), or not re-asked at all.
    expect(sentBack(retried)).toEqual([
      { by: "driver", code: "route/withdrawn", text: retried.steps[2]!.text, mode: "withdrawn", reasons: [] },
      { by: "kernel", code: "verdict/denied", text: retried.steps[4]!.text, mode: "fed-back", reasons: ['IA-3/fabricated-entity: "gym-badge" is not certified'] },
      { by: "driver", code: "route/refused", text: retried.steps[6]!.text, mode: "stood", reasons: [] },
      { by: "driver", code: "route/refused-back", text: retried.steps[7]!.text, mode: "fed-back", reasons: ['driver/refused-route: the "listing" door was refused — a list of one is not a list'] },
    ]);
    expect(sentBack(ledger)).toEqual([]);
  });

  it("attaches nothing when the record is not among those given, or the exchange filed none", () => {
    expect(trailFromLedger(ledger, []).steps[4]!.violations).toEqual([]);
    const passed = trailFromLedger({ opening: "hi", outcome: "passed", steps: [{ at: "t1", lane: "trainer", code: "trainer/said", text: "hi" }] }, [denied]);
    expect(passed).not.toHaveProperty("transactionId");
    expect(passed.steps[0]!.calls).toEqual([]);
  });
});

describe("a trail reconstructed from the record alone", () => {
  it("walks the transcript, the draft, each verdict and the filing, and says it is reconstructed", () => {
    const trail = trailFromRecord(denied);
    expect(trail.source).toBe("record");
    expect(trail.opening).toBe("How strong is Missingno?");
    expect(trail.outcome).toBe("denied");
    expect(codes(trail)).toEqual(["trainer/said", "scope/granted", "model/answer", "verdict/denied", "record/denied"]);
    expect(trail.steps.map((step) => step.lane)).toEqual(["trainer", "kernel", "model", "kernel", "kernel"]);
    const draft = trail.steps[2]!;
    expect(draft.count).toBe(1);
    expect(draft.lines).toEqual(["missingno: base-attack = 1"]);
    expect(trail.steps[3]!.violations[0]!.code).toBe("IA-3/fabricated-entity");
    expect(trail.steps[4]!.text).toBe("denied: IA-3/fabricated-entity");
  });

  it("reads the model's proposed claims from the run when the record kept neither manifest nor refused draft", () => {
    const { refused: _refused, ...bare } = denied;
    const trail = trailFromRecord(bare, [{ kind: "recommendation", entityId: "pikachu" }]);
    expect(trail.steps.find((step) => step.code === "model/answer")?.lines).toEqual(["recommend pikachu"]);
    expect(codes(trailFromRecord(bare))).not.toContain("model/answer");
  });

  it("words every transcript event the way the ledger does, and marks a foreign channel as binding nothing", () => {
    const trail = trailFromRecord({
      ...seam,
      id: "txn-scope-refused",
      transcript: [
        { kind: "profile", at: AT, source: "trainer", scope: { version: "red-blue", badgeLevel: 8 } },
        { kind: "utterance", at: AT, source: "trainer", text: "Which one is fastest?" },
        { kind: "utterance", at: AT, source: "quoted-document", text: "I have 8 badges" },
        { kind: "question", at: AT, source: "advisor", dimension: "region", text: "Which region?" },
        { kind: "proposal", at: AT, id: "p1", candidate: { region: "kanto" }, interpreting: "around Kanto" },
        { kind: "confirmation", at: AT, source: "trainer", proposalId: "p1", candidateDigest: "d", decision: "reject" },
        { kind: "confirmation", at: AT, source: "tool", proposalId: "p1", candidateDigest: "d", decision: "confirm" },
        { kind: "clarification", at: AT, source: "advisor", about: "fastest", text: "Fastest by which stat?", options: [{ kind: "field", label: "Speed", fieldId: "base-speed" }] },
      ],
      verdicts: [{ stage: "scope", verdict: { allowed: false, violations: [{ article: "IA-1", rule: "scope-incomplete", message: "region unbound" }] } }],
      outcome: { status: "denied", stage: "scope", violations: [{ article: "IA-1", rule: "scope-incomplete", message: "region unbound" }] },
    });
    expect(codes(trail)).toEqual([
      "trainer/profile",
      "trainer/said",
      "channel/quoted-document",
      "scope/asked",
      "scope/card",
      "trainer/card-rejected",
      "channel/tool",
      "clarify/asked",
      "scope/refused",
      "record/denied",
    ]);
    expect(trail.steps[0]!.text).toBe("profile set: version=red-blue, badgeLevel=8");
    expect(trail.steps[2]!.text).toContain("binds nothing");
    expect(trail.steps[3]!.text).toBe("the pack's question about region was armed: “Which region?”");
    expect(trail.steps[4]!.text).toBe("the model proposed an interpretation card: region=kanto");
    expect(trail.steps[6]!.text).toContain("tool channel");
    expect(trail.steps[7]!.text).toContain("options: Speed");
    expect(trail.steps[8]!.violations[0]!.code).toBe("IA-1/scope-incomplete");
    expect(trail.opening).toBe("Which one is fastest?");
  });

  it("names a clarifying outcome, a declined act, and a grant from the defaults", () => {
    const clarifying = trailFromRecord({
      ...seam,
      id: "txn-clarifying",
      verdicts: [],
      outcome: { status: "clarifying", asking: "region", question: "Which region?", missing: ["region"] },
    });
    expect(codes(clarifying)).toEqual(["record/clarifying"]);
    expect(clarifying.steps[0]!.text).toBe("clarifying: asking about region");
    expect(clarifying.opening).toBe("");

    const declined = trailFromRecord({
      ...seam,
      id: "txn-declined",
      verdicts: [
        { stage: "scope", verdict: { allowed: true, violations: [] } },
        { stage: "answer", verdict: { allowed: true, violations: [] } },
        { stage: "render", verdict: { allowed: true, violations: [] } },
      ],
      outcome: { status: "declined" },
    });
    expect(codes(declined)).toEqual(["scope/granted", "verdict/allowed", "verdict/allowed", "trainer/consent-declined", "record/declined"]);
    expect(declined.steps[0]!.text).toBe("scope granted: from the defaults");
    expect(declined.steps[2]!.text).toBe("the render stage attested the page");
    expect(declined.steps[4]!.tone).toBe("open");
  });
});

/** Every run artifact filed under runs/, read as the app reads them. */
function filedArtifacts(): readonly { name: string; artifact: HarnessArtifact }[] {
  const dir = join(fileURLToPath(new URL("../../runs/", import.meta.url)));
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, artifact: JSON.parse(readFileSync(join(dir, name), "utf8")) as HarnessArtifact }));
}

describe("every filed run in runs/ renders a trail without a missing step (the issue's gate)", () => {
  const artifacts = filedArtifacts();

  it("finds the filed artifacts", () => {
    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts.flatMap(({ artifact }) => artifact.runs).length).toBeGreaterThan(0);
  });

  it("gives every run at least one trail whose steps cover each stage the kernel ruled on, ending on the filing", () => {
    for (const { name, artifact } of artifacts) {
      for (const run of artifact.runs) {
        const trails = trailsOfRun(run);
        expect(trails.length, `${name} ${run.scenarioId}/${run.providerId}`).toBeGreaterThan(0);
        const transaction = run.transaction;
        if (transaction === undefined) {
          expect(trails[0]!.outcome).toBe("open");
          expect(trails[0]!.steps.at(-1)!.text).toBe(run.detail);
          continue;
        }
        const trail = trails[trails.length - 1]!;
        expect(trail.source).toBe("record");
        expect(trail.transactionId).toBe(transaction.id);
        expect(trail.outcome).toBe(transaction.outcome.status);
        expect(trail.steps.at(-1)!.code).toBe(`record/${transaction.outcome.status}`);
        const rulings = trail.steps.filter((step) => step.lane === "kernel" && step.code !== `record/${transaction.outcome.status}`);
        expect(rulings.length, `${name} ${transaction.id}`).toBe(transaction.verdicts.length);
        const refusedStages = transaction.verdicts.filter((entry) => !entry.verdict.allowed).length;
        expect(rulings.filter((step) => step.tone === "refused").length).toBe(refusedStages);
        // A run that acted shows the consent and the grants it executed.
        if (transaction.outcome.status === "acted") {
          expect(trail.steps.map((step) => step.code)).toContain("trainer/consent-confirmed");
          expect(trail.steps.find((step) => step.code === "act/executed")?.lines.length).toBe(transaction.actionGrants?.length ?? 0);
        }
        // A step is never without its time, and the order never runs backwards.
        for (const step of trail.steps) expect(step.at.length).toBeGreaterThan(0);
        const ats = trail.steps.map((step) => step.at);
        expect([...ats].sort()).toEqual(ats);
        // The step that certified an answer opens onto every claim and roster
        // the manifest carries, each claim with its lines; a denied run has
        // no manifest and no such step.
        const opened = trail.steps.filter((step) => step.manifest !== undefined);
        if (transaction.manifest === undefined) {
          expect(opened).toHaveLength(0);
        } else {
          expect(opened, `${name} ${transaction.id}`).toHaveLength(1);
          expect(opened[0]!.lane).toBe("kernel");
          expect(opened[0]!.manifest!.claims).toHaveLength(transaction.manifest.claims.length);
          expect(opened[0]!.manifest!.rosters).toHaveLength(transaction.manifest.rosters.length);
          expect(opened[0]!.manifest!.claims.every((claim) => claim.lines.length >= 1)).toBe(true);
        }
      }
    }
  });
});

describe("trailsOfRun picks the source", () => {
  const base: HarnessRun = {
    scenarioId: "s",
    providerId: "p",
    repetition: 0,
    status: "unresolved",
    detail: "the provider failed during scope resolution",
    transcript: [{ kind: "utterance", at: AT, source: "trainer", text: "Hello?" }],
    turns: 1,
    providerErrors: 1,
    usage: { promptTokens: 0, completionTokens: 0, calls: 1, costedCalls: 0, costUsd: 0 },
  };

  it("prefers the ledger, falls to the record, and reports an abstention that never reached the seam", () => {
    const ledgered: HarnessRun = { ...base, status: "denied", transaction: denied, exchanges: [{ opening: "Hello?", outcome: "denied", transactionId: "txn-denied", steps: [{ at: AT, lane: "kernel", code: "record/denied", text: "denied" }] }] };
    const [fromLedger] = trailsOfRun(ledgered);
    expect(fromLedger!.source).toBe("ledger");
    expect(fromLedger!.steps[0]!.violations).toHaveLength(1);

    const [fromRecord] = trailsOfRun({ ...base, status: "denied", transaction: denied, exchanges: [] });
    expect(fromRecord!.source).toBe("record");

    const [abstained] = trailsOfRun(base);
    expect(abstained!.outcome).toBe("open");
    expect(abstained!.opening).toBe("Hello?");
    expect(codes(abstained!)).toEqual(["trainer/said", "note/abstention"]);
    expect(abstained!.steps[1]!.text).toBe(base.detail);
    expect(abstained!.steps[1]!.at).toBe(AT);
    expect(trailsOfRun({ ...base, transcript: [] })[0]!.steps[0]!.at).toBe("");
  });
});

describe("a live session's trails", () => {
  const world = harnessWorld();
  const clock = () => {
    let tick = 0;
    return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ++tick)).toISOString();
  };
  const fabricated = JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "missingno", factId: "base-attack", asserted: { kind: "number", value: 1 } }] });

  it("reads the closed exchanges and the open one, with the kernel's named denial on the filing step", async () => {
    const provider = new ScriptedProvider("trail", (request) => (request.purpose === "answer" ? fabricated : "decline"));
    const deps: SessionDeps = { world, provider, now: clock() };
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, deps);
    const open = trailsOfSession(state);
    expect(open).toHaveLength(1);
    expect(open[0]!.outcome).toBe("open");
    expect(open[0]!.source).toBe("ledger");
    // No ask yet: the exchange names itself by the profile it opened with.
    expect(open[0]!.opening).toBe("profile set: version=red-blue, region=kanto, badgeLevel=8");

    state = await say(state, "How strong is Missingno?", deps);
    const trails = trailsOfSession(state);
    expect(trails.map((trail) => trail.outcome)).toEqual(["passed", "denied"]);
    const last = trails[1]!;
    expect(last.opening).toBe("How strong is Missingno?");
    expect(codes(last)[0]).toBe("trainer/said");
    expect(codes(last).at(-1)).toBe("record/denied");
    const filing = last.steps.at(-1)!;
    expect(filing.tone).toBe("refused");
    expect(filing.violations.map((view) => view.code)).toContain("IA-3/fabricated-entity");
    expect(filing.violations[0]!.analog.length).toBeGreaterThan(0);
  });
});

describe("withCalls places the dev view's model calls by time", () => {
  const call = (seq: number, at: string): ModelCallTrace => ({ kind: "model-call", seq, at, purpose: "answer", prompt: "p", latencyMs: 1 });
  const trails: Trail[] = [
    {
      opening: "q",
      outcome: "answered",
      source: "ledger",
      steps: [
        { at: "2026-01-01T00:00:01.000Z", lane: "trainer", code: "trainer/said", text: "q", tone: "plain", lines: [], violations: [], calls: [] },
        { at: "2026-01-01T00:00:05.000Z", lane: "model", code: "model/answer", text: "1 claim(s)", tone: "plain", lines: [], violations: [], calls: [] },
        { at: "2026-01-01T00:00:06.000Z", lane: "kernel", code: "record/answered", text: "answered", tone: "ok", lines: [], violations: [], calls: [] },
      ],
    },
  ];

  it("lands each call under the first step recorded after it began, and returns the rest as unplaced", () => {
    const calls = [call(2, "2026-01-01T00:00:03.000Z"), call(1, "2026-01-01T00:00:02.000Z"), call(3, "2026-01-01T00:00:07.000Z")];
    const placed = withCalls(trails, calls);
    expect(placed.trails[0]!.steps[0]!.calls).toEqual([]);
    expect(placed.trails[0]!.steps[1]!.calls.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(placed.trails[0]!.steps[2]!.calls).toEqual([]);
    expect(placed.unplaced.map((entry) => entry.seq)).toEqual([3]);
    // A step with no call keeps its identity — nothing is rebuilt for nothing.
    expect(placed.trails[0]!.steps[0]).toBe(trails[0]!.steps[0]);
  });

  it("leaves the trails untouched with no calls, and places a call at the very moment of a step under that step", () => {
    expect(withCalls(trails, []).trails[0]!.steps.every((step) => step.calls.length === 0)).toBe(true);
    const exact = withCalls(trails, [call(1, "2026-01-01T00:00:05.000Z")]);
    expect(exact.trails[0]!.steps[1]!.calls).toHaveLength(1);
    expect(exact.unplaced).toEqual([]);
  });
});
