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
import { CONVERSATIONS, loadDemoWorld, playConversation, sabotageWorld } from "../demo/script.js";
import {
  HONEST_CONTROL,
  honestCard,
  runHonest,
  runSabotage,
  SABOTAGE_MENU,
  crucibleFit,
  sabotageCards,
  sabotageContextOf,
} from "./sabotage.js";

// Built the way the app builds it: parsed bytes in, no fixture machinery.
const demo = loadDemoWorld(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")), JSON.parse(readFileSync(PACK_PATH, "utf8")));
const world = sabotageWorld(demo);

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

describe("the crucible in a filed exchange's own scope", () => {
  const clean = playConversation(demo, CONVERSATIONS[0]!);

  it("reads the record's grant, locale and commit moment into the world the mutations take", () => {
    const context = sabotageContextOf(demo, clean);
    expect(context.grant).toBe(clean.grant);
    expect(context.locale).toBe(clean.locale);
    expect(context.at).toBe(clean.committedAt);
    expect(context.registry).toBe(demo.registry);
    expect(context.pack).toBe(demo.pack);
  });

  it("denies every menu button as declared in that scope, and lets the honest control through", () => {
    const context = sabotageContextOf(demo, clean);
    for (const card of sabotageCards()) {
      expect(runSabotage(context, card.id).deniedAsDeclared, card.id).toBe(true);
    }
    expect(runHonest(context).allowed).toBe(true);
  });

  it("refuses a record that established no scope", () => {
    const asked = CONVERSATIONS.map((entry) => playConversation(demo, entry)).find((entry) => entry.grant === undefined);
    expect(asked, "the demo has no conversation that stops short of a grant").toBeDefined();
    expect(() => sabotageContextOf(demo, asked!)).toThrow("established no scope");
  });

  it("says whether a scope hosts the crucible's honest answer, naming the denial when it does not", () => {
    expect(crucibleFit(sabotageContextOf(demo, clean))).toEqual({ hosts: true });
    // A grant that never established the badge level — what a filed exchange
    // about speed carries — cannot host a recommendation.
    const grant = world.grant!;
    const { badgeLevel: _dropped, ...scope } = grant.scope;
    const lazy = { ...world, grant: { ...grant, scope: scope as typeof grant.scope } };
    const fit = crucibleFit(lazy);
    expect(fit.hosts).toBe(false);
    if (!fit.hosts) expect(fit.violations.map((entry) => entry.code)).toContain("IA-1/scope-dimension-missing");
  });

  it("refuses a record certified against another world", () => {
    expect(() => sabotageContextOf(demo, { ...clean, snapshotId: "another-snapshot" })).toThrow("not this world");
  });
});
