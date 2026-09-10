/**
 * The governance tax over hand-built runs: governed beside raw, per
 * disposition, count and percentage together, and the stable core as the
 * headline when the run repeated.
 */

import { describe, expect, it } from "vitest";

import type { BankRun } from "./bank-run.js";
import type { RawBankRun } from "./bank-raw.js";
import type { Disposition } from "./playability.js";
import { emptyUsage } from "./provider.js";
import { fraction, governanceTax, renderTax } from "./tax.js";

function governed(entryId: string, disposition: Disposition, pass: boolean, repetition = 0): BankRun {
  return { entryId, disposition, opening: "q", repetition, stage: { kind: pass ? "resolved" : "abstained-answer" }, score: { pass, reason: "" }, turns: 1, detail: "" };
}

function raw(entryId: string, disposition: Disposition, apparent: boolean, verified: boolean, extra: Partial<RawBankRun> = {}): RawBankRun {
  return {
    entryId,
    disposition,
    opening: "q",
    repetition: 0,
    expressible: true,
    published: true,
    claims: [],
    rosters: [],
    apparent,
    verified,
    verifiedExcusingText: verified,
    gatedPublished: false,
    assertionViolations: verified ? 0 : 1,
    violations: verified ? [] : ["IA-2/fact-mismatch"],
    textMismatches: 0,
    omittedDisclosures: 1,
    wrongScopeClaims: 0,
    actsExecuted: 0,
    providerErrors: 0,
    usage: { ...emptyUsage(), calls: 1, costUsd: 0.001 },
    detail: "",
    ...extra,
  };
}

describe("governanceTax compares the two arms on the entries both ran", () => {
  const tax = governanceTax(
    [governed("a1", "answerable", true), governed("a2", "answerable", true), governed("a3", "answerable", false), governed("d1", "needs-data", true), governed("r1", "should-refuse", true), governed("only-governed", "answerable", true)],
    [raw("a1", "answerable", true, true), raw("a2", "answerable", true, false), raw("a3", "answerable", true, true), raw("d1", "needs-data", false, false), raw("r1", "should-refuse", false, false, { gatedPublished: true, assertionViolations: 1 }), raw("only-raw", "off-domain", true, true)],
  );

  it("keeps the raw arm's two readings apart from each other and from the governed pass", () => {
    const answerable = tax.rows.find((row) => row.disposition === "answerable")!;
    expect(answerable.entries).toBe(3);
    expect(answerable.governed).toEqual({ pass: 2, samples: 3, stable: 2 });
    expect(answerable.rawApparent).toEqual({ pass: 3, samples: 3, stable: 3 });
    expect(answerable.rawVerified).toEqual({ pass: 2, samples: 3, stable: 2 });
  });

  it("leaves out an entry only one arm ran — no comparison, no row", () => {
    expect(tax.rows.map((row) => row.disposition)).toEqual(["answerable", "needs-data", "should-refuse"]);
    expect(tax.rows.find((row) => row.disposition === "answerable")!.entries).toBe(3);
  });

  it("files the raw arm's enforcement side as its own ledger", () => {
    expect(tax.rows.find((row) => row.disposition === "should-refuse")!.gatedPublished).toBe(1);
    expect(tax.raw).toMatchObject({ runs: 6, published: 6, unusable: 0, providerErrors: 0, violatedRuns: 3, gatedPublished: 1, omittedDisclosures: 6, byCode: { "IA-2/fact-mismatch": 3 } });
    expect(tax.raw.usage.calls).toBe(6);
  });

  it("counts unusable replies and provider failures apart, and never as passes", () => {
    const t = governanceTax([governed("d1", "needs-data", true)], [raw("d1", "needs-data", false, false, { published: false, claims: [] }), raw("d1", "needs-data", false, false, { published: false, providerErrors: 1, repetition: 1 })]);
    expect(t.raw).toMatchObject({ runs: 2, published: 0, unusable: 1, providerErrors: 1 });
    expect(t.rows[0]!.rawApparent.pass).toBe(0);
  });
});

describe("with repetitions the stable core is the headline", () => {
  const tax = governanceTax(
    [governed("a1", "answerable", true, 0), governed("a1", "answerable", false, 1), governed("a2", "answerable", true, 0), governed("a2", "answerable", true, 1)],
    [raw("a1", "answerable", true, true), { ...raw("a1", "answerable", true, true), repetition: 1 }, raw("a2", "answerable", true, false), { ...raw("a2", "answerable", true, true), repetition: 1 }],
  );

  it("reads the stable core per arm — an entry that flaked on either side is not in that side's floor", () => {
    expect(tax.repetitions).toBe(2);
    const row = tax.rows[0]!;
    expect(row.governed).toEqual({ pass: 3, samples: 4, stable: 1 });
    expect(row.rawVerified).toEqual({ pass: 3, samples: 4, stable: 1 });
    expect(row.rawApparent).toEqual({ pass: 4, samples: 4, stable: 2 });
  });

  it("renders every cell as the stable core over entries, saying so", () => {
    const md = renderTax(tax);
    expect(md).toContain("N=2");
    expect(md).toContain("governed 1/2 (50%)");
    expect(md).toContain("raw, verified 1/2 (50%)");
    expect(md).toContain("raw, apparent 2/2 (100%)");
  });
});

describe("the text-excused reading sits beside verified, never instead of it", () => {
  it("counts an entry whose only false assertions were text facts as excused but not verified, and tallies the codes", () => {
    const tax = governanceTax(
      [governed("a1", "answerable", true)],
      [raw("a1", "answerable", true, false, { verifiedExcusingText: true, textMismatches: 1, violations: ["IA-2/fact-mismatch"] })],
    );
    expect(tax.rows[0]).toMatchObject({ rawVerified: { pass: 0 }, rawVerifiedExcusingText: { pass: 1 } });
    expect(tax.raw.textMismatches).toBe(1);
    const md = renderTax(tax);
    expect(md).toContain("raw, verified 0/1 (0%) · raw, verified excusing text facts 1/1 (100%)");
    expect(md).toContain("1 of those were text facts in the model's own words");
    expect(md).toContain("By article: IA-2/fact-mismatch ×1");
  });
});

describe("an entry the raw grammar cannot express is left out of the comparison, and said so", () => {
  it("removes it from every count in its row and reports governed's stable passes on it", () => {
    const tax = governanceTax(
      [governed("a1", "answerable", true), governed("lesson", "answerable", true), governed("rule", "answerable", false)],
      [raw("a1", "answerable", true, true), raw("lesson", "answerable", false, false, { expressible: false, published: true, claims: [] }), raw("rule", "answerable", false, false, { expressible: false })],
    );
    const row = tax.rows[0]!;
    expect(row.entries).toBe(1);
    expect(row.governed).toEqual({ pass: 1, samples: 1, stable: 1 });
    expect(row.rawApparent.samples).toBe(1);
    expect(row.inexpressible).toEqual({ entries: 2, governedStable: 1 });
    const md = renderTax(tax);
    expect(md).toContain("on the 1 entries the raw grammar can express");
    expect(md).toContain("2 answerable entries expect a lesson or a game-rule constant");
    expect(md).toContain("governed passed 1/2 (50%) of them stably");
    expect(md).toContain("| 2 (governed 1 stably) |");
  });
});

describe("renderTax — a count and a percentage together, never either alone", () => {
  it("formats fractions with the percentage beside the count, and a zero denominator without one", () => {
    expect(fraction(65, 79)).toBe("65/79 (82%)");
    expect(fraction(0, 96)).toBe("0/96 (0%)");
    expect(fraction(3, 0)).toBe("3/0");
  });

  it("renders the headline, the table and the raw ledger at N=1", () => {
    const md = renderTax(governanceTax([governed("a1", "answerable", true), governed("a2", "answerable", false)], [raw("a1", "answerable", true, true), raw("a2", "answerable", true, true)]));
    expect(md).toContain("## The governance tax");
    expect(md).toContain("**Answerable, on the 2 entries the raw grammar can express — governed 1/2 (50%) · raw, verified 2/2 (100%) · raw, verified excusing text facts 2/2 (100%) · raw, apparent 2/2 (100%).**");
    expect(md).toContain("| answerable | 2 | 1/2 (50%) | 2/2 (100%) | 2/2 (100%) | 2/2 (100%) | 0 | — |");
    expect(md).toContain("**Raw arm, enforcement side");
    expect(md).toContain("**Raw arm cost:** 2 call(s)");
    expect(md).not.toContain("N=");
  });
});
