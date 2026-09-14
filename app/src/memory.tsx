/**
 * The session's memory panel (docs/precedent.md, "The memory on the dev
 * view"): the store as loaded, and the session's own candidates — the
 * exchanges the kernel accepted, each with a "mark on target" a reviewer
 * ticks. Marked candidates go to a promotion file the reviewer downloads
 * and takes to a pull request; nothing here writes the store the tab is
 * reading, and the panel says so. This is the review queue in its smallest
 * form, and where the flywheel is watched turning: the store never changes
 * under a running session.
 */
import { useState } from "preact/hooks";

import type { Transaction } from "../../src/kernel/transaction.js";
import { type Precedent, type PrecedentStore, precedentStoreDigest, renderShape, shapeOf } from "../../src/memory/precedent.js";
import { promoteExchange } from "../../src/memory/promote.js";
import type { SessionState } from "../../src/session/session.js";

/** The ask an exchange answered: its last trainer utterance. */
function askOf(record: Transaction): string {
  const words = record.transcript.filter((event) => event.kind === "utterance" && event.source === "trainer");
  const last = words[words.length - 1];
  return last?.kind === "utterance" ? last.text : "";
}

export function MemoryPanel(props: { store: PrecedentStore | undefined; state: SessionState; on: boolean; onToggle: (on: boolean) => void; now: () => string }) {
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);
  const candidates = props.state.records.filter((record) => record.outcome.status === "answered" && record.manifest !== undefined);
  const { store } = props;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(marked);
    if (on) next.add(id);
    else next.delete(id);
    setMarked(next);
  };
  const download = () => {
    const promoted: Precedent[] = candidates
      .filter((record) => marked.has(record.id))
      .map((record) =>
        promoteExchange({
          id: `p-session-${record.id}`,
          ask: askOf(record),
          transcript: record.transcript,
          transaction: { id: record.id, snapshotId: record.snapshotId, manifest: record.manifest! },
          source: { kind: "session", artifact: "live-session", transactionId: record.id },
          promoted: { by: "reviewer", at: props.now() },
        }),
      );
    const blob = new Blob([`${JSON.stringify(promoted, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "precedent-candidates.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setSaved(`${promoted.length} candidate(s) written to a promotion file — the store in this tab is unchanged`);
  };

  return (
    <details class="memory-panel" open>
      <summary>
        Memory · {store === undefined ? "no store shipped for this world" : `${store.precedents.length} precedents, ${props.on ? "door open" : "door shut"}`}
      </summary>
      <div class="memory-body">
        <label class="fine" title="show each ask the store's nearest accepted exchanges as examples of which door to take — ids and kinds, never a value">
          <input type="checkbox" checked={props.on} disabled={store === undefined} onChange={(event) => props.onToggle(event.currentTarget.checked)} /> precedents
        </label>
        {store !== undefined && (
          <p class="fine mono">
            pack {store.packId} · {store.precedents.length} precedents · {precedentStoreDigest(store)}
          </p>
        )}
        <p class="fine">
          The store is read by this tab and written by nobody here: a precedent enters it only by a reviewed act. Below,
          the exchanges the kernel accepted this session — tick the ones that answered what was asked, and download
          them as candidates for a pull request.
        </p>
        {candidates.length === 0 ? (
          <p class="fine">No accepted exchange yet.</p>
        ) : (
          <ul class="memory-candidates">
            {candidates.map((record) => (
              <li>
                <label>
                  <input type="checkbox" checked={marked.has(record.id)} onChange={(event) => toggle(record.id, event.currentTarget.checked)} /> mark on target ·{" "}
                  <span class="mono">{record.id}</span> · "{askOf(record)}"
                </label>
                <pre class="dev-text">{renderShape(shapeOf(record.manifest!))}</pre>
              </li>
            ))}
          </ul>
        )}
        <button type="button" class="quiet" disabled={marked.size === 0} onClick={download}>
          Download {marked.size} candidate(s) for promotion
        </button>
        {saved !== null && <span class="fine"> {saved}</span>}
      </div>
    </details>
  );
}
