/**
 * The step trail, drawn (issue #158): one vertical trail per exchange, each
 * step a card on the lane it ran on — trainer, driver, kernel, model — read
 * from the driver's ledger and the kernel's record via src/ui/trail.ts.
 * Nothing on it is narrated: every card is a recorded step in the ledger's
 * fixed wording, and a denial wears its article the way the console's
 * stamps do. The same component serves three places — the live console
 * (plain), the dev view (with each model call's prompt and reply disclosed
 * under the step it preceded) and the run ledger's console (reconstructed
 * from the filed record, and labelled so).
 */
import type { ModelCallTrace } from "../../src/session/devtrace.js";
import type { ClaimView, ManifestView, RosterView } from "../../src/ui/claims.js";
import { laneLabel, type Trail, type TrailStep } from "../../src/ui/trail.js";
import { renderShape } from "../../src/memory/precedent.js";
import { DoorRow } from "./doors.js";
import { precedentById } from "./world.js";

/** The call before a given one, by sequence number — so a call's door
 * strip can mark what the driver changed since the last call. */
export type PreviousCall = (seq: number) => ModelCallTrace | undefined;

/**
 * The certified manifest under the filing step, disclosed progressively:
 * one fold for the whole answer (how many claims, how many rosters), one
 * per claim (its line and its scale — "1 of 9"), and under each the lines
 * it was formed from — the ranked field, the set's members, the two values
 * compared. Read from the record via src/ui/claims.ts; nothing is computed
 * here.
 */
function ClaimItem(props: { claim: ClaimView }) {
  const { claim } = props;
  const head = (
    <>
      <span class="trail-claim-summary mono">{claim.summary}</span>
      {claim.scale !== undefined && (
        <span class="trail-scale mono" title="the scale this claim worked at, in the record's own numbers">
          {claim.scale}
        </span>
      )}
    </>
  );
  if (claim.lines.length === 0) return <li class="trail-claim">{head}</li>;
  return (
    <li class="trail-claim">
      <details>
        <summary>{head}</summary>
        <ul class="trail-claim-lines mono">
          {claim.lines.map((line) => (
            <li>{line}</li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function RosterItem(props: { roster: RosterView }) {
  const { roster } = props;
  return (
    <li class="trail-claim">
      <details>
        <summary>
          <span class="trail-claim-summary mono">roster {roster.id} — species {roster.criteria}</span>
          <span class="trail-scale mono">{roster.scale}</span>
        </summary>
        <ul class="trail-claim-lines mono">
          <li>{roster.members.join(", ")}</li>
        </ul>
      </details>
    </li>
  );
}

export function ManifestDetails(props: { view: ManifestView }) {
  const { view } = props;
  return (
    <details class="trail-claims">
      <summary class="mono">
        {view.claims.length} claim{view.claims.length === 1 ? "" : "s"}
        {view.rosters.length > 0 ? ` · ${view.rosters.length} roster${view.rosters.length === 1 ? "" : "s"}` : ""} — how each was formed
      </summary>
      <ul class="trail-claim-list">
        {view.claims.map((claim) => (
          <ClaimItem claim={claim} />
        ))}
        {view.rosters.map((roster) => (
          <RosterItem roster={roster} />
        ))}
      </ul>
    </details>
  );
}

/**
 * The precedents one call held (docs/precedent.md): one row per precedent —
 * the ask in the trainer's own words, the overlap, the shape as it was
 * shown, and where it came from — in the claim view's progressive style.
 * Every row shows ids and kinds and no number, which is what makes "the
 * model never sees a value" checkable by eye. The shape and the provenance
 * come from the bundled store; a trace from another world shows the ask
 * and the score alone.
 */
export function PrecedentPanel(props: { held: readonly { id: string; score: number; ask: string }[] }) {
  if (props.held.length === 0) {
    return <p class="precedent-empty fine">precedents: the door was open and no earlier ask scored above the threshold — the memory came up empty</p>;
  }
  return (
    <details class="precedent-panel">
      <summary class="fine">
        {props.held.length} precedent{props.held.length === 1 ? "" : "s"} held — earlier accepted asks shown as examples of which door to take; ids and kinds, no values
      </summary>
      <ul class="precedent-rows">
        {props.held.map((held) => {
          const full = precedentById(held.id);
          return (
            <li>
              <span class="mono">{held.id}</span> · overlap {held.score} · "{held.ask}"
              {full !== undefined && (
                <>
                  <pre class="dev-text">{renderShape(full.shape)}</pre>
                  <span class="fine">
                    from {full.source.kind === "bank-run" ? `bank entry ${full.source.entryId ?? "?"}` : `session ${full.source.transactionId}`} · promoted by {full.promoted.by}, {full.promoted.at}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** One model call as the tap saw it: prompt, reply, latency, cost. */
export function DevCall(props: { call: ModelCallTrace; previous?: ModelCallTrace; taken?: string }) {
  const { call } = props;
  const usage = call.usage;
  // The call before, only when it declared doors too: a scope call before
  // an answer call is not a change of doors, it is a different step.
  const previous = props.previous?.doors;
  return (
    <div class="dev-call-block">
      {/* The doors sit above the fold: the turn-by-turn change is the point,
          and it must be visible without opening the prompt. */}
      {call.doors !== undefined && (
        <DoorRow doors={call.doors} {...(previous === undefined ? {} : { previous })} {...(props.taken === undefined ? {} : { taken: props.taken })} />
      )}
      {call.doors?.precedents !== undefined && <PrecedentPanel held={call.doors.precedents} />}
      {/* The blocks prompt's structure as data (docs/answer-prompt.md): which
          blocks this call carried, in order — so a reader sees that a call
          with no rows and no precedents opened on the task, not on nothing. */}
      {call.doors?.blocks !== undefined && (
        <p class="prompt-blocks fine">
          prompt blocks: {call.doors.blocks.map((block, index) => (
            <>
              {index > 0 && " · "}
              <span class="mono">{block}</span>
            </>
          ))}
        </p>
      )}
    <details class="dev-call">
      <summary class="mono">
        #{call.seq} {call.purpose}
        {call.schema !== undefined ? ` (${call.schema})` : ""} · {Math.round(call.latencyMs)}ms
        {usage !== undefined ? ` · ${usage.promptTokens}→${usage.completionTokens} tok · $${usage.costUsd.toFixed(4)}` : ""}
        {call.error !== undefined ? " · FAILED" : ""}
      </summary>
      <p class="dev-label">prompt</p>
      <pre class="dev-text">{call.prompt}</pre>
      {call.response !== undefined && (
        <>
          <p class="dev-label">response</p>
          <pre class="dev-text">{call.response}</pre>
        </>
      )}
      {call.error !== undefined && (
        <>
          <p class="dev-label">error</p>
          <pre class="dev-text">{call.error}</pre>
        </>
      )}
    </details>
    </div>
  );
}

/** Whose trail it is decides how the trainer's lane is named: the visitor
 * sitting at the live page is "you"; a filed run's trainer is "trainer". */
export type Who = "you" | "trainer";

function lane(step: TrailStep, who: Who): string {
  return step.lane === "trainer" && who === "you" ? "you" : laneLabel(step.lane);
}

function Step(props: { step: TrailStep; who: Who; previousCall?: PreviousCall }) {
  const { step } = props;
  return (
    <li class={`trail-step lane-${step.lane} tone-${step.tone}`}>
      <span class="trail-lane">{lane(step, props.who)}</span>
      <span class="trail-code mono" title={step.at}>
        {step.code}
      </span>
      <p class="trail-text">
        {step.text}
        {step.count !== undefined && (
          <span class="trail-count mono" title="the count this step carries">
            ×{step.count}
          </span>
        )}
      </p>
      {step.lines.length > 0 && (
        <ul class="trail-lines mono">
          {step.lines.map((line) => (
            <li>{line}</li>
          ))}
        </ul>
      )}
      {step.violations.length > 0 && (
        <ul class="trail-denials">
          {step.violations.map((view) => (
            <li>
              <span class="stamp-code mono" title={`${view.articleTitle} — real-world analog: ${view.analog}`}>
                {view.code}
              </span>
              <span class="trail-denial-message">{view.message}</span>
              {(view.expected !== undefined || view.actual !== undefined) && (
                <span class="stamp-diff mono">
                  {view.expected !== undefined && <span>expected {view.expected}</span>}
                  {view.actual !== undefined && <span>actual {view.actual}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {step.manifest !== undefined && <ManifestDetails view={step.manifest} />}
      {step.calls.map((call) => {
        const previous = props.previousCall?.(call.seq - 1);
        // The door the model took on this call, read off the nomination
        // step's first line (`listing(subject=…, n=…)`) — the reply that
        // followed this call is the step it sits under.
        const taken = step.code === "model/nominated" ? step.lines[0]?.split("(")[0] : undefined;
        return <DevCall call={call} {...(previous === undefined ? {} : { previous })} {...(taken === undefined ? {} : { taken })} />;
      })}
    </li>
  );
}

export function TrailView(props: { trail: Trail; index: number; who: Who; previousCall?: PreviousCall }) {
  const { trail } = props;
  return (
    <section class={`trail outcome-${trail.outcome}`} aria-label={`exchange ${props.index + 1}`}>
      <header class="trail-head">
        <span class="trail-index mono">#{props.index + 1}</span>
        <span class="trail-opening">{trail.opening === "" ? "(no words yet)" : `“${trail.opening}”`}</span>
        <span class={`trail-outcome ${trail.outcome}`}>{trail.outcome}</span>
        {trail.transactionId !== undefined && <span class="trail-id mono">{trail.transactionId}</span>}
      </header>
      {trail.source === "record" && (
        <p class="fine">Reconstructed from the filed record — the driver's own moves were not filed with this run.</p>
      )}
      <ol class="trail-steps">
        {trail.steps.map((step) => (
          <Step step={step} who={props.who} {...(props.previousCall === undefined ? {} : { previousCall: props.previousCall })} />
        ))}
      </ol>
    </section>
  );
}

/** Every trail in order, or the one line on why there is none yet. */
export function Trails(props: { trails: readonly Trail[]; who: Who; empty: string; previousCall?: PreviousCall }) {
  if (props.trails.length === 0) return <p class="fine">{props.empty}</p>;
  return (
    <div class="trails">
      {props.trails.map((trail, index) => (
        <TrailView trail={trail} index={index} who={props.who} {...(props.previousCall === undefined ? {} : { previousCall: props.previousCall })} />
      ))}
    </div>
  );
}
