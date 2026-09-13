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
  setProfile,
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

  it("a catalogue opener asks only the dimension the answer needs — one question, not three", async () => {
    // The conversation that exposed the rabbit hole, now answered by the shape
    // of the question: "what types" resolves to counts over rosters, which
    // depend on the version and nothing else. Discovery reveals that shape, so
    // the opener costs exactly one question — not the old fixed
    // version/region/badges intake, most of which the answer never reads.
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
    // Discovery proposed the counts (one model call); the driver now gathers
    // only the version those counts depend on.
    expect(state.phase.kind).toBe("asking");
    if (state.phase.kind !== "asking") throw new Error("unreachable");
    expect(state.phase.dimension).toBe("version");

    state = await say(state, "Red", d);
    // Version was the whole requirement, so the answer commits — no region or
    // badge ceremony after it.
    expect(state.records).toHaveLength(1);
    expect(state.records[0]!.outcome.status).toBe("answered");
    expect(state.phase.kind).toBe("gathering");

    // One question, zero proposals; the grant binds only what the counts need.
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(1);
    expect(state.transcript.filter((event) => event.kind === "proposal")).toHaveLength(0);
    expect((state.records[0]!.grant?.bindings ?? []).map((binding) => binding.dimension)).toEqual(["version"]);
    expect(verifyReplay(world, state.records[0]!).allowed).toBe(true);
  });
});

describe("propose-first: minimal scope and the off-domain redirect (epic #64, slice 2)", () => {
  it("redirects an off-domain opener instead of interrogating it", async () => {
    // The chitchat that used to trigger a three-question intake ending in an
    // abstention. Discovery proposes no claims — nothing certified is relevant
    // — so the visitor gets an honest pointer, no questions, no record.
    const chit = scripted("scripted:chit", () => JSON.stringify({ rosters: [], claims: [] }));
    const state = await say(startSession(), "are you working?", deps(chit));

    expect(state.records).toHaveLength(0);
    expect(state.transcript.some((event) => event.kind === "question")).toBe(false);
    expect(state.notes.some((note) => note.tone === "abstention")).toBe(true);
    expect(state.phase.kind).toBe("gathering");
  });

  it("gathers the badge level for an advisory ask — version then badges, never region", async () => {
    // A recommendation depends on the trainer's accreditation; discovery
    // reveals that, so the driver asks the two dimensions it reads and stops.
    const adviceAnswer = JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "pikachu" }] });
    const provider = scripted("scripted:advice", (purpose) => (purpose === "answer" ? adviceAnswer : "no JSON"));
    const d = deps(provider);

    let state = await say(startSession(), "who should I train up?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red", d);
    // Version is bound; the recommendation still needs the badge level.
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("badgeLevel");
    state = await say(state, "eight badges", d);

    expect(state.records).toHaveLength(1);
    expect(state.records[0]!.outcome.status).toBe("answered");
    // Two questions, and region — which nothing verifies against — was not one.
    const questioned = state.transcript
      .filter((event) => event.kind === "question")
      .map((event) => (event.kind === "question" ? event.dimension : undefined));
    expect(questioned).toEqual(["version", "badgeLevel"]);
    expect(verifyReplay(world, state.records[0]!).allowed).toBe(true);
  });

  it("a fact still needs only its version, gathered in one question", async () => {
    const provider = scripted("scripted:fact", (purpose) => (purpose === "answer" ? thunderboltAnswer() : "no JSON"));
    const d = deps(provider);

    let state = await say(startSession(), "What is Thunderbolt's power?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);

    expect(state.records).toHaveLength(1);
    expect(state.records[0]!.outcome.status).toBe("answered");
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(1);
  });
});

describe("the discovery draft is reused when its scope is already granted (epic #118, latency)", () => {
  it("certifies the discovery draft on a follow-up ask instead of re-asking the model", async () => {
    // Observed live (2026-08-30): a follow-up ask under an established grant
    // paid a second full generation — 17-55s — and the re-ask sometimes
    // answered the wrong question beside a discovery draft that had answered
    // the right one. The hop from needs-scope to granted must carry the
    // draft, so the second exchange costs exactly one answer call.
    let answerCalls = 0;
    const provider = scripted("scripted:reuse", (purpose) => {
      if (purpose !== "answer") return "no JSON";
      answerCalls += 1;
      return thunderboltAnswer();
    });
    const d = deps(provider);

    // Exchange 1: discovery, a version question, the scoped answer — two
    // answer calls, because a question intervened and the words moved on.
    let state = await say(startSession(), "What is Thunderbolt's power?", d);
    state = await say(state, "Red and Blue", d);
    expect(state.records).toHaveLength(1);
    expect(answerCalls).toBe(2);

    // Exchange 2: the discovery draft names version, version is already
    // granted — the draft itself is certified. One call, not two.
    state = await say(state, "And tell me that power again?", d);
    expect(state.records).toHaveLength(2);
    expect(state.records[1]!.outcome.status).toBe("answered");
    expect(answerCalls).toBe(3);
    // The certified claims are the discovery draft's own, verified as ever.
    expect(state.records[1]!.manifest?.claims.some((claim) => claim.kind === "fact" && claim.entityId === "thunderbolt")).toBe(true);
  });
});

describe("a gated act never reaches the consent card", () => {
  it("denies a restricted-species action at the answer stage — consent cannot launder eligibility", async () => {
    // Exploration round three (2026-09-01): the adversarial persona answered
    // "should I go catch Mewtwo?" with an action shape. The gate must fire
    // before any page is attested: a trainer's consent is for the act's
    // execution, never a substitute for the accreditation the pack demands.
    const attack = JSON.stringify({ rosters: [], claims: [{ kind: "action", tool: "add-to-team", entityId: "mewtwo" }] });
    const provider = scripted("adversary", (purpose) => (purpose === "answer" ? attack : "decline"));
    const state = await say(startSession(), "I'm playing Red and Blue in Kanto with 2 badges. Should I go catch Mewtwo?", deps(provider));

    expect(state.phase.kind).toBe("gathering"); // no confirming-act: no card existed
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("denied");
    expect(record.outcome.status === "denied" && record.outcome.violations.map((v) => `${v.article}/${v.rule}`)).toContain(
      "IA-5/restricted-species",
    );
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

    // The boundary this test used to state — a denial at the answer stage did
    // not replay, because the record kept the violations but not the refused
    // draft — closed with epic #87 slice 2b: the draft is a recorded input
    // now, replay re-compiles it, and a denial verdict is as reproducible as
    // an answered one.
    expect(record.refused).toBeDefined();
    expect(verifyReplay(world, record)).toEqual({ allowed: true, violations: [] });
  });
});

describe("a decline speaks in the Advisor's voice, with the diagnosis kept beside it", () => {
  it("an unusable answer notes a plain first-person pass and carries the countable line as detail", async () => {
    const provider = scripted("mute", (purpose) => (purpose === "answer" ? "not json" : "decline"));
    const state = await say(startSession(), "I'm playing Red and Blue in Kanto with 8 badges. What's Pikachu's Speed?", deps(provider));

    const abstention = state.notes.find((entry) => entry.tone === "abstention");
    expect(abstention?.text).toContain("I don't have a certified answer");
    // The S1 discipline: the diagnostic wording stays fixed and countable —
    // in the detail register, never as the message a novice must parse.
    expect(abstention?.detail).toContain("the model produced no usable answer");
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
    // The countable wording moved to the detail register (2026-08-31): the
    // Advisor's own words carry the decline, the diagnosis rides beside it.
    expect(state.notes[0]!.detail).toContain("no usable answer");
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

describe("the profile is the model's to nominate: the deflected-profile dispatch is gone (R3b step 5)", () => {
  const deflection = JSON.stringify({
    rosters: [],
    claims: [{ kind: "explanation", blockId: "what-is-pokemon" }],
  });
  const nomination = JSON.stringify({
    rosters: [],
    claims: [{ kind: "route", routeId: "profile", entityId: "pikachu" }],
  });

  it("a lesson-only reply for a named species is taught as the lesson the model composed — the driver substitutes nothing", async () => {
    // From 2026-08-30 to 2026-09-06 the driver read this ask deterministically
    // — one named species + an all-lesson draft = the species' nine-fact
    // profile — and certified facts nobody asked for. That was the
    // substitution class R3b exists to end (docs/routing.md, step 5): the
    // lesson is certified-true, the bank's oracle scores it as the miss it
    // is, and the profile is the model's to nominate (below).
    let answerCalls = 0;
    const provider = scripted("deflector", (purpose) => {
      if (purpose !== "answer") return "decline";
      answerCalls += 1;
      return deflection;
    });
    const state = await say(startSession(), "I'm playing Red and Blue in Kanto. Tell me about Pikachu!", deps(provider));

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-pokemon" }]);
    expect(answerCalls).toBe(1);
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("a nominated profile that needs scope gets the pack's own question — the ladder is never consulted", async () => {
    // Observed live (2026-08-30): with no version established, the ladder
    // read "tell me about Pikachu" and proposed version=yellow from nothing;
    // the confirmed card died at the gate (IA-2/scope-version-mismatch). A
    // routed draft's ask was about an entity, not scope — there is no vague
    // wording to interpret, so the deterministic question outranks the model
    // (hard-won lesson 1). The property held for the deleted door; it holds
    // for the nomination that replaced it.
    let scopeCalls = 0;
    const provider = scripted("nominator", (purpose) => {
      if (purpose === "scope") {
        scopeCalls += 1;
        return JSON.stringify({ candidate: { version: "yellow" }, interpreting: "tell me about Pikachu" });
      }
      return nomination;
    });
    const d = deps(provider);

    let state = await say(startSession(), "Tell me about Pikachu!", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    expect(scopeCalls).toBe(0);

    // The direct answer to the recorded question binds deterministically and
    // the nominated profile rides the needs-scope → granted hop.
    state = await say(state, "Red and Blue", d);
    expect(state.records).toHaveLength(1);
    expect(state.records[0]!.outcome.status).toBe("answered");
    expect(state.records[0]!.manifest?.claims.every((claim) => claim.kind === "fact" && claim.entityId === "pikachu")).toBe(true);
    expect(state.records[0]!.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.factId : ""))).toContain("base-speed");
    expect(scopeCalls).toBe(0);
  });

  it("asks the pack's question when a fact draft names the entity — answer-subject wording never feeds the ladder", async () => {
    // The same trap through the other door: the model proposed pikachu facts
    // (no deflection), the draft needed a version, and the old gate handed
    // "tell me about Pikachu" to the ladder as interpretable wording — which
    // free-associated version=yellow from the mascot. An entity-naming clause
    // is about the answer; scope falls to the deterministic question.
    let scopeCalls = 0;
    const provider = scripted("facts", (purpose) => {
      if (purpose === "scope") {
        scopeCalls += 1;
        return JSON.stringify({ candidate: { version: "yellow" }, interpreting: "tell me about Pikachu" });
      }
      return JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }] });
    });
    const d = deps(provider);

    let state = await say(startSession(), "tell me about Pikachu", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    expect(scopeCalls).toBe(0);

    state = await say(state, "Red and Blue", d);
    expect(state.records[0]!.outcome.status).toBe("answered");
    expect(state.records[0]!.grant?.scope.version).toBe("red-blue");
    expect(scopeCalls).toBe(0);
  });

  it("leaves a genuine lesson ask alone — no species named, the lesson is the answer", async () => {
    const provider = scripted("teacher", (purpose) => (purpose === "answer" ? deflection : "decline"));
    const state = await say(startSession(), "What is a Pokemon, actually?", deps(provider));
    expect(state.records[0]?.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-pokemon" }]);
  });

  it("stands down when two species are named — a profile cannot speak for a comparison", async () => {
    const provider = scripted("teacher", (purpose) => (purpose === "answer" ? deflection : "decline"));
    const state = await say(startSession(), "Tell me about Pikachu and Raichu.", deps(provider));
    expect(state.records[0]?.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-pokemon" }]);
  });
});

describe("the version boundary is a teaching, not a dead end", () => {
  const squirtleFacts = JSON.stringify({
    rosters: [],
    claims: [{ kind: "fact", entityId: "squirtle", factId: "types" }],
  });

  it("answers a Yellow trainer's entity ask with the boundary lesson, filed as a record", async () => {
    // Found live: "yellow", answered honestly to the version question, dead-
    // ended every registry ask in IA-2/scope-version-mismatch — including
    // the boundary lesson written to explain exactly that situation. Now the
    // boundary lesson is the answer, deterministically.
    const provider = scripted("facts", (purpose) => (purpose === "answer" ? squirtleFacts : "decline"));
    const d = deps(provider);

    let state = await say(startSession(), "tell me about Squirtle", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "yellow", d);

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "red-blue-vs-yellow" }]);
  });

  it("a home-version mention re-arms the question, and the direct answer supersedes Yellow", async () => {
    // Found live: "let's go back to Red/blue" carried tokens but no context
    // word, bound nothing, and the trainer was trapped in Yellow behind a
    // lesson that read like an acknowledgment. The mention now earns the
    // pack's question; the direct answer binds and supersedes.
    const squirtleFacts = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "squirtle", factId: "types" }],
    });
    const provider = scripted("facts", (purpose) => (purpose === "answer" ? squirtleFacts : "decline"));
    const d = deps(provider);

    let state = await say(startSession(), "tell me about Squirtle", d);
    state = await say(state, "yellow", d);
    expect(state.records[0]!.manifest?.claims).toEqual([{ kind: "explanation", blockId: "red-blue-vs-yellow" }]);

    state = await say(state, "ok, let's go back to Red/blue", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");

    state = await say(state, "Red and Blue", d);
    // The trap is open: a fresh ask now certifies under the home version.
    state = await say(state, "tell me about Squirtle", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.grant?.scope.version).toBe("red-blue");
    expect(record.manifest?.claims.every((claim) => claim.kind === "fact" && claim.entityId === "squirtle")).toBe(true);
  });

  it("answering the re-armed question with Yellow again keeps teaching — no loop, no wrong bind", async () => {
    const provider = scripted("mute", () => "decline");
    const d = deps(provider);

    let state = await say(startSession(), "tell me about Squirtle", d);
    state = await say(state, "yellow", d);
    state = await say(state, "what about red though?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "no, still yellow", d);

    // Yellow re-affirmed: back to the boundary teaching, not a question loop.
    expect(state.phase.kind).toBe("gathering");
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "red-blue-vs-yellow" }]);
  });

  it("still teaches an ordinary lesson across the boundary", async () => {
    const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-badge" }] });
    // The species ask is routed by the model's own nomination (the driver's
    // deflected-profile door that once composed it is gone — R3b step 5);
    // the badge ask gets the lesson.
    const squirtle = JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "profile", entityId: "squirtle" }] });
    let answerCalls = 0;
    const provider = new ScriptedProvider("teacher", (request) => {
      if (request.purpose !== "answer") return "decline";
      answerCalls += 1;
      // The prompt for the later, subject-less ask carries the earlier words
      // as context, so the ask is told apart by call order, not by its text.
      return answerCalls === 1 ? squirtle : lesson;
    });
    const d = deps(provider);

    let state = await say(startSession(), "tell me about Squirtle", d);
    state = await say(state, "yellow", d);
    state = await say(state, "what is a badge?", d);

    expect(state.records).toHaveLength(2);
    expect(state.records[1]!.outcome.status).toBe("answered");
    expect(state.records[1]!.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-badge" }]);
  });
});

/** A listing nomination — the door the model names instead of composing
 * (the cue that used to read the words for it is gone: R3b, 2026-09-05). */
const listingNomination = (subject: "catalogue" | "prior-roster", n = 10) =>
  JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject, n }] });

describe("an anaphoric follow-up carries its antecedent (found live, 2026-08-31)", () => {
  it("shows the model the prior ask when the current words name nothing, and a prior-roster nomination lists from the record", async () => {
    // "can you list at least 10 for me?" reached the model bare and could
    // only abstain — ten of what? The gate: only an ask naming no species
    // and no type gets the earlier words appended, so every subject-naming
    // ask keeps its clean single-ask prompt. The set itself never comes
    // from the model's head: a prior-roster nomination composes it from
    // the previous exchange's certified roster.
    const seenPrompts: string[] = [];
    const countAnswer = JSON.stringify({
      rosters: [{ id: "all-species", criteria: { all: [] } }],
      claims: [{ kind: "count", rosterId: "all-species" }],
    });
    let answerCalls = 0;
    const provider = new ScriptedProvider("scripted:anaphora", (request) => {
      if (request.purpose !== "answer") return "decline";
      answerCalls += 1;
      seenPrompts.push(request.prompt);
      return request.prompt.includes("list at least 10") ? listingNomination("prior-roster", 10) : countAnswer;
    });
    const d = deps(provider);

    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. how many species are out there?", d);
    expect(state.records).toHaveLength(1);
    state = await say(state, "can you list at least 10 for me?", d);

    // One call for the nomination; the listing is composed from the record.
    expect(answerCalls).toBe(2);
    expect(seenPrompts[1]).toContain("how many species are out there?");
    expect(state.records).toHaveLength(2);
    const record = state.records[1]!;
    expect(record.outcome.status).toBe("answered");
    const members = record.manifest?.claims.filter((claim) => claim.kind === "membership") ?? [];
    expect(members).toHaveLength(10);
    expect(record.manifest?.claims.some((claim) => claim.kind === "count")).toBe(true);

    // A non-listing anaphoric follow-up still carries its antecedent to the
    // model ("repeat the total" names nothing; the earlier words say what).
    state = await say(state, "can you repeat the total for me?", d);
    expect(seenPrompts[seenPrompts.length - 1]).toContain("how many species are out there?");
  });

  it("a listing follow-up missing scope falls to the pack's question, never the ladder or a loop", async () => {
    const countAnswer = JSON.stringify({
      rosters: [{ id: "all-species", criteria: { all: [] } }],
      claims: [{ kind: "count", rosterId: "all-species" }],
    });
    let scopeCalls = 0;
    const provider = new ScriptedProvider("scripted:cold-list", (request) => {
      if (request.purpose === "scope") { scopeCalls += 1; return "decline"; }
      return request.prompt.includes("list a few") ? listingNomination("prior-roster") : countAnswer;
    });
    const d = deps(provider);

    // The count commits... no wait: with no scope words the count needs a
    // version first — the question is asked, answered, then the count files.
    let state = await say(startSession(), "how many species are out there?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);
    expect(state.records).toHaveLength(1);

    // The routed listing consults no ladder: it certifies straight off the
    // record. (Exchange one's ladder call, on genuinely vague wording, is
    // that path's own business.)
    const scopeCallsBefore = scopeCalls;
    state = await say(state, "can you list a few for me?", d);
    expect(state.records).toHaveLength(2);
    expect(state.records[1]!.manifest?.claims.filter((claim) => claim.kind === "membership").length).toBeGreaterThan(0);
    expect(scopeCalls).toBe(scopeCallsBefore);
  });

  it("a catalogue nomination mints the catalogue roster for a bare species-listing ask, even with no roster on file", async () => {
    // Found live: lesson, lesson, "give me a list of those species" — no
    // roster in the record and the model abstained twice. A bare listing
    // ask about species/Pokémon wants the catalogue itself, which the kernel
    // already spells as the empty criteria list; the nomination names it.
    const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-pokemon" }] });
    let answerCalls = 0;
    const provider = new ScriptedProvider("scripted:lessons", (request) => {
      if (request.purpose !== "answer") return "decline";
      answerCalls += 1;
      return request.prompt.includes("list of those species") ? listingNomination("catalogue") : lesson;
    });
    const d = deps(provider);

    let state = await say(startSession(), "tell me about this game", d);
    const callsBefore = answerCalls;
    state = await say(state, "give me a list of those species", d);
    // Membership reads the registry, so the listing rightly costs a version
    // question first — the pack's own, never the ladder.
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);

    // The nomination at discovery, and once more at the answer hop — the
    // version question intervened, and a draft never survives a question
    // (drive's reuse rule). The set itself is composed from the registry.
    expect(answerCalls).toBe(callsBefore + 2);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.filter((claim) => claim.kind === "membership")).toHaveLength(10);
    expect(record.manifest?.claims.some((claim) => claim.kind === "count")).toBe(true);
  });

  it("answers 'what are the Pokemon species?' as the listing the model nominates, never a set the words decided", async () => {
    const provider = scripted("nominator", (purpose) => (purpose === "answer" ? listingNomination("catalogue") : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "ok. what are the Pokemon species?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.some((claim) => claim.kind === "membership")).toBe(true);
    // A mute model earns no listing at all: no cue reads the words any more.
    const silent = await say(await say(startSession(), "ok. what are the Pokemon species?", deps(scripted("mute", () => "decline"))), "Red and Blue", deps(scripted("mute", () => "decline")));
    expect(silent.records.some((entry) => entry.manifest?.claims.some((claim) => claim.kind === "membership"))).toBe(false);
  });

  it("stands down when the set is qualified — a wrong-subject certificate would be worse than a pass", async () => {
    const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-pokemon" }] });
    const provider = scripted("teacher", (purpose) => (purpose === "answer" ? lesson : "decline"));
    const d = deps(provider);
    const state = await say(startSession(), "give me a list of the legendary species", d);
    // The route declined to mint the catalogue (leftover: "legendary"); the
    // model path answered however it answered — the pin is only that no
    // all-species listing was certified for a qualified ask.
    const record = state.records[0];
    expect(record?.manifest?.claims.some((claim) => claim.kind === "membership") ?? false).toBe(false);
  });

  it("keeps the single-ask prompt when the ask names its own subject", async () => {
    const seenPrompts: string[] = [];
    const provider = new ScriptedProvider("scripted:named", (request) => {
      if (request.purpose !== "answer") return "decline";
      seenPrompts.push(request.prompt);
      return JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "onix", factId: "base-defense" }] });
    });
    const d = deps(provider);

    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. What's Pikachu's Speed?", d);
    state = await say(state, "What is Onix's Defense?", d);

    expect(seenPrompts[seenPrompts.length - 1]).not.toContain("Pikachu");
  });
});

describe("the route nomination: the model picks the door, the door does the work (epic #118)", () => {
  it("a nominated listing composes from the registry and certifies through scope", async () => {
    // The cue-miss class ("tell me about the species" — no cue word): the
    // model recognizes the ask as the listing door instead of composing a
    // roster it cannot build. Everything the door composes faces the kernel.
    const nomination = JSON.stringify({
      rosters: [],
      claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 5 }],
    });
    const provider = scripted("nominator", (purpose) => (purpose === "answer" ? nomination : "decline"));
    const d = deps(provider);

    let state = await say(startSession(), "tell me about the species", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);

    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.filter((claim) => claim.kind === "membership")).toHaveLength(5);
    expect(record.manifest?.claims.some((claim) => claim.kind === "count")).toBe(true);
  });

  it("a nominated profile composes the named species' certified rundown", async () => {
    const nomination = JSON.stringify({
      rosters: [],
      claims: [{ kind: "route", routeId: "profile", entityId: "Mr Mime" }],
    });
    const provider = scripted("nominator", (purpose) => (purpose === "answer" ? nomination : "decline"));
    const d = deps(provider);

    let state = await say(startSession(), "gimme the rundown on that mime guy", d);
    state = await say(state, "Red and Blue", d);

    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.every((claim) => claim.kind === "fact" && claim.entityId === "mr-mime")).toBe(true);
    // The rundown carries the evolution beside the stats — "how do I evolve
    // X" answered with a profile now contains the fact that answers it.
    expect(record.manifest?.claims.some((claim) => claim.kind === "fact" && claim.factId === "evolves-to")).toBe(true);
  });

  it("an unknown or malformed nomination is ignored, and the flow falls through unchanged", async () => {
    const bogus = JSON.stringify({
      rosters: [],
      claims: [{ kind: "route", routeId: "grant-me-everything", badgeLevel: 99 }],
    });
    const provider = scripted("nominator", (purpose) => (purpose === "answer" ? bogus : "decline"));
    const d = deps(provider);

    const state = await say(startSession(), "do the thing", d);
    // Nomination refused, no claims beside it: the off-domain redirect —
    // exactly what a nomination-free empty reply earns.
    expect(state.records).toHaveLength(0);
    expect(state.notes.some((entry) => entry.tone === "abstention")).toBe(true);
  });
});

describe("padded lessons are trimmed when the ask named its subject (porch round four)", () => {
  it("drops the generic lesson riding beside on-target facts", async () => {
    const padded = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "explanation", blockId: "what-is-pokemon" },
        { kind: "fact", entityId: "caterpie", factId: "types" },
      ],
    });
    const provider = scripted("padder", (purpose) => (purpose === "answer" ? padded : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. Tell me more about Caterpie", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.some((claim) => claim.kind === "explanation")).toBe(false);
    expect(record.manifest?.claims.some((claim) => claim.kind === "fact" && claim.entityId === "caterpie")).toBe(true);
  });

  it("keeps the lessons when the ask named nothing — they may be the answer", async () => {
    const mixed = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "explanation", blockId: "what-is-badge" },
        { kind: "gameRule", ruleId: "badge-count" },
      ],
    });
    const provider = scripted("teacher", (purpose) => (purpose === "answer" ? mixed : "decline"));
    const d = deps(provider);
    const state = await say(startSession(), "how do badges work and how many are there?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.claims.some((claim) => claim.kind === "explanation")).toBe(true);
  });
});

describe("the ceremony dial, end to end: a card answered in words settles without the click", () => {
  it("binds the trainer's own basis over the proposed one and certifies the ranking", async () => {
    const ranking = JSON.stringify({
      rosters: [{ id: "all-pokemon", criteria: { all: [] } }],
      claims: [{ kind: "ranking", rosterId: "all-pokemon", basis: "base-speed", direction: "highest" }],
    });
    const basisProposal = JSON.stringify({ candidate: { comparisonBasis: "base-stat-total" }, interpreting: "which is best?" });
    const provider = scripted("ladder", (purpose) => (purpose === "scope" ? basisProposal : ranking));
    const d = deps(provider);

    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. which pokemon is best?", d);
    expect(state.phase.kind).toBe("confirming-scope");
    // The impatient trainer answers the card in words instead of clicking —
    // and corrects the interpretation while they're at it.
    state = await say(state, "speed", d);

    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.grant?.scope.comparisonBasis).toBe("base-speed");
  });
});

describe("porch round five: stale cards, social closes, rarity, direction", () => {
  it("rejects a ladder proposal that interprets another exchange's words", async () => {
    const staleProposal = JSON.stringify({ candidate: { comparisonBasis: "base-hp" }, interpreting: "how much HP does snorlax have?" });
    const ranking = JSON.stringify({
      rosters: [{ id: "all-pokemon", criteria: { all: [] } }],
      claims: [{ kind: "ranking", rosterId: "all-pokemon", basis: "base-stat-total", direction: "highest" }],
    });
    const snorlaxFact = JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "snorlax", factId: "base-hp" }] });
    const provider = new ScriptedProvider("stale", (request) => {
      if (request.purpose === "scope") return staleProposal;
      return request.prompt.includes("snorlax") ? snorlaxFact : ranking;
    });
    const d = deps(provider);

    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. how much HP does snorlax have?", d);
    expect(state.records).toHaveLength(1); // settled — its words are spent
    state = await say(state, "whats the best pokemon overall?", d);
    // The stale card is refused; the deterministic question stands instead.
    expect(state.phase.kind).not.toBe("confirming-scope");
  });

  it("a pure pleasantry earns a social note — no model, no record, no question", async () => {
    let calls = 0;
    const provider = scripted("mute", () => { calls += 1; return "decline"; });
    const d = deps(provider);
    let state = await say(startSession(), "What is a badge?", d);
    const callsBefore = calls;
    const recordsBefore = state.records.length;
    state = await say(state, "thanks!", d);
    expect(calls).toBe(callsBefore);
    expect(state.records.length).toBe(recordsBefore);
    expect(state.notes[state.notes.length - 1]?.tone).toBe("social");
    // But a pleasantry with a payload still drives the machinery.
    state = await say(state, "thanks, and what is a badge?", d);
    expect(calls).toBeGreaterThan(callsBefore);
  });

  it("the confidence question gets the provenance answer", async () => {
    const provider = scripted("mute", () => "decline");
    const state = await say(await say(startSession(), "What is a badge?", deps(provider)), "are you sure?", deps(provider));
    const last = state.notes[state.notes.length - 1];
    expect(last?.tone).toBe("social");
    expect(last?.text).toContain("certified snapshot");
  });

  it("'whats the rarest pokemon?' nominated as a catalogue listing mints the legendary roster — the set comes from the words' qualifier", async () => {
    const provider = scripted("nominator", (purpose) => (purpose === "answer" ? listingNomination("catalogue") : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "whats the rarest pokemon?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    const members = record.manifest?.claims.filter((claim) => claim.kind === "membership") ?? [];
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((claim) => claim.kind === "membership" && ["articuno", "zapdos", "moltres", "mewtwo"].includes(claim.entityId))).toBe(true);
  });

  it("flips a matchup whose direction contradicts the ask's word order, and counts it", async () => {
    const wrongWay = JSON.stringify({
      rosters: [],
      claims: [{ kind: "matchup", subject: { kind: "type", typeId: "rock" }, direction: "strong-against" }],
    });
    const provider = scripted("dyslexic", (purpose) => (purpose === "answer" ? wrongWay : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. what is good against rock?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    const matchup = record.manifest?.claims.find((claim) => claim.kind === "matchup");
    expect(matchup?.kind === "matchup" && matchup.direction).toBe("weak-to");
    expect(state.flips).toBe(1);

    // The other order stays untouched: "what is rock good against" reads
    // strong-against, and the decoded direction already says so.
    state = await say(state, "and what is rock good against?", d);
    const second = state.records[state.records.length - 1]!;
    const kept = second.manifest?.claims.find((claim) => claim.kind === "matchup");
    expect(kept?.kind === "matchup" && kept.direction).toBe("strong-against");
    expect(state.flips).toBe(1);
  });
});

describe("porch round nine: drift over an armed question is never a silent turn", () => {
  it("a fresh entity ask over an armed question reopens the exchange at the new ask", async () => {
    // The model answers whichever ask it is shown — so the record proves
    // which ask the reopened exchange is keyed on.
    const pikachuFact = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "evolves-to" }],
    });
    const provider = new ScriptedProvider("keyed", (request) =>
      request.purpose === "scope" ? "decline" : request.prompt.includes("pikachu") ? pikachuFact : "decline",
    );
    const d = deps(provider);
    let state = await say(startSession(), "tell me about charmander", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");

    // The trainer moves on instead of answering. Found live (2026-09-01):
    // this turn produced zero model calls, zero notes, zero phase change.
    state = await say(state, "does pikachu evolve?", d);
    const aside = state.notes.find((n) => n.detail?.includes("topic change"));
    expect(aside).toBeDefined();
    expect(aside?.tone).toBe("social");

    // The reopened exchange is keyed at the new ask: answering the version
    // question now serves Pikachu, not Charmander.
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    const facts = record.manifest?.claims.filter((claim) => claim.kind === "fact") ?? [];
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((claim) => claim.kind === "fact" && claim.entityId === "pikachu")).toBe(true);
  });

  it("a bare species name over an armed question is not read as drift", async () => {
    const provider = scripted("mute", () => "decline");
    const d = deps(provider);
    let state = await say(startSession(), "tell me about charmander", d);
    state = await say(state, "pikachu", d);
    expect(state.notes.some((n) => n.detail?.includes("topic change"))).toBe(false);
  });

  it("the stale-interpretation guard does not count question furniture as overlap", async () => {
    // Found live (2026-09-01): with the version question armed, "what does
    // it evolve into?" drew a card whose interpretation was the trainer's
    // own settled question, "what game should i start with?" — the guard
    // passed it on the shared word "what".
    const questionSourced = JSON.stringify({
      candidate: { version: "red-blue" },
      interpreting: "what game should i start with?",
    });
    const provider = scripted("leaky", (purpose) => (purpose === "scope" ? questionSourced : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "tell me about charmander", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "what does it evolve into?", d);
    expect(state.phase.kind).not.toBe("confirming-scope");
  });

  it("an unanswering reply earns the question restated, never silence", async () => {
    const provider = scripted("mute", () => "decline");
    const d = deps(provider);
    let state = await say(startSession(), "tell me about charmander", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    const notesBefore = state.notes.length;
    // No entity named, so the topic-change door stands down — but the turn
    // must still say something.
    state = await say(state, "what does it evolve into?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    const restated = state.notes.slice(notesBefore).find((n) => n.detail?.includes("question restated"));
    expect(restated).toBeDefined();
    expect(restated?.text).toContain("Which game version");
  });
});

describe("porch round ten: the comparative ask binds its own basis", () => {
  it("'which pokemon is the fastest?' costs no card and no basis question", async () => {
    const ranking = JSON.stringify({
      rosters: [{ id: "all-pokemon", criteria: { all: [] } }],
      claims: [{ kind: "ranking", rosterId: "all-pokemon", basis: "base-speed", direction: "highest" }],
    });
    const provider = scripted("ranker", (purpose) => (purpose === "scope" ? "decline" : ranking));
    const d = deps(provider);
    const state = await say(startSession(), `${PROFILE} which pokemon is the fastest?`, d);

    // Before the comparative term and the ask-parameter lift, this ask cost
    // the deterministic basis question (findings §19); now the ask carries
    // its basis the way it carries its subject.
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(0);
    expect(state.phase.kind).toBe("gathering");
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.grant?.scope.comparisonBasis).toBe("base-speed");
  });
});

describe("R3b: schema linking — the model links each phrase to a field, the driver holds the claims to it", () => {
  const boundaryLesson = () => world.pack.recordsBoundary?.lessonId;
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;
  /** A reply that links the asked phrase to no field and then substitutes a
   * fact nobody asked for — R2's bank finding, in one JSON object. */
  const substitution = (phrase: string, entityId: string) =>
    JSON.stringify({
      asked: [{ phrase, entityId, fieldId: "none" }],
      rosters: [],
      claims: [{ kind: "fact", entityId, factId: "types" }],
    });

  it("a phrase linked to no field teaches the boundary lesson on the discovery hop, and the substituted fact is dropped", async () => {
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : substitution("how tall", "onix")));
    const state = await say(startSession(), "how tall is Onix?", deps(provider));
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: boundaryLesson() }]);
    expect(verifyReplay(world, record).allowed).toBe(true);
    // The boundary named in the trainer's own phrase, and the substitution counted.
    const boundaryNote = state.notes.find((n) => n.text.includes("\"how tall\" for onix"));
    expect(boundaryNote?.tone).toBe("abstention");
    expect(state.linking).toMatchObject({ mapped: 1, offTargetDropped: 1 });
    expect(state.usage.calls).toBe(1);
  });

  it("with scope pre-set, the same reading holds on the answer hop", async () => {
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : substitution("weight", "snorlax")));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what's Snorlax's weight?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: boundaryLesson() }]);
    expect(state.notes.some((n) => n.text.includes("\"weight\" for snorlax"))).toBe(true);
  });

  it("a null link beside a linked claim is silent — the claim certifies, and the note is for a null link that is the whole answer", async () => {
    const partial = JSON.stringify({
      asked: [
        { phrase: "what type", entityId: "onix", fieldId: "types" },
        { phrase: "what noise", entityId: "onix", fieldId: "none" },
      ],
      rosters: [],
      claims: [{ kind: "fact", entityId: "onix", factId: "types" }],
    });
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : partial));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what type is Onix, and what noise does it make?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toHaveLength(1);
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "fact", entityId: "onix", factId: "types" });
    // Found live: every count and listing ask links its "how many" / "list
    // ten" to none beside the set operation that answers it, so a null link
    // beside an answer earns no boundary note.
    expect(state.notes.some((n) => n.tone === "abstention")).toBe(false);
    expect(state.linking.offTargetDropped).toBe(0);
  });

  it("a prior-roster nomination yields to the ask's own qualifier", async () => {
    // Found live (2026-09-05, first run without the cue door): "whats the
    // rarest pokemon?" nominated the prior roster and was served the fire
    // roster of the exchange before. The words qualify a set; the words win.
    const nominate = (subject: string) => JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject, n: 10 }] });
    const provider = new ScriptedProvider("prior", (request) =>
      request.purpose !== "answer" ? "decline" : request.prompt.includes("rarest") ? nominate("prior-roster") : nominate("catalogue"),
    );
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "show me all the fire types", d);
    state = await say(state, "whats the rarest pokemon?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.rosters[0]?.id).toBe("legendary-pokemon");
  });

  it("R1: a fact about a field the model did not link is dropped, and the linked one certifies", async () => {
    const reply = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-speed" }],
      rosters: [],
      claims: [
        { kind: "fact", entityId: "pikachu", factId: "base-speed" },
        { kind: "fact", entityId: "pikachu", factId: "base-hp" },
      ],
    });
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : reply));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.factId : claim.kind))).toEqual(["base-speed"]);
    expect(state.linking.offTargetDropped).toBe(1);
  });

  it("R1: a reply emptied of everything but off-target facts is an honest pass, never a certificate", async () => {
    const reply = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-speed" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-hp" }],
    });
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : reply));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(state.records).toHaveLength(0);
    expect(state.notes[state.notes.length - 1]?.text).toContain("things you didn't ask for");
    expect(state.phase.kind).toBe("gathering");
  });

  it("R1 reaches set claims through their roster: a listing of the type asked about the chart is off the ask", async () => {
    // Found live (strong model, 2026-09-05): "what beats water types?" came
    // back as the water roster listed and counted — certified members, wrong
    // question. The roster selects on `types`; the model linked `type-chart`.
    const reply = JSON.stringify({
      asked: [{ phrase: "what beats water", entityId: "water", fieldId: "type-chart" }],
      rosters: [{ id: "water-pokemon", criteria: { all: [{ kind: "has-type", type: "water" }] } }],
      claims: [
        { kind: "membership", rosterId: "water-pokemon", entityId: "squirtle", asserted: true },
        { kind: "count", rosterId: "water-pokemon" },
      ],
    });
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : reply));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what beats water types?", d);
    expect(state.records).toHaveLength(0);
    expect(state.linking.offTargetDropped).toBe(2);
    expect(state.notes[state.notes.length - 1]?.text).toContain("things you didn't ask for");
  });

  it("a link whose words come only from an earlier exchange is stale, and its claims fall with it", async () => {
    // Found live (both models, 2026-09-05): shown the earlier asks as context
    // for "what's a gym badge?", the model linked and answered them again.
    let turn = 0;
    const provider = scripted("echoing", (purpose) => {
      if (purpose === "scope") return "decline";
      turn += 1;
      if (turn === 1) return JSON.stringify({ asked: [{ phrase: "speed", entityId: "pikachu", fieldId: "base-speed" }], rosters: [], claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }] });
      return JSON.stringify({
        asked: [
          { phrase: "what's Pikachu's Speed", entityId: "pikachu", fieldId: "base-speed" },
          { phrase: "gym badge", entityId: "gym-badge", fieldId: "none" },
        ],
        rosters: [],
        claims: [
          { kind: "fact", entityId: "pikachu", factId: "base-speed" },
          { kind: "explanation", blockId: "what-is-badge" },
        ],
      });
    });
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what's Pikachu's Speed?", d);
    state = await say(state, "what's a gym badge?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-badge" }]);
    expect(state.linking.staleDropped).toBe(1);
    // A lesson answers the concept; the null link earns no boundary note beside it.
    expect(state.notes.filter((n) => n.tone === "abstention")).toHaveLength(0);
  });

  it("R3: an alias contradiction is asked about, not answered — the dictionary's words can only make a question", async () => {
    const reply = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-attack" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-attack" }],
    });
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : reply));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(state.records).toHaveLength(0);
    const last = state.notes[state.notes.length - 1];
    expect(last?.tone).toBe("abstention");
    expect(last?.text).toContain("Attack");
    expect(last?.text).toContain("Speed");
    expect(state.linking.contradictions).toBe(1);
  });

  it("a null link on a subject the records never certified is the off-domain redirect, not the boundary lesson", async () => {
    // Found by the first R3b bank leg: every off-domain question ("what's
    // the weather?") linked its phrase to none and taught the boundary
    // lesson — a certified page for small talk.
    const reply = JSON.stringify({ asked: [{ phrase: "the weather", entityId: "weather", fieldId: "none" }], rosters: [], claims: [] });
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : reply));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what's the weather like today?", d);
    expect(state.records).toHaveLength(0);
    expect(state.notes[state.notes.length - 1]?.text).toContain("couldn't line that up");
    // One note, not two: the boundary note is never written for a subject
    // the records do not certify (dogfood, 2026-09-05: "tell me about this"
    // drew both).
    expect(state.notes.filter((n) => n.tone === "abstention")).toHaveLength(1);
    // And on the discovery hop, the same.
    const cold = await say(startSession(), "what's the weather like today?", deps(provider));
    expect(cold.records).toHaveLength(0);
    expect(cold.notes[cold.notes.length - 1]?.text).toContain("couldn't line that up");
  });

  it("a reply that links nothing is held to nothing — the measured control, counted as unlinked", async () => {
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : thunderboltAnswer()));
    const state = await say(startSession(), `${PROFILE} What is Thunderbolt's power?`, deps(provider));
    expect(state.records[0]?.outcome.status).toBe("answered");
    expect(state.linking).toMatchObject({ mapped: 0, unlinked: 1 });
  });
});

describe("R3b: the verifier-in-the-loop retry — a denial the kernel can name is carried back once", () => {
  const fabricated = JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "gym-badge", factId: "types" }] });
  const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-badge" }] });

  /** Fabricates an entity on every answer call until it has been told the
   * denial; then teaches. The porch's "what's a gym badge?", scripted. */
  function correcting(): { provider: ModelProvider; prompts: string[] } {
    const prompts: string[] = [];
    const provider = new ScriptedProvider("correcting", (request) => {
      if (request.purpose !== "answer") return "decline";
      prompts.push(request.prompt);
      return request.prompt.includes("refused by the verifier") ? lesson : fabricated;
    });
    return { provider, prompts };
  }

  it("turns a first-attempt IA-3 into the lesson on the second call — and keeps the first denial on the books", async () => {
    const { provider, prompts } = correcting();
    const d = { ...deps(provider), feedback: true };
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    state = await say(state, "what's a gym badge?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-badge" }]);
    expect(state.feedbackRetries).toBe(1);
    expect(state.feedbackDenials).toEqual(["IA-3/fabricated-entity"]);
    // The retry's prompt carries the denial by name, in fixed wording; the
    // first prompt carried nothing of the kind.
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("refused by the verifier");
    expect(prompts[1]).toContain("refused by the verifier, by name");
    expect(prompts[1]).toContain("IA-3/fabricated-entity");
    expect(prompts[1]).toContain('"gym-badge" is not certified');
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("reaches the answer hop through the version question too — the discovery reply is not what is retried", async () => {
    const { provider, prompts } = correcting();
    const d = { ...deps(provider), feedback: true };
    let state = await say(startSession(), "what's a gym badge?", d);
    // The fabricated fact reads as intent at discovery: the version is asked.
    expect(state.phase.kind).toBe("asking");
    state = await say(state, "Red", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-badge" }]);
    // Discovery, the answer hop's first attempt, and the one retry.
    expect(prompts).toHaveLength(3);
    expect(state.feedbackRetries).toBe(1);
  });

  it("without the door, the first denial files as it always did", async () => {
    const { provider, prompts } = correcting();
    const d = deps(provider);
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    state = await say(state, "what's a gym badge?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("denied");
    expect(state.feedbackRetries).toBe(0);
    expect(prompts).toHaveLength(1);
  });

  it("a second denial files as a denial: no passing by trial and error", async () => {
    const provider = scripted("stubborn", (purpose) => (purpose === "scope" ? "decline" : fabricated));
    const d = { ...deps(provider), feedback: true };
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    state = await say(state, "what's a gym badge?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("denied");
    expect(state.feedbackRetries).toBe(1);
    expect(state.usage.calls).toBe(2);
  });

  it("leaves the repair's own class alone: an all-fact-mismatch denial is stripped, not fed back", async () => {
    const wrongSpeed = JSON.stringify({
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 1 } }],
    });
    const provider = scripted("misremembers", (purpose) => (purpose === "scope" ? "decline" : wrongSpeed));
    const d = { ...deps(provider), feedback: true, repair: true };
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(state.records[state.records.length - 1]?.outcome.status).toBe("answered");
    expect(state.repairs).toBe(1);
    expect(state.feedbackRetries).toBe(0);
    expect(state.usage.calls).toBe(1);
  });
});

describe("R2: the trainer's profile is scope set once, not asked for", () => {
  it("a profile set before the ask means no version question, no card, and a record that replays", async () => {
    const provider = scripted("scripted:honest", (purpose) => (purpose === "scope" ? "decline" : thunderboltAnswer()));
    const d = deps(provider);
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    // Acknowledged in the trainer's terms, nothing asked, nothing sent.
    expect(state.notes[state.notes.length - 1]?.text).toContain("Red/Blue");
    expect(state.usage.calls).toBe(0);
    expect(state.transcript[0]?.kind).toBe("profile");

    state = await say(state, "What is Thunderbolt's power?", d);
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(0);
    expect(state.transcript.filter((event) => event.kind === "proposal")).toHaveLength(0);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.grant?.scope).toMatchObject({ version: "red-blue", region: "kanto", badgeLevel: 8 });
    expect(record.grant?.bindings.every((binding) => binding.route === "profile")).toBe(true);
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("a profile set while a question is armed answers it and the exchange drives on", async () => {
    // A model that nominates the profile route for the ask; the pack's
    // version question still fires first, and the panel answers it.
    const nominate = JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "profile", entityId: "charmander" }] });
    const provider = scripted("nominator", (purpose) => (purpose === "scope" ? "decline" : nominate));
    const d = deps(provider);
    let state = await say(startSession(), "tell me about charmander", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await setProfile(state, { version: "red-blue" }, d);
    expect(state.phase.kind).toBe("gathering");
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.every((claim) => claim.kind === "fact" && claim.entityId === "charmander")).toBe(true);
  });

  it("a profile on the foreign version teaches the boundary, and a later correction is asked about", async () => {
    const provider = scripted("mute", () => "decline");
    const d = deps(provider);
    let state = await setProfile(startSession(), { version: "yellow" }, d);
    state = await say(state, "tell me about charmander", d);
    expect(state.records[state.records.length - 1]?.manifest?.claims[0]).toMatchObject({ kind: "explanation" });
    state = await say(state, "actually I play Red", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
  });

  it("a profile set again mid-session supersedes the first: the next answer certifies under the new game, and nothing is asked", async () => {
    // The trainer switches games between two asks. The kernel's rule (a
    // later profile outranks everything before it on its dimensions) means
    // the page may offer "change" after "set" without a question or a card;
    // pinned here so the live page's affordance rests on a driver-level fact.
    const provider = scripted("scripted:honest", (purpose) => (purpose === "scope" ? "decline" : thunderboltAnswer()));
    const d = deps(provider);
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    state = await say(state, "What is Thunderbolt's power?", d);
    expect(state.records[0]?.grant?.scope).toMatchObject({ version: "red-blue", badgeLevel: 8 });
    state = await setProfile(state, { version: "yellow", region: "kanto", badgeLevel: 2 }, d);
    expect(state.notes[state.notes.length - 1]?.text).toContain("Yellow");
    state = await say(state, "What is Thunderbolt's power?", d);
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(0);
    expect(state.transcript.filter((event) => event.kind === "proposal")).toHaveLength(0);
    const record = state.records[state.records.length - 1]!;
    expect(record.grant?.scope).toMatchObject({ version: "yellow", region: "kanto", badgeLevel: 2 });
    // The first profile is on the record as superseded, by name — not silently gone.
    expect(record.derivation.ignored.some((match) => match.blockedBy === "superseded" && match.value === "red-blue")).toBe(true);
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("an unapproved profile value binds nothing — the pack's question still stands", async () => {
    const provider = scripted("mute", () => "decline");
    const d = deps(provider);
    let state = await setProfile(startSession(), { version: "crystal" } as never, d);
    state = await say(state, "tell me about charmander", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
  });
});

describe("R1 bank run 2026-09-04: a refused nomination is retried with the route door closed", () => {
  it("a model that misuses the route variant gets one more call without it, and the fact goes through", async () => {
    // Under the provider-enforced schema the strong model answered "What
    // types is Charizard?" with a listing nomination for the catalogue; the
    // door refused it and the empty remainder read as off-domain — fifteen
    // answerable questions redirected at turn one. The offer is withdrawn
    // for one call; the reply the model writes without it goes through.
    const misuse = JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 1 }] });
    const fact = JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "charizard", factId: "types" }] });
    let offered = 0;
    let closed = 0;
    const provider = new ScriptedProvider("steered", (request) => {
      if (request.purpose === "scope") return "decline";
      const routeOffered = JSON.stringify(request.schema ?? {}).includes('"route"');
      if (routeOffered) offered += 1;
      else closed += 1;
      return routeOffered ? misuse : fact;
    });
    const d = deps(provider);
    let state = await say(startSession(), "playing red. What types is Charizard?", d);
    expect(state.notes.some((n) => n.tone === "abstention")).toBe(false);
    expect(offered).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(0);
    expect(state.nominationRetries).toBeGreaterThan(0);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "fact", entityId: "charizard", factId: "types" });
    // The refused listing nomination is still on the gauge.
    expect(state.listingActivations.stoodDown).toBeGreaterThan(0);
  });

  it("the listing executor refuses an entity-naming ask, so the fact goes through on the retry", async () => {
    // Live: "What's Pikachu's Speed stat?" drew a catalogue-listing
    // nomination and the door composed ten certified members — the answer
    // to a question nobody asked. The executor now carries the cue door's
    // own guard.
    const misuse = JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 10 }] });
    const fact = JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }] });
    const provider = new ScriptedProvider("steered", (request) =>
      request.purpose === "scope" ? "decline" : JSON.stringify(request.schema ?? {}).includes('"route"') ? misuse : fact,
    );
    const state = await say(startSession(), "playing red. What's Pikachu's Speed stat?", deps(provider));
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.some((claim) => claim.kind === "membership")).toBe(false);
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "fact", entityId: "pikachu", factId: "base-speed" });
  });

  it("the profile executor refuses a move-naming ask, so the membership goes through on the retry", async () => {
    const misuse = JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "profile", entityId: "pikachu" }] });
    const learns = JSON.stringify({
      rosters: [{ id: "selfdestruct-learners", criteria: { all: [{ kind: "learns-move", move: "self-destruct" }] } }],
      claims: [{ kind: "membership", rosterId: "selfdestruct-learners", entityId: "pikachu", asserted: false }],
    });
    const provider = new ScriptedProvider("steered", (request) =>
      request.purpose === "scope" ? "decline" : JSON.stringify(request.schema ?? {}).includes('"route"') ? misuse : learns,
    );
    const state = await say(startSession(), "playing red. Does Pikachu learn Selfdestruct?", deps(provider));
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.some((claim) => claim.kind === "fact")).toBe(false);
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "membership", entityId: "pikachu" });
  });

  it("'What is Pokemon?' is a lesson's shape, never the catalogue", async () => {
    const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-pokemon" }] });
    let calls = 0;
    const provider = scripted("teacher", () => { calls += 1; return lesson; });
    const state = await say(startSession(), "What is Pokemon?", deps(provider));
    expect(calls).toBeGreaterThan(0);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.claims.some((claim) => claim.kind === "membership")).toBe(false);
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "explanation" });
  });

  it("a nomination the driver accepts is not retried", async () => {
    const nominate = JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "profile", entityId: "pikachu" }] });
    const provider = scripted("nominator", (purpose) => (purpose === "scope" ? "decline" : nominate));
    const state = await say(startSession(), "playing red. tell me about pikachu", deps(provider));
    expect(state.nominationRetries).toBe(0);
    expect(state.records[state.records.length - 1]?.outcome.status).toBe("answered");
  });
});

describe("dogfood 2026-09-04: a superlative ask is never served the previous listing", () => {
  it("'which pokemon is the fastest?' after a listing does not reuse the roster", async () => {
    // Live: the bareness reading stripped "fastest" as noise, the prior-
    // roster door read the ask as bare, and the previous exchange's ten
    // species came back certified with no model call — true, in scope,
    // and not what was asked. The door must stand down; the model (or a
    // ranking route) owns a superlative.
    const ranking = JSON.stringify({
      rosters: [{ id: "all-pokemon", criteria: { all: [] } }],
      claims: [{ kind: "ranking", rosterId: "all-pokemon", basis: "base-speed", direction: "highest" }],
    });
    const provider = new ScriptedProvider("ranker", (request) =>
      request.purpose === "scope" ? "decline" : request.prompt.includes("fastest") ? ranking : listingNomination("catalogue"),
    );
    const d = deps(provider);
    let state = await say(startSession(), "im playing red", d);
    state = await say(state, "give me a list of Pokemon species", d);
    const listing = state.records[state.records.length - 1]!;
    expect(listing.manifest?.claims.some((claim) => claim.kind === "membership")).toBe(true);

    state = await say(state, "which pokemon is the fastest?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.id).not.toBe(listing.id);
    expect(record.manifest?.claims.some((claim) => claim.kind === "membership")).toBe(false);
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "ranking", basis: "base-speed" });
  });
});

describe("dogfood 2026-09-04: a statement of scope is not an ask", () => {
  it("a version correction re-asks the version question, and the answer is acknowledged", async () => {
    // Live: "how many species?" → version question → "Yellow" (boundary
    // lesson) → "ok. I actually play Red" earned "I lost the thread of that
    // one". The correction contradicts the recorded answer; the design says
    // ask again — deterministically, before any model reads it.
    const count = JSON.stringify({
      rosters: [{ id: "all-pokemon", criteria: { all: [] } }],
      claims: [{ kind: "count", rosterId: "all-pokemon" }],
    });
    const pikachuTypes = JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "pikachu", factId: "types" }] });
    let calls = 0;
    const provider = new ScriptedProvider("dogfood", (request) => {
      calls += 1;
      if (request.purpose === "scope") return "decline";
      return request.prompt.includes("pikachu") ? pikachuTypes : count;
    });
    const d = deps(provider);
    let state = await say(startSession(), "how many species are there?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Yellow", d);
    expect(state.records[state.records.length - 1]?.manifest?.claims[0]).toMatchObject({ kind: "explanation" });

    const before = calls;
    state = await say(state, "ok. I actually play Red", d);
    expect(calls).toBe(before); // no model reads a correction
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");

    state = await say(state, "Red", d);
    expect(calls).toBe(before);
    const ack = state.notes[state.notes.length - 1];
    expect(ack?.tone).toBe("social");
    expect(ack?.text).toContain("Red/Blue");
    expect(state.phase.kind).toBe("gathering");

    // And the next ask answers under the corrected version.
    state = await say(state, "what type is pikachu?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.grant?.scope.version).toBe("red-blue");
  });

  it("a bare 'im playing red' is acknowledged — no model, no interrogation", async () => {
    let calls = 0;
    const provider = scripted("mute", () => { calls += 1; return "decline"; });
    const state = await say(startSession(), "im playing red", deps(provider));
    expect(calls).toBe(0);
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(0);
    expect(state.notes[state.notes.length - 1]?.text).toContain("Red/Blue");
    expect(state.phase.kind).toBe("gathering");
  });

  it("a bare 'im playing yellow' teaches the boundary — no question, no redirect", async () => {
    const provider = scripted("mute", () => "decline");
    const state = await say(startSession(), "im playing yellow", deps(provider));
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(0);
    expect(state.notes.some((n) => n.tone === "abstention")).toBe(false);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "explanation" });
  });

  it("a statement that carries an ask is still answered, never acknowledged", async () => {
    const provider = scripted("scripted:honest", (purpose) => (purpose === "scope" ? "decline" : thunderboltAnswer()));
    const state = await say(startSession(), `${PROFILE} What is Thunderbolt's power?`, deps(provider));
    expect(state.records).toHaveLength(1);
    expect(state.notes.some((n) => n.detail?.includes("scope statement acknowledged"))).toBe(false);
  });
});

describe("porch round twelve: the terse trainer and the trust question", () => {
  it("a live card outranks the bare question for its own dimension", async () => {
    // "red. pikachu. weaknesses. go" earns a version card; "hp?" is a
    // vocabulary token (no long tail, no ladder) that used to fall to ask()
    // and ERASE the card — card → question → new card, three turns, no
    // answer. Now the card is restated and keeps its identity.
    const versionCard = JSON.stringify({ candidate: { version: "red-blue" }, interpreting: "red" });
    const provider = scripted("terse", (purpose) => (purpose === "scope" ? versionCard : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "red. pikachu. weaknesses. go", d);
    expect(state.phase.kind).toBe("confirming-scope");
    const pending = state.phase.kind === "confirming-scope" ? state.phase.proposal.id : undefined;

    state = await say(state, "hp?", d);
    expect(state.phase.kind === "confirming-scope" && state.phase.proposal.id).toBe(pending);
    expect(state.notes.some((n) => n.detail?.includes("card restated"))).toBe(true);
  });

  it("a rejected card is never restated — the fall goes to the question", async () => {
    const versionCard = JSON.stringify({ candidate: { version: "red-blue" }, interpreting: "red" });
    const provider = scripted("terse", (purpose) => (purpose === "scope" ? versionCard : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "red. pikachu. weaknesses. go", d);
    for (let i = 0; state.phase.kind === "confirming-scope" && i < MAX_LADDER_TURNS; i++) {
      state = await decideScope(state, "reject", d);
    }
    expect(state.phase.kind).toBe("asking");
  });

  it("the trust question earns the architecture answer, not a routed lesson", async () => {
    let calls = 0;
    const provider = scripted("mute", () => { calls += 1; return "decline"; });
    const state = await say(startSession(), "are you an AI? will you make stuff up?", deps(provider));
    expect(calls).toBe(0);
    const last = state.notes[state.notes.length - 1];
    expect(last?.tone).toBe("social");
    expect(last?.text).toContain("certified");
    expect(state.records).toHaveLength(0);
  });

  it("an anaphoric ask the model cannot read asks for its antecedent, not the menu", async () => {
    // A readable empty draft — the off-domain shape, as the weak model
    // produces it live — rather than an unreadable decline.
    const empty = JSON.stringify({ rosters: [], claims: [] });
    const provider = scripted("empty", (purpose) => (purpose === "scope" ? "decline" : empty));
    const d = deps(provider);
    let state = await say(startSession(), "playing red. What is Thunderbolt's power?", d);
    // The opener earns the generic menu (nothing before it to point back
    // at); the follow-up below is anaphoric and earns the targeted line.
    state = await say(state, "which one is stronger?", d);
    const last = state.notes[state.notes.length - 1];
    expect(last?.tone).toBe("abstention");
    expect(last?.text).toContain("Name the");
    expect(last?.detail).toContain("anaphoric");
  });
});

describe("porch round eleven: cards do not eat questions", () => {
  it("'i got red' binds the version — the acquisition verb is context", async () => {
    // The live thread that found this round's seam never needed its card:
    // "i got red he got blue" is a scope statement, and the bank's own
    // v-got-yellow note predicted the miss.
    const provider = scripted("mute", () => "decline");
    const state = await say(startSession(), "i got red he got blue. is squirtle any good long term?", deps(provider));
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(0);
    expect(state.phase.kind).not.toBe("confirming-scope");
  });

  it("a fresh ask naming a certified move drifts past a pending card to its answer", async () => {
    // A vague opener leaves a version card pending; the move ask names no
    // species, but moves are certified subjects too — the drift door reads
    // the whole registry, not just its species shelf.
    const versionCard = JSON.stringify({ candidate: { version: "red-blue" }, interpreting: "the crimson cartridge" });
    const provider = new ScriptedProvider("porch", (request) =>
      request.purpose === "scope" ? versionCard : request.prompt.includes("thunderbolt") ? thunderboltAnswer() : "decline",
    );
    const d = deps(provider);
    let state = await say(startSession(), "we just started with the crimson cartridge. is squirtle any good long term?", d);
    state = await say(state, "asdfgh jkl", d);
    expect(state.phase.kind).toBe("confirming-scope");

    state = await say(state, "what is thunderbolt's power?", d);
    expect(state.notes.some((n) => n.detail?.includes("topic change"))).toBe(true);
    state = await say(state, "red", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "fact", entityId: "thunderbolt" });
  });

  it("an identical re-proposal restates the pending card instead of duplicating it", async () => {
    const versionCard = JSON.stringify({ candidate: { version: "red-blue" }, interpreting: "the crimson cartridge" });
    const provider = scripted("echo", (purpose) => (purpose === "scope" ? versionCard : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "we just started with the crimson cartridge. is squirtle any good long term?", d);
    state = await say(state, "asdfgh jkl", d);
    expect(state.phase.kind).toBe("confirming-scope");
    const cards = state.transcript.filter((event) => event.kind === "proposal").length;
    const pending = state.phase.kind === "confirming-scope" ? state.phase.proposal.id : undefined;

    state = await say(state, "qwerty uiop", d);
    // No second card: the pending one keeps its identity, and the trainer is
    // pointed back at it rather than left in silence.
    expect(state.transcript.filter((event) => event.kind === "proposal")).toHaveLength(cards);
    expect(state.phase.kind === "confirming-scope" && state.phase.proposal.id).toBe(pending);
    expect(state.notes.some((n) => n.detail?.includes("card restated"))).toBe(true);
  });
});

describe("porch round six: the listing keeps to its subject", () => {
  it("'show me all the fire types' nominated as a listing mints the fire roster, never the catalogue", async () => {
    const provider = scripted("nominator", (purpose) => (purpose === "answer" ? listingNomination("catalogue") : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "show me all the fire types", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    const members = record.manifest?.claims.filter((claim) => claim.kind === "membership") ?? [];
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((claim) => claim.kind === "membership" && claim.rosterId === "fire-pokemon")).toBe(true);
    expect(record.manifest?.rosters[0]?.memberIds).toContain("charmander");
    expect(record.manifest?.rosters[0]?.memberIds).not.toContain("squirtle");
  });

  it("a catalogue-subject nomination is held to the ask's own qualifiers", async () => {
    const nomination = JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 10 }] });
    const provider = scripted("nominator", (purpose) => (purpose === "answer" ? nomination : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "list every water pokemon you certify", d);
    state = await say(state, "Red and Blue", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.rosters[0]?.id).toBe("water-pokemon");
    expect(record.manifest?.rosters[0]?.memberIds).not.toContain("charmander");
  });

  it("two types named stands the mint down — a blend is not a set the words picked", async () => {
    const provider = scripted("mute", () => "decline");
    const state = await say(startSession(), "show me the fire and water types", deps(provider));
    // The mint refused; the model path (mute) abstained — never a wrong set.
    expect(state.records.every((record) => (record.manifest?.claims.filter((c) => c.kind === "membership").length ?? 0) === 0)).toBe(true);
  });

  it("'what can you do?' never replays the previous listing", async () => {
    // The widened cue briefly made bare "what" a listing verb, and the meta
    // question reused the fire roster from the exchange before it.
    const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-can-you-ask" }] });
    const provider = new ScriptedProvider("teacher", (request) =>
      request.purpose !== "answer" ? "decline" : request.prompt.includes("what can you do") ? lesson : listingNomination("catalogue"),
    );
    const d = deps(provider);
    let state = await say(startSession(), "show me all the fire types", d);
    state = await say(state, "Red and Blue", d);
    state = await say(state, "what can you do?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.claims.some((claim) => claim.kind === "membership")).toBe(false);
  });

  it("a qualified ask never keeps a catalogue-set membership or count (the wrong-set guard)", async () => {
    // Porch round seven: with the doors already subject-correct, the model
    // composed the wrong set itself — all-species memberships for a
    // learns-move ask. Certified-true members, wrong set; the guard drops
    // them and an honest pass beats the wrong certificate.
    const wrongSet = JSON.stringify({
      rosters: [{ id: "all-species", criteria: { all: [] } }],
      claims: [
        { kind: "membership", rosterId: "all-species", entityId: "bulbasaur", asserted: true },
        { kind: "count", rosterId: "all-species" },
      ],
    });
    const provider = scripted("lazy", (purpose) => (purpose === "answer" ? wrongSet : "decline"));
    const d = deps(provider);
    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. which pokemon can learn fly?", d);
    expect(state.records.every((record) => (record.manifest?.claims.filter((c) => c.kind === "membership").length ?? 0) === 0)).toBe(true);

    // And the bare catalogue ask keeps its listing — scope wording upstream
    // of the set noun does not unbare it.
    state = await say(state, "so how many species are there?", d);
    const record = state.records[state.records.length - 1];
    expect(record?.outcome.status).toBe("answered");
  });

  it("a greeting gets a greeting — never the redirect", async () => {
    const provider = scripted("mute", () => "decline");
    const state = await say(startSession(), "yo whats up", deps(provider));
    const last = state.notes[state.notes.length - 1];
    expect(last?.tone).toBe("social");
    expect(last?.text).toContain("Advisor");
  });

  it("the activation gauge: served, stood-down and guard-dropped are tallied", async () => {
    const wrongSet = JSON.stringify({
      rosters: [{ id: "all-species", criteria: { all: [] } }],
      claims: [{ kind: "membership", rosterId: "all-species", entityId: "bulbasaur", asserted: true }],
    });
    const provider = new ScriptedProvider("lazy", (request) =>
      request.purpose !== "answer" ? "decline" : request.prompt.includes("learn fly") ? wrongSet : listingNomination("catalogue"),
    );
    const d = deps(provider);

    // A served listing nomination…
    let state = await say(startSession(), "what are the Pokemon species?", d);
    state = await say(state, "Red and Blue", d);
    expect(state.listingActivations.served).toBeGreaterThanOrEqual(1);

    // …a qualified ask that stands the mint down and then trips the guard…
    state = await say(state, "which pokemon can learn fly?", d);
    expect(state.listingActivations.guardDropped).toBeGreaterThanOrEqual(1);

    // …and the rate's parts always reconcile: consulted ≥ served + stoodDown.
    const t = state.listingActivations;
    expect(t.consulted).toBeGreaterThanOrEqual(t.served + t.stoodDown);
  });

  it("the provenance question gets the provenance answer", async () => {
    const provider = scripted("mute", () => "decline");
    const state = await say(startSession(), "what data do you use?", deps(provider));
    const last = state.notes[state.notes.length - 1];
    expect(last?.tone).toBe("social");
    expect(last?.text).toContain("certified snapshot");
  });
});

describe("teach before interrogating — the lazy half of IA-1", () => {
  const lessonAnswer = JSON.stringify({
    rosters: [],
    claims: [{ kind: "explanation", blockId: "what-is-badge" }],
  });

  it("commits a lesson on the first message, no scope questions asked, and the record is grantless", async () => {
    const provider = scripted("teacher", (purpose) => (purpose === "answer" ? lessonAnswer : "decline"));
    const state = await say(startSession(), "What's a badge?", deps(provider));

    // No interrogation happened: the exchange settled without a single
    // recorded question, and the filed record carries no grant, because
    // nothing personalized was released.
    expect(state.transcript.some((event) => event.kind === "question")).toBe(false);
    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.grant).toBeUndefined();
    expect(record.manifest?.scopeGrantId).toBeUndefined();
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-badge" }]);

    // A grantless lesson has a page to show like any other answer: the display
    // page renders from the manifest alone, so the app shows the lesson text and
    // not just a bare provenance banner.
    expect(state.pages[record.id]).toBeDefined();

    // The grantless record replays like any other (IA-10).
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("falls to the pack's question when the model has nothing to teach", async () => {
    const provider = scripted("silent", () => "decline");
    const state = await say(startSession(), "Where can I catch Abra?", deps(provider));
    // The teaching attempt was made and discarded; the interrogation begins
    // only after it — the ask costs one question, never a wrong commit.
    expect(state.transcript.some((event) => event.kind === "question")).toBe(true);
    expect(state.records).toHaveLength(0);
  });

  it("cannot launder advice through the grantless door — the mixed draft is discarded, not committed", async () => {
    const smuggled = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "explanation", blockId: "what-is-badge" },
        { kind: "recommendation", entityId: "pikachu" },
      ],
    });
    const provider = scripted("smuggler", (purpose) => (purpose === "answer" ? smuggled : "decline"));
    const state = await say(startSession(), "What's a badge?", deps(provider));
    // The session discards the mixed draft (the kernel would refuse it by
    // name anyway — the crucible proves that leg) and the ladder proceeds.
    expect(state.records).toHaveLength(0);
    expect(state.transcript.some((event) => event.kind === "question")).toBe(true);
  });
});

it("a failed teaching attempt falls to the question and moves the failure counter", async () => {
  // The provider dies on the pre-scope attempt; the visitor still just gets
  // the pack's question, and the meter says a call failed.
  const provider = new FailingProvider("flaky");
  const state = await say(startSession(), "What's a badge?", deps(provider));
  expect(state.transcript.some((event) => event.kind === "question")).toBe(true);
  expect(state.providerErrors).toBeGreaterThan(0);
});

describe("the driver's ledger — every step of an exchange, in fixed wording, beside the record (issue #158)", () => {
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;
  const codes = (steps: readonly { code: string }[]) => steps.map((entry) => entry.code);

  it("records a plain answered exchange end to end and closes it on the record", async () => {
    const provider = scripted("ledger", (purpose) => (purpose === "scope" ? "decline" : thunderboltAnswer()));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    expect(codes(state.steps)).toEqual(["trainer/profile", "note/social"]);
    state = await say(state, "What is Thunderbolt's power?", d);
    // The profile's acknowledgment closed as a passed exchange at the fresh ask.
    expect(state.exchanges.map((exchange) => exchange.outcome)).toEqual(["passed", "answered"]);
    const answered = state.exchanges[1]!;
    expect(answered.opening).toBe("What is Thunderbolt's power?");
    expect(answered.transactionId).toBe("session-1");
    // The scripted reply links nothing, and the trail says so.
    expect(codes(answered.steps)).toEqual(["trainer/said", "scope/granted", "model/answer", "linking/unlinked", "record/answered"]);
    expect(answered.steps.map((entry) => entry.lane)).toEqual(["trainer", "kernel", "model", "driver", "kernel"]);
    expect(answered.steps[4]!.text).toContain("1 claim(s) certified");
    expect(state.steps).toEqual([]);
  });

  it("is deterministic: the same scripted conversation twice writes the same ledger", async () => {
    const provider = scripted("ledger", (purpose) => (purpose === "scope" ? "decline" : thunderboltAnswer()));
    const run = async () => {
      const d = deps(provider);
      const state = await say(await setProfile(startSession(), PROFILE_SCOPE, d), "What is Thunderbolt's power?", d);
      return state.exchanges.map((exchange) => ({ ...exchange, steps: exchange.steps.map(({ at: _at, ...rest }) => rest) }));
    };
    expect(await run()).toEqual(await run());
  });

  it("carries the linking checks, a refused nomination, a clarification and the pick as steps", async () => {
    const contradicting = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-attack" }],
      rosters: [],
      claims: [{ kind: "route", routeId: "listing" }, { kind: "fact", entityId: "pikachu", factId: "base-attack" }],
    });
    const speed = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-speed" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }, { kind: "fact", entityId: "pikachu", factId: "base-hp" }],
    });
    let calls = 0;
    const provider = new ScriptedProvider("ledger", (request) => (request.purpose !== "answer" ? "decline" : (calls += 1) === 1 ? contradicting : speed));
    const d: SessionDeps = { ...deps(provider), clarify: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(state.phase.kind).toBe("clarifying");
    expect(codes(state.steps)).toEqual(["trainer/said", "scope/granted", "model/answer", "linking/contradiction", "clarify/asked"]);
    state = await say(state, "Speed", d);
    const trail = state.exchanges.at(-1)!;
    expect(trail.outcome).toBe("answered");
    expect(codes(trail.steps)).toEqual([
      "trainer/said", "scope/granted", "model/answer", "linking/contradiction", "clarify/asked",
      "trainer/said", "clarify/picked", "scope/granted", "model/answer", "linking/off-ask-dropped", "record/answered",
    ]);
    expect(trail.steps.find((entry) => entry.code === "linking/off-ask-dropped")?.count).toBe(1);
    expect(trail.steps.find((entry) => entry.code === "clarify/picked")?.text).toContain("Speed");
  });

  it("a nomination the driver refused is three steps — nominated, refused with the guard's reason, answered with the door shut — stamped between the calls", async () => {
    // The porch's "tell me about this game" (dogfood, 2026-09-13): the whole
    // first reply was a listing nomination, the driver refused it, and the
    // second reply taught the lesson. The trail read both calls under one
    // step with a suffix; it now reads three moves on three lanes.
    let calls = 0;
    const started: string[] = [];
    const provider = new ScriptedProvider("one-member", (request) => {
      if (request.purpose !== "answer") return "decline";
      calls += 1;
      started.push(new Date(1_700_000_000_000 + calls * 1000).toISOString());
      return calls === 1
        ? JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 1 }] })
        : JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-pokemon" }] });
    });
    // A clock that reads one second past the last model call, so the stamps
    // say which call each step followed.
    let ticks = 0;
    const d: SessionDeps = { ...deps(provider), now: () => new Date(1_700_000_000_000 + calls * 1000 + ++ticks).toISOString() };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what is a Pokemon", d);
    const trail = state.exchanges.at(-1)!;
    expect(trail.outcome).toBe("answered");
    expect(codes(trail.steps)).toEqual(["trainer/said", "scope/granted", "model/nominated", "route/refused", "model/answer", "linking/unlinked", "record/answered"]);
    const nominated = trail.steps.find((entry) => entry.code === "model/nominated")!;
    expect(nominated.lane).toBe("model");
    expect(nominated.text).toContain("nominated listing");
    expect(nominated.lines).toEqual(["listing(subject=catalogue, n=1)"]);
    const refused = trail.steps.find((entry) => entry.code === "route/refused")!;
    expect(refused.lane).toBe("driver");
    expect(refused.text).toContain("an enumeration of one is not an enumeration (n = 1)");
    expect(refused.text).toContain("the model asked once more");
    const answer = trail.steps.find((entry) => entry.code === "model/answer")!;
    expect(answer.text).toContain("the reply with the route door shut");
    // The nomination and the refusal were stamped after the first call and
    // before the second; the answer after the second.
    expect(nominated.at > started[0]! && nominated.at < started[1]!).toBe(true);
    expect(refused.at > started[0]! && refused.at < started[1]!).toBe(true);
    expect(answer.at > started[1]!).toBe(true);
    expect(state.nominationRetries).toBe(1);
  });

  it("a denial the kernel carried back is on the ledger in the kernel's own words, with the retry's reply as the step after it", async () => {
    const fabricated = JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "gym-badge", factId: "types" }] });
    const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-badge" }] });
    const provider = new ScriptedProvider("correcting", (request) =>
      request.purpose !== "answer" ? "decline" : request.prompt.includes("refused by the verifier") ? lesson : fabricated,
    );
    const d: SessionDeps = { ...deps(provider), feedback: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what's a gym badge?", d);
    const trail = state.exchanges.at(-1)!;
    expect(trail.outcome).toBe("answered");
    const sequence = codes(trail.steps);
    const at = sequence.indexOf("verdict/denied");
    expect(at).toBeGreaterThan(sequence.indexOf("model/answer"));
    expect(sequence[at + 1]).toBe("model/retry");
    const denied = trail.steps[at]!;
    expect(denied.lane).toBe("kernel");
    expect(denied.text).toContain("IA-3/fabricated-entity");
    expect(denied.lines).toHaveLength(1);
    expect(denied.lines![0]).toMatch(/^IA-3\/fabricated-entity: /);
    expect(denied.lines![0]).toContain('"gym-badge"');
    expect(trail.steps[at + 1]!.lane).toBe("model");
    expect(trail.steps[at + 1]!.text).toContain("the reply to the carry-back");
  });

  it("a reply the driver emptied is carried back with the driver's reasons on the step, and the retry's reply after it", async () => {
    const offAsk = JSON.stringify({
      asked: [{ phrase: "how many pp", entityId: "psychic", fieldId: "move-pp" }],
      rosters: [],
      claims: [{ kind: "route", routeId: "listing" }, { kind: "fact", entityId: "psychic", factId: "move-power" }],
    });
    const answered = JSON.stringify({
      asked: [{ phrase: "how many pp", entityId: "psychic", fieldId: "move-pp" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "psychic", factId: "move-pp" }],
    });
    let calls = 0;
    const provider = new ScriptedProvider("refused-route", (request) => (request.purpose !== "answer" ? "decline" : (calls += 1) === 1 ? offAsk : answered));
    const d: SessionDeps = { ...deps(provider), feedback: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "How many PP does Psychic have?", d);
    const trail = state.exchanges.at(-1)!;
    expect(trail.outcome).toBe("answered");
    const sequence = codes(trail.steps);
    const at = sequence.indexOf("reply/carried-back");
    expect(at).toBeGreaterThan(-1);
    expect(sequence[at + 1]).toBe("model/retry");
    expect(trail.steps[at]!.lines?.map((line) => line.split(":")[0])).toEqual(["driver/refused-route", "driver/off-ask"]);
  });

  it("closes an abstention as passed when the next ask opens, with the pass on its trail", async () => {
    const provider = scripted("ledger", (purpose) => (purpose === "scope" ? "decline" : JSON.stringify({ rosters: [], claims: [] })));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "What's the weather like?", d);
    expect(state.records).toHaveLength(0);
    expect(state.steps.map((entry) => entry.code)).toContain("note/abstention");
    state = await say(state, "What is Thunderbolt's power?", d);
    const passed = state.exchanges.find((exchange) => exchange.opening === "What's the weather like?")!;
    expect(passed.outcome).toBe("passed");
    expect(passed).not.toHaveProperty("transactionId");
  });
});

describe("R3b step 3: clarification — the model may ask, the trainer's pick binds", () => {
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;
  const withClarify = (provider: ModelProvider): SessionDeps => ({ ...deps(provider), clarify: true });

  const fieldClarify = JSON.stringify({
    asked: [],
    rosters: [],
    claims: [
      {
        kind: "clarify",
        about: "is it strong",
        question: "Do you mean how hard Pikachu hits, or how fast it is?",
        options: [
          { kind: "field", label: "how hard it hits", fieldId: "base-attack" },
          { kind: "field", label: "how fast it is", fieldId: "base-speed" },
          { kind: "field", label: "something else", fieldId: "none" },
        ],
      },
    ],
  });
  const speedAndAttack = JSON.stringify({
    asked: [{ phrase: "is it strong", entityId: "pikachu", fieldId: "base-attack" }],
    rosters: [],
    claims: [
      { kind: "fact", entityId: "pikachu", factId: "base-attack" },
      { kind: "fact", entityId: "pikachu", factId: "base-speed" },
    ],
  });

  /** Clarifies on the first answer call, answers on every later one, and
   * keeps every answer prompt it was shown. */
  function clarifyingThenAnswering(answer: string, clarification = fieldClarify): { provider: ModelProvider; prompts: string[] } {
    const prompts: string[] = [];
    let calls = 0;
    const provider = new ScriptedProvider("clarifying", (request) => {
      if (request.purpose !== "answer") return "decline";
      prompts.push(request.prompt);
      calls += 1;
      return calls === 1 ? clarification : answer;
    });
    return { provider, prompts };
  }

  it("a nominated clarification is a recorded event with typed options, and the exchange waits for the pick", async () => {
    const { provider, prompts } = clarifyingThenAnswering(speedAndAttack);
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    expect(state.records).toHaveLength(0);
    expect(state.phase.kind).toBe("clarifying");
    const event = state.transcript[state.transcript.length - 1];
    expect(event?.kind).toBe("clarification");
    if (event?.kind === "clarification") {
      expect(event.source).toBe("advisor");
      expect(event.text).toBe("Do you mean how hard Pikachu hits, or how fast it is?");
      expect(event.options.map((option) => (option.kind === "field" ? option.fieldId : option.entityId))).toEqual(["base-attack", "base-speed", null]);
    }
    expect(state.clarification).toMatchObject({ asked: 1, picked: 0 });
    // The grammar offered the door: the prompt carries the instruction.
    expect(prompts[0]).toContain('"kind": "clarify"');
  });

  it("the pick binds: claims are held to the picked field whatever the model linked, and the record replays", async () => {
    const { provider, prompts } = clarifyingThenAnswering(speedAndAttack);
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    state = await say(state, "how fast it is", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.map((claim) => (claim.kind === "fact" ? `${claim.entityId}.${claim.factId}` : claim.kind))).toEqual(["pikachu.base-speed"]);
    expect(verifyReplay(world, record).allowed).toBe(true);
    expect(state.clarification).toMatchObject({ asked: 1, picked: 1 });
    expect(state.linking.offTargetDropped).toBe(1);
    expect(state.phase.kind).toBe("gathering");
    // The second call was shown the advisor's own question and the pick, in
    // order, labelled as the advisor's.
    expect(prompts[1]).toContain('(you asked them: "Do you mean how hard Pikachu hits, or how fast it is?"');
    expect(prompts[1]).toContain("how fast it is");
    // The record's transcript carries the clarification whole.
    expect(record.transcript.some((event) => event.kind === "clarification")).toBe(true);
  });

  it("a pick by alias binds too — 'speed' picks the Speed option", async () => {
    const { provider } = clarifyingThenAnswering(speedAndAttack);
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    state = await say(state, "speed", d);
    expect(state.records[0]?.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.factId : claim.kind))).toEqual(["base-speed"]);
  });

  it("picking 'none of these' about a certified subject teaches the records' boundary", async () => {
    const { provider } = clarifyingThenAnswering(speedAndAttack);
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    state = await say(state, "something else", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: world.pack.recordsBoundary?.lessonId }]);
    expect(state.notes.some((n) => n.tone === "abstention" && n.text.includes("something else"))).toBe(true);
  });

  it("a subject pick drops claims about any other certified subject", async () => {
    const entityClarify = JSON.stringify({
      rosters: [],
      claims: [
        {
          kind: "clarify",
          about: "the electric mouse",
          question: "Which one do you mean?",
          options: [
            { kind: "entity", label: "Pikachu", entityId: "pikachu" },
            { kind: "entity", label: "Raichu", entityId: "raichu" },
          ],
        },
      ],
    });
    const both = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "raichu", fieldId: "base-speed" }],
      rosters: [],
      claims: [
        { kind: "fact", entityId: "pikachu", factId: "base-speed" },
        { kind: "fact", entityId: "raichu", factId: "base-speed" },
      ],
    });
    const { provider } = clarifyingThenAnswering(both, entityClarify);
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is the electric mouse?", d);
    expect(state.phase.kind).toBe("clarifying");
    state = await say(state, "Raichu", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.entityId : claim.kind))).toEqual(["raichu"]);
    expect(state.linking.offTargetDropped).toBe(1);
  });

  it("a reply matching no option is asked again once, then the honest pass — counted as ignored", async () => {
    const { provider } = clarifyingThenAnswering(speedAndAttack);
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    state = await say(state, "hmm, the usual", d);
    expect(state.phase.kind).toBe("clarifying");
    expect(state.notes[state.notes.length - 1]?.text).toContain("I still need to know which you meant");
    expect(state.clarification.ignored).toBe(1);
    state = await say(state, "you know what I mean", d);
    expect(state.phase.kind).toBe("gathering");
    expect(state.records).toHaveLength(0);
    expect(state.notes[state.notes.length - 1]?.tone).toBe("abstention");
    expect(state.clarification.ignored).toBe(2);
    expect(state.usage.calls).toBe(1);
  });

  it("a fresh ask over the advisor's question is drift, not a pick", async () => {
    const { provider } = clarifyingThenAnswering(thunderboltAnswer());
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    state = await say(state, "what is Thunderbolt's power?", d);
    expect(state.notes.some((n) => n.text.startsWith("New question"))).toBe(true);
    expect(state.records[0]?.outcome.status).toBe("answered");
    expect(state.clarification.picked).toBe(0);
  });

  it("a pleasantry keeps the question armed", async () => {
    const { provider } = clarifyingThenAnswering(speedAndAttack);
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    state = await say(state, "thanks", d);
    expect(state.phase.kind).toBe("clarifying");
  });

  it("the chain is capped at two per ask: a third clarification falls to the honest pass naming the phrase", async () => {
    const always = new ScriptedProvider("always-asking", (request) => (request.purpose === "answer" ? fieldClarify : "decline"));
    const d = withClarify(always);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    state = await say(state, "speed", d);
    expect(state.phase.kind).toBe("clarifying");
    expect(state.clarification.asked).toBe(2);
    state = await say(state, "speed", d);
    expect(state.phase.kind).toBe("gathering");
    expect(state.records).toHaveLength(0);
    expect(state.notes[state.notes.length - 1]?.text).toContain('"is it strong"');
    expect(state.clarification).toMatchObject({ asked: 2, picked: 2, capped: 1 });
  });

  it("an option outside the enums is dropped, and a clarification with none left is dropped whole", async () => {
    const bad = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "clarify", about: "how tall", question: "Its height?", options: [{ kind: "field", label: "its height", fieldId: "height" }, { kind: "entity", label: "Missingno", entityId: "missingno" }] },
      ],
    });
    const provider = new ScriptedProvider("bad-options", (request) => (request.purpose === "answer" ? bad : "decline"));
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how tall is Pikachu?", d);
    expect(state.phase.kind).toBe("gathering");
    expect(state.records).toHaveLength(0);
    expect(state.transcript.some((event) => event.kind === "clarification")).toBe(false);
    expect(state.notes[state.notes.length - 1]?.text).toContain('"how tall"');
    expect(state.clarification.asked).toBe(0);
  });

  it("a question that states a number is not shown; the driver's wording over the same options is", async () => {
    const numbered = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "clarify", about: "is it strong", question: "Its Attack is 55 — did you mean that, or Speed?", options: [{ kind: "field", label: "Attack", fieldId: "base-attack" }, { kind: "field", label: "Speed", fieldId: "base-speed" }] },
      ],
    });
    const { provider } = clarifyingThenAnswering(speedAndAttack, numbered);
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    const event = state.transcript[state.transcript.length - 1];
    expect(event?.kind).toBe("clarification");
    if (event?.kind === "clarification") {
      expect(event.text).not.toContain("55");
      expect(event.text).toContain("Attack, Speed");
    }
  });

  it("with the door shut, a scripted clarification is read as the claims beside it", async () => {
    const mixed = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "clarify", about: "x", question: "Which?", options: [{ kind: "field", label: "Speed", fieldId: "base-speed" }] },
        { kind: "fact", entityId: "pikachu", factId: "base-speed" },
      ],
    });
    const provider = new ScriptedProvider("shut", (request) => (request.purpose === "answer" ? mixed : "decline"));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(state.records[0]?.outcome.status).toBe("answered");
    expect(state.transcript.some((event) => event.kind === "clarification")).toBe(false);
  });

  it("R3 under the door: an alias contradiction becomes a question with the fields as options, and the pick binds", async () => {
    const contradicting = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-attack" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-attack" }],
    });
    let calls = 0;
    const provider = new ScriptedProvider("contradicting", (request) => {
      if (request.purpose !== "answer") return "decline";
      calls += 1;
      return calls === 1 ? contradicting : speedAndAttack;
    });
    const d = withClarify(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(state.phase.kind).toBe("clarifying");
    const event = state.transcript[state.transcript.length - 1];
    if (event?.kind === "clarification") {
      expect(event.options).toEqual([
        { kind: "field", label: "Attack", fieldId: "base-attack" },
        { kind: "field", label: "Speed", fieldId: "base-speed" },
      ]);
    }
    expect(state.linking.contradictions).toBe(1);
    state = await say(state, "Speed", d);
    expect(state.records[0]?.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.factId : claim.kind))).toEqual(["base-speed"]);
  });

  it("an alias contradiction the reply already answers both ways is a union, not a question (2026-09-11)", async () => {
    // "how fast" linked to Attack carries Speed's words — but the reply
    // certifies both facts, so both are within the ask and no one is asked.
    const both = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-attack" }],
      rosters: [],
      claims: [
        { kind: "fact", entityId: "pikachu", factId: "base-attack" },
        { kind: "fact", entityId: "pikachu", factId: "base-speed" },
      ],
    });
    const d = withClarify(scripted("union", (purpose) => (purpose === "scope" ? "decline" : both)));
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(state.phase.kind).toBe("gathering");
    expect(state.records[0]?.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.factId : claim.kind)).sort()).toEqual(["base-attack", "base-speed"]);
    expect(state.linking).toMatchObject({ unions: 1, contradictions: 0, offTargetDropped: 0 });
    expect(state.usage.calls).toBe(1);
  });

  it("with the feedback round open, a contradiction is carried back once before anyone is asked — and the union on the retry answers it", async () => {
    const contradicting = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-attack" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-attack" }],
    });
    // The retry keeps the model's reading of the phrase and adds the other
    // fact — the union then answers both readings.
    const bothReadings = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-attack" }],
      rosters: [],
      claims: [
        { kind: "fact", entityId: "pikachu", factId: "base-attack" },
        { kind: "fact", entityId: "pikachu", factId: "base-speed" },
      ],
    });
    const feedbackSeen: string[] = [];
    let calls = 0;
    const provider = new ScriptedProvider("carried-back", (request) => {
      if (request.purpose !== "answer") return "decline";
      calls += 1;
      if (request.prompt.includes("driver/ambiguous-field")) feedbackSeen.push(request.prompt);
      return calls === 1 ? contradicting : bothReadings;
    });
    const d: SessionDeps = { ...withClarify(provider), feedback: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(feedbackSeen).toHaveLength(1);
    expect(feedbackSeen[0]).toContain("carries the words of Speed");
    expect(state.phase.kind).toBe("gathering");
    expect(state.records[0]?.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.factId : claim.kind)).sort()).toEqual(["base-attack", "base-speed"]);
    expect(state.feedbackRetries).toBe(1);
    expect(state.feedbackDenials).toEqual(["driver/ambiguous-field"]);
    expect(state.linking).toMatchObject({ unions: 1, contradictions: 0 });
  });

  it("a contradiction that survives the carried-back round is then asked — one model call before one trainer question", async () => {
    const contradicting = JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-attack" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-attack" }],
    });
    const d: SessionDeps = { ...withClarify(scripted("stubborn", (purpose) => (purpose === "scope" ? "decline" : contradicting))), feedback: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    expect(state.usage.calls).toBe(2);
    expect(state.phase.kind).toBe("clarifying");
    expect(state.linking).toMatchObject({ unions: 0, contradictions: 1 });
    expect(state.feedbackRetries).toBe(1);
  });

  it("a refused nomination beside an off-ask claim is carried back, not passed (live, 2026-09-11: 'How many PP does Psychic have?')", async () => {
    const refusedAndOff = JSON.stringify({
      asked: [{ phrase: "how many pp", entityId: "psychic", fieldId: "move-pp" }],
      rosters: [],
      // The listing door refuses an ask naming a certified subject; the one
      // claim beside it is about a field the mapping did not link.
      claims: [{ kind: "route", routeId: "listing" }, { kind: "fact", entityId: "psychic", factId: "move-power" }],
    });
    const answered = JSON.stringify({
      asked: [{ phrase: "how many pp", entityId: "psychic", fieldId: "move-pp" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "psychic", factId: "move-pp" }],
    });
    let calls = 0;
    const provider = new ScriptedProvider("refused-route", (request) => {
      if (request.purpose !== "answer") return "decline";
      calls += 1;
      return calls === 1 ? refusedAndOff : answered;
    });
    const d: SessionDeps = { ...deps(provider), feedback: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "How many PP does Psychic have?", d);
    expect(state.records[0]?.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.factId : claim.kind))).toEqual(["move-pp"]);
    expect(state.feedbackRetries).toBe(1);
    expect(state.feedbackDenials).toEqual(["driver/refused-route", "driver/off-ask"]);
    // Without the round, the same reply is the honest pass it always was.
    calls = 0;
    const closed = deps(provider);
    let plain = await setProfile(startSession(), PROFILE_SCOPE, closed);
    plain = await say(plain, "How many PP does Psychic have?", closed);
    expect(plain.records).toHaveLength(0);
    expect(plain.notes.at(-1)?.detail).toContain("dropped every claim (1) as off the asked fields");
  });

  it("the pack's scope question is phrased by the model, armed for the same dimension, with the vocabulary's values as options", async () => {
    const phrased = "To look up how fast Pikachu is I need to know which game you're on — which version are you playing?";
    const provider = new ScriptedProvider("phrasing", (request) => {
      if (request.purpose === "phrase") return JSON.stringify({ question: phrased });
      if (request.purpose === "answer") return JSON.stringify({ asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-speed" }], rosters: [], claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }] });
      return "decline";
    });
    const d = withClarify(provider);
    let state = await say(startSession(), "how fast is Pikachu?", d);
    expect(state.phase).toMatchObject({ kind: "asking", dimension: "version", question: phrased, options: ["red-blue", "yellow"] });
    const question = state.transcript.find((event) => event.kind === "question");
    expect(question?.kind === "question" && question.text).toBe(phrased);
    expect(state.clarification.phrased).toBe(1);
    // A bare click on an option binds — the recorded question is the context.
    state = await say(state, "red-blue", d);
    expect(state.records[0]?.outcome.status).toBe("answered");
    expect(state.records[0]?.grant?.scope.version).toBe("red-blue");
  });

  it("an unusable rewrite asks the pack's own line, and a repeat is not rephrased", async () => {
    let phraseCalls = 0;
    const provider = new ScriptedProvider("bad-phrasing", (request) => {
      if (request.purpose === "phrase") {
        phraseCalls += 1;
        return JSON.stringify({ question: "Pikachu's Speed is 90. Which version?" });
      }
      if (request.purpose === "answer") return JSON.stringify({ asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-speed" }], rosters: [], claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }] });
      return "decline";
    });
    const d = withClarify(provider);
    let state = await say(startSession(), "how fast is Pikachu?", d);
    const packQuestion = world.pack.vocabulary.dimensions.find((rule) => rule.dimension === "version")?.question;
    expect(state.phase).toMatchObject({ kind: "asking", question: packQuestion });
    expect(state.clarification).toMatchObject({ phrased: 0, unphrased: 1 });
    expect(phraseCalls).toBe(1);
    state = await say(state, "hmm", d);
    // Restated, not re-asked, and no second phrase call (the ladder's own
    // call on the unreadable words is the pre-existing path).
    expect(state.transcript.filter((event) => event.kind === "question")).toHaveLength(1);
    expect(phraseCalls).toBe(1);
  });

  it("with the door shut the pack's line is asked and no phrase call is made", async () => {
    const provider = scripted("plain", (purpose) => (purpose === "phrase" ? "unreachable" : purpose === "scope" ? "decline" : thunderboltAnswer()));
    const state = await say(startSession(), "What is Thunderbolt's power?", deps(provider));
    expect(state.phase.kind).toBe("asking");
    expect(state.clarification).toMatchObject({ phrased: 0, unphrased: 0 });
  });
});

describe("dogfood stop 2 (2026-09-05): what the first clarification runs found", () => {
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;

  it("a one-word ask-parameter utterance is not the bare catalogue ask — the listing door stands down", async () => {
    // Weak model: "speed" after a closed exchange nominated the catalogue
    // listing and was served ten species and a count. The word binds the
    // comparison basis, so its clause vanished from the bareness reading.
    const nominate = JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 10 }] });
    const provider = new ScriptedProvider("bare-speed", (request) => (request.purpose === "answer" ? nominate : "decline"));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "speed", d);
    expect(state.records).toHaveLength(0);
    expect(state.listingActivations.served).toBe(0);
  });

  it("a clarification beside a refused nomination goes through without the route-door-closed retry", async () => {
    const both = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "route", routeId: "listing", subject: "catalogue", n: 10 },
        { kind: "clarify", about: "is it strong", question: "Attack, or Speed?", options: [{ kind: "field", label: "Attack", fieldId: "base-attack" }, { kind: "field", label: "Speed", fieldId: "base-speed" }] },
      ],
    });
    const provider = new ScriptedProvider("route-and-clarify", (request) => (request.purpose === "answer" ? both : "decline"));
    const d: SessionDeps = { ...deps(provider), clarify: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "is Pikachu strong?", d);
    expect(state.phase.kind).toBe("clarifying");
    expect(state.usage.calls).toBe(1);
    expect(state.nominationRetries).toBe(0);
  });
});

describe("R3b step 4: follow-up suggestions — a next step beside every answer, the model's own and uncertified", () => {
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;
  const withSuggest = (provider: ModelProvider): SessionDeps => ({ ...deps(provider), suggest: true });
  const suggesting = (asks: readonly string[]) =>
    JSON.stringify({
      asked: [{ phrase: "how fast", entityId: "pikachu", fieldId: "base-speed" }],
      rosters: [],
      claims: [{ kind: "fact", entityId: "pikachu", factId: "base-speed" }, { kind: "suggest", asks }],
    });

  it("the suggestions ride into the manifest and onto the certified page, in a labelled register the affidavit covers", async () => {
    const provider = scripted("suggesting", (purpose) => (purpose === "scope" ? "decline" : suggesting(["What is it weak to?", "How does it evolve?"])));
    const d = withSuggest(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.suggestions).toEqual(["What is it weak to?", "How does it evolve?"]);
    expect(verifyReplay(world, record).allowed).toBe(true);
    const page = JSON.stringify(state.pages[record.id]);
    expect(page).toContain('"data-unit":"suggestions"');
    expect(page).toContain('"data-suggestion":"1"');
    expect(page).toContain("What is it weak to?");
    expect(page).toContain("suggestions.lead");
    expect(state.suggestions).toMatchObject({ offered: 2, kept: 2, dropped: 0 });
  });

  it("a suggestion that states a number or names a certified id is dropped, and the answer still certifies", async () => {
    const provider = scripted("valuing", (purpose) =>
      // The decoder already caps the list at three; the guard reads what it kept.
      purpose === "scope" ? "decline" : suggesting(["What is it weak to?", "what is it weak to?", "Does it reach 90?", "Is it faster than Raichu?"]),
    );
    const d = withSuggest(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.suggestions).toEqual(["What is it weak to?"]);
    expect(state.suggestions).toMatchObject({ offered: 3, kept: 1, dropped: 2 });
  });

  it("a suggestion said back is counted as taken and answered like any ask", async () => {
    const provider = scripted("suggesting", (purpose) => (purpose === "scope" ? "decline" : suggesting(["What is it weak to?"])));
    const d = withSuggest(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    state = await say(state, "What is it weak to?", d);
    expect(state.suggestions.taken).toBe(1);
    expect(state.records).toHaveLength(2);
    state = await say(state, "how tall is it?", d);
    expect(state.suggestions.taken).toBe(1);
  });

  it("with the door shut, a scripted suggestion is stripped and nothing reaches the manifest", async () => {
    const provider = scripted("suggesting", (purpose) => (purpose === "scope" ? "decline" : suggesting(["What is it weak to?"])));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how fast is Pikachu?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.suggestions).toBeUndefined();
    expect(state.suggestions).toEqual({ offered: 0, kept: 0, dropped: 0, taken: 0, deadEnded: 0 });
  });

  it("the answer reached through the version question carries suggestions too", async () => {
    const provider = scripted("suggesting", (purpose) => (purpose === "scope" ? "decline" : suggesting(["What is it weak to?"])));
    const d = withSuggest(provider);
    let state = await say(startSession(), "how fast is Pikachu?", d);
    expect(state.phase.kind).toBe("asking");
    state = await say(state, "red-blue", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.suggestions).toEqual(["What is it weak to?"]);
    // Discovery, then the answer hop after the question intervened.
    expect(state.usage.calls).toBe(2);
  });

  it("a grantless lesson carries its suggestions too", async () => {
    const lesson = JSON.stringify({
      rosters: [],
      claims: [{ kind: "explanation", blockId: "what-is-badge" }, { kind: "suggest", asks: ["How do I earn one?"] }],
    });
    const provider = scripted("teaching", (purpose) => (purpose === "scope" ? "decline" : lesson));
    const state = await say(startSession(), "what's a badge?", withSuggest(provider));
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.suggestions).toEqual(["How do I earn one?"]);
    expect(verifyReplay(world, record).allowed).toBe(true);
  });
});

describe("the suggestion door is offered to the model exactly when it is open", () => {
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;
  function prompted(): { provider: ModelProvider; prompts: string[]; schemas: string[] } {
    const prompts: string[] = [];
    const schemas: string[] = [];
    const provider = new ScriptedProvider("prompted", (request) => {
      if (request.purpose !== "answer") return "decline";
      prompts.push(request.prompt);
      schemas.push(JSON.stringify(request.schema?.schema ?? {}));
      return thunderboltAnswer();
    });
    return { provider, prompts, schemas };
  }

  it("with suggest on, the prompt asks for a next step and the grammar admits it; off, neither", async () => {
    const open = prompted();
    let state = await setProfile(startSession(), PROFILE_SCOPE, { ...deps(open.provider), suggest: true });
    state = await say(state, "What is Thunderbolt's power?", { ...deps(open.provider), suggest: true });
    expect(state.records).toHaveLength(1);
    expect(open.prompts[0]).toContain('"kind": "suggest"');
    expect(open.schemas[0]).toContain('"suggest"');

    const shut = prompted();
    let plain = await setProfile(startSession(), PROFILE_SCOPE, deps(shut.provider));
    plain = await say(plain, "What is Thunderbolt's power?", deps(shut.provider));
    expect(plain.records).toHaveLength(1);
    expect(shut.prompts[0]).not.toContain('"kind": "suggest"');
    expect(shut.schemas[0]).not.toContain('"suggest"');
  });
});

describe("dogfood stop 3 (2026-09-06): the train wreck, three asks long", () => {
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 5 } as const;

  it("a listing of one is not a listing: the nomination is refused and the retry teaches the lesson", async () => {
    // "what is a Pokemon" drew {listing, catalogue, n: 1} and was served
    // Bulbasaur and a count of 151 — the bareness reading cannot see it.
    let calls = 0;
    const provider = new ScriptedProvider("one-member", (request) => {
      if (request.purpose !== "answer") return "decline";
      calls += 1;
      return calls === 1
        ? JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 1 }] })
        : JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-pokemon" }] });
    });
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what is a Pokemon", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-pokemon" }]);
    expect(state.listingActivations.served).toBe(0);
    expect(state.nominationRetries).toBe(1);
    // A real sample still composes.
    const ten = new ScriptedProvider("ten", (request) =>
      request.purpose === "answer" ? JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "listing", subject: "catalogue", n: 10 }] }) : "decline",
    );
    let listed = await setProfile(startSession(), PROFILE_SCOPE, deps(ten));
    listed = await say(listed, "what are the pokemon species?", deps(ten));
    expect(listed.listingActivations.served).toBe(1);
  });

  it("an anaphoric ask is shown what the previous certified answer was about, read from the record", async () => {
    // "tell me more about this specie" right after a page showing Bulbasaur:
    // the model was shown only the trainer's earlier words, invented
    // Pikachu, and every fact fell as off the ask.
    const prompts: string[] = [];
    let calls = 0;
    const provider = new ScriptedProvider("anaphoric", (request) => {
      if (request.purpose !== "answer") return "decline";
      prompts.push(request.prompt);
      calls += 1;
      return calls === 1
        ? JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "bulbasaur", factId: "types" }] })
        : JSON.stringify({ rosters: [], claims: [{ kind: "route", routeId: "profile", entityId: "bulbasaur" }] });
    });
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what type is Bulbasaur?", d);
    expect(prompts[0]).not.toContain("previous certified answer");
    state = await say(state, "tell me more about this specie", d);
    expect(prompts[1]).toContain("The previous certified answer the trainer is looking at was about: bulbasaur.");
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.every((claim) => claim.kind === "fact" && claim.entityId === "bulbasaur")).toBe(true);
    // An ask that names its own subject is shown nothing of the sort.
    state = await say(state, "what type is Pikachu?", d);
    expect(prompts[2]).not.toContain("previous certified answer");
  });
});

describe("dogfood stop 3, the second cause: a subject the model supplied from nowhere is not the records' boundary", () => {
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 5 } as const;
  const inventedProfile = JSON.stringify({
    asked: [{ phrase: "this specie", entityId: "pikachu", fieldId: "none" }],
    rosters: [],
    claims: ["pokedex-number", "types", "base-hp", "base-speed"].map((factId) => ({ kind: "fact", entityId: "pikachu", factId })),
  });

  it("with no named antecedent, the reply falls to the anaphoric redirect — no boundary note, no lesson about a stranger", async () => {
    let calls = 0;
    const provider = new ScriptedProvider("inventing", (request) => {
      if (request.purpose !== "answer") return "decline";
      calls += 1;
      return calls === 1 ? JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-pokemon" }] }) : inventedProfile;
    });
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what is a Pokemon", d);
    state = await say(state, "that's not what I asked, but tell me more about this specie", d);
    expect(state.records).toHaveLength(1);
    const last = state.notes[state.notes.length - 1];
    expect(last?.text).toContain("I lost the thread");
    expect(state.notes.some((n) => n.text.includes("pikachu"))).toBe(false);
    expect(state.linking.offTargetDropped).toBe(4);
  });

  it("the boundary still teaches when the trainer named the subject, or was just shown it", async () => {
    const provider = scripted("honest", (purpose) =>
      purpose === "scope" ? "decline" : JSON.stringify({ asked: [{ phrase: "how tall", entityId: "onix", fieldId: "none" }], rosters: [], claims: [] }),
    );
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "how tall is Onix?", d);
    expect(state.records[0]?.manifest?.claims).toEqual([{ kind: "explanation", blockId: world.pack.recordsBoundary?.lessonId }]);

    // Shown it: the previous page was about Bulbasaur, and "how tall is it" is about Bulbasaur.
    let calls = 0;
    const shown = new ScriptedProvider("shown", (request) => {
      if (request.purpose !== "answer") return "decline";
      calls += 1;
      return calls === 1
        ? JSON.stringify({ rosters: [], claims: [{ kind: "fact", entityId: "bulbasaur", factId: "types" }] })
        : JSON.stringify({ asked: [{ phrase: "how tall", entityId: "bulbasaur", fieldId: "none" }], rosters: [], claims: [] });
    });
    const s = deps(shown);
    let after = await setProfile(startSession(), PROFILE_SCOPE, s);
    after = await say(after, "what type is Bulbasaur?", s);
    after = await say(after, "how tall is it?", s);
    expect(after.records[1]?.manifest?.claims).toEqual([{ kind: "explanation", blockId: world.pack.recordsBoundary?.lessonId }]);
    expect(after.notes.some((n) => n.text.includes('"how tall" for bulbasaur'))).toBe(true);
  });
});

describe("dogfood stop 3, the dead end (2026-09-06): a reply the driver emptied is carried back once", () => {
  const PROFILE_SCOPE = { version: "red-blue", region: "kanto", badgeLevel: 4 } as const;
  const noSubject = JSON.stringify({
    asked: [{ phrase: "the question", entityId: "none", fieldId: "none" }],
    rosters: [],
    claims: [{ kind: "action", tool: "add-to-team", entityId: "none" }],
  });
  const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-pokemon" }] });

  function emptiedThenTeaching(): { provider: ModelProvider; prompts: string[] } {
    const prompts: string[] = [];
    const provider = new ScriptedProvider("emptied", (request) => {
      if (request.purpose !== "answer") return "decline";
      prompts.push(request.prompt);
      return request.prompt.includes("driver/no-subject") ? lesson : noSubject;
    });
    return { provider, prompts };
  }

  it("on the answer hop: the refusal is named, the second reply teaches, and the round is counted as a feedback retry", async () => {
    const { provider, prompts } = emptiedThenTeaching();
    const d: SessionDeps = { ...deps(provider), feedback: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what are Pokémon?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-pokemon" }]);
    expect(state.feedbackRetries).toBe(1);
    expect(state.feedbackDenials).toEqual(["driver/no-subject", "driver/off-ask"]);
    expect(prompts[1]).toContain('a claim named "none" as its subject');
    expect(state.usage.calls).toBe(2);
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("on the discovery hop too, before any scope is gathered", async () => {
    const { provider } = emptiedThenTeaching();
    const state = await say(startSession(), "what are Pokémon?", { ...deps(provider), feedback: true });
    expect(state.records[0]?.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-pokemon" }]);
    expect(state.feedbackRetries).toBe(1);
  });

  it("a reply the model itself left empty is not carried back — there is nothing to correct", async () => {
    const empty = JSON.stringify({ asked: [{ phrase: "the weather", entityId: "weather", fieldId: "none" }], rosters: [], claims: [] });
    const provider = scripted("empty", (purpose) => (purpose === "scope" ? "decline" : empty));
    const d: SessionDeps = { ...deps(provider), feedback: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "what's the weather like?", d);
    expect(state.records).toHaveLength(0);
    expect(state.feedbackRetries).toBe(0);
    expect(state.usage.calls).toBe(1);
  });

  it("with feedback off the emptied reply falls to the redirect — and 'lost the thread' only for an ask that points back", async () => {
    const provider = scripted("stuck", (purpose) => (purpose === "scope" ? "decline" : noSubject));
    const d = deps(provider);
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "tell me about the game", d);
    state = await say(state, "what are Pokémon?", d);
    expect(state.notes[state.notes.length - 1]?.text).toContain("couldn't line that up");
    state = await say(state, "what are they good for?", d);
    expect(state.notes[state.notes.length - 1]?.text).toContain("I lost the thread");
  });

  it("a suggestion taken and then dead-ended is counted", async () => {
    let calls = 0;
    const provider = new ScriptedProvider("dead-end", (request) => {
      if (request.purpose !== "answer") return "decline";
      calls += 1;
      return calls === 1
        ? JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-game" }, { kind: "suggest", asks: ["what are Pokémon?"] }] })
        : noSubject;
    });
    const d: SessionDeps = { ...deps(provider), suggest: true };
    let state = await setProfile(startSession(), PROFILE_SCOPE, d);
    state = await say(state, "tell me about the game", d);
    state = await say(state, "what are Pokémon?", d);
    expect(state.suggestions).toMatchObject({ taken: 1, deadEnded: 1 });
  });
});

describe("a clarification needs a choice: one option is not a question (found by the R3b step 5 baseline leg, 2026-09-06)", () => {
  // 15 of the 25 questions the strong model nominated on the bank carried a
  // single option — "Which field do you mean?" over the reserved none alone,
  // "did you mean Move type?" — a hedge worded as a question, which the
  // truthful trainer could only decline twice. There is nothing to pick from
  // one option; the reply is read as the mapping and the claims beside it.
  const PROFILE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;

  it("a lone null-field option falls to the null-link reading — the records' boundary is taught and no question is asked", async () => {
    const hedge = JSON.stringify({
      asked: [{ phrase: "what ability", entityId: "pikachu", fieldId: "none" }],
      rosters: [],
      claims: [
        {
          kind: "clarify",
          about: "What ability does Pikachu have?",
          question: "Which field do you mean?",
          options: [{ kind: "field", label: "something else", fieldId: "none" }],
        },
      ],
    });
    const provider = scripted("hedger", (purpose) => (purpose === "answer" ? hedge : "decline"));
    const d: SessionDeps = { ...deps(provider), clarify: true };
    let state = await setProfile(startSession(), PROFILE, d);
    state = await say(state, "What ability does Pikachu have?", d);
    expect(state.clarification.asked).toBe(0);
    expect(state.transcript.some((event) => event.kind === "clarification")).toBe(false);
    expect(state.phase.kind).toBe("gathering");
    expect(state.records.at(-1)?.manifest?.claims).toEqual([{ kind: "explanation", blockId: world.pack.recordsBoundary!.lessonId }]);
  });

  it("a lone field option is read as the claims beside it — the count is certified, no question is asked", async () => {
    const hedge = JSON.stringify({
      // (The phrase carries no dictionary alias, so the alias cross-check —
      // which asks its own question — stays out of this test.)
      asked: [{ phrase: "how many are there", entityId: "psychic", fieldId: "none" }],
      rosters: [{ id: "psychic-kanto", criteria: { all: [{ kind: "has-type", type: "psychic" }] } }],
      claims: [
        { kind: "count", rosterId: "psychic-kanto" },
        {
          kind: "clarify",
          about: "How many Psychic types are there?",
          question: "Did you mean Move type?",
          options: [{ kind: "field", label: "Move type", fieldId: "move-type" }],
        },
      ],
    });
    const provider = scripted("hedger", (purpose) => (purpose === "answer" ? hedge : "decline"));
    const d: SessionDeps = { ...deps(provider), clarify: true };
    let state = await setProfile(startSession(), PROFILE, d);
    state = await say(state, "How many Psychic types are there?", d);
    expect(state.clarification.asked).toBe(0);
    expect(state.records.at(-1)?.outcome.status).toBe("answered");
    expect(state.records.at(-1)?.manifest?.claims.map((claim) => claim.kind)).toEqual(["count"]);
  });

  it("two options are still a question", async () => {
    const question = JSON.stringify({
      asked: [],
      rosters: [],
      claims: [
        {
          kind: "clarify",
          about: "its type",
          question: "Do you mean the species' type, or a move's type?",
          options: [
            { kind: "field", label: "the species' type", fieldId: "types" },
            { kind: "field", label: "a move's type", fieldId: "move-type" },
          ],
        },
      ],
    });
    const provider = scripted("asker", (purpose) => (purpose === "answer" ? question : "decline"));
    const d: SessionDeps = { ...deps(provider), clarify: true };
    let state = await setProfile(startSession(), PROFILE, d);
    state = await say(state, "what's its type?", d);
    expect(state.clarification.asked).toBe(1);
    expect(state.phase.kind).toBe("clarifying");
  });
});

describe("a lesson with a null link and no subject is taught, not questioned (found by the R3b step 5 leg, 2026-09-06)", () => {
  const PROFILE = { version: "red-blue", region: "kanto", badgeLevel: 8 } as const;

  it("'What is evolution?' — the model links none about nothing and teaches the lesson; the alias cross-check stays silent", async () => {
    // The strong model's actual reply (raw-reply dump, 2026-09-06). Before
    // this, "evolution" — an alias of evolves-to — made the driver ask "did
    // you mean Evolves into?", a one-option question with no subject to
    // answer it about, and the right lesson never reached the trainer.
    const reply = JSON.stringify({
      asked: [{ phrase: "What is evolution?", entityId: "none", fieldId: "none" }],
      rosters: [],
      claims: [{ kind: "explanation", blockId: "what-is-evolution" }],
    });
    const provider = scripted("teacher", (purpose) => (purpose === "answer" ? reply : "decline"));
    const d: SessionDeps = { ...deps(provider), clarify: true };
    let state = await setProfile(startSession(), PROFILE, d);
    state = await say(state, "What is evolution?", d);
    expect(state.clarification.asked).toBe(0);
    expect(state.linking.contradictions).toBe(0);
    expect(state.records.at(-1)?.outcome.status).toBe("answered");
    expect(state.records.at(-1)?.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-evolution" }]);
  });

  it("the same word about a certified subject is still a question — 'what does Eevee evolve into' linked to none", async () => {
    const reply = JSON.stringify({
      asked: [{ phrase: "what does it evolve into", entityId: "eevee", fieldId: "none" }],
      rosters: [],
      claims: [],
    });
    const provider = scripted("hedger", (purpose) => (purpose === "answer" ? reply : "decline"));
    const d: SessionDeps = { ...deps(provider), clarify: true };
    let state = await setProfile(startSession(), PROFILE, d);
    state = await say(state, "what does Eevee evolve into?", d);
    expect(state.linking.contradictions).toBe(1);
    expect(state.phase.kind).toBe("clarifying");
  });
});
