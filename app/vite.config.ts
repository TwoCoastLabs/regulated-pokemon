// The web app's build. The app is chrome around the kernel's record types:
// it imports the pure projections in src/ui/ and type-only contracts from the
// kernel, and bundles the filed artifact in runs/ as its default input — so a
// production build is a static, offline replay of a published run.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * The dev-trace sink: the live page's dev view POSTs every model call and
 * every settled exchange here, and each lands as one JSONL line in a
 * gitignored file at the repo root — so a debugging agent can tail the
 * session as it happens instead of asking for pastes. Dev-server-only by
 * construction: this middleware exists nowhere in a build.
 */
function devTraceSink(): Plugin {
  const file = resolve(import.meta.dirname, "../.dev-trace.jsonl");
  return {
    name: "dev-trace-sink",
    configureServer(server) {
      server.middlewares.use("/__dev/trace", (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
          if (body.length > 1_000_000) request.destroy();
        });
        request.on("end", () => {
          try {
            appendFileSync(file, JSON.stringify(JSON.parse(body)) + "\n");
            response.statusCode = 204;
          } catch {
            response.statusCode = 400;
          }
          response.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [devTraceSink()],
  root: import.meta.dirname,
  // The app reaches up for src/ (pure modules) and runs/ (the filed record).
  // The /api proxy is dev-only convenience: `npm run relay` on :8080 beside
  // `app:dev` gives the League's-key mode with hot reload; without a relay
  // running the probe fails and the page falls back to bring-your-own-key.
  server: { fs: { allow: [".."] }, proxy: { "/api": "http://localhost:8080" } },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  // The bundle carries the pinned snapshot (~530 kB of certified data) so the
  // crucible page can load the registry offline; that is cargo, not code, and
  // the default 500 kB warning would cry wolf on every build.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
