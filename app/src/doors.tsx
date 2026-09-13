/**
 * The doors, drawn (dogfood, 2026-09-13: "visualize the door idea — the
 * driver offers a few doors and adjusts the prompt dynamically").
 *
 * A *door* is an offer the driver writes into the prompt beyond the
 * question: certified rows to compose from, a grammar narrowed to the claim
 * kinds the question nominates, a route the model may name instead of
 * writing claims (the driver then composes from the records), leave to ask
 * a clarifying question, leave to suggest a next step, and — on the one
 * retry — the previous reply's refusal in fixed wording. Each call's doors
 * are declared on the request (`DoorState`) and ride on the trace, so the
 * strip under a call is read, not inferred from the prompt, and the
 * difference between two calls is the driver's adjustment made visible: a
 * door withdrawn in silence, a reason fed back.
 */
import type { DoorState } from "../../src/harness/provider.js";

type Chip = { label: string; state: string; tone: "open" | "closed" | "withdrawn" | "opened" | "fed-back" };

/** The chips for one call, each marked when it differs from the call before. */
function chipsOf(doors: DoorState, previous: DoorState | undefined): Chip[] {
  const chips: Chip[] = [];
  const changed = (now: string, before: string | undefined, open: boolean): Chip["tone"] =>
    before !== undefined && before !== now ? (open ? "opened" : "withdrawn") : open ? "open" : "closed";

  const reference = { retrieval: "rows for this ask", grounded: "the whole registry", none: "no rows" }[doors.reference];
  chips.push({ label: "certified rows", state: reference, tone: changed(doors.reference, previous?.reference, doors.reference !== "none") });

  const grammar = doors.fillerKinds === undefined ? "every claim kind" : doors.fillerKinds.length === 0 ? "no aggregates" : `aggregates: ${doors.fillerKinds.join(", ")}`;
  const grammarBefore = previous === undefined ? undefined : previous.fillerKinds === undefined ? "every claim kind" : previous.fillerKinds.join(",");
  chips.push({ label: "grammar", state: grammar, tone: changed(doors.fillerKinds === undefined ? "every claim kind" : doors.fillerKinds.join(","), grammarBefore, true) });

  const routeIds = [...new Set([...(previous?.routes ?? []), ...doors.routes])];
  for (const id of routeIds) {
    const now = doors.routes.includes(id);
    const before = previous?.routes.includes(id);
    chips.push({
      label: `door: ${id}`,
      state: now ? "offered" : before === true ? "withdrawn" : "shut",
      tone: before === undefined ? (now ? "open" : "closed") : before === now ? (now ? "open" : "closed") : now ? "opened" : "withdrawn",
    });
  }
  if (routeIds.length === 0) chips.push({ label: "doors", state: "none offered", tone: "closed" });

  chips.push({ label: "clarify", state: doors.clarify ? "may ask" : "must answer", tone: changed(String(doors.clarify), previous === undefined ? undefined : String(previous.clarify), doors.clarify) });
  chips.push({ label: "suggest", state: doors.suggest ? "may suggest" : "no suggestions", tone: changed(String(doors.suggest), previous === undefined ? undefined : String(previous.suggest), doors.suggest) });

  // Reasons, not lines: the feedback block carries the named refusals
  // (`driver/…`, `IA-n/…`) and one closing instruction; only the named
  // ones are reasons, and the count says so.
  const fed = doors.feedback.filter((line) => /^(driver\/|IA-\d)/.test(line)).length;
  chips.push({
    label: "feedback",
    state: fed === 0 ? "nothing fed back" : `${fed} reason${fed === 1 ? "" : "s"} fed back`,
    tone: fed === 0 ? "closed" : "fed-back",
  });
  return chips;
}

/** A caption split over two lines when it would crowd its neighbour —
 * balanced on a word boundary, so "the whole registry" reads as two short
 * lines rather than running under the next door. */
function captionLines(text: string): [string] | [string, string] {
  if (text.length <= 13) return [text];
  const words = text.split(" ");
  let best = 1;
  let gap = Infinity;
  for (let cut = 1; cut < words.length; cut += 1) {
    const left = words.slice(0, cut).join(" ").length;
    const right = words.slice(cut).join(" ").length;
    if (Math.abs(left - right) < gap) {
      gap = Math.abs(left - right);
      best = cut;
    }
  }
  return words.length === 1 ? [text] : [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/**
 * The doors one call held open, drawn: one door glyph per offer, open or
 * shut, and — against the call before — a door withdrawn (shut, struck
 * through, red), a door opened (green), reasons fed back (amber). `taken`
 * marks the door the model walked through on this call, when the reply
 * named one. A row per call, so a reader watches the doors change turn by
 * turn instead of reading it off two strips.
 */
export function DoorRow(props: { doors: DoorState; previous?: DoorState; taken?: string }) {
  const chips = chipsOf(props.doors, props.previous);
  const slot = 100;
  const width = chips.length * slot + 12;
  return (
    <figure class="door-row">
      <svg viewBox={`0 0 ${width} 102`} role="img" aria-label={chips.map((chip) => `${chip.label}: ${chip.state}`).join("; ")}>
        {chips.map((chip, index) => {
          const x = 6 + index * slot;
          const isDoor = chip.label.startsWith("door: ");
          const name = isDoor ? chip.label.slice("door: ".length) : chip.label;
          const open = chip.tone === "open" || chip.tone === "opened" || chip.tone === "fed-back";
          const taken = isDoor && props.taken === name;
          const stroke =
            chip.tone === "withdrawn" ? "var(--seal)" : chip.tone === "opened" ? "var(--ledger)" : chip.tone === "fed-back" || taken ? "var(--model)" : open ? "var(--indigo)" : "var(--muted)";
          const leafFill = taken ? "var(--model-tint)" : chip.tone === "withdrawn" ? "var(--seal-tint)" : chip.tone === "opened" ? "var(--ledger-tint)" : chip.tone === "fed-back" ? "var(--model-tint)" : open ? "var(--indigo-tint)" : "var(--line)";
          const cx = x + slot / 2;
          return (
            <g>
              {/* the frame */}
              <rect x={cx - 14} y={6} width={28} height={40} rx={2} fill="none" stroke={stroke} stroke-width={1.4} />
              {open ? (
                // the leaf swung out: an open door
                <path d={`M ${cx - 10} 10 L ${cx + 10} 3 L ${cx + 10} 43 L ${cx - 10} 46 Z`} fill={leafFill} stroke={stroke} stroke-width={1.2} />
              ) : (
                // the leaf in its frame: a shut door
                <rect x={cx - 10} y={10} width={20} height={32} fill={leafFill} stroke={stroke} stroke-width={1.2} />
              )}
              <circle cx={open ? cx + 6 : cx + 6} cy={27} r={1.6} fill={stroke} />
              {chip.tone === "withdrawn" && (
                <g stroke="var(--seal)" stroke-width={2}>
                  <line x1={cx - 18} y1={2} x2={cx + 18} y2={50} />
                  <line x1={cx + 18} y1={2} x2={cx - 18} y2={50} />
                </g>
              )}
              {taken && (
                <path d={`M ${cx - 30} 27 L ${cx - 18} 27`} stroke="var(--model)" stroke-width={2} marker-end="url(#door-row-arrow)" />
              )}
              <text x={cx} y={62} text-anchor="middle" font-size="10" font-weight="600" fill={stroke}>
                {name}
              </text>
              {captionLines(taken ? "taken" : chip.state).map((line, row) => (
                <text x={cx} y={76 + row * 11} text-anchor="middle" font-size="9" fill="currentColor">
                  {line}
                </text>
              ))}
            </g>
          );
        })}
        <defs>
          <marker id="door-row-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--model)" />
          </marker>
        </defs>
      </svg>
      {props.doors.feedback.length > 0 && (
        <ul class="door-feedback-lines mono">
          {props.doors.feedback.map((line) => (
            <li>{line}</li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** The doors one call held open, as a row of chips; with the call before,
 * each change is marked — withdrawn, opened, fed back. */
export function DoorStrip(props: { doors: DoorState; previous?: DoorState }) {
  const chips = chipsOf(props.doors, props.previous);
  return (
    <ul class="door-strip" aria-label="the doors this call held open">
      {chips.map((chip) => (
        <li class={`door door-${chip.tone}`} title={chip.tone === "withdrawn" ? "removed since the call before" : chip.tone === "opened" ? "added since the call before" : chip.tone === "fed-back" ? "carried back from the reply before" : undefined}>
          <span class="door-label">{chip.label}</span>
          <span class="door-state">{chip.state}</span>
        </li>
      ))}
      {props.doors.feedback.length > 0 && (
        <li class="door-feedback-lines mono">
          {props.doors.feedback.map((line) => (
            <span>{line}</span>
          ))}
        </li>
      )}
    </ul>
  );
}

/**
 * The trick, drawn once: the question and the doors become a prompt; the
 * model replies with claims or by naming a door; claims go to the kernel,
 * a named door to the driver's check, which composes from the records or
 * refuses; a refusal withdraws the door for one call and asks again in
 * silence, a kernel denial is fed back by name and asked again once.
 */
export function DoorLegend() {
  return (
    <details class="door-legend">
      <summary>How the doors work</summary>
      <figure>
        <svg viewBox="0 0 780 330" role="img" aria-label="The question and the doors are assembled into a prompt; the model answers with claims or by naming a door; claims go to the kernel, a named door to the driver's check; a refused door is withdrawn for one call and the model asked again with nothing fed back; a kernel denial is fed back by name and asked again once.">
          <defs>
            <marker id="door-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <g fill="none" stroke="currentColor" stroke-width="1.2">
            {/* your question */}
            <rect x="16" y="128" width="112" height="44" rx="4" />
            {/* the prompt, assembled */}
            <rect x="170" y="78" width="188" height="150" rx="4" />
            {/* the model — the one amber node */}
            <rect x="402" y="128" width="96" height="44" rx="22" stroke="var(--model)" fill="var(--model-tint)" />
            {/* claims */}
            <rect x="540" y="66" width="98" height="40" rx="4" />
            {/* a door named */}
            <rect x="540" y="192" width="110" height="40" rx="4" />
            {/* the kernel */}
            <rect x="662" y="66" width="112" height="40" rx="4" />
            {/* the driver's check */}
            <rect x="662" y="192" width="112" height="40" rx="4" />
            {/* arrows */}
            <path d="M 128 150 L 168 150" marker-end="url(#door-arrow)" />
            <path d="M 358 150 L 400 150" marker-end="url(#door-arrow)" />
            <path d="M 498 142 L 538 90" marker-end="url(#door-arrow)" />
            <path d="M 498 158 L 538 208" marker-end="url(#door-arrow)" />
            <path d="M 638 86 L 660 86" marker-end="url(#door-arrow)" />
            <path d="M 650 212 L 660 212" marker-end="url(#door-arrow)" />
            {/* the check composes from the records → the kernel */}
            <path d="M 740 190 L 740 110" marker-end="url(#door-arrow)" />
            {/* refused: withdrawn, asked again — nothing fed back */}
            <path d="M 700 232 L 700 300 L 264 300 L 264 232" stroke-dasharray="4 3" marker-end="url(#door-arrow)" />
            {/* denied: fed back by name, asked again once */}
            <path d="M 718 64 L 718 26 L 264 26 L 264 76" stroke-dasharray="4 3" marker-end="url(#door-arrow)" />
          </g>
          <g fill="currentColor" font-size="12" text-anchor="middle">
            <text x="72" y="154">your question</text>
            <text x="264" y="96" font-weight="600">the prompt, assembled</text>
            <text x="450" y="154" fill="var(--model)" font-weight="600">the model</text>
            <text x="589" y="90">claims</text>
            <text x="595" y="216">a door named</text>
            <text x="718" y="90">the kernel</text>
            <text x="718" y="216">the driver's check</text>
          </g>
          <g fill="currentColor" font-size="11" text-anchor="start">
            <text x="180" y="118">· certified rows (retrieval)</text>
            <text x="180" y="136">· grammar, gated to the ask</text>
            <text x="180" y="154">· doors: listing · profile</text>
            <text x="180" y="172">· leave to clarify · to suggest</text>
            <text x="180" y="190">· feedback (on the one retry)</text>
            <text x="180" y="214" font-style="italic">each an offer, none an order</text>
          </g>
          <g fill="currentColor" font-size="11" text-anchor="middle">
            <text x="620" y="60">verified by name</text>
            <text x="734" y="146" text-anchor="end">composed from</text>
            <text x="734" y="160" text-anchor="end">the records</text>
            <text x="482" y="316">refused → the door is withdrawn for one call and the model asked again — nothing is fed back</text>
            <text x="482" y="18">denied → the reason is fed back by name and the model asked again, once</text>
          </g>
        </svg>
        <figcaption class="fine">
          A door is an offer the driver writes into the prompt; the model may take it or write claims. What a door
          composes still faces the kernel whole. Under each call below, a row of doors shows which offers that call held
          open — an open leaf is offered, a shut one is not, a struck-through red one was withdrawn since the call before,
          an amber one is the door the model took, or a reason fed back.
        </figcaption>
      </figure>
    </details>
  );
}
