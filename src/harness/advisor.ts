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
import { SPECIES_FACT_IDS } from "../kernel/registry.js";
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

/**
 * The answer contract, described but never answered.
 *
 * A live model cannot return a shape it was never shown: told only "reply with
 * rosters and claims" it invents a plausible team-builder object and the
 * decoder rejects it, so usefulness reads zero for a reason that has nothing to
 * do with the architecture. This spells out the schema — the roster-criteria
 * vocabulary and the claim kinds — and deliberately no content: no entity, no
 * count, no stat value appears here, so what the model asserts is still its own
 * and the usefulness number still measures the model. Identifiers are the
 * registry's canonical ids (lowercase, hyphenated), and a claim is recomputed
 * from the certified registry before it may commit, so an unsupported one sinks
 * the whole answer — omit what you cannot stand behind rather than guess.
 *
 * It also shows the model what the trainer actually asked. That is a
 * correctness fix, not a nudge toward a number: the step was composing an
 * answer from the *profile* alone (version, region, badges) and could not see
 * the question, so it improvised unbidden claims — and every unrequested claim
 * is one more thing that can be wrong and sink the whole answer under IA-4. A
 * responsive advisor answers what was asked; showing it the ask is the input
 * that step was missing, not tuning to make the reply look better.
 *
 * And it names the certified fact vocabulary — the fact *ids* that resolve, not
 * their *values*. A model asked for a species fact reaches for a plausible id
 * ("type", "national-dex-number") the snapshot does not carry, and IA-2 refuses
 * it though the value it had in mind was right. Listing the ids (drawn straight
 * from the registry, so the prompt cannot drift from what actually resolves) is
 * the same schema disclosure the roster vocabulary already makes: the menu, not
 * the meal. What each fact *is* stays the model's to assert or omit.
 *
 * The whole block is part of the run artifact by design: a reader can see
 * exactly what the model was and was not told.
 */
function answerPrompt(scope: TrainerScope, asks: readonly string[]): string {
  return [
    "Scope is established:",
    `  version=${scope.version} region=${scope.region} badges=${scope.badgeLevel}` +
      (scope.comparisonBasis === undefined ? "" : ` basis=${scope.comparisonBasis}`),
    "",
    "The trainer's own words:",
    ...asks.map((line) => `  - ${line}`),
    "",
    "Answer what they asked, and assert nothing they did not: an unrequested",
    "claim is one more thing that can be wrong, and one wrong claim refuses the",
    "whole answer. Omit anything you cannot support rather than guess.",
    "",
    'Reply with one JSON object, {"rosters": [...], "claims": [...]}, and nothing else.',
    "",
    "A roster is a declarative set you name and then cite by id:",
    '  {"id": "<your-id>", "criteria": {"all": [<criterion>, ...]}}',
    "where each criterion is one of:",
    '  {"kind": "has-type", "type": "<type-id>"}',
    '  {"kind": "learns-move", "move": "<move-id>"}',
    '  {"kind": "rarity", "rarity": "legendary" | "mythical"}',
    '  {"kind": "stat-at-least", "stat": "<stat-id>", "value": <number>}',
    '  {"kind": "stat-at-most", "stat": "<stat-id>", "value": <number>}',
    "A species is a member exactly when it satisfies every criterion.",
    "",
    "Each claim is one of:",
    '  {"kind": "fact", "entityId": "<id>", "factId": "<fact-id>", "asserted": {"kind": "number"|"boolean"|"text"|"list"|"absent", "value": ...}}',
    '  {"kind": "count", "rosterId": "<id>", "reported": <number>}',
    '  {"kind": "membership", "rosterId": "<id>", "entityId": "<id>", "asserted": <boolean>}',
    '  {"kind": "ranking", "rosterId": "<id>", "basis": "<fact-id>", "direction": "highest"|"lowest", "selectedEntityId": "<id>"}',
    '  {"kind": "recommendation", "entityId": "<id>"}',
    "",
    "A <fact-id> must be one of these certified species facts; no other id resolves:",
    `  ${SPECIES_FACT_IDS.join(", ")}`,
    "Cite only rosters you defined; recompute nothing you are unsure of — omit it.",
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

export interface AnswerStepInput {
  provider: ModelProvider;
  context: ManifestContext;
  scenarioId: string;
  transactionId: string;
  /** The exchange so far. Only the trainer's own utterances are shown to the
   *  model, so the answer can be responsive to what was actually asked rather
   *  than improvised from the profile alone (IA-8: only the trainer speaks). */
  transcript: ScopeTranscript;
}

/** Ask the model for the certified answer and decode it into a draft. Whether
 * the draft survives is `compileManifest`'s ruling, not the advisor's. */
export async function proposeAnswer(input: AnswerStepInput): Promise<AnswerStep> {
  const { provider, context, scenarioId, transactionId } = input;
  const request: CompletionRequest = {
    purpose: "answer",
    prompt: answerPrompt(context.grant.scope, trainerText(input.transcript)),
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
