/**
 * The harness's entry point, and nothing more.
 *
 * All of it — the runs, the metrics, the self-check, the exit code — is
 * `runHarness`, a function of the vendored certified world and nothing else.
 * This file connects it to a terminal, so the only thing not covered by a test
 * is the connecting.
 *
 * Nothing is filed to disk. A published run artifact is the product of the
 * billable live harness (`live-cli.ts`), which cannot be re-run to check it; a
 * scripted run is reproducible by typing the command again, so writing a file
 * on every CI run would be noise rather than evidence.
 */

import { runHarness } from "./report.js";

runHarness().then((report) => {
  for (const line of report.lines) console.log(line);
  process.exit(report.exitCode);
});
