/**
 * The sabotage page's whole spine, run headless: the same world the app
 * builds in the browser — `loadDemoWorld` over the vendored bytes, the clean
 * conversation played for its grant — and every menu button pressed. This is
 * what ties the buttons to CI: a menu entry that stops producing its declared
 * denial fails here before a visitor ever sees it.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACCORD_ARTICLES } from "../kernel/accord.js";
import { PACK_PATH, SNAPSHOT_PATH } from "../demo/files.js";
import { loadDemoWorld, sabotageWorld } from "../demo/script.js";
import {
  HONEST_CONTROL,
  honestCard,
  runHonest,
  runSabotage,
  SABOTAGE_MENU,
  sabotageCards,
} from "./sabotage.js";

// Built the way the app builds it: parsed bytes in, no fixture machinery.
const world = sabotageWorld(
  loadDemoWorld(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")), JSON.parse(readFileSync(PACK_PATH, "utf8"))),
);

describe("the menu", () => {
  it("carries exactly one sabotage per Accord article, in article order", () => {
    expect(SABOTAGE_MENU.map((entry) => entry.article)).toEqual(ACCORD_ARTICLES.map((entry) => entry.id));
  });

  it("projects every card from the crucible's own values", () => {
    for (const card of sabotageCards()) {
      expect(card.title).not.toBe("");
      expect(card.description).not.toBe("");
      expect(card.expectedDenial.startsWith(`${card.article}/`)).toBe(true);
      expect(card.analog, `${card.id} carries no analog`).not.toBe("");
    }
  });

  it("refuses a menu that leaves an article uncovered", () => {
    expect(() => sabotageCards(SABOTAGE_MENU.slice(1))).toThrow("covers no mutation for IA-1");
  });

  it("refuses a menu that misfiles a mutation under the wrong article", () => {
    const misfiled = SABOTAGE_MENU.map((entry) =>
      entry.article === "IA-2" ? { article: entry.article, mutation: "inject-missingno" } : entry,
    );
    expect(() => sabotageCards(misfiled)).toThrow('lists "inject-missingno" under IA-2');
  });

  it("refuses a mutation id the crucible does not carry", () => {
    expect(() => runSabotage(world, "unplug-the-kernel")).toThrow("the crucible does not carry");
  });
});

describe("every button, pressed", () => {
  it.each(SABOTAGE_MENU.map((entry) => [entry.mutation, entry] as const))("%s", (id) => {
    const outcome = runSabotage(world, id);
    expect(outcome.allowed, `${id} was allowed through`).toBe(false);
    expect(outcome.deniedAsDeclared, `${id} was refused under something other than its declared denial`).toBe(true);
    // The stamps the page shows carry the article's real-world analog.
    for (const stamp of outcome.violations) {
      expect(stamp.analog).not.toBe("");
      expect(stamp.message).not.toBe("");
    }
  });
});

describe("the honest run beside them", () => {
  it("is the crucible's own clean-path control", () => {
    expect(honestCard().id).toBe(HONEST_CONTROL);
    expect(honestCard().title).not.toBe("");
  });

  it("walks the whole chain untampered and is allowed, nothing denied", () => {
    expect(runHonest(world)).toEqual({ allowed: true, violations: [] });
  });
});
