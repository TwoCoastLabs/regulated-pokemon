import { describe, expect, it } from "vitest";

import { kantoRegistry, readSnapshot, SNAPSHOT_PATH } from "../testing/fixtures.js";
import { loadRegistry, readRegistry, sameFactValue } from "./registry.js";
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
