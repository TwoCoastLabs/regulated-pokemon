/**
 * The Center world's items (epic #94, slice 3): the registry's item facts,
 * and the load-time half of the extraction crucible — a fabricated or
 * internally inconsistent certification refused by name before anything can
 * resolve against it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { SnapshotDocument } from "./snapshot-format.js";
import { ITEM_FACT_IDS, loadRegistry } from "./registry.js";
import { denialCode } from "./violation.js";

const CENTER_PATH = resolve(import.meta.dirname, "../../data/snapshots/kanto-center.json");

function centerDocument(): SnapshotDocument {
  return JSON.parse(readFileSync(CENTER_PATH, "utf8")) as SnapshotDocument;
}

function registryOf(document: SnapshotDocument) {
  const loaded = loadRegistry(document);
  if (!loaded.ok) throw new Error(loaded.violations.map(denialCode).join(", "));
  return loaded.value;
}

function refusals(sabotage: (draft: SnapshotDocument) => void): string[] {
  const draft = centerDocument();
  sabotage(draft);
  const loaded = loadRegistry(draft);
  return loaded.ok ? [] : loaded.violations.map(denialCode);
}

describe("the vendored Center world", () => {
  const registry = registryOf(centerDocument());

  it("loads, and carries every item the inquiry bank's world declares", () => {
    const bank = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../data/playability/center-inquiries.v1.json"), "utf8"),
    ) as { world: { items: readonly string[] } };
    const carried = new Set(registry.itemIds);
    for (const id of bank.world.items) expect(carried.has(id), `bank declares ${id}`).toBe(true);
  });

  it("resolves the certified era facts, and refuses the eras' gaps by name", () => {
    expect(registry.resolve("potion", "restores-hp")).toEqual({ ok: true, value: { kind: "number", value: 20 } });
    expect(registry.resolve("max-potion", "restores-hp")).toEqual({ ok: true, value: { kind: "text", value: "full" } });
    expect(registry.resolve("antidote", "cures")).toEqual({ ok: true, value: { kind: "list", value: ["poison"] } });
    expect(registry.resolve("full-heal", "cures")).toMatchObject({ ok: true });
    expect(registry.resolve("revive", "revives")).toEqual({ ok: true, value: { kind: "text", value: "half" } });
    expect(registry.resolve("repel", "repel-steps")).toEqual({ ok: true, value: { kind: "number", value: 100 } });
    expect(registry.resolve("ultra-ball", "catch-rate-multiplier")).toEqual({ ok: true, value: { kind: "number", value: 2 } });
    expect(registry.resolve("master-ball", "always-catches")).toEqual({ ok: true, value: { kind: "boolean", value: true } });
    // Generation I's Safari Zone had its own mechanics: the multiplier is
    // certified absent, which is a certification, not a gap.
    expect(registry.resolve("safari-ball", "catch-rate-multiplier")).toEqual({ ok: true, value: { kind: "absent" } });
    expect(registry.resolve("thunder-stone", "evolves")).toMatchObject({
      ok: true,
      value: { kind: "list", value: ["eevee into jolteon", "pikachu into raichu"] },
    });
    expect(registry.resolve("x-sp-atk", "era-name")).toEqual({ ok: true, value: { kind: "text", value: "X Special" } });
    expect(registry.resolve("potion", "cost")).toEqual({ ok: true, value: { kind: "number", value: 200 } });
    expect(registry.resolve("potion", "usable-in-battle")).toEqual({ ok: true, value: { kind: "boolean", value: true } });
  });

  it("refuses an uncertified item fact and a fabricated item exactly as species facts are refused", () => {
    const wrongFact = registry.resolve("potion", "base-speed");
    expect(!wrongFact.ok && wrongFact.violations.map(denialCode)).toContain("IA-2/uncertified-fact");
    const fabricated = registry.resolve("masterball-plus", "cost");
    expect(!fabricated.ok && fabricated.violations.map(denialCode)).toContain("IA-3/fabricated-entity");
  });

  it("declares era fidelity for every item surface — a new fact family cannot land silently", () => {
    const fidelity = centerDocument().source.fidelity;
    for (const surface of ITEM_FACT_IDS) {
      expect(fidelity[surface], `no fidelity for ${surface}`).toBeDefined();
    }
    expect(fidelity["catch-rate-multiplier"]).toBe("era-restricted");
    expect(fidelity["item-effect"]).toBe("modern-values");
  });

  it("the frozen kanto-red-blue world neither carries items nor owes their fidelity", () => {
    const frozen = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../data/snapshots/kanto-red-blue.json"), "utf8"),
    ) as SnapshotDocument;
    expect(frozen.items).toBeUndefined();
    const loaded = loadRegistry(frozen);
    expect(loaded.ok).toBe(true);
    expect(frozen.source.fidelity["cures"]).toBeUndefined();
  });
});

describe("the extraction crucible, load-time half", () => {
  it("refuses a duplicated item", () => {
    expect(refusals((draft) => ((draft as unknown as { items: unknown[] }).items.push(draft.items![0]!)))).toContain("IA-2/item-duplicated");
  });

  it("refuses an item with no reviewed extraction", () => {
    expect(refusals((draft) => (((draft.items as unknown as unknown[])[0] as { certified: unknown }).certified = null))).toContain(
      "IA-2/item-uncertified",
    );
  });

  it("refuses a cure outside the closed condition vocabulary", () => {
    expect(
      refusals((draft) => {
        const antidote = (draft.items as unknown as { id: string; certified: { cures?: string[] } }[]).find((item) => item.id === "antidote");
        antidote!.certified.cures = ["poison", "sadness"];
      }),
    ).toContain("IA-2/item-cure-unknown");
  });

  it("refuses an evolution the species records do not support with this stone", () => {
    expect(
      refusals((draft) => {
        const stone = (draft.items as unknown as { id: string; certified: { evolves?: { from: string; to: string }[] } }[]).find(
          (item) => item.id === "thunder-stone",
        );
        stone!.certified.evolves = [...(stone!.certified.evolves ?? []), { from: "snorlax", to: "raichu" }];
      }),
    ).toContain("IA-2/item-evolution-unsupported");
  });

  it("refuses an item id colliding with another certified entity", () => {
    expect(
      refusals((draft) => {
        (draft.items as unknown as { id: string }[])[0]!.id = "pikachu";
      }),
    ).toContain("IA-2/item-id-collides");
  });

  it("refuses an empty items block — a world with a shelf and nothing on it", () => {
    expect(refusals((draft) => ((draft as unknown as { items: unknown[] }).items = []))).toContain("IA-2/items-empty");
  });

  it("refuses a doctored certification digest exactly as any content edit", () => {
    expect(
      refusals((draft) => {
        const potion = (draft.items as unknown as { id: string; certified: { restoresHp?: number | string } }[]).find((item) => item.id === "potion");
        potion!.certified.restoresHp = 999;
      }),
    ).toContain("IA-2/snapshot-digest-mismatch");
  });
});
