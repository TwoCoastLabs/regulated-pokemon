/**
 * The page: the live session, with the machinery beside it.
 *
 * One page on purpose. The visitor's first minute is sitting down with the
 * Advisor; the evidence — the step trail, every model call, the filed
 * records, and the crucible run in the visitor's own scope — is the side
 * pane, one tab away, never a separate exhibit. The filed banks and their
 * numbers live in docs/findings.md and the results page, read from the run
 * artifacts, not re-drawn here.
 */
import { Live } from "./live.js";

export function App() {
  return (
    <div class="page">
      <header class="masthead">
        <div class="masthead-title">
          <p class="eyebrow">The Indigo Accord</p>
          <h1>Live session</h1>
          <p class="lead">
            You as the trainer, a real AI as the Advisor, and the League's checks running right here in your tab.
            Nothing counts until you confirm it, and every exchange leaves a record anyone can re-run.
          </p>
        </div>
      </header>
      <Live />
    </div>
  );
}
