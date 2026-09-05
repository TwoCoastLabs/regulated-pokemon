/**
 * The domain-word gate (docs/routing.md, R3b): the routing path's count of
 * literals that name the domain, pinned, ratcheting down only.
 *
 * Two failures, both deliberate. The count going *up* means a domain word
 * entered the routing path — a line a medicine team would rewrite by hand —
 * and the change must move it to data instead. The count going *down*
 * without the pin following means the number stopped being the instrument
 * it is: lower the pin in the same change, so the ledger reads per commit.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { domainHits, domainWords, literalsOf, regexWords, ROUTING_PATH, scanRoutingPath } from "./domain-words.js";

const ROOT = resolve(import.meta.dirname, "../..");

function json(path: string): unknown {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as unknown;
}

/**
 * The baseline, filed 2026-09-05 with the gate's first commit. Every
 * literal in the routing path that names the domain — the cue lists, the
 * roster ids a door mints, the fact ids a profile lists, the copy the driver
 * speaks in the League's voice. R3b drives it to zero; lower it in the
 * change that removes a site, never raise it.
 */
const PINNED_SITES = 88;

describe("the domain-word gate", () => {
  const words = domainWords(
    [json("data/snapshots/kanto-red-blue.json") as never, json("data/snapshots/kanto-center.json") as never],
    [json("data/accord-pack/v2.json") as never, json("data/accord-pack/center-v2.json") as never],
  );

  it("derives the domain's words from the data, never from a hand list", () => {
    expect(words.has("pikachu")).toBe(true);
    expect(words.has("thunderbolt")).toBe(true);
    expect(words.has("potion")).toBe(true);
    expect(words.has("electric")).toBe(true);
    expect(words.has("yellow")).toBe(true);
    expect(words.has("kanto")).toBe(true);
    expect(words.has("badge")).toBe(true);
    expect(words.has("what")).toBe(false);
  });

  it("holds the routing path at the pinned count, ratcheting down only", () => {
    const hits = scanRoutingPath(ROOT, words);
    const byFile = new Map<string, number>();
    for (const hit of hits) byFile.set(hit.file, (byFile.get(hit.file) ?? 0) + 1);
    const ledger = [...byFile.entries()].map(([file, count]) => `${count}\t${file}`).join("\n");
    const listing = hits.map((hit) => `${hit.file}:${hit.line} [${hit.words.join(", ")}] ${JSON.stringify(hit.literal)}`).join("\n");
    expect(
      hits.length,
      hits.length > PINNED_SITES
        ? `a domain word entered the routing path (${hits.length} sites, pinned ${PINNED_SITES}) — move it to data:\n${ledger}\n${listing}`
        : `the routing path dropped to ${hits.length} sites (pinned ${PINNED_SITES}) — lower PINNED_SITES in this change so the ledger reads per commit`,
    ).toBe(PINNED_SITES);
  });

  it("names every file in the path", () => {
    for (const file of ROUTING_PATH) expect(() => readFileSync(resolve(ROOT, file))).not.toThrow();
  });
});

describe("the literal scanner", () => {
  it("reads strings, templates and regexes, and never a comment", () => {
    const source = [
      "// pikachu in a line comment",
      "/* pikachu in a block",
      "   comment */",
      'const a = "pikachu";',
      "const b = `${x} pikachu`;",
      "const c = /\\bpikachu\\b/i;",
      "const d = 4 / 2 / 1;",
      "const e = 'quote \\' pikachu';",
    ].join("\n");
    const literals = literalsOf(source);
    expect(literals.map((literal) => [literal.line, literal.regex])).toEqual([
      [4, false],
      [5, false],
      [6, true],
      [8, false],
    ]);
    expect(literals[2]!.text).toBe("\\bpikachu\\b");
  });

  it("reads a regex as the words it can match", () => {
    expect(regexWords("\\b(pok[eé]mons?|species|legendar(?:y|ies))\\b").split(/\s+/).filter(Boolean)).toEqual([
      "pokemon",
      "species",
      "legendary",
      "legendaries",
    ]);
    expect(regexWords("counters?")).toBe("counter");
  });

  it("matches word-bounded, so a short id never fires inside a longer one", () => {
    const words = new Set(["mew", "red-blue", "electric"]);
    expect(domainHits("f", 'const a = "mewtwo";', words)).toEqual([]);
    expect(domainHits("f", 'const a = "the red-blue group";', words)[0]?.words).toEqual(["red-blue"]);
    expect(domainHits("f", 'const a = "`${type}-pokemon`";', words)).toEqual([]);
    expect(domainHits("f", "const a = /\\b(electric|fire)\\b/;", words)[0]?.words).toEqual(["electric"]);
  });
});
