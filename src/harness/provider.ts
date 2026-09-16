/**
 * The model seam: the one place a live model would plug in, reduced to the
 * smallest surface the harness needs.
 *
 * The whole architecture rests on the model living *only* inside "propose"
 * steps — nothing it returns crosses a commit boundary without the kernel's
 * deterministic verification (see docs/architecture.md). A `ModelProvider` is
 * therefore trusted with nothing: it turns a prompt into text, and every path
 * that reads that text (`decode.ts`) fails closed on anything it cannot parse.
 *
 * Two implementations live behind it: a deterministic `ScriptedProvider`, so
 * the harness runs offline and key-free in CI exactly like the demo, and the
 * `OpenRouterProvider` of the billable live run. The live one implements this
 * same interface and changes nothing below it — keeping the seam this narrow is
 * what let that be true.
 */

import type { ScopeDimension, TrainerScope } from "../kernel/contracts.js";
import type { JsonSchema } from "./schema.js";

/** Which propose step a request belongs to. `raw` is the control arm: the
 * same question, no kernel — the reply is published as-is and only measured
 * afterwards. */
export type Purpose = "scope" | "answer" | "raw" | "phrase";

/**
 * Structured context a prompt was built from.
 *
 * A live model reads only {@link CompletionRequest.prompt}; a scripted one
 * switches on this. Carried alongside the prose rather than parsed back out of
 * it, so a test fixture never has to reverse-engineer the wording the advisor
 * happened to choose.
 */
/**
 * The doors an answer-step prompt held open for this one call — what the
 * driver offered the model beyond the question, declared at the request so a
 * trace can show how the prompt was adjusted between two calls without
 * parsing the prompt. Every entry is the driver's decision; none is the
 * model's. Recorded, never read by anything downstream.
 */
export interface DoorState {
  /** The certified rows the prompt carried: the ones this question needs
   * (`retrieval`), the whole registry (`grounded`), or none. */
  reference: "retrieval" | "grounded" | "none";
  /** The aggregate claim kinds the grammar admitted — gated to the ones the
   * question nominates; absent when the grammar was not gated (every kind). */
  fillerKinds?: readonly string[];
  /** The deterministic routes the model could nominate instead of composing,
   * by id — empty when the door was shut (or withdrawn for this call). */
  routes: readonly string[];
  /** Whether the model could ask a clarifying question with typed options. */
  clarify: boolean;
  /** Whether the model could offer follow-up suggestions. */
  suggest: boolean;
  /**
   * The precedents this call held — earlier accepted, on-target exchanges
   * shown as worked examples of which door to take (docs/precedent.md).
   * Held as data, not ids alone, so a trace shows what the model was shown
   * without the store in hand: empty when the door was open and nothing
   * scored above the threshold; absent when the door was shut, and on
   * traces filed before the door existed.
   */
  precedents?: readonly { id: string; score: number; ask: string }[];
  /** Lines carried back from the previous reply to these words, in the
   * driver's fixed wording — empty on a first call. */
  feedback: readonly string[];
  /**
   * The prompt's blocks, in the order emitted, when the call built the
   * block-sequenced prompt (docs/answer-prompt.md) — the prompt's structure
   * as data, so a trace shows which context blocks a call carried without
   * parsing the prose. Absent on the legacy prompt.
   */
  blocks?: readonly string[];
  /**
   * The lessons the explanation route could name on this call, when the
   * lesson door narrowed them (docs/lesson-door.md) — the boundary lesson
   * always among them. Absent when the door was shut and the whole
   * catalogue was open, and on traces filed before the door existed.
   */
  lessons?: readonly string[];
}

export interface RequestHint {
  scenarioId: string;
  /** Scope step: the dimensions still unestablished, and the trainer wording
   * no approved term covered — the long tail a proposal is *for*. */
  missing?: readonly ScopeDimension[];
  unmatched?: readonly string[];
  /** Answer step: the scope the trainer established and the model may answer under. */
  scope?: TrainerScope;
  /** Answer step: the doors this call held open ({@link DoorState}). */
  doors?: DoorState;
}

export interface CompletionRequest {
  purpose: Purpose;
  /** What a live model would see. Deterministic, so a run replays. */
  prompt: string;
  hint: RequestHint;
  /**
   * The reply's grammar, when the step has one.
   *
   * Offered, never imposed: the advisor states the contract, and each provider
   * decides what to do with it — a scripted model ignores it, a live one may
   * hand it to the endpoint as a decoding constraint. Keeping the choice on the
   * provider side is what lets structured output be measured as a variable
   * without anything below the seam changing.
   */
  schema?: { name: string; schema: JsonSchema };
}

/** A rough, deterministic token proxy, so cost reporting has an input without
 * a tokenizer dependency. Words, not characters: closer to real billing and
 * stable across whitespace the renderer owns. */
export function tokenEstimate(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * What a run consumed, in tokens and in money.
 *
 * Cost is whatever the provider *reported*, never inferred from a price table:
 * a table vendored here would be a guess that rots the week a model is
 * repriced, and a wrong dollar figure printed beside the enforcement zeros
 * would devalue the zeros. So the count of calls and the count of calls the
 * provider actually priced are both carried — a report saying "$0.00" has to be
 * able to say whether that is a price or a silence.
 */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  calls: number;
  costedCalls: number;
  costUsd: number;
}

export function emptyUsage(): Usage {
  return { promptTokens: 0, completionTokens: 0, calls: 0, costedCalls: 0, costUsd: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    calls: a.calls + b.calls,
    costedCalls: a.costedCalls + b.costedCalls,
    costUsd: a.costUsd + b.costUsd,
  };
}

export interface Completion {
  text: string;
  usage: Usage;
  /**
   * The provider's own stop reason, verbatim, when it reported one —
   * "length" is the one that matters: a completion cut at the token cap is
   * a different failure from a malformed one, and a decode error that does
   * not say so sends the debugger hunting the wrong bug (docs/scale.md, S1).
   * Absent for scripted providers; nothing downstream may require it.
   */
  finishReason?: string;
}

/**
 * The model, as far as the harness is concerned: prompt in, text out, and a
 * stable id so a run artifact records which model produced it.
 */
export interface ModelProvider {
  readonly id: string;
  complete(request: CompletionRequest): Promise<Completion>;
}

/** A scripted model's behaviour: request in, completion text out. An empty
 * string is a valid answer — it means "nothing usable", which the decoders
 * turn into a fail-closed abstention rather than a guess. */
export type Script = (request: CompletionRequest) => string;

/**
 * A deterministic model. No network, no key, no clock — the same request always
 * yields the same completion, so a harness run is itself replayable (IA-10).
 *
 * A scripted provider may return malformed text, a fabricated fact, or a wrong
 * interpretation on purpose: that is how the crucible's discipline reaches the
 * harness. What it may never do is make any of those *commit* — that is the
 * kernel's job, and the enforcement metric is the proof it did it.
 */
export class ScriptedProvider implements ModelProvider {
  constructor(
    readonly id: string,
    private readonly script: Script,
  ) {}

  complete(request: CompletionRequest): Promise<Completion> {
    const text = this.script(request);
    return Promise.resolve({
      text,
      usage: {
        promptTokens: tokenEstimate(request.prompt),
        completionTokens: tokenEstimate(text),
        // A scripted model's cost is zero, and that zero is a price rather than
        // a silence — so the call counts as priced.
        calls: 1,
        costedCalls: 1,
        costUsd: 0,
      },
    });
  }
}

/**
 * A provider that always fails, standing in for a live endpoint that is down or
 * rate-limited. Its point is that a provider failure is *counted*, never folded
 * into a semantic rate: the run records it as an infrastructure error, separate
 * from the model declining to answer. The OpenRouter driver surfaces real
 * outages through this same rejection path.
 */
export class FailingProvider implements ModelProvider {
  constructor(
    readonly id: string,
    private readonly reason = "provider unavailable",
  ) {}

  complete(_request: CompletionRequest): Promise<Completion> {
    return Promise.reject(new Error(this.reason));
  }
}
