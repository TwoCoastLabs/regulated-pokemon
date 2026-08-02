/**
 * The shapes every phase of the crucible is written in.
 *
 * A mutation declares the denial it expects. If the kernel denies it for a
 * different reason, that is a finding, not a pass — so these are values rather
 * than test bodies. One test asserts that every mutation is denied under
 * exactly what it declared, and the same list drives the visitor-facing
 * sabotage buttons later: what a reader triggers in the browser is the
 * mutation CI runs, not a staged re-enactment of it.
 */

import type { ArticleId } from "../kernel/accord.js";
import type { Verdict } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";

/**
 * Everything a verdict is allowed to depend on: the certified registry, the
 * Accord pack governing the answer, the trainer's scope, and the moment of
 * commit. It is the manifest verifier's context because that is exactly the
 * point — a mutation runs against the same world a real answer does, with no
 * private back door into the kernel.
 */
export type CrucibleWorld = ManifestContext;

export interface Mutation {
  /** Stable slug, used by tests and by the sabotage buttons. */
  id: string;
  /** Short label for the compliance console. */
  title: string;
  description: string;
  /** The article this sabotage must be denied under. */
  article: ArticleId;
  /** The rule slug the denial must carry, e.g. "fabricated-entity". */
  rule: string;
  /** Apply the sabotage and return the kernel's verdict on the result. */
  run(world: CrucibleWorld): Verdict;
}

/**
 * A run that must be *allowed*. Two kinds, and a phase needs both.
 *
 * A `clean-path` control exercises the kernel's own entry points with nothing
 * tampered: it catches fail-closed theater, where a kernel that refuses
 * everything would look perfectly safe and be useless.
 *
 * A `no-op-sabotage` control runs the identical sabotage harness with the
 * sabotage removed. It catches the crucible's own failure mode: a harness that
 * denied by construction would make every mutation above it pass for free.
 */
export interface Control {
  id: string;
  title: string;
  description: string;
  kind: "clean-path" | "no-op-sabotage";
  run(world: CrucibleWorld): Verdict;
}

export function expectedDenial(mutation: Mutation): string {
  return `${mutation.article}/${mutation.rule}`;
}

/**
 * Sabotage means writing where the contracts say `readonly`. That is the point
 * of the exercise, so the unsafe cast lives here and nowhere else — kernel
 * code never gets a mutable view of a certified structure.
 */
export type Writable<T> = T extends object ? { -readonly [K in keyof T]: Writable<T[K]> } : T;

export function mutable<T>(value: T): Writable<T> {
  return value as Writable<T>;
}
