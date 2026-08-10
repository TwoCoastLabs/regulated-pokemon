/**
 * The Accord pack is policy as data, so the loader is the place where a wrong
 * policy is caught. A rule that cites no real article, or triggers on an
 * entity the snapshot has never heard of, is worse than no rule: it looks like
 * enforcement and never fires.
 */

import { describe, expect, it } from "vitest";

import { ACCORD_ARTICLES } from "./accord.js";
import { digestText } from "./digest.js";
import { formatCarriesLocale } from "./format.js";
import { readPack } from "./files.js";
import { type AccordPack, blockFor, loadPack, MAX_BADGE_LEVEL, restrictionsFor } from "./pack.js";
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

  it("carries approved, self-naming text for every exhibit in every locale", () => {
    for (const rule of pack.exhibits) {
      for (const locale of pack.presentation.locales) {
        const content = blockFor(rule, locale);
        expect(content, `${rule.id} says nothing in ${locale}`).toBeDefined();
        // The digest is the block's identity, carried into every manifest that
        // owes it. A block whose digest does not name its own words would let
        // an id drift away from the sentence it stands for.
        expect(content && digestText(content.text), `${rule.id} misnames its ${locale} text`).toBe(content?.digest);
      }
    }
  });

  it("approves only formats this kernel can render in every approved locale", () => {
    for (const formatId of pack.presentation.formats) {
      for (const locale of pack.presentation.locales) {
        expect(formatCarriesLocale(formatId, locale), `${formatId} cannot render ${locale}`).toBe(true);
      }
    }
  });
});

describe("a pack that cannot be trusted is refused by name", () => {
  it("refuses a pack that is not an object", () => {
    expect(denials(loadPack("v1", registry))).toEqual(["IA-5/pack-malformed"]);
    expect(denials(loadPack(null, registry))).toEqual(["IA-5/pack-malformed"]);
  });

  it("refuses a schema version the kernel does not know how to read", () => {
    expect(denials(loadWith((draft) => ((draft as { packVersion: number }).packVersion = 99)))).toEqual([
      "IA-5/pack-schema-unsupported",
    ]);
    // The schema before the approved vocabulary existed is not readable now:
    // a pack that declares no vocabulary would establish no scope and say
    // nothing about it.
    expect(denials(loadWith((draft) => ((draft as { packVersion: number }).packVersion = 1)))).toEqual([
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

  it("refuses a disclosure whose text says nothing", () => {
    expect(denials(loadWith((draft) => ((draft.exhibits[0]!.block.content[0] as { text: string }).text = "  ")))).toContain(
      "IA-6/pack-block-empty",
    );
  });

  it("refuses a disclosure whose digest does not name its own text", () => {
    // The whole point of carrying the digest: a block id that has drifted away
    // from its words would be a manifest owing one disclosure and a page
    // showing another, with both sides internally consistent.
    expect(
      denials(loadWith((draft) => ((draft.exhibits[0]!.block.content[0] as { text: string }).text += " Probably."))),
    ).toContain("IA-6/pack-block-digest-mismatch");
  });

  it("refuses a disclosure with no approved text in a locale the pack sells", () => {
    expect(
      denials(loadWith((draft) => ((draft.exhibits[0] as unknown as { block: { content: unknown[] } }).block.content.length = 1))),
    ).toContain("IA-6/pack-block-locale-missing");
  });

  it("refuses a locale no formatter in this kernel can render", () => {
    const refused = denials(loadWith((draft) => (draft.presentation as unknown as { locales: string[] }).locales.push("de-DE")));
    expect(refused).toContain("IA-6/pack-locale-unimplemented");
  });

  it("refuses a format this kernel does not implement", () => {
    expect(
      denials(loadWith((draft) => (draft.presentation as unknown as { formats: string[] }).formats.push("free-text"))),
    ).toContain("IA-6/pack-format-unknown");
  });

  it("refuses a catalogue entry that is missing in one approved locale", () => {
    expect(
      denials(
        loadWith((draft) => {
          delete (draft.presentation.catalogue[0] as { text: Record<string, string> }).text["en-GB"];
        }),
      ),
    ).toContain("IA-6/pack-copy-incomplete");
  });

  it("refuses a pack that says nothing about how an answer may be presented", () => {
    expect(
      denials(loadWith((draft) => delete (draft as { presentation?: unknown }).presentation)),
    ).toEqual(["IA-6/pack-presentation-missing"]);
  });

  it("refuses a pack that approves no locale or no format at all", () => {
    // Both are rules that can never fire, and the failure mode is the worst
    // kind: nothing could ever be presented, and nothing would say why.
    expect(denials(loadWith((draft) => ((draft.presentation as unknown as { locales: string[] }).locales = [])))).toContain(
      "IA-6/pack-no-locale",
    );
    expect(denials(loadWith((draft) => ((draft.presentation as unknown as { formats: string[] }).formats = [])))).toContain(
      "IA-6/pack-no-format",
    );
  });

  it("refuses a catalogue that carries one id twice", () => {
    expect(
      denials(
        loadWith((draft) => {
          const catalogue = draft.presentation.catalogue as unknown as unknown[];
          catalogue.push(catalogue[0]);
        }),
      ),
    ).toContain("IA-6/pack-copy-duplicated");
  });

  it("refuses a disclosure block with no usable version", () => {
    expect(denials(loadWith((draft) => ((draft.exhibits[0]!.block as { version: number }).version = 0)))).toContain(
      "IA-6/pack-block-unversioned",
    );
  });

  it("refuses an exhibit with no disclosure block at all", () => {
    expect(denials(loadWith((draft) => delete (draft.exhibits[0] as { block?: unknown }).block))).toContain(
      "IA-6/pack-block-missing",
    );
  });

  it("refuses a translation for a locale the pack never approved", () => {
    expect(
      denials(
        loadWith((draft) => {
          const content = draft.exhibits[0]!.block.content as unknown as Array<{ locale: string }>;
          content.push({ ...content[0]!, locale: "fr-FR" });
        }),
      ),
    ).toContain("IA-6/pack-block-locale-unapproved");
  });

  it("refuses an exhibit slot reading a source the kernel has never heard of", () => {
    expect(
      denials(
        loadWith((draft) => {
          const provenance = draft.exhibits.find((rule) => rule.id === "provenance")!;
          (provenance.slots as unknown as Array<{ source: string }>)[0]!.source = "trainer-name";
        }),
      ),
    ).toContain("IA-6/pack-slot-source-unknown");
  });

  it("refuses an exhibit that declares one slot name twice", () => {
    expect(
      denials(
        loadWith((draft) => {
          const provenance = draft.exhibits.find((rule) => rule.id === "provenance")!;
          const slots = provenance.slots as unknown as unknown[];
          slots.push(slots[0]);
        }),
      ),
    ).toContain("IA-6/pack-slot-name-unusable");
  });

  it("refuses an exhibit slot presented by a format the pack does not approve", () => {
    expect(
      denials(
        loadWith((draft) => {
          (draft.presentation as unknown as { formats: string[] }).formats = ["integer"];
        }),
      ),
    ).toContain("IA-6/pack-slot-format-unapproved");
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

describe("the action registry is closed, and every irreversible act discloses", () => {
  it("refuses a pack that never decided which acts exist", () => {
    // An empty list is a coherent policy — an Advisor that may say things and
    // do nothing. A missing one means every act is one nobody approved.
    expect(denials(loadWith((draft) => delete (draft as { actions?: unknown }).actions))).toEqual([
      "IA-7/pack-actions-missing",
    ]);
    // Emptying it is coherent only if nothing still refers to an act, which
    // the shipped pack does: the consent notice would be left disclosing
    // something the registry no longer contains.
    expect(denials(loadWith((draft) => ((draft as unknown as { actions: unknown[] }).actions = [])))).toEqual([
      "IA-7/pack-dangling-action",
    ]);
  });

  it("refuses an action registry that declares one act twice or unnamed", () => {
    expect(
      denials(
        loadWith((draft) => {
          (draft.actions as unknown as unknown[]).push({ id: "release", irreversible: false });
        }),
      ),
    ).toContain("IA-7/pack-action-unusable");
  });

  it("refuses an act that does not say whether it can be taken back", () => {
    expect(
      denials(
        loadWith((draft) => {
          delete (draft.actions[0] as { irreversible?: boolean }).irreversible;
        }),
      ),
    ).toContain("IA-9/pack-action-reversibility-unstated");
  });

  it("refuses a disclosure triggered by an act the registry does not declare", () => {
    expect(
      denials(
        loadWith((draft) => {
          (draft.exhibits.find((rule) => rule.id === "release-irreversibility") as { when: unknown }).when = {
            kind: "action-claimed",
            tool: "trade-away",
          };
        }),
      ),
    ).toContain("IA-7/pack-dangling-action");
  });

  it("refuses an irreversible act with nothing attached to disclose it", () => {
    // The load-time half of Article IX. Consent to something the trainer was
    // never going to be told about is not consent, and the moment to catch
    // that is before any answer is compiled against this pack.
    expect(
      denials(
        loadWith((draft) => {
          (draft as unknown as { exhibits: unknown[] }).exhibits = draft.exhibits.filter(
            (rule) => rule.when.kind !== "action-claimed",
          );
        }),
      ),
    ).toEqual(["IA-9/pack-irreversible-undisclosed"]);
  });

  it("refuses a rule that reads the acted-on species and no act triggers", () => {
    expect(
      denials(
        loadWith((draft) => {
          (draft.exhibits.find((rule) => rule.id === "release-irreversibility") as { when: unknown }).when = {
            kind: "always",
          };
        }),
      ),
    ).toContain("IA-6/pack-slot-source-unavailable");
  });
});
