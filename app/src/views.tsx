/**
 * The picker and the conversation — the ungoverned side of the page, plus the
 * one governed thing in it: the exhibit frame, where a recorded certified page
 * is mounted as real DOM. The frame is the app's thesis made visible: chat is
 * the sales call and may charm; the framed region is the certificate, and the
 * app's only power over it is to mount it faithfully or refuse.
 */
import { useEffect, useRef, useState } from "preact/hooks";

import type { RenderAffidavit, ConfirmationEvent } from "../../src/kernel/contracts.js";
import type { DomElement } from "../../src/kernel/dom.js";
import type { ArtifactModel, HarnessArtifact } from "../../src/harness/artifact.js";
import type { HarnessRun } from "../../src/harness/run.js";
import { adaptArtifact } from "../../src/ui/artifact-dom.js";
import { modelOf, outcomeLine, transcriptLines, type ScenarioGroup } from "../../src/ui/viewmodel.js";
import { browserFactory } from "./mount.js";

function modelLabel(model: ArtifactModel | undefined, providerId: string): string {
  if (model === undefined) return providerId;
  const slug = model.slug ?? model.id;
  return `${model.role} · ${slug.split("/").pop() ?? slug}`;
}

export function Picker(props: {
  groups: readonly ScenarioGroup[];
  artifact: HarnessArtifact;
  selected: HarnessRun;
  onSelect: (run: HarnessRun) => void;
}) {
  return (
    <nav class="picker" aria-label="Runs in this record">
      {props.groups.map((group) => (
        <section class="picker-group">
          <h2>{group.title}</h2>
          <ul>
            {group.runs.map((run) => (
              <li>
                <button
                  class={`pick${run === props.selected ? " current" : ""}`}
                  onClick={() => props.onSelect(run)}
                >
                  <span class={`status ${run.status}`}>{run.status}</span>
                  <span class="pick-model">{modelLabel(modelOf(props.artifact, run.providerId), run.providerId)}</span>
                  {run.repetition > 0 && (
                    <span class="pick-rep mono" title={`repetition ${run.repetition}`}>
                      #{run.repetition}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

const CHANNEL_NOTE: Record<string, string> = {
  "quoted-document": "quoted document — this channel cannot bind scope",
  "third-party": "third party — only the trainer speaks for the trainer",
  tool: "tool result — this channel cannot bind scope or consent",
};

export function Conversation(props: { run: HarnessRun }) {
  const { run } = props;
  const outcome = outcomeLine(run);
  const transaction = run.transaction;

  return (
    <main class="conversation">
      <ol class="chat">
        {transcriptLines(run.transcript).map((line) => (
          <li class={`bubble ${line.speaker}${line.kind === "confirmation" ? " confirmation" : ""}`}>
            {line.speaker !== "trainer" && line.speaker !== "advisor" && (
              <span class="channel">{CHANNEL_NOTE[line.speaker] ?? line.speaker}</span>
            )}
            <p>{line.text}</p>
            {line.detail !== undefined && <p class="bubble-detail">{line.detail}</p>}
          </li>
        ))}
      </ol>

      {transaction?.artifact !== undefined && (
        <Exhibit
          artifact={transaction.artifact}
          affidavit={transaction.affidavit}
          confirmation={transaction.confirmation}
        />
      )}

      <p class={`outcome ${outcome.tone}`}>{outcome.text}</p>
    </main>
  );
}

/**
 * A recorded page, mounted for real. On any tag or attribute the record may
 * not carry, the adapter throws and the frame shows the refusal instead: a
 * page the app cannot mount faithfully is not shown at all, because what is
 * on screen must be what the affidavit describes.
 */
function Exhibit(props: {
  artifact: DomElement;
  affidavit: RenderAffidavit | undefined;
  confirmation: ConfirmationEvent | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (host.current === null) return;
    try {
      const mounted = adaptArtifact(props.artifact, browserFactory);
      host.current.replaceChildren(mounted);
      setRefusal(null);
    } catch (error) {
      host.current.replaceChildren();
      setRefusal(error instanceof Error ? error.message : String(error));
    }
  }, [props.artifact]);

  return (
    <figure class="exhibit">
      <figcaption class="exhibit-tag">Certified page · governed region</figcaption>
      {refusal !== null && <p class="exhibit-refusal">{refusal}</p>}
      <div class="exhibit-page" ref={host} />
      <div class="exhibit-strip mono">
        {props.affidavit !== undefined && <span title="digest of the visible content, from the affidavit">{props.affidavit.artifactDigest}</span>}
        {props.confirmation !== undefined && (
          <span class="exhibit-confirmed">confirmed by the trainer at {props.confirmation.confirmedAt}</span>
        )}
      </div>
    </figure>
  );
}
