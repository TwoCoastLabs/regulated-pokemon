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
 * This slice ships one implementation — a deterministic `ScriptedProvider`, so
 * the entire harness runs offline and key-free in CI, exactly like the demo.
 * The real OpenRouter driver is a separate, explicitly billable slice (7b): it
 * implements this same interface and changes nothing below it. Keeping the seam
 * this narrow is what lets that be true.
 */

import type { ScopeDimension, TrainerScope } from "../kernel/contracts.js";

/** Which propose step a request belongs to. */
export type Purpose = "scope" | "answer";

/**
 * Structured context a prompt was built from.
 *
 * A live model reads only {@link CompletionRequest.prompt}; a scripted one
 * switches on this. Carried alongside the prose rather than parsed back out of
 * it, so a test fixture never has to reverse-engineer the wording the advisor
 * happened to choose.
 */
export interface RequestHint {
  scenarioId: string;
  /** Scope step: the dimensions still unestablished, and the trainer wording
   * no approved term covered — the long tail a proposal is *for*. */
  missing?: readonly ScopeDimension[];
  unmatched?: readonly string[];
  /** Answer step: the scope the trainer established and the model may answer under. */
  scope?: TrainerScope;
}

export interface CompletionRequest {
  purpose: Purpose;
  /** What a live model would see. Deterministic, so a run replays. */
  prompt: string;
  hint: RequestHint;
}

/** A rough, deterministic token proxy, so cost reporting has an input without
 * a tokenizer dependency. Words, not characters: closer to real billing and
 * stable across whitespace the renderer owns. */
export function tokenEstimate(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface Completion {
  text: string;
  usage: Usage;
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
      },
    });
  }
}

/**
 * A provider that always fails, standing in for a live endpoint that is down or
 * rate-limited. Its point is that a provider failure is *counted*, never folded
 * into a semantic rate: the run records it as an infrastructure error, separate
 * from the model declining to answer. The OpenRouter driver (slice 7b) will
 * surface real outages through this same rejection path.
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
