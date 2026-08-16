/**
 * The question bank is reviewed data, so the loader is where a wrong or drifted
 * entry is caught. The first block asserts the *shipped* bank is well-formed
 * and covers the taxonomy by construction — a coverage map is only honest if
 * its inputs span every disposition and every claim kind. The second refuses
 * the malformations that would make the map lie.
 */

import { describe, expect, it } from "vitest";

import type { Claim } from "../kernel/contracts.js";
import {
  BANK_PATH,
  BANK_SCHEMA_VERSION,
  CLAIM_KINDS,
  type ClaimKind,
  loadBank,
  type QuestionBank,
  readBank,
} from "./bank.js";
import { DISPOSITIONS } from "./playability.js";

const bank = readBank();

function loadWith(sabotage: (draft: QuestionBank) => void): () => unknown {
  const draft = structuredClone(bank) as QuestionBank;
  sabotage(draft);
  return () => loadBank(draft);
}

describe("the shipped bank holds up", () => {
  it("loads from disk without a violation", () => {
    expect(() => readBank(BANK_PATH)).not.toThrow();
  });

  it("carries a substantial, diverse set", () => {
    expect(bank.entries.length).toBeGreaterThanOrEqual(100);
  });

  it("exercises every disposition", () => {
    const present = new Set(bank.entries.map((entry) => entry.disposition));
    for (const disposition of DISPOSITIONS) {
      expect(present.has(disposition), `no entry for ${disposition}`).toBe(true);
    }
  });

  it("exercises every claim kind within answerable", () => {
    const answered = new Set(
      bank.entries
        .filter((entry) => entry.disposition === "answerable")
        .flatMap((entry) => entry.expectClaimKinds ?? []),
    );
    for (const kind of CLAIM_KINDS) {
      expect(answered.has(kind), `no answerable entry exercises the ${kind} claim`).toBe(true);
    }
  });

  it("names the ceiling on every unanswerable entry", () => {
    for (const entry of bank.entries) {
      if (entry.disposition === "needs-data" || entry.disposition === "needs-claim-kind") {
        expect((entry.notes ?? "").trim().length, `${entry.id} states no ceiling`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps CLAIM_KINDS in step with the kernel's Claim union", () => {
    // A compile-time pin: if a claim kind is added or renamed in contracts.ts,
    // this stops compiling until CLAIM_KINDS is updated to match.
    const _pinned: Record<Claim["kind"], true> = {
      fact: true,
      count: true,
      membership: true,
      ranking: true,
      recommendation: true,
      action: true,
    };
    expect(new Set<ClaimKind>(CLAIM_KINDS)).toEqual(new Set(Object.keys(_pinned) as ClaimKind[]));
  });
});

describe("a bank that would make the map lie is refused by name", () => {
  const named = (fn: () => unknown, rule: string) => {
    try {
      fn();
    } catch (error) {
      expect(String((error as { message?: string }).message)).toContain(rule);
      return;
    }
    throw new Error(`expected a violation containing "${rule}"`);
  };

  it("refuses input that is not an object at all", () => {
    named(() => loadBank(null), "bank-malformed");
    named(() => loadBank("not a bank"), "bank-malformed");
  });

  it("refuses an unsupported schema version", () => {
    named(loadWith((draft) => ((draft as { bankVersion: number }).bankVersion = 99)), "bank-schema-unsupported");
  });

  it("refuses an empty bank", () => {
    named(loadWith((draft) => ((draft as unknown as { entries: unknown[] }).entries = [])), "bank-malformed");
  });

  it("refuses a duplicate id", () => {
    named(loadWith((draft) => (draft.entries as unknown[]).push({ ...draft.entries[0] })), "bank-duplicate-id");
  });

  it("refuses an entry with empty question text", () => {
    named(loadWith((draft) => ((draft.entries[0] as { intent: string }).intent = "  ")), "bank-entry-empty");
  });

  it("refuses an unknown disposition", () => {
    named(loadWith((draft) => ((draft.entries[0] as { disposition: string }).disposition = "vibes")), "bank-unknown-disposition");
  });

  it("refuses an answerable that names no claim kind", () => {
    named(
      loadWith((draft) => {
        const entry = draft.entries.find((e) => e.disposition === "answerable")!;
        delete (entry as { expectClaimKinds?: unknown }).expectClaimKinds;
      }),
      "bank-claims-missing",
    );
  });

  it("refuses a claim kind the kernel cannot compile", () => {
    named(
      loadWith((draft) => {
        const entry = draft.entries.find((e) => e.disposition === "answerable")!;
        (entry as unknown as { expectClaimKinds: string[] }).expectClaimKinds = ["prophecy"];
      }),
      "bank-claim-kind-unknown",
    );
  });

  it("refuses a profile too thin to establish scope", () => {
    named(
      loadWith((draft) => {
        delete (draft.entries[0]!.profile as { badgeLevel?: number }).badgeLevel;
      }),
      "bank-profile-incomplete",
    );
  });

  it("throws named when the bank cannot be read from disk", () => {
    expect(() => readBank(`${BANK_PATH}.missing`)).toThrow("bank-unreadable");
  });

  it("refuses an unanswerable entry that names no ceiling", () => {
    named(
      loadWith((draft) => {
        const entry = draft.entries.find((e) => e.disposition === "needs-data")!;
        delete (entry as { notes?: string }).notes;
      }),
      "bank-ceiling-unstated",
    );
  });
});

// A trivial use so the schema version is referenced and drift is caught.
it("declares the expected schema version", () => {
  expect(bank.bankVersion).toBe(BANK_SCHEMA_VERSION);
});
