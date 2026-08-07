/**
 * The results-page generator's entry point, and nothing more.
 *
 * All of it — locating the artifact, rendering it, filing or printing — is
 * `runResults`, a function of its arguments and an injected filesystem. This
 * file supplies the real disk and connects the result to a terminal, so the
 * only thing not covered by a test is the connecting.
 *
 * Safe in CI in principle — it reads a file and no network — but there is
 * nothing to render without a filed run, so it is a developer command, not a
 * gate. It never spends money and never reads a key.
 */

import { runResults } from "./results.js";

const result = runResults({ argv: process.argv.slice(2) });
for (const line of result.lines) console.log(line);
process.exit(result.exitCode);
