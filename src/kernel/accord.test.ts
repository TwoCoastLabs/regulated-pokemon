import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCORD_ARTICLES, article } from "./accord.js";

describe("the article registry mirrors the Accord document", () => {
  it("has ten sequential, unique articles", () => {
    expect(ACCORD_ARTICLES).toHaveLength(10);
    expect(ACCORD_ARTICLES.map((item) => item.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `IA-${index + 1}`),
    );
  });

  it("every registered article appears in docs/the-indigo-accord.md", () => {
    const doc = readFileSync(resolve(import.meta.dirname, "../../docs/the-indigo-accord.md"), "utf8");
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
    for (const [index, entry] of ACCORD_ARTICLES.entries()) {
      expect(doc, `${entry.id} "${entry.title}" missing from the Accord`).toContain(
        `## Article ${roman[index]} — ${entry.title.replace(/ \(.*\)$/, "")}`,
      );
    }
  });

  it("every article carries a real-world analog for the compliance console", () => {
    for (const entry of ACCORD_ARTICLES) {
      expect(entry.analog.length).toBeGreaterThan(10);
    }
  });

  it("lookup fails loudly on unknown articles", () => {
    expect(article("IA-3").title).toContain("MissingNo");
    expect(() => article("IA-99" as never)).toThrow("unknown Accord article");
  });
});
