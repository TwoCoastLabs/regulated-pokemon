/**
 * The crucible, with buttons on it. Every card is a mutation out of
 * `ALL_MUTATIONS` — the value CI runs, not a re-enactment — let loose in the
 * world the demo's clean conversation establishes, live in this tab. The
 * projection (src/ui/sabotage.ts) decides what a card and a verdict look
 * like; this file only renders and remembers which buttons were pressed.
 */
import { useMemo, useState } from "preact/hooks";

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
    </div>
  );
}
