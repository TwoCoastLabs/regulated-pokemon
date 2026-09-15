/**
 * The step trail (issue #158): one exchange as the steps that made its
 * answer, in the order they were taken, each on the lane it ran on —
 * trainer, driver, kernel, model — so a visitor can see *how* the answer
 * that shipped is the one that shipped, and a dogfooder can read a miss
 * pre-diagnosed in the tab instead of in a hand-read trace file.
 *
 * Nothing here narrates. A trail is a projection of two records the system
 * already keeps: the driver's ledger (`session/ledger.ts` — every
 * deterministic step in fixed wording, per exchange) and the kernel's
 * `Transaction` (what it established, ruled and let commit). The model is
 * never asked to explain itself — a model-written "why I did the right
 * thing" is exactly what the thesis forbids on a governed surface.
 *
 * Two sources, one shape. When the driver filed a ledger (a live session, a
 * bank run), the trail *is* the ledger, with the record's named denials
 * attached to the step that filed it. When only a transaction exists (the
 * scenario corpus's runs, filed before the ledger was) the trail is
 * reconstructed from the record alone — transcript events, then each stage's
 * verdict — and says so, because a reconstructed trail cannot show the
 * driver's own moves (a claim dropped as off the ask, a nomination refused).
 *
 * The dev view's model calls attach to the trail by time: each call lands
 * under the first step recorded after it began. Both stamps come from the
 * session's one clock, so the placement is read, never guessed.
 */

import type { ScopeTranscript, Claim } from "../kernel/contracts.js";
import type { Transaction } from "../kernel/transaction.js";
import type { HarnessRun } from "../harness/run.js";
import type { ModelCallTrace } from "../session/devtrace.js";
import { type ExchangeLedger, type ExchangeOutcome, type Ledgered, ledgerOf, type StepLane } from "../session/ledger.js";
import { type ClaimSource, type ManifestView, manifestView } from "./claims.js";
import { describeClaim, violationView, type ViolationView } from "./viewmodel.js";

/** How the chrome colours a step: what it means, not who took it. */
export type StepTone = "plain" | "ok" | "refused" | "open";

export interface TrailStep {
  at: string;
  lane: StepLane;
  /** The ledger's fixed wording, `<subject>/<what-happened>`. */
  code: string;
  text: string;
  count?: number;
  tone: StepTone;
  /** Further lines the step carries — the claims a draft proposed, say. */
  lines: readonly string[];
  /** The named denials behind a refused step, when the record details them. */
  violations: readonly ViolationView[];
  /** Model calls that began after the previous step and before this one. */
  calls: readonly ModelCallTrace[];
  /** On the step that certified an answer: each claim's scale and what it
   * was formed from, and every roster the record carries (`ui/claims.ts`). */
  manifest?: ManifestView;
}

export interface Trail {
  /** The trainer's opening words. */
  opening: string;
  outcome: ExchangeOutcome;
  /** `ledger` when the driver recorded the steps; `record` when they were
   * reconstructed from the transaction alone. */
  source: "ledger" | "record";
  transactionId?: string;
  steps: readonly TrailStep[];
}

/** The lane, as the console names it. */
export function laneLabel(lane: StepLane): string {
  switch (lane) {
    case "trainer":
      return "trainer";
    case "driver":
      return "driver";
    case "kernel":
      return "kernel";
    case "model":
      return "model";
  }
}

const OK_CODES: ReadonlySet<string> = new Set([
  "scope/granted",
  "verdict/allowed",
  "record/answered",
  "record/acted",
  "route/served",
  "memory/followed",
  "clarify/picked",
  "trainer/card-confirmed",
  "trainer/consent-confirmed",
  "act/executed",
]);

const OPEN_CODES: ReadonlySet<string> = new Set([
  "scope/asked",
  "scope/card",
  "clarify/asked",
  "act/consent-requested",
  "record/declined",
  "record/clarifying",
  "trainer/card-rejected",
  "trainer/consent-declined",
  "note/abstention",
  "note/social",
]);

/** The tone a code carries. Refusals are read by suffix so a new denial
 * code the ledger grows is coloured right before anyone lists it here. */
export function toneOf(code: string): StepTone {
  if (code.endsWith("/denied") || code.endsWith("/refused") || code.endsWith("/refused-back") || code.endsWith("/withdrawn") || code.endsWith("failed") || code === "note/error") return "refused";
  if (OK_CODES.has(code)) return "ok";
  if (OPEN_CODES.has(code)) return "open";
  return "plain";
}

function denialCode(violation: { article: string; rule: string }): string {
  return `${violation.article}/${violation.rule}`;
}

/**
 * A ledger as a trail. The record, when the exchange filed one, lends its
 * named denials to the step that filed it (`record/denied`) and to the scope
 * refusal — the ledger's own text names the codes; the record carries the
 * message and the expected/actual pair a reader wants beside them.
 */
export function trailFromLedger(ledger: ExchangeLedger, records: readonly Transaction[], source?: ClaimSource): Trail {
  const record = ledger.transactionId === undefined ? undefined : records.find((entry) => entry.id === ledger.transactionId);
  // The certified manifest opens under the filing step: the one step that
  // says "N claim(s) certified" is the one that shows how each was formed.
  const certified = record?.manifest === undefined ? undefined : manifestView(record.manifest, source);
  const steps: TrailStep[] = ledger.steps.map((step) => {
    const violations =
      record !== undefined && record.outcome.status === "denied" && (step.code === "record/denied" || step.code === "scope/refused")
        ? record.outcome.violations.map(violationView)
        : [];
    const filing = step.code === `record/${record?.outcome.status ?? ""}` && step.code !== "record/denied";
    return {
      at: step.at,
      lane: step.lane,
      code: step.code,
      text: step.text,
      ...(step.count === undefined ? {} : { count: step.count }),
      tone: toneOf(step.code),
      // The refuser's own words, when the step carries them — the kernel's
      // messages behind a denial, the driver's reasons behind a carry-back.
      lines: step.lines ?? [],
      violations,
      calls: [],
      ...(filing && certified !== undefined ? { manifest: certified } : {}),
    };
  });
  return {
    // An exchange the trainer opened without words (a profile set, then
    // nothing asked) names itself by its first move on the trainer's lane.
    opening: ledger.opening || steps.find((step) => step.lane === "trainer")?.text || "",
    outcome: ledger.outcome,
    source: "ledger",
    ...(ledger.transactionId === undefined ? {} : { transactionId: ledger.transactionId }),
    steps,
  };
}

/** The transcript's events as trail steps — the conversation the record
 * rests on, worded the way the ledger words the same moves. */
function transcriptSteps(transcript: ScopeTranscript): TrailStep[] {
  const plain = (at: string, lane: StepLane, code: string, text: string): TrailStep => ({
    at,
    lane,
    code,
    text,
    tone: toneOf(code),
    lines: [],
    violations: [],
    calls: [],
  });
  return transcript.map((event): TrailStep => {
    switch (event.kind) {
      case "utterance":
        return event.source === "trainer"
          ? plain(event.at, "trainer", "trainer/said", event.text)
          : plain(event.at, "trainer", `channel/${event.source}`, `on the ${event.source} channel (binds nothing): ${event.text}`);
      case "question":
        return plain(event.at, "driver", "scope/asked", `the pack's question about ${event.dimension} was armed: “${event.text}”`);
      case "clarification":
        return plain(
          event.at,
          "model",
          "clarify/asked",
          `the model asked about "${event.about}": “${event.text}” — options: ${event.options.map((option) => option.label).join(", ")}`,
        );
      case "proposal":
        return plain(
          event.at,
          "model",
          "scope/card",
          `the model proposed an interpretation card: ${Object.entries(event.candidate)
            .map(([dimension, value]) => `${dimension}=${String(value)}`)
            .join(", ")}`,
        );
      case "confirmation":
        return event.source === "trainer"
          ? plain(event.at, "trainer", `trainer/card-${event.decision}ed`, `the interpretation card was ${event.decision}ed`)
          : plain(event.at, "trainer", `channel/${event.source}`, `a ${event.decision} arrived on the ${event.source} channel (binds nothing)`);
      case "profile":
        return plain(
          event.at,
          "trainer",
          "trainer/profile",
          `profile set: ${Object.entries(event.scope)
            .map(([dimension, value]) => `${dimension}=${String(value)}`)
            .join(", ")}`,
        );
    }
  });
}

/**
 * A trail reconstructed from the record alone: the transcript, then the
 * draft the model submitted, then every stage's verdict in order, then the
 * filing. Timestamps are the record's moments (`establishedAt` for scope and
 * the draft, `renderedAt` / `authorizedAt` for the act path, `committedAt`
 * for the filing) — the record keeps no finer clock, and the trail does not
 * invent one.
 */
export function trailFromRecord(transaction: Transaction, proposedClaims?: readonly Claim[], source?: ClaimSource): Trail {
  const steps: TrailStep[] = transcriptSteps(transaction.transcript);
  const add = (at: string, lane: StepLane, code: string, text: string, extra: Partial<Pick<TrailStep, "lines" | "violations" | "count" | "manifest">> = {}): void => {
    steps.push({ at, lane, code, text, tone: toneOf(code), lines: [], violations: [], calls: [], ...extra });
  };
  const draft = transaction.manifest?.claims ?? transaction.refused?.claims ?? proposedClaims;
  const certified = transaction.manifest === undefined ? undefined : manifestView(transaction.manifest, source);
  // The trainer's consent sits between the page and the act — before the
  // action stage when one ruled, else after the last stage that did.
  let consented = false;
  const consent = (): void => {
    const confirmation = transaction.confirmation;
    if (confirmation === undefined || consented) return;
    consented = true;
    add(
      confirmation.confirmedAt,
      "trainer",
      confirmation.source === "trainer" ? "trainer/consent-confirmed" : `channel/${confirmation.source}`,
      confirmation.source === "trainer"
        ? `consent given on the attested page (digest ${confirmation.artifactDigest})`
        : `a confirmation arrived on the ${confirmation.source} channel (binds nothing)`,
    );
  };

  for (const entry of transaction.verdicts) {
    const violations = entry.verdict.violations.map(violationView);
    const codes = entry.verdict.violations.map(denialCode).join(", ");
    switch (entry.stage) {
      case "scope":
        if (entry.verdict.allowed) {
          const pins = Object.entries(transaction.grant?.scope ?? {})
            .map(([dimension, value]) => `${dimension}=${String(value)}`)
            .join(", ");
          add(transaction.establishedAt, "kernel", "scope/granted", `scope granted: ${pins || "from the defaults"}`);
        } else {
          add(transaction.establishedAt, "kernel", "scope/refused", `scope refused: ${codes}`, { violations });
        }
        break;
      case "answer":
        if (draft !== undefined) {
          add(transaction.establishedAt, "model", "model/answer", `${draft.length} claim(s)`, { lines: draft.map(describeClaim), count: draft.length });
        }
        add(
          transaction.committedAt,
          "kernel",
          entry.verdict.allowed ? "verdict/allowed" : "verdict/denied",
          entry.verdict.allowed
            ? `the answer stage allowed the draft: ${transaction.manifest?.claims.length ?? 0} claim(s) certified`
            : `the answer stage denied the draft: ${codes}`,
          { violations, ...(entry.verdict.allowed && certified !== undefined ? { manifest: certified } : {}) },
        );
        break;
      case "render":
        add(
          transaction.renderedAt ?? transaction.committedAt,
          "kernel",
          entry.verdict.allowed ? "verdict/allowed" : "verdict/denied",
          entry.verdict.allowed
            ? `the render stage attested the page${transaction.affidavit === undefined ? "" : ` (digest ${transaction.affidavit.artifactDigest})`}`
            : `the render stage refused the page: ${codes}`,
          { violations },
        );
        break;
      case "action": {
        consent();
        const grants = transaction.actionGrants ?? [];
        add(
          transaction.authorizedAt ?? transaction.committedAt,
          "kernel",
          entry.verdict.allowed ? "act/executed" : "verdict/denied",
          entry.verdict.allowed ? `${grants.length} grant(s) executed behind the trainer's confirmation` : `the action stage refused: ${codes}`,
          { violations, lines: grants.map((grant) => `${grant.tool}(${grant.entityId}) · cites ${grant.confirmationEventId}`) },
        );
        break;
      }
    }
  }

  consent();
  const outcome = transaction.outcome;
  // The filing is the record's last moment: the commit, or the act path's
  // latest stamp when the exchange walked past the commit into one.
  const filedAt = [transaction.committedAt, transaction.renderedAt, transaction.confirmation?.confirmedAt, transaction.authorizedAt, transaction.executedAt]
    .filter((moment): moment is string => moment !== undefined)
    .sort()
    .at(-1)!;
  if (outcome.status === "declined" && transaction.confirmation === undefined) {
    add(filedAt, "trainer", "trainer/consent-declined", "consent declined");
  }
  add(
    filedAt,
    "kernel",
    `record/${outcome.status}`,
    outcome.status === "denied"
      ? `denied: ${outcome.violations.map(denialCode).join(", ")}`
      : outcome.status === "clarifying"
        ? `clarifying: asking about ${outcome.asking}`
        : `${outcome.status}: ${transaction.manifest?.claims.length ?? 0} claim(s) certified`,
    { violations: outcome.status === "denied" ? outcome.violations.map(violationView) : [] },
  );

  const opening = transaction.transcript.find((event) => event.kind === "utterance" && event.source === "trainer");
  return {
    opening: opening?.kind === "utterance" ? opening.text : (steps.find((step) => step.lane === "trainer")?.text ?? ""),
    outcome: outcome.status,
    source: "record",
    transactionId: transaction.id,
    steps,
  };
}

/**
 * A filed run's trails: the driver's ledger when the run carries one, else
 * one trail reconstructed from its transaction, else — a run that never
 * reached the seam — its transcript and the one line on why it stopped.
 */
export function trailsOfRun(run: HarnessRun, source?: ClaimSource): readonly Trail[] {
  if (run.exchanges !== undefined && run.exchanges.length > 0) {
    const records = run.transaction === undefined ? [] : [run.transaction];
    return run.exchanges.map((ledger) => trailFromLedger(ledger, records, source));
  }
  if (run.transaction !== undefined) return [trailFromRecord(run.transaction, run.proposedClaims, source)];
  const steps = transcriptSteps(run.transcript);
  const last = steps[steps.length - 1];
  steps.push({ at: last?.at ?? "", lane: "driver", code: "note/abstention", text: run.detail, tone: "open", lines: [], violations: [], calls: [] });
  const opening = run.transcript.find((event) => event.kind === "utterance" && event.source === "trainer");
  return [{ opening: opening?.kind === "utterance" ? opening.text : "", outcome: "open", source: "record", steps }];
}

/** A live session's trails: every closed exchange and the open one. */
export function trailsOfSession(state: Ledgered & { records: readonly Transaction[] }, source?: ClaimSource): readonly Trail[] {
  return ledgerOf(state, "").map((ledger) => trailFromLedger(ledger, state.records, source));
}

/** The steps on which a reply was sent back for another: the kernel's
 * denial carried back, the driver's refusals carried back, a nomination
 * refused with the door then shut. Every one of these cost one more model
 * call, and the reply that shipped is the one that came after. */
const SENT_BACK_CODES: ReadonlySet<string> = new Set(["verdict/denied", "reply/carried-back", "linking/carried-back", "route/withdrawn", "route/refused-back", "route/refused"]);

/** What the model learned from a refusal: the reasons went into its next
 * prompt (`fed-back`), a door was removed for one call and nothing said
 * (`withdrawn`), or nothing was re-asked at all — the rest of the reply
 * stood on its own (`stood`). */
export type SentBackMode = "fed-back" | "withdrawn" | "stood";

/** One round the exchange sent back: who refused, in what words, and
 * whether the model was told. */
export interface SentBack {
  /** `kernel` for a verdict the kernel gave; `driver` for the driver's own guards. */
  by: "kernel" | "driver";
  code: string;
  text: string;
  mode: SentBackMode;
  /** The refuser's reasons, `<code>: <message>` where the step carries them. */
  reasons: readonly string[];
}

function modeOf(code: string): SentBackMode {
  return code === "route/withdrawn" ? "withdrawn" : code === "route/refused" ? "stood" : "fed-back";
}

/**
 * The rounds an exchange sent back before the reply that shipped — read from
 * the ledger, so the chat can say "the first draft was refused, this is the
 * second" in the player's register without narrating anything: a step is a
 * sent-back round only if the driver recorded one, and the reasons are the
 * refuser's own lines. A `route/refused` that ended the exchange on a pass
 * (no retry followed) is still a refusal the trainer should see.
 */
export function sentBack(ledger: ExchangeLedger): readonly SentBack[] {
  return ledger.steps.flatMap((step) =>
    SENT_BACK_CODES.has(step.code)
      ? [{ by: step.lane === "kernel" ? ("kernel" as const) : ("driver" as const), code: step.code, text: step.text, mode: modeOf(step.code), reasons: step.lines ?? [] }]
      : [],
  );
}

/**
 * Attach the dev view's model calls to the trails by time: each call lands
 * under the first step recorded at or after the moment the call began.
 * Calls that began after the last recorded step (one in flight, one that
 * failed before any step could be written) come back as `unplaced`, so the
 * view still shows them — a call the trail cannot place is still a call.
 */
export function withCalls(trails: readonly Trail[], calls: readonly ModelCallTrace[]): { trails: readonly Trail[]; unplaced: readonly ModelCallTrace[] } {
  const ordered = [...calls].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let next = 0;
  const placed = trails.map((trail) => ({
    ...trail,
    steps: trail.steps.map((step) => {
      const mine: ModelCallTrace[] = [];
      while (next < ordered.length && ordered[next]!.at <= step.at) mine.push(ordered[next++]!);
      return mine.length === 0 ? step : { ...step, calls: mine };
    }),
  }));
  return { trails: placed, unplaced: ordered.slice(next) };
}
