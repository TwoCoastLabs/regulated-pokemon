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

describe("the deflected profile: a lesson cannot answer for a named species (epic #118 dogfooding)", () => {
  const deflection = JSON.stringify({
    rosters: [],
    claims: [{ kind: "explanation", blockId: "what-is-pokemon" }],
  });

  it("certifies the species profile instead of the adjacent lesson, one model call", async () => {
    // Observed live: "tell me about Pikachu" decoded to the generic
    // what-is-pokemon lesson on the fast model, and the retry deflected the
    // same way. The route reads the ask deterministically: one named
    // species + an all-lesson draft = the entity's certified profile,
    // through scope like any personalized answer.
    let answerCalls = 0;
    const provider = scripted("deflector", (purpose) => {
      if (purpose !== "answer") return "decline";
      answerCalls += 1;
      return deflection;
    });
    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. Tell me about Pikachu!", deps(provider));

    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    const kinds = record.manifest?.claims.map((claim) => claim.kind) ?? [];
    expect(kinds).not.toContain("explanation");
    expect(record.manifest?.claims.every((claim) => claim.kind === "fact" && claim.entityId === "pikachu")).toBe(true);
    expect(record.manifest?.claims.map((claim) => (claim.kind === "fact" ? claim.factId : ""))).toContain("base-speed");
    // The discovery call is the only model call: the profile rode the
    // needs-scope -> granted hop and was certified without a re-ask.
    expect(answerCalls).toBe(1);
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("asks the pack's own question when the routed profile needs scope — the ladder is never consulted", async () => {
    // Observed live: with no version established, the ladder read "tell me
    // about Pikachu" and proposed version=yellow from nothing; the confirmed
    // card died at the gate (IA-2/scope-version-mismatch). A routed draft's
    // ask was about an entity, not scope — there is no vague wording to
    // interpret, so the deterministic question outranks the model (hard-won
    // lesson 1). The scope purpose must never be consulted on this path.
    let scopeCalls = 0;
    const provider = scripted("deflector", (purpose) => {
      if (purpose === "scope") {
        scopeCalls += 1;
        return JSON.stringify({ candidate: { version: "yellow" }, interpreting: "tell me about Pikachu" });
      }
      return deflection;
    });
    const d = deps(provider);

    let state = await say(startSession(), "Tell me about Pikachu!", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    expect(scopeCalls).toBe(0);

    // The direct answer to the recorded question binds deterministically;
    // the answer-hop backstop routes the second deflection to the profile.
    state = await say(state, "Red and Blue", d);
    expect(state.records).toHaveLength(1);
    expect(state.records[0]!.outcome.status).toBe("answered");
    expect(state.records[0]!.manifest?.claims.every((claim) => claim.kind === "fact" && claim.entityId === "pikachu")).toBe(true);
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

  it("still teaches an ordinary lesson across the boundary", async () => {
    const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-badge" }] });
    const provider = scripted("teacher", (purpose) => (purpose === "answer" ? lesson : "decline"));
    const d = deps(provider);

    let state = await say(startSession(), "tell me about Squirtle", d);
    state = await say(state, "yellow", d);
    state = await say(state, "what is a badge?", d);

    expect(state.records).toHaveLength(2);
    expect(state.records[1]!.outcome.status).toBe("answered");
    expect(state.records[1]!.manifest?.claims).toEqual([{ kind: "explanation", blockId: "what-is-badge" }]);
  });
});

describe("an anaphoric follow-up carries its antecedent (found live, 2026-08-31)", () => {
  it("shows the model the prior ask when the current words name nothing, and the listing certifies", async () => {
    // "can you list at least 10 for me?" reached the model bare and could
    // only abstain — ten of what? The gate: only an ask naming no species
    // and no type gets the earlier words appended, so every subject-naming
    // ask keeps its clean single-ask prompt.
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
      return countAnswer;
    });
    const d = deps(provider);

    let state = await say(startSession(), "I'm playing Red and Blue in Kanto. how many species are out there?", d);
    expect(state.records).toHaveLength(1);
    state = await say(state, "can you list at least 10 for me?", d);

    // The listing is composed from the record — the previous exchange's
    // certified roster — with no model call at all: the weak model, handed
    // the antecedent live, still passed, and the set was never in its head.
    expect(answerCalls).toBe(1);
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
      return countAnswer;
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

  it("mints the catalogue roster for a bare species-listing ask, even with no roster on file", async () => {
    // Found live: lesson, lesson, "give me a list of those species" — no
    // roster in the record, route stood down, model abstained twice. A bare
    // listing ask about species/Pokémon wants the catalogue itself, which
    // the kernel already spells as the empty criteria list.
    const lesson = JSON.stringify({ rosters: [], claims: [{ kind: "explanation", blockId: "what-is-pokemon" }] });
    let answerCalls = 0;
    const provider = new ScriptedProvider("scripted:lessons", (request) => {
      if (request.purpose !== "answer") return "decline";
      answerCalls += 1;
      return lesson;
    });
    const d = deps(provider);

    let state = await say(startSession(), "tell me about this game", d);
    const callsBefore = answerCalls;
    state = await say(state, "give me a list of those species", d);
    // Membership reads the registry, so the listing rightly costs a version
    // question first — the pack's own, never the ladder.
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);

    expect(answerCalls).toBe(callsBefore); // composed from the registry, no model call
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.filter((claim) => claim.kind === "membership")).toHaveLength(10);
    expect(record.manifest?.claims.some((claim) => claim.kind === "count")).toBe(true);
  });

  it("answers 'what are the Pokemon species?' as the listing it is, not an adjacent lesson", async () => {
    const provider = scripted("mute", () => "decline");
    const d = deps(provider);
    let state = await say(startSession(), "ok. what are the Pokemon species?", d);
    expect(state.phase.kind === "asking" && state.phase.dimension).toBe("version");
    state = await say(state, "Red and Blue", d);
    const record = state.records[0]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims.some((claim) => claim.kind === "membership")).toBe(true);
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
