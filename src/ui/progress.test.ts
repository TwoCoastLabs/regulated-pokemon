import { describe, expect, it } from "vitest";

import type { ModelCallStart } from "../session/devtrace.js";
import { type DriverStep, LEDGER_CODES, type LedgerCode } from "../session/ledger.js";
import { progressLine } from "./progress.js";

const step = (code: LedgerCode): DriverStep => ({ at: "2026-01-01T00:00:00.000Z", lane: "driver", code, text: code });
const call = (purpose: ModelCallStart["purpose"], seq = 1, doors?: ModelCallStart["doors"]): ModelCallStart => ({
  kind: "model-call-start",
  seq,
  at: "2026-01-01T00:00:00.000Z",
  purpose,
  ...(doors === undefined ? {} : { doors }),
});
const open = (feedback: readonly string[] = []) => ({ reference: "retrieval" as const, routes: [], clarify: true, suggest: true, feedback });

describe("the exchange in progress, as one line", () => {
  it("never reads empty, whatever was recorded — every registered code has a line, and an unregistered one reads as work", () => {
    for (const code of Object.keys(LEDGER_CODES) as LedgerCode[]) {
      const line = progressLine({ step: step(code) });
      expect(line.length, code).toBeGreaterThan(0);
      expect(line, code).toMatch(/…$/);
    }
    expect(progressLine({})).toBe("Reading your words…");
    expect(progressLine({ step: { ...step("trainer/said"), code: "future/unknown" as LedgerCode } })).toBe("Working…");
  });

  it("says what the model is being asked, by the step of the call", () => {
    expect(progressLine({ call: call("scope"), step: step("trainer/said") })).toBe("Asking the Advisor to read which game you mean…");
    expect(progressLine({ call: call("phrase"), step: step("scope/asked") })).toBe("Asking the Advisor to put the League's question in its own words…");
    expect(progressLine({ call: call("lesson"), step: step("route/narrowed") })).toBe("Asking the Advisor what kind of question this is…");
    expect(progressLine({ call: call("answer", 1, open()), step: step("scope/granted") })).toBe("Asking the Advisor, with the certified records it needs in hand…");
    expect(progressLine({ call: call("answer", 1, { ...open(), reference: "none" }), step: step("scope/granted") })).toBe("Asking the Advisor for an answer…");
    expect(progressLine({ call: call("answer") })).toBe("Asking the Advisor for an answer…");
  });

  it("a round sent back says why, in the player's words, and counts the call", () => {
    expect(progressLine({ call: call("answer", 2, open(["IA-3/fabricated-entity: …"])), step: step("verdict/denied") })).toBe(
      "The League refused the Advisor's draft — asking again, with the reason (call 2)…",
    );
    expect(progressLine({ call: call("answer", 2, open()), step: step("route/withdrawn") })).toBe("Asking the Advisor again, without the door it tried (call 2)…");
    expect(progressLine({ call: call("answer", 3, open(["…"])), step: step("route/refused-back") })).toBe(
      "Telling the Advisor the door it tried is shut, and asking again (call 3)…",
    );
    expect(progressLine({ call: call("answer", 2, open(["…"])), step: step("linking/carried-back") })).toBe("Sending the reply back to the Advisor to fix a reading (call 2)…");
    // Feedback in the doors with no sent-back step before it still reads as a second try.
    expect(progressLine({ call: call("answer", 2, open(["…"])), step: step("memory/held") })).toBe("Asking the Advisor again, with what was wrong (call 2)…");
  });

  it("between calls, the step shows through", () => {
    expect(progressLine({ step: step("model/answer") })).toBe("Reading the Advisor's reply…");
    expect(progressLine({ step: step("linking/off-ask-dropped") })).toBe("Holding the Advisor's reply to your question…");
    expect(progressLine({ step: step("verdict/allowed") })).toBe("The League allowed it — filing the record…");
    expect(progressLine({ step: step("verdict/denied") })).toBe("The League refused the Advisor's draft…");
    expect(progressLine({ step: step("route/served") })).toBe("Serving the answer from the official records…");
    expect(progressLine({ step: step("record/answered") })).toBe("Filed — drawing the page…");
    expect(progressLine({ step: step("memory/empty") })).toBe("Looking up earlier answered asks…");
  });

  it("speaks the player's register — no article code, no step code, no vocabulary", () => {
    const lines = [
      ...(Object.keys(LEDGER_CODES) as LedgerCode[]).map((code) => progressLine({ step: step(code) })),
      ...(["scope", "phrase", "lesson", "answer", "raw"] as const).map((purpose) => progressLine({ call: call(purpose, 2, open(["x"])), step: step("verdict/denied") })),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/IA-\d|\w+\/\w+|manifest|ledger|nominat|kernel/i);
    }
  });
});
