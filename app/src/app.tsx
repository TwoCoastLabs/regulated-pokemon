/**
 * The run ledger: one filed harness artifact, replayed as pages.
 *
 * Everything on screen is a projection of the record via src/ui/viewmodel.ts —
 * the same artifact `npm run harness:results` renders as Markdown. The app
 * holds exactly two pieces of state: which record is open, and which run in it
 * is selected. There is no third: nothing on this page is computed from
 * anything but the record.
 */
import { useMemo, useState } from "preact/hooks";

import type { HarnessRun } from "../../src/harness/run.js";
import { enforcementCounters, groupRuns } from "../../src/ui/viewmodel.js";
import { Console } from "./console.js";
import { Crucible } from "./crucible.js";
import { Live } from "./live.js";
import { bundledArtifact, openArtifact, type ArtifactSource } from "./load.js";
import { Scoreboard } from "./scoreboard.js";
import { Conversation, Picker } from "./views.js";

/** Open on the first run that walked the whole read-to-act chain, when the
 * record has one — it is the run with the most to show. */
function defaultRun(runs: readonly HarnessRun[]): number {
  const acted = runs.findIndex((run) => run.status === "acted");
  return acted === -1 ? 0 : acted;
}

/** The ?run= parameter, so a run in the bundled record has a linkable page. */
function runFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get("run");
  if (raw === null) return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** The four pages: the filed record replayed, its models compared, the
 * crucible run live, and a live session with the visitor as the trainer. */
type View = "ledger" | "scoreboard" | "crucible" | "live";

function viewFromUrl(): View {
  const raw = new URLSearchParams(window.location.search).get("view");
  return raw === "crucible" || raw === "scoreboard" || raw === "live" ? raw : "ledger";
}

const VIEWS: readonly { id: View; label: string; lead: string }[] = [
  {
    id: "ledger",
    label: "Run ledger",
    lead:
      "One filed run, replayed. Every number and every page below is read from the record — never recomputed, " +
      "never summarised.",
  },
  {
    id: "scoreboard",
    label: "Scoreboard",
    lead:
      "Every model in the record against the same kernel. Enforcement is one band of zeros over all of them; " +
      "usefulness differs per model, and the difference is the thesis.",
  },
  {
    id: "crucible",
    label: "The crucible",
    lead:
      "The mutations CI runs, with buttons on them. Each sabotage runs the real kernel in this tab and must land " +
      "on the denial it declared — plus the untampered control that keeps the refusals honest.",
  },
  {
    id: "live",
    label: "Live session",
    lead:
      "You as the trainer, a real model as the Advisor, the kernel in this tab as the gate. Bring your own " +
      "OpenRouter key; nothing binds without your confirmation, and every exchange files a replayable record.",
  },
];

export function App() {
  const [source, setSource] = useState<ArtifactSource>(bundledArtifact);
  const [selected, setSelected] = useState<number | null>(runFromUrl);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [view, setView] = useState<View>(viewFromUrl);

  const { artifact, name } = source;
  const groups = useMemo(() => groupRuns(artifact), [artifact]);
  const index = selected ?? defaultRun(artifact.runs);
  const run = artifact.runs[index];
  const page = VIEWS.find((entry) => entry.id === view) ?? VIEWS[0]!;

  const show = (chosen: View) => {
    setView(chosen);
    window.history.replaceState(null, "", chosen === "ledger" ? "?" : `?view=${chosen}`);
  };

  const open = async (file: File | undefined) => {
    if (file === undefined) return;
    try {
      setSource(await openArtifact(file));
      setSelected(null);
      setRefusal(null);
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div class="ledger">
      <header class="masthead">
        <div class="masthead-title">
          <p class="eyebrow">The Indigo Accord</p>
          <h1>{page.label}</h1>
          <p class="lead">{page.lead}</p>
          <nav class="views" aria-label="Pages">
            {VIEWS.map((entry) => (
              <button
                type="button"
                class={`view-tab${entry.id === view ? " current" : ""}`}
                aria-current={entry.id === view ? "page" : undefined}
                onClick={() => show(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        </div>
        {(view === "ledger" || view === "scoreboard") && (
        <dl class="provenance">
          <div>
            <dt>record</dt>
            <dd class="mono">{name}</dd>
          </div>
          <div>
            <dt>started</dt>
            <dd class="mono">{artifact.startedAt}</dd>
          </div>
          <div>
            <dt>snapshot</dt>
            <dd class="mono" title={artifact.world.snapshotDigest}>
              {artifact.world.snapshotId}
            </dd>
          </div>
          <div>
            <dt>pack</dt>
            <dd class="mono">{artifact.world.packId}</dd>
          </div>
          <div>
            <dt>models</dt>
            <dd class="mono">
              {artifact.models.map((model) => `${model.role}: ${model.slug ?? model.id}`).join(" · ")}
            </dd>
          </div>
        </dl>
        )}
        {view === "ledger" && (
        <div class="counters">
          {enforcementCounters(artifact).map((counter) => (
            <div class={`counter${counter.mustBeZero ? (counter.value === 0 ? " zero" : " broken") : ""}`}>
              <span class="counter-value">{counter.value}</span>
              <span class="counter-label">{counter.label}</span>
            </div>
          ))}
          <div class={`selfcheck ${artifact.verdict.ok ? "ok" : "failed"}`}>
            {artifact.verdict.ok ? "self-check: green" : `self-check failed: ${artifact.verdict.failures.join("; ")}`}
          </div>
        </div>
        )}
        {(view === "ledger" || view === "scoreboard") && (
        <label class="open-record">
          Open another run artifact…
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void open(event.currentTarget.files?.[0])}
          />
        </label>
        )}
        {refusal !== null && <p class="refusal-banner">{refusal}</p>}
      </header>

      {view === "live" ? (
        <Live />
      ) : view === "crucible" ? (
        <Crucible />
      ) : view === "scoreboard" ? (
        <Scoreboard artifact={artifact} />
      ) : run === undefined ? (
        <p class="refusal-banner">This record holds no runs to show.</p>
      ) : (
        <div class="panes">
          <Picker
            groups={groups}
            artifact={artifact}
            selected={run}
            onSelect={(chosen) => {
              const chosenIndex = artifact.runs.indexOf(chosen);
              setSelected(chosenIndex);
              window.history.replaceState(null, "", `?run=${chosenIndex}`);
            }}
          />
          <Conversation run={run} />
          <Console artifact={artifact} run={run} />
        </div>
      )}
    </div>
  );
}
