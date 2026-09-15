/**
 * The driver's ledger: every deterministic step the driver takes in one
 * exchange, in the order it took it, in fixed wording (issue #158, the step
 * trail; docs/routing.md R4, the ceremony audit's instrument).
 *
 * The kernel's record (`Transaction`) carries what the kernel established,
 * ruled and let commit, and replays. Beside it the driver takes steps the
 * record cannot see — a claim dropped as off the ask, a nomination refused,
 * a contradiction carried back, a union taken, a pick bound — and until now
 * they lived as session-wide counters no exchange could be charged with.
 * This module records them per exchange, on the driver's side, never inside
 * the kernel's record: replay re-derives the kernel's verdicts, and the
 * ledger is what the driver did around them.
 *
 * Every step has a *lane* (whose move it was), a *code* (fixed, countable —
 * the S1 discipline the notes' `detail` register already keeps) and one
 * line of text. An exchange's ledger closes when the exchange files a record
 * or when the next ask opens; a trail reads the closed ones and the open one
 * alike. No domain word here; the codes name mechanism, never a species.
 */

export type StepLane = "trainer" | "driver" | "kernel" | "model";

/** How a step reads: what it means, not who took it. */
export type StepTone = "plain" | "ok" | "refused" | "open";

/** What the model learned from a round the exchange sent back: the reasons
 * went into its next prompt (`fed-back`), a door was removed for one call and
 * nothing said (`withdrawn`), or nothing was re-asked at all — the rest of
 * the reply stood on its own (`stood`). */
export type SentBackMode = "fed-back" | "withdrawn" | "stood";

/**
 * The closed registry of step codes: every code the driver can write, with
 * how it reads and — for the rounds that sent a reply back — whether the
 * model was told. The registry is the contract: `DriverStep.code` is its
 * key type, so a step with an unregistered code does not compile, and the
 * trail reads tone and mode from here rather than from the code's spelling.
 * A code read from an older filed artifact that is not here reads plain;
 * nothing infers a meaning from a suffix.
 */
export const LEDGER_CODES = {
  // the trainer's moves
  "trainer/said": { tone: "plain" },
  "trainer/took-suggestion": { tone: "plain" },
  "trainer/profile": { tone: "plain" },
  "trainer/card-confirmed": { tone: "ok" },
  "trainer/card-rejected": { tone: "open" },
  "trainer/consent-confirmed": { tone: "ok" },
  "trainer/consent-declined": { tone: "open" },
  // scope
  "scope/granted": { tone: "ok" },
  "scope/asked": { tone: "open" },
  "scope/card": { tone: "open" },
  "scope/refused": { tone: "refused" },
  // the model's replies
  "model/discovery": { tone: "plain" },
  "model/answer": { tone: "plain" },
  "model/nominated": { tone: "plain" },
  "model/retry": { tone: "plain" },
  "model/retry-failed": { tone: "refused" },
  // the doors
  "route/served": { tone: "ok" },
  "route/refused": { tone: "refused", sentBack: "stood" },
  "route/withdrawn": { tone: "refused", sentBack: "withdrawn" },
  "route/refused-back": { tone: "refused", sentBack: "fed-back" },
  "route/withheld": { tone: "plain" },
  "clarify/asked": { tone: "open" },
  "clarify/picked": { tone: "ok" },
  "memory/held": { tone: "plain" },
  "memory/empty": { tone: "plain" },
  "memory/held-out": { tone: "plain" },
  "memory/followed": { tone: "ok" },
  "memory/departed": { tone: "plain" },
  // the driver's reading of a reply
  "linking/unlinked": { tone: "plain" },
  "linking/union": { tone: "plain" },
  "linking/held-to-pick": { tone: "plain" },
  "linking/contradiction": { tone: "plain" },
  "linking/off-ask-dropped": { tone: "plain" },
  "linking/stale-dropped": { tone: "plain" },
  "linking/carried-back": { tone: "plain", sentBack: "fed-back" },
  "reply/carried-back": { tone: "plain", sentBack: "fed-back" },
  "guard/direction-flipped": { tone: "plain" },
  "guard/eligibility-appended": { tone: "plain" },
  "guard/padding-trimmed": { tone: "plain" },
  "guard/wrong-set-dropped": { tone: "plain" },
  "boundary/taught": { tone: "plain" },
  "repair/strip-assertion": { tone: "plain" },
  // the kernel's verdicts and the filing
  "verdict/allowed": { tone: "ok" },
  "verdict/denied": { tone: "refused", sentBack: "fed-back" },
  "record/answered": { tone: "ok" },
  "record/acted": { tone: "ok" },
  "record/denied": { tone: "refused" },
  "record/declined": { tone: "open" },
  "record/clarifying": { tone: "open" },
  // acts
  "act/consent-requested": { tone: "open" },
  "act/executed": { tone: "ok" },
  // notes
  "note/abstention": { tone: "open" },
  "note/social": { tone: "open" },
  "note/error": { tone: "refused" },
} as const satisfies Record<string, { tone: StepTone; sentBack?: SentBackMode }>;

export type LedgerCode = keyof typeof LEDGER_CODES;

/** How a code reads. A code outside the registry — one read from an older
 * filed artifact, or a channel step reconstructed from a record — is plain. */
export function toneOf(code: string): StepTone {
  return (LEDGER_CODES as Record<string, { tone: StepTone }>)[code]?.tone ?? "plain";
}

/** Whether a code is a round that sent a reply back, and what the model
 * learned from it; undefined for every other code. */
export function sentBackModeOf(code: string): SentBackMode | undefined {
  return (LEDGER_CODES as Record<string, { sentBack?: SentBackMode }>)[code]?.sentBack;
}

export interface DriverStep {
  at: string;
  lane: StepLane;
  /** Fixed wording, `<subject>/<what-happened>` — one of {@link LEDGER_CODES}. */
  code: LedgerCode;
  text: string;
  /** A count the step carries, when it is one (claims dropped, links stale). */
  count?: number;
  /** Further lines in the refuser's own words — the kernel's denial messages
   * behind a `verdict/denied`, the driver's reasons behind a carry-back — so
   * a reader sees *why* without opening the record or the trace. */
  lines?: readonly string[];
}

export type ExchangeOutcome = "answered" | "acted" | "denied" | "declined" | "clarifying" | "passed" | "open";

/** One exchange's steps, closed. `transactionId` when a record was filed. */
export interface ExchangeLedger {
  /** The trainer's opening words, as said. */
  opening: string;
  steps: readonly DriverStep[];
  outcome: ExchangeOutcome;
  transactionId?: string;
}

/** The slice of session state the ledger owns. */
export interface Ledgered {
  /** The open exchange's steps so far. */
  steps: readonly DriverStep[];
  /** Closed exchanges, in order. */
  exchanges: readonly ExchangeLedger[];
}

/** Append one step to the open exchange. */
export function step<S extends Ledgered>(state: S, at: string, lane: StepLane, code: LedgerCode, text: string, count?: number, lines?: readonly string[]): S {
  const entry: DriverStep = { at, lane, code, text, ...(count === undefined ? {} : { count }), ...(lines === undefined || lines.length === 0 ? {} : { lines }) };
  return { ...state, steps: [...state.steps, entry] };
}

/**
 * Close the open exchange into the closed list. An exchange with no steps is
 * nothing to close. `opening` is the trainer's first utterance of the
 * exchange, read by the caller from the transcript.
 */
export function closeLedger<S extends Ledgered>(state: S, opening: string, outcome: ExchangeOutcome, transactionId?: string): S {
  if (state.steps.length === 0) return state;
  const closed: ExchangeLedger = { opening: openingFrom(state.steps, opening), steps: state.steps, outcome, ...(transactionId === undefined ? {} : { transactionId }) };
  return { ...state, steps: [], exchanges: [...state.exchanges, closed] };
}

/** The caller's opening when it has one; else the first thing the trainer
 * said on this ledger — an exchange closed after its ask pointer moved on
 * (an abstention closed at the next ask) still names itself. */
function openingFrom(steps: readonly DriverStep[], opening: string): string {
  if (opening.length > 0) return opening;
  return steps.find((entry) => entry.code === "trainer/said" || entry.code === "trainer/took-suggestion")?.text ?? "";
}

/** Every step so far, closed exchanges first, then the open one — for a
 * reader that wants the whole session as one sequence. */
export function allSteps(state: Ledgered): readonly DriverStep[] {
  return [...state.exchanges.flatMap((exchange) => exchange.steps), ...state.steps];
}

/** The ledger a harness files: the closed exchanges plus the open one as
 * `open`, so an abstention with no record still has its trail. */
export function ledgerOf(state: Ledgered, opening: string): readonly ExchangeLedger[] {
  return state.steps.length === 0 ? state.exchanges : [...state.exchanges, { opening: openingFrom(state.steps, opening), steps: state.steps, outcome: "open" }];
}
