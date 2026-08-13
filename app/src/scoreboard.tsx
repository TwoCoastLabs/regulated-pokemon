/**
 * The scoreboard: strong vs weak vs adversarial, side by side, from the filed
 * record. The zeros band on top is enforcement — corpus-wide, structural, the
 * same for every column below it. The columns are usefulness, health and
 * cost — per model, empirical, allowed to differ. Keeping the two visually
 * separate is the model doctrine ("never blend the two") as layout.
 *
 * When the record carries the raw control arm, the page grows a toggle: the
 * same models with the kernel removed, every answer published exactly as
 * stated and metered afterwards with the same kernel the governed leg uses as
 * a gate. The two legs never share a band — governed zeros are a guarantee,
 * raw harm is a measurement, and blending them is the one layout this page
 * must not have.
 */
import { useState } from "preact/hooks";

import type { HarnessArtifact } from "../../src/harness/artifact.js";
import { enforcementCounters } from "../../src/ui/viewmodel.js";
import {
  rawScoreboard,
  scoreboard,
  type RawScoreboardRow,
  type RawScoreboardView,
  type ScoreboardRow,
} from "../../src/ui/scoreboard.js";

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

function RawModelCard(props: { row: RawScoreboardRow }) {
  const { row } = props;
  return (
    <article class={`model-card${row.publishedNothing ? " failed" : ""}`}>
      <header>
        <span class={`role-chip ${row.role}`}>{row.role}</span>
        <h3 class="mono">{row.slug ?? row.providerId}</h3>
      </header>

      <p class={`model-enforcement${row.assertionViolations > 0 ? " unattributed" : " unguaranteed"}`}>
        {row.assertionViolations > 0
          ? `${row.assertionViolations} false assertion${row.assertionViolations === 1 ? "" : "s"} published`
          : "published clean this run — possible, never guaranteed"}
      </p>

      <div class="model-usefulness">
        <span class="model-rate mono">
          {row.violatedRuns}/{row.committed}
        </span>
        <span class="model-rate-label">published answers carrying a false claim · {row.runs} runs</span>
      </div>

      <ul class="model-outcomes">
        <li><span class="status published">published</span> {row.committed}</li>
        <li><span class="status unresolved">unusable</span> {row.unusable}</li>
        <li><span class="status harm">swapped question</span> {row.wrongScopeClaims}</li>
        <li>
          <span class="status harm">acts ungated</span> {row.actsExecuted}
          {row.unaskedActs > 0 ? ` (${row.unaskedActs} unasked)` : ""}
        </li>
        <li><span class="status harm">disclosures omitted</span> {row.omittedDisclosures}</li>
      </ul>

      <div class="model-denials">
        {row.findings.length === 0 ? (
          <p class="fine">the meter found no false assertion</p>
        ) : (
          <ul>
            {row.findings.map((finding) => (
              <li>
                <span class="stamp-code mono">{finding.code}</span>
                <span class="denial-count mono">×{finding.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p class="model-meter mono">
        {row.publishedNothing
          ? "nothing was published — this column measured nothing"
          : `${row.providerErrors} provider error${row.providerErrors === 1 ? "" : "s"}` +
            (row.cost === undefined
              ? ""
              : ` · $${row.cost.usd.toFixed(4)}${row.cost.floor ? " (floor)" : ""} · ${row.cost.calls} calls · ` +
                `${row.cost.promptTokens} / ${row.cost.completionTokens} tokens`)}
      </p>
    </article>
  );
}

function RawBoard(props: { view: RawScoreboardView }) {
  const { view } = props;
  const counters = [
    { label: "answers published", value: view.totals.committed, harm: false },
    { label: "false assertions", value: view.totals.assertionViolations, harm: true },
    { label: "swapped-question claims", value: view.totals.wrongScopeClaims, harm: true },
    { label: "acts executed ungated", value: view.totals.actsExecuted, harm: true },
    { label: "disclosures omitted", value: view.totals.omittedDisclosures, harm: true },
  ];

  return (
    <>
      <section class="thesis raw-arm" aria-label="Raw control arm">
        <div class="counters">
          {counters.map((counter) => (
            <div class={`counter${counter.harm && counter.value > 0 ? " harm" : ""}`}>
              <span class="counter-value">{counter.value}</span>
              <span class="counter-label">{counter.label}</span>
            </div>
          ))}
        </div>
        <p class="thesis-line">
          The same models with the kernel removed: each answer was published exactly as stated — no scope ladder, no
          verification, no confirmation, an action executing the moment it is claimed — and metered afterwards with
          the same kernel the governed leg uses as a gate. Nothing above was prevented; every number was published.
          The harm is a floor: this arm reuses the governed persona, which promises verification raw does not have.
        </p>
      </section>

      <div class="score-grid">
        {view.rows.map((row) => (
          <RawModelCard row={row} />
        ))}
      </div>

      <p class="fine">
        Read from the record's filed raw-arm metrics; totals are sums of the filed per-model figures. False
        assertions and omitted disclosures are counted apart — an ungoverned agent omits every mandated disclosure
        by construction, and folding that in would inflate the fabrication number.
      </p>
    </>
  );
}

type Leg = "governed" | "raw";

/** The ?leg= parameter, so the raw side of the A/B has a linkable page. */
function legFromUrl(): Leg {
  return new URLSearchParams(window.location.search).get("leg") === "raw" ? "raw" : "governed";
}

export function Scoreboard(props: { artifact: HarnessArtifact }) {
  const { artifact } = props;
  const view = scoreboard(artifact);
  const raw = rawScoreboard(artifact);
  const [leg, setLeg] = useState<Leg>(legFromUrl);
  // A record without the arm has no raw leg to show, whatever the URL says.
  const showing: Leg = raw === undefined ? "governed" : leg;

  const choose = (chosen: Leg) => {
    setLeg(chosen);
    window.history.replaceState(null, "", chosen === "raw" ? "?view=scoreboard&leg=raw" : "?view=scoreboard");
  };

  return (
    <div class="scoreboard">
      {raw !== undefined ? (
        <nav class="leg-toggle" aria-label="Governed or raw">
          <button
            type="button"
            class={`leg-tab${showing === "governed" ? " current" : ""}`}
            aria-pressed={showing === "governed"}
            onClick={() => choose("governed")}
          >
            governed — the kernel in the loop
          </button>
          <button
            type="button"
            class={`leg-tab raw${showing === "raw" ? " current" : ""}`}
            aria-pressed={showing === "raw"}
            onClick={() => choose("raw")}
          >
            raw — the same models, no kernel
          </button>
        </nav>
      ) : (
        <p class="fine">
          This record carries no raw control arm, so there is no raw leg to toggle to. Absence means the arm did not
          run — never that it ran clean.
        </p>
      )}

      {showing === "raw" && raw !== undefined ? (
        <RawBoard view={raw} />
      ) : (
        <>
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
            Joined from the record's filed metrics — usefulness, health and cost per model, denials as attributed by
            the run. Nothing on this page is recomputed.
          </p>
        </>
      )}
    </div>
  );
}
