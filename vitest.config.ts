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
      // machinery for the subject, not the subject.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/testing/**"],
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        statements: 85,
        branches: 75,
        lines: 85,
      },
    },
  },
});
