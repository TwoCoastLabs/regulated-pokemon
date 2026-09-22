/**
 * The sabotage menu: what a visitor may let loose, and what the console shows
 * when they do.
 *
 * The buttons run the mutations CI runs — the same values out of
 * `ALL_MUTATIONS`, in the world the demo's clean conversation establishes —
 * never a staged re-enactment. This module is the projection between the two:
 * it curates which mutations make the menu, and turns a mutation's verdict
 * into what the page shows. It decides nothing; the kernel already did.
 *
 * The menu is one mutation per Accord article, in article order. That is the
 * epic's acceptance criterion made visible — every article denied by name —
 * and `sabotageCards` refuses a menu that breaks it, the same fail-closed
 * posture as everything downstream of it.
 */

import { expectedDenial, type Mutation } from "../crucible/harness.js";
import { honestAnswer } from "../crucible/phase2.js";
import { ALL_CONTROLS, ALL_MUTATIONS, worldOf } from "../crucible/phases.js";
import { AccordError } from "../kernel/violation.js";
import { ACCORD_ARTICLES, article, type ArticleId } from "../kernel/accord.js";
import type { ManifestContext } from "../kernel/manifest.js";
import type { Transaction } from "../kernel/transaction.js";
import { violationView, type ViolationView } from "./viewmodel.js";

/**
 * One sabotage per article. Chosen for legibility to a visitor — the hidden
 * warning, the doctored digest, the legendary sold to a novice — over the
 * subtler variants the crucible also carries; the full catalogue stays in the
 * test suite and `npm run demo -- --list`.
 */
export const SABOTAGE_MENU: readonly { article: ArticleId; mutation: string }[] = [
  { article: "IA-1", mutation: "bind-an-unconfirmed-interpretation" },
  { article: "IA-2", mutation: "swapped-stat" },
  { article: "IA-3", mutation: "inject-missingno" },
  { article: "IA-4", mutation: "crown-the-runner-up" },
  { article: "IA-5", mutation: "recommend-past-the-gate" },
  { article: "IA-6", mutation: "collapse-it-into-details" },
  { article: "IA-7", mutation: "doctor-the-confirmed-digest" },
  { article: "IA-8", mutation: "bind-an-injected-tool-result" },
  { article: "IA-9", mutation: "drop-the-consent-notice" },
  { article: "IA-10", mutation: "file-a-verdict-the-record-does-not-produce" },
];

/** The control beside the buttons: the whole chain, nothing tampered. It is
 * phase 5's clean-path control — the run that proves the denials are earned
 * rather than a kernel that refuses everything (no fail-closed theater). */
export const HONEST_CONTROL = "action-clean-path";

/** One button, before it is pressed. */
export interface SabotageCard {
  id: string;
  title: string;
  description: string;
  article: ArticleId;
  articleTitle: string;
  analog: string;
  /** The denial this sabotage has promised to be refused under. */
  expectedDenial: string;
}

/** What the console shows after a run: the kernel's verdict, projected. */
export interface SabotageOutcome {
  allowed: boolean;
  violations: readonly ViolationView[];
  /** True when the refusal carries exactly the declared denial — the same
   * check CI makes; a sabotage refused for another reason is a finding. */
  deniedAsDeclared: boolean;
}

function mutationNamed(id: string): Mutation {
  const found = ALL_MUTATIONS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`the sabotage menu names "${id}", which the crucible does not carry`);
  // The page hands every button the standard sabotage world; a menu entry
  // whose phase declared another world would run against the wrong registry
  // and deny for the wrong reason. Refused here, not discovered on stage.
  if (worldOf(found) !== "standard") {
    throw new Error(`the sabotage menu lists "${id}", whose phase runs in the ${worldOf(found)} world, not the standard one the page supplies`);
  }
  return found;
}

/** The menu as cards, refused whole if it no longer covers every article. */
export function sabotageCards(menu: readonly { article: ArticleId; mutation: string }[] = SABOTAGE_MENU): readonly SabotageCard[] {
  const covered = new Set(menu.map((entry) => entry.article));
  const uncovered = ACCORD_ARTICLES.filter((entry) => !covered.has(entry.id));
  if (uncovered.length > 0) {
    throw new Error(`the sabotage menu covers no mutation for ${uncovered.map((entry) => entry.id).join(", ")}`);
  }

  return menu.map((entry) => {
    const mutation = mutationNamed(entry.mutation);
    if (mutation.article !== entry.article) {
      throw new Error(
        `the sabotage menu lists "${mutation.id}" under ${entry.article}, but it declares ${mutation.article}`,
      );
    }
    const owner = article(mutation.article);
    return {
      id: mutation.id,
      title: mutation.title,
      description: mutation.description,
      article: mutation.article,
      articleTitle: owner.title,
      analog: owner.analog,
      expectedDenial: expectedDenial(mutation),
    };
  });
}

/**
 * The world a filed exchange was certified in, as the crucible takes it: the
 * registry and pack the session ran against, the scope that exchange
 * established, its locale, and the moment it committed — so a mutation
 * pressed on the live page runs against the visitor's own scope, not the
 * demo's canned one, and a validity window is checked at the moment the
 * record says the answer was made. A record that established no scope is
 * refused: the mutations need a grant to sabotage against.
 */
export function sabotageContextOf(
  world: Pick<ManifestContext, "registry" | "pack">,
  record: Transaction,
): ManifestContext {
  if (record.grant === undefined) {
    throw new Error(`record ${record.id} established no scope (${record.outcome.status}), so there is nothing to sabotage against`);
  }
  if (record.snapshotId !== world.registry.snapshot.id || record.packId !== world.pack.id) {
    throw new Error(`record ${record.id} was certified against ${record.snapshotId}/${record.packId}, not this world`);
  }
  return { registry: world.registry, pack: world.pack, grant: record.grant, locale: record.locale, at: record.committedAt };
}

/**
 * Whether a scope can host the crucible at all. Every answer-level sabotage
 * is built on the crucible's own honest answer — a recommendation, which the
 * pack gates on the badge level — and a grant is lazy: it establishes only
 * what its own answer required (IA-1's material half), so a filed exchange
 * about speed may carry no badge level at all. Said once, before any button,
 * naming the denial the honest answer would meet; the registry-level
 * sabotages run regardless, and the page says which.
 */
export type CrucibleFit = { hosts: true } | { hosts: false; violations: readonly ViolationView[] };

export function crucibleFit(world: ManifestContext): CrucibleFit {
  try {
    honestAnswer(world);
    return { hosts: true };
  } catch (error) {
    if (error instanceof AccordError) return { hosts: false, violations: error.violations.map(violationView) };
    throw error;
  }
}

/** Press one button: run the real mutation and project the kernel's verdict. */
export function runSabotage(world: ManifestContext, id: string): SabotageOutcome {
  const mutation = mutationNamed(id);
  const verdict = mutation.run(world);
  return {
    allowed: verdict.allowed,
    violations: verdict.violations.map(violationView),
    deniedAsDeclared:
      !verdict.allowed &&
      verdict.violations.some((entry) => `${entry.article}/${entry.rule}` === expectedDenial(mutation)),
  };
}

function honestControl() {
  const control = ALL_CONTROLS.find((entry) => entry.id === HONEST_CONTROL);
  if (control === undefined) throw new Error(`the crucible carries no control named "${HONEST_CONTROL}"`);
  return control;
}

/** The honest run's card — the button beside the sabotages. */
export function honestCard(): { id: string; title: string; description: string } {
  const { id, title, description } = honestControl();
  return { id, title, description };
}

/** Press it: the whole chain runs untampered, and must be allowed. */
export function runHonest(world: ManifestContext): { allowed: boolean; violations: readonly ViolationView[] } {
  const verdict = honestControl().run(world);
  return { allowed: verdict.allowed, violations: verdict.violations.map(violationView) };
}
