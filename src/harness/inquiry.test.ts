/**
 * The inquiry bank is reviewed data, so the loader is where a wrong or drifted
 * entry is caught; and the expressibility pass is a number the findings quote,
 * so it is pinned here — a change to the bank or to the shape vocabulary that
 * moves the number has to move this file in the same change.
 */

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import { CLAIM_KINDS } from "./bank.js";
import {
  entryTier,
  expressibility,
  INQUIRY_BANK_PATH,
  type InquiryBank,
  type InquiryEntry,
  loadInquiryBank,
  readInquiryBank,
  renderExpressibility,
  RESOLVING,
  SHAPE_TIERS,
  SHAPES,
} from "./inquiry.js";
import { DISPOSITIONS } from "./playability.js";

const bank = readInquiryBank();

function first(draft: InquiryBank, disposition: InquiryEntry["disposition"]): InquiryEntry {
  const found = draft.entries.find((entry) => entry.disposition === disposition);
  if (found === undefined) throw new Error(`no ${disposition} entry in the bank`);
  return found;
}

function entry(draft: InquiryBank, index: number): InquiryEntry {
  const found = draft.entries[index];
  if (found === undefined) throw new Error(`no entry at ${index}`);
  return found;
}

function loadWith(sabotage: (draft: InquiryBank) => void): () => unknown {
  const draft = structuredClone(bank) as InquiryBank;
  sabotage(draft);
  return () => loadInquiryBank(draft);
}

describe("the shape vocabulary", () => {
  it("begins with the kernel's claim kinds, verbatim, all tier existing", () => {
    const existing = SHAPES.filter((shape) => shape.tier === "existing").map((shape) => shape.id);
    expect(existing).toEqual([...CLAIM_KINDS]);
  });

  it("names every demanded shape once, with a known tier and a summary", () => {
    const ids = SHAPES.map((shape) => shape.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shape of SHAPES) {
      expect(SHAPE_TIERS).toContain(shape.tier);
      expect(shape.summary.length).toBeGreaterThan(20);
    }
  });
});

describe("the shipped inquiry bank holds up", () => {
  it("loads from disk without a violation", () => {
    expect(() => readInquiryBank(INQUIRY_BANK_PATH)).not.toThrow();
  });

  it("is realistic in size and exercises every disposition", () => {
    expect(bank.entries.length).toBeGreaterThanOrEqual(100);
    const present = new Set(bank.entries.map((entry) => entry.disposition));
    for (const disposition of DISPOSITIONS) expect(present.has(disposition), `no entry for ${disposition}`).toBe(true);
  });

  it("declares a world whose species the current registry already certifies", () => {
    // Items are slice 3's to certify; species named beside them exist today,
    // so a typo in the bank's world is caught now rather than then.
    const { registry } = demoWorld();
    for (const id of bank.world.species) expect(registry.resolve(id, "pokedex-number").ok, `species ${id}`).toBe(true);
  });

  it("uses every demanded shape at least once — a shape nobody needs is a plan, not a demand", () => {
    const used = new Set(bank.entries.flatMap((entry) => entry.shapes ?? []));
    for (const shape of SHAPES) {
      if (shape.tier === "existing") continue;
      expect(used.has(shape.id), `shape ${shape.id} is defined but no entry demands it`).toBe(true);
    }
  });

  it("only names entities from its declared world", () => {
    const known = new Set([...bank.world.items, ...bank.world.species]);
    for (const entry of bank.entries) for (const entity of entry.entities ?? []) expect(known.has(entity), `${entry.id}: ${entity}`).toBe(true);
  });
});

describe("the expressibility pass", () => {
  const result = expressibility(bank);

  it("counts exactly the resolving dispositions", () => {
    const expected = bank.entries.filter((entry) => RESOLVING.includes(entry.disposition)).length;
    expect(result.resolving).toBe(expected);
    expect(Object.values(result.byTier).reduce((a, b) => a + b, 0)).toBe(expected);
  });

  it("lands an entry at the highest tier among its shapes", () => {
    expect(entryTier({ id: "x", question: "q", disposition: "answerable", shapes: ["fact"] })).toBe("existing");
    expect(entryTier({ id: "x", question: "q", disposition: "answerable", shapes: ["fact", "item-roster"] })).toBe("port");
    expect(entryTier({ id: "x", question: "q", disposition: "answerable", shapes: ["item-roster", "treats"] })).toBe("shape");
    expect(entryTier({ id: "x", question: "q", disposition: "answerable", shapes: ["arithmetic", "fact"] })).toBe("composition");
    expect(entryTier({ id: "x", question: "q", disposition: "off-domain" })).toBeUndefined();
  });

  // The numbers findings iteration 28 quotes. Moving the bank or the shape
  // vocabulary moves these, and the findings entry, in the same change.
  it("pins the filed numbers", () => {
    expect(result.resolving).toBe(98);
    expect(result.byTier).toEqual({ existing: 65, port: 12, shape: 18, composition: 3 });
    expect(Math.round(result.expressibleNow * 100)).toBe(66);
    expect(Math.round(result.expressibleWithPort * 100)).toBe(79);
    expect(result.demanded.map((demand) => [demand.shape.id, demand.entries])).toEqual([
      ["comparison", 10],
      ["item-roster", 9],
      ["treats", 9],
      ["item-action", 4],
      ["arithmetic", 3],
    ]);
    expect(result.ceilings.length).toBe(6);
  });

  it("renders as Markdown from the data", () => {
    const text = renderExpressibility(bank, result);
    expect(text).toContain("| **resolving total** | **98** |");
    expect(text).toContain("**Expressible now**");
    expect(text).toContain("`treats` (shape) — 9 entries");
    expect(text).toContain("Ceilings (no defined shape expresses these):");
  });

  it("renders a bank with nothing demanded and nothing ceilinged without those sections", () => {
    const tiny: InquiryBank = {
      bankVersion: 1,
      id: "tiny",
      world: { items: [], species: [], assumptions: ["none"] },
      entries: [{ id: "a", question: "q", disposition: "answerable", shapes: ["fact"] }],
    };
    const text = renderExpressibility(tiny);
    expect(text).toContain("1/1 (100%)");
    expect(text).not.toContain("Ceilings");
    expect(expressibility({ ...tiny, entries: [{ id: "o", question: "q", disposition: "off-domain" }] }).expressibleNow).toBe(0);
  });
});

describe("the loader refuses what would make the number lie", () => {
  const cases: [string, (draft: InquiryBank) => void, string][] = [
    ["a bank that is not an object", (draft) => Object.assign(draft, { entries: undefined }), "inquiry-malformed"],
    ["an unsupported schema", (draft) => Object.assign(draft, { bankVersion: 2 }), "inquiry-schema-unsupported"],
    ["no id", (draft) => Object.assign(draft, { id: "" }), "inquiry-malformed"],
    ["no world", (draft) => Object.assign(draft, { world: null }), "inquiry-world-malformed"],
    ["a world with no items", (draft) => Object.assign(draft.world, { items: undefined }), "inquiry-world-malformed"],
    ["a non-canonical item id", (draft) => Object.assign(draft.world, { items: [...draft.world.items, "Super Potion"] }), "inquiry-world-id-malformed"],
    ["a duplicated item id", (draft) => Object.assign(draft.world, { items: [...draft.world.items, "potion"] }), "inquiry-world-duplicate"],
    ["assumptions that are not statements", (draft) => Object.assign(draft.world, { assumptions: [""] }), "inquiry-world-malformed"],
    ["an entry with no id", (draft) => Object.assign(entry(draft, 0), { id: "" }), "inquiry-entry-unnamed"],
    ["two entries sharing an id", (draft) => Object.assign(entry(draft, 1), { id: entry(draft, 0).id }), "inquiry-duplicate-id"],
    ["an entry with no question", (draft) => Object.assign(entry(draft, 0), { question: " " }), "inquiry-entry-empty"],
    ["an unknown disposition", (draft) => Object.assign(entry(draft, 0), { disposition: "maybe" }), "inquiry-unknown-disposition"],
    ["a resolving entry with no shapes", (draft) => Object.assign(entry(draft, 0), { shapes: [] }), "inquiry-shapes-missing"],
    [
      "a ceiling that names a shape",
      (draft) => Object.assign(first(draft, "needs-claim-kind"), { shapes: ["fact"] }),
      "inquiry-shapes-unexpected",
    ],
    ["a shape nobody defined", (draft) => Object.assign(entry(draft, 0), { shapes: ["vibes"] }), "inquiry-shape-unknown"],
    [
      "a demand with no stated reason",
      (draft) => Object.assign(entry(draft, 0), { shapes: ["treats"], notes: "" }),
      "inquiry-demand-unstated",
    ],
    [
      "a ceiling with no stated reason",
      (draft) => Object.assign(first(draft, "needs-data"), { notes: "" }),
      "inquiry-ceiling-unstated",
    ],
    ["an entity outside the declared world", (draft) => Object.assign(entry(draft, 0), { entities: ["missingno"] }), "inquiry-entity-unknown"],
  ];

  for (const [name, sabotage, rule] of cases) {
    it(`refuses ${name} as ${rule}`, () => {
      expect(loadWith(sabotage)).toThrow(rule);
    });
  }

  it("refuses an unreadable file by name", () => {
    expect(() => readInquiryBank("/nonexistent/inquiries.json")).toThrow("inquiry-unreadable");
  });
});
