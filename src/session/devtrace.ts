/**
 * The dev trace: the live session's model seam, made visible for dogfooding.
 *
 * The session driver talks to a model through exactly one door —
 * `ModelProvider.complete` — so one wrapper over that door sees every prompt,
 * every completion, every latency and every provider failure without touching
 * the driver or the kernel. That is all this module is: a tap on the seam,
 * and a serializer that folds the tapped calls together with the session's
 * own record into one self-describing report a person can hand to a
 * debugging agent (or a teammate) whole.
 *
 * Nothing here is enforcement. The tap changes no request and no completion;
 * a session traced and a session untraced file identical records. It lives
 * under src/ rather than app/ so the page's debugging door is tested,
 * coverage-counted code like everything else the app leans on.
 */

import type { Completion, CompletionRequest, DoorState, ModelProvider, Purpose, Usage } from "../harness/provider.js";
import { ledgerOf } from "./ledger.js";
import type { SessionState } from "./session.js";

/** One model call as the tap saw it: the request, what came back (or what
 * failed), and how long the round trip took. */
export interface ModelCallTrace {
  kind: "model-call";
  /** 1-based position in the session's call order. */
  seq: number;
  at: string;
  purpose: string;
  /** The full prompt, verbatim — a trace that elides the prompt cannot be
   * debugged against. */
  prompt: string;
  /** The response-grammar name, when the step offered one. */
  schema?: string;
  /** The doors the call held open, when the step declared them (the answer
   * step does) — how the prompt was adjusted, as data beside the prompt. */
  doors?: DoorState;
  /** The completion text, verbatim; absent exactly when the call failed. */
  response?: string;
  /** The provider failure, when there was one. The error is rethrown — the
   * tap observes failures, it never swallows them. */
  error?: string;
  usage?: Usage;
  latencyMs: number;
  /** The upstream that served the call, when the provider named it — so a
   * slow call is attributed to its route before the model is blamed. */
  servedBy?: string;
}

/** A model call as it begins: what the tap knows before the reply — the
 * step it belongs to and the doors it holds — for a view that draws the
 * call while it is in flight. The completed call ({@link ModelCallTrace})
 * carries the same `seq`. */
export interface ModelCallStart {
  kind: "model-call-start";
  seq: number;
  at: string;
  purpose: Purpose;
  doors?: DoorState;
}

export interface DevTrace {
  /** Every call so far, in order. A live view may render this directly. */
  readonly calls: readonly ModelCallTrace[];
  /** Wrap a provider so its calls are recorded. Id and behaviour pass
   * through untouched. */
  tap(provider: ModelProvider): ModelProvider;
}

export interface DevTraceDeps {
  /** RFC 3339 wall clock, for the `at` stamps. */
  now: () => string;
  /** Monotonic milliseconds, for latency. Injected: a test must not need a
   * real clock to assert on a duration. */
  elapsedMs: () => number;
  /** Called once per completed (or failed) call, after it is recorded —
   * the live page's mirror-to-disk hook. */
  onCall?: (call: ModelCallTrace) => void;
  /** Called as each call begins, before the provider is asked — the live
   * page's "the model is being asked" signal. Observation only. */
  onCallStart?: (call: ModelCallStart) => void;
}

/** A tap over the provider seam. One instance per session setup. */
export function createDevTrace(deps: DevTraceDeps): DevTrace {
  const calls: ModelCallTrace[] = [];

  function record(call: Omit<ModelCallTrace, "kind" | "seq">): void {
    const entry: ModelCallTrace = { kind: "model-call", seq: calls.length + 1, ...call };
    calls.push(entry);
    deps.onCall?.(entry);
  }

  function tap(provider: ModelProvider): ModelProvider {
    return {
      id: provider.id,
      async complete(request: CompletionRequest): Promise<Completion> {
        const at = deps.now();
        const started = deps.elapsedMs();
        deps.onCallStart?.({ kind: "model-call-start", seq: calls.length + 1, at, purpose: request.purpose, ...(request.hint.doors === undefined ? {} : { doors: request.hint.doors }) });
        const base = {
          at,
          purpose: request.purpose,
          prompt: request.prompt,
          ...(request.schema === undefined ? {} : { schema: request.schema.name }),
          ...(request.hint.doors === undefined ? {} : { doors: request.hint.doors }),
        };
        try {
          const completion = await provider.complete(request);
          record({
            ...base,
            response: completion.text,
            usage: completion.usage,
            latencyMs: deps.elapsedMs() - started,
            ...(completion.servedBy === undefined ? {} : { servedBy: completion.servedBy }),
          });
          return completion;
        } catch (error) {
          record({
            ...base,
            error: error instanceof Error ? error.message : String(error),
            latencyMs: deps.elapsedMs() - started,
          });
          throw error;
        }
      },
    };
  }

  return { calls, tap };
}

/** What the report says about where it came from. */
export interface DevTraceMeta {
  model: string;
  /** "honest" or "adversarial" — which persona the Advisor was given. */
  persona: string;
  /** How the calls were routed among the model's hosts, in plain words
   * (openrouter.ts, describeUpstreamPreference); absent in older traces. */
  upstream?: string;
  snapshotId: string;
  packId: string;
}

/**
 * The whole session as one debugging artifact: the tapped model calls beside
 * the transcript, the filed records, the driver's notes and the running
 * usage. Self-describing on purpose — the report is built to be pasted into
 * a conversation with a debugging agent that has never seen this tab.
 */
export function agentReport(meta: DevTraceMeta, state: SessionState, calls: readonly ModelCallTrace[]): unknown {
  return {
    kind: "live-session-dev-trace",
    what:
      "A dogfooding trace of the Indigo Accord live session: every model call " +
      "(prompt, response, latency, usage), the recorded transcript, every filed " +
      "transaction with its stage verdicts, the driver's ledger (every step of " +
      "every exchange, on its lane, in fixed wording) and the driver's own notes. " +
      "Records replay via replayTransaction against the named snapshot and pack.",
    meta,
    phase: state.phase.kind,
    usage: state.usage,
    providerErrors: state.providerErrors,
    repairs: state.repairs,
    folds: state.folds,
    listingActivations: state.listingActivations,
    nominationRetries: state.nominationRetries,
    linking: state.linking,
    clarification: state.clarification,
    suggestions: state.suggestions,
    feedbackRetries: state.feedbackRetries,
    feedbackDenials: state.feedbackDenials,
    modelCalls: calls,
    transcript: state.transcript,
    records: state.records,
    // The ledger, closed exchanges then the open one: an agent reading the
    // trace file gets the same trail the page draws, steps and lines alike.
    ledger: ledgerOf(state, ""),
    notes: state.notes,
  };
}
