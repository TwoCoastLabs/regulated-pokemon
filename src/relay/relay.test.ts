/**
 * The relay, proven key-free: injected fetch, injected clock, and a fake
 * filesystem — so the entire hosted surface is CI-checked without a network,
 * a key, or a calendar. The upstream stub records what actually crossed,
 * because "it never proxies an arbitrary body" is a claim about the wire.
 */

import { describe, expect, it } from "vitest";

import type { HttpRequest } from "../harness/openrouter.js";
import {
  createRelay,
  RELAY_DEFAULTS,
  relayConfigFromEnv,
  type RelayConfig,
  type RelayRequest,
  staticResponse,
} from "./relay.js";

const KEY = "sk-or-test-relay-key";
const MODELS = ["vendor/strong", "vendor/weak"] as const;

const config = (over: Partial<RelayConfig> = {}): RelayConfig => ({
  apiKey: KEY,
  models: MODELS,
  maxTokens: 2048,
  perIpLimit: 3,
  perIpWindowMs: 60_000,
  dailySpendCapUsd: 0.1,
  dailyCallCap: 100,
  maxContentChars: 10_000,
  callReserveUsd: 0.01,
  upstreamUrl: "https://upstream.test/v1/chat",
  ...over,
});

/** An upstream that answers only when the test says so, for calls in flight. */
function deferredUpstream() {
  const pending: ((reply: { status: number; body: string }) => void)[] = [];
  const fetch = (_url: string, _init: HttpRequest) =>
    new Promise<{ ok: boolean; status: number; text: () => Promise<string> }>((resolve) => {
      pending.push((reply) => resolve({ ok: reply.status < 400, status: reply.status, text: () => Promise.resolve(reply.body) }));
    });
  return { pending, fetch };
}

/** An upstream that records requests and answers from a script. */
function upstream(replies: () => { status: number; body: string }) {
  const seen: { url: string; init: HttpRequest }[] = [];
  const fetch = (url: string, init: HttpRequest) => {
    seen.push({ url, init });
    const reply = replies();
    return Promise.resolve({ ok: reply.status < 400, status: reply.status, text: () => Promise.resolve(reply.body) });
  };
  return { seen, fetch };
}

const priced = (cost: number) =>
  JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost } });

function chat(over: Partial<RelayRequest> = {}, body: Record<string, unknown> = {}): RelayRequest {
  return {
    method: "POST",
    path: "/api/relay/chat",
    ip: "203.0.113.7",
    body: JSON.stringify({
      model: "vendor/strong",
      messages: [
        { role: "system", content: "persona" },
        { role: "user", content: "prompt" },
      ],
      ...body,
    }),
    ...over,
  };
}

/** A clock the tests own. */
function clock(startMs = Date.UTC(2026, 0, 1, 12)) {
  let at = startMs;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe("health", () => {
  it("reports ready with the allowlist, and not-configured without a key", async () => {
    const ready = createRelay({ config: config(), fetch: upstream(() => ({ status: 200, body: priced(0) })).fetch, now: clock().now });
    const health = await ready({ method: "GET", path: "/api/relay/health", ip: "x", body: "" });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ ok: true, models: MODELS });

    const bare = createRelay({ config: config({ apiKey: "" }), fetch: upstream(() => ({ status: 200, body: "" })).fetch, now: clock().now });
    expect((await bare({ method: "GET", path: "/api/relay/health", ip: "x", body: "" })).status).toBe(503);
  });
});

describe("the built upstream request", () => {
  it("carries only the understood fields, with the relay's own discipline", async () => {
    const wire = upstream(() => ({ status: 200, body: priced(0.001) }));
    const relay = createRelay({ config: config(), fetch: wire.fetch, now: clock().now });

    const schema = { type: "json_schema", json_schema: { name: "answer", strict: true, schema: { type: "object" } } };
    const reply = await relay(
      chat({}, {
        max_tokens: 999_999,
        temperature: 2,
        response_format: schema,
        tools: [{ smuggled: true }],
        user: "tracking-id",
      }),
    );
    expect(reply.status).toBe(200);

    const sent = JSON.parse(wire.seen[0]!.init.body) as Record<string, unknown>;
    expect(sent.model).toBe("vendor/strong");
    expect(sent.temperature).toBe(0);
    expect(sent.max_tokens).toBe(2048); // clamped
    expect(sent.usage).toEqual({ include: true });
    expect(sent.response_format).toEqual(schema);
    expect(sent.tools).toBeUndefined();
    expect(sent.user).toBeUndefined();
    expect(wire.seen[0]!.init.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("names the allowlist when the model is not on it, and refuses malformed bodies plainly", async () => {
    // A roomy rate limit: refusing malformed spam still spends a rate slot,
    // and this test is about the refusals, not the limiter.
    const relay = createRelay({
      config: config({ perIpLimit: 1_000 }),
      fetch: upstream(() => ({ status: 200, body: "" })).fetch,
      now: clock().now,
    });

    const wrongModel = await relay(chat({}, { model: "vendor/other" }));
    expect(wrongModel.status).toBe(400);
    expect(JSON.parse(wrongModel.body).error.message).toContain("vendor/strong");

    expect((await relay(chat({ body: "not json" }))).status).toBe(400);
    expect((await relay(chat({}, { messages: [] }))).status).toBe(400);
    expect((await relay(chat({}, { messages: [{ role: "assistant", content: "no" }] }))).status).toBe(400);
    expect((await relay(chat({}, { response_format: { type: "text" } }))).status).toBe(400);

    const oversized = await relay(chat({}, { messages: [{ role: "user", content: "x".repeat(10_001) }] }));
    expect(oversized.status).toBe(400);
  });

  it("forwards a validated upstream preference and refuses any other shape", async () => {
    // The page's routing choice rides in the body (openrouter.ts,
    // UpstreamPreference); the relay reads it to its shape and rebuilds it,
    // as it does every field — a sort by name and short host names only.
    const wire = upstream(() => ({ status: 200, body: priced(0.001) }));
    const relay = createRelay({ config: config(), fetch: wire.fetch, now: clock().now });
    expect((await relay(chat({}, { provider: { sort: "throughput", ignore: ["Novita"], order: ["smuggled"], allow_fallbacks: false } }))).status).toBe(200);
    const sent = JSON.parse(wire.seen[0]!.init.body) as Record<string, unknown>;
    expect(sent.provider).toEqual({ sort: "throughput", ignore: ["Novita"], allow_fallbacks: true });
    expect((await relay(chat({}, { provider: { sort: "fastest" } }))).status).toBe(400);
    expect((await relay(chat({}, { provider: { ignore: ["a".repeat(41)] } }))).status).toBe(400);
    // From another address: the fourth request in one window is rate-limited, not read.
    expect((await relay(chat({ ip: "203.0.113.8" }, { provider: "throughput" }))).status).toBe(400);
  });

  it("applies the operator's routing on top of the page's: the page's sort or the operator's, the ignore lists joined, reported on health", async () => {
    // OPENROUTER_UPSTREAM on the relay is the operator's veto and default:
    // a host ruled out is ruled out for everyone the relay serves, and a
    // page that sends no sort gets the operator's (findings §32).
    const operator = config({ upstream: { sort: "latency", ignore: ["Novita"] } });
    const wire = upstream(() => ({ status: 200, body: priced(0.001) }));
    const relay = createRelay({ config: operator, fetch: wire.fetch, now: clock().now });
    const health = await relay({ method: "GET", path: "/api/relay/health", ip: "x", body: "" });
    expect(JSON.parse(health.body)).toMatchObject({ ok: true, models: MODELS, upstream: "by latency, never Novita" });
    // The page's sort wins; the operator's ignore rides along, joined with the page's.
    expect((await relay(chat({}, { provider: { sort: "throughput", ignore: ["Parasail"] } }))).status).toBe(200);
    expect((JSON.parse(wire.seen[0]!.init.body) as Record<string, unknown>).provider).toEqual({ sort: "throughput", ignore: ["Parasail", "Novita"], allow_fallbacks: true });
    // A page that sends nothing gets the operator's preference whole.
    expect((await relay(chat({ ip: "203.0.113.9" }))).status).toBe(200);
    expect((JSON.parse(wire.seen[1]!.init.body) as Record<string, unknown>).provider).toEqual({ sort: "latency", ignore: ["Novita"], allow_fallbacks: true });
    // The env reads the same setting every live tool reads, and refuses an unknown word by name.
    expect(relayConfigFromEnv({ OPENROUTER_UPSTREAM: "throughput ignore=Novita" }, MODELS).upstream).toEqual({ sort: "throughput", ignore: ["Novita"] });
    expect(relayConfigFromEnv({}, MODELS).upstream).toBeUndefined();
    expect(() => relayConfigFromEnv({ OPENROUTER_UPSTREAM: "fastest" }, MODELS)).toThrow(/"fastest" is not a sort/);
  });

  it("answers only its two doors", async () => {
    const relay = createRelay({ config: config(), fetch: upstream(() => ({ status: 200, body: "" })).fetch, now: clock().now });
    expect((await relay({ method: "POST", path: "/api/relay/other", ip: "x", body: "" })).status).toBe(404);
    expect((await relay(chat({ method: "GET" }))).status).toBe(405);
  });
});

describe("limits", () => {
  it("rate-limits per IP inside the window and forgets outside it", async () => {
    const time = clock();
    const relay = createRelay({ config: config(), fetch: upstream(() => ({ status: 200, body: priced(0) })).fetch, now: time.now });

    for (let i = 0; i < 3; i++) expect((await relay(chat())).status).toBe(200);
    const fourth = await relay(chat());
    expect(fourth.status).toBe(429);
    expect(JSON.parse(fourth.body).error.message).toContain("rate-limited");

    // Another visitor is unaffected; the first recovers when the window slides.
    expect((await relay(chat({ ip: "198.51.100.2" }))).status).toBe(200);
    time.advance(61_000);
    expect((await relay(chat())).status).toBe(200);
  });

  it("stops at the daily spend cap and resets on the UTC day", async () => {
    const time = clock();
    const relay = createRelay({
      config: config({ perIpLimit: 1_000 }),
      fetch: upstream(() => ({ status: 200, body: priced(0.06) })).fetch,
      now: time.now,
    });

    expect((await relay(chat())).status).toBe(200); // spent 0.06
    expect((await relay(chat())).status).toBe(200); // spent 0.12 ≥ cap after this
    const over = await relay(chat());
    expect(over.status).toBe(503);
    expect(JSON.parse(over.body).error.message).toContain("budget");

    time.advance(24 * 3_600_000);
    expect((await relay(chat())).status).toBe(200);
  });

  it("holds a reservation for every call in flight, so a burst cannot pass the spend cap together", async () => {
    const wire = deferredUpstream();
    const relay = createRelay({
      config: config({ perIpLimit: 1_000, dailySpendCapUsd: 0.1, callReserveUsd: 0.05 }),
      fetch: wire.fetch,
      now: clock().now,
    });

    // Nothing is spent yet, but two calls are out and each may cost the
    // reserve: the third is refused before the first has answered.
    const first = relay(chat());
    const second = relay(chat());
    expect(wire.pending).toHaveLength(2);
    const third = await relay(chat());
    expect(third.status).toBe(503);
    expect(JSON.parse(third.body).error.message).toContain("budget");

    // The answers come back cheaper than the reserve; the reservations are
    // released and the real spend is what counts from here.
    wire.pending[0]!({ status: 200, body: priced(0.01) });
    wire.pending[1]!({ status: 200, body: priced(0.01) });
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    const fourth = relay(chat());
    expect(wire.pending).toHaveLength(3);
    wire.pending[2]!({ status: 200, body: priced(0.01) });
    expect((await fourth).status).toBe(200);
  });

  it("counts a call against the call cap when it is admitted, not when it returns", async () => {
    const wire = deferredUpstream();
    const relay = createRelay({ config: config({ perIpLimit: 1_000, dailyCallCap: 1 }), fetch: wire.fetch, now: clock().now });
    const first = relay(chat());
    expect((await relay(chat())).status).toBe(503);
    wire.pending[0]!({ status: 200, body: priced(0) });
    expect((await first).status).toBe(200);
  });

  it("releases the reservation when the upstream cannot be reached", async () => {
    let reachable = false;
    const relay = createRelay({
      config: config({ perIpLimit: 1_000, dailySpendCapUsd: 0.1, callReserveUsd: 0.1 }),
      fetch: (url, init) => (reachable ? upstream(() => ({ status: 200, body: priced(0) })).fetch(url, init) : Promise.reject(new Error("reset"))),
      now: clock().now,
    });
    expect((await relay(chat())).status).toBe(502);
    reachable = true;
    expect((await relay(chat())).status).toBe(200);
  });

  it("counts unpriced calls against the call cap, so silence cannot bypass the budget", async () => {
    const time = clock();
    const relay = createRelay({
      config: config({ perIpLimit: 1_000, dailyCallCap: 2 }),
      fetch: upstream(() => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }) })).fetch,
      now: time.now,
    });
    expect((await relay(chat())).status).toBe(200);
    expect((await relay(chat())).status).toBe(200);
    expect((await relay(chat())).status).toBe(503);
  });
});

describe("what it says", () => {
  it("logs each refusal by reason with the request's origin, and the day's tallies at the UTC rollover — never the key", async () => {
    const time = clock();
    const lines: string[] = [];
    const relay = createRelay({
      config: config({ perIpLimit: 1 }),
      fetch: upstream(() => ({ status: 200, body: priced(0.06) })).fetch,
      now: time.now,
      log: (line) => lines.push(line),
    });

    expect((await relay(chat({ origin: "https://page.test" }))).status).toBe(200);
    expect(lines).toEqual([]); // an admitted call is not a line; the first day has nothing to close

    expect((await relay(chat({ origin: "https://page.test" }))).status).toBe(429);
    expect((await relay(chat({ ip: "198.51.100.2" }, { model: "vendor/none" }))).status).toBe(400);
    expect(lines).toEqual([
      "relay refused rate 429 ip=203.0.113.7 origin=https://page.test",
      "relay refused body 400 ip=198.51.100.2 origin=-",
    ]);

    time.advance(24 * 3_600_000);
    expect((await relay(chat({ ip: "198.51.100.3" }))).status).toBe(200);
    expect(lines[2]).toBe("relay day 2026-01-01 closed: 1 calls, $0.0600 spent, refused rate=1 body=1; caps reset for 2026-01-02");
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).not.toContain(KEY);
  });

  it("reports its caps on health, so a deployment can be read without its config", async () => {
    const relay = createRelay({ config: config(), fetch: upstream(() => ({ status: 200, body: "" })).fetch, now: clock().now });
    const body = JSON.parse((await relay({ method: "GET", path: "/api/relay/health", ip: "x", body: "" })).body);
    expect(body.caps).toEqual({
      dailySpendCapUsd: 0.1,
      dailyCallCap: 100,
      perIpLimit: 3,
      perIpWindowMs: 60_000,
      maxContentChars: 10_000,
      maxTokens: 2048,
      callReserveUsd: 0.01,
    });
  });
});

describe("what comes back", () => {
  it("scrubs the key from an upstream body before it reaches a browser", async () => {
    const leaky = upstream(() => ({ status: 500, body: `upstream error mentioning ${KEY} in a stack` }));
    const relay = createRelay({ config: config(), fetch: leaky.fetch, now: clock().now });
    const reply = await relay(chat());
    expect(reply.status).toBe(500);
    expect(reply.body).not.toContain(KEY);
    expect(reply.body).toContain("[redacted]");
  });

  it("turns an unreachable upstream into a plain 502", async () => {
    const relay = createRelay({
      config: config(),
      fetch: () => Promise.reject(new Error("connection reset")),
      now: clock().now,
    });
    const reply = await relay(chat());
    expect(reply.status).toBe(502);
    expect(JSON.parse(reply.body).error.message).toContain("could not be reached");
  });

  it("refuses chat entirely when no key is configured", async () => {
    const relay = createRelay({ config: config({ apiKey: "" }), fetch: upstream(() => ({ status: 200, body: "" })).fetch, now: clock().now });
    const reply = await relay(chat());
    expect(reply.status).toBe(503);
    expect(JSON.parse(reply.body).error.message).toContain("no model");
  });
});

describe("configuration from the environment", () => {
  it("takes defaults, reads overrides, and refuses nonsense numbers", () => {
    const bare = relayConfigFromEnv({}, MODELS);
    expect(bare.apiKey).toBe("");
    expect(bare.models).toEqual(MODELS);
    expect(bare.maxTokens).toBe(RELAY_DEFAULTS.maxTokens);
    expect(bare.upstreamUrl).toBe(RELAY_DEFAULTS.upstreamUrl);
    // The content ceiling and the reserve are set from measurement (the
    // comments on RelayConfig say which); the numbers are pinned here so a
    // change to either is a deliberate one.
    expect(bare.maxContentChars).toBe(60_000);
    expect(bare.callReserveUsd).toBe(0.01);

    const set = relayConfigFromEnv(
      {
        OPENROUTER_API_KEY: KEY,
        RELAY_MODELS: " a/one , b/two ",
        RELAY_MAX_TOKENS: "512",
        RELAY_DAILY_SPEND_CAP_USD: "not-a-number",
        RELAY_CALL_RESERVE_USD: "0.02",
      },
      MODELS,
    );
    expect(set.apiKey).toBe(KEY);
    expect(set.models).toEqual(["a/one", "b/two"]);
    expect(set.maxTokens).toBe(512);
    expect(set.dailySpendCapUsd).toBe(RELAY_DEFAULTS.dailySpendCapUsd);
    expect(set.callReserveUsd).toBe(0.02);
  });
});

describe("the static half", () => {
  const files: Record<string, Uint8Array> = {
    "index.html": new TextEncoder().encode("<!doctype html>"),
    "assets/app.js": new TextEncoder().encode("code"),
  };
  const read = (path: string) => files[path] ?? null;

  it("serves the app with the right types, and the root as the page", () => {
    expect(staticResponse("/", read)).toMatchObject({ status: 200, contentType: "text/html; charset=utf-8" });
    expect(staticResponse("/assets/app.js", read)).toMatchObject({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
    });
  });

  it("refuses traversal, unknown types and missing files without consulting the reader", () => {
    let consulted = 0;
    const counting = (path: string) => {
      consulted++;
      return files[path] ?? null;
    };
    expect(staticResponse("/../.env", counting).status).toBe(404);
    expect(staticResponse("/assets/app.wasm", counting).status).toBe(404);
    expect(consulted).toBe(0);
    expect(staticResponse("/missing.html", read).status).toBe(404);
  });
});
