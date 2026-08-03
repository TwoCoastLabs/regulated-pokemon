/**
 * The demo's entry point, and nothing more.
 *
 * All of it — the trace, the checks, the exit code — is `runDemo`, which is a
 * pure function of its arguments. This file exists to connect it to a terminal,
 * so that the only thing not covered by a test is the connecting.
 */

import { runDemo } from "./demo.js";

const result = runDemo(process.argv.slice(2));
for (const line of result.lines) console.log(line);
process.exit(result.exitCode);
