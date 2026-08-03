/**
 * The demo, as a pure function of its arguments.
 *
 * Everything the CLI does lives here so that what a person reads in a terminal
 * is exactly what a test can assert on. `cli.ts` prints these lines and exits
 * with this code; it holds no logic of its own.
 *
 * The demo is self-checking. Each scripted conversation declares how it must
 * end and each sabotage declares the denial it must be refused under, so
 * `npm run demo` fails loudly rather than printing a plausible-looking trace
 * nobody reads closely. That is the same discipline as the crucible's two
 * controls: a run that always looks fine is not evidence of anything.
 */

import { ALL_MUTATIONS } from "../crucible/phases.js";
import { expectedDenial, type Mutation } from "../crucible/harness.js";
import type { ManifestContext } from "../kernel/manifest.js";
import { runTransaction, type Transaction } from "../kernel/transaction.js";
import { denialCode } from "../kernel/violation.js";
import {
  COMMITTED_AT,
  CONVERSATIONS,
  type Conversation,
  conversation,
  demoPlan,
  demoWorld,
  ESTABLISHED_AT,
  REQUIRED,
} from "./script.js";
import { describeDenials, describeTransaction } from "./trace.js";

export interface DemoResult {
  lines: readonly string[];
  /** 0 when everything happened the way it had to. */
  exitCode: number;
}

const RULE = "─".repeat(72);

export function play(entry: Conversation): Transaction {
  const { registry, pack } = demoWorld();
  return runTransaction({
    id: `txn-demo-${entry.id}`,
    registry,
    pack,
    transcript: entry.transcript,
    establishedAt: ESTABLISHED_AT,
    committedAt: COMMITTED_AT,
    required: REQUIRED,
    plan: demoPlan,
  });
}

export function playAndCheck(entry: Conversation): DemoResult {
  const transaction = play(entry);
  const lines = [
    RULE,
    `${entry.id} — ${entry.title}`,
    entry.shows,
    RULE,
    "",
    ...describeTransaction(transaction),
  ];

  if (transaction.outcome.status !== entry.expects) {
    lines.push(
      "",
      `DEMO FAILED: "${entry.id}" must end ${entry.expects} and ended ${transaction.outcome.status}.`,
    );
    return { lines, exitCode: 1 };
  }
  return { lines, exitCode: 0 };
}

// --- sabotage ---------------------------------------------------------------

/**
 * The world a mutation is let loose in: the certified registry, the Accord
 * pack, and the scope *this conversation actually established* through the
 * ladder — not a fixture grant typed out beside it.
 */
export function sabotageWorld(): ManifestContext {
  const clean = CONVERSATIONS[0];
  if (clean === undefined) throw new Error("the demo has no conversations");
  const transaction = play(clean);
  if (transaction.grant === undefined) {
    throw new Error(`the demo's clean conversation established no scope (${transaction.outcome.status})`);
  }
  const { registry, pack } = demoWorld();
  return { registry, pack, grant: transaction.grant, at: COMMITTED_AT };
}

/**
 * Run one crucible mutation and show what the kernel said.
 *
 * This is the mutation CI runs — the same value out of `ALL_MUTATIONS`, run
 * through its own harness — rather than a re-enactment of it. What the demo
 * supplies is the world: each mutation brings its own sabotage and applies it
 * to the registry, the answer, or the grant itself, so the trace below is the
 * kernel's real verdict on this trainer's scope, not a scripted denial.
 */
export function playSabotage(mutation: Mutation): DemoResult {
  const verdict = mutation.run(sabotageWorld());
  const lines = [
    RULE,
    `sabotage: ${mutation.id} — ${mutation.title}`,
    mutation.description,
    `must be refused under ${expectedDenial(mutation)}`,
    RULE,
    "",
  ];

  if (verdict.allowed) {
    lines.push(`ALLOWED — and it must not have been.`, "", `DEMO FAILED: ${mutation.id} was not denied.`);
    return { lines, exitCode: 1 };
  }

  lines.push(...describeDenials(verdict.violations));

  // A sabotage refused for a different reason is a finding, not a pass. The
  // crucible asserts this in CI; the demo says it out loud so a visitor can
  // see that the denial they were promised is the denial they got.
  const codes = verdict.violations.map(denialCode);
  if (!codes.includes(expectedDenial(mutation))) {
    lines.push(
      "",
      `DEMO FAILED: ${mutation.id} declared ${expectedDenial(mutation)} and was refused under ${codes.join(", ")}.`,
    );
    return { lines, exitCode: 1 };
  }
  return { lines, exitCode: 0 };
}

// --- the front door ---------------------------------------------------------

const USAGE = [
  "Usage: npm run demo [-- <option>]",
  "",
  "  (no option)            play every scripted conversation",
  "  --conversation <id>    play one of them",
  "  --sabotage <id>        play the clean conversation, then let one crucible",
  "                         mutation loose in the world it established",
  "  --list                 list the conversations and the sabotages",
];

function catalogue(): string[] {
  return [
    "conversations",
    ...CONVERSATIONS.map((entry) => `  ${entry.id.padEnd(12)} ${entry.title}`),
    "",
    `sabotages (${ALL_MUTATIONS.length}, every one of them a test CI runs)`,
    ...ALL_MUTATIONS.map(
      (mutation) => `  ${mutation.id.padEnd(28)} ${expectedDenial(mutation).padEnd(30)} ${mutation.title}`,
    ),
  ];
}

function valueOf(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  return argv[at + 1];
}

function missing(name: string, known: readonly string[]): DemoResult {
  return { lines: [`unknown ${name}. Known ids:`, ...known.map((id) => `  ${id}`)], exitCode: 1 };
}

export function runDemo(argv: readonly string[]): DemoResult {
  if (argv.includes("--help") || argv.includes("-h")) return { lines: USAGE, exitCode: 0 };
  if (argv.includes("--list")) return { lines: catalogue(), exitCode: 0 };

  const sabotage = valueOf(argv, "--sabotage");
  if (sabotage !== undefined) {
    const mutation = ALL_MUTATIONS.find((entry) => entry.id === sabotage);
    if (mutation === undefined) return missing("sabotage", ALL_MUTATIONS.map((entry) => entry.id));
    return playSabotage(mutation);
  }

  const wanted = valueOf(argv, "--conversation");
  if (wanted !== undefined) {
    const entry = conversation(wanted);
    if (entry === undefined) return missing("conversation", CONVERSATIONS.map((one) => one.id));
    return playAndCheck(entry);
  }

  const played = CONVERSATIONS.map(playAndCheck);
  return {
    lines: played.flatMap((result, index) => (index === 0 ? result.lines : ["", ...result.lines])),
    // Any conversation ending the wrong way fails the whole run: a demo that
    // reported the last outcome would hide the first two.
    exitCode: played.some((result) => result.exitCode !== 0) ? 1 : 0,
  };
}
