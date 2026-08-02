/**
 * The article registry: the single source of truth linking code to the
 * Indigo Accord (docs/the-indigo-accord.md). Every Violation names an
 * article from this registry; the crucible asserts each article has at
 * least one failure-injection test.
 */

export interface AccordArticle {
  /** Stable identifier used in violations, e.g. "IA-3". */
  id: string;
  title: string;
  /** One-line real-world analog, shown in the compliance console. */
  analog: string;
}

// `as const satisfies` rather than a plain annotation: the annotation would
// widen every id to `string`, and ArticleId with it, so a violation could
// name an article that does not exist without the compiler noticing.
export const ACCORD_ARTICLES = [
  { id: "IA-1", title: "Know Your Trainer", analog: "Suitability / KYC (MiFID II, Reg BI)" },
  { id: "IA-2", title: "Certified Facts Only", analog: "Approved materials / current prospectus" },
  { id: "IA-3", title: "No Fabrication (the MissingNo Clause)", analog: "Misrepresentation (SEC Rule 10b-5)" },
  { id: "IA-4", title: "Complete Answers Carry Certificates", analog: "Comparative advertising / best-execution evidence" },
  { id: "IA-5", title: "Restricted Species", analog: "Accredited-investor / complex-product gating" },
  { id: "IA-6", title: "Disclosures Must Be Seen", analog: "Risk-warning prominence (FCA fair-clear-not-misleading)" },
  { id: "IA-7", title: "What Was Shown Is What Executes", analog: "Order confirmation / e-sign" },
  { id: "IA-8", title: "Only the Trainer Speaks for the Trainer", analog: "Authorized-party rules / social-engineering controls" },
  { id: "IA-9", title: "Irreversible Acts Need Informed Consent", analog: "Cooling-off / irreversibility warnings" },
  { id: "IA-10", title: "The League May Replay", analog: "Books and records (SEC 17a-4)" },
] as const satisfies readonly AccordArticle[];

export type ArticleId = (typeof ACCORD_ARTICLES)[number]["id"];

const byId = new Map(ACCORD_ARTICLES.map((article) => [article.id, article]));

export function article(id: ArticleId): AccordArticle {
  const found = byId.get(id);
  if (!found) throw new Error(`unknown Accord article ${id}`);
  return found;
}
