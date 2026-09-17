/**
 * The lesson door read live, on both sides (docs/lesson-door.md, the
 * classifier).
 *
 * The activation gauge reads the deterministic door key-free. The
 * classifier is a model call, so its reading is a live one: the same
 * held-out sets — the bank's lesson questions with their paraphrases, the
 * second held-out set, and every must-not-answer wording — put through
 * {@link lessonDoorDecision}, which is the driver's own decision function,
 * with the classifier on. Each wording records what the door offered, whether
 * the model was asked, what it said, and whether the outcome was right; the
 * artifact carries every one, so a published number leads back to the asks
 * behind it. Enforcement is not in question here — nothing is certified —
 * so the reading is usefulness alone: recall, precision, calls, cost, errors,
 * and the share of each that the classifier owned.
 *
 * Pure but for the provider: a function of the world, the sets and the model.
 * CI runs it with a scripted provider; the numbers come from a paid run.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DemoWorld } from "../demo/script.js";
import type { ArtifactWorld } from "./artifact.js";
import type { ModelProvider, Usage } from "./provider.js";
import { addUsage, emptyUsage } from "./provider.js";
import type { QuestionBank } from "./bank.js";
import { type LessonParaphraseBank, wordingsOf } from "./activation.js";
import { MUST_NOT_RESOLVE } from "./decline-ledger.js";
import { type LessonMatcherId, lessonFoothold } from "../session/lesson-matcher.js";
import { lessonDoorDecision } from "../session/session.js";

export type ReadingSet = "recall-canonical" | "recall-paraphrase" | "recall-held-out" | "precision-canonical" | "precision-paraphrase";

export interface LessonDoorReading {
  set: ReadingSet;
  entryId: string;
  wording: string;
  repetition: number;
  /** The lessons that would make this a hit (recall sets); empty on precision sets. */
  acceptable: readonly string[];
  /** What the door offered, boundary excluded. */
  offered: readonly string[];
  asked: boolean;
  /** The classifier's reading when asked: the kind, `lesson:<id>` (with
   * `:no-foothold` when the named lesson shared no word with the ask and
   * was not offered), or `unusable`. */
  classified?: string;
  /** Recall: an acceptable lesson was offered. Precision: nothing but the boundary was. */
  ok: boolean;
  usage: Usage;
  providerError: boolean;
}

export interface ReadingRate {
  ok: number;
  total: number;
  /** Of the total, how many the classifier was asked on. */
  asked: number;
  /** Of those asked, how many ended right — the classifier's own share. */
  askedOk: number;
}

export interface LessonDoorReadingArtifact {
  schemaVersion: 1;
  label: "lesson-door-reading";
  startedAt: string;
  model: { id: string; slug: string };
  /** The same provenance block every filed artifact carries, so the replay
   * sweep can tell which world these numbers were read against. */
  world: ArtifactWorld;
  matcher: LessonMatcherId;
  classifier: boolean;
  repetitions: number;
  readings: readonly LessonDoorReading[];
  summary: {
    rates: Record<ReadingSet, ReadingRate>;
    classifier: { asked: number; lesson: number; noFoothold: number; fact: number; advice: number; other: number; unusable: number };
    usage: Usage;
    providerErrors: number;
  };
}

/** Every wording the reading covers, by set. */
export function readingWordings(bank: QuestionBank, paraphrases: LessonParaphraseBank): readonly { set: ReadingSet; entryId: string; wording: string; acceptable: readonly string[] }[] {
  const out: { set: ReadingSet; entryId: string; wording: string; acceptable: readonly string[] }[] = [];
  for (const entry of bank.entries) {
    const lessons = entry.expectBlockIds ?? [];
    if (lessons.length > 0 && (entry.expectClaimKinds ?? []).includes("explanation")) {
      wordingsOf(entry).forEach((wording, index) => out.push({ set: index === 0 ? "recall-canonical" : "recall-paraphrase", entryId: entry.id, wording, acceptable: lessons }));
    }
    if (MUST_NOT_RESOLVE.includes(entry.disposition)) {
      wordingsOf(entry).forEach((wording, index) => out.push({ set: index === 0 ? "precision-canonical" : "precision-paraphrase", entryId: entry.id, wording, acceptable: [] }));
    }
  }
  for (const entry of paraphrases.entries) {
    for (const wording of entry.phrasings) out.push({ set: "recall-held-out", entryId: entry.entryId, wording, acceptable: entry.expectBlockIds });
  }
  return out;
}

export async function readLessonDoor(
  world: DemoWorld,
  provider: ModelProvider,
  bank: QuestionBank,
  paraphrases: LessonParaphraseBank,
  options: { matcher?: LessonMatcherId | undefined; classifier: boolean; repetitions: number },
): Promise<readonly LessonDoorReading[]> {
  const boundary = world.pack.recordsBoundary?.lessonId;
  const readings: LessonDoorReading[] = [];
  for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
    for (const item of readingWordings(bank, paraphrases)) {
      const decision = await lessonDoorDecision(world, provider, item.wording, { matcher: options.matcher, classifier: options.classifier });
      const offered = decision.offer.offered.filter((id) => id !== boundary);
      const ok = item.acceptable.length > 0 ? item.acceptable.some((id) => offered.includes(id)) : offered.length === 0;
      const classified =
        decision.classified === undefined
          ? undefined
          : decision.classified === "unusable"
            ? "unusable"
            : decision.classified.kind === "lesson"
              ? `lesson:${decision.classified.lessonId}${decision.classified.foothold?.length === 0 ? ":no-foothold" : ""}`
              : decision.classified.kind;
      readings.push({
        ...item,
        repetition,
        offered,
        asked: decision.asked,
        ...(classified === undefined ? {} : { classified }),
        ok,
        usage: decision.usage,
        providerError: decision.providerError,
      });
    }
  }
  return readings;
}

/**
 * A filed reading re-read under the foothold rule — the free leg (the
 * rescore pattern, epic #94): the classifier's replies are in the artifact,
 * the foothold is a pure function of the pack and the ask, so what the door
 * would have offered under the rule is derivable from the record without a
 * call. A reading whose named lesson shares no distinctive word with the
 * ask has its offer withdrawn and its outcome re-judged; every other reading
 * is returned as filed. Readings filed after the rule exist already carry
 * `:no-foothold` and are left alone.
 */
export function rescoreWithFoothold(pack: DemoWorld["pack"], readings: readonly LessonDoorReading[]): readonly LessonDoorReading[] {
  return readings.map((reading) => {
    const classified = reading.classified;
    if (classified === undefined || !classified.startsWith("lesson:") || classified.endsWith(":no-foothold")) return reading;
    const named = classified.slice("lesson:".length);
    if (!reading.offered.includes(named)) return reading;
    if (lessonFoothold(pack, reading.wording, named).length > 0) return reading;
    const offered = reading.offered.filter((id) => id !== named);
    const ok = reading.acceptable.length > 0 ? reading.acceptable.some((id) => offered.includes(id)) : offered.length === 0;
    return { ...reading, offered, ok, classified: `${classified}:no-foothold` };
  });
}

const SETS: readonly ReadingSet[] = ["recall-canonical", "recall-paraphrase", "recall-held-out", "precision-canonical", "precision-paraphrase"];

export function summarize(readings: readonly LessonDoorReading[]): LessonDoorReadingArtifact["summary"] {
  const rates = Object.fromEntries(
    SETS.map((set) => {
      const mine = readings.filter((reading) => reading.set === set);
      return [set, { ok: mine.filter((r) => r.ok).length, total: mine.length, asked: mine.filter((r) => r.asked).length, askedOk: mine.filter((r) => r.asked && r.ok).length }];
    }),
  ) as Record<ReadingSet, ReadingRate>;
  const asked = readings.filter((reading) => reading.asked);
  const count = (predicate: (classified: string | undefined) => boolean) => asked.filter((reading) => predicate(reading.classified)).length;
  return {
    rates,
    classifier: {
      asked: asked.length,
      lesson: count((c) => c?.startsWith("lesson:") === true),
      noFoothold: count((c) => c?.endsWith(":no-foothold") === true),
      fact: count((c) => c === "fact"),
      advice: count((c) => c === "advice"),
      other: count((c) => c === "other"),
      unusable: count((c) => c === "unusable"),
    },
    usage: readings.reduce((sum, reading) => addUsage(sum, reading.usage), emptyUsage()),
    providerErrors: readings.filter((reading) => reading.providerError).length,
  };
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "—" : `${part}/${whole} (${Math.round((part / whole) * 100)}%)`;
}

const SET_LABEL: Record<ReadingSet, string> = {
  "recall-canonical": "recall, canonical intents",
  "recall-paraphrase": "recall, first held-out set",
  "recall-held-out": "recall, second held-out set",
  "precision-canonical": "precision, must-not-answer, canonical",
  "precision-paraphrase": "precision, must-not-answer, paraphrases",
};

/** The artifact as Markdown — rendered from the data, never hand-transcribed. */
export function renderLessonDoorReading(artifact: LessonDoorReadingArtifact): string {
  const { summary } = artifact;
  const lines: string[] = [
    `# The lesson door, read live — ${artifact.model.slug}`,
    "",
    `Matcher \`${artifact.matcher}\`, classifier ${artifact.classifier ? "on" : "off"}, N=${artifact.repetitions}. ${summary.usage.calls} model calls, $${summary.usage.costUsd.toFixed(4)}, ${summary.providerErrors} provider error(s).`,
    "",
    "| set | right | the classifier was asked on | of those, right |",
    "|---|---:|---:|---:|",
  ];
  for (const set of SETS) {
    const rate = summary.rates[set];
    lines.push(`| ${SET_LABEL[set]} | ${pct(rate.ok, rate.total)} | ${pct(rate.asked, rate.total)} | ${pct(rate.askedOk, rate.asked)} |`);
  }
  const c = summary.classifier;
  lines.push(
    "",
    `The classifier, over the ${c.asked} asks it was asked on: lesson ${c.lesson} (of which ${c.noFoothold} shared no distinctive word with the ask and were not offered), fact ${c.fact}, advice ${c.advice}, other ${c.other}, unusable ${c.unusable}.`,
    "",
  );
  const misses = artifact.readings.filter((reading) => !reading.ok);
  if (misses.length > 0) {
    lines.push("Misses:", "");
    for (const miss of misses) {
      lines.push(`- ${SET_LABEL[miss.set]}: \`${miss.entryId}\` “${miss.wording}” → ${miss.offered.map((id) => `\`${id}\``).join(", ") || "boundary only"}${miss.classified === undefined ? "" : ` (classifier: ${miss.classified})`}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** The world this reading was made against, pinned like every artifact. */
export function readingWorld(world: DemoWorld): ArtifactWorld {
  const { snapshot, document } = world.registry;
  return { snapshotId: snapshot.id, snapshotDigest: document.contentDigest, sourceCommit: snapshot.sourceCommit, packId: world.pack.id };
}

export function fileLessonDoorReading(directory: string, artifact: LessonDoorReadingArtifact): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${artifact.startedAt.replace(/[:.]/g, "-")}-lesson-door.json`);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return path;
}
