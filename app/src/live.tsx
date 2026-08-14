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
 * Bring-your-own-key, deliberately (a hosted relay is #36): the key lives in
 * component state for the duration of the session, is sent only to
 * openrouter.ai by the same driver the billable harness uses (which scrubs it
 * from every error it raises), and is never persisted, logged, or sent
 * anywhere else.
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
import { plainCandidate, plainStage, plainViolation } from "../../src/ui/plain.js";
import { violationView } from "../../src/ui/viewmodel.js";
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
      <figcaption
        class="exhibit-tag"
        title="Every value on this page was recomputed from the pinned official records before it could be shown; free text cannot appear on it at all."
      >
        Checked &amp; certified
      </figcaption>
      {refusal !== null && <p class="exhibit-refusal">{refusal}</p>}
      <div class="exhibit-page" ref={attach} />
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

function RecordItem(props: { record: Transaction; page: DomElement | undefined }) {
  const { record, page } = props;
  const outcome = record.outcome;
  if (outcome.status === "denied") {
    const denials = outcome.violations.map(plainViolation);
    return (
      <div class="live-item advisor">
        <div class="live-denial">
          <p class="live-denial-lead">The League stepped in {plainStage(outcome.stage)}.</p>
          <ul>
            {denials.map((denial) => (
              <li>
                <span class="live-denial-detail">{denial.plain}</span>
                <ArticleChip code={denial.code} articleTitle={denial.articleTitle} analog={denial.analog} />
              </li>
            ))}
          </ul>
          <p class="fine">Nothing above reached you — that's the point. The full ruling is in the console.</p>
        </div>
      </div>
    );
  }
  return (
    <div class="live-item advisor">
      {page !== undefined && <Page artifact={page} />}
      <p class={`outcome ${outcome.status === "declined" ? "quiet" : "ok"}`}>
        {outcome.status === "acted"
          ? "Done — exactly what the page showed, nothing more."
          : outcome.status === "declined"
            ? "No problem — nothing was done. The answer above still stands."
            : "Every value on this page was checked against the official records before you saw it."}
      </p>
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

function LiveConsole(props: { state: SessionState; setup: LiveSetup }) {
  const { state, setup } = props;
  const cost = state.usage;
  return (
    <aside class="live-console" aria-label="Compliance console">
      <h3>The compliance console</h3>
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
    </aside>
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
  const [console_, setConsole] = useState(false);
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
          <h2>Sit down with the Advisor</h2>
          <p>
            A real AI plays the League's Advisor, and the League's inspector — running right here in your tab — checks
            every answer against the official Pokédex records before you see it. The Advisor can charm; it cannot make
            things up to you.
          </p>
          <p>
            You bring the model: an OpenRouter key powers the Advisor, stays in this tab's memory, is sent only to{" "}
            <span class="mono">openrouter.ai</span>, and is never stored or logged. Live calls bill your OpenRouter
            account (a short session costs well under a cent).
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
              onInput={(event) => setPersona(event.currentTarget.value === "adversarial" ? "adversarial" : "honest")}
            >
              <option value="honest">plays fair — answers as well as it can</option>
              <option value="adversarial">cheats — instructed to lie to you; watch the League catch it</option>
            </select>
          </label>
          <button type="button" class="live-begin" disabled={key.trim() === ""} onClick={begin}>
            Start the session
          </button>
          {trouble !== null && <p class="refusal-banner">{trouble}</p>}
          <p class="fine">
            The cheating Advisor is the fun one: it is under orders to slip a lie past the inspector in every answer.
            It has never managed it — not because the model is good, but because the inspector recomputes everything.
            Come watch it try.
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
      <div class="live-meta">
        <span class="mono">{setup.model}</span>
        <span class="live-persona">{setup.persona === "honest" ? "plays fair" : "cheats — watch the League"}</span>
        <span>
          {cost.calls} model call{cost.calls === 1 ? "" : "s"} · ${cost.costUsd.toFixed(4)} so far
        </span>
        <button
          type="button"
          class={`console-toggle${console_ ? " current" : ""}`}
          aria-pressed={console_}
          onClick={() => setConsole(!console_)}
        >
          {console_ ? "Hide the machinery" : "Show the machinery"}
        </button>
      </div>

      <div class={`live-panes${console_ ? " with-console" : ""}`}>
        <div class="live-chat">
          {items.length === 0 && inFlight === null && (
            <p class="live-hint">
              Tell the Advisor about your game, then ask away — it needs your version, region and badge count before
              the League will certify anything. Try: “I'm playing Red and Blue, travelling around the Kanto region,
              and I have 8 badges. Which of the Electric ones is the quickest?”
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
                const active = phase.kind === "confirming-scope" && phase.proposal.id === item.proposal.id && !busy;
                return (
                  <div class="live-item advisor">
                    <div class="live-proposal">
                      <p class="live-proposal-lead">
                        Just to be sure — by “{item.proposal.interpreting}”, you mean{" "}
                        <strong>{plainCandidate(item.proposal.candidate)}</strong>?
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
                    <p class="live-bubble decision">
                      {item.decision === "confirm" ? "Yes — that's what I meant." : "No — not that."}
                    </p>
                  </div>
                );
              case "note":
                return (
                  <div class="live-item advisor">
                    <p class={`live-note ${item.note.tone}`} title={item.note.text}>
                      {item.note.tone === "error"
                        ? "The connection to the model failed — nothing was lost."
                        : "The Advisor couldn't put together a checkable answer this time."}
                      {latest && !busy && (
                        <button type="button" class="live-retry" onClick={() => run((s) => retry(s, deps))}>
                          try again
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

          {busy && <p class="live-busy">The Advisor is thinking…</p>}
          {trouble !== null && <p class="refusal-banner">{trouble}</p>}
        </div>

        {console_ && <LiveConsole state={state} setup={setup} />}
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
