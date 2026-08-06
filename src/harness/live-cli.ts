/**
 * The billable harness's entry point, and nothing more.
 *
 * All of it — the plan, the runs, the artifact, the exit code — is `runLive`,
 * a function of its arguments, the environment it is handed and a timestamp.
 * This file supplies those three and connects the result to a terminal, so the
 * only thing not covered by a test is the connecting.
 *
 * Never run in CI. It calls a real provider and costs real money; the gate runs
 * `npm run harness`, which is the same harness driven by scripted models.
 */

import { loadEnv, runLive } from "./live.js";

const env = loadEnv(process.env, ".env");

runLive({ argv: process.argv.slice(2), env, now: new Date().toISOString() }).then((result) => {
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
});
