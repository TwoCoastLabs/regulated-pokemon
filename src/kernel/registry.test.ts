import { describe, expect, it } from "vitest";

import { centerRegistry, kantoRegistry, readSnapshot, SNAPSHOT_PATH } from "../testing/fixtures.js";
import { readRegistry } from "./files.js";
import { COMPARABLE_FACT_IDS, fidelitySurfaces, ITEM_FACT_IDS, loadRegistry, MOVE_FACT_IDS, sameFactValue, SPECIES_FACT_IDS } from "./registry.js";
import { denialCode } from "./violation.js";

describe("the vendored snapshot loads as a certified registry", () => {
  it("validates and exposes its provenance", () => {
    const registry = readRegistry(SNAPSHOT_PATH);
    expect(registry.snapshot.id).toBe("kanto-red-blue");
    expect(registry.snapshot.sourceRepository).toBe("https://github.com/PokeAPI/api-data");
    expect(registry.snapshot.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(registry.species).toHaveLength(151);
  });

  it("declares the limits of its own certification", () => {
    const { caveats } = kantoRegistry().document.source;
    expect(caveats.length).toBeGreaterThan(0);
    expect(caveats.join(" ")).toContain("Base stats are NOT version-pinned");
  });
});

describe("facts resolve only from the snapshot", () => {
  const registry = kantoRegistry();

  it("resolves species facts pinned to Red/Blue", () => {
    expect(registry.resolve("pikachu", "base-speed")).toEqual({ ok: true, value: { kind: "number", value: 90 } });
    expect(registry.resolve("pikachu", "pokedex-number")).toEqual({ ok: true, value: { kind: "number", value: 25 } });
    // Magnemite gained Steel in generation II; this snapshot is generation I.
    expect(registry.resolve("magnemite", "types")).toEqual({
      ok: true,
      value: { kind: "list", value: ["electric"] },
    });
    // Clefairy became Fairy in generation VI, and Mew is filed as mythical.
    expect(registry.resolve("clefairy", "types")).toEqual({ ok: true, value: { kind: "list", value: ["normal"] } });
    expect(registry.resolve("mew", "is-mythical")).toEqual({ ok: true, value: { kind: "boolean", value: true } });
    expect(registry.resolve("mew", "is-legendary")).toEqual({ ok: true, value: { kind: "boolean", value: false } });
  });

  it("resolves move facts at their Red/Blue values", () => {
    // Selfdestruct was 130 power until generation III raised it to 200.
    expect(registry.resolve("self-destruct", "move-power")).toEqual({
      ok: true,
      value: { kind: "number", value: 130 },
    });
    expect(registry.resolve("explosion", "move-power")).toEqual({ ok: true, value: { kind: "number", value: 170 } });
    expect(registry.resolve("self-destruct", "move-effect")).toEqual({
      ok: true,
      value: { kind: "text", value: "User faints." },
    });
  });

  it("reports a genuinely absent value as certified, not as unknown", () => {
    // Growl deals no damage: "no power" is a fact, and it is not the same
    // answer as "this snapshot does not certify power".
    expect(registry.resolve("growl", "move-power")).toEqual({ ok: true, value: { kind: "absent" } });
    const uncertified = registry.resolve("growl", "catch-rate");
    expect(uncertified.ok).toBe(false);
    expect(uncertified.ok === false && denialCode(uncertified.violations[0]!)).toBe("IA-2/uncertified-fact");
  });

  it("refuses an entity the snapshot does not certify", () => {
    const result = registry.resolve("missingno", "base-speed");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(denialCode(result.violations[0]!)).toBe("IA-3/fabricated-entity");
    expect(result.violations[0]!.message).toContain("missingno");
  });

  it("refuses a fact id outside the approved vocabulary", () => {
    const result = registry.resolve("pikachu", "cuteness");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(denialCode(result.violations[0]!)).toBe("IA-2/uncertified-fact");
    expect(result.violations[0]!.expected).toContain("base-speed");
  });

  it("computes base-stat-total deterministically from bound facts", () => {
    const total = registry.resolve("pikachu", "base-stat-total");
    expect(total).toEqual({ ok: true, value: { kind: "number", value: 320 } });
  });
});

describe("fact value comparison", () => {
  it("distinguishes kind, order, and absence", () => {
    expect(sameFactValue({ kind: "number", value: 1 }, { kind: "number", value: 1 })).toBe(true);
    expect(sameFactValue({ kind: "number", value: 1 }, { kind: "text", value: "1" })).toBe(false);
    expect(sameFactValue({ kind: "absent" }, { kind: "absent" })).toBe(true);
    expect(sameFactValue({ kind: "absent" }, { kind: "number", value: 0 })).toBe(false);
    expect(sameFactValue({ kind: "list", value: ["a", "b"] }, { kind: "list", value: ["b", "a"] })).toBe(false);
    expect(sameFactValue({ kind: "list", value: ["a"] }, { kind: "list", value: ["a", "b"] })).toBe(false);
  });
});

describe("a snapshot that cannot be trusted is refused at load", () => {
  it("refuses an unsupported schema version", () => {
    const document = readSnapshot();
    document.schemaVersion = 99 as never;
    const loaded = loadRegistry(document);
    expect(loaded.ok).toBe(false);
    expect(loaded.ok === false && denialCode(loaded.violations[0]!)).toBe("IA-2/snapshot-schema-unsupported");
  });

  it("refuses a document that is not a snapshot at all", () => {
    for (const input of [null, 42, "kanto", {}]) {
      const loaded = loadRegistry(input);
      expect(loaded.ok).toBe(false);
      expect(loaded.ok === false && loaded.violations[0]!.article).toBe("IA-2");
    }
  });

  it("refuses an unreadable file by name rather than crashing", () => {
    expect(() => readRegistry("/nonexistent/kanto.json")).toThrow("IA-2/snapshot-unreadable");
  });
});

describe("era fidelity is declared, closed, and pinned (epic #87, slice 3)", () => {
  const doctored = (sabotage: (document: ReturnType<typeof readSnapshot>) => void): string[] => {
    const document = structuredClone(readSnapshot());
    sabotage(document);
    const loaded = loadRegistry(document);
    return loaded.ok ? [] : loaded.violations.map(denialCode);
  };

  it("refuses a snapshot with no fidelity declaration at all", () => {
    expect(doctored((document) => delete (document.source as { fidelity?: unknown }).fidelity)).toContain(
      "IA-2/fidelity-undeclared",
    );
  });

  it("refuses a certified surface with no declared fidelity", () => {
    expect(
      doctored((document) => delete (document.source.fidelity as Record<string, unknown>)["base-speed"]),
    ).toContain("IA-2/fidelity-surface-undeclared");
  });

  it("refuses a declaration for a surface the registry does not certify", () => {
    expect(
      doctored((document) => ((document.source.fidelity as Record<string, unknown>)["catch-rate"] = "era-true")),
    ).toContain("IA-2/fidelity-surface-unknown");
  });

  it("refuses a fidelity class the schema does not know", () => {
    expect(
      doctored((document) => ((document.source.fidelity as Record<string, unknown>)["base-speed"] = "probably-fine")),
    ).toContain("IA-2/fidelity-class-unknown");
  });

  it("the declaration covers every certified surface, exactly", () => {
    const declared = Object.keys(readSnapshot().source.fidelity).sort();
    expect(declared).toEqual(fidelitySurfaces());
  });

  it("pins the reviewed classifications: stats are modern values, the era-pinned surfaces say so", () => {
    // These are reviewed data, like a bank retag: changing one is a conscious
    // provenance decision, not a drive-by. Base stats are present-day upstream
    // values under an era-named snapshot — the boundary this declaration
    // exists to state (base-stat-total 540 for Snorlax is this snapshot's
    // truth; the 1996 cartridge's was 430).
    const fidelity = readSnapshot().source.fidelity;
    for (const stat of ["base-hp", "base-attack", "base-defense", "base-special-attack", "base-special-defense", "base-speed", "base-stat-total"]) {
      expect(fidelity[stat], stat).toBe("modern-values");
    }
    expect(fidelity["move-damage-class"]).toBe("modern-values");
    expect(fidelity["move-effect"]).toBe("modern-values");
    for (const pinned of ["types", "type-chart", "learnset", "machine", "locations", "move-power", "move-accuracy", "move-pp", "move-type"]) {
      expect(fidelity[pinned], pinned).toBe("era-true");
    }
    expect(fidelity["evolves-to"]).toBe("era-restricted");
  });
});

describe("the chart is complete and closed before anything derives from it", () => {
  const registry = kantoRegistry();
  const doctored = (sabotage: (document: ReturnType<typeof readSnapshot>) => void): string[] => {
    const document = structuredClone(registry.document) as ReturnType<typeof readSnapshot>;
    sabotage(document);
    const loaded = loadRegistry(document);
    return loaded.ok ? [] : loaded.violations.map(denialCode);
  };

  it("exposes the vendored chart and its cells", () => {
    expect(registry.typeChart.types).toHaveLength(15);
    expect(registry.multiplier("water", "fire")).toBe(2);
    // A cell for a type the chart does not close over is undefined, never 1.
    expect(registry.multiplier("fairy", "fire")).toBeUndefined();
  });

  it("refuses a snapshot with no chart at all", () => {
    expect(doctored((document) => {
      delete (document as { typeChart?: unknown }).typeChart;
    })).toContain("IA-2/snapshot-malformed");
  });

  it("refuses a chart that closes over no types, or lists one twice", () => {
    expect(doctored((document) => {
      (document.typeChart as unknown as { types: string[] }).types = [];
    })).toContain("IA-2/chart-empty");
    expect(doctored((document) => {
      (document.typeChart as unknown as { types: string[] }).types = [...document.typeChart.types, "water"];
    })).toContain("IA-2/chart-duplicate-type");
  });

  it("refuses rows and cells outside the closed set", () => {
    expect(doctored((document) => {
      (document.typeChart.multipliers as Record<string, Record<string, number>>)["fairy"] = { water: 1 };
    })).toContain("IA-2/chart-unclosed");
    expect(doctored((document) => {
      (document.typeChart.multipliers as Record<string, Record<string, number>>)["water"]!["fairy"] = 2;
    })).toContain("IA-2/chart-unclosed");
    expect(doctored((document) => {
      delete (document.typeChart.multipliers as Record<string, Record<string, number>>)["water"];
    })).toContain("IA-2/chart-incomplete");
  });

  it("refuses a move typed outside the generation's chart", () => {
    expect(doctored((document) => {
      (document.moves[0] as { type: string }).type = "fairy";
    })).toContain("IA-3/dangling-type-reference");
  });
});

describe("the grown world (schema v3): evolutions, encounters, machines", () => {
  const registry = kantoRegistry();

  it("resolves evolution facts, edges restricted to the certified world", () => {
    // Pichu does not exist here, so Pikachu is a root — absence is certified.
    expect(registry.resolve("pikachu", "evolves-from")).toEqual({ ok: true, value: { kind: "absent" } });
    expect(registry.resolve("pikachu", "evolves-to")).toEqual({ ok: true, value: { kind: "list", value: ["raichu"] } });
    expect(registry.resolve("pikachu", "evolution-methods")).toEqual({
      ok: true,
      value: { kind: "list", value: ["raichu via thunder-stone"] },
    });
    expect(registry.resolve("charmander", "evolution-methods")).toEqual({
      ok: true,
      value: { kind: "list", value: ["charmeleon via level 16"] },
    });
    expect(registry.resolve("golem", "evolves-from")).toEqual({ ok: true, value: { kind: "text", value: "graveler" } });
    // Eevee keeps its three gen-I stones and gains nothing from the future.
    expect(registry.resolve("eevee", "evolves-to")).toEqual({
      ok: true,
      value: { kind: "list", value: ["vaporeon", "jolteon", "flareon"] },
    });
    expect(registry.resolve("mewtwo", "evolves-to")).toEqual({ ok: true, value: { kind: "absent" } });
  });

  it("resolves presence-only locations, with certified absence for Mew", () => {
    const abra = registry.resolve("abra", "locations");
    expect(abra.ok && abra.value.kind === "list" && abra.value.value).toContain("kanto-route-24-area");
    // Event-only: nowhere in either cartridge, and "none" is the honest answer.
    expect(registry.resolve("mew", "locations")).toEqual({ ok: true, value: { kind: "absent" } });
  });

  it("resolves the TM/HM that teaches a move, or certified absence", () => {
    expect(registry.resolve("surf", "machine")).toEqual({ ok: true, value: { kind: "text", value: "hm03" } });
    expect(registry.resolve("thunderbolt", "machine")).toEqual({ ok: true, value: { kind: "text", value: "tm24" } });
    expect(registry.resolve("tackle", "machine")).toEqual({ ok: true, value: { kind: "absent" } });
  });
});

describe("COMPARABLE_FACT_IDS is exactly the numeric-capable vocabulary", () => {
  // The curated list a comparison may range over, pinned in both directions
  // against every entity of both bundled worlds: every listed id resolves to
  // a number for at least one entity somewhere, and no unlisted id ever does.
  // If a fact's resolver changes kind, this fails until the list moves in the
  // same commit — the same discipline FACT_IDS keeps with the registry.
  const worlds = [kantoRegistry(), centerRegistry()];
  const allFactIds = [...SPECIES_FACT_IDS, ...MOVE_FACT_IDS, ...ITEM_FACT_IDS];

  function resolvesNumericSomewhere(factId: string): boolean {
    return worlds.some((registry) =>
      [...registry.speciesIds, ...registry.moveIds, ...registry.items.map((item) => item.id)].some((entityId) => {
        const resolved = registry.resolve(entityId, factId);
        return resolved.ok && resolved.value.kind === "number";
      }),
    );
  }

  it("every listed id can be a number, and every id that can be a number is listed", () => {
    const numeric = allFactIds.filter(resolvesNumericSomewhere).sort();
    expect([...COMPARABLE_FACT_IDS]).toEqual(numeric);
  });

  it("membership means can-be, not always-is — the runtime incomparable gate stays reachable", () => {
    const center = centerRegistry();
    // A Full Restore's restores-hp is the text "full": listed id, non-numeric
    // value, so IA-2/incomparable-fact still has real work.
    const resolved = center.resolve("full-restore", "restores-hp");
    expect(resolved.ok && resolved.value.kind).toBe("text");
    expect(COMPARABLE_FACT_IDS).toContain("restores-hp");
  });
});
