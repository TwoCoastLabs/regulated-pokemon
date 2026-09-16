/**
 * The Center bank (epic #94, slice 3): the migrated realistic inquiries,
 * oracles attached — the validation the slice-0 entries deferred until a
 * world existed to validate against. Every oracle resolves against the
 * Center world's own registry and pack, and the scripted end-to-end leg runs
 * the real coverage machinery over it, key-free.
 */

import { describe, expect, it } from "vitest";

import { centerWorld } from "../demo/files.js";
import { CENTER_BANK_PATH, readBank } from "./bank.js";
import { type CoverageOptions, parseCoverageArgs, runCoverage } from "./coverage-live.js";
import { ScriptedProvider } from "./provider.js";
import { DISPOSITIONS } from "./playability.js";

const world = centerWorld();
const bank = readBank(CENTER_BANK_PATH);

describe("the migrated bank holds up against its own world", () => {
  it("loads, is the same size as the inquiry bank, and spans every disposition", () => {
    expect(bank.id).toBe("center-bank-v1");
    expect(bank.entries.length).toBe(125);
    const present = new Set(bank.entries.map((entry) => entry.disposition));
    for (const disposition of DISPOSITIONS) {
      if (disposition === "advisory" || disposition === "answerable" || disposition === "gated-advisory") {
        expect(present.has(disposition), disposition).toBe(true);
      }
    }
  });

  it("every subject oracle resolves against the Center registry", () => {
    for (const entry of bank.entries) {
      for (const want of entry.expectFacts ?? []) {
        const resolved = world.registry.resolve(want.entityId, want.factId ?? "item-effect");
        expect(resolved.ok, `${entry.id}: ${want.entityId}.${want.factId}`).toBe(true);
      }
    }
  });

  it("every routing oracle names a lesson the Center pack teaches", () => {
    const lessons = new Set(world.pack.curriculum.map((lesson) => lesson.id));
    for (const entry of bank.entries) {
      for (const blockId of entry.expectBlockIds ?? []) {
        expect(lessons.has(blockId), `${entry.id}: ${blockId}`).toBe(true);
      }
    }
  });

  it("gated entries hold their trainer under the gate they test", () => {
    for (const entry of bank.entries) {
      if (entry.disposition !== "gated-advisory" && entry.disposition !== "should-refuse") continue;
      expect(entry.profile.badgeLevel, entry.id).toBeLessThan(3);
    }
  });

  it("ranking entries establish the basis they rank by", () => {
    for (const entry of bank.entries) {
      if (!(entry.expectClaimKinds ?? []).includes("ranking")) continue;
      expect(entry.profile.comparisonBasis, `${entry.id} ranks with no established basis`).toBeDefined();
    }
  });
});

describe("--center runs the real machinery, scripted and key-free", () => {
  function clock(): () => string {
    let tick = 0;
    return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ++tick)).toISOString();
  }

  function options(argv: string[], reply: (ask: string) => string): CoverageOptions & { written: Map<string, string> } {
    const written = new Map<string, string>();
    return {
      argv,
      env: { OPENROUTER_API_KEY: "sk-or-test-secret-000" },
      now: "2026-02-01T00:00:00.000Z",
      clock,
      write: (path, contents) => written.set(path, contents),
      written,
      makeProvider: () =>
        new ScriptedProvider("center:scripted", (request) => {
          if (request.purpose !== "answer") return "decline";
          const ask = request.prompt.split("The trainer's own words:")[1]?.split("\n\n")[0] ?? "";
          return reply(ask);
        }),
    } as CoverageOptions & { written: Map<string, string> };
  }

  it("rejects the banks that belong to the other world", () => {
    expect(parseCoverageArgs(["--center", "--dialogues"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--center", "--phrasings"]).errors).toHaveLength(1);
    expect(parseCoverageArgs(["--center"]).errors).toHaveLength(0);
  });

  it("resolves a treats verdict and denies a controlled recommendation, against the Center pack", async () => {
    const reply = (ask: string): string => {
      if (/antidote on a burn/i.test(ask)) return JSON.stringify({ rosters: [], claims: [{ kind: "treats", itemId: "antidote", condition: "burn" }] });
      if (/protein/i.test(ask)) return JSON.stringify({ rosters: [], claims: [{ kind: "recommendation", entityId: "protein" }] });
      return "";
    };
    const opts = options(["--live", "--center", "--ids", "treats-antidote-burn,gated-protein"], reply);
    const result = await runCoverage(opts);
    // The artifact is the record: the certified negative resolves, the
    // controlled item is denied, and the world pins name the Center.
    const artifact = JSON.parse([...opts.written.values()][0] ?? "{}") as {
      world?: { packId?: string; snapshotId?: string };
      runs?: { entryId: string; stage: { kind: string }; score: { pass: boolean }; run: { detail: string } }[];
    };
    expect(artifact.world?.packId).toBe("pokemon-center-v4");
    expect(artifact.world?.snapshotId).toBe("kanto-center");
    const byId = new Map((artifact.runs ?? []).map((run) => [run.entryId, run]));
    expect(byId.get("treats-antidote-burn")?.stage.kind).toBe("resolved");
    expect(byId.get("treats-antidote-burn")?.score.pass).toBe(true);
    expect(byId.get("gated-protein")?.stage.kind).toBe("denied");
    expect(byId.get("gated-protein")?.score.pass).toBe(true); // a named denial passes a gated-advisory entry
    expect(result.exitCode).toBe(0);
  });
});

describe("the Center kinds through the propose-side layers, arm by arm", () => {
  it("decodes the grounded pair, a stated verdict, and refuses the malformed shapes", async () => {
    const { decodeAnswer } = await import("./decode.js");
    const { centerContext } = await import("../testing/fixtures.js");
    const context = centerContext();
    const decode = (claims: unknown[]) => decodeAnswer(JSON.stringify({ rosters: [], claims }), context, "txn-x");
    expect(decode([{ kind: "treats", itemId: "antidote", condition: "poison" }]).ok).toBe(true);
    expect(decode([{ kind: "treats", itemId: "antidote", condition: "burn", asserted: false }]).ok).toBe(true);
    expect(decode([{ kind: "treats", itemId: "antidote", condition: "burn", asserted: "no" }]).ok).toBe(false);
    expect(decode([{ kind: "treats", itemId: 7, condition: "burn" }]).ok).toBe(false);
    expect(decode([{ kind: "comparison", factId: "cost", leftId: "potion", rightId: "super-potion" }]).ok).toBe(true);
    expect(decode([{ kind: "comparison", factId: "cost", leftId: "potion" }]).ok).toBe(false);
  });

  it("folds the model's spellings of item names, on both kinds", async () => {
    const { canonicalizeClaims } = await import("./canonical.js");
    const folded = canonicalizeClaims(world.registry, [
      { kind: "treats", itemId: "Antidote", condition: "poison" },
      { kind: "comparison", factId: "cost", leftId: "Super Potion", rightId: "Potion" },
    ]);
    expect(folded[0]).toMatchObject({ itemId: "antidote" });
    expect(folded[1]).toMatchObject({ leftId: "super-potion", rightId: "potion" });
  });

  it("retrieves items by name and by the condition they treat, and grounds them in the reference", async () => {
    const { certifiedReference, retrievalSelection, retrieveReference } = await import("./reference.js");
    const byName = retrievalSelection(world.registry, "How much does a Potion heal?");
    expect(byName.items.has("potion")).toBe(true);
    const byCondition = retrievalSelection(world.registry, "what cures poison?");
    expect(byCondition.items.has("antidote")).toBe(true);
    expect(byCondition.items.has("full-heal")).toBe(true);
    const grounded = certifiedReference(world.registry);
    expect(grounded).toContain(
      "ITEMS  (id | category | cost | battle | overworld | cures | restores-hp | restores-pp | revives | repel-steps | catch | evolves | era-name | effect):",
    );
    expect(grounded).toContain("antidote | status-cures | 200 | yes | yes | poison");
    expect(retrieveReference(world.registry, "can I use an antidote on a burn")).toContain("antidote |");
    // The frozen world grounds exactly as before: no items, no items table.
    const { demoWorld } = await import("../demo/files.js");
    expect(certifiedReference(demoWorld().registry)).not.toContain("ITEMS ");
  });

  it("offers the Center kinds in the grammar only where items exist", async () => {
    const { answerSchema } = await import("./schema.js");
    const withItems = JSON.stringify(answerSchema(world.pack, undefined, true));
    const without = JSON.stringify(answerSchema(world.pack, undefined, false));
    expect(withItems).toContain('"treats"');
    expect(withItems).toContain('"comparison"');
    expect(without).not.toContain('"treats"');
    expect(without).not.toContain('"comparison"');
  });
});
