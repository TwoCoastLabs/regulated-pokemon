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

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The slice of `fetch` this driver uses, named so a test can supply its own
 * and CI never acquires a network dependency by accident. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
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
  /** Retries *after* the first attempt, for transient failures only. */
  retries?: number;
  /** Fixed rather than jittered: a run artifact should be as reproducible as a
   * live provider allows, and jitter buys nothing at this call volume. */
  backoffMs?: readonly number[];
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  maxTokens: 2048,
  timeoutMs: 60_000,
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

/** Transient: worth another attempt. Anything else is our bug or our key, and
 * retrying it only bills again for the same mistake. */
function isTransient(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export interface ChatResponse {
  choices?: readonly { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
  error?: { message?: unknown; code?: unknown };
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
  private readonly config: Required<Omit<OpenRouterConfig, "fetch" | "sleep">> & {
    fetch: FetchLike;
    sleep: (ms: number) => Promise<void>;
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
    const { url, apiKey, model, system, maxTokens, timeoutMs, fetch: send } = this.config;

    const body = JSON.stringify({
      model,
      // Asked for, never assumed: identical prompts still diverge across
      // repetitions, and the harness is built for that rather than against it.
      temperature: 0,
      max_tokens: maxTokens,
      // OpenRouter only prices the call when asked to.
      usage: { include: true },
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

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      throw new ProviderError(
        `${this.id}: HTTP ${response.status} — ${snippet(raw, apiKey)}`,
        attempt,
        response.status,
      );
    }

    let payload: ChatResponse;
    try {
      payload = JSON.parse(raw) as ChatResponse;
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

    return { text: content, usage: readUsage(payload, request, content) };
  }
}
