/**
 * The one file in this repository that spends money.
 *
 * It implements {@link ModelProvider} and nothing else: a prompt goes out to
 * OpenRouter, text comes back, and everything downstream treats that text as
 * hostile exactly as it treats a scripted model's. That is the whole claim this
 * slice makes good on — the live run changes who is proposing, and changes
 * nothing about what may commit.
 *
 * Four rules it holds to, each of which is a way a live driver usually goes
 * wrong:
 *
 *  - **A failure is a rejection, never an empty answer.** An outage, a rate
 *    limit, a truncated body, a reply with no content: all reject, so the run
 *    counts them as infrastructure errors instead of reading them as a model
 *    that abstained. A silent `""` here would show up as a usefulness number
 *    and quietly libel the model.
 *  - **Retry only what is worth retrying.** 408/429/5xx and transport errors
 *    are transient; a 400 or a 401 is a bug or a bad key, and retrying it just
 *    bills three times for the same mistake.
 *  - **The key never enters a message.** Errors carry a status and a truncated
 *    body, with any occurrence of the key scrubbed — an error report is one of
 *    the places a secret escapes into a log or an issue.
 *  - **Cost is reported, not computed.** OpenRouter prices the call and we
 *    record what it says; see {@link Usage} for why a price table here would be
 *    worse than no number at all.
 *
 * Determinism is requested (`temperature: 0`) and not relied upon: providers
 * diverge across identical prompts anyway, which is why the live harness has a
 * repetition dial rather than single-shot assertions.
 */

import {
  type Completion,
  type CompletionRequest,
  type ModelProvider,
  tokenEstimate,
  type Usage,
} from "./provider.js";
import type { JsonSchema } from "./schema.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The slice of `fetch` this driver uses, named so a test can supply its own
 * and CI never acquires a network dependency by accident. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  /** The body as it arrives, when the transport can hand it over piecewise
   * (a real `fetch` Response can). Read only when a call is being watched. */
  body?: ReadableStream<Uint8Array> | null;
}
export interface HttpRequest {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}
export type FetchLike = (url: string, init: HttpRequest) => Promise<HttpResponse>;

export interface OpenRouterConfig {
  /** The harness-facing id — "live:strong", not the slug. Recorded on every run. */
  id: string;
  /** The OpenRouter model slug, e.g. "anthropic/claude-sonnet-4.5". */
  model: string;
  apiKey: string;
  /** The persona. The only thing that differs between the honest models and the
   * adversary; the harness prompts are identical for all three. */
  system: string;
  url?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Hand the request's schema to the endpoint as a decoding constraint.
   *
   * The harness turns this on by default, having measured it: on the weak model
   * it took resolution from 4/12 to 9/12 with committed violations still at
   * zero, because it constrains *shape* and never content. It stays off unless
   * asked here, so this driver remains a plain client and the comparison stays
   * reproducible. It changes nothing downstream — every value still faces the
   * same verification.
   */
  structured?: boolean;
  /** Retries *after* the first attempt, for transient failures only. */
  retries?: number;
  /** Fixed rather than jittered: a run artifact should be as reproducible as a
   * live provider allows, and jitter buys nothing at this call volume. */
  backoffMs?: readonly number[];
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Watch the reply arrive. When set, the call asks the endpoint to stream
   * and reports the reply's length so far as each piece lands — a page can
   * show that the model is writing, and roughly how much. Observation only:
   * the completion returned is the same whole text, usage and finish reason
   * it would be unstreamed, and nothing downstream can tell the difference.
   * A transport that cannot stream (a test's stub) still completes; it just
   * reports nothing until the end.
   */
  onProgress?: (progress: CallProgress) => void;
}

/** The reply so far, while a watched call is in flight. */
export interface CallProgress {
  /** Characters of reply content received so far. */
  chars: number;
}

const DEFAULTS = {
  maxTokens: 2048,
  timeoutMs: 60_000,
  structured: false,
  retries: 2,
  backoffMs: [1_000, 4_000] as readonly number[],
};

/** Every way a live call can fail, as one type the run counts as infrastructure. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Belt and braces: nothing built from a response body reaches a message, a log
 * or an artifact with the key still in it. */
export function redact(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("[redacted]");
}

function snippet(body: string, apiKey: string): string {
  const flat = redact(body, apiKey).replace(/\s+/g, " ").trim();
  return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`;
}

/**
 * JSON-schema keywords a model's upstream rejects outright, by model prefix.
 *
 * The advisor states one grammar; what each endpoint can enforce of it is the
 * provider's business (the schema is offered, never imposed). Google's schema
 * parser returns INVALID_ARGUMENT for `maxItems` (observed live, 2026-08-30:
 * every gemini answer call 400ed the moment S1's bound landed), so the fold
 * strips it for that family — the bound itself still holds everywhere,
 * because the decoder enforces the same budget deterministically
 * (decode.ts). A fold only ever *removes* constraint keywords: a folded
 * schema accepts a superset, so nothing that would have decoded stops
 * decoding, and nothing downstream trusts shape anyway.
 */
const SCHEMA_KEYWORD_HOLES: readonly { prefix: string; strip: readonly string[] }[] = [
  { prefix: "google/", strip: ["maxItems"] },
];

function stripKeys(node: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((entry) => stripKeys(entry, keys));
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([key]) => !keys.has(key))
        .map(([key, value]) => [key, stripKeys(value, keys)]),
    );
  }
  return node;
}

/** The grammar, folded to what this model's upstream accepts. Exported for the
 * test that pins the fold to the families that need it and no others. */
export function foldSchemaFor(model: string, schema: JsonSchema): JsonSchema {
  const hole = SCHEMA_KEYWORD_HOLES.find((entry) => model.startsWith(entry.prefix));
  if (hole === undefined) return schema;
  return stripKeys(schema, new Set(hole.strip)) as JsonSchema;
}

/** Transient: worth another attempt. Anything else is our bug or our key, and
 * retrying it only bills again for the same mistake. */
function isTransient(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export interface ChatResponse {
  choices?: readonly { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
  error?: { message?: unknown; code?: unknown };
  /** The upstream that served the call, as the gateway names it. */
  provider?: unknown;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Read usage off the response, falling back to the word estimate when the
 * provider says nothing — and recording *which* of those happened, so a report
 * never prints a silence as though it were a price.
 */
export function readUsage(payload: ChatResponse, request: CompletionRequest, text: string): Usage {
  const reported = payload.usage ?? {};
  const cost = isNumber(reported.cost) ? reported.cost : undefined;
  return {
    promptTokens: isNumber(reported.prompt_tokens) ? reported.prompt_tokens : tokenEstimate(request.prompt),
    completionTokens: isNumber(reported.completion_tokens) ? reported.completion_tokens : tokenEstimate(text),
    calls: 1,
    costedCalls: cost === undefined ? 0 : 1,
    costUsd: cost ?? 0,
  };
}

/**
 * A live model behind the same interface as a scripted one.
 *
 * Stateless between calls by construction: the harness's own transcript is the
 * only memory in the system, so a retry or a repetition can never inherit
 * context the record does not show.
 */
export class OpenRouterProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  private readonly config: Required<Omit<OpenRouterConfig, "fetch" | "sleep" | "onProgress">> & {
    fetch: FetchLike;
    sleep: (ms: number) => Promise<void>;
    onProgress?: (progress: CallProgress) => void;
  };

  constructor(config: OpenRouterConfig) {
    if (config.apiKey.trim() === "") {
      // Fail closed at construction: a provider with no key would otherwise
      // spend a whole run turning 401s into "the model abstained".
      throw new ProviderError(`no API key for ${config.id}`, 0);
    }
    this.id = config.id;
    this.model = config.model;
    this.config = {
      ...DEFAULTS,
      url: OPENROUTER_URL,
      ...config,
      fetch: config.fetch ?? ((url, init) => fetch(url, init)),
      sleep: config.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    };
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const { retries, backoffMs, sleep } = this.config;
    let last: ProviderError = new ProviderError(`${this.id} was never called`, 0);

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        return await this.attempt(request, attempt);
      } catch (cause) {
        last = cause instanceof ProviderError ? cause : new ProviderError(String(cause), attempt);
        const retriable = last.status === undefined || isTransient(last.status);
        if (!retriable || attempt > retries) break;
        await sleep(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0);
      }
    }
    throw last;
  }

  private async attempt(request: CompletionRequest, attempt: number): Promise<Completion> {
    const { url, apiKey, model, system, maxTokens, timeoutMs, structured, fetch: send, onProgress } = this.config;

    // Shape only. The grammar cannot make a claim true, and nothing downstream
    // trusts it any more for having been well-formed.
    const format =
      structured && request.schema !== undefined
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: request.schema.name, strict: true, schema: foldSchemaFor(model, request.schema.schema) },
            },
          }
        : {};

    const body = JSON.stringify({
      model,
      // Asked for, never assumed: identical prompts still diverge across
      // repetitions, and the harness is built for that rather than against it.
      temperature: 0,
      max_tokens: maxTokens,
      // OpenRouter only prices the call when asked to.
      usage: { include: true },
      // Only a watched call streams: unwatched, the wire is the plain,
      // whole-body reply the relay and the harness have always read.
      ...(onProgress === undefined ? {} : { stream: true }),
      ...format,
      messages: [
        { role: "system", content: system },
        { role: "user", content: request.prompt },
      ],
    });

    let response: HttpResponse;
    try {
      response = await send(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          // OpenRouter attributes traffic by these; both name this project.
          // Header values are ByteString: ASCII only, so no em dash here — a
          // character > 255 makes `fetch` reject every call at the transport
          // layer, which reads downstream as a total provider outage.
          "http-referer": "https://github.com/smartnose/regulated-pokemon",
          "x-title": "Regulated Pokemon - Indigo Accord harness",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      // Transport: a timeout, a reset, DNS. No status, so it counts as transient.
      throw new ProviderError(`${this.id}: request failed (${redact(String(cause), apiKey)})`, attempt);
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new ProviderError(
        `${this.id}: HTTP ${response.status} — ${snippet(raw, apiKey)}`,
        attempt,
        response.status,
      );
    }

    const raw = await readBody(response, onProgress).catch((cause: unknown) => {
      throw new ProviderError(`${this.id}: reply cut off (${redact(String(cause), apiKey)})`, attempt);
    });

    let payload: ChatResponse;
    try {
      payload = raw.trimStart().startsWith("{") ? (JSON.parse(raw) as ChatResponse) : assembleStream(raw);
    } catch {
      throw new ProviderError(`${this.id}: response was not JSON — ${snippet(raw, apiKey)}`, attempt);
    }

    // A 200 carrying an error is OpenRouter's way of reporting an upstream
    // provider failure. Reading it as an answer would be the exact mistake this
    // driver exists to avoid.
    if (payload.error !== undefined) {
      throw new ProviderError(`${this.id}: provider error — ${snippet(JSON.stringify(payload.error), apiKey)}`, attempt);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new ProviderError(`${this.id}: response carried no message content`, attempt);
    }

    const finishReason = payload.choices?.[0]?.finish_reason;
    return {
      text: content,
      usage: readUsage(payload, request, content),
      ...(typeof finishReason === "string" ? { finishReason } : {}),
      ...(typeof payload.provider === "string" && payload.provider !== "" ? { servedBy: payload.provider } : {}),
    };
  }
}

// --- the reply as it arrives ------------------------------------------------

/**
 * The whole body, read piecewise when the transport allows and someone is
 * watching, whole otherwise. While reading, every content piece of a streamed
 * reply is counted and reported; the text returned is the raw wire body either
 * way, so the caller parses one thing.
 */
async function readBody(response: HttpResponse, onProgress: ((progress: CallProgress) => void) | undefined): Promise<string> {
  const body = response.body;
  if (onProgress === undefined || body === undefined || body === null) return response.text();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let raw = "";
  let chars = 0;
  let scanned = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    // Count only whole lines: a JSON piece cut mid-line is counted once it
    // closes, never guessed at.
    const end = raw.lastIndexOf("\n");
    if (end < scanned) continue;
    for (const line of raw.slice(scanned, end).split("\n")) chars += streamLine(line)?.content.length ?? 0;
    scanned = end + 1;
    onProgress({ chars });
  }
  raw += decoder.decode();
  return raw;
}

interface StreamChunk {
  choices?: readonly { delta?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: ChatResponse["usage"];
  error?: ChatResponse["error"];
  provider?: unknown;
}

/** One line of a server-sent event stream, read for what a chunk carries;
 * comments, blanks and the terminator carry nothing. */
function streamLine(line: string): { content: string; chunk: StreamChunk } | undefined {
  if (!line.startsWith("data:")) return undefined;
  const data = line.slice(5).trim();
  if (data === "" || data === "[DONE]") return undefined;
  const chunk = JSON.parse(data) as StreamChunk;
  const piece = chunk.choices?.[0]?.delta?.content;
  return { content: typeof piece === "string" ? piece : "", chunk };
}

/**
 * A streamed reply folded back into the shape of a whole one: the content
 * pieces in order, the finish reason and usage from whichever chunks carried
 * them, an error from any chunk that did. Exported for the test that pins
 * the fold.
 */
export function assembleStream(raw: string): ChatResponse {
  let content = "";
  let finishReason: unknown;
  let usage: ChatResponse["usage"];
  let error: ChatResponse["error"];
  let provider: unknown;
  let chunks = 0;
  for (const line of raw.split("\n")) {
    const read = streamLine(line.replace(/\r$/, ""));
    if (read === undefined) continue;
    chunks += 1;
    content += read.content;
    const reason = read.chunk.choices?.[0]?.finish_reason;
    if (typeof reason === "string") finishReason = reason;
    if (read.chunk.usage !== undefined) usage = read.chunk.usage;
    if (read.chunk.error !== undefined) error = read.chunk.error;
    if (typeof read.chunk.provider === "string") provider = read.chunk.provider;
  }
  if (chunks === 0) throw new Error("no stream chunks");
  if (error !== undefined) return { error };
  return {
    choices: [{ message: { content }, ...(finishReason === undefined ? {} : { finish_reason: finishReason }) }],
    ...(usage === undefined ? {} : { usage }),
    ...(provider === undefined ? {} : { provider }),
  };
}
