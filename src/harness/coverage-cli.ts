/**
 * The coverage map's entry point, and nothing more.
 *
 * All of it — the dry-run plan, the billable run that files its artifact, the
 * render of one already filed — is `runCoverage` (coverage-live.ts), a
 * function of its arguments with the filesystem and provider injected. This
 * file supplies the real disk, the real clock and a terminal, so the only
 * thing not covered by a test is the connecting.
 *
 * Never run in CI. Without `--live` it prints the plan and spends nothing.
 *
 *   npm run coverage:map                       # dry: what it would run
 *   npm run coverage:map -- --live             # the full bank, billed, filed to runs/
 *   npm run coverage:map -- --live --dispositions should-refuse --repetitions 3
 *   npm run coverage:map -- --render           # re-render the newest filed artifact, free
 */

import { runCoverage } from "./coverage-live.js";
import { loadEnv } from "./live.js";

/** A fresh, strictly-increasing clock per entry, so ids and digests never
 * collide between questions. */
function makeClock(): () => string {
  let last = 0;
  return () => {
    const t = Math.max(Date.now(), last + 1);
    last = t;
    return new Date(t).toISOString();
  };
}

const result = await runCoverage({
  argv: process.argv.slice(2),
  env: loadEnv(process.env, ".env"),
  now: new Date().toISOString(),
  clock: makeClock,
});
for (const line of result.lines) console.log(line);
process.exit(result.exitCode);
