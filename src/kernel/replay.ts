/**
 * Replay (IA-10): a verdict re-executed from the record, never remembered.
 *
 * Article X is the one article that is not about a single answer. It is about
 * whether the League can, months later, take the books for one governed
 * exchange and get back to the same verdict — not read the verdict it wrote
 * down, but *derive* it again. "It must have seemed right at the time" is not a
 * record; a record is the set of inputs a verdict is a pure function of.
 *
 * Every layer below this one was built to make that possible and has said so in
 * its own comments: timestamps are supplied rather than clocked, grants are
 * derived from their evidence rather than counted, locale is an input rather
 * than an environment. This module is where that groundwork is finally spent.
 * It re-runs the enforcement path over the recorded inputs and checks that what
 * comes out is, byte for byte, what was filed.
 *
 * Two things are worth stating because they are where a plausible design would
 * be wrong.
 *
 * 1. **The model is not re-run; its answer is re-verified.** The one input a
 *    verdict depends on that is *not* deterministic is the Advisor's proposal —
 *    the manifest. So the manifest is read from the record, exactly as filed,
 *    and submitted to the same verifier it faced the first time. Replay
 *    re-executes the enforcement, not the proposal; that is precisely the seam
 *    the whole project draws, and it is why replay can run offline, key-free,
 *    with no model in the loop.
 * 2. **Reproduction is compared, not asserted.** The filed record carries its
 *    own verdict. Replay recomputes one from the inputs and compares the two
 *    whole records by digest. A record whose filed verdict disagrees with the
 *    one its inputs produce is not a smaller finding than a fabricated fact; it
 *    is the failure Article X exists to catch, and it has a name.
 */

import { createHash } from "node:crypto";

import { authorizeAction } from "./action.js";
import type { ActionGrant, AnswerManifest, Claim, Verdict, Violation } from "./contracts.js";
import { type ManifestContext, verifyManifest } from "./manifest.js";
import type { AccordPack } from "./pack.js";
import { attestRender, planRender } from "./render.js";
import type { CertifiedRegistry } from "./registry.js";
import { resolveScope, type ScopeContext } from "./scope.js";
import { actionClaims, type StageVerdict, type Transaction } from "./transaction.js";
import { AccordError, verdictOf, violation } from "./violation.js";

/**
 * The persisted books for one governed exchange.
 *
 * A {@link Transaction} is already a pure record of its inputs and the verdict
 * they produced — the transcript it rests on, the versions it was certified
 * against, the moments it happened at, and the outcome it reached. Replay treats
 * it as exactly that: there is no second, replay-only record format, because a
 * record the kernel does not itself emit is a record nothing keeps honest.
 */
export type RecordedTransaction = Transaction;

/**
 * The certified world a record is replayed against: the League's own books.
 *
 * The registry and pack are named rather than inferred because Article X names
 * them — a verdict is reproducible only against the snapshot version and the
 * policy it was certified under, and replaying against a different one is not a
 * reproduction, it is a fresh derivation that happens to reuse the transcript.
 */
export interface ReplayWorld {
  registry: CertifiedRegistry;
  pack: AccordPack;
}

/**
 * Re-execute one recorded exchange and return the transaction it produces now.
 *
 * This mirrors {@link runTransaction} step for step, with one substitution: the
 * answer is read from the record instead of proposed by a plan, and re-verified
 * instead of re-compiled. Everything else — scope resolution, the grant, the
 * stage verdicts, the outcome — is derived again from the recorded inputs, so a
 * faithful record comes back byte-identical and a doctored one does not.
 */
export function replayTransaction(world: ReplayWorld, record: RecordedTransaction): Transaction {
  const scopeContext: ScopeContext = {
    pack: world.pack,
    at: record.establishedAt,
    ...(record.required === undefined ? {} : { required: record.required }),
  };
  const scope = resolveScope(scopeContext, record.transcript);

  const base = {
    id: record.id,
    snapshotId: world.registry.snapshot.id,
    packId: world.pack.id,
    locale: record.locale,
    establishedAt: record.establishedAt,
    committedAt: record.committedAt,
    transcript: record.transcript,
    ...(record.required === undefined ? {} : { required: record.required }),
    derivation: scope.derivation,
  };

  if (scope.status === "clarify") {
    return {
      ...base,
      verdicts: [],
      outcome: { status: "clarifying", asking: scope.asking, question: scope.question, missing: scope.missing },
    };
  }

  if (scope.status === "refused") {
    return {
      ...base,
      verdicts: [{ stage: "scope", verdict: verdictOf(scope.violations) }],
      outcome: { status: "denied", stage: "scope", violations: scope.violations },
    };
  }

  const scopeVerdict: StageVerdict = { stage: "scope", verdict: verdictOf([]) };

  // Scope granted, so an answer was released, so the record must carry the
  // manifest that answer was. A granted record with no manifest cannot be
  // replayed to an answered verdict at all — it is incomplete, not merely
  // divergent — so this refuses to guess rather than reconstructing a verdict
  // out of nothing. {@link verifyReplay} catches this before replaying and
  // turns the throw into a named denial for callers that go through the gate.
  if (record.manifest === undefined) {
    throw new AccordError([
      violation("IA-10", "record-incomplete", `cannot replay ${record.id}: scope was granted but no answer is on file`, {
        expected: "the manifest the answer was certified from",
        actual: "no manifest recorded",
      }),
    ]);
  }

  const context: ManifestContext = {
    registry: world.registry,
    pack: world.pack,
    grant: scope.grant,
    locale: record.locale,
    at: record.committedAt,
  };
  const answer = verifyManifest(context, record.manifest);
  if (!answer.allowed) {
    return {
      ...base,
      grant: scope.grant,
      verdicts: [scopeVerdict, { stage: "answer", verdict: answer }],
      outcome: { status: "denied", stage: "answer", violations: answer.violations },
    };
  }

  const committed: Omit<Transaction, "outcome"> = {
    ...base,
    grant: scope.grant,
    manifest: record.manifest,
    verdicts: [scopeVerdict, { stage: "answer", verdict: verdictOf([]) }],
  };

  // The act path is re-walked exactly when the record says it was walked: the
  // recorded moments are the evidence the transport offered one. A record that
  // never entered it replays to "answered" whatever its claims propose,
  // because an act that was never rendered is an act that never happened.
  const acts = actionClaims(record.manifest);
  if (record.renderedAt === undefined || acts.length === 0) {
    return { ...committed, outcome: { status: "answered" } };
  }
  return replayActPath(context, record, record.manifest, record.renderedAt, committed, acts);
}

/**
 * The act path, re-executed from the record.
 *
 * Mirrors `runActPath` with the same substitution `replayTransaction` makes for
 * the manifest: the two inputs nothing deterministic produced — the artifact
 * (an untrusted renderer drew it) and the confirmation (a trainer gave it) —
 * are read from the record, and everything derived from them (the plan, the
 * affidavit, every grant) is derived again and compared by the caller's digest.
 */
function replayActPath(
  context: ManifestContext,
  record: RecordedTransaction,
  manifest: AnswerManifest,
  renderedAt: string,
  committed: Omit<Transaction, "outcome">,
  acts: readonly Extract<Claim, { kind: "action" }>[],
): Transaction {
  const base: Omit<Transaction, "outcome"> = {
    ...committed,
    renderedAt,
    ...(record.authorizedAt === undefined ? {} : { authorizedAt: record.authorizedAt }),
    ...(record.executedAt === undefined ? {} : { executedAt: record.executedAt }),
  };

  const planned = planRender(context, manifest);
  if (!planned.ok) {
    return {
      ...base,
      verdicts: [...committed.verdicts, { stage: "render", verdict: verdictOf(planned.violations) }],
      outcome: { status: "denied", stage: "render", violations: planned.violations },
    };
  }

  if (record.artifact === undefined) {
    throw new AccordError([
      violation("IA-10", "record-incomplete", `cannot replay ${record.id}: the page was planned but no artifact is on file`, {
        expected: "the artifact the trainer was shown",
        actual: "no artifact recorded",
      }),
    ]);
  }

  const attested = attestRender(context, manifest, record.artifact, renderedAt);
  if (!attested.ok) {
    return {
      ...base,
      artifact: record.artifact,
      verdicts: [...committed.verdicts, { stage: "render", verdict: verdictOf(attested.violations) }],
      outcome: { status: "denied", stage: "render", violations: attested.violations },
    };
  }

  if (record.confirmation === undefined) {
    return {
      ...base,
      artifact: record.artifact,
      affidavit: attested.value,
      outcome: { status: "declined" },
    };
  }

  if (record.authorizedAt === undefined || record.executedAt === undefined) {
    throw new AccordError([
      violation("IA-10", "record-incomplete", `cannot replay ${record.id}: the act was confirmed but its moments are not on file`, {
        expected: "authorizedAt and executedAt for the confirmed act",
        actual: "moments missing from the record",
      }),
    ]);
  }

  const grants: ActionGrant[] = [];
  const violations: Violation[] = [];
  for (const claim of acts) {
    const authorized = authorizeAction(context, {
      manifest,
      artifact: record.artifact,
      affidavit: attested.value,
      confirmation: record.confirmation,
      tool: claim.tool,
      entityId: claim.entityId,
      authorizedAt: record.authorizedAt,
      executedAt: record.executedAt,
    });
    if (authorized.ok) grants.push(authorized.value);
    else violations.push(...authorized.violations);
  }

  if (violations.length > 0) {
    return {
      ...base,
      artifact: record.artifact,
      affidavit: attested.value,
      confirmation: record.confirmation,
      verdicts: [...committed.verdicts, { stage: "action", verdict: verdictOf(violations) }],
      outcome: { status: "denied", stage: "action", violations },
    };
  }

  return {
    ...base,
    artifact: record.artifact,
    affidavit: attested.value,
    confirmation: record.confirmation,
    actionGrants: grants,
    verdicts: [...committed.verdicts, { stage: "action", verdict: verdictOf([]) }],
    outcome: { status: "acted" },
  };
}

/**
 * Judge whether a record reproduces, and name the break if it does not.
 *
 * Three ways a record fails Article X, checked in the order that makes each
 * denial land on its own substance:
 *
 * 1. It is pinned to a snapshot or a pack the League is not replaying against,
 *    so "reproducible" has no meaning — a different world would give a different
 *    verdict for reasons that are not the record's.
 * 2. It is incomplete: a verdict was reached over an input the books do not
 *    carry, so there is nothing to re-execute.
 * 3. It reproduces to a different verdict than the one on file.
 *
 * Knows nothing about how the record was produced. A transaction from the
 * kernel's own doors, from cold storage, or from a mutated fixture is read
 * identically — which is the whole point, since the thing being audited is
 * whether the record alone suffices.
 */
export function verifyReplay(world: ReplayWorld, record: RecordedTransaction): Verdict {
  const pins = checkPins(world, record);
  if (pins.length > 0) return verdictOf(pins);

  const complete = checkComplete(record);
  if (complete.length > 0) return verdictOf(complete);

  let replayed: Transaction;
  try {
    replayed = replayTransaction(world, record);
  } catch (error) {
    // The only throw replayTransaction makes is a named IA-10 denial; anything
    // else is a real bug and must not be swallowed.
    if (error instanceof AccordError) return verdictOf(error.violations);
    throw error;
  }

  const filed = canonicalDigest(record);
  const reproduced = canonicalDigest(replayed);
  if (filed !== reproduced) {
    return verdictOf([
      violation("IA-10", "verdict-not-reproduced", `replaying ${record.id} did not reproduce the filed verdict`, {
        expected: filed,
        actual: reproduced,
      }),
    ]);
  }
  return verdictOf([]);
}

// --- the checks -------------------------------------------------------------

/**
 * The record names the world it was certified against, and it is this one.
 *
 * Checked before anything is re-executed: a record certified against another
 * snapshot version or another Accord pack cannot be reproduced here even in
 * principle, and re-running its transcript against the wrong world would
 * manufacture a divergence that says nothing about the record's own honesty.
 */
function checkPins(world: ReplayWorld, record: RecordedTransaction): Violation[] {
  const violations: Violation[] = [];
  if (record.snapshotId !== world.registry.snapshot.id) {
    violations.push(
      violation("IA-10", "snapshot-not-pinned", `record ${record.id} was certified against a snapshot the League is not replaying against`, {
        expected: world.registry.snapshot.id,
        actual: record.snapshotId || "no snapshot",
      }),
    );
  }
  if (record.packId !== world.pack.id) {
    violations.push(
      violation("IA-10", "pack-not-pinned", `record ${record.id} was governed by an Accord pack the League is not replaying against`, {
        expected: world.pack.id,
        actual: record.packId || "no pack",
      }),
    );
  }
  return violations;
}

/**
 * The record carries every input its verdict rested on.
 *
 * Three inputs are not derivable from the transcript, and each is load-bearing
 * for the outcomes that rest on it: the **manifest** whenever an answer was
 * judged, the **artifact** whenever a page was shown (it came from an untrusted
 * renderer nothing can re-run), and the **confirmation** whenever an act was
 * judged (it came from a trainer). A record that reached such an outcome
 * without keeping the input is a verdict nobody can re-derive. The moments the
 * act path ran at are inputs too — supplied to the kernel, so kept by it.
 */
function checkComplete(record: RecordedTransaction): Violation[] {
  const violations: Violation[] = [];
  const { outcome } = record;
  const missing = (message: string, expected: string): void => {
    violations.push(
      violation("IA-10", "record-incomplete", `record ${record.id} ${message}`, { expected, actual: "not recorded" }),
    );
  };

  const deniedAt = outcome.status === "denied" ? outcome.stage : undefined;
  const judgedAnAnswer =
    outcome.status === "answered" ||
    outcome.status === "acted" ||
    outcome.status === "declined" ||
    deniedAt === "answer" ||
    deniedAt === "render" ||
    deniedAt === "action";
  if (judgedAnAnswer && record.manifest === undefined) {
    missing("reached an answer verdict but kept no manifest to replay", "the manifest the answer verdict was reached over");
  }

  const walkedActPath =
    outcome.status === "acted" || outcome.status === "declined" || deniedAt === "render" || deniedAt === "action";
  if (walkedActPath && record.renderedAt === undefined) {
    missing("walked the act path but does not say when", "the moments the act path ran at");
  }

  const showedAPage = outcome.status === "acted" || outcome.status === "declined" || deniedAt === "action";
  if (showedAPage && record.artifact === undefined) {
    missing("says a page was shown but kept no artifact", "the artifact the trainer was shown");
  }

  const judgedAnAct = outcome.status === "acted" || deniedAt === "action";
  if (judgedAnAct && record.confirmation === undefined) {
    missing("reached an act verdict but kept no confirmation", "the trainer's confirmation of the artifact");
  }
  if (judgedAnAct && (record.authorizedAt === undefined || record.executedAt === undefined)) {
    missing("reached an act verdict but not the act's moments", "authorizedAt and executedAt");
  }

  return violations;
}

// --- bit-for-bit ------------------------------------------------------------

/**
 * A digest over a record's content, independent of key order and absent fields.
 *
 * "Reproduce the verdict bit-for-bit" is a claim about content, not about the
 * accidents of how two objects were built, so keys are sorted and `undefined`
 * is dropped before hashing — an omitted optional and a present-but-undefined
 * one are the same record. Everything else, including array order, is content:
 * the order of claims, of bindings, of violations is part of what a faithful
 * replay must reproduce.
 */
export function canonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .flatMap((key) => {
      const held = (value as Record<string, unknown>)[key];
      if (held === undefined) return [];
      return [`${JSON.stringify(key)}:${canonicalJson(held)}`];
    });
  return `{${entries.join(",")}}`;
}
