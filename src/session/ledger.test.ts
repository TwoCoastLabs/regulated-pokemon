/**
 * The driver's ledger (issue #158): steps append to the open exchange, an
 * exchange closes into the list with its outcome, and a reader gets the
 * whole session as one sequence or the closed exchanges plus the open one.
 */

import { describe, expect, it } from "vitest";

import { allSteps, closeLedger, type Ledgered, ledgerOf, step } from "./ledger.js";

const empty: Ledgered = { steps: [], exchanges: [] };

describe("the ledger", () => {
  it("appends steps in order, with a count when one is given, and the refuser's lines when a step carries them", () => {
    const one = step(empty, "t1", "trainer", "trainer/said", "how fast is Pikachu?");
    const two = step(one, "t2", "driver", "linking/off-ask-dropped", "1 claim(s) dropped", 1);
    const three = step(two, "t3", "kernel", "verdict/denied", "the kernel denied the draft: IA-3/fabricated-entity", undefined, ['IA-3/fabricated-entity: "gym-badge" is not certified']);
    // Empty lines are no lines: the step stays the one line it was.
    const four = step(three, "t4", "driver", "route/refused", "refused", undefined, []);
    expect(four.steps).toEqual([
      { at: "t1", lane: "trainer", code: "trainer/said", text: "how fast is Pikachu?" },
      { at: "t2", lane: "driver", code: "linking/off-ask-dropped", text: "1 claim(s) dropped", count: 1 },
      { at: "t3", lane: "kernel", code: "verdict/denied", text: "the kernel denied the draft: IA-3/fabricated-entity", lines: ['IA-3/fabricated-entity: "gym-badge" is not certified'] },
      { at: "t4", lane: "driver", code: "route/refused", text: "refused" },
    ]);
  });

  it("closes the open exchange into the list with its outcome and record id, and nothing when there is nothing to close", () => {
    const open = step(empty, "t1", "trainer", "trainer/said", "q");
    const closed = closeLedger(open, "q", "answered", "session-1");
    expect(closed.steps).toEqual([]);
    expect(closed.exchanges).toEqual([{ opening: "q", steps: open.steps, outcome: "answered", transactionId: "session-1" }]);
    expect(closeLedger(empty, "", "passed")).toBe(empty);
    const passed = closeLedger(open, "q", "passed");
    expect(passed.exchanges[0]).not.toHaveProperty("transactionId");
  });

  it("reads the whole session as one sequence, and files the open exchange as open", () => {
    const first = closeLedger(step(empty, "t1", "trainer", "trainer/said", "a"), "a", "answered", "session-1");
    const second = step(first, "t2", "trainer", "trainer/said", "b");
    expect(allSteps(second).map((entry) => entry.at)).toEqual(["t1", "t2"]);
    expect(ledgerOf(second, "b")).toEqual([...first.exchanges, { opening: "b", steps: second.steps, outcome: "open" }]);
    expect(ledgerOf(first, "")).toBe(first.exchanges);
  });
});
