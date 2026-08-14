/**
 * Test and coverage configuration.
 *
 * Coverage here is a backstop, not the gate. The gate that matters is article
 * coverage — every Accord article denied by name in at least one crucible
 * mutation (src/crucible/crucible.test.ts). A percentage can sit at 100 while
 * an article has no mutation at all, so the number below only catches the
 * other failure: enforcement code shipping with no test touching it.
 *
 * The thresholds ratchet. Raise them in the same change that raises the real
 * number; never lower one to go green.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Explicit rather than inherited: a mis-globbed include that silently runs
    // nothing is one of the failures CI checks for, so the glob is stated here
    // and the number of files it matched is asserted after the run.
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Only the kernel and the crucible are subject.
      //
      // `scripts/**` is the network tool: it is deliberately never run in CI,
      // and counting it would push someone to either fake a test for it or
      // weaken the floor for everything else. `src/testing/**` is fixtures —
      // machinery for the subject, not the subject. `src/relay/serve.ts` is
      // delivery: it starts a server on import, so a test cannot even load
      // it, and every decision it wires up lives in src/relay/relay.ts,
      // which is covered like everything else.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/testing/**", "src/relay/serve.ts"],
      reporter: ["text-summary", "json-summary"],
      // Raised with the transaction seam and held through phases 4.1 and 5,
      // which sit at 96.5 / 89.4 / 98.3. Deliberately not ratcheted: what is
      // left uncovered is almost entirely named-fallback strings ("no slots",
      // "no locale mark", "no confirmation") on denials whose real path is
      // exercised, plus two guards the loader is supposed to make
      // unreachable — a consent notice with no act to read, and a scope
      // window nobody can parse. Inventing a test per fallback would be
      // chasing the backstop rather than the gate.
      thresholds: {
        statements: 94,
        branches: 88,
        lines: 95,
      },
    },
  },
});
