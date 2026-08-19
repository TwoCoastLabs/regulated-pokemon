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

import type { ScopeEvent } from "../kernel/contracts.js";
import type { Claim } from "../kernel/contracts.js";
import type { Transaction } from "../kernel/transaction.js";
import { describeViolation } from "../kernel/violation.js";
import {
  decideAct,
  decideScope,
  retry,
  say,
  type SessionDeps,
  type SessionState,
  startSession,
} from "./session.js";

/** The inputs a trace understands: visitor words, or one of these commands
 * standing in for the page's buttons. */
export const TRACE_COMMANDS = ["/confirm", "/reject", "/act", "/decline", "/retry"] as const;

/** What argv asks for, parsed here so the entry point stays straight-line. */
export interface TraceArgs {
  inputs: readonly string[];
  /** An explicit --model slug, when one was given. */
  model?: string;
  weak: boolean;
  adversarial: boolean;
}

export function parseTraceArgs(argv: readonly string[]): TraceArgs {
  const modelFlag = argv.indexOf("--model");
  const model = modelFlag >= 0 ? argv[modelFlag + 1] : undefined;
  return {
    inputs: argv.filter((arg, index) => !arg.startsWith("--") && !(modelFlag >= 0 && index === modelFlag + 1)),
    ...(model === undefined ? {} : { model }),
    weak: argv.includes("--weak"),
    adversarial: argv.includes("--adversarial"),
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
  }
  for (const record of after.records.slice(before.records.length)) {
    lines.push(...describeRecord(record).map((line) => `  ${line}`));
  }

  const calls = after.usage.calls - before.usage.calls;
  const cost = after.usage.costUsd - before.usage.costUsd;
  if (calls > 0) lines.push(`  [model] ${calls} call${calls === 1 ? "" : "s"}, $${cost.toFixed(4)}`);

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
    case "proposal": {
      const candidate = Object.entries(event.candidate)
        .map(([dimension, value]) => `${dimension}=${String(value)}`)
        .join(", ");
      return `[advisor proposes · ${event.id}] { ${candidate} } — interpreting: "${event.interpreting}"`;
    }
    case "confirmation":
      return `[trainer decides] ${event.decision}`;
    default:
      return undefined;
  }
}

function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case "fact":
      return `fact ${claim.entityId}.${claim.factId}`;
    case "count":
      return `count of ${claim.rosterId}`;
    case "typeCount":
      return "count of types";
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
      return `asking about ${phase.dimension} — answer in your own words`;
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
    `${usage.calls} model call(s), $${usage.costUsd.toFixed(4)}${floor}`
  );
}
