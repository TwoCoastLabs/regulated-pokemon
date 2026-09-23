/**
 * The League's key, held so a visitor needs none.
 *
 * One small relay in front of OpenRouter: the deployment holds
 * `OPENROUTER_API_KEY` as a secret, the live session page calls this instead
 * of openrouter.ai, and the browser never sees a key at all. The app-side
 * change is nothing but a URL — the same `OpenRouterProvider`, the same
 * driver, the same kernel; this module is deployment surface, not
 * architecture.
 *
 * Rules it holds to, each one a way a hosted key gets burned:
 *
 *  - **It never proxies an arbitrary body.** The upstream request is built
 *    from the fields it understands — model (allowlisted), messages (role
 *    and content, bounded), max_tokens (clamped), the answer grammar's
 *    response_format — and nothing else survives the crossing. Temperature
 *    and usage accounting are the relay's, not the caller's.
 *  - **Abuse is bounded twice.** A per-IP rate limit answers the fast
 *    visitor; a daily spend cap *and* a daily call cap answer everyone at
 *    once — the call cap is the backstop for the calls a provider declines
 *    to price, which would otherwise walk straight past a dollar cap. A
 *    call in flight is already counted: it holds a reservation against
 *    the spend cap until its price is known, so a burst arriving together
 *    cannot all pass the check at once and settle over it.
 *  - **The caps are not the ceiling.** They live in memory and start over
 *    on every restart, and the hosted machine stops when idle, so a day's
 *    cap is really a per-wake cap. The hard ceiling is the key itself: the
 *    relay is served by a dedicated provider key carrying its own credit
 *    limit, which the provider enforces before any call is priced. The
 *    caps here keep one wake cheap; the key keeps the month bounded.
 *  - **It says what it did.** One line per refusal, with the reason and
 *    the request's origin, and one line when the UTC day rolls over with
 *    the day's tallies — enough to read abuse from the log instead of
 *    guessing at it, never a body and never the key.
 *  - **The key never leaves.** It is added at the upstream hop and scrubbed
 *    from every body that comes back, exactly as the driver scrubs its own.
 *  - **Refusals are plain.** A visitor who hits a limit is told what
 *    happened and what to do next, in the player's register — a relay
 *    refusal surfaces in the chat, and "429" is not a sentence.
 *
 * Everything here is pure and injected (fetch, clock, files), so CI proves
 * the whole surface key-free; the node wiring in serve.ts stays too thin to
 * hide a bug in.
 */

import { describeUpstreamPreference, type FetchLike, OPENROUTER_URL, parseUpstreamPreference, redact, type UpstreamPreference } from "../harness/openrouter.js";

export interface RelayConfig {
  /** Empty means "not configured": health reports it and chat refuses. */
  apiKey: string;
  /** The slugs a visitor may run — the measured ones, not a free-for-all. */
  models: readonly string[];
  maxTokens: number;
  perIpLimit: number;
  perIpWindowMs: number;
  dailySpendCapUsd: number;
  dailyCallCap: number;
  /** Ceiling on the summed message content of one request, in characters.
   * The default is a small multiple of the largest prompt the page has
   * sent: 14,457 characters over 353 model calls in the dev trace of
   * 2026-09-04 to 2026-09-23, so 60,000 leaves room for a longer turn
   * and none for a pasted novel. */
  maxContentChars: number;
  /** What a call in flight is assumed to cost until its price comes back,
   * held against the spend cap so concurrent calls cannot all pass the
   * check together. The default is about three times the most expensive
   * page call measured ($0.0038 over 352 priced calls, same trace). */
  callReserveUsd: number;
  upstreamUrl: string;
  /** The operator's routing preference among a model's hosts
   * (OPENROUTER_UPSTREAM): its sort applies when the page sends none, and
   * its ignore list applies to every call — a host the operator has ruled
   * out is ruled out for everyone the relay serves. Reported on health. */
  upstream?: UpstreamPreference;
}

export const RELAY_DEFAULTS = {
  maxTokens: 2048,
  perIpLimit: 30,
  perIpWindowMs: 5 * 60_000,
  dailySpendCapUsd: 1,
  dailyCallCap: 2_000,
  maxContentChars: 60_000,
  callReserveUsd: 0.01,
  upstreamUrl: OPENROUTER_URL,
} as const;

/** Configuration from the environment, defaults stated in one place. The
 * models default is supplied by the caller so this module never imports the
 * harness's model table. */
export function relayConfigFromEnv(env: Record<string, string | undefined>, defaultModels: readonly string[]): RelayConfig {
  const number = (name: string, fallback: number): number => {
    const raw = env[name];
    const parsed = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  // An unknown word is refused by name at startup, as every live tool does.
  const upstream = parseUpstreamPreference(env.OPENROUTER_UPSTREAM);
  return {
    apiKey: env.OPENROUTER_API_KEY ?? "",
    models: env.RELAY_MODELS === undefined ? defaultModels : env.RELAY_MODELS.split(",").map((slug) => slug.trim()).filter(Boolean),
    maxTokens: number("RELAY_MAX_TOKENS", RELAY_DEFAULTS.maxTokens),
    perIpLimit: number("RELAY_PER_IP_LIMIT", RELAY_DEFAULTS.perIpLimit),
    perIpWindowMs: number("RELAY_PER_IP_WINDOW_MS", RELAY_DEFAULTS.perIpWindowMs),
    dailySpendCapUsd: number("RELAY_DAILY_SPEND_CAP_USD", RELAY_DEFAULTS.dailySpendCapUsd),
    dailyCallCap: number("RELAY_DAILY_CALL_CAP", RELAY_DEFAULTS.dailyCallCap),
    maxContentChars: number("RELAY_MAX_CONTENT_CHARS", RELAY_DEFAULTS.maxContentChars),
    callReserveUsd: number("RELAY_CALL_RESERVE_USD", RELAY_DEFAULTS.callReserveUsd),
    upstreamUrl: env.RELAY_UPSTREAM_URL ?? RELAY_DEFAULTS.upstreamUrl,
    ...(upstream === undefined ? {} : { upstream }),
  };
}

export interface RelayDeps {
  config: RelayConfig;
  fetch: FetchLike;
  /** Epoch milliseconds, injected: rate windows and daily caps must replay
   * in tests without waiting for tomorrow. */
  now: () => number;
  /** One line per refusal and per UTC day rollover; the operator's log.
   * Absent means silent, which is what the tests want by default. */
  log?: (line: string) => void;
}

export interface RelayRequest {
  method: string;
  path: string;
  ip: string;
  body: string;
  /** The browser's stated origin (the Origin or Referer header), carried
   * for the log only: whether the door needs an origin check is decided
   * from what the log shows, not assumed. */
  origin?: string;
}

export interface RelayResponse {
  status: number;
  contentType: string;
  body: string;
}

const json = (status: number, value: unknown): RelayResponse => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(value),
});

/** A refusal the chat can show a person. The shape matches OpenRouter's error
 * envelope so the driver needs no second decoder. */
const refuse = (status: number, message: string): RelayResponse =>
  json(status, { error: { message, code: status } });

interface ChatBody {
  model: string;
  messages: readonly { role: "system" | "user"; content: string }[];
  maxTokens: number | undefined;
  responseFormat: unknown;
  /** The routing preference the driver sent, validated to its shape. */
  upstream?: Record<string, unknown>;
}

/** Accept exactly the request the Advisor's driver makes; name what fails.
 * Returns a string refusal reason, or the understood fields. */
function readChatBody(raw: string, config: RelayConfig): ChatBody | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "the request body was not JSON";
  }
  if (typeof parsed !== "object" || parsed === null) return "the request body was not an object";
  const body = parsed as Record<string, unknown>;

  if (typeof body.model !== "string" || !config.models.includes(body.model)) {
    return `the model must be one of: ${config.models.join(", ")}`;
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 4) {
    return "messages must be a list of one to four entries";
  }
  const messages: { role: "system" | "user"; content: string }[] = [];
  let contentChars = 0;
  for (const entry of body.messages as unknown[]) {
    if (typeof entry !== "object" || entry === null) return "each message must be an object";
    const message = entry as Record<string, unknown>;
    if ((message.role !== "system" && message.role !== "user") || typeof message.content !== "string") {
      return "each message must carry a role of system or user, and string content";
    }
    contentChars += message.content.length;
    messages.push({ role: message.role, content: message.content });
  }
  if (contentChars > config.maxContentChars) return "the request is larger than a session's turn can be";

  let responseFormat: unknown;
  if (body.response_format !== undefined) {
    const format = body.response_format as Record<string, unknown>;
    const schema = format.json_schema as Record<string, unknown> | undefined;
    const wellFormed =
      typeof format === "object" &&
      format !== null &&
      format.type === "json_schema" &&
      typeof schema === "object" &&
      schema !== null &&
      typeof schema.name === "string" &&
      typeof schema.schema === "object";
    if (!wellFormed) return "response_format, when present, must be a named json_schema";
    responseFormat = body.response_format;
  }

  // The upstream preference (openrouter.ts, UpstreamPreference): a sort by
  // name and/or a short list of host names, nothing else — the relay never
  // forwards a field it has not read.
  let upstream: Record<string, unknown> | undefined;
  if (body.provider !== undefined) {
    const sent = body.provider as Record<string, unknown>;
    const sortOk = sent.sort === undefined || sent.sort === "throughput" || sent.sort === "latency" || sent.sort === "price";
    const ignoreOk =
      sent.ignore === undefined ||
      (Array.isArray(sent.ignore) && sent.ignore.length <= 8 && sent.ignore.every((host) => typeof host === "string" && /^[A-Za-z0-9 ._-]{1,40}$/.test(host)));
    if (typeof sent !== "object" || sent === null || !sortOk || !ignoreOk) {
      return "provider, when present, must name a sort of throughput, latency or price, and/or an ignore list of host names";
    }
    upstream = {
      ...(sent.sort === undefined ? {} : { sort: sent.sort }),
      ...(sent.ignore === undefined ? {} : { ignore: sent.ignore }),
      allow_fallbacks: true,
    };
  }
  const maxTokens = typeof body.max_tokens === "number" && body.max_tokens > 0 ? body.max_tokens : undefined;
  return { model: body.model, messages, maxTokens, responseFormat, ...(upstream === undefined ? {} : { upstream }) };
}

/** The page's validated preference and the operator's, as one `provider`
 * field: the page's sort when it sent one, else the operator's; the ignore
 * lists joined; nothing at all when neither says anything. */
function mergeRouting(sent: Record<string, unknown> | undefined, operator: UpstreamPreference | undefined): Record<string, unknown> | undefined {
  const sort = sent?.sort ?? operator?.sort;
  const ignore = [...new Set([...((sent?.ignore as readonly string[] | undefined) ?? []), ...(operator?.ignore ?? [])])];
  if (sort === undefined && ignore.length === 0) return undefined;
  return { ...(sort === undefined ? {} : { sort }), ...(ignore.length === 0 ? {} : { ignore }), allow_fallbacks: true };
}

/** UTC day key, so the daily caps roll over at a stated, testable moment. */
function dayOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** The reasons a request can be turned away, as the log names them. */
type RefusalReason = "no-key" | "budget" | "rate" | "body" | "unreachable";

export type RelayHandler = (request: RelayRequest) => Promise<RelayResponse>;

/**
 * The relay, as one function of one request. All limiting state lives in the
 * returned closure: in-memory and reset on restart, which is proportionate —
 * the caps guard a demo budget, not a ledger.
 */
export function createRelay(deps: RelayDeps): RelayHandler {
  const { config } = deps;
  const log = deps.log ?? (() => undefined);
  const hitsByIp = new Map<string, number[]>();
  let day = "";
  let spentUsd = 0;
  /** Calls admitted today, in flight or settled: counted at the door, so
   * a burst cannot pass the call cap together. */
  let calls = 0;
  /** Calls admitted and not yet priced; each holds `callReserveUsd`. */
  let inFlight = 0;
  const refusals = new Map<RefusalReason, number>();

  const caps = {
    dailySpendCapUsd: config.dailySpendCapUsd,
    dailyCallCap: config.dailyCallCap,
    perIpLimit: config.perIpLimit,
    perIpWindowMs: config.perIpWindowMs,
    maxContentChars: config.maxContentChars,
    maxTokens: config.maxTokens,
    callReserveUsd: config.callReserveUsd,
  };

  /** A refusal, tallied and logged by reason — never the body, never the key. */
  const deny = (request: RelayRequest, reason: RefusalReason, status: number, message: string): RelayResponse => {
    refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
    log(`relay refused ${reason} ${status} ip=${request.ip} origin=${request.origin ?? "-"}`);
    return refuse(status, message);
  };

  const tallies = (): string => {
    const refused = [...refusals].map(([reason, n]) => `${reason}=${n}`).join(" ");
    return `${calls} calls, $${spentUsd.toFixed(4)} spent, ${refused === "" ? "0 refused" : `refused ${refused}`}`;
  };

  return async (request) => {
    if (request.path === "/api/relay/health") {
      if (request.method !== "GET") return refuse(405, "health is read-only");
      return config.apiKey === ""
        ? json(503, { ok: false })
        : json(200, { ok: true, models: config.models, caps, ...(config.upstream === undefined ? {} : { upstream: describeUpstreamPreference(config.upstream) }) });
    }

    if (request.path !== "/api/relay/chat") return refuse(404, "no such door");
    if (request.method !== "POST") return refuse(405, "chat is POST-only");
    if (config.apiKey === "") {
      return deny(request, "no-key", 503, "This deployment carries no key, so the Advisor has no model to speak with.");
    }

    const at = deps.now();
    const today = dayOf(at);
    if (today !== day) {
      // The closing day's tallies go to the log before the counters reset;
      // the first day the process sees has nothing to close. A restart
      // resets the same counters without a line — the caps guard a wake.
      if (day !== "") log(`relay day ${day} closed: ${tallies()}; caps reset for ${today}`);
      day = today;
      spentUsd = 0;
      calls = 0;
      refusals.clear();
    }
    if (spentUsd + inFlight * config.callReserveUsd >= config.dailySpendCapUsd || calls >= config.dailyCallCap) {
      return deny(request, "budget", 503, "The League's budget for today is spent. Come back tomorrow.");
    }

    const hits = (hitsByIp.get(request.ip) ?? []).filter((t) => at - t < config.perIpWindowMs);
    if (hits.length >= config.perIpLimit) {
      hitsByIp.set(request.ip, hits);
      return deny(request, "rate", 429, "You're going a little fast — free sessions are rate-limited. Give it a minute and try again.");
    }
    hits.push(at);
    hitsByIp.set(request.ip, hits);

    const read = readChatBody(request.body, config);
    if (typeof read === "string") return deny(request, "body", 400, read);

    // Built, never forwarded: only the understood fields cross, and the
    // relay's own discipline (temperature, usage accounting) is not the
    // caller's to set. The routing is the page's sort or the operator's,
    // and the operator's ignore list on top of either — the veto is the
    // relay's to apply, never the page's to drop.
    const routing = mergeRouting(read.upstream, config.upstream);
    const upstreamBody = JSON.stringify({
      model: read.model,
      temperature: 0,
      max_tokens: Math.min(read.maxTokens ?? config.maxTokens, config.maxTokens),
      usage: { include: true },
      ...(read.responseFormat === undefined ? {} : { response_format: read.responseFormat }),
      ...(routing === undefined ? {} : { provider: routing }),
      messages: read.messages,
    });

    // Admitted: counted and reserved before the wire, released after it,
    // so every call that is out is a call the next check can see.
    calls += 1;
    inFlight += 1;
    let upstream;
    try {
      upstream = await deps.fetch(config.upstreamUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://github.com/TwoCoastLabs/regulated-pokemon",
          "x-title": "Regulated Pokemon - Indigo Accord live session relay",
        },
        body: upstreamBody,
      });
    } catch {
      inFlight -= 1;
      return deny(request, "unreachable", 502, "The model provider could not be reached. Try again in a moment.");
    }

    const raw = await upstream.text().catch(() => "");
    inFlight -= 1;
    // Belt and braces, same as the driver: nothing that came back crosses to
    // a browser with the key still in it.
    const scrubbed = redact(raw, config.apiKey);

    if (upstream.ok) {
      try {
        const payload = JSON.parse(scrubbed) as { usage?: { cost?: unknown } };
        const cost = payload.usage?.cost;
        if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) spentUsd += cost;
      } catch {
        // An unparseable 200 still counted a call; the call cap has it.
      }
    }

    return { status: upstream.status, contentType: "application/json", body: scrubbed };
  };
}

// --- the static half --------------------------------------------------------

const MIME: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
};

/**
 * The built app's files, answered from an injected reader. Path discipline
 * first: only a clean, rooted path with no traversal reaches the reader, so
 * the reader can be a straight filesystem read.
 */
export function staticResponse(
  urlPath: string,
  readFile: (relativePath: string) => Uint8Array | null,
): { status: number; contentType: string; body: Uint8Array | string } {
  const path = urlPath === "/" ? "/index.html" : urlPath;
  if (!path.startsWith("/") || path.includes("..") || path.includes("\0")) {
    return { status: 404, contentType: MIME.txt!, body: "no such page" };
  }
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const contentType = MIME[extension];
  if (contentType === undefined) return { status: 404, contentType: MIME.txt!, body: "no such page" };
  const file = readFile(path.slice(1));
  if (file === null) return { status: 404, contentType: MIME.txt!, body: "no such page" };
  return { status: 200, contentType, body: file };
}
