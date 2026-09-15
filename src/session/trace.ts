/**
 * The session, traced in a terminal: the whole live-session spine driven from
 * argv, with every phase transition, question, proposal, note and record
 * printed as it happens — so a conversation can be reproduced, read and
 * argued about without driving a browser through it.
 *
 * This is a debugging instrument, not a second UI: it calls the same `say`,
 * `decideScope`, `decideAct` and `retry` the live page calls, in the same
 * order, and shows what the page's chat derivation reads — plus the parts the
 * player register deliberately hides (candidate values, denial codes, usage).
 *
 * Everything that decides lives here as a function of its inputs; the CLI
 * entry (trace-cli.ts) only supplies disk, env and a terminal, following
 * live-cli.ts. Tested with scripted providers; billable only when the entry
 * point hands it a real one.
 */

import type { PromptShape } from "../harness/advisor.js";
import type { ScopeCandidate, ScopeEvent } from "../kernel/contracts.js";
import type { Claim } from "../kernel/contracts.js";
import type { Transaction } from "../kernel/transaction.js";
import { describeViolation } from "../kernel/violation.js";
import {
  decideAct,
  decideScope,
  retry,
  say,
  setProfile,
  type SessionDeps,
  type SessionState,
  startSession,
} from "./session.js";
import { allSteps } from "./ledger.js";

/** The inputs a trace understands: visitor words, or one of these commands
 * standing in for the page's buttons. */
export const TRACE_COMMANDS = ["/confirm", "/reject", "/act", "/decline", "/retry", "/profile"] as const;

/**
 * How the proposer is grounded in a live trace.
 *
 *  - `retrieval` the product default (findings §17): only the facts each
 *                question needs — useful and cheap, the reason a cheaper model
 *                can be the default at all.
 *  - `none`      the control-arm demo (§14): the model answers from memory, so a
 *                trace can show a benign fabrication caught by the gate.
 *  - `full`      the whole certified registry, kept for comparison (§16).
 */
export type TraceGrounding = "none" | "full" | "retrieval";

/** What argv asks for, parsed here so the entry point stays straight-line. */
export interface TraceArgs {
  inputs: readonly string[];
  /** An explicit --model slug, when one was given. */
  model?: string;
  weak: boolean;
  adversarial: boolean;
  /** Defaults to `retrieval`; `--ungrounded` selects `none`, `--grounded` full. */
  grounding: TraceGrounding;
  /** Narrow the answer grammar to each question's nominated kinds — on by
   * default (the §19 shape-deflection fix, the product posture); `--loose-grammar`
   * offers every claim kind, the pre-§19 behaviour. */
  gatedGrammar: boolean;
  /** Strip-assertion resubmit on fact-mismatch denials — on by default (the
   * player gets the certified value instead of a denial; docs/recovery.md,
   * channel 2); `--no-repair` files the first-attempt denial instead. */
  repair: boolean;
  /** The verifier-in-the-loop retry (docs/routing.md, R3b) — on by default,
   * the product posture; `--no-feedback` files the first-attempt denial. */
  feedback: boolean;
  /** Clarification (docs/routing.md, R3b step 3) — on by default, the
   * product posture: the model may ask with typed options, a contradiction
   * becomes a question, the pack's scope question is phrased by the model;
   * `--no-clarify` asks the pack's fixed lines and closes on a contradiction. */
  clarify: boolean;
  /** Follow-up suggestions (docs/routing.md, R3b step 4) — on by default;
   * `--no-suggest` offers none and strips any a reply carries. */
  suggest: boolean;
  /** Converse with the Center world — kanto-center under its own pack, the
   * realistic-inquiry setting the coverage maps measure. Off by default: the
   * frozen red-blue world stays the tracer's baseline. */
  center: boolean;
  /** The precedent door (docs/precedent.md) — on by default when the world
   * ships a store; `--no-memory` shuts it, the off arm of the porch reading. */
  memory: boolean;
  /** An explicit store file for the door — an arm of the porch reading;
   * the world's own store under data/precedents/ otherwise. */
  precedentStore?: string;
  /** Which answer prompt to build (docs/answer-prompt.md): `legacy` by
   * default; `--prompt blocks` the fixed block sequence. */
  prompt: PromptShape;
  /** The refused nomination carried back by name (docs/answer-prompt.md,
   * M3) — off by default; `--refusal-feedback` turns it on. */
  refusalFeedback: boolean;
  /** The offered door (docs/offered-door.md): the listing route in the
   * grammar only when the driver would accept it — off by default;
   * `--offered-doors` turns it on. */
  offeredDoors: boolean;
}

export function parseTraceArgs(argv: readonly string[]): TraceArgs {
  const modelFlag = argv.indexOf("--model");
  const model = modelFlag >= 0 ? argv[modelFlag + 1] : undefined;
  const storeFlag = argv.indexOf("--precedent-store");
  const precedentStore = storeFlag >= 0 ? argv[storeFlag + 1] : undefined;
  const promptFlag = argv.indexOf("--prompt");
  const prompt: PromptShape = promptFlag >= 0 && argv[promptFlag + 1] === "blocks" ? "blocks" : "legacy";
  const valued = new Set([modelFlag, storeFlag, promptFlag].filter((index) => index >= 0).map((index) => index + 1));
  const grounding: TraceGrounding = argv.includes("--ungrounded") ? "none" : argv.includes("--grounded") ? "full" : "retrieval";
  return {
    inputs: argv.filter((arg, index) => !arg.startsWith("--") && !valued.has(index)),
    ...(model === undefined ? {} : { model }),
    ...(precedentStore === undefined ? {} : { precedentStore }),
    weak: argv.includes("--weak"),
    adversarial: argv.includes("--adversarial"),
    grounding,
    gatedGrammar: !argv.includes("--loose-grammar"),
    repair: !argv.includes("--no-repair"),
    feedback: !argv.includes("--no-feedback"),
    clarify: !argv.includes("--no-clarify"),
    suggest: !argv.includes("--no-suggest"),
    center: argv.includes("--center"),
    memory: !argv.includes("--no-memory"),
    prompt,
    refusalFeedback: argv.includes("--refusal-feedback"),
    offeredDoors: argv.includes("--offered-doors"),
  };
}

export interface TraceResult {
  lines: readonly string[];
  state: SessionState;
  exitCode: number;
}

/** Drive one scripted conversation and narrate every step. */
export async function runTrace(inputs: readonly string[], deps: SessionDeps): Promise<TraceResult> {
  const lines: string[] = [];
  let state = startSession();

  if (inputs.length === 0) {
    return {
      lines: [
        "usage: session:trace -- <message | command>...",
        `commands stand in for the page's buttons: ${TRACE_COMMANDS.join(", ")}`,
        'example: session:trace -- "what types of pokemons do you have?" "Red and Blue" /confirm',
      ],
      state,
      exitCode: 2,
    };
  }

  for (const input of inputs) {
    const before = state;
    lines.push("");
    try {
      if (input.startsWith("/")) {
        lines.push(`[button] ${input}`);
        state = await press(state, input, deps);
      } else {
        lines.push(`[trainer] ${input}`);
        state = await say(state, input, deps);
      }
    } catch (error) {
      lines.push(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
      return { lines, state, exitCode: 2 };
    }
    lines.push(...narrate(before, state));
  }

  lines.push("", summary(state));
  return { lines, state, exitCode: 0 };
}

async function press(state: SessionState, command: string, deps: SessionDeps): Promise<SessionState> {
  // "/profile version=red-blue,region=kanto,badgeLevel=3" — the page's panel,
  // driven from the terminal. Typed as the form would type it: badgeLevel a
  // number, the rest text; anything unapproved is the kernel's to refuse.
  if (command.startsWith("/profile")) {
    const scope: Record<string, string | number> = {};
    for (const pair of command.slice("/profile".length).trim().split(",")) {
      const [key, raw] = pair.split("=").map((part) => part.trim());
      if (key === undefined || key === "" || raw === undefined) continue;
      scope[key] = key === "badgeLevel" ? Number(raw) : raw;
    }
    return setProfile(state, scope as ScopeCandidate, deps);
  }
  switch (command) {
    case "/confirm":
      return decideScope(state, "confirm", deps);
    case "/reject":
      return decideScope(state, "reject", deps);
    case "/act":
      return decideAct(state, "confirm", deps);
    case "/decline":
      return decideAct(state, "decline", deps);
    case "/retry":
      return retry(state, deps);
    default:
      throw new Error(`unknown command "${command}" — one of ${TRACE_COMMANDS.join(", ")}`);
  }
}

/** Everything that changed in one step, in the order the page would show it. */
function narrate(before: SessionState, after: SessionState): string[] {
  const lines: string[] = [];

  for (const event of after.transcript.slice(before.transcript.length)) {
    const line = describeEvent(event);
    if (line !== undefined) lines.push(`  ${line}`);
  }
  for (const note of after.notes.slice(before.notes.length)) {
    lines.push(`  [note · ${note.tone}] ${note.text}`);
    if (note.detail !== undefined) lines.push(`    [detail] ${note.detail}`);
  }
  for (const record of after.records.slice(before.records.length)) {
    lines.push(...describeRecord(record).map((line) => `  ${line}`));
  }

  const calls = after.usage.calls - before.usage.calls;
  const cost = after.usage.costUsd - before.usage.costUsd;
  if (calls > 0) lines.push(`  [model] ${calls} call${calls === 1 ? "" : "s"}, $${cost.toFixed(4)}`);

  // The driver's ledger, this turn's steps (session/ledger.ts): the trail a
  // reader follows to see how the answer was made, in fixed wording.
  const stepsBefore = allSteps(before).length;
  for (const entry of allSteps(after).slice(stepsBefore)) {
    lines.push(`  [step · ${entry.lane} · ${entry.code}] ${entry.text}`);
  }

  if (after.repairs > before.repairs) {
    // The mis-recall on the books, in the visitor's view: the answer that
    // follows was reached after the system stripped a wrong asserted value and
    // the kernel read the certified one (docs/recovery.md, channel 2).
    lines.push("  [repair] the model mis-recalled a value; the assertion was stripped and the certified value read");
  }
  if (after.feedbackRetries > before.feedbackRetries) {
    // The first attempt on the books (docs/routing.md, R3b): whatever filed
    // above was reached after the kernel's denial was carried back to the
    // model once, by name.
    const denials = after.feedbackDenials.slice(before.feedbackDenials.length).join(", ");
    lines.push(`  [feedback] first attempt denied (${denials}); the denial was carried back to the model once`);
  }
  const linking = after.linking;
  const linkedBefore = before.linking;
  if (linking.offTargetDropped > linkedBefore.offTargetDropped) {
    lines.push(`  [linking] ${linking.offTargetDropped - linkedBefore.offTargetDropped} claim(s) dropped as off the asked fields`);
  }
  if (linking.contradictions > linkedBefore.contradictions) {
    lines.push("  [linking] an alias contradiction was asked about instead of answered");
  }
  if (linking.staleDropped > linkedBefore.staleDropped) {
    lines.push(`  [linking] ${linking.staleDropped - linkedBefore.staleDropped} link(s) about an earlier exchange dropped as stale`);
  }
  const clarifying = after.clarification;
  const clarifiedBefore = before.clarification;
  if (clarifying.picked > clarifiedBefore.picked) lines.push("  [clarify] the reply picked one option — bound for this exchange");
  if (clarifying.ignored > clarifiedBefore.ignored) lines.push("  [clarify] the reply picked no option");
  if (clarifying.capped > clarifiedBefore.capped) lines.push("  [clarify] the chain hit its cap — honest pass");
  if (clarifying.phrased > clarifiedBefore.phrased) lines.push("  [clarify] the pack's question was phrased by the model");
  if (clarifying.unphrased > clarifiedBefore.unphrased) lines.push("  [clarify] the model offered no usable wording — the pack's question was asked");
  const suggesting = after.suggestions;
  const suggestedBefore = before.suggestions;
  if (suggesting.dropped > suggestedBefore.dropped) {
    lines.push(`  [suggest] ${suggesting.dropped - suggestedBefore.dropped} follow-up(s) dropped for stating a value or naming a certified id`);
  }
  if (suggesting.taken > suggestedBefore.taken) lines.push("  [suggest] the trainer took a suggested follow-up");
  if (suggesting.deadEnded > suggestedBefore.deadEnded) lines.push("  [suggest] the suggested follow-up dead-ended — no record, nothing left open");

  lines.push(`  [phase] ${describePhase(after)}`);
  return lines;
}

function describeEvent(event: ScopeEvent): string | undefined {
  switch (event.kind) {
    case "utterance":
      // The trainer's words were already echoed as the input line.
      return event.source === "trainer" ? undefined : `[${event.source}] ${event.text}`;
    case "question":
      return `[advisor asks · ${event.dimension}] ${event.text}`;
    case "clarification":
      return `[advisor clarifies · "${event.about}"] ${event.text} — options: ${event.options
        .map((option) => `${option.label} (${option.kind === "field" ? (option.fieldId ?? "none") : option.entityId})`)
        .join(", ")}`;
    case "proposal": {
      const candidate = Object.entries(event.candidate)
        .map(([dimension, value]) => `${dimension}=${String(value)}`)
        .join(", ");
      return `[advisor proposes · ${event.id}] { ${candidate} } — interpreting: "${event.interpreting}"`;
    }
    case "confirmation":
      return `[trainer decides] ${event.decision}`;
    case "profile": {
      const scope = Object.entries(event.scope)
        .map(([dimension, value]) => `${dimension}=${String(value)}`)
        .join(", ");
      return `[${event.source} profile] { ${scope} }`;
    }
    default:
      return undefined;
  }
}

function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case "fact":
      return `fact ${claim.entityId}.${claim.factId}`;
    case "treats":
      return `treats ${claim.itemId} vs ${claim.condition}`;
    case "comparison":
      return `comparison ${claim.leftId} vs ${claim.rightId} by ${claim.factId}`;
    case "count":
      return `count of ${claim.rosterId}`;
    case "typeCount":
      return "count of types";
    case "gameRule":
      return `game rule ${claim.ruleId}`;
    case "membership":
      return `membership ${claim.entityId} in ${claim.rosterId}`;
    case "ranking":
      return `ranking ${claim.rosterId} by ${claim.basis} (${claim.direction})`;
    case "matchup":
      return `matchup ${claim.subject.kind === "species" ? claim.subject.entityId : claim.subject.typeId} ${claim.direction}`;
    case "eligibility":
      return `eligibility ${claim.entityId}`;
    case "explanation":
      return `lesson ${claim.blockId}`;
    case "recommendation":
      return `recommendation ${claim.entityId}`;
    case "action":
      return `action ${claim.tool} ${claim.entityId}`;
  }
}

function describeRecord(record: Transaction): string[] {
  const outcome = record.outcome;
  const lines: string[] = [];
  if (outcome.status === "denied") {
    lines.push(`[record · ${record.id}] DENIED at ${outcome.stage}`);
    for (const item of outcome.violations) lines.push(`    ${describeViolation(item)}`);
  } else {
    lines.push(`[record · ${record.id}] ${outcome.status}`);
  }
  for (const claim of record.manifest?.claims ?? []) lines.push(`    claim: ${describeClaim(claim)}`);
  for (const suggestion of record.manifest?.suggestions ?? []) lines.push(`    suggests: ${suggestion}`);
  const scope = Object.entries(record.grant?.scope ?? {});
  if (scope.length > 0) {
    lines.push(`    scope: ${scope.map(([dimension, value]) => `${dimension}=${String(value)}`).join(", ")}`);
  }
  return lines;
}

function describePhase(state: SessionState): string {
  const phase = state.phase;
  switch (phase.kind) {
    case "gathering":
      return "gathering — waiting for the visitor's words";
    case "asking":
      return `asking about ${phase.dimension} — answer in your own words${phase.options.length === 0 ? "" : ` (one of: ${phase.options.join(", ")})`}`;
    case "clarifying":
      return `clarifying "${phase.clarification.about}" — say one of: ${phase.clarification.options.map((option) => option.label).join(", ")}`;
    case "confirming-scope":
      return "confirming-scope — /confirm or /reject the proposal above";
    case "confirming-act":
      return "confirming-act — /act to consent on the attested page, /decline to walk away";
  }
}

function summary(state: SessionState): string {
  const usage = state.usage;
  const floor = usage.costedCalls < usage.calls ? " (floor: not every call came priced)" : "";
  const asked = state.transcript.filter((event) => event.kind === "question").length;
  return (
    `— ${state.records.length} record(s), ${asked} question(s) asked, ` +
    `${state.notes.length} note(s), ${state.providerErrors} provider error(s), ` +
    `listing doors ${state.listingActivations.served}/${state.listingActivations.consulted} served` +
    (state.listingActivations.guardDropped > 0 ? ` (+${state.listingActivations.guardDropped} guard-dropped)` : "") +
    (state.listingDoor.withheld + state.listingDoor.nominated > 0 ? ` (listing door ${state.listingDoor.withheld} withheld/${state.listingDoor.nominated} nominated)` : "") +
    `, linking ${state.linking.mapped} mapped/${state.linking.unlinked} unlinked` +
    (state.linking.offTargetDropped > 0 ? ` (${state.linking.offTargetDropped} off-target dropped)` : "") +
    (state.linking.contradictions > 0 ? ` (${state.linking.contradictions} contradiction(s) asked)` : "") +
    (state.feedbackRetries > 0 ? `, ${state.feedbackRetries} feedback retr${state.feedbackRetries === 1 ? "y" : "ies"}` : "") +
    (state.clarification.asked > 0
      ? `, clarifications ${state.clarification.asked} asked/${state.clarification.picked} picked/${state.clarification.ignored} ignored/${state.clarification.capped} capped`
      : "") +
    (state.clarification.phrased + state.clarification.unphrased > 0
      ? `, scope questions ${state.clarification.phrased} phrased/${state.clarification.unphrased} pack-worded`
      : "") +
    (state.suggestions.offered > 0
      ? `, suggestions ${state.suggestions.offered} offered/${state.suggestions.kept} kept/${state.suggestions.dropped} dropped/${state.suggestions.taken} taken/${state.suggestions.deadEnded} dead-ended`
      : "") +
    ", " +
    `${usage.calls} model call(s), $${usage.costUsd.toFixed(4)}${floor}`
  );
}
