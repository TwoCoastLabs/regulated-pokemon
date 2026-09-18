/**
 * The exchange in progress, as one line under the chat.
 *
 * While the driver works, the live page used to show one fixed line
 * ("The Advisor is thinking…") until the whole exchange returned. The
 * driver reports every ledger step as it takes it (`SessionDeps.onStep`)
 * and the dev trace announces every model call as it begins
 * (`DevTraceDeps.onCallStart`), so the page knows at each moment which
 * step was taken last and whether a model is being asked — and this module
 * turns that into the player's sentence. Read, never narrated: a line here
 * says what the driver just recorded or what the model is being asked, not
 * what the model is "thinking".
 *
 * The model calls are the slow part; the steps between them take
 * milliseconds. So the line is mostly the call in flight, said with the
 * step that preceded it — a first ask, a draft the League refused and sent
 * back, a door withdrawn — and the steps show through only in the gaps.
 * Copy lives here, pure and tested, like the rest of the player's register
 * ({@link plainRefusalLead}).
 */

import type { ModelCallStart } from "../session/devtrace.js";
import { type DriverStep, sentBackModeOf } from "../session/ledger.js";

export interface Progress {
  /** The last step the driver reported, if any. */
  step?: DriverStep;
  /** The model call in flight, if one is. */
  call?: ModelCallStart;
}

/** The line to show while the exchange is open — never empty. */
export function progressLine(progress: Progress): string {
  const { step, call } = progress;
  if (call !== undefined) return asking(call, step);
  if (step === undefined) return "Reading your words…";
  return afterStep(step);
}

/** The model is being asked: say what for, in the light of the step before. */
function asking(call: ModelCallStart, step: DriverStep | undefined): string {
  const nth = call.seq > 1 ? ` (call ${call.seq})` : "";
  switch (call.purpose) {
    case "scope":
      return `Asking the Advisor to read which game you mean${nth}…`;
    case "phrase":
      return `Asking the Advisor to put the League's question in its own words${nth}…`;
    case "lesson":
      return `Asking the Advisor what kind of question this is${nth}…`;
    case "raw":
      return `Asking the model, ungoverned${nth}…`;
    case "answer":
      return `${answerAsk(call, step)}${nth}…`;
  }
}

function answerAsk(call: ModelCallStart, step: DriverStep | undefined): string {
  const code = step?.code;
  if (code === "verdict/denied") return "The League refused the Advisor's draft — asking again, with the reason";
  if (code === "route/refused-back") return "Telling the Advisor the door it tried is shut, and asking again";
  if (code === "route/withdrawn") return "Asking the Advisor again, without the door it tried";
  if (code !== undefined && sentBackModeOf(code) === "fed-back") return "Sending the reply back to the Advisor to fix a reading";
  if ((call.doors?.feedback.length ?? 0) > 0) return "Asking the Advisor again, with what was wrong";
  switch (call.doors?.reference) {
    case "retrieval":
      return "Asking the Advisor, with the certified records it needs in hand";
    case "grounded":
      return "Asking the Advisor, with the whole certified registry in hand";
    default:
      return "Asking the Advisor for an answer";
  }
}

/** Between calls: what the driver just recorded. Codes are grouped by
 * subject; an unregistered one reads as work in progress, never as nothing. */
function afterStep(step: DriverStep): string {
  const [subject] = step.code.split("/");
  switch (step.code) {
    case "scope/granted":
      return "Your game is on record — reading your question…";
    case "scope/asked":
      return "Asking which game you're playing…";
    case "scope/card":
      return "Drafting a card with the Advisor's reading of your words…";
    case "scope/refused":
      return "The League refused the scope…";
    case "clarify/asked":
      return "The Advisor has a question for you…";
    case "clarify/picked":
      return "Your pick is bound — reading your question…";
    case "route/served":
      return "Serving the answer from the official records…";
    case "route/refused":
      return "The Advisor tried a door it couldn't take — the rest of the reply stands…";
    case "model/retry-failed":
      return "The Advisor didn't answer the second time…";
    case "verdict/allowed":
      return "The League allowed it — filing the record…";
    case "verdict/denied":
      return "The League refused the Advisor's draft…";
    case "linking/carried-back":
    case "reply/carried-back":
      return "Sending the reply back to the Advisor…";
    case "act/consent-requested":
      return "Putting the act to you for consent…";
    case "act/executed":
      return "Done — filing the record…";
    default:
      break;
  }
  switch (subject) {
    case "trainer":
      return "Reading your words…";
    case "memory":
      return "Looking up earlier answered asks…";
    case "route":
      return "Choosing the doors to hold open…";
    case "model":
      return "Reading the Advisor's reply…";
    case "linking":
    case "guard":
    case "boundary":
    case "repair":
      return "Holding the Advisor's reply to your question…";
    case "record":
      return "Filed — drawing the page…";
    case "note":
      return "Writing the Advisor's note…";
    default:
      return "Working…";
  }
}
