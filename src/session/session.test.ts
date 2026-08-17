/**
 * The live session driver, proven offline: scripted models, an injected clock,
 * and the visitor played by the test — so the whole interactive spine is
 * deterministic, key-free and CI-checked, exactly as the harness spine was
 * before real models were put behind it (phase 7a's move, applied again).
 *
 * The one invariant every path here defends: a settled exchange files the
 * seam's own record, and that record replays (IA-10) — a live conversation is
 * not a lesser citizen of the ledger than a harness run.
 */

import { describe, expect, it } from "vitest";

import { harnessWorld } from "../harness/corpus.js";
import { FailingProvider, type ModelProvider, ScriptedProvider } from "../harness/provider.js";
import { verifyReplay } from "../kernel/replay.js";
import {
  decideAct,
  decideScope,
  eligibilityClaims,
  MAX_LADDER_TURNS,
  retry,
  say,
  type SessionDeps,
  startSession,
} from "./session.js";

const world = harnessWorld();

/** Strictly increasing, injected: the kernel orders recorded moments, and a
 * test clock that repeated one would test a lie. */
function clock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ++tick)).toISOString();
}

function deps(provider: ModelProvider): SessionDeps {
  return { world, provider, now: clock() };
}

function factNumber(entityId: string, factId: string): number {
  const resolved = world.registry.resolve(entityId, factId);
  if (!resolved.ok || resolved.value.kind !== "number") throw new Error(`${entityId}.${factId} did not resolve`);
  return resolved.value.value;
}

const PROFILE = "I'm playing Red and Blue, travelling around the Kanto region, and I have 8 badges.";

/** One honest certified fact, resolved from the registry so the fixture cannot
 * drift from the snapshot. */
const thunderboltAnswer = () =>
  JSON.stringify({
    rosters: [],
    claims: [
      {
        kind: "fact",
        entityId: "thunderbolt",
        factId: "move-power",
        asserted: { kind: "number", value: factNumber("thunderbolt", "move-power") },
      },
    ],
  });

const ELECTRIC = { id: "electric-kanto", criteria: { all: [{ kind: "has-type", type: "electric" }] } };

const rankingAnswer = () =>
  JSON.stringify({
    rosters: [ELECTRIC],
    claims: [{ kind: "ranking", rosterId: ELECTRIC.id, basis: "base-speed", direction: "highest" }],
  });

const releaseAnswer = () =>
  JSON.stringify({ rosters: [], claims: [{ kind: "action", tool: "release", entityId: "raticate" }] });

const basisProposal = (basis: string) =>
  JSON.stringify({ candidate: { comparisonBasis: basis }, interpreting: "the quickest" });

function scripted(id: string, script: (purpose: string) => string): ModelProvider {
  return new ScriptedProvider(id, (request) => script(request.purpose));
}

describe("a complete exchange from the visitor's own words", () => {
  const provider = scripted("scripted:honest", (purpose) =>
    purpose === "scope" ? basisProposal("base-speed") : thunderboltAnswer(),
  );

  it("grants scope deterministically, certifies the answer, and files a record that replays", async () => {
    const d = deps(provider);
    const state = await say(startSession(), `${PROFILE} What is Thunderbolt's power?`, d);

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.id).toBe("session-1");
    expect(record.grant?.scope).toMatchObject({ version: "red-blue", region: "kanto", badgeLevel: 8 });
    // The certified page travels beside the record for display.
    expect(state.pages[record.id]).toBeDefined();
    expect(state.phase.kind).toBe("gathering");
    expect(state.notes).toHaveLength(0);
    expect(state.usage.calls).toBe(1);

    // A live exchange is as replayable as a harness run (IA-10).
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("keeps established scope across exchanges: the second ask needs no re-profiling", async () => {
    const d = deps(provider);
    let state = await say(startSession(), `${PROFILE} What is Thunderbolt's power?`, d);
    state = await say(state, "And what is Thunderbolt's power again?", d);

    expect(state.records).toHaveLength(2);
    expect(state.records[1]!.id).toBe("session-2");
    expect(state.records[1]!.outcome.status).toBe("answered");
  });
});

describe("the ladder with a person on the end", () => {
  const provider = scripted("scripted:ladder", (purpose) =>
    purpose === "scope" ? basisProposal("base-speed") : rankingAnswer(),
  );

  it("escalates a ranking with no established basis into the ladder rather than submitting it", async () => {
    const d = deps(provider);
    const state = await say(startSession(), `${PROFILE} Which of the Electric ones is the quickest?`, d);

    // The draft carried a ranking, no basis was established, so nothing was
    // committed: the exchange paused on the model's interpretation instead.
    expect(state.records).toHaveLength(0);
    expect(state.phase.kind).toBe("confirming-scope");
    if (state.phase.kind !== "confirming-scope") throw new Error("unreachable");
    expect(state.phase.proposal.candidate).toEqual({ comparisonBasis: "base-speed" });
    // One answer call (discarded draft) and one scope call.
    expect(state.usage.calls).toBe(2);
  });

  it("commits the answer once the visitor confirms, on a grant that pins the basis — and it replays", async () => {
    const d = deps(provider);
    let state = await say(startSession(), `${PROFILE} Which of the Electric ones is the quickest?`, d);
    state = await decideScope(state, "confirm", d);

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.grant?.scope.comparisonBasis).toBe("base-speed");
    // The escalated requirement is part of the record, or it could not replay.
    expect(record.required).toContain("comparisonBasis");
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("a rejection never binds, and the ladder budget falls to the pack's own question", async () => {
    const d = deps(provider);
    let state = await say(startSession(), `${PROFILE} Which of the Electric ones is the quickest?`, d);
    for (let i = 0; i < MAX_LADDER_TURNS; i++) {
      expect(state.phase.kind).toBe("confirming-scope");
      state = await decideScope(state, "reject", d);
    }

    expect(state.records).toHaveLength(0);
    expect(state.phase.kind).toBe("asking");
    if (state.phase.kind !== "asking") throw new Error("unreachable");
    expect(state.phase.dimension).toBe("comparisonBasis");
    expect(state.phase.question.length).toBeGreaterThan(0);

    // The question is also in the transcript — evidence, and the chat's
    // durable history — so it can still be shown after it has been answered.
    const questions = state.transcript.filter((event) => event.kind === "question");
    expect(questions).toHaveLength(1);
    expect(questions[0]!.text).toBe(state.phase.question);
  });

  it("binds a bare answer to the recorded question — no proposal, no card, and the record replays", async () => {
    // A model whose ranking answer escalates the basis into the requirement,
    // but with nothing usable to propose about scope — so the exchange falls
    // to the pack's own question.
    const muteOnScope = scripted("scripted:mute-scope", (purpose) =>
      purpose === "answer" ? rankingAnswer() : "no JSON here",
    );
    const d = deps(muteOnScope);
    let state = await say(startSession(), `${PROFILE} Which of the Electric ones is the quickest?`, d);

    expect(state.phase.kind).toBe("asking");
    const asked = state.transcript.filter((event) => event.kind === "question");
    expect(asked).toHaveLength(1);

    // The visitor answers with one bare word — no context word in sight, so
    // the direct route cannot bind it. The recorded question is the context,
    // so it binds all the same — the ladder is never climbed and no
    // confirmation card interrupts.
    state = await say(state, "speed", d);

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    const basis = record.grant?.bindings.find((binding) => binding.dimension === "comparisonBasis");
    expect(basis?.route).toBe("answer");
    expect(record.transcript.filter((event) => event.kind === "proposal")).toHaveLength(0);
    expect(verifyReplay(world, record).allowed).toBe(true);

    // The answered question is still in the transcript, exactly once — the
    // conversation reads whole.
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(1);
  });

  it("a catalogue opener is three questions and zero cards — not an interrogation", async () => {
    // The conversation that exposed the rabbit hole, scripted: a question the
    // vocabulary cannot read, then three plain answers. Each answer must bind
    // against the recorded question — no proposal, no confirmation card, and
    // no model call — until the profile is complete and the answer compiles.
    const typesAnswer = JSON.stringify({
      rosters: [
        { id: "electric-kanto", criteria: { all: [{ kind: "has-type", type: "electric" }] } },
        { id: "psychic-kanto", criteria: { all: [{ kind: "has-type", type: "psychic" }] } },
      ],
      claims: [
        { kind: "count", rosterId: "electric-kanto" },
        { kind: "count", rosterId: "psychic-kanto" },
      ],
    });
    const provider = scripted("scripted:catalogue", (purpose) => (purpose === "answer" ? typesAnswer : "no JSON"));
    const d = deps(provider);

    let state = await say(startSession(), "what types of pokemons do you have?", d);
    expect(state.phase.kind).toBe("asking");
    const callsAfterOpener = state.usage.calls;

    state = await say(state, "Red", d);
    expect(state.phase.kind).toBe("asking");
    state = await say(state, "Kanto", d);
    expect(state.phase.kind).toBe("asking");
    // Answering the pack's own questions consulted no model at all.
    expect(state.usage.calls).toBe(callsAfterOpener);

    state = await say(state, "two badges", d);
    expect(state.records).toHaveLength(1);
    expect(state.records[0]!.outcome.status).toBe("answered");

    // The shape of the conversation: three questions, zero proposals.
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(3);
    expect(state.transcript.filter((event) => event.kind === "proposal")).toHaveLength(0);

    // The bare answers bound on the answer route; the phrased one directly.
    const routes = Object.fromEntries(
      (state.records[0]!.grant?.bindings ?? []).map((binding) => [binding.dimension, binding.route]),
    );
    expect(routes).toEqual({ version: "answer", region: "answer", badgeLevel: "direct" });
    expect(verifyReplay(world, state.records[0]!).allowed).toBe(true);
  });
});

describe("consent on the exact page", () => {
  const provider = scripted("scripted:release", () => releaseAnswer());
  const open = () => say(startSession(), `${PROFILE} Please release my Raticate.`, deps(provider));

  it("pauses on the attested page instead of executing the stated act", async () => {
    const state = await open();
    expect(state.records).toHaveLength(0);
    expect(state.phase.kind).toBe("confirming-act");
    expect(state.pending?.transactionId).toBe("session-1");
  });

  it("confirms into an acted record with a grant per act, and the record replays", async () => {
    const d = deps(provider);
    let state = await say(startSession(), `${PROFILE} Please release my Raticate.`, d);
    state = decideAct(state, "confirm", d);

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("acted");
    expect(record.actionGrants).toHaveLength(1);
    expect(record.confirmation?.artifactDigest).toBe(record.affidavit?.artifactDigest);
    expect(state.pages[record.id]).toBeDefined();
    expect(state.phase.kind).toBe("gathering");
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("declines into a standing answer and nothing executed", async () => {
    const d = deps(provider);
    let state = await say(startSession(), `${PROFILE} Please release my Raticate.`, d);
    state = decideAct(state, "decline", d);

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("declined");
    expect(record.actionGrants).toBeUndefined();
    expect(record.confirmation).toBeUndefined();
    expect(verifyReplay(world, record).allowed).toBe(true);
  });
});

describe("the gate, live in the loop", () => {
  it("denies a fabricated certified value by name", async () => {
    const fabricator = scripted("scripted:adversary", () =>
      JSON.stringify({
        rosters: [],
        claims: [
          { kind: "fact", entityId: "thunderbolt", factId: "move-power", asserted: { kind: "number", value: 999 } },
        ],
      }),
    );
    const state = await say(startSession(), `${PROFILE} What is Thunderbolt's power?`, deps(fabricator));

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("denied");
    if (record.outcome.status !== "denied") throw new Error("unreachable");
    expect(record.outcome.stage).toBe("answer");
    expect(record.outcome.violations.some((entry) => entry.article === "IA-2")).toBe(true);

    // The kernel's existing replay boundary, stated rather than papered over:
    // a denial at the answer stage kept the violations, not the refused draft
    // (a Transaction carries what was *certified*; the harness keeps the draft
    // beside its records as `proposedClaims`). Replay therefore refuses it as
    // incomplete — the ledger's replayability claim is about committed
    // exchanges, here exactly as in a harness run.
    const verdict = verifyReplay(world, record);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.some((entry) => entry.rule === "record-incomplete")).toBe(true);
  });
});

describe("failures counted apart, never blended", () => {
  it("a provider outage is an infrastructure note and no record — and retry recovers the same ask", async () => {
    const d = deps(new FailingProvider("scripted:down"));
    const state = await say(startSession(), `${PROFILE} What is Thunderbolt's power?`, d);

    expect(state.records).toHaveLength(0);
    expect(state.providerErrors).toBe(1);
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]!.tone).toBe("error");
    expect(state.phase.kind).toBe("gathering");

    const healthy: SessionDeps = {
      world,
      provider: scripted("scripted:honest", () => thunderboltAnswer()),
      now: clock(),
    };
    const recovered = await retry(state, healthy);
    expect(recovered.records).toHaveLength(1);
    expect(recovered.records[0]!.outcome.status).toBe("answered");
  });

  it("an answer with no claims is an abstention, never an empty certificate", async () => {
    // The dogfooding finding: a model can reply with well-formed JSON that
    // asserts nothing, and certifying it would render a page whose only
    // content is the provenance footer, stamped "checked & certified".
    const empty = scripted("scripted:empty", () => JSON.stringify({ rosters: [], claims: [] }));
    const state = await say(startSession(), `${PROFILE} what are the types of Pokemon?`, deps(empty));

    expect(state.records).toHaveLength(0);
    expect(state.notes.some((entry) => entry.tone === "abstention")).toBe(true);
  });

  it("a model that produced nothing usable is an abstention, not a verdict", async () => {
    const mute = scripted("scripted:mute", () => "I would rather write prose than JSON.");
    const state = await say(startSession(), `${PROFILE} What is Thunderbolt's power?`, deps(mute));

    expect(state.records).toHaveLength(0);
    expect(state.providerErrors).toBe(0);
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]!.tone).toBe("abstention");
    expect(state.notes[0]!.text).toContain("no usable answer");
  });
});

describe("the deterministic eligibility route (epic #54, slice 2)", () => {
  const mewtwoSpeed = () =>
    JSON.stringify({
      rosters: [],
      claims: [
        { kind: "fact", entityId: "mewtwo", factId: "is-legendary", asserted: { kind: "boolean", value: true } },
      ],
    });

  it("serves the certified rule when the model produces nothing on a gated advisory ask", async () => {
    const mute = scripted("scripted:mute", () => "no JSON at all");
    let state = await say(startSession(), `Should I go catch Mewtwo? ${PROFILE}`, deps(mute));
    const record = state.records.at(-1);
    expect(record?.outcome.status).toBe("answered");
    const claims = record?.manifest?.claims ?? [];
    expect(claims.some((claim) => claim.kind === "eligibility" && claim.entityId === "mewtwo")).toBe(true);
    // The rule, derived under the visitor's own grant — and the record replays.
    expect(verifyReplay(world, record!).allowed).toBe(true);
  });

  it("appends the rule when the model deflects into adjacent facts", async () => {
    const deflecting = scripted("scripted:deflect", (purpose) => (purpose === "answer" ? mewtwoSpeed() : "decline"));
    const state = await say(startSession(), `Is Mewtwo worth chasing for me? ${PROFILE}`, deps(deflecting));
    const claims = state.records.at(-1)?.manifest?.claims ?? [];
    // The fact survives; the on-target answer arrives beside it.
    expect(claims.some((claim) => claim.kind === "fact")).toBe(true);
    expect(claims.some((claim) => claim.kind === "eligibility" && claim.entityId === "mewtwo")).toBe(true);
  });

  it("never fires on a plain factual question — specificity over recall", async () => {
    const deflecting = scripted("scripted:fact", (purpose) => (purpose === "answer" ? mewtwoSpeed() : "decline"));
    const state = await say(startSession(), `Is Mewtwo legendary? ${PROFILE}`, deps(deflecting));
    const claims = state.records.at(-1)?.manifest?.claims ?? [];
    expect(claims.some((claim) => claim.kind === "eligibility")).toBe(false);
  });

  it("never softens a denial the gate has earned", async () => {
    const brazen = scripted("scripted:brazen", (purpose) =>
      purpose === "answer"
        ? JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "mewtwo" }] })
        : "decline",
    );
    // Badge 2: the recommendation is gated, and the route must leave the
    // attempt alone so the denial lands rather than being papered over.
    const state = await say(
      startSession(),
      "Should I catch Mewtwo? I'm playing Red and Blue in Kanto with 2 badges.",
      deps(brazen),
    );
    const record = state.records.at(-1);
    expect(record?.outcome.status).toBe("denied");
    expect(
      record?.outcome.status === "denied" &&
        record.outcome.violations.some((violation) => violation.rule === "restricted-species"),
    ).toBe(true);
  });
});

describe("eligibilityClaims — the recall gate's own edges", () => {
  it("stays silent without advisory wording, a restricted mention, or when advice already landed", () => {
    expect(eligibilityClaims(world, "What is Mewtwo's base speed?", [])).toEqual([]);
    expect(eligibilityClaims(world, "Should I train my Pikachu harder?", [])).toEqual([]);
    expect(
      eligibilityClaims(world, "Should I catch Mewtwo?", [{ kind: "recommendation", entityId: "mewtwo" }]),
    ).toEqual([]);
    expect(
      eligibilityClaims(world, "Should I catch Mewtwo?", [{ kind: "eligibility", entityId: "mewtwo" }]),
    ).toEqual([]);
  });

  it("names every restricted species the ask mentions, and only those", () => {
    expect(eligibilityClaims(world, "Should I chase Mew or Mewtwo first?", [])).toEqual([
      { kind: "eligibility", entityId: "mewtwo" },
      { kind: "eligibility", entityId: "mew" },
    ]);
    // Word-bounded: "mew" inside "mewtwo" is not a mention of Mew.
    expect(eligibilityClaims(world, "Is Mewtwo worth catching?", [])).toEqual([
      { kind: "eligibility", entityId: "mewtwo" },
    ]);
  });
});
