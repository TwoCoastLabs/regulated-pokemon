/**
 * The dev trace is observation only: it must record everything that crosses
 * the provider seam and change nothing that does. Both halves are asserted —
 * what the tap writes down, and that the tapped provider is behaviourally
 * indistinguishable from the bare one, failures included.
 */

import { describe, expect, it } from "vitest";

import type { CompletionRequest, ModelProvider } from "../harness/provider.js";
import { ScriptedProvider } from "../harness/provider.js";
import { agentReport, createDevTrace, type DevTraceMeta, type ModelCallStart, type ModelCallTrace } from "./devtrace.js";
import { startSession } from "./session.js";

const REQUEST: CompletionRequest = {
  purpose: "scope",
  prompt: "the trainer said: I play Red",
  hint: { scenarioId: "dev-trace-test" },
};

/** A fake pair of clocks: wall time ticks one second, latency ticks 40ms. */
function clocks() {
  let seconds = 0;
  let millis = 0;
  return {
    now: () => `2026-01-01T00:00:0${seconds++}Z`,
    elapsedMs: () => (millis += 40),
  };
}

describe("the tap records the seam without changing it", () => {
  it("records purpose, prompt, response, usage and latency, in call order", async () => {
    const trace = createDevTrace(clocks());
    const provider = trace.tap(new ScriptedProvider("scripted", (request) => `echo: ${request.purpose}`));

    const first = await provider.complete(REQUEST);
    await provider.complete({ ...REQUEST, purpose: "answer", schema: { name: "answer-plan", schema: {} } });

    expect(first.text).toBe("echo: scope");
    expect(trace.calls.map((call) => call.seq)).toEqual([1, 2]);
    const [scope, answer] = trace.calls;
    expect(scope).toMatchObject({
      kind: "model-call",
      purpose: "scope",
      prompt: REQUEST.prompt,
      response: "echo: scope",
      latencyMs: 40,
    });
    expect(scope?.usage?.calls).toBe(1);
    expect(scope?.schema).toBeUndefined();
    expect(answer?.schema).toBe("answer-plan");
  });

  it("passes the provider id through untouched", () => {
    const trace = createDevTrace(clocks());
    expect(trace.tap(new ScriptedProvider("the-id", () => "")).id).toBe("the-id");
  });

  it("records a failure and rethrows it — observed, never swallowed", async () => {
    const trace = createDevTrace(clocks());
    const failing: ModelProvider = {
      id: "failing",
      complete: () => Promise.reject(new Error("the provider is down")),
    };

    await expect(trace.tap(failing).complete(REQUEST)).rejects.toThrow("the provider is down");
    expect(trace.calls).toHaveLength(1);
    expect(trace.calls[0]).toMatchObject({ error: "the provider is down", latencyMs: 40 });
    expect(trace.calls[0]?.response).toBeUndefined();
  });

  it("hands each recorded call to the mirror hook, after recording it", async () => {
    const mirrored: ModelCallTrace[] = [];
    const trace = createDevTrace({ ...clocks(), onCall: (call) => mirrored.push(call) });
    await trace.tap(new ScriptedProvider("scripted", () => "fine")).complete(REQUEST);

    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]).toBe(trace.calls[0]);
  });

  it("announces each call as it begins — before the provider is asked, with the same seq the record will carry", async () => {
    const order: string[] = [];
    const starts: ModelCallStart[] = [];
    const trace = createDevTrace({
      ...clocks(),
      onCallStart: (call) => {
        starts.push(call);
        order.push(`start ${call.seq}`);
      },
      onCall: (call) => order.push(`done ${call.seq}`),
    });
    const doors = { reference: "retrieval", routes: [], clarify: false, suggest: false, feedback: [] } as const;
    const provider = trace.tap(
      new ScriptedProvider("scripted", (request) => {
        order.push(`asked ${request.purpose}`);
        return "fine";
      }),
    );
    await provider.complete(REQUEST);
    await provider.complete({ ...REQUEST, purpose: "answer", hint: { ...REQUEST.hint, doors } });

    expect(order).toEqual(["start 1", "asked scope", "done 1", "start 2", "asked answer", "done 2"]);
    expect(starts.map((call) => call.purpose)).toEqual(["scope", "answer"]);
    expect(starts[0]).not.toHaveProperty("doors");
    expect(starts[1]?.doors).toEqual(doors);
    expect(starts[1]?.at).toBe(trace.calls[1]?.at);
  });
});

describe("the agent report", () => {
  const META: DevTraceMeta = {
    model: "test/model",
    mode: "league",
    persona: "adversarial",
    snapshotId: "kanto-red-blue",
    packId: "indigo-accord-v2",
  };

  it("is self-describing and carries the session record beside the calls", async () => {
    const trace = createDevTrace(clocks());
    await trace.tap(new ScriptedProvider("scripted", () => "fine")).complete(REQUEST);

    const report = agentReport(META, startSession(), trace.calls) as Record<string, unknown>;
    expect(report.kind).toBe("live-session-dev-trace");
    expect(typeof report.what).toBe("string");
    expect(report.meta).toEqual(META);
    expect(report.phase).toBe("gathering");
    expect(report.modelCalls).toHaveLength(1);
    expect(report.records).toEqual([]);
    // The ledger rides on the report: an agent reading the trace file gets
    // the same trail the page draws. Nothing said yet, so nothing on it.
    expect(report.ledger).toEqual([]);
    expect(report.notes).toEqual([]);
    // The report must round-trip as JSON — it exists to be pasted.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("the doors a call held open ride on the trace", () => {
  it("copies the request's door state when the step declared one, and records none when it did not", async () => {
    const { now, elapsedMs } = clocks();
    const trace = createDevTrace({ now, elapsedMs });
    const provider = trace.tap(new ScriptedProvider("m", () => "ok"));
    const doors = { reference: "retrieval" as const, routes: ["listing"], clarify: true, suggest: false, feedback: [] };
    await provider.complete({ ...REQUEST, purpose: "answer", hint: { ...REQUEST.hint, doors } });
    await provider.complete(REQUEST);
    expect(trace.calls[0]!.doors).toEqual(doors);
    expect(trace.calls[1]).not.toHaveProperty("doors");
  });
});
