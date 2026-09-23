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
        <h1>The Indigo Accord</h1>
        <p class="lead">
          A Pokémon assistant that cannot make things up. A real AI answers your questions; the League checks every
          fact against the certified records before you see it, and refuses anything it cannot prove.
        </p>
      </header>
      <Live />
    </div>
  );
}
