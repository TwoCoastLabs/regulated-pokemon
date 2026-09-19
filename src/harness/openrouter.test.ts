/**
 * The live driver, tested without a network or a key.
 *
 * `fetch` and `sleep` are injected, so these run in the same offline, key-free
 * gate as everything else — the driver's contract is exercised here, and the
 * only thing a real run adds is a real endpoint.
 */

import { describe, expect, it } from "vitest";

import { assembleStream,
  type CallProgress,
  foldSchemaFor,
  type FetchLike,
  type HttpResponse,
  OpenRouterProvider,
  OPENROUTER_URL,
  ProviderError,
  readUsage,
  redact,
} from "./openrouter.js";
import type { CompletionRequest } from "./provider.js";

const KEY = "sk-or-v1-secret-value";

const request: CompletionRequest = {
  purpose: "answer",
  prompt: "one two three four",
  hint: { scenarioId: "basics" },
};

function reply(body: unknown, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function chat(content: string, usage?: Record<string, number>): HttpResponse {
  return reply({ choices: [{ message: { content } }], ...(usage === undefined ? {} : { usage }) });
}

/** A fetch that plays a queue of responses and records what it was sent. */
function stub(responses: readonly (HttpResponse | Error)[]): {
  fetch: FetchLike;
  calls: { url: string; headers: Record<string, string>; body: unknown }[];
  slept: number[];
} {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const slept: number[] = [];
  let index = 0;
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as unknown });
    const next = responses[Math.min(index++, responses.length - 1)];
    if (next === undefined) throw new Error("no response queued");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetch, calls, slept };
}

function provider(responses: readonly (HttpResponse | Error)[], over: Partial<{ retries: number }> = {}) {
  const stubbed = stub(responses);
  const instance = new OpenRouterProvider({
    id: "live:strong",
    model: "vendor/model-x",
    apiKey: KEY,
    system: "be honest",
    fetch: stubbed.fetch,
    sleep: (ms) => {
      stubbed.slept.push(ms);
      return Promise.resolve();
    },
    ...over,
  });
  return { instance, ...stubbed };
}

describe("the request it sends", () => {
  it("asks OpenRouter for a priced, deterministic completion with the persona in front", async () => {
    const { instance, calls } = provider([chat("ok")]);
    await instance.complete(request);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(OPENROUTER_URL);
    expect(call?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call?.body).toMatchObject({
      model: "vendor/model-x",
      temperature: 0,
      usage: { include: true },
      messages: [
        { role: "system", content: "be honest" },
        { role: "user", content: "one two three four" },
      ],
    });
  });

  it("sends only ByteString-safe headers, so no attribution string can fail every call", async () => {
    // A header value with a character > 255 makes the real `fetch` throw at the
    // transport layer before any request goes out — which the run counts as a
    // total provider outage. The stub fetch does not enforce this, so an em dash
    // in an attribution header shipped and failed every live call; this asserts
    // the property the stub cannot.
    const { instance, calls } = provider([chat("ok")]);
    await instance.complete(request);
    for (const value of Object.values(calls[0]?.headers ?? {})) {
      expect([...value].every((char) => char.charCodeAt(0) <= 255)).toBe(true);
    }
  });

  it("sends no response_format by default — the grammar is a measured variable", async () => {
    const { instance, calls } = provider([chat("ok")]);
    await instance.complete({ ...request, schema: { name: "answer", schema: { type: "object" } } });
    expect((calls[0]?.body as Record<string, unknown>).response_format).toBeUndefined();
  });

  it("hands the schema to the endpoint as a strict decoding constraint when asked", async () => {
    const stubbed = stub([chat("{}")]);
    const instance = new OpenRouterProvider({
      id: "live:weak",
      model: "vendor/model-x",
      apiKey: KEY,
      system: "be honest",
      structured: true,
      fetch: stubbed.fetch,
    });
    await instance.complete({ ...request, schema: { name: "certified_answer", schema: { type: "object" } } });
    expect((stubbed.calls[0]?.body as Record<string, unknown>).response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "certified_answer", strict: true, schema: { type: "object" } },
    });
  });

  it("sends nothing extra on a step that carries no grammar, even when structured", async () => {
    // The scope step has no schema; asking for one anyway would be inventing a
    // constraint the advisor never stated.
    const stubbed = stub([chat("{}")]);
    const instance = new OpenRouterProvider({
      id: "live:weak",
      model: "vendor/model-x",
      apiKey: KEY,
      system: "be honest",
      structured: true,
      fetch: stubbed.fetch,
    });
    await instance.complete(request);
    expect((stubbed.calls[0]?.body as Record<string, unknown>).response_format).toBeUndefined();
  });

  it("refuses to exist without a key, rather than spending a run on 401s", () => {
    expect(
      () => new OpenRouterProvider({ id: "live:x", model: "m", apiKey: "  ", system: "s", fetch: stub([]).fetch }),
    ).toThrow(ProviderError);
  });
});

describe("what it does with a reply", () => {
  it("returns the content and the provider's own price", async () => {
    const { instance } = provider([chat("{}", { prompt_tokens: 120, completion_tokens: 30, cost: 0.00042 })]);
    const completion = await instance.complete(request);
    expect(completion.text).toBe("{}");
    expect(completion.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      calls: 1,
      costedCalls: 1,
      costUsd: 0.00042,
    });
  });

  it("estimates tokens but never invents a price when the provider is silent", () => {
    const usage = readUsage({}, request, "a b");
    expect(usage).toEqual({ promptTokens: 4, completionTokens: 2, calls: 1, costedCalls: 0, costUsd: 0 });
  });

  it("rejects a 200 that carries an upstream error instead of reading it as an answer", async () => {
    const { instance } = provider([reply({ error: { message: "upstream is down" } })], { retries: 0 });
    await expect(instance.complete(request)).rejects.toThrow("upstream is down");
  });

  it("rejects a reply with no content, so a blank is never read as an abstention", async () => {
    const { instance } = provider([reply({ choices: [{ message: {} }] })], { retries: 0 });
    await expect(instance.complete(request)).rejects.toThrow("no message content");
  });

  it("rejects a body that is not JSON", async () => {
    const { instance } = provider([reply("<html>gateway</html>")], { retries: 0 });
    await expect(instance.complete(request)).rejects.toThrow("was not JSON");
  });
});

describe("failure and retry", () => {
  it("retries a rate limit and returns the completion that follows", async () => {
    const { instance, calls, slept } = provider([reply("slow down", 429), chat("recovered")]);
    const completion = await instance.complete(request);
    expect(completion.text).toBe("recovered");
    expect(calls).toHaveLength(2);
    expect(slept).toEqual([1_000]);
  });

  it("retries a transport failure, which has no status at all", async () => {
    const { instance, calls } = provider([new Error("ECONNRESET"), chat("recovered")]);
    await expect(instance.complete(request)).resolves.toMatchObject({ text: "recovered" });
    expect(calls).toHaveLength(2);
  });

  it("does not retry a 400 — the same mistake billed three times is still the same mistake", async () => {
    const { instance, calls } = provider([reply({ error: { message: "bad model" } }, 400)]);
    await expect(instance.complete(request)).rejects.toThrow("HTTP 400");
    expect(calls).toHaveLength(1);
  });

  it("gives up after the retry budget and reports how many attempts it made", async () => {
    const { instance, calls } = provider([reply("boom", 503)]);
    const error = await instance.complete(request).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).attempts).toBe(3);
    expect((error as ProviderError).status).toBe(503);
    expect(calls).toHaveLength(3);
  });
});

describe("the key never escapes", () => {
  it("scrubs it out of an error body an endpoint echoed back", async () => {
    const { instance } = provider([reply(`{"error":{"message":"invalid key ${KEY}"}}`, 401)]);
    const error = await instance.complete(request).catch((cause: unknown) => cause);
    const message = (error as Error).message;
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(KEY);
    expect(message).toContain("[redacted]");
  });

  it("scrubs it out of a transport error too", async () => {
    const { instance } = provider([new Error(`connect failed with ${KEY}`)], { retries: 0 });
    await expect(instance.complete(request)).rejects.not.toThrow(KEY);
  });

  it("redact leaves text alone when there is no secret to find", () => {
    expect(redact("plain", "")).toBe("plain");
  });
});

describe("foldSchemaFor: the grammar folded to what an upstream accepts", () => {
  const schema = {
    type: "object",
    properties: {
      claims: { type: "array", maxItems: 12, items: { type: "object", properties: { tags: { type: "array", maxItems: 3 } } } },
    },
  };

  it("strips maxItems for the google family, at every depth", () => {
    const folded = JSON.stringify(foldSchemaFor("google/gemini-3.5-flash-lite", schema));
    expect(folded).not.toContain("maxItems");
    // Only constraint keywords go; the shape survives.
    expect(folded).toContain('"claims"');
    expect(folded).toContain('"tags"');
  });

  it("hands every other family the grammar untouched", () => {
    expect(foldSchemaFor("qwen/qwen3-235b-a22b-2507", schema)).toBe(schema);
    expect(foldSchemaFor("mistralai/mistral-nemo", schema)).toBe(schema);
  });
});

describe("a watched call: the reply as it arrives", () => {
  const sse = (lines: readonly string[]) => lines.join("\n") + "\n";
  const piece = (content: string, more: Record<string, unknown> = {}) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content }, ...more }] })}`;
  const STREAM = [
    ": OPENROUTER PROCESSING",
    "",
    piece("The "),
    piece("fastest "),
    piece("is Deoxys.", { finish_reason: "stop" }),
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0003 } })}`,
    "data: [DONE]",
  ];

  /** A response whose body arrives in the given pieces, cut wherever the caller says. */
  function streamed(text: string, cuts: readonly number[]): HttpResponse {
    const encoder = new TextEncoder();
    const parts: string[] = [];
    let from = 0;
    for (const cut of cuts) {
      parts.push(text.slice(from, cut));
      from = cut;
    }
    parts.push(text.slice(from));
    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(text),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      }),
    };
  }

  function watched(responses: readonly HttpResponse[]) {
    const stubbed = stub(responses);
    const seen: CallProgress[] = [];
    const instance = new OpenRouterProvider({
      id: "live:strong",
      model: "vendor/model-x",
      apiKey: KEY,
      system: "be honest",
      fetch: stubbed.fetch,
      sleep: () => Promise.resolve(),
      onProgress: (progress) => seen.push(progress),
    });
    return { instance, seen, ...stubbed };
  }

  it("asks the endpoint to stream only when someone is watching", async () => {
    const plain = provider([chat("ok")]);
    await plain.instance.complete(request);
    expect((plain.calls[0]?.body as Record<string, unknown>).stream).toBeUndefined();

    const text = sse(STREAM);
    const { instance, calls } = watched([streamed(text, [])]);
    await instance.complete(request);
    expect((calls[0]?.body as Record<string, unknown>).stream).toBe(true);
  });

  it("reports the reply's length as whole pieces land, and returns the same completion a whole reply would", async () => {
    const text = sse(STREAM);
    // Cut mid-line inside the second piece and again inside the third.
    const cutA = text.indexOf("fastest") + 3;
    const cutB = text.indexOf("Deoxys") + 3;
    const { instance, seen } = watched([streamed(text, [cutA, cutB])]);
    const completion = await instance.complete(request);

    expect(completion.text).toBe("The fastest is Deoxys.");
    expect(completion.finishReason).toBe("stop");
    expect(completion.usage).toMatchObject({ promptTokens: 12, completionTokens: 5, costUsd: 0.0003, costedCalls: 1 });
    // Monotone, whole-line counts: the half piece is not counted until it closes.
    expect(seen.map((progress) => progress.chars)).toEqual([4, 12, 22]);
  });

  it("a transport that cannot stream still completes — a whole JSON reply reads as before", async () => {
    const { instance, seen } = watched([chat("ok", { prompt_tokens: 1, completion_tokens: 1 })]);
    const completion = await instance.complete(request);
    expect(completion.text).toBe("ok");
    expect(seen).toEqual([]);
  });

  it("an error chunk in the stream is a provider error, never an answer", async () => {
    const text = sse([piece("The "), `data: ${JSON.stringify({ error: { message: "upstream fell over", code: 502 } })}`, "data: [DONE]"]);
    // One fresh stream per attempt: a body can be read once.
    const { instance } = watched([streamed(text, []), streamed(text, []), streamed(text, [])]);
    const failure = await instance.complete(request).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(String(failure)).toMatch(/provider error — .*upstream fell over/);
  });

  it("a stream cut off mid-chunk is a failure the run can count, not a truncated answer", async () => {
    const text = sse([piece("The "), "data: {\"choices\":[{\"delta\":{\"content\":\"fast"]);
    const { instance } = watched([streamed(text, []), streamed(text, []), streamed(text, [])]);
    await expect(instance.complete(request)).rejects.toThrow(/not JSON|cut off/);
  });

  it("assembleStream: pieces in order, finish reason and usage from the chunks that carried them", () => {
    expect(assembleStream(sse(STREAM))).toEqual({
      choices: [{ message: { content: "The fastest is Deoxys." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0003 },
    });
    expect(assembleStream(sse([piece("a"), piece("b")]))).toEqual({ choices: [{ message: { content: "ab" } }] });
    expect(() => assembleStream("")).toThrow(/no stream chunks/);
  });
});
