/**
 * The Advisor's two propose steps, wired to a model.
 *
 * This is the only code that lets a model speak into the pipeline, and it is
 * trusted with nothing. A scope proposal becomes an untrusted `proposal` event
 * that binds only if the trainer confirms it (the kernel's ladder); an answer
 * becomes a draft that `compileManifest` recomputes from the snapshot. The
 * adapter's whole job is to build the prompt, decode the reply, and hand the
 * result to machinery that assumes it is hostile.
 *
 * Prompts are plain and deterministic. A run has to replay (IA-10), so nothing
 * here reads a clock or the environment; the timestamp an event carries is
 * supplied by the caller, exactly as `runTransaction` takes its own.
 */

import type { ScopeDimension, ScopeEvent, ScopeTranscript, TrainerScope } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import type { AccordPack } from "../kernel/pack.js";
import { candidateDigest } from "../kernel/scope.js";
import { type AnswerDecode, decodeAnswer, decodeCandidate } from "./decode.js";
import type { CompletionRequest, ModelProvider, Usage } from "./provider.js";

/** Only the trainer's own words are evidence (IA-8); the model interprets those. */
function trainerText(transcript: ScopeTranscript): string[] {
  return transcript
    .filter((event): event is Extract<ScopeEvent, { kind: "utterance" }> => event.kind === "utterance")
    .filter((event) => event.source === "trainer")
    .map((event) => event.text);
}

function approvedValues(pack: AccordPack, dimension: ScopeDimension): string {
  const rule = pack.vocabulary.dimensions.find((entry) => entry.dimension === dimension);
  return (rule?.terms ?? []).map((term) => String(term.value)).join(", ");
}

function scopePrompt(pack: AccordPack, missing: readonly ScopeDimension[], said: readonly string[]): string {
  const options = missing.map((dimension) => `  ${dimension}: one of [${approvedValues(pack, dimension)}]`).join("\n");
  return [
    "The trainer said:",
    ...said.map((line) => `  - ${line}`),
    "",
    `Still unestablished: ${missing.join(", ")}.`,
    "Propose one approved value per dimension you can justify from the trainer's",
    "own words, as JSON: {\"candidate\": {<dimension>: <value>}, \"interpreting\": \"<their wording>\"}.",
    "Approved values:",
    options,
  ].join("\n");
}

function answerPrompt(scope: TrainerScope): string {
  return [
    "Scope is established:",
    `  version=${scope.version} region=${scope.region} badges=${scope.badgeLevel}` +
      (scope.comparisonBasis === undefined ? "" : ` basis=${scope.comparisonBasis}`),
    "",
    "Return the certified answer as JSON {\"rosters\": [...], \"claims\": [...]}.",
    "Every claim is recomputed from the registry before it may commit.",
  ].join("\n");
}

export interface ScopeStep {
  usage: Usage;
  /** The proposal to append, or null when the model returned nothing usable. */
  event: Extract<ScopeEvent, { kind: "proposal" }> | null;
}

export interface ScopeStepInput {
  provider: ModelProvider;
  pack: AccordPack;
  scenarioId: string;
  transcript: ScopeTranscript;
  missing: readonly ScopeDimension[];
  unmatched: readonly string[];
  /** Stable per turn, so the proposal id and its confirmation replay. */
  turn: number;
  at: string;
}

/** Ask the model to interpret long-tail wording, and record it as an untrusted
 * proposal. A malformed reply yields no event — a fail-closed abstention. */
export async function proposeScope(input: ScopeStepInput): Promise<ScopeStep> {
  const said = trainerText(input.transcript);
  const request: CompletionRequest = {
    purpose: "scope",
    prompt: scopePrompt(input.pack, input.missing, said),
    hint: { scenarioId: input.scenarioId, missing: input.missing, unmatched: input.unmatched },
  };
  const completion = await input.provider.complete(request);
  const decoded = decodeCandidate(completion.text, input.pack);
  if (decoded === null) return { usage: completion.usage, event: null };
  return {
    usage: completion.usage,
    event: {
      kind: "proposal",
      at: input.at,
      id: `prop-${input.scenarioId}-${input.turn}`,
      candidate: decoded.candidate,
      interpreting: decoded.interpreting,
    },
  };
}

export interface AnswerStep {
  usage: Usage;
  decode: AnswerDecode;
}

/** Ask the model for the certified answer and decode it into a draft. Whether
 * the draft survives is `compileManifest`'s ruling, not the advisor's. */
export async function proposeAnswer(
  provider: ModelProvider,
  context: ManifestContext,
  scenarioId: string,
  transactionId: string,
): Promise<AnswerStep> {
  const request: CompletionRequest = {
    purpose: "answer",
    prompt: answerPrompt(context.grant.scope),
    hint: { scenarioId, scope: context.grant.scope },
  };
  const completion = await provider.complete(request);
  return { usage: completion.usage, decode: decodeAnswer(completion.text, context, transactionId) };
}

/** The digest a truthful trainer names when confirming a proposal it agrees
 * with. Exposed so the trainer and the kernel compute the same one. */
export function proposalDigest(event: Extract<ScopeEvent, { kind: "proposal" }>): string {
  return candidateDigest(event.id, event.candidate);
}
