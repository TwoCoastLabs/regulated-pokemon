/**
 * The live session: the visitor as the trainer, a real model as the Advisor,
 * the bundled certified world as the ground, and the kernel in this tab as
 * the gate — the same `runTransaction` CI runs, driven by src/session.
 *
 * Two registers, one page. The chat speaks to a *player*: what happened and
 * what to do next, in trainer's terms, with no article codes or digests in
 * the primary copy (src/ui/plain.ts is that voice, tested like the page copy
 * it is). The **compliance console** is one toggle away and speaks the
 * League's own words — stage verdicts, scope pins, kernel messages, digests,
 * the filed record itself. Where a formal term must surface in the player
 * register (an article chip on a refusal), it carries its explanation as a
 * widget, reusing the article registry's real-world analogs.
 *
 * Two ways to power the Advisor. When the deployment carries the League's
 * relay (src/relay — probed via its health door), a visitor needs nothing:
 * calls go browser → relay → provider, the hosted key never enters the tab,
 * and the relay's own caps do the rationing. Bring-your-own-key stays as the
 * other mode, and the only one on a static deployment: the key lives in
 * component state for the duration of the session, is sent only to
 * openrouter.ai by the same driver the billable harness uses (which scrubs it
 * from every error it raises), and is never persisted, logged, or sent
 * anywhere else. Either way it is the same driver, the same session module,
 * the same kernel — the modes differ in one URL and who pays.
 */
import { useEffect, useMemo, useState } from "preact/hooks";

import { proposalDigest } from "../../src/harness/advisor.js";
import {
  ADVERSARY_PERSONA,
  DEFAULT_STRONG_MODEL,
  DEFAULT_WEAK_MODEL,
  HONEST_PERSONA,
} from "../../src/harness/models.js";
import { OpenRouterProvider } from "../../src/harness/openrouter.js";
import type { ModelProvider } from "../../src/harness/provider.js";
import type { DomElement } from "../../src/kernel/dom.js";
import type { Transaction } from "../../src/kernel/transaction.js";
import {
  decideAct,
  decideScope,
  retry,
  say,
  setProfile,
  type ScopeProposal,
  type ClarificationEvent,
  type SessionDeps,
  type SessionNote,
  type SessionState,
  startSession,
} from "../../src/session/session.js";
import { agentReport, createDevTrace, type DevTrace, type DevTraceMeta, type ModelCallStart, type ModelCallTrace } from "../../src/session/devtrace.js";
import type { DriverStep } from "../../src/session/ledger.js";
import { adaptArtifact } from "../../src/ui/artifact-dom.js";
import { plainCandidate, plainRefusalLead, plainStage, plainViolation } from "../../src/ui/plain.js";
import { progressLine } from "../../src/ui/progress.js";
import { claimSource } from "./world.js";
import { type SentBack, sentBack, trailsOfSession, withCalls } from "../../src/ui/trail.js";
import { violationView } from "../../src/ui/viewmodel.js";
import { browserFactory } from "./mount.js";
import { DoorLegend } from "./doors.js";
import { MemoryPanel } from "./memory.js";
import { DevCall, Trails } from "./trail.js";
import { demoWorld, precedentStore } from "./world.js";

/** Strictly increasing, because the kernel orders the moments it records and
 * a wall clock is allowed to repeat a millisecond. */
function makeClock(): () => string {
  let last = 0;
  return () => {
    const t = Math.max(Date.now(), last + 1);
    last = t;
    return new Date(t).toISOString();
  };
}

type Persona = "honest" | "adversarial";

/** Who pays for the model: the deployment's relay, or the visitor's key. */
type KeyMode = "league" | "own";

interface LiveSetup {
  provider: ModelProvider;
  model: string;
  persona: Persona;
  mode: KeyMode;
  /** The tap on the provider seam — always recording, in tab memory only.
   * The dev view decides whether it is *shown* (and mirrored), never whether
   * it exists, so a bug found late is still a bug with a trace. */
  trace: DevTrace;
}

/** What the relay's health door said, once asked. `null` while asking. */
interface RelayStatus {
  ready: boolean;
  models: readonly string[];
}

/** The relay lives on the same origin as the served app; a static deployment
 * simply has no such door, and the probe falls back to bring-your-own-key. */
const RELAY_HEALTH = "/api/relay/health";
export const RELAY_CHAT_URL = "/api/relay/chat";

async function probeRelay(): Promise<RelayStatus> {
  try {
    const reply = await fetch(RELAY_HEALTH);
    if (!reply.ok) return { ready: false, models: [] };
    const body = (await reply.json()) as { ok?: unknown; models?: unknown };
    const models = Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === "string") : [];
    return body.ok === true && models.length > 0 ? { ready: true, models } : { ready: false, models: [] };
  } catch {
    return { ready: false, models: [] };
  }
}

// --- chat derivation --------------------------------------------------------

type ChatItem =
  | { at: string; kind: "visitor"; text: string }
  | { at: string; kind: "question"; text: string }
  | { at: string; kind: "clarification"; clarification: ClarificationEvent }
  | { at: string; kind: "proposal"; proposal: ScopeProposal }
  | { at: string; kind: "decision"; decision: "confirm" | "reject" }
  | { at: string; kind: "note"; note: SessionNote }
  | { at: string; kind: "record"; record: Transaction; page: DomElement | undefined };

function chatItems(state: SessionState): ChatItem[] {
  const items: ChatItem[] = [];
  for (const event of state.transcript) {
    if (event.kind === "utterance" && event.source === "trainer") {
      items.push({ at: event.at, kind: "visitor", text: event.text });
    } else if (event.kind === "question" && event.source === "advisor") {
      // Questions are transcript events — evidence the kernel reads (a direct
      // answer binds against them) and the chat's durable history at once: a
      // question the visitor has already answered still happened.
      items.push({ at: event.at, kind: "question", text: event.text });
    } else if (event.kind === "clarification" && event.source === "advisor") {
      // The Advisor's own question (R3b step 3): its wording is the model's,
      // its options are typed, and it sits in the transcript like the pack's
      // question does — a pick binds against the recorded options.
      items.push({ at: event.at, kind: "clarification", clarification: event });
    } else if (event.kind === "proposal") {
      items.push({ at: event.at, kind: "proposal", proposal: event });
    } else if (event.kind === "confirmation") {
      items.push({ at: event.at, kind: "decision", decision: event.decision });
    }
  }
  for (const note of state.notes) items.push({ at: note.at, kind: "note", note });
  for (const record of state.records) {
    items.push({ at: record.committedAt, kind: "record", record, page: state.pages[record.id] });
  }
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// --- pieces -----------------------------------------------------------------

/** A recorded page, mounted for real — same refusal-on-unmountable rule as
 * the ledger's exhibit: what is on screen must be what the record can say. */
function Page(props: { artifact: DomElement; onSuggest?: (text: string) => void }) {
  const [refusal, setRefusal] = useState<string | null>(null);
  // Progressive disclosure: the answer leads, the reassurance ceremony (the
  // "Your certified answer / every value was checked" header) is folded behind
  // the badge until asked for. The badge itself, and the provenance footer that
  // names the source, stay put — the certified *signal* and the mandatory
  // disclosure are always in view; only the restatement of trust collapses.
  const [revealed, setRevealed] = useState(false);

  const attach = (element: HTMLDivElement | null) => {
    if (element === null) return;
    try {
      element.replaceChildren(adaptArtifact(props.artifact, browserFactory));
      setRefusal(null);
    } catch (error) {
      element.replaceChildren();
      setRefusal(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <figure class={`exhibit${revealed ? " revealed" : ""}`}>
      <button
        type="button"
        class="exhibit-tag"
        aria-expanded={revealed}
        title="The League checked every value on this page against its own frozen copy of the official records. The Advisor cannot write a word here — it only fills approved slots. Click to read how it says so."
        onClick={() => setRevealed((value) => !value)}
      >
        <span aria-hidden="true">✓</span> Certified{" "}
        <span class="exhibit-tag-chev" aria-hidden="true">
          {revealed ? "▾" : "▸"}
        </span>
      </button>
      {refusal !== null && <p class="exhibit-refusal">{refusal}</p>}
      {/* The suggestion register (R3b step 4) is plain list items on the
          certified page — the mount allows no button — so the click is the
          page's: a suggestion clicked is said back as the trainer's own
          words, exactly as if typed. Live only under the latest answer. */}
      <div
        class={`exhibit-page${props.onSuggest === undefined ? "" : " suggestions-live"}`}
        ref={attach}
        onClick={(event) => {
          if (props.onSuggest === undefined) return;
          const item = (event.target as HTMLElement | null)?.closest("[data-suggestion]");
          const said = item?.textContent?.trim() ?? "";
          if (said !== "") props.onSuggest(said);
        }}
      />
    </figure>
  );
}

/** An article chip: the one formal token the player register keeps, wearing
 * its explanation — title, then the real-world analog — as a tooltip. */
function ArticleChip(props: { code: string; articleTitle: string; analog: string }) {
  return (
    <span class="stamp-code mono" title={`${props.articleTitle} — real-world analog: ${props.analog}`}>
      {props.code}
    </span>
  );
}

/** A copyable role tag on every turn: real text, not a CSS pseudo-element, so
 * "You" / "Advisor" survives a copy-paste of the transcript. */
function Role(props: { who: "you" | "advisor" }) {
  return <span class={`live-role ${props.who}`}>{props.who === "you" ? "You" : "Advisor"}</span>;
}

/**
 * The rounds an exchange sent back before the reply the visitor sees — the
 * kernel's denial carried back, the driver's refusals, a nomination refused
 * — read from the driver's ledger. Without this, a visitor who saw two model
 * calls for one answer had to guess whether the first went wrong; now the
 * chat says it, in the refuser's own words under a fold, and the trail
 * beside it shows the same rounds on their lanes.
 */
function SentBackNote(props: { rounds: readonly SentBack[] }) {
  const { rounds } = props;
  if (rounds.length === 0) return null;
  const byKernel = rounds.some((round) => round.by === "kernel");
  const byDriver = rounds.some((round) => round.by === "driver");
  const who = byKernel && byDriver ? "by the League and by the driver" : byKernel ? "by the League" : "by the driver";
  // Whether the Advisor was told: the difference between a reason fed back
  // and a door withdrawn in silence is the one a reader most often asks.
  const told = (mode: SentBack["mode"]): string =>
    mode === "fed-back"
      ? "The reasons were sent to the Advisor, and it was asked again."
      : mode === "withdrawn"
        ? "The option was withdrawn and the Advisor asked again — it was not told why."
        : "Nothing was re-asked; the rest of the reply stood on its own.";
  return (
    <details class="live-sent-back">
      <summary>
        {rounds.length === 1 ? "One refusal" : `${rounds.length} refusals`} {who} before this answer — open to see what was
        refused, and whether the Advisor was told.
      </summary>
      <ul>
        {rounds.map((round) => (
          <li>
            <span class="live-sent-back-who">{round.by === "kernel" ? "League" : "driver"}</span>
            <span>{round.text}</span>
            <span class={`live-sent-back-mode mode-${round.mode}`}>{told(round.mode)}</span>
            {round.reasons.length > 0 && (
              <ul class="mono">
                {round.reasons.map((reason) => (
                  <li>{reason}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RecordItem(props: {
  record: Transaction;
  page: DomElement | undefined;
  rounds: readonly SentBack[];
  onSuggest?: (text: string) => void;
}) {
  const { record, page } = props;
  const outcome = record.outcome;
  if (outcome.status === "denied") {
    const denials = outcome.violations.map(plainViolation);
    return (
      <div class="live-item advisor">
        <Role who="advisor" />
        <SentBackNote rounds={props.rounds} />
        <div class="live-denial">
          <p class="live-denial-lead">{plainRefusalLead(outcome.stage)}</p>
          <p class="live-denial-who">The League stepped in {plainStage(outcome.stage)}:</p>
          <ul>
            {denials.map((denial) => (
              <li>
                <span class="live-denial-detail">{denial.plain}</span>
                <ArticleChip code={denial.code} articleTitle={denial.articleTitle} analog={denial.analog} />
              </li>
            ))}
          </ul>
          <p class="fine">
            None of it ever reached you — that's the point. The full ruling is one click away under “Show the
            machinery”.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div class="live-item advisor">
      <Role who="advisor" />
      <SentBackNote rounds={props.rounds} />
      {page !== undefined && <Page artifact={page} {...(props.onSuggest === undefined ? {} : { onSuggest: props.onSuggest })} />}
      {/* The certified badge already carries the reassurance for a plain
          answer; only an act or a decline needs a word about what happened. */}
      {(outcome.status === "acted" || outcome.status === "declined") && (
        <p class={`outcome ${outcome.status === "declined" ? "quiet" : "ok"}`}>
          {outcome.status === "acted"
            ? "Done — exactly what the page showed, nothing more."
            : "No problem — nothing was done. The answer above still stands."}
        </p>
      )}
    </div>
  );
}

// --- the compliance console -------------------------------------------------

/** One settled exchange, in the League's own words: the formal identity the
 * player register deliberately leaves out. */
function ConsoleRecord(props: { record: Transaction }) {
  const { record } = props;
  const pins = Object.entries(record.grant?.scope ?? {});
  return (
    <section class="console-record">
      <h4 class="mono">{record.id}</h4>
      <p class="console-line mono">outcome: {record.outcome.status}</p>
      {pins.length > 0 && (
        <p class="console-line mono" title="the scope this answer was certified under">
          {pins.map(([dimension, value]) => `${dimension}=${String(value)}`).join(" · ")}
        </p>
      )}
      <ul class="console-stages">
        {record.verdicts.map((entry) => (
          <li class={entry.verdict.allowed ? "ok" : "refused"}>
            <span class="mono">{entry.stage}</span>
            {entry.verdict.allowed ? (
              <span class="console-ok">allowed</span>
            ) : (
              <ul class="console-violations">
                {entry.verdict.violations.map(violationView).map((view) => (
                  <li>
                    <ArticleChip code={view.code} articleTitle={view.articleTitle} analog={view.analog} />
                    <span class="console-message">{view.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {record.affidavit !== undefined && (
        <p class="console-line mono" title="digest of the visible content, from the affidavit">
          page {record.affidavit.artifactDigest}
        </p>
      )}
      {record.confirmation !== undefined && (
        <p class="console-line mono" title="the trainer's confirmation binds this exact digest">
          confirmed {record.confirmation.artifactDigest} at {record.confirmation.confirmedAt}
        </p>
      )}
    </section>
  );
}

function LiveConsole(props: { state: SessionState; setup: LiveSetup; live?: SessionState }) {
  const { state, setup } = props;
  const cost = state.usage;
  return (
    <section class="live-console" aria-label="Compliance console">
      <p class="fine">The same session, in the League's own words. Everything here is read from the filed records.</p>
      <p class="console-line mono">
        {setup.model} · {setup.persona} persona · {cost.calls} call{cost.calls === 1 ? "" : "s"} · $
        {cost.costUsd.toFixed(4)}
        {cost.costedCalls < cost.calls ? " (floor: some calls came back unpriced)" : ""} · {state.providerErrors}{" "}
        provider error{state.providerErrors === 1 ? "" : "s"}
      </p>
      {state.notes.length > 0 && (
        <ul class="console-notes">
          {state.notes.map((note) => (
            <li class="mono">
              [{note.tone}] {note.text}
            </li>
          ))}
        </ul>
      )}
      {/* The step trail (issue #158): every move of every exchange, on its
          lane, in the ledger's fixed wording — how the answer that shipped
          is the one that shipped. Read from the driver's ledger and the
          filed records; nothing here is narrated. */}
      <h4 class="console-heading">How each answer was made</h4>
      {props.live !== undefined && <InProgress />}
      <Trails trails={trailsOfSession(props.live ?? state, claimSource())} who="you" empty="No exchange has begun yet — each step lands here as the driver takes it." />
      <h4 class="console-heading">The filed records</h4>
      {state.records.length === 0 ? (
        <p class="fine">No exchange has settled yet — records appear here as they are filed.</p>
      ) : (
        state.records.map((record) => <ConsoleRecord record={record} />)
      )}
      <button
        type="button"
        class="live-download"
        disabled={state.records.length === 0}
        onClick={() => downloadRecord(state)}
      >
        Download session record
      </button>
      <p class="fine">
        The download carries the transcript and every filed record against the named snapshot and pack — enough for
        anyone to re-execute each exchange and reproduce these verdicts bit-for-bit.
      </p>
    </section>
  );
}

/** Which of the two machinery views the side pane shows. */
type Pane = "dev" | "console";

/** The dev-trace sink is a dev-server middleware; only the dev build mirrors
 * to it, and there it always does — a bug found with the console tab up is
 * still a bug with a trace. A build never sends the request at all. */
const MIRROR_TO_DEV_SINK = import.meta.env.DEV;

// --- the page ---------------------------------------------------------------

export function Live() {
  const [setup, setSetup] = useState<LiveSetup | null>(null);
  const [relay, setRelay] = useState<RelayStatus | null>(null);
  const [mode, setMode] = useState<KeyMode | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(DEFAULT_STRONG_MODEL);
  const [persona, setPersona] = useState<Persona>("honest");
  const [state, setState] = useState<SessionState>(startSession);
  const [draft, setDraft] = useState("");
  // The trainer's profile panel (epic #145, R2): typed scope set once, recorded
  // on the trainer channel as a profile event — no version question, no card.
  const [profileDraft, setProfileDraft] = useState({ version: "red-blue", region: "kanto", badgeLevel: 0 });
  // The profile form is open until a profile is on the record, then folds
  // to one line with a "change" — a later profile supersedes the earlier on
  // the record (kernel/scope.ts), so changing games mid-session costs no
  // question and no card. Found by dogfood (2026-09-13): a fold the visitor
  // had to open first, and a form that stayed after it was used.
  const [editingProfile, setEditingProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The message currently on its way through the driver, echoed immediately
   * so the visitor's words never vanish while the model is consulted. */
  const [inFlight, setInFlight] = useState<string | null>(null);
  // The exchange in progress (src/ui/progress.ts): the last step the driver
  // reported, with the state as it stood after it, and the model call in
  // flight. Both are observation — the driver reports each step as it takes
  // it and the tap announces each call as it begins — so the busy line and
  // the trail follow the exchange instead of waiting for it to return.
  // Cleared when the exchange settles: the settled state is the record.
  const [progress, setProgress] = useState<{ step: DriverStep; state: SessionState } | null>(null);
  const [callInFlight, setCallInFlight] = useState<ModelCallStart | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  // The machinery beside the chat: two views on one side pane, switched by
  // tab. The dev view (the step trail with every model call disclosed under
  // its step) is the default — the page is dogfooded far more than it is
  // demoed, and a dogfooder wants the calls in view before the first ask.
  // The compliance console is the same trail without the calls, plus the
  // filed records. One button hides the pane for a plain chat.
  const [machinery, setMachinery] = useState(true);
  const [pane, setPane] = useState<Pane>("dev");
  // The two recall doors, dogfoodable per session (docs/scale.md, S1): both
  // change only what the model is asked, never what may commit, so flipping
  // them mid-session is safe — the next exchange simply walks the other door.
  // On by default: the product posture the tracer and the banks measure
  // (findings §17, §19). Found by dogfood (2026-09-05): with both off, "which
  // pokemon is the fastest?" certified a type count and eight game rules the
  // gated grammar would never have offered — a live page measuring a
  // different system from the one the numbers describe.
  const [retrievalOn, setRetrievalOn] = useState(true);
  const [gatedOn, setGatedOn] = useState(true);
  // The precedent door (docs/precedent.md): on by default when the world
  // ships a store. Like the two above it changes only what the model is
  // asked, never what may commit.
  const [memoryOn, setMemoryOn] = useState(true);
  const clock = useMemo(makeClock, []);

  useEffect(() => {
    void probeRelay().then((status) => {
      setRelay(status);
      // The relay's model list is the allowlist; starting on it means the
      // default choice is one the relay will accept.
      if (status.ready && status.models[0] !== undefined) setModel(status.models[0]);
      setMode(status.ready ? "league" : "own");
    });
  }, []);

  const deps = useMemo<SessionDeps | null>(() => {
    if (setup === null) return null;
    return {
      world: demoWorld(),
      provider: setup.trace.tap(setup.provider),
      now: clock,
      // The verifier-in-the-loop retry is the product posture (docs/routing.md,
      // R3b): a denial the kernel can name is carried back to the model once.
      feedback: true,
      // Clarification (R3b step 3): the model may ask with typed options, a
      // pick binds, and the pack's scope question is phrased by the model.
      clarify: true,
      // Follow-up suggestions (R3b step 4): a next step beside every answer,
      // in a register the page labels as the Advisor's own, uncertified.
      suggest: true,
      ...(retrievalOn ? { retrieval: true } : {}),
      ...(gatedOn ? { gatedGrammar: true } : {}),
      ...(memoryOn && precedentStore() !== undefined ? { precedents: { store: precedentStore()! } } : {}),
      onStep: (step, state) => setProgress({ step, state }),
    };
  }, [setup, clock, retrievalOn, gatedOn, memoryOn]);

  const meta = useMemo<DevTraceMeta | null>(() => {
    if (setup === null) return null;
    const world = demoWorld();
    return {
      model: setup.model,
      mode: setup.mode,
      persona: setup.persona,
      snapshotId: world.registry.snapshot.id,
      packId: world.pack.id,
    };
  }, [setup]);

  const begin = () => {
    if (mode === null) return;
    try {
      const provider = new OpenRouterProvider({
        id: "live:session",
        model,
        // In league mode no key exists in this tab at all: the placeholder
        // satisfies the driver's fail-closed constructor, the relay ignores
        // it, and the real key is added server-side and scrubbed on return.
        apiKey: mode === "league" ? "league-relay" : key,
        ...(mode === "league" ? { url: RELAY_CHAT_URL } : {}),
        system: persona === "honest" ? HONEST_PERSONA : ADVERSARY_PERSONA,
        structured: true,
      });
      const trace = createDevTrace({
        now: clock,
        elapsedMs: () => performance.now(),
        onCallStart: (call) => setCallInFlight(call),
        onCall: (call) => {
          setCallInFlight(null);
          if (MIRROR_TO_DEV_SINK) mirrorToDevSink({ type: "model-call", ...call });
        },
      });
      setSetup({ provider, model, persona, mode, trace });
      setTrouble(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  };

  const run = (step: (previous: SessionState) => Promise<SessionState> | SessionState) => {
    if (deps === null || busy) return;
    setBusy(true);
    void Promise.resolve(step(state))
      .then((next) => {
        setState(next);
        if (MIRROR_TO_DEV_SINK && setup !== null && meta !== null) {
          mirrorToDevSink({
            type: "report",
            doors: { retrieval: retrievalOn, gatedGrammar: gatedOn, precedents: memoryOn && precedentStore() !== undefined },
            ...(agentReport(meta, next, setup.trace.calls) as object),
          });
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setTrouble(message);
        // The failing step still reaches the trace: without this, an error
        // that escapes to the banner leaves the sink with the model call but
        // no step context, and a debugger reading the file sees a cliff.
        if (MIRROR_TO_DEV_SINK) mirrorToDevSink({ type: "step-error", message });
      })
      .finally(() => {
        setBusy(false);
        setInFlight(null);
        setProgress(null);
        setCallInFlight(null);
      });
  };

  const send = () => {
    const text = draft.trim();
    if (text === "" || deps === null) return;
    setDraft("");
    setInFlight(text);
    run((previous) => say(previous, text, deps));
  };

  /** A click on an option says its label — the trainer's own utterance, on
   * the trainer's channel, read exactly as typed words would be. */
  const pick = (label: string) => {
    if (deps === null) return;
    setInFlight(label);
    run((previous) => say(previous, label, deps));
  };

  if (setup === null || deps === null) {
    const league = mode === "league";
    return (
      <div class="live">
        <section class="live-setup">
          <h2>Sit down with the Advisor</h2>
          <p>
            A real AI plays the League's Advisor, and the League — running right here in your tab — checks every
            answer against the official Pokédex records before you see it. The Advisor can charm; nothing it makes up
            can reach you.
          </p>
          {mode === null ? (
            <p class="fine">Checking whether this site carries the League's own key…</p>
          ) : (
            <>
              {relay?.ready === true && (
                <label>
                  Who pays for the model
                  <select
                    value={mode}
                    onInput={(event) => setMode(event.currentTarget.value === "own" ? "own" : "league")}
                  >
                    <option value="league">the League — free, rate-limited, capped for everyone daily</option>
                    <option value="own">you — bring your own OpenRouter key</option>
                  </select>
                </label>
              )}
              {league ? (
                <>
                  <p>
                    Nothing to bring: this site carries the League's own key. Your conversation goes from this tab to
                    the site's relay and on to the model — the key never enters your browser, and the relay rations
                    it so everyone gets a turn.
                  </p>
                  <label>
                    Model
                    <select value={model} onInput={(event) => setModel(event.currentTarget.value)}>
                      {(relay?.models ?? []).map((slug) => (
                        <option value={slug}>{slug}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Your Advisor
                    <select
                      value={persona}
                      onInput={(event) =>
                        setPersona(event.currentTarget.value === "adversarial" ? "adversarial" : "honest")
                      }
                    >
                      <option value="honest">plays fair — answers as well as it can</option>
                      <option value="adversarial">cheats — instructed to lie to you; watch the League catch it</option>
                    </select>
                  </label>
                  <button type="button" class="live-begin" onClick={begin}>
                    Start the session
                  </button>
                </>
              ) : (
                <>
                  <p>
                    This deployment is not carrying the League's key right now, so the Advisor has no model to speak
                    with. Everything else here runs without one — the crucible's sabotages and the filed records are
                    one tab away.
                  </p>
                  <details class="live-byok">
                    <summary>I have my own OpenRouter key</summary>
                    <p>
                      Your key powers the Advisor, stays in this tab's memory, is sent only to{" "}
                      <span class="mono">openrouter.ai</span>, and is never stored or logged. Live calls bill your
                      OpenRouter account (a short session costs well under a cent).
                    </p>
                    <label>
                      OpenRouter API key
                      <input
                        type="password"
                        value={key}
                        placeholder="sk-or-…"
                        onInput={(event) => setKey(event.currentTarget.value)}
                      />
                    </label>
                    <label>
                      Model
                      <input value={model} onInput={(event) => setModel(event.currentTarget.value)} list="live-models" />
                      <datalist id="live-models">
                        <option value={DEFAULT_STRONG_MODEL}>the measured strong model</option>
                        <option value={DEFAULT_WEAK_MODEL}>the measured weak model</option>
                      </datalist>
                    </label>
                    <label>
                      Your Advisor
                      <select
                        value={persona}
                        onInput={(event) =>
                          setPersona(event.currentTarget.value === "adversarial" ? "adversarial" : "honest")
                        }
                      >
                        <option value="honest">plays fair — answers as well as it can</option>
                        <option value="adversarial">cheats — instructed to lie to you; watch the League catch it</option>
                      </select>
                    </label>
                    <button type="button" class="live-begin" disabled={key.trim() === ""} onClick={begin}>
                      Start the session
                    </button>
                  </details>
                </>
              )}
            </>
          )}
          {trouble !== null && <p class="refusal-banner">{trouble}</p>}
          <p class="fine">
            The cheating Advisor is the fun one: it is under orders to slip a lie past the League in every answer. It
            hasn't managed it yet — not because models are bad at lying, but because the League looks every value up
            itself. Come watch it try.
          </p>
        </section>
      </div>
    );
  }

  const items = chatItems(state);
  const phase = state.phase;
  const cost = state.usage;
  // The profile on the record, latest first — what the next answer will be
  // certified under, read from the transcript rather than from the form.
  const profile = [...state.transcript].reverse().find((event) => event.kind === "profile");
  const profileOpen = profile === undefined || editingProfile;

  return (
    <div class="live">
      <div class="live-meta">
        <span class="mono">{setup.model}</span>
        <span class="live-persona">{setup.persona === "honest" ? "plays fair" : "cheats — watch the League"}</span>
        <span title={setup.mode === "league" ? "calls go through this site's relay; the key never enters your browser" : "your key, in this tab's memory only"}>
          {setup.mode === "league" ? "on the League's key" : "on your key"}
        </span>
        <span>
          {cost.calls} model call{cost.calls === 1 ? "" : "s"} · ${cost.costUsd.toFixed(4)} so far
        </span>
        <ModelLatency calls={setup.trace.calls} />
        <button
          type="button"
          class={`console-toggle${machinery ? " current" : ""}`}
          aria-pressed={machinery}
          title="the step trail, every model call, and the filed records — beside the chat"
          onClick={() => setMachinery(!machinery)}
        >
          {machinery ? "Hide the machinery" : "Show the machinery"}
        </button>
      </div>

      <div class={`live-panes${machinery ? " with-console" : ""}`}>
        <div class="live-chat">
          {items.length === 0 && inFlight === null && (
            <p class="live-hint">
              Set your game below — version, region, badges — then ask away; the League certifies answers for that
              game and no other. You can also just say it: “I'm playing Red and Blue, travelling around the Kanto
              region, and I have 8 badges. Which of the Electric ones is the quickest?”
            </p>
          )}
          {items.map((item, index) => {
            const latest = index === items.length - 1;
            switch (item.kind) {
              case "visitor":
                return (
                  <div class="live-item trainer">
                    <Role who="you" />
                    <p class="live-bubble trainer">{item.text}</p>
                  </div>
                );
              case "question": {
                // The pack's approved values as clicks under the question
                // that is still waiting: a click says the label, and the
                // recorded question is the context the kernel reads it in.
                const active = latest && phase.kind === "asking" && phase.question === item.text && !busy;
                return (
                  <div class="live-item advisor">
                    <Role who="advisor" />
                    <p class="live-bubble advisor">{item.text}</p>
                    {active && phase.options.length > 0 && (
                      <div class="live-actions live-options">
                        {phase.options.map((label) => (
                          <button type="button" class="quiet" onClick={() => pick(label)}>
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              case "clarification": {
                const active = latest && phase.kind === "clarifying" && phase.clarification.at === item.clarification.at && !busy;
                return (
                  <div class="live-item advisor">
                    <Role who="advisor" />
                    <p class="live-bubble advisor" title={`The Advisor's own question, about "${item.clarification.about}" — the options are typed against the certified records; your pick binds the answer to it.`}>
                      {item.clarification.text}
                    </p>
                    {active && (
                      <div class="live-actions live-options">
                        {item.clarification.options.map((option) => (
                          <button type="button" class="quiet" onClick={() => pick(option.label)}>
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              case "proposal": {
                const active = phase.kind === "confirming-scope" && phase.proposal.id === item.proposal.id && !busy;
                return (
                  <div class="live-item advisor">
                    <Role who="advisor" />
                    <div class="live-proposal">
                      <p
                        class="live-proposal-lead"
                        // The model's own account of what it read is provenance,
                        // not the trainer's words — quoting it in the question
                        // produced nested quotes around a sentence the visitor
                        // never said. The reading being confirmed is the bold
                        // part; the model's note rides along as a tooltip.
                        title={`The Advisor's reading of your words: ${item.proposal.interpreting}`}
                      >
                        Just to be sure — you mean <strong>{plainCandidate(item.proposal.candidate)}</strong>?
                      </p>
                      <p
                        class="fine"
                        title={`Your yes is sealed to this exact reading by a fingerprint (${proposalDigest(item.proposal).slice(0, 18)}…); an edited reading is a different one and your yes will not carry over.`}
                      >
                        Only your yes makes this stick — and it sticks to exactly this reading, nothing else.
                      </p>
                      {active && (
                        <div class="live-actions">
                          <button type="button" onClick={() => run((s) => decideScope(s, "confirm", deps))}>
                            Yes, that's what I meant
                          </button>
                          <button
                            type="button"
                            class="quiet"
                            onClick={() => run((s) => decideScope(s, "reject", deps))}
                          >
                            No — not that
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              case "decision":
                return (
                  <div class="live-item trainer">
                    <Role who="you" />
                    <p class="live-bubble decision">
                      {item.decision === "confirm" ? "Yes — that's what I meant." : "No — not that."}
                    </p>
                  </div>
                );
              case "note":
                return (
                  <div class="live-item advisor">
                    <Role who="advisor" />
                    <div class={`live-note ${item.note.tone}`}>
                      {/* The Advisor's own words lead — first person, plain,
                          per note; the fixed reassurance and the countable
                          diagnostic line are fine print beneath, not the
                          message a novice has to parse. */}
                      <p class="live-note-say">
                        {item.note.text}
                        {/* "try again" re-runs the exchange without the ask
                            being retyped — for a provider failure, which is
                            the one pause a retry can change. On a social
                            note (a profile acknowledged) it read as a
                            question mark; found by dogfood, 2026-09-13. */}
                        {latest && !busy && item.note.tone === "error" && (
                          <button type="button" class="live-retry" onClick={() => run((s) => retry(s, deps))}>
                            try again
                          </button>
                        )}
                      </p>
                      {item.note.tone !== "social" && (
                        <p class="fine" title={item.note.detail ?? item.note.text}>
                          {item.note.tone === "error"
                            ? "A connection problem, not a refusal — nothing was lost."
                            : "An honest pass, not a malfunction — nothing uncertified was shown."}
                        </p>
                      )}
                    </div>
                  </div>
                );
              case "record": {
                // The rounds this exchange sent back, from the ledger the
                // driver closed on this record.
                const exchange = state.exchanges.find((entry) => entry.transactionId === item.record.id);
                return (
                  <RecordItem
                    record={item.record}
                    page={item.page}
                    rounds={exchange === undefined ? [] : sentBack(exchange)}
                    {...(latest && !busy ? { onSuggest: pick } : {})}
                  />
                );
              }
              default:
                return null;
            }
          })}

          {inFlight !== null && (
            <div class="live-item trainer">
              <Role who="you" />
              <p class="live-bubble trainer">{inFlight}</p>
            </div>
          )}

          {phase.kind === "confirming-act" && (
            <div class="live-item advisor">
              <Role who="advisor" />
              <Page artifact={phase.artifact} />
              <div class="live-actions">
                <button type="button" disabled={busy} onClick={() => run((s) => decideAct(s, "confirm", deps))}>
                  Yes — do exactly what's shown
                </button>
                <button
                  type="button"
                  class="quiet"
                  disabled={busy}
                  onClick={() => run((s) => decideAct(s, "decline", deps))}
                >
                  Never mind
                </button>
              </div>
              <p class="fine">
                This is for real: your yes sticks to this exact page. If the page changed after you read it, the
                League refuses to act on it.
              </p>
            </div>
          )}

          {busy && (
            <p class="live-busy" aria-live="polite">
              {progressLine({ ...(progress === null ? {} : { step: progress.step }), ...(callInFlight === null ? {} : { call: callInFlight }) })}
            </p>
          )}
          {trouble !== null && <p class="refusal-banner">{trouble}</p>}
        </div>

        {machinery && (
          <aside class="live-side" aria-label="The machinery">
            <div class="pane-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={pane === "dev"}
                class={`pane-tab${pane === "dev" ? " current" : ""}`}
                title="the step trail with each model call's prompt, reply and latency under the step it preceded"
                onClick={() => setPane("dev")}
              >
                Dev view
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pane === "console"}
                class={`pane-tab${pane === "console" ? " current" : ""}`}
                title="the same session in the League's own words — the trail, the filed records, the download"
                onClick={() => setPane("console")}
              >
                Compliance console
              </button>
            </div>
            {pane === "dev" && meta !== null ? (
              <DevPanel
                meta={meta}
                state={state}
                {...(busy && progress !== null ? { live: progress.state } : {})}
                calls={setup.trace.calls}
                retrieval={retrievalOn}
                gated={gatedOn}
                onRetrieval={setRetrievalOn}
                onGated={setGatedOn}
                memory={memoryOn}
                onMemory={setMemoryOn}
                now={clock}
              />
            ) : (
              <LiveConsole state={state} setup={setup} {...(busy && progress !== null ? { live: progress.state } : {})} />
            )}
          </aside>
        )}
      </div>

      {!profileOpen && profile?.kind === "profile" ? (
        <p class="live-profile-set">
          <span class="live-profile-label">Your game</span> {plainCandidate(profile.scope)}
          <button type="button" class="quiet live-profile-change" disabled={busy || phase.kind === "confirming-act"} onClick={() => setEditingProfile(true)}>
            change
          </button>
        </p>
      ) : (
      <section class="live-profile" aria-label="Your game">
        <p class="live-profile-title">
          Your game
          {profile !== undefined && (
            <button type="button" class="quiet live-profile-change" onClick={() => setEditingProfile(false)}>
              keep it
            </button>
          )}
        </p>
        <p class="fine">
          Version, region and badges are scope: they decide what the League may tell you. Set them here and they go
          on the record as your own setting — typed, checked against the approved list, and never a guess.
        </p>
        <div class="live-profile-fields">
          <label>
            Version
            <select
              value={profileDraft.version}
              onInput={(event) => setProfileDraft({ ...profileDraft, version: event.currentTarget.value })}
            >
              <option value="red-blue">Red / Blue</option>
              <option value="yellow">Yellow</option>
            </select>
          </label>
          <label>
            Region
            <select
              value={profileDraft.region}
              onInput={(event) => setProfileDraft({ ...profileDraft, region: event.currentTarget.value })}
            >
              <option value="kanto">Kanto</option>
            </select>
          </label>
          <label>
            Badges
            <input
              type="number"
              min={0}
              max={8}
              value={profileDraft.badgeLevel}
              onInput={(event) => setProfileDraft({ ...profileDraft, badgeLevel: Number(event.currentTarget.value) })}
            />
          </label>
          <button
            type="button"
            disabled={busy || phase.kind === "confirming-act"}
            onClick={() => {
              setEditingProfile(false);
              run((previous) => (deps === null ? previous : setProfile(previous, { ...profileDraft }, deps)));
            }}
          >
            {profile === undefined ? "Set my game" : "Change my game"}
          </button>
        </div>
      </section>
      )}

      <form
        class="live-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          value={draft}
          disabled={busy || phase.kind === "confirming-act"}
          placeholder={
            phase.kind === "confirming-scope"
              ? "…or answer in your own words"
              : phase.kind === "asking"
                ? "Answer the question above in your own words"
                : phase.kind === "clarifying"
                  ? "Pick one above, answer in your own words, or ask something else"
                  : "Say something to the Advisor"
          }
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <button type="submit" disabled={busy || draft.trim() === "" || phase.kind === "confirming-act"}>
          Send
        </button>
      </form>
    </div>
  );
}

/**
 * The provider's speed, made visible where the visitor already looks: the
 * last model call's wall time and its decode throughput. Split on purpose —
 * a 55-second call at 5.8 tok/s is the provider having a moment, not this
 * page having a bug, and only the pair says which (hard-won lesson 5:
 * providers are nondeterministic, latency included).
 */
function ModelLatency(props: { calls: readonly ModelCallTrace[] }) {
  const last = props.calls[props.calls.length - 1];
  if (last === undefined) return null;
  const seconds = last.latencyMs / 1000;
  const completion = last.usage?.completionTokens ?? 0;
  const rate = seconds > 0 && completion > 0 ? ` · ${(completion / seconds).toFixed(1)} tok/s` : "";
  return (
    <span class="mono" title="the last model call's wall time and decode throughput — slow calls at normal tok/s are the provider routing, not this page">
      last call {seconds.toFixed(1)}s{rate}
    </span>
  );
}

// --- the dev view -----------------------------------------------------------

/**
 * Mirror one trace event to the dev server's sink (`/__dev/trace`, a vite
 * middleware that appends JSONL to a gitignored file an agent can tail).
 * Fire-and-forget on purpose: anywhere without the sink — the production
 * relay, a static deployment — this is a swallowed 404 and nothing else.
 */
function mirrorToDevSink(event: object): void {
  try {
    void fetch("/__dev/trace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ at: new Date().toISOString(), ...event }),
    }).catch(() => {});
  } catch {
    // fetch itself can throw in exotic embeddings; the trace is a convenience.
  }
}

/** One line over the trail while an exchange is open: what is drawn is the
 * driver's report so far, not a filed record. */
function InProgress() {
  return (
    <p class="fine live-in-progress" aria-live="polite">
      Exchange in progress — each step lands here as the driver takes it; nothing below the last one is filed yet.
    </p>
  );
}

/**
 * The dev view: the step trail with every model call the tap recorded
 * disclosed under the step it preceded (prompt, reply, latency), and the
 * whole session as one copyable report. The report is `agentReport` —
 * self-describing JSON built to be pasted into a conversation with a
 * debugging agent whole.
 */
function DevPanel(props: {
  meta: DevTraceMeta;
  state: SessionState;
  /** The state as the driver last reported it, while an exchange is open —
   * the trail is drawn from it so the steps land as they are taken. The
   * report stays on the settled state: what is copied is what was filed. */
  live?: SessionState;
  calls: readonly ModelCallTrace[];
  retrieval: boolean;
  gated: boolean;
  onRetrieval: (on: boolean) => void;
  onGated: (on: boolean) => void;
  memory: boolean;
  onMemory: (on: boolean) => void;
  now: () => string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const report = () => JSON.stringify(agentReport(props.meta, props.state, props.calls), null, 2);
  // Calls attach to the trail by time: each under the first step recorded
  // after it began. One in flight, or one that failed before any step could
  // be written, has no step yet and is listed after the trail instead.
  const placed = withCalls(trailsOfSession(props.live ?? props.state, claimSource()), props.calls);
  // The call before each, by sequence, so a door strip can mark the change.
  const bySeq = new Map(props.calls.map((call) => [call.seq, call] as const));
  const previousCall = (seq: number) => bySeq.get(seq);

  const copy = () => {
    void navigator.clipboard
      .writeText(report())
      .then(() => setCopied("copied — paste it to your debugging agent"))
      .catch(() => setCopied("clipboard refused — use Download instead"));
  };
  const download = () => {
    const blob = new Blob([report()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "live-session-dev-trace.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section class="dev-panel" aria-label="Dev view: model calls and trace export">
      <div class="dev-head">
        <span class="mono">
          dev view · {props.calls.length} model call{props.calls.length === 1 ? "" : "s"} · phase {props.state.phase.kind}
          {props.state.providerErrors > 0 ? ` · ${props.state.providerErrors} provider error(s)` : ""}
        </span>
        <button type="button" class="quiet" disabled={props.calls.length === 0} onClick={copy}>
          Copy trace for the agent
        </button>
        <button type="button" class="quiet" disabled={props.calls.length === 0} onClick={download}>
          Download trace
        </button>
        {copied !== null && <span class="fine">{copied}</span>}
        <label class="fine" title="ground each answer with only the certified rows the question names (lexical, deterministic)">
          <input type="checkbox" checked={props.retrieval} onChange={(event) => props.onRetrieval(event.currentTarget.checked)} /> retrieval
        </label>
        <label class="fine" title="offer the aggregate claim kinds (count/typeCount/gameRule) only when the question nominates them">
          <input type="checkbox" checked={props.gated} onChange={(event) => props.onGated(event.currentTarget.checked)} /> gated grammar
        </label>
      </div>
      <DoorLegend />
      <MemoryPanel store={precedentStore()} state={props.state} on={props.memory} onToggle={props.onMemory} now={props.now} />
      {props.live !== undefined && <InProgress />}
      <Trails
        trails={placed.trails}
        who="you"
        previousCall={previousCall}
        empty="No steps yet — say something to the Advisor and every step lands here on its lane, with each model call's prompt, response and latency under the step it preceded."
      />
      {placed.unplaced.length > 0 && (
        <div class="dev-unplaced">
          <p class="dev-label">since the last recorded step</p>
          {placed.unplaced.map((call) => {
            const previous = previousCall(call.seq - 1);
            return <DevCall call={call} {...(previous === undefined ? {} : { previous })} />;
          })}
        </div>
      )}
      <p class="fine">
        On the dev server, every call and every settled exchange is also streamed to its trace file (
        <span class="mono">.dev-trace.jsonl</span>) whichever tab is up, so an agent can read the session live; a build
        never sends it.
      </p>
    </section>
  );
}

/** The session as a file: the transcript and every filed record, against the
 * named world — enough for `replayTransaction` to re-execute each exchange. */
function downloadRecord(state: SessionState): void {
  const world = demoWorld();
  const record = {
    kind: "live-session-record",
    snapshotId: world.registry.snapshot.id,
    packId: world.pack.id,
    transcript: state.transcript,
    records: state.records,
  };
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "live-session-record.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
