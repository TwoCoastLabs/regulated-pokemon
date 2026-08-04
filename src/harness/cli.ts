/**
 * The harness's entry point, and nothing more.
 *
 * All of it — the runs, the metrics, the self-check, the exit code — is
 * `runHarness`, a function of the vendored certified world and nothing else.
 * This file connects it to a terminal, so the only thing not covered by a test
 * is the connecting.
 *
 * Filing the artifact to disk lands with the billable OpenRouter slice, whose
 * whole product is published run artifacts. Here the artifact is built and
 * returned (its schema is `HarnessArtifact`); the scripted run's job is to
 * prove the harness holds, which it does in memory.
 */

import { runHarness } from "./report.js";

runHarness().then((report) => {
  for (const line of report.lines) console.log(line);
  process.exit(report.exitCode);
});
