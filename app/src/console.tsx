/**
 * The compliance console: what the kernel established, ruled, and let commit,
 * for one selected run — scope pins, the stage ladder, the certified answer,
 * and the act chain when the run walked one. Denials are stamps that name
 * their article, each with its real-world analog from the article registry.
 */
import type { HarnessArtifact } from "../../src/harness/artifact.js";
import type { HarnessRun } from "../../src/harness/run.js";
import { trailsOfRun } from "../../src/ui/trail.js";
import {
  describeClaim,
  scopePins,
  stageViews,
  type ViolationView,
} from "../../src/ui/viewmodel.js";
import { Trails } from "./trail.js";

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

export function Console(props: { artifact: HarnessArtifact; run: HarnessRun }) {
  const { run } = props;
  const transaction = run.transaction;
  const scope = run.grantScope ?? transaction?.grant?.scope;
  const grant = transaction?.grant;
  const manifest = transaction?.manifest;
  const stages = stageViews(run);

  return (
    <aside class="console" aria-label="Compliance console">
      {/* The step trail (issue #158): the exchange as the steps that made it,
          on their lanes. A run driven through the session spine carries the
          driver's ledger; the scenario corpus's runs carry only the record,
          and their trail is reconstructed from it and says so. */}
      <section key={`trail-${transaction?.id ?? run.scenarioId + run.providerId + String(run.repetition)}`}>
        <h2>How it was made</h2>
        <Trails trails={trailsOfRun(run)} who="trainer" empty={`No steps to show — ${run.detail}.`} />
      </section>

      <section>
        <h2>Scope</h2>
        {scope === undefined ? (
          <p class="empty">Never established — nothing downstream could run.</p>
        ) : (
          <>
            <ul class="pins">
              {scopePins(scope).map((pin) => (
                <li>
                  <span class="pin-dimension">{pin.dimension}</span>
                  <span class="pin-value mono">{pin.value}</span>
                </li>
              ))}
            </ul>
            {grant !== undefined && (
              <p class="fine mono" title="the grant's validity window">
                {grant.id} · {grant.issuedAt} → {grant.expiresAt}
              </p>
            )}
          </>
        )}
      </section>

      <section>
        <h2>The kernel's ruling</h2>
        {stages.length === 0 ? (
          <p class="empty">No stage ruled — {run.detail}.</p>
        ) : (
          <ol class="ladder" key={transaction?.id ?? run.scenarioId + run.providerId + String(run.repetition)}>
            {stages.map((stage) => (
              <li class={stage.allowed ? "passed" : "denied"}>
                <span class="ladder-stage">{stage.stage}</span>
                <span class="ladder-verdict">{stage.allowed ? "allowed" : "refused"}</span>
                {stage.violations.map((violation) => (
                  <Stamp violation={violation} />
                ))}
              </li>
            ))}
          </ol>
        )}
      </section>

      {manifest !== undefined && (
        <section>
          <h2>Certified answer</h2>
          <ul class="claims mono">
            {manifest.claims.map((claim) => (
              <li>{describeClaim(claim)}</li>
            ))}
          </ul>
          {manifest.rosters.length > 0 && (
            <ul class="rosters mono">
              {manifest.rosters.map((roster) => (
                <li title="a closed roster travels inside the record; the roster is the count">
                  {roster.id} — {roster.cardinality} member{roster.cardinality === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          )}
          {manifest.exhibits.length > 0 && (
            <ul class="obligations">
              {manifest.exhibits.map((exhibit) => (
                <li>
                  <span class="mono">{exhibit.id}</span>
                  {exhibit.triggeredBy !== undefined && <span class="owed">owed under {exhibit.triggeredBy}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(transaction?.affidavit !== undefined || transaction?.actionGrants !== undefined) && (
        <section>
          <h2>Act chain</h2>
          {transaction.affidavit !== undefined && (
            <ul class="units">
              {transaction.affidavit.units.map((unit) => (
                <li class={unit.visible ? "visible" : "hidden-unit"}>
                  <span class="mono">{unit.id}</span>
                  <span>{unit.visible ? "visible" : "not visible"}</span>
                </li>
              ))}
            </ul>
          )}
          {transaction.actionGrants?.map((actionGrant) => (
            <p class="grant mono" title="minted by authorizeAction over the whole confirmed chain">
              {actionGrant.tool}({actionGrant.entityId}) · authorized {actionGrant.authorizedAt} · cites{" "}
              {actionGrant.confirmationEventId}
            </p>
          ))}
        </section>
      )}

      {run.status === "denied" && run.proposedClaims !== undefined && run.proposedClaims.length > 0 && (
        <section>
          <h2>What the model proposed</h2>
          <p class="fine">Kept even though it was refused — a blocked attempt is evidence the gate fired.</p>
          <ul class="claims mono proposed">
            {run.proposedClaims.map((claim) => (
              <li>{describeClaim(claim)}</li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
