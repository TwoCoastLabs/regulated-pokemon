/**
 * The formatter registry, on its own.
 *
 * Two properties matter here and nothing else does. A formatter is *total or
 * refusing* — it never returns a plausible-looking string for input it cannot
 * present — and it is *deterministic across runtimes*, which is why none of
 * these renderings goes through `Intl`. A verdict that changed when Node was
 * rebuilt against different ICU data would not replay (IA-10), and a disclosure
 * that read differently on the server and in CI would be exactly the kind of
 * presentation drift Article VI exists to catch.
 */

import { describe, expect, it } from "vitest";

import type { FactValue } from "./contracts.js";
import {
  formatCarriesLocale,
  FORMAT_IDS,
  formatForValue,
  formatValue,
  IMPLEMENTED_LOCALES,
  isFormatId,
} from "./format.js";
import { denialCode } from "./violation.js";

function rendered(formatId: Parameters<typeof formatValue>[0], locale: string, value: FactValue): string {
  const result = formatValue(formatId, locale, value);
  if (!result.ok) throw new Error(result.violations.map(denialCode).join(", "));
  return result.value;
}

function refusal(formatId: Parameters<typeof formatValue>[0], locale: string, value: FactValue): string[] {
  const result = formatValue(formatId, locale, value);
  return result.ok ? [] : result.violations.map(denialCode);
}

const number = (value: number): FactValue => ({ kind: "number", value });
const list = (value: readonly string[]): FactValue => ({ kind: "list", value });
const bool = (value: boolean): FactValue => ({ kind: "boolean", value });
const words = (value: string): FactValue => ({ kind: "text", value });

describe("each format renders one kind of value one way", () => {
  it("writes an entity id the way a page writes it", () => {
    expect(rendered("entity-name", "en-US", words("pikachu"))).toBe("Pikachu");
    expect(rendered("entity-name", "en-US", words("self-destruct"))).toBe("Self-destruct");
  });

  it("groups whole numbers without asking the runtime", () => {
    expect(rendered("integer", "en-US", number(90))).toBe("90");
    expect(rendered("integer", "en-US", number(1234))).toBe("1,234");
    expect(rendered("integer", "en-US", number(-1234567))).toBe("-1,234,567");
  });

  it("binds the polarity of a membership claim rather than leaving it to prose", () => {
    expect(rendered("member-of", "en-US", bool(true))).toBe("is a member of");
    expect(rendered("member-of", "en-US", bool(false))).toBe("is not a member of");
  });

  it("says what an absent certified value is", () => {
    // "This move has no power" is an answer. It is not the absence of one.
    expect(rendered("no-value", "en-US", { kind: "absent" })).toBe("none");
  });
});

describe("the locale changes the string, which is the point", () => {
  it.each(IMPLEMENTED_LOCALES)("renders every certified kind in %s", (locale) => {
    // Every locale, every format, exercised rather than declared. A locale
    // whose renderings were never run would be a translation nobody read.
    expect(rendered("entity-name", locale, words("pikachu"))).toBe("Pikachu");
    expect(rendered("plain-text", locale, words("base-speed"))).toBe("base-speed");
    expect(rendered("integer", locale, number(12345))).toBe("12,345");
    expect(rendered("yes-no", locale, bool(true))).toBe("yes");
    expect(rendered("yes-no", locale, bool(false))).toBe("no");
    expect(rendered("no-value", locale, { kind: "absent" })).toBe("none");
    expect(rendered("member-of", locale, bool(true))).toBe("is a member of");
    expect(rendered("member-of", locale, bool(false))).toBe("is not a member of");
    expect(rendered("list-oxford", locale, list(["ice"]))).toBe("ice");
  });

  it("disagrees about the serial comma, exactly as the two locales do", () => {
    // Not a curiosity: a Maine dairy paid five million dollars in unpaid
    // overtime over a missing one. A matcher that shrugged at the difference
    // would be shrugging at the difference between two readings of a list.
    expect(rendered("list-oxford", "en-US", list(["ice", "water", "flying"]))).toBe("ice, water, and flying");
    expect(rendered("list-oxford", "en-GB", list(["ice", "water", "flying"]))).toBe("ice, water and flying");
  });

  it("agrees where the locales agree", () => {
    expect(rendered("list-oxford", "en-US", list(["ice", "water"]))).toBe("ice and water");
    expect(rendered("list-oxford", "en-GB", list(["ice", "water"]))).toBe("ice and water");
  });
});

describe("a formatter refuses rather than improvising", () => {
  it("refuses a value of a kind it does not present", () => {
    expect(refusal("integer", "en-US", words("ninety"))).toEqual(["IA-6/slot-format-inapplicable"]);
    expect(refusal("member-of", "en-US", number(1))).toEqual(["IA-6/slot-format-inapplicable"]);
  });

  it("refuses a locale it carries no rendering for", () => {
    expect(refusal("integer", "de-DE", number(90))).toEqual(["IA-6/slot-locale-unavailable"]);
  });

  it("refuses a number it cannot present as a whole one", () => {
    // Rounding here would put a number on a certified artifact that the
    // registry never certified, which is the failure with the shortest path
    // to a wrong answer that verifies.
    expect(refusal("integer", "en-US", number(90.5))).toEqual(["IA-6/slot-value-unpresentable"]);
  });

  it("refuses an empty list rather than showing an empty slot", () => {
    expect(refusal("list-oxford", "en-US", list([]))).toEqual(["IA-6/slot-value-unpresentable"]);
  });
});

describe("the registry is closed and total", () => {
  it("has one presentation for every kind of certified value", () => {
    const kinds: FactValue[] = [number(1), bool(true), list(["a"]), words("a"), { kind: "absent" }];
    for (const value of kinds) {
      expect(rendered(formatForValue(value), "en-US", value).length).toBeGreaterThan(0);
    }
  });

  it("implements every format it names, in every locale it names", () => {
    for (const formatId of FORMAT_IDS) {
      expect(isFormatId(formatId)).toBe(true);
      for (const locale of IMPLEMENTED_LOCALES) {
        // Not a coverage exercise: a format that names a locale it cannot
        // render is how "we support en-GB" becomes true in the registry and
        // false on the screen.
        expect(formatCarriesLocale(formatId, locale), `${formatId} cannot render ${locale}`).toBe(true);
      }
    }
  });

  it("knows nothing outside its own list", () => {
    expect(isFormatId("free-text")).toBe(false);
  });
});
