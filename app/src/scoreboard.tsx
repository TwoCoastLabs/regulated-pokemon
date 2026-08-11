/**
 * The scoreboard: strong vs weak vs adversarial, side by side, from the filed
 * record. The zeros band on top is enforcement — corpus-wide, structural, the
 * same for every column below it. The columns are usefulness, health and
 * cost — per model, empirical, allowed to differ. Keeping the two visually
 * separate is the model doctrine ("never blend the two") as layout.
 */
import type { HarnessArtifact } from "../../src/harness/artifact.js";
import { enforcementCounters } from "../../src/ui/viewmodel.js";
import { scoreboard, type ScoreboardRow } from "../../src/ui/scoreboard.js";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ModelCard(props: { row: ScoreboardRow; identical: boolean }) {
  const { row, identical } = props;
  return (
    <article class={`model-card${row.allFailed ? " failed" : ""}`}>
      <header>
        <span class={`role-chip ${row.role}`}>{row.role}</span>
        <h3 class="mono">{row.slug ?? row.providerId}</h3>
      </header>

      <p class={`model-enforcement${identical ? "" : " unattributed"}`}>
        {identical
          ? "0 violations · 0 wrong-scope · 0 unauthorized"
          : "not attributable — an enforcement total is broken at the corpus level"}
      </p>

      <div class="model-usefulness">
        <span class="model-rate mono">{percent(row.resolutionRate)}</span>
        <span class="model-rate-label">
          resolved · {row.resolved}/{row.runs} runs · {row.avgTurnsToAnswer.toFixed(1)} turns to answer
          {row.abstentionRate > 0 ? ` · abstained ${percent(row.abstentionRate)}` : ""}
        </span>
      </div>

      <ul class="model-outcomes">
        <li><span class="status answered">answered</span> {row.answered}</li>
        <li><span class="status acted">acted</span> {row.acted}</li>
        <li><span class="status denied">denied</span> {row.denied}</li>
        <li><span class="status unresolved">unresolved</span> {row.unresolved}</li>
      </ul>

      <div class="model-denials">
        {row.denials.length === 0 ? (
          <p class={row.vacuousAdversary ? "vacuous" : "fine"}>
            {row.vacuousAdversary
              ? "never made the gate fire — this adversary proved nothing"
              : "no denials provoked"}
          </p>
        ) : (
          <ul>
            {row.denials.map((denial) => (
              <li>
                <span class="stamp-code mono">{denial.code}</span>
                <span class="denial-count mono">×{denial.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p class="model-meter mono">
        {row.allFailed
          ? "every call failed — this column measured nothing"
          : `${row.providerErrors} provider error${row.providerErrors === 1 ? "" : "s"}` +
            (row.cost === undefined
              ? ""
              : ` · $${row.cost.usd.toFixed(4)}${row.cost.floor ? " (floor)" : ""} · ${row.cost.calls} calls · ` +
                `${row.cost.promptTokens} / ${row.cost.completionTokens} tokens`)}
      </p>
    </article>
  );
}

export function Scoreboard(props: { artifact: HarnessArtifact }) {
  const { artifact } = props;
  const view = scoreboard(artifact);

  return (
    <div class="scoreboard">
      <section class={`thesis${view.identical ? "" : " broken"}`} aria-label="Enforcement">
        <div class="counters">
          {enforcementCounters(artifact).map((counter) => (
            <div class={`counter${counter.mustBeZero ? (counter.value === 0 ? " zero" : " broken") : ""}`}>
              <span class="counter-value">{counter.value}</span>
              <span class="counter-label">{counter.label}</span>
            </div>
          ))}
        </div>
        <p class="thesis-line">
          {view.identical
            ? "The zeros above are over every model at once — a zero total is a zero for each of them. " +
              "Enforcement is structural: same kernel, same zeros, whichever model ran. " +
              "Everything below is usefulness, which is empirical, per model, and allowed to differ — that difference is the point."
            : "An enforcement total is non-zero. That is a kernel bug, not a metric — the record shows it broken at the " +
              "corpus level and attributes it to no model, because the filed totals do not say whose it was."}
        </p>
      </section>

      <div class="score-grid">
        {view.rows.map((row) => (
          <ModelCard row={row} identical={view.identical} />
        ))}
      </div>

      <p class="fine">
        Joined from the record's filed metrics — usefulness, health and cost per model, denials as attributed by the
        run. Nothing on this page is recomputed.
      </p>
    </div>
  );
}
