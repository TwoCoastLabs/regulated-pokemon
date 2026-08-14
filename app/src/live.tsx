/**
 * The live session: the visitor as the trainer, a real model as the Advisor,
 * the bundled certified world as the ground, and the kernel in this tab as
 * the gate — the same `runTransaction` CI runs, driven by src/session.
 *
 * Bring-your-own-key, deliberately: the key lives in component state for the
 * duration of the session, is sent only to openrouter.ai by the same driver
 * the billable harness uses (which scrubs it from every error it raises), and
 * is never persisted, logged, or sent anywhere else. There is no server; the
 * conversation happens between this tab and the model, with the kernel
 * standing where it always stands.
 *
 * Everything the visitor sees in the chat is derived from the session state:
 * the transcript's own events, the driver's notes, and the filed records —
 * the same discipline as the run ledger, applied to a conversation that is
 * still happening.
 */
import { useMemo, useState } from "preact/hooks";

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
import { denialCode } from "../../src/kernel/violation.js";
import {
  decideAct,
  decideScope,
  retry,
  say,
  type ScopeProposal,
  type SessionDeps,
  type SessionNote,
  type SessionState,
  startSession,
} from "../../src/session/session.js";
import { adaptArtifact } from "../../src/ui/artifact-dom.js";
import { browserFactory } from "./mount.js";
import { demoWorld } from "./world.js";

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

interface LiveSetup {
  provider: ModelProvider;
  model: string;
  persona: Persona;
}

// --- chat derivation --------------------------------------------------------

type ChatItem =
  | { at: string; kind: "visitor"; text: string }
  | { at: string; kind: "proposal"; proposal: ScopeProposal }
  | { at: string; kind: "decision"; decision: "confirm" | "reject" }
  | { at: string; kind: "note"; note: SessionNote }
  | { at: string; kind: "record"; record: Transaction; page: DomElement | undefined };

function chatItems(state: SessionState): ChatItem[] {
  const items: ChatItem[] = [];
  for (const event of state.transcript) {
    if (event.kind === "utterance" && event.source === "trainer") {
      items.push({ at: event.at, kind: "visitor", text: event.text });
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
function Page(props: { artifact: DomElement }) {
  const [refusal, setRefusal] = useState<string | null>(null);

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
    <figure class="exhibit">
      <figcaption class="exhibit-tag">Certified page · governed region</figcaption>
      {refusal !== null && <p class="exhibit-refusal">{refusal}</p>}
      <div class="exhibit-page" ref={attach} />
    </figure>
  );
}

function candidateLines(proposal: ScopeProposal): string[] {
  return Object.entries(proposal.candidate).map(([dimension, value]) => `${dimension} = ${String(value)}`);
}

function RecordItem(props: { record: Transaction; page: DomElement | undefined }) {
  const { record, page } = props;
  const outcome = record.outcome;
  if (outcome.status === "denied") {
    return (
      <div class="live-item advisor">
        <div class="live-denial">
          <p class="live-denial-lead">
            The kernel refused this answer at the {outcome.stage} stage — the record, not the model, is what says so.
          </p>
          <ul>
            {outcome.violations.map((violation) => (
              <li>
                <span class="stamp-code mono">{denialCode(violation)}</span>
                <span class="live-denial-detail">{violation.message}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div class="live-item advisor">
      {page !== undefined && <Page artifact={page} />}
      <p class={`outcome ${outcome.status === "declined" ? "quiet" : "ok"}`}>
        {outcome.status === "acted"
          ? "Confirmed act authorised against the exact page above — a grant per act, the whole chain verified."
          : outcome.status === "declined"
            ? "You declined; the certified answer stands and nothing executed."
            : "Certified answer committed: every claim recomputed from the snapshot before it reached this page."}
      </p>
    </div>
  );
}

// --- the page ---------------------------------------------------------------

export function Live() {
  const [setup, setSetup] = useState<LiveSetup | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(DEFAULT_STRONG_MODEL);
  const [persona, setPersona] = useState<Persona>("honest");
  const [state, setState] = useState<SessionState>(startSession);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** The message currently on its way through the driver, echoed immediately
   * so the visitor's words never vanish while the model is consulted. */
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const clock = useMemo(makeClock, []);

  const deps = useMemo<SessionDeps | null>(() => {
    if (setup === null) return null;
    return { world: demoWorld(), provider: setup.provider, now: clock };
  }, [setup, clock]);

  const begin = () => {
    try {
      const provider = new OpenRouterProvider({
        id: "live:session",
        model,
        apiKey: key,
        system: persona === "honest" ? HONEST_PERSONA : ADVERSARY_PERSONA,
        structured: true,
      });
      setSetup({ provider, model, persona });
      setTrouble(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  };

  const run = (step: (previous: SessionState) => Promise<SessionState> | SessionState) => {
    if (deps === null || busy) return;
    setBusy(true);
    void Promise.resolve(step(state))
      .then((next) => setState(next))
      .catch((error: unknown) => setTrouble(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setBusy(false);
        setInFlight(null);
      });
  };

  const send = () => {
    const text = draft.trim();
    if (text === "" || deps === null) return;
    setDraft("");
    setInFlight(text);
    run((previous) => say(previous, text, deps));
  };

  if (setup === null || deps === null) {
    return (
      <div class="live">
        <section class="live-setup">
          <h2>Bring your own key</h2>
          <p>
            The session runs entirely in this tab: your key is held in memory for this page only, sent to nothing but{" "}
            <span class="mono">openrouter.ai</span>, and never stored or logged. The model proposes; the kernel —
            running right here, against the bundled certified snapshot — decides what commits. Live calls bill your
            OpenRouter account.
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
            Model slug
            <input value={model} onInput={(event) => setModel(event.currentTarget.value)} list="live-models" />
            <datalist id="live-models">
              <option value={DEFAULT_STRONG_MODEL}>the measured strong model</option>
              <option value={DEFAULT_WEAK_MODEL}>the measured weak model</option>
            </datalist>
          </label>
          <label>
            Persona
            <select
              value={persona}
              onInput={(event) => setPersona(event.currentTarget.value === "adversarial" ? "adversarial" : "honest")}
            >
              <option value="honest">honest — the Advisor as shipped</option>
              <option value="adversarial">adversarial — instructed to fabricate; watch the gate</option>
            </select>
          </label>
          <button type="button" class="live-begin" disabled={key.trim() === ""} onClick={begin}>
            Begin the session
          </button>
          {trouble !== null && <p class="refusal-banner">{trouble}</p>}
          <p class="fine">
            The adversarial persona is the crucible with a live model in it: the same instructions the harness's
            red-team leg runs, so you can watch a model actively trying to slip a fabrication past the gate — and the
            gate naming the article as it refuses.
          </p>
        </section>
      </div>
    );
  }

  const items = chatItems(state);
  const phase = state.phase;
  const cost = state.usage;

  return (
    <div class="live">
      <div class="live-meta mono">
        <span>
          {setup.model} · {setup.persona}
        </span>
        <span>
          {cost.calls} call{cost.calls === 1 ? "" : "s"} · ${cost.costUsd.toFixed(4)}
          {cost.costedCalls < cost.calls ? " (floor)" : ""} · {state.providerErrors} provider error
          {state.providerErrors === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          class="live-download"
          disabled={state.records.length === 0}
          onClick={() => downloadRecord(state)}
        >
          Download session record
        </button>
      </div>

      <div class="live-chat">
        {items.length === 0 && (
          <p class="live-hint">
            Introduce yourself and ask — the Accord needs your version, region and badge count before anything can be
            certified. For example: “I'm playing Red and Blue, travelling around the Kanto region, and I have 8
            badges. Which of the Electric ones is the quickest?”
          </p>
        )}
        {items.map((item, index) => {
          const latest = index === items.length - 1;
          switch (item.kind) {
            case "visitor":
              return (
                <div class="live-item trainer">
                  <p class="live-bubble trainer">{item.text}</p>
                </div>
              );
            case "proposal": {
              const active =
                phase.kind === "confirming-scope" && phase.proposal.id === item.proposal.id && !busy;
              return (
                <div class="live-item advisor">
                  <div class="live-proposal">
                    <p class="live-proposal-lead">
                      The Advisor reads “{item.proposal.interpreting}” as:{" "}
                      <span class="mono">{candidateLines(item.proposal).join(", ")}</span>
                    </p>
                    <p class="fine">
                      Nothing binds unless you confirm this exact interpretation — digest{" "}
                      <span class="mono">{proposalDigest(item.proposal).slice(0, 18)}…</span>
                    </p>
                    {active && (
                      <div class="live-actions">
                        <button type="button" onClick={() => run((s) => decideScope(s, "confirm", deps))}>
                          That is what I meant
                        </button>
                        <button type="button" class="quiet" onClick={() => run((s) => decideScope(s, "reject", deps))}>
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
                  <p class="live-bubble decision">{item.decision === "confirm" ? "Confirmed." : "Rejected."}</p>
                </div>
              );
            case "note":
              return (
                <div class="live-item advisor">
                  <p class={`live-note ${item.note.tone}`}>
                    {item.note.text}
                    {latest && !busy && (
                      <button type="button" class="live-retry" onClick={() => run((s) => retry(s, deps))}>
                        retry
                      </button>
                    )}
                  </p>
                </div>
              );
            case "record":
              return <RecordItem record={item.record} page={item.page} />;
            default:
              return null;
          }
        })}

        {inFlight !== null && (
          <div class="live-item trainer">
            <p class="live-bubble trainer">{inFlight}</p>
          </div>
        )}

        {phase.kind === "asking" && inFlight === null && (
          <div class="live-item advisor">
            <p class="live-bubble advisor">{phase.question}</p>
          </div>
        )}

        {phase.kind === "confirming-act" && (
          <div class="live-item advisor">
            <Page artifact={phase.artifact} />
            <div class="live-actions">
              <button type="button" disabled={busy} onClick={() => run((s) => decideAct(s, "confirm", deps))}>
                I consent — perform exactly what this page shows
              </button>
              <button type="button" class="quiet" disabled={busy} onClick={() => run((s) => decideAct(s, "decline", deps))}>
                Decline
              </button>
            </div>
            <p class="fine">
              Your consent binds the digest of this exact page (IA-7); a page altered after you read it is a different
              page and cannot execute.
            </p>
          </div>
        )}

        {busy && <p class="live-busy">The Advisor is consulting the model…</p>}
        {trouble !== null && <p class="refusal-banner">{trouble}</p>}
      </div>

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
