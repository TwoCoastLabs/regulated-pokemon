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

  it("'whats the rarest pokemon?' mints the legendary roster and lists it", async () => {
    const provider = scripted("mute", () => "decline");
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

describe("R3: the records' boundary is taught, never substituted for", () => {
  const boundaryLesson = () => world.pack.recordsBoundary?.lessonId;

  it("a question about a thing the records do not hold gets the boundary lesson — no model call, on the discovery hop", async () => {
    let calls = 0;
    const provider = scripted("mute", () => { calls += 1; return "decline"; });
    const state = await say(startSession(), "how tall is Onix?", deps(provider));
    expect(calls).toBe(0);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    expect(record.manifest?.claims).toEqual([{ kind: "explanation", blockId: boundaryLesson() }]);
    expect(verifyReplay(world, record).allowed).toBe(true);
  });

  it("with scope pre-set, the boundary still outranks the model on the answer hop", async () => {
    let calls = 0;
    const provider = scripted("mute", () => { calls += 1; return "decline"; });
    const d = deps(provider);
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    state = await say(state, "what's Snorlax's weight?", d);
    expect(calls).toBe(0);
    expect(state.records[state.records.length - 1]?.manifest?.claims[0]).toMatchObject({ kind: "explanation", blockId: boundaryLesson() });
  });

  it("a boundary word beside a species AND a move is a learnset question — the model owns it", async () => {
    let calls = 0;
    const provider = scripted("mute", () => { calls += 1; return "decline"; });
    await say(startSession(), "playing red. does pikachu have the ability to learn surf?", deps(provider));
    expect(calls).toBeGreaterThan(0);
  });

  it("the model's own 'unavailable' closes the exchange as an honest pass that names the boundary", async () => {
    const unavailable = JSON.stringify({ rosters: [], claims: [{ kind: "unavailable", entityId: "onix", asked: "cry" }] });
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : unavailable));
    const d = deps(provider);
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    // "noise" is not a boundary token, so this is the model's own abstention, not the pack's door.
    state = await say(state, "what noise does Onix make?", d);
    expect(state.records).toHaveLength(0);
    const last = state.notes[state.notes.length - 1];
    expect(last?.tone).toBe("abstention");
    expect(last?.text).toContain("cry for onix");
    expect(last?.detail).toContain("uncertified");
    expect(state.phase.kind).toBe("gathering");
  });

  it("'unavailable' beside real claims rides along as a note while the claims certify", async () => {
    const partial = JSON.stringify({
      rosters: [],
      claims: [
        { kind: "fact", entityId: "onix", factId: "types" },
        { kind: "unavailable", entityId: "onix", asked: "cry" },
      ],
    });
    const provider = scripted("honest", (purpose) => (purpose === "scope" ? "decline" : partial));
    const d = deps(provider);
    let state = await setProfile(startSession(), { version: "red-blue", region: "kanto", badgeLevel: 8 }, d);
    state = await say(state, "what type is Onix, and what noise does it make?", d);
    const record = state.records[state.records.length - 1]!;
    expect(record.outcome.status).toBe("answered");
    // The kernel fills the certified value on commit; the shape is what the test pins.
    expect(record.manifest?.claims).toHaveLength(1);
    expect(record.manifest?.claims[0]).toMatchObject({ kind: "fact", entityId: "onix", factId: "types" });
    expect(state.notes.some((n) => n.detail?.includes("uncertified"))).toBe(true);
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
    const provider = scripted("ranker", (purpose) => (purpose === "scope" ? "decline" : ranking));
    const d = deps(provider);
    // Scope from its own exchange, as the live trainer gave it. (A version
    // statement sharing the listing ask's utterance un-bares it for the
    // door — one more door edge of the class docs/routing.md R3 retires.)
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
  it("'show me all the fire types' mints the fire roster, never the catalogue", async () => {
    const provider = scripted("mute", () => "decline");
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
    const provider = scripted("teacher", (purpose) => (purpose === "answer" ? lesson : "decline"));
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
    const provider = scripted("lazy", (purpose) => (purpose === "answer" ? wrongSet : "decline"));
    const d = deps(provider);

    // A served cue listing…
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
