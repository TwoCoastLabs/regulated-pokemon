/**
 * The crucible, with buttons on it. Every card in the first grid is a mutation
 * out of `ALL_MUTATIONS` — the value CI runs, not a re-enactment — let loose in
 * the world the demo's clean conversation establishes, live in this tab. The
 * projection (src/ui/sabotage.ts) decides what a card and a verdict look like;
 * this file only renders and remembers which buttons were pressed.
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
  honestCard,
  runHonest,
  runSabotage,
  sabotageCards,
  type SabotageCard,
  type SabotageOutcome,
} from "../../src/ui/sabotage.js";
import type { ViolationView } from "../../src/ui/viewmodel.js";
import { Stamp } from "./console.js";
import { browserFactory, browserGeometry, resolveNode } from "./mount.js";
import { sabotageContext } from "./world.js";

interface HonestOutcome {
  allowed: boolean;
  violations: readonly ViolationView[];
}

function Card(props: { card: SabotageCard; outcome: SabotageOutcome | undefined; onRun: () => void }) {
  const { card, outcome, onRun } = props;
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
function GeometryCrucible() {
  const scene = useMemo(() => geometryScene(sabotageContext()), []);
  const host = useRef<HTMLDivElement>(null);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, GeometryOutcome>>>({});
  const [cleanRun, setCleanRun] = useState<boolean | undefined>(undefined);

  /** Mount the untouched certified page and hand back its root element. */
  const mountClean = (): Element | null => {
    if (host.current === null) return null;
    const root = adaptArtifact(scene.artifact, browserFactory) as Element;
    host.current.replaceChildren(root);
    return root;
  };

  // Show the clean certified page as soon as the section appears. The scene is
  // memoised for the tab's lifetime, so this runs once and needs no deps.
  useEffect(() => {
    mountClean();
  }, []);

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

export function Crucible() {
  const cards = useMemo(() => sabotageCards(), []);
  const honest = useMemo(() => honestCard(), []);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, SabotageOutcome>>>({});
  const [honestOutcome, setHonestOutcome] = useState<HonestOutcome | undefined>(undefined);

  // Built on first press, not on mount: recomputing the snapshot digest is
  // work this tab should not owe until a visitor actually runs something.
  const press = (id: string) => {
    setOutcomes((current) => ({ ...current, [id]: runSabotage(sabotageContext(), id) }));
  };

  return (
    <div class="crucible" aria-label="The crucible">
      <section class="crucible-intro">
        <p>
          Each card below is a mutation from the crucible — the failure-injection suite CI runs — imported value for
          value, never re-enacted. Pressing a button loads the certified registry (digest recomputed here, in this
          tab), plays the clean conversation for its scope grant, applies the sabotage, and shows the kernel's real
          verdict. Every denial names its Accord article; hover a stamp's code for the real-world rule it stands in
          for.
        </p>
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
        <button
          type="button"
          class="sabotage-trigger"
          onClick={() => setHonestOutcome(runHonest(sabotageContext()))}
        >
          {honestOutcome === undefined ? "Run it untampered" : "Run it again"}
        </button>
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
          <Card card={card} outcome={outcomes[card.id]} onRun={() => press(card.id)} />
        ))}
      </div>

      <GeometryCrucible />
    </div>
  );
}
