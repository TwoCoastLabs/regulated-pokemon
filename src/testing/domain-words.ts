/**
 * The domain-word gate's instrument (docs/routing.md, R3b): where the
 * routing path still decides an ask's shape from the domain's own words.
 *
 * The claim R3b makes is that onboarding a domain is authoring data and zero
 * lines of routing code. The gate makes that checkable per commit: it reads
 * every string, template and regex literal in the routing path — never a
 * comment, which is prose about the code, not a decision in it — and counts
 * the ones that name the domain. The word list is not hand-written here: it
 * is derived from the certified snapshots (species, move and item ids, type
 * names), the packs' scope vocabulary (version and region tokens) and the
 * handful of world nouns the pack's copy uses. A word the world adds is
 * gated the commit it lands.
 *
 * The number ratchets down only. It is the activation gauge's successor: a
 * count that moves per commit, whose zero on this world is what lets the next
 * world start from the same zero.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The files whose literals decide routing: the driver, the propose steps'
 * prompt and grammar, the decoder, the retrieval front door and the scope
 * vocabulary's reader. The crucible's world transcripts, the demo script and
 * the harness corpora are this world's *test data* written in TypeScript, and
 * the app's copy is world copy; neither decides an ask's shape, so neither is
 * in the path. Relative to the repository root. */
export const ROUTING_PATH: readonly string[] = [
  "src/session/session.ts",
  "src/session/clarify.ts",
  "src/session/trace.ts",
  "src/harness/advisor.ts",
  "src/harness/schema.ts",
  "src/harness/decode.ts",
  "src/harness/grammar-gate.ts",
  "src/harness/reference.ts",
  "src/harness/canonical.ts",
  "src/memory/precedent.ts",
  "src/kernel/scope.ts",
  "src/kernel/scope-deps.ts",
];

/** World nouns the packs' copy uses that no snapshot lists. */
const WORLD_NOUNS: readonly string[] = [
  "pokemon",
  "pokémon",
  "pokedex",
  "pokédex",
  "badge",
  "badges",
  "gym",
  "league",
  "legendary",
  "mythical",
  "indigo",
];

interface SnapshotShape {
  species?: readonly { id: string }[];
  moves?: readonly { id: string }[];
  items?: readonly { id: string }[];
  typeChart?: { types?: readonly string[] };
}

interface PackShape {
  vocabulary?: { dimensions?: readonly { dimension: string; terms: readonly { tokens: readonly string[] }[] }[] };
}

/** The domain's words, derived: every id and token the data names, lowercased. */
export function domainWords(snapshots: readonly SnapshotShape[], packs: readonly PackShape[]): ReadonlySet<string> {
  const words = new Set<string>(WORLD_NOUNS);
  for (const snapshot of snapshots) {
    for (const entry of snapshot.species ?? []) words.add(entry.id.toLowerCase());
    for (const entry of snapshot.moves ?? []) words.add(entry.id.toLowerCase());
    for (const entry of snapshot.items ?? []) words.add(entry.id.toLowerCase());
    for (const type of snapshot.typeChart?.types ?? []) words.add(type.toLowerCase());
  }
  for (const pack of packs) {
    for (const rule of pack.vocabulary?.dimensions ?? []) {
      // Scope values are the world's (a version name, a region); the numeric
      // dimensions' tokens ("eight", "badges") are English or already listed.
      if (rule.dimension !== "version" && rule.dimension !== "region") continue;
      for (const term of rule.terms) for (const token of term.tokens) words.add(token.toLowerCase());
    }
  }
  return words;
}

export interface Literal {
  line: number;
  text: string;
  regex: boolean;
}

/**
 * Every string, template and regex literal in a TypeScript source, with the
 * line it starts on; comments are skipped whole. A small hand scanner rather
 * than a parser: the source is this repository's own, formatted one way, and
 * the scanner is tested on the constructs it has to get right.
 */
export function literalsOf(source: string): Literal[] {
  const out: Literal[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  /** The previous non-whitespace character, for the regex-vs-division call. */
  let previous = "";
  while (i < n) {
    const c = source[i]!;
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k += 1) if (source[k] === "\n") line += 1;
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const startLine = line;
      let j = i + 1;
      let text = "";
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") {
          text += source[j]! + (source[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (source[j] === "\n") line += 1;
        text += source[j]!;
        j += 1;
      }
      out.push({ line: startLine, text, regex: false });
      i = j + 1;
      previous = c;
      continue;
    }
    if (c === "/" && regexMayStart(previous)) {
      let j = i + 1;
      let text = "";
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        if (source[j] === "\\") {
          text += source[j]! + (source[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        else if (source[j] === "/" && !inClass) break;
        text += source[j]!;
        j += 1;
      }
      if (source[j] === "/") {
        out.push({ line, text, regex: true });
        i = j + 1;
        // Skip the flags.
        while (i < n && /[a-z]/.test(source[i]!)) i += 1;
        previous = "/";
        continue;
      }
    }
    if (!/\s/.test(c)) previous = c;
    i += 1;
  }
  return out;
}

/** A `/` after one of these opens a regex; after an operand it divides. */
function regexMayStart(previous: string): boolean {
  return previous === "" || "(,=:[!&|?{};+-*<>~^%".includes(previous);
}

/**
 * A regex body read as the words it can match: character classes fold to
 * their first member, optional characters drop, groups and anchors vanish,
 * alternations split. Enough to see `pok[eé]mons?` as "pokemon" and
 * `legendar(?:y|ies)` as "legendary" — the gate's job is to count the
 * literal that decides, not to reimplement the engine.
 */
export function regexWords(body: string): string {
  const flat = body
    .replace(/\[([^\]]*)\]/g, (_match, members: string) => members.replace(/^\\/, "").charAt(0))
    .replace(/\\[bBsSdDwW]/g, " ")
    .replace(/\\(.)/g, "$1")
    .replace(/\(\?[:=!]/g, "(")
    // An optional group is read as required; an optional character drops.
    .replace(/\)\?/g, ")")
    .replace(/(.)\?/g, "");
  const words = expandGroups(flat)
    .flatMap((alternative) => alternative.split("|"))
    .flatMap((alternative) => alternative.replace(/[()^$*+{}]/g, " ").replace(/\d+,?\d*/g, " ").split(/\s+/))
    .filter((word) => word !== "");
  return [...new Set(words)].join(" ");
}

/** Every reading of a body's groups, innermost first, so `legendar(y|ies)`
 * yields both "legendary" and "legendaries". Bounded: a body that would
 * expand past the cap is read as it stands, which can only under-count. */
function expandGroups(body: string, cap = 256): string[] {
  const group = /\(([^()]*)\)/.exec(body);
  if (group === null) return [body];
  const alternatives = (group[1] ?? "").split("|");
  const readings = alternatives.map((alternative) => body.slice(0, group.index) + alternative + body.slice(group.index + group[0].length));
  const expanded = readings.flatMap((reading) => expandGroups(reading, cap));
  return expanded.length > cap ? [body] : expanded;
}

export interface DomainHit {
  file: string;
  line: number;
  words: readonly string[];
  literal: string;
}

/** The literals in one source that name the domain, with the words found. */
export function domainHits(file: string, source: string, words: ReadonlySet<string>): DomainHit[] {
  const hits: DomainHit[] = [];
  for (const literal of literalsOf(source)) {
    const haystack = ` ${(literal.regex ? regexWords(literal.text) : literal.text).toLowerCase()} `;
    const found = [...words].filter((word) => haystack.includes(` ${word} `) || wordBounded(haystack, word));
    if (found.length > 0) hits.push({ file, line: literal.line, words: found.sort(), literal: literal.text.slice(0, 80) });
  }
  return hits;
}

/** Word-bounded on letters and digits only, so "red-blue" and "pokédex" match
 * inside punctuation and "mew" never matches inside "mewtwo". */
function wordBounded(haystack: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(word, from);
    if (at < 0) return false;
    const before = haystack[at - 1] ?? " ";
    const after = haystack[at + word.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/** The whole routing path scanned, from the repository root. */
export function scanRoutingPath(root: string, words: ReadonlySet<string>, files: readonly string[] = ROUTING_PATH): DomainHit[] {
  return files.flatMap((file) => domainHits(file, readFileSync(resolve(root, file), "utf8"), words));
}
