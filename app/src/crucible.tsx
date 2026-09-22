/**
 * The crucible, with buttons on it. Every card in the first grid is a mutation
 * out of `ALL_MUTATIONS` — the value CI runs, not a re-enactment — let loose
 * live in this tab, in the world the caller hands it: the scope one of the
 * visitor's own exchanges certified (src/ui/sabotage.ts, `sabotageContextOf`),
 * or the demo's clean conversation while no exchange has. The projection
 * (src/ui/sabotage.ts) decides what a card and a verdict look like; this file
 * only renders and remembers which buttons were pressed.
 *
 * The second grid is a different kind of attack. Those mutations change the
 * document; these leave the certified markup untouched and change only how the
 * browser *paints* it — a warning shrunk to four pixels, shoved off the screen,
 * collapsed to nothing. The offline structural walker reads inline style and
 * tree shape, so it clears every one of them; the browser-backed affidavit,
 * reading the real layout, is the only thing that denies them. So this grid
 * does not run the CI kernel — it mounts the certified page for real, mutates
 * the paint, and reads the geometry back (src/ui/geometry-sabotage.ts).
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { ManifestContext } from "../../src/kernel/manifest.js";
import { adaptArtifact } from "../../src/ui/artifact-dom.js";
import { attestGeometry } from "../../src/ui/browser-affidavit.js";
import {
  GEOMETRY_SABOTAGES,
  geometryOutcome,
  geometryScene,
  type GeometryOutcome,
  type GeometrySabotageCard,
} from "../../src/ui/geometry-sabotage.js";
import {
  crucibleFit,
  honestCard,
  runHonest,
  runSabotage,
  sabotageCards,
  type SabotageCard,
  type SabotageOutcome,
} from "../../src/ui/sabotage.js";
import type { ViolationView } from "../../src/ui/viewmodel.js";
import { browserFactory, browserGeometry, resolveNode } from "./mount.js";

interface HonestOutcome {
  allowed: boolean;
  violations: readonly ViolationView[];
}

/** A denial as a stamp: the article code, the kernel's message, what it
 * expected against what it found, and the real-world rule the article
 * stands in for. */
export function Stamp(props: { violation: ViolationView }) {
  const { violation } = props;
  return (
    <div class="stamp">
      <span class="stamp-code mono" title={`${violation.articleTitle} — real-world analog: ${violation.analog}`}>
        {violation.code}
      </span>
      <p class="stamp-message">{violation.message}</p>
      {(violation.expected !== undefined || violation.actual !== undefined) && (
        <p class="stamp-diff mono">
          {violation.expected !== undefined && <span>expected {violation.expected}</span>}
          {violation.actual !== undefined && <span>actual {violation.actual}</span>}
        </p>
      )}
      <p class="stamp-analog">{violation.analog}</p>
    </div>
  );
}

/** What a thrown error says, for the note under a button that could not
 * run: the crucible builds every sabotage on its own honest answer, and a
 * scope in which that answer does not compile has nothing to sabotage. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Card(props: { card: SabotageCard; outcome: SabotageOutcome | undefined; refused: string | undefined; onRun: () => void }) {
  const { card, outcome, refused, onRun } = props;
  return (
    <article class="sabotage-card" aria-label={`Sabotage: ${card.title}`}>
      <header>
        <span class="article-chip" title={`${card.articleTitle} — real-world analog: ${card.analog}`}>
          {card.article}
        </span>
        <h3>{card.title}</h3>
      </header>
      <p class="sabotage-description">{card.description}</p>
      <p class="sabotage-promise mono">must be refused under {card.expectedDenial}</p>
      <button type="button" class="sabotage-trigger" onClick={onRun}>
        {outcome === undefined ? "Let it loose" : "Run it again"}
      </button>
      {refused !== undefined && <p class="sabotage-breach">Could not run in this scope: {refused}</p>}
      {outcome !== undefined &&
        (outcome.allowed ? (
          <p class="sabotage-breach">ALLOWED — the gate did not fire. This is a kernel bug; the crucible in CI fails on exactly this.</p>
        ) : (
          <div class="sabotage-verdict">
            {outcome.violations.map((violation) => (
              <Stamp violation={violation} />
            ))}
            <p class={`sabotage-agreement${outcome.deniedAsDeclared ? "" : " disagreed"}`}>
              {outcome.deniedAsDeclared
                ? "Refused under exactly the denial it declared — the same check CI makes."
                : "Refused, but not under the declared denial. CI treats that as a finding, not a pass."}
            </p>
          </div>
        ))}
    </article>
  );
}

/** One geometry attack, and the browser affidavit's verdict on the page it
 * painted. `structurallyVisible` is the contrast the whole grid draws: the
 * offline walker still calls the target shown. */
function GeometryCard(props: {
  card: GeometrySabotageCard;
  outcome: GeometryOutcome | undefined;
  onRun: () => void;
}) {
  const { card, outcome, onRun } = props;
  return (
    <article class="sabotage-card" aria-label={`Geometry sabotage: ${card.title}`}>
      <header>
        <span class="article-chip" title="Disclosures Must Be Seen — the FTC's four Ps, as geometry">
          IA-6
        </span>
        <h3>{card.title}</h3>
      </header>
      <p class="sabotage-description">{card.description}</p>
      <p class="sabotage-promise mono">must be refused under {card.expectedDenial}</p>
      <button type="button" class="sabotage-trigger" onClick={onRun}>
        {outcome === undefined ? "Paint it" : "Paint it again"}
      </button>
      {outcome !== undefined &&
        (outcome.allowed ? (
          <p class="sabotage-breach">
            ALLOWED — the browser affidavit did not fire. On a real layout this attack shows the trainer nothing; the
            gate must deny it.
          </p>
        ) : (
          <div class="sabotage-verdict">
            {outcome.violations.map((violation) => (
              <Stamp violation={violation} />
            ))}
            <p class={`sabotage-agreement${outcome.deniedAsDeclared ? "" : " disagreed"}`}>
              {outcome.deniedAsDeclared
                ? "Refused under exactly the denial it declared — the layer the offline gate cannot see."
                : "Refused, but not under the declared denial. That is a finding, not a pass."}
            </p>
            <p class="geometry-contrast mono">
              offline structural walk: this unit is still {outcome.structurallyVisible ? "visible" : "hidden"} — the
              markup never changed
            </p>
          </div>
        ))}
    </article>
  );
}

/**
 * Lay an opaque box over an element, higher in the paint order — the one attack
 * that adds a node instead of restyling one. Positioned against the stage
 * container (which is `position: relative`), so it sits exactly over the target
 * whatever the scroll. It carries a class so the affidavit can name what covered
 * the warning, and `elementFromPoint` returns it regardless of its fill.
 */
function coverElement(target: HTMLElement, container: HTMLElement, style: Readonly<Record<string, string>>) {
  const t = target.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.className = "geometry-overlay";
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(
    overlay.style,
    {
      position: "absolute",
      left: `${t.left - c.left}px`,
      top: `${t.top - c.top}px`,
      width: `${t.width}px`,
      height: `${t.height}px`,
      zIndex: "10",
    },
    style,
  );
  container.appendChild(overlay);
}

/**
 * The paint-layer grid: the certified page mounted for real, and the attacks a
 * stylesheet can mount on it. Each press remounts the clean page, applies one
 * inline patch to the target's real node (or lays an overlay over it), and reads
 * the geometry back — so the verdict is about the page on the screen, and
 * pressing one button never leaves the last one's damage behind.
 */
function GeometryCrucible(props: { world: ManifestContext }) {
  const { world } = props;
  // The scene is the crucible's honest answer, planned and painted in this
  // scope; a scope in which it does not compile is named, not crashed on.
  const built = useMemo<{ scene: ReturnType<typeof geometryScene> } | { refused: string }>(() => {
    try {
      return { scene: geometryScene(world) };
    } catch (error) {
      return { refused: reason(error) };
    }
  }, [world]);
  const scene = "scene" in built ? built.scene : undefined;
  const host = useRef<HTMLDivElement>(null);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, GeometryOutcome>>>({});
  const [cleanRun, setCleanRun] = useState<boolean | undefined>(undefined);

  /** Mount the untouched certified page and hand back its root element. */
  const mountClean = (): Element | null => {
    if (host.current === null || scene === undefined) return null;
    const root = adaptArtifact(scene.artifact, browserFactory) as Element;
    host.current.replaceChildren(root);
    return root;
  };

  // Show the clean certified page as soon as the section appears, and again
  // whenever the scope it is built in changes.
  useEffect(() => {
    setOutcomes({});
    setCleanRun(undefined);
    mountClean();
  }, [scene]);

  if (scene === undefined) {
    return (
      <section class="geometry-crucible" aria-label="The browser-backed affidavit">
        <div class="crucible-intro">
          <h2>The paint layer</h2>
          <p class="sabotage-breach">
            The paint layer cannot be attacked in this scope: the crucible's honest answer does not compile here, and
            every paint sabotage is measured against it. {"refused" in built ? built.refused : ""}
          </p>
        </div>
      </section>
    );
  }

  const press = (card: GeometrySabotageCard) => {
    const root = mountClean();
    if (root === null || host.current === null) return;
    const target = scene.walk.units.find((unit) => unit.id === card.target);
    const node = target === undefined ? undefined : resolveNode(root, target.path);
    if (node instanceof HTMLElement) {
      // A cover card leaves the target alone and lays an opaque box over it,
      // higher in the paint order; every other card restyles the target itself.
      if (card.cover === true) {
        coverElement(node, host.current, card.style);
        // Occlusion is read with `elementFromPoint`, which only answers for a
        // point inside the visible window — so the warning has to be on screen
        // when it is sampled. The overlay is positioned against the container
        // and rides the same scroll, staying over the warning.
        node.scrollIntoView({ block: "center" });
      } else {
        Object.assign(node.style, card.style);
      }
    }
    const outcome = geometryOutcome(scene, browserGeometry(root, host.current), card);
    setCleanRun(undefined);
    setOutcomes((current) => ({ ...current, [card.id]: outcome }));
  };

  const runClean = () => {
    const root = mountClean();
    if (root === null || host.current === null) return;
    const verdict = attestGeometry(scene.walk, browserGeometry(root, host.current), scene.policy, scene.discloses);
    setOutcomes({});
    setCleanRun(verdict.allowed);
  };

  return (
    <section class="geometry-crucible" aria-label="The browser-backed affidavit">
      <div class="crucible-intro">
        <h2>The paint layer</h2>
        <p>
          The mutations above change the document. These change only how the browser draws it. The page below is the
          same certified answer, mounted for real; each button leaves its markup untouched and rewrites its paint —
          shrinking the warning, moving it off the screen, collapsing it to nothing, or laying a box over it. The
          offline structural walker reads inline style and tree shape and clears every one; the{" "}
          <strong>browser-backed affidavit</strong>, reading the real layout against the pack's floors, is what denies
          them. Three of the FTC's four Ps live here — prominence, placement and occlusion. Proximity is the fourth,
          enforced the same way, but the renderer nests every warning inside what it discloses, so no paint-only edit
          can pull them apart.
        </p>
      </div>

      <figure class="exhibit geometry-stage">
        <figcaption class="exhibit-tag">Certified page · painted live in this tab</figcaption>
        <div class="exhibit-page" ref={host} />
      </figure>

      <article class="sabotage-card honest" aria-label="Control: the page painted honestly">
        <header>
          <span class="article-chip control-chip" title="the paint layer's clean control">
            control
          </span>
          <h3>Paint it honestly</h3>
        </header>
        <p class="sabotage-description">
          The certified page, mounted and measured with nothing touched. The affidavit reads it against the same floors
          the sabotages fail.
        </p>
        <p class="sabotage-promise mono">must be allowed, with nothing denied at all</p>
        <button type="button" class="sabotage-trigger" onClick={runClean}>
          {cleanRun === undefined ? "Measure it clean" : "Measure it again"}
        </button>
        {cleanRun !== undefined &&
          (cleanRun ? (
            <p class="sabotage-allowed">
              Allowed, zero violations. The page reads legibly, on the screen, beside what it discloses — the denials in
              this grid are earned.
            </p>
          ) : (
            <p class="sabotage-breach">
              REFUSED — the clean page must pass. A geometry gate that fails an honest layout is fail-closed theater.
            </p>
          ))}
      </article>

      <div class="sabotage-grid">
        {GEOMETRY_SABOTAGES.map((card) => (
          <GeometryCard card={card} outcome={outcomes[card.id]} onRun={() => press(card)} />
        ))}
      </div>
    </section>
  );
}

/**
 * The crucible in one scope. `world` is what every button runs against;
 * `scope` says in plain words whose scope that is (the visitor's, from a named
 * exchange, or the demo's), so a verdict is never read without knowing what
 * trainer it was ruled for.
 */
export function Crucible(props: { world: ManifestContext; scope: string }) {
  const { world, scope } = props;
  const cards = useMemo(() => sabotageCards(), []);
  const honest = useMemo(() => honestCard(), []);
  const fit = useMemo(() => crucibleFit(world), [world]);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, SabotageOutcome>>>({});
  const [honestOutcome, setHonestOutcome] = useState<HonestOutcome | undefined>(undefined);
  // A press that threw: the crucible's own honest answer failed to compile in
  // this scope, so the mutation built on it never ran. Said under the card.
  const [refusals, setRefusals] = useState<Readonly<Record<string, string>>>({});

  // A verdict is ruled in one scope; when the scope changes, the old verdicts
  // come down rather than standing beside a new label.
  useEffect(() => {
    setOutcomes({});
    setHonestOutcome(undefined);
    setRefusals({});
  }, [world]);

  const press = (id: string) => {
    try {
      const outcome = runSabotage(world, id);
      setOutcomes((current) => ({ ...current, [id]: outcome }));
    } catch (error) {
      setRefusals((current) => ({ ...current, [id]: reason(error) }));
    }
  };

  const pressHonest = () => {
    try {
      setHonestOutcome(runHonest(world));
    } catch (error) {
      setRefusals((current) => ({ ...current, [honest.id]: reason(error) }));
    }
  };

  return (
    <div class="crucible" aria-label="The crucible">
      <section class="crucible-intro">
        <p class="crucible-scope">
          <span class="crucible-scope-label">Running in</span> {scope}
        </p>
        <p>
          Each card below is a mutation from the crucible — the failure-injection suite CI runs — imported value for
          value, never re-enacted. Pressing a button runs the sabotage against the certified registry (digest
          recomputed here, in this tab) in the scope named above, and shows the kernel's real verdict. Every denial
          names its Accord article; hover a stamp's code for the real-world rule it stands in for.
        </p>
        {!fit.hosts && (
          <div class="crucible-unfit" role="note">
            <p>
              This scope cannot host the crucible's own honest answer — a recommendation, which the pack gates on the
              badge level — so the sabotages built on that answer, and the untampered control, will refuse before
              they run. A scope is lazy: it establishes only what its own answer needed. The sabotages on the
              registry itself still run. For the full set, ask the Advisor for a recommendation and choose that
              exchange, or run in the demo's scope.
            </p>
            {fit.violations.map((violation) => (
              <Stamp violation={violation} />
            ))}
          </div>
        )}
      </section>

      <article class="sabotage-card honest" aria-label={`Control: ${honest.title}`}>
        <header>
          <span class="article-chip control-chip" title="the crucible's clean-path control">
            control
          </span>
          <h3>{honest.title}</h3>
        </header>
        <p class="sabotage-description">{honest.description}</p>
        <p class="sabotage-promise mono">must be allowed, with nothing denied at all</p>
        <button type="button" class="sabotage-trigger" onClick={pressHonest}>
          {honestOutcome === undefined ? "Run it untampered" : "Run it again"}
        </button>
        {refusals[honest.id] !== undefined && <p class="sabotage-breach">Could not run in this scope: {refusals[honest.id]}</p>}
        {honestOutcome !== undefined &&
          (honestOutcome.allowed ? (
            <p class="sabotage-allowed">
              Allowed, zero violations. The denials on this page are earned — this is the same chain, with nothing in
              the way.
            </p>
          ) : (
            <div class="sabotage-verdict">
              <p class="sabotage-breach">REFUSED — the clean path must pass. This is fail-closed theater, and CI fails on it.</p>
              {honestOutcome.violations.map((violation) => (
                <Stamp violation={violation} />
              ))}
            </div>
          ))}
      </article>

      <div class="sabotage-grid">
        {cards.map((card) => (
          <Card card={card} outcome={outcomes[card.id]} refused={refusals[card.id]} onRun={() => press(card.id)} />
        ))}
      </div>

      <GeometryCrucible world={world} />
    </div>
  );
}
