/**
 * The lesson door's matcher (docs/lesson-door.md): which lessons is this
 * ask about?
 *
 * The door has one rule — a lesson is in the grammar only when the ask is
 * about it — and one policy: concept lessons first, orientation lessons only
 * when no concept matched, the records-boundary lesson always. What varies is
 * the *matching* step, and this module holds it behind one interface with
 * two implementations, so the driver, the tracer, the bank and the
 * activation gauge can run either and read them side by side:
 *
 * - **`alias`** — the ask contains one of the lesson's declared phrasings as
 *   a whole phrase. Exact, reviewable data, no tolerance for a rephrasing or
 *   a misspelling. 15 of 25 held-out paraphrases (findings §24).
 * - **`bm25`** — the lesson's own text, indexed by character trigrams and
 *   scored by BM25, with the score normalised to the share of the ask's
 *   distinctive content the lesson explains. A hundred lines, hand-rolled
 *   rather than a dependency, so the number cannot move with a library
 *   version; a pure function of the pack and the ask, so it runs in CI and
 *   in the browser exactly as the alias matcher does.
 *
 * Neither reads the model. Both apply the same policy after matching. The
 * held-out set the two are read against is the bank's reviewed paraphrases,
 * which are never the source of an alias and never in the index.
 */

import type { AccordPack, CurriculumRule } from "../kernel/pack.js";
import { declaresLessonCoverage } from "../kernel/pack.js";

/** What the lesson door decided for one ask. */
export interface LessonOffer {
  /** The lesson ids the explanation route may carry, boundary included. */
  readonly offered: readonly string[];
  /** The lesson ids left out. */
  readonly withheld: readonly string[];
  /** Why, for a reader outside the code. */
  readonly reason: string;
}

export type LessonMatcherId = "alias" | "bm25" | "both";
export const LESSON_MATCHERS: readonly LessonMatcherId[] = ["alias", "bm25", "both"];

/** A pack with lessons: the only part of the world a matcher reads. */
export interface LessonWorld {
  pack: AccordPack;
}

/** The ask as the lesson aliases are written: lower case, accents folded,
 * curly apostrophes straightened, whitespace collapsed. */
export function foldAsk(ask: string): string {
  return ask
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// --- the policy, shared -----------------------------------------------------

/**
 * The door's policy over a set of matched lessons: concept lessons if any
 * matched, else orientation lessons that matched, and the boundary always.
 * `reason` is written for a reader outside the code.
 */
function applyPolicy(lessons: readonly CurriculumRule[], matched: (lesson: CurriculumRule) => boolean, how: string): LessonOffer {
  const concept = lessons.filter((lesson) => lesson.covers?.scope === "concept" && matched(lesson));
  const orientation = concept.length > 0 ? [] : lessons.filter((lesson) => lesson.covers?.scope === "orientation" && matched(lesson));
  const boundary = lessons.filter((lesson) => lesson.covers?.scope === "boundary");
  const offeredSet = new Set([...concept, ...orientation, ...boundary].map((lesson) => lesson.id));
  const offered = lessons.filter((lesson) => offeredSet.has(lesson.id)).map((lesson) => lesson.id);
  const withheld = lessons.filter((lesson) => !offeredSet.has(lesson.id)).map((lesson) => lesson.id);
  const reason =
    concept.length > 0
      ? `the question is about ${concept.map((lesson) => `"${lesson.id}"`).join(", ")} (${how}); the other lessons are about something else`
      : orientation.length > 0
        ? `the question is about the game as a whole (${orientation.map((lesson) => `"${lesson.id}"`).join(", ")}, ${how}); no lesson about one thing matched`
        : `the question names nothing a lesson explains (${how}) — only the records' boundary is offered`;
  return { offered, withheld, reason };
}

function everyLesson(pack: AccordPack): LessonOffer {
  return { offered: pack.curriculum.map((lesson) => lesson.id), withheld: [], reason: "the pack declares no lesson coverage — every lesson offered" };
}

// --- alias ------------------------------------------------------------------

/**
 * The alias matcher: a concept or orientation lesson matches when one of its
 * declared aliases is in the ask as a whole phrase — "what is a type" must
 * not match inside "what is a typewriter", so both ends sit on a non-letter
 * or the edge.
 */
export function aliasOffer(world: LessonWorld, ask: string): LessonOffer {
  if (!declaresLessonCoverage(world.pack)) return everyLesson(world.pack);
  const haystack = foldAsk(ask);
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const contains = (alias: string): boolean => new RegExp(`(^|[^a-z0-9])${escape(alias)}([^a-z0-9]|$)`).test(haystack);
  return applyPolicy(world.pack.curriculum, (lesson) => (lesson.covers?.aliases ?? []).some(contains), "a declared phrasing is in the ask");
}

// --- bm25 -------------------------------------------------------------------

/**
 * The index over a pack's lessons, built once per pack and cached by
 * identity. Words, not characters: the lesson's text in the pack's first
 * locale is the document, and nothing else is — not the id, not the
 * aliases — so the two matchers read different evidence.
 *
 * The document is the lesson's text plus its id read as words — the title
 * field, counted twice. A definitional lesson is identified by its title,
 * not by its body: the body of "what is a Pokémon?" uses the word Pokémon
 * no more distinctively than any other lesson does (found 2026-09-17, on
 * the canonical intents, before any held-out reading — text alone ranked
 * the wanted lesson first on 6 of 18).
 *
 * Nothing English is written in this file. Stop words come from two
 * places the pack already holds: the words that appear in at least half
 * the lessons ("the", "a", "pokemon", "you" — what a question shares with
 * every lesson), and the pack's own `interrogative` and `conjunction`
 * marker groups ("what", "how", "does", "can", "and"), which are the
 * question words lesson prose never uses and that would otherwise be the
 * rarest, and so heaviest, words in an ask. Typo tolerance is the
 * vocabulary itself: a word of four letters or more that no lesson
 * contains is read as the one vocabulary word within a single edit of it
 * that shares its first letter — "cath" as "catch", "badg" as "badge",
 * and by the same rule "leaders" as "leader". No neighbour, or more than
 * one, and the word is dropped.
 */
interface Bm25Index {
  readonly lessons: readonly CurriculumRule[];
  /** Per lesson: word → count, stop words removed. */
  readonly tf: readonly ReadonlyMap<string, number>[];
  readonly length: readonly number[];
  readonly averageLength: number;
  /** word → number of lessons containing it, stop words removed. */
  readonly df: ReadonlyMap<string, number>;
  readonly vocabulary: readonly string[];
  readonly stop: ReadonlySet<string>;
}

const K1 = 1.2;
const B = 0.75;
/**
 * The share of the ask's distinctive content a lesson must explain to be
 * offered, on the normalised scale (0 is nothing, 1 is every word at
 * saturation). Set on 2026-09-17 from the canonical lesson questions alone,
 * before the held-out paraphrases were read: the strictest value that
 * keeps every canonical intent the index can rank within {@link BM25_K}
 * offered — 15 of 18; the other three ("What is a Pokémon?", whose only
 * word is a stop word, and the two orientation asks that share no word
 * with their lesson) score 0 at any threshold and are the lexical
 * method's own ceiling, not the threshold's.
 */
export const BM25_THRESHOLD = 0.14;
/** At most this many lessons are offered beside the boundary, best first. */
export const BM25_K = 3;

export function words(text: string): string[] {
  return foldAsk(text)
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/** Damerau–Levenshtein distance capped at 2 — one edit is what the fold allows. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    rows.push([i]);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = i === 0 ? j : Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

const indexes = new WeakMap<AccordPack, Bm25Index>();

function indexOf(pack: AccordPack): Bm25Index {
  const cached = indexes.get(pack);
  if (cached !== undefined) return cached;
  const lessons = pack.curriculum;
  const title = (lesson: CurriculumRule): string[] => words(lesson.id.replace(/-/g, " "));
  const raw = lessons.map((lesson) => [...title(lesson), ...title(lesson), ...words(lesson.block.content[0]?.text ?? "")]);
  const rawDf = new Map<string, number>();
  for (const doc of raw) for (const word of new Set(doc)) rawDf.set(word, (rawDf.get(word) ?? 0) + 1);
  const markers = pack.vocabulary.markers as Record<string, readonly string[] | undefined>;
  const questionWords = [...(markers.interrogative ?? []), ...(markers.conjunction ?? [])].flatMap(words);
  const stop = new Set([...[...rawDf].filter(([, n]) => n * 2 >= lessons.length).map(([word]) => word), ...questionWords]);
  const tf: Map<string, number>[] = [];
  const length: number[] = [];
  const df = new Map<string, number>();
  for (const doc of raw) {
    const kept = doc.filter((word) => !stop.has(word));
    const counts = new Map<string, number>();
    for (const word of kept) counts.set(word, (counts.get(word) ?? 0) + 1);
    for (const word of counts.keys()) df.set(word, (df.get(word) ?? 0) + 1);
    tf.push(counts);
    length.push(kept.length);
  }
  const built: Bm25Index = {
    lessons,
    tf,
    length,
    averageLength: length.reduce((sum, n) => sum + n, 0) / Math.max(1, length.length),
    df,
    vocabulary: [...df.keys()].sort(),
    stop,
  };
  indexes.set(pack, built);
  return built;
}

/** The ask's words as the index knows them: stop words dropped, an unknown
 * word read as its one vocabulary neighbour within a single edit, or dropped. */
export function askWords(pack: AccordPack, ask: string): string[] {
  const index = indexOf(pack);
  const read: string[] = [];
  for (const word of words(ask)) {
    if (index.stop.has(word)) continue;
    if (index.df.has(word)) {
      read.push(word);
      continue;
    }
    if (word.length < 4) continue;
    const near = index.vocabulary.filter((candidate) => candidate[0] === word[0] && editDistance(word, candidate) <= 1);
    if (near.length === 1) read.push(near[0]!);
  }
  return read;
}

function idf(index: Bm25Index, word: string): number {
  const n = index.df.get(word) ?? 0;
  return Math.log(1 + (index.lessons.length - n + 0.5) / (n + 0.5));
}

/**
 * BM25 of the ask against one lesson, divided by the ask's best possible
 * score (every word present at saturation), so the result reads as "the
 * share of the ask's distinctive content this lesson explains" and one
 * threshold serves every ask regardless of its length. An ask with no
 * indexable words scores 0 against everything.
 */
export function bm25Share(pack: AccordPack, ask: string, lessonIndex: number): number {
  const index = indexOf(pack);
  const counts = new Map<string, number>();
  for (const word of askWords(pack, ask)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const norm = 1 - B + (B * index.length[lessonIndex]!) / index.averageLength;
  let score = 0;
  let ceiling = 0;
  for (const [word, queryCount] of counts) {
    const weight = idf(index, word) * queryCount;
    ceiling += weight * (K1 + 1);
    const tf = index.tf[lessonIndex]!.get(word) ?? 0;
    if (tf > 0) score += weight * ((tf * (K1 + 1)) / (tf + K1 * norm));
  }
  return ceiling === 0 ? 0 : score / ceiling;
}

/**
 * The BM25 matcher: a concept or orientation lesson matches when its share
 * is at least {@link BM25_THRESHOLD} and it is among the {@link BM25_K}
 * best. The boundary lesson is never scored — it is policy, not a match.
 */
export function bm25Offer(world: LessonWorld, ask: string): LessonOffer {
  if (!declaresLessonCoverage(world.pack)) return everyLesson(world.pack);
  const lessons = world.pack.curriculum;
  const scored = lessons
    .map((lesson, position) => ({ lesson, share: lesson.covers?.scope === "boundary" ? 0 : bm25Share(world.pack, ask, position) }))
    .filter((entry) => entry.share >= BM25_THRESHOLD)
    .sort((a, b) => b.share - a.share || a.lesson.id.localeCompare(b.lesson.id))
    .slice(0, BM25_K);
  const matched = new Set(scored.map((entry) => entry.lesson.id));
  const how =
    scored.length === 0
      ? `no lesson's text explains ${Math.round(BM25_THRESHOLD * 100)}% of the ask's words`
      : scored.map((entry) => `${entry.lesson.id} ${Math.round(entry.share * 100)}%`).join(", ");
  return applyPolicy(lessons, (lesson) => matched.has(lesson.id), how);
}

/**
 * The union: a lesson matches when either matcher says so, the policy
 * applied once over the union. Recall can only rise and precision can only
 * fall against either alone — a reading, so the trade is a number.
 */
export function bothOffer(world: LessonWorld, ask: string): LessonOffer {
  if (!declaresLessonCoverage(world.pack)) return everyLesson(world.pack);
  const lessons = world.pack.curriculum;
  const boundary = lessons.find((lesson) => lesson.covers?.scope === "boundary")?.id;
  // Each matcher's *matched* set is its offer without the policy's
  // orientation-vs-concept choice: recover it by taking the offer and
  // letting the policy run again over the union.
  const alias = new Set(aliasOffer(world, ask).offered.filter((id) => id !== boundary));
  const bm25 = new Set(bm25Offer(world, ask).offered.filter((id) => id !== boundary));
  return applyPolicy(lessons, (lesson) => alias.has(lesson.id) || bm25.has(lesson.id), "either a declared phrasing or the lesson's text");
}

/** The matcher by id. */
export function lessonOffer(matcher: LessonMatcherId, world: LessonWorld, ask: string): LessonOffer {
  return matcher === "bm25" ? bm25Offer(world, ask) : matcher === "both" ? bothOffer(world, ask) : aliasOffer(world, ask);
}
