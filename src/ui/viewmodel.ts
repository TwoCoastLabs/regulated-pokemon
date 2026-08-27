/**
 * What the compliance console shows, computed from the filed record alone.
 *
 * The UI is a *reader* of run artifacts — the same files `npm run
 * harness:results` renders, played as pages instead of Markdown. Everything
 * here is a pure projection of the record: no clock, no network, no state.
 * That is what keeps the phase-8 theater honest — a number on screen is
 * always traceable to the artifact that produced it, never recomputed from
 * something fresher, and the whole app works offline from a published file.
 *
 * Fail closed at the door: `readArtifact` refuses a file that does not have a
 * filed artifact's shape, naming what is missing. Past the door the record is
 * taken as filed — verifying it is `replayTransaction`'s job (IA-10), and a
 * viewer that quietly re-judged the record would be a second kernel.
 */

import { article } from "../kernel/accord.js";
import type {
  Claim,
  FactValue,
  ScopeTranscript,
  TrainerScope,
  Violation,
} from "../kernel/contracts.js";
import type { TransactionStage } from "../kernel/transaction.js";
import type { ArtifactModel, HarnessArtifact } from "../harness/artifact.js";
import type { HarnessRun } from "../harness/run.js";

/** Checked against the artifact type rather than imported: `artifact.ts`
 * writes files, so a runtime import would drag `node:fs` into the browser. */
const KNOWN_SCHEMA_VERSION = 1 satisfies HarnessArtifact["schemaVersion"];

const RUN_STATUSES: ReadonlySet<string> = new Set(["answered", "acted", "denied", "unresolved"]);

/**
 * Admit a parsed JSON value as a filed run artifact, or refuse by name.
 *
 * The check is structural and shallow on purpose: it proves this is a filed
 * artifact of a schema this reader speaks, and that every run has the fields
 * navigation rests on. It does not re-validate the kernel records inside —
 * the record is the authority here, and replay is where it is disbelieved.
 */
export function readArtifact(value: unknown): HarnessArtifact {
  const refuse = (why: string): never => {
    throw new Error(`not a filed run artifact: ${why}`);
  };

  if (typeof value !== "object" || value === null) refuse("not an object");
  const record = value as Record<string, unknown>;

  if (record["schemaVersion"] !== KNOWN_SCHEMA_VERSION) {
    refuse(`schemaVersion is ${JSON.stringify(record["schemaVersion"])}; this reader knows ${KNOWN_SCHEMA_VERSION}`);
  }
  for (const field of ["label", "startedAt"] as const) {
    if (typeof record[field] !== "string") refuse(`"${field}" is not a string`);
  }
  const world = record["world"];
  if (typeof world !== "object" || world === null) refuse('"world" is missing');
  for (const field of ["snapshotId", "snapshotDigest", "sourceCommit", "packId"] as const) {
    if (typeof (world as Record<string, unknown>)[field] !== "string") refuse(`"world.${field}" is not a string`);
  }
  for (const field of ["scenarios", "models", "runs"] as const) {
    if (!Array.isArray(record[field])) refuse(`"${field}" is not an array`);
  }
  for (const run of record["runs"] as unknown[]) {
    if (typeof run !== "object" || run === null) refuse("a run is not an object");
    const entry = run as Record<string, unknown>;
    if (typeof entry["scenarioId"] !== "string") refuse('a run has no "scenarioId"');
    if (typeof entry["providerId"] !== "string") refuse('a run has no "providerId"');
    if (typeof entry["detail"] !== "string") refuse('a run has no "detail"');
    if (typeof entry["repetition"] !== "number") refuse('a run has no "repetition"');
    if (!RUN_STATUSES.has(entry["status"] as string)) {
      refuse(`a run's status is ${JSON.stringify(entry["status"])}`);
    }
    if (!Array.isArray(entry["transcript"])) refuse('a run has no "transcript"');
  }
  if (typeof record["metrics"] !== "object" || record["metrics"] === null) refuse('"metrics" is missing');
  const verdict = record["verdict"];
  if (typeof verdict !== "object" || verdict === null || typeof (verdict as Record<string, unknown>)["ok"] !== "boolean") {
    refuse('"verdict.ok" is missing');
  }
  return value as HarnessArtifact;
}

/** One scenario's runs, in the order the artifact filed them. */
export interface ScenarioGroup {
  id: string;
  title: string;
  runs: readonly HarnessRun[];
}

export function groupRuns(artifact: HarnessArtifact): readonly ScenarioGroup[] {
  return artifact.scenarios.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    runs: artifact.runs.filter((run) => run.scenarioId === scenario.id),
  }));
}

export function modelOf(artifact: HarnessArtifact, providerId: string): ArtifactModel | undefined {
  return artifact.models.find((model) => model.id === providerId);
}

/** One transcript event, as a line in the chat pane. */
export interface TranscriptLine {
  kind: "utterance" | "question" | "proposal" | "confirmation";
  /** Who the pane shows speaking. Proposals and questions are the Advisor's. */
  speaker: "trainer" | "advisor" | "quoted-document" | "third-party" | "tool";
  text: string;
  /** For a proposal: the trainer wording it claims to interpret. */
  detail?: string;
  at: string;
}

export function transcriptLines(transcript: ScopeTranscript): readonly TranscriptLine[] {
  return transcript.map((event): TranscriptLine => {
    switch (event.kind) {
      case "utterance":
        return { kind: "utterance", speaker: event.source, text: event.text, at: event.at };
      case "question":
        return {
          kind: "question",
          speaker: event.source,
          text: event.text,
          detail: `asking about ${event.dimension}`,
          at: event.at,
        };
      case "proposal": {
        const bindings = Object.entries(event.candidate)
          .map(([dimension, value]) => `${dimension} = ${String(value)}`)
          .join(", ");
        return {
          kind: "proposal",
          speaker: "advisor",
          text: `Proposes an interpretation: ${bindings.length === 0 ? "(nothing)" : bindings}`,
          detail: `interpreting "${event.interpreting}"`,
          at: event.at,
        };
      }
      case "confirmation":
        return {
          kind: "confirmation",
          speaker: event.source,
          text: event.decision === "confirm" ? "Confirms that interpretation." : "Rejects that interpretation.",
          at: event.at,
        };
    }
  });
}

/** One bound dimension, as a pin in the console. */
export interface ScopePin {
  dimension: string;
  value: string;
}

export function scopePins(scope: TrainerScope): readonly ScopePin[] {
  const pins: ScopePin[] = [
    { dimension: "version", value: scope.version },
    { dimension: "region", value: scope.region },
    { dimension: "badgeLevel", value: String(scope.badgeLevel) },
  ];
  if (scope.comparisonBasis !== undefined) {
    pins.push({ dimension: "comparisonBasis", value: scope.comparisonBasis });
  }
  return pins;
}

function factValue(value: FactValue): string {
  switch (value.kind) {
    case "number":
      return String(value.value);
    case "boolean":
      return String(value.value);
    case "text":
      return value.value;
    case "list":
      return value.value.join(", ");
    case "absent":
      return "absent (certified)";
  }
}

/** One claim, as the console states it. Terse on purpose: this is the ledger
 * line, and the certified page is where the answer reads as prose. */
export function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case "fact":
      return `${claim.entityId}: ${claim.factId}${claim.asserted === undefined ? " — derived by the kernel" : ` = ${factValue(claim.asserted)}`}`;
    case "treats":
      return `${claim.itemId} vs ${claim.condition}${claim.asserted === undefined ? " — derived by the kernel" : claim.asserted ? ": treats" : ": does not treat"}`;
    case "comparison":
      return `${claim.leftId} vs ${claim.rightId} by ${claim.factId} — derived by the kernel`;
    case "count":
      return `count(${claim.rosterId})${claim.reported === undefined ? " — derived by the kernel" : ` = ${claim.reported}`}`;
    case "typeCount":
      return `typeCount()${claim.reported === undefined ? " — derived by the kernel" : ` = ${claim.reported}`}`;
    case "gameRule":
      return `gameRule(${claim.ruleId})${claim.reported === undefined ? " — derived by the kernel" : ` = ${claim.reported}`}`;
    case "membership":
      return `${claim.entityId} ${claim.asserted ? "∈" : "∉"} ${claim.rosterId}`;
    case "ranking":
      return (
        `${claim.direction} ${claim.basis} of ${claim.rosterId}` +
        (claim.selectedEntityId === undefined ? " — winner derived by the kernel" : ` → ${claim.selectedEntityId}`)
      );
    case "matchup":
      return (
        `${claim.subject.kind === "species" ? claim.subject.entityId : claim.subject.typeId} ${claim.direction}` +
        (claim.members === undefined ? " — derived by the kernel" : ` ${claim.members.join(", ")}`)
      );
    case "eligibility":
      return (
        `eligibility of ${claim.entityId}` +
        (claim.finding === undefined
          ? " — derived by the kernel"
          : claim.finding.eligible
            ? " — within accreditation"
            : ` — requires badge ${claim.finding.minimumBadgeLevel}, holds ${claim.finding.badgeLevel}`)
      );
    case "explanation":
      return `lesson ${claim.blockId} — reviewed text, shown verbatim`;
    case "recommendation":
      return `recommend ${claim.entityId}`;
    case "action":
      return `${claim.tool}(${claim.entityId})`;
  }
}

/** A named denial, joined to its article for the console's tooltip. */
export interface ViolationView {
  code: string;
  articleTitle: string;
  analog: string;
  message: string;
  expected?: string;
  actual?: string;
}

export function violationView(violation: Violation): ViolationView {
  const entry = article(violation.article);
  return {
    code: `${violation.article}/${violation.rule}`,
    articleTitle: entry.title,
    analog: entry.analog,
    message: violation.message,
    ...(violation.expected === undefined ? {} : { expected: violation.expected }),
    ...(violation.actual === undefined ? {} : { actual: violation.actual }),
  };
}

/** One stage's ruling on the console's ladder. */
export interface StageView {
  stage: TransactionStage;
  allowed: boolean;
  violations: readonly ViolationView[];
}

export function stageViews(run: HarnessRun): readonly StageView[] {
  const verdicts = run.transaction?.verdicts ?? [];
  return verdicts.map((entry) => ({
    stage: entry.stage,
    allowed: entry.verdict.allowed,
    violations: entry.verdict.violations.map(violationView),
  }));
}

/** How the exchange ended, as one line with a tone the chrome can color. */
export interface OutcomeLine {
  tone: "committed" | "refused" | "open";
  text: string;
}

export function outcomeLine(run: HarnessRun): OutcomeLine {
  const outcome = run.transaction?.outcome;
  if (outcome === undefined) return { tone: "open", text: run.detail };
  switch (outcome.status) {
    case "answered":
      return { tone: "committed", text: "Certified answer committed." };
    case "acted": {
      const grants = run.transaction?.actionGrants?.length ?? 0;
      return {
        tone: "committed",
        text: `Acted: ${grants} grant${grants === 1 ? "" : "s"} executed behind the trainer's confirmation.`,
      };
    }
    case "declined":
      return { tone: "open", text: "The trainer declined the page. The answer stands; nothing executed." };
    case "clarifying":
      return { tone: "open", text: `Asking about ${outcome.asking}: “${outcome.question}”` };
    case "denied":
      return { tone: "refused", text: `Refused at the ${outcome.stage} stage.` };
  }
}

/** The header's running counters: the three zeros, and what they are over. */
export interface CounterView {
  label: string;
  value: number;
  /** True for the enforcement counters that must be zero on a green run. */
  mustBeZero: boolean;
}

export function enforcementCounters(artifact: HarnessArtifact): readonly CounterView[] {
  const enforcement = artifact.metrics.enforcement;
  return [
    { label: "answers committed", value: enforcement.answered, mustBeZero: false },
    { label: "acts executed", value: enforcement.acted, mustBeZero: false },
    { label: "committed violations", value: enforcement.committedViolations, mustBeZero: true },
    { label: "wrong-scope commits", value: enforcement.committedWrongScope, mustBeZero: true },
    { label: "unauthorized actions", value: enforcement.committedUnauthorizedActions, mustBeZero: true },
  ];
}
