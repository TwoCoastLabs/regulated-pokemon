// The web app's build. The app is chrome around the kernel's record types:
// it imports the pure projections in src/ui/ and type-only contracts from the
// kernel, and bundles the filed artifact in runs/ as its default input — so a
// production build is a static, offline replay of a published run.
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  // The app reaches up for src/ (pure modules) and runs/ (the filed record).
  server: { fs: { allow: [".."] } },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  // The bundle carries the pinned snapshot (~530 kB of certified data) so the
  // crucible page can load the registry offline; that is cargo, not code, and
  // the default 500 kB warning would cry wolf on every build.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
