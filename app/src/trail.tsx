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
import { laneLabel, type Trail, type TrailStep } from "../../src/ui/trail.js";

/** One model call as the tap saw it: prompt, reply, latency, cost. */
export function DevCall(props: { call: ModelCallTrace }) {
  const { call } = props;
  const usage = call.usage;
  return (
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
  );
}

/** Whose trail it is decides how the trainer's lane is named: the visitor
 * sitting at the live page is "you"; a filed run's trainer is "trainer". */
export type Who = "you" | "trainer";

function lane(step: TrailStep, who: Who): string {
  return step.lane === "trainer" && who === "you" ? "you" : laneLabel(step.lane);
}

function Step(props: { step: TrailStep; who: Who }) {
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
      {step.calls.map((call) => (
        <DevCall call={call} />
      ))}
    </li>
  );
}

export function TrailView(props: { trail: Trail; index: number; who: Who }) {
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
          <Step step={step} who={props.who} />
        ))}
      </ol>
    </section>
  );
}

/** Every trail in order, or the one line on why there is none yet. */
export function Trails(props: { trails: readonly Trail[]; who: Who; empty: string }) {
  if (props.trails.length === 0) return <p class="fine">{props.empty}</p>;
  return (
    <div class="trails">
      {props.trails.map((trail, index) => (
        <TrailView trail={trail} index={index} who={props.who} />
      ))}
    </div>
  );
}
