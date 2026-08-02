/**
 * The Accord pack is policy as data, so the loader is the place where a wrong
 * policy is caught. A rule that cites no real article, or triggers on an
 * entity the snapshot has never heard of, is worse than no rule: it looks like
 * enforcement and never fires.
 */

import { describe, expect, it } from "vitest";

import { ACCORD_ARTICLES } from "./accord.js";
import { type AccordPack, loadPack, MAX_BADGE_LEVEL, readPack, restrictionsFor } from "./pack.js";
import { denialCode } from "./violation.js";
import { kantoPack, kantoRegistry, PACK_PATH } from "../testing/fixtures.js";

const registry = kantoRegistry();
const pack = kantoPack();

function loadWith(sabotage: (draft: AccordPack) => void) {
  const draft = structuredClone(pack) as AccordPack;
  sabotage(draft);
  return loadPack(draft, registry);
}

function denials(result: ReturnType<typeof loadPack>): string[] {
  return result.ok ? [] : result.violations.map(denialCode);
}

describe("the shipped pack holds up", () => {
  it("loads from disk without a violation", () => {
    expect(() => readPack(PACK_PATH, registry)).not.toThrow();
  });

  it("cites only articles that exist in the registry", () => {
    // Same discipline accord.test.ts applies to the Accord document: a denial
    // that names an article nobody can look up is "blocked by policy" wearing
    // an identifier.
    const known = new Set<string>(ACCORD_ARTICLES.map((entry) => entry.id));
    for (const rule of [...pack.restrictions, ...pack.exhibits]) {
      expect(known.has(rule.article), `rule ${rule.id} cites ${rule.article}`).toBe(true);
    }
  });

  it("gates both kinds of rarity the snapshot distinguishes", () => {
    const mewtwo = registry.findSpecies("mewtwo");
    const mew = registry.findSpecies("mew");
    const pikachu = registry.findSpecies("pikachu");
    expect(mewtwo && restrictionsFor(pack, mewtwo).map((rule) => rule.id)).toEqual(["legendary-acquisition"]);
    expect(mew && restrictionsFor(pack, mew).map((rule) => rule.id)).toEqual(["mythical-acquisition"]);
    expect(pikachu && restrictionsFor(pack, pikachu)).toEqual([]);
  });

  it("requires visible text of every exhibit it demands", () => {
    for (const rule of pack.exhibits) {
      expect(rule.requiredFragments.length, `${rule.id} requires no text`).toBeGreaterThan(0);
    }
  });
});

describe("a pack that cannot be trusted is refused by name", () => {
  it("refuses a pack that is not an object", () => {
    expect(denials(loadPack("v1", registry))).toEqual(["IA-5/pack-malformed"]);
    expect(denials(loadPack(null, registry))).toEqual(["IA-5/pack-malformed"]);
  });

  it("refuses a schema version the kernel does not know how to read", () => {
    expect(denials(loadWith((draft) => ((draft as { packVersion: number }).packVersion = 2)))).toEqual([
      "IA-5/pack-schema-unsupported",
    ]);
  });

  it("refuses a pack with no id, or with no rule tables", () => {
    expect(denials(loadWith((draft) => ((draft as { id: string }).id = "")))).toEqual(["IA-5/pack-malformed"]);
    expect(
      denials(loadWith((draft) => ((draft as { restrictions: unknown }).restrictions = undefined))),
    ).toEqual(["IA-5/pack-malformed"]);
  });

  it("refuses a rule citing an article that does not exist", () => {
    expect(
      denials(loadWith((draft) => ((draft.restrictions[0] as { article: string }).article = "IA-99"))),
    ).toContain("IA-5/pack-unknown-article");
  });

  it("refuses two rules sharing one id", () => {
    expect(
      denials(loadWith((draft) => (draft.restrictions as unknown[]).push({ ...draft.restrictions[0] }))),
    ).toContain("IA-5/pack-duplicate-rule");
  });

  it("refuses a threshold no trainer could ever meet", () => {
    // A gate set above the top of the badge scale is not strict, it is broken:
    // it denies every trainer including the ones the League accredited.
    expect(
      denials(
        loadWith(
          (draft) => ((draft.restrictions[0] as { minimumBadgeLevel: number }).minimumBadgeLevel = MAX_BADGE_LEVEL + 1),
        ),
      ),
    ).toContain("IA-5/pack-threshold-unreachable");
    expect(
      denials(loadWith((draft) => ((draft.restrictions[0] as { minimumBadgeLevel: number }).minimumBadgeLevel = -1))),
    ).toContain("IA-5/pack-threshold-unreachable");
  });

  it("refuses a disclosure that requires no visible text", () => {
    expect(
      denials(
        loadWith((draft) => ((draft.exhibits[0] as unknown as { requiredFragments: string[] }).requiredFragments = [])),
      ),
    ).toContain("IA-6/pack-exhibit-without-fragments");
  });

  it("refuses a disclosure triggered by an entity the snapshot never certified", () => {
    // The silent-ceiling failure: the rule reads like enforcement and can
    // never fire, so the disclosure is simply never required.
    expect(
      denials(
        loadWith((draft) => {
          (draft.exhibits[0] as { when: unknown }).when = { kind: "entity-claimed", entityId: "hyper-fang-blast" };
        }),
      ),
    ).toContain("IA-3/pack-dangling-entity");
  });

  it("throws with named violations when read from an unreadable path", () => {
    expect(() => readPack(`${PACK_PATH}.missing`, registry)).toThrow("IA-5/pack-unreadable");
  });
});
