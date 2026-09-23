/**
 * The relay's node wiring, kept too thin to hide a bug in: environment to
 * config, one HTTP server, and each request handed either to the tested
 * relay handler (src/relay/relay.ts) or the tested static router. Everything
 * with a decision in it lives behind an injected seam and is CI-covered;
 * this file is delivery.
 *
 * Locally: `npm run relay` builds the app and serves it with the relay on
 * one port, reading `.env` for the key exactly as the live harness does —
 * the shell's environment wins over the file. On fly.io the same entrypoint
 * runs with the key in a deployment secret and no `.env` at all.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { parseEnvFile } from "../harness/live.js";
import { DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL } from "../harness/models.js";
import { createRelay, relayConfigFromEnv, staticResponse } from "./relay.js";

const root = resolve(import.meta.dirname, "../..");
const appDist = resolve(root, "app/dist");

function envFromDisk(): Record<string, string | undefined> {
  try {
    return parseEnvFile(readFileSync(resolve(root, ".env"), "utf8"));
  } catch {
    return {};
  }
}
const env = { ...envFromDisk(), ...process.env };

const config = relayConfigFromEnv(env, [DEFAULT_STRONG_MODEL, DEFAULT_WEAK_MODEL]);
const relay = createRelay({
  config,
  fetch: (url, init) => fetch(url, init),
  now: Date.now,
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
});

const server = createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0] ?? "/";

  if (path.startsWith("/api/relay/")) {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      // A megabyte is already far beyond any request the driver makes.
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      const forwarded = request.headers["fly-client-ip"];
      const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? request.socket.remoteAddress ?? "unknown";
      const stated = request.headers.origin ?? request.headers.referer;
      const origin = Array.isArray(stated) ? stated[0] : stated;
      void relay({ method: request.method ?? "GET", path, ip, body, ...(origin === undefined ? {} : { origin }) }).then((reply) => {
        response.writeHead(reply.status, { "content-type": reply.contentType });
        response.end(reply.body);
      });
    });
    return;
  }

  const reply = staticResponse(path, (relativePath) => {
    try {
      return readFileSync(join(appDist, relativePath));
    } catch {
      return null;
    }
  });
  response.writeHead(reply.status, { "content-type": reply.contentType });
  response.end(reply.body);
});

const port = Number(env.PORT ?? 8080);
server.listen(port, () => {
  console.log(
    `serving app/dist and /api/relay on :${port} — relay ${config.apiKey === "" ? "NOT configured (no key); the page has no model and shows the crucible only" : `ready for ${config.models.join(", ")}`}`,
  );
});
