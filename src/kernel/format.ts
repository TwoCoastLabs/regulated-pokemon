/**
 * The closed formatter registry (IA-6): the only ways a certified value is
 * allowed to appear on a screen.
 *
 * Phase 4 proved a certified value was displayed by hunting for its words in
 * the page text. That works until presentation gets interesting. A number is
 * grouped differently in different places, a list gains or loses a serial
 * comma, a translation is not a rewording, and every accommodation a matcher
 * makes for those is a hole an attacker can stand in. Regulated industries
 * stopped searching a long time ago and started *binding*: Inline XBRL wraps
 * the displayed figure in a tag naming its concept and a closed transformation,
 * so the number on the page is provably the number in the filing.
 *
 * Same move. A formatter turns one {@link FactValue} into exactly one string
 * for exactly one locale, the kernel computes that string at verification
 * time, and the comparison is equality. There is no search, so a card reading
 * 190 can never prove 90; and the locale is a stated input rather than a
 * matching hazard, so "it renders differently in en-GB" is something the
 * kernel can check instead of something it has to tolerate.
 *
 * Formatters are **data-named and code-implemented**. The Accord pack says
 * which format ids exist and which locales the artifact may be presented in;
 * this file says what those ids actually do. Approving a new presentation is
 * therefore a pack change *and* a reviewed function here — never a looser
 * comparison. There is no transformation language, on purpose: a language
 * would be a place for presentation rules to hide.
 */

import type { FactValue, Resolution } from "./contracts.js";
import { violation } from "./violation.js";

/**
 * Every presentation the kernel implements. A format id outside this list does
 * not exist: the pack loader refuses one, so there is no path by which an
 * unreviewed rendering reaches a slot.
 */
export type FormatId =
  | "entity-name"
  | "integer"
  | "list-oxford"
  | "plain-text"
  | "yes-no"
  | "no-value"
  | "member-of";

/**
 * The locales the formatters below carry.
 *
 * Two is enough to make the point and small enough to stay honest: en-US and
 * en-GB genuinely disagree about the serial comma, which is the difference a
 * Maine dairy famously litigated over unpaid overtime. A pack may approve a
 * subset; it may not approve a locale nothing here can render.
 */
export const IMPLEMENTED_LOCALES: readonly string[] = ["en-US", "en-GB"];

/** One presentation: the value kind it accepts, and a rendering per locale. */
type Formatter =
  | { accepts: "text"; render: Readonly<Record<string, (value: string) => string | undefined>> }
  | { accepts: "number"; render: Readonly<Record<string, (value: number) => string | undefined>> }
  | { accepts: "boolean"; render: Readonly<Record<string, (value: boolean) => string | undefined>> }
  | { accepts: "list"; render: Readonly<Record<string, (value: readonly string[]) => string | undefined>> }
  | { accepts: "absent"; render: Readonly<Record<string, () => string | undefined>> };

/**
 * An id is a display name, not a sentence: "pikachu" is how the registry spells
 * an entity and "Pikachu" is how a page writes it. Nothing but the first letter
 * moves, so the slug is still legible in the rendering and a reviewer comparing
 * the two can see that no word was substituted.
 */
function displayName(id: string): string {
  if (id.length === 0) return id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Whole numbers with a group separator, spelled out here rather than delegated
 * to `Intl`.
 *
 * `Intl` output depends on the ICU data the runtime was built with, and a
 * verdict that changes when Node is rebuilt is not replayable (IA-10). Every
 * certified number in this registry is a whole number, so a fractional value is
 * refused rather than rounded into something plausible.
 */
function grouped(value: number, separator: string): string | undefined {
  if (!Number.isInteger(value)) return undefined;
  const digits = Math.abs(value).toString();
  const parts: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    parts.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return `${value < 0 ? "-" : ""}${parts.join(separator)}`;
}

/** A list in prose, with or without the serial comma. Empty lists are refused. */
function series(items: readonly string[], serialComma: boolean): string | undefined {
  if (items.length === 0) return undefined;
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  return `${head}${serialComma ? "," : ""} and ${items[items.length - 1]}`;
}

const FORMATTERS: Readonly<Record<FormatId, Formatter>> = {
  "entity-name": {
    accepts: "text",
    render: { "en-US": displayName, "en-GB": displayName },
  },
  integer: {
    accepts: "number",
    render: {
      "en-US": (value) => grouped(value, ","),
      "en-GB": (value) => grouped(value, ","),
    },
  },
  "list-oxford": {
    accepts: "list",
    render: {
      "en-US": (value) => series(value, true),
      "en-GB": (value) => series(value, false),
    },
  },
  "plain-text": {
    accepts: "text",
    render: { "en-US": (value) => value, "en-GB": (value) => value },
  },
  "yes-no": {
    accepts: "boolean",
    render: {
      "en-US": (value) => (value ? "yes" : "no"),
      "en-GB": (value) => (value ? "yes" : "no"),
    },
  },
  "no-value": {
    accepts: "absent",
    render: { "en-US": () => "none", "en-GB": () => "none" },
  },
  // Polarity is meaning, not copy: "Zapdos" on a card is equally consistent
  // with the answer and with its negation, so the word that decides which is
  // bound like a value rather than left to the renderer's prose.
  "member-of": {
    accepts: "boolean",
    render: {
      "en-US": (value) => (value ? "is a member of" : "is not a member of"),
      "en-GB": (value) => (value ? "is a member of" : "is not a member of"),
    },
  },
};

export const FORMAT_IDS: readonly FormatId[] = Object.keys(FORMATTERS).sort() as FormatId[];

export function isFormatId(value: string): value is FormatId {
  return Object.hasOwn(FORMATTERS, value);
}

/** Whether a format has a reviewed rendering for a locale. */
export function formatCarriesLocale(formatId: FormatId, locale: string): boolean {
  return Object.hasOwn(FORMATTERS[formatId].render, locale);
}

/**
 * The one presentation a value of this kind may be given.
 *
 * Closed and total, so that planning a slot is never a judgement call: a fact
 * claim asserting a list is shown as a list and there is no second option to
 * choose wrongly. The pack still has to approve the id, so a presentation the
 * kernel can produce is not automatically one this Accord permits.
 */
export function formatForValue(value: FactValue): FormatId {
  switch (value.kind) {
    case "number":
      return "integer";
    case "boolean":
      return "yes-no";
    case "list":
      return "list-oxford";
    case "text":
      return "plain-text";
    case "absent":
      return "no-value";
  }
}

/**
 * Render one certified value, or refuse.
 *
 * Refusal is a denial rather than a fallback string. A formatter that quietly
 * produced "" or "[object Object]" for input it could not present would put an
 * unprovable mark on a certified artifact, which is the failure this whole
 * layer exists to make impossible.
 */
export function formatValue(formatId: FormatId, locale: string, value: FactValue): Resolution<string> {
  const formatter = FORMATTERS[formatId];
  if (formatter === undefined) {
    return {
      ok: false,
      violations: [
        violation("IA-6", "slot-format-unknown", `no formatter is implemented for "${formatId}"`, {
          expected: FORMAT_IDS.join(", "),
          actual: formatId,
        }),
      ],
    };
  }
  if (value.kind !== formatter.accepts) {
    return {
      ok: false,
      violations: [
        violation("IA-6", "slot-format-inapplicable", `"${formatId}" cannot present a ${value.kind} value`, {
          expected: formatter.accepts,
          actual: value.kind,
        }),
      ],
    };
  }
  if (!formatCarriesLocale(formatId, locale)) {
    return {
      ok: false,
      violations: [
        violation("IA-6", "slot-locale-unavailable", `"${formatId}" has no approved rendering for ${locale}`, {
          expected: Object.keys(formatter.render).join(", "),
          actual: locale,
        }),
      ],
    };
  }

  const rendered = renderWith(formatter, locale, value);
  if (rendered === undefined) {
    return {
      ok: false,
      violations: [
        violation("IA-6", "slot-value-unpresentable", `"${formatId}" has no rendering for this value in ${locale}`, {
          expected: `a value "${formatId}" can present`,
          actual: describe(value),
        }),
      ],
    };
  }
  return { ok: true, value: rendered };
}

/** The one place the value's kind and the formatter's kind are known to agree. */
function renderWith(formatter: Formatter, locale: string, value: FactValue): string | undefined {
  switch (formatter.accepts) {
    case "text":
      return formatter.render[locale]?.((value as Extract<FactValue, { kind: "text" }>).value);
    case "number":
      return formatter.render[locale]?.((value as Extract<FactValue, { kind: "number" }>).value);
    case "boolean":
      return formatter.render[locale]?.((value as Extract<FactValue, { kind: "boolean" }>).value);
    case "list":
      return formatter.render[locale]?.((value as Extract<FactValue, { kind: "list" }>).value);
    case "absent":
      return formatter.render[locale]?.();
  }
}

function describe(value: FactValue): string {
  if (value.kind === "absent") return "absent";
  if (value.kind === "list") return `[${value.value.join(", ")}]`;
  return String(value.value);
}
