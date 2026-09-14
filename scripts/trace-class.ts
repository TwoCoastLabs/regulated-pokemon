/**
 * The class, from the records (epic #169, M0): re-derive from a dev trace how
 * every exchange whose latest trainer words match a pattern ended — how many
 * model calls it took, whether a nomination was refused first, whether a
 * denial was fed back, whether it ended in an abstention — so the number in
 * the findings re-derives from the file rather than from a hand tally.
 *
 * Key-free, network-free, dependency-free. Reads the trace the live page
 * mirrors on the dev server (`.dev-trace.jsonl`): one `report` line per
 * settled exchange, carrying the transcript, the model calls and the notes.
 *
 *   node --experimental-strip-types scripts/trace-class.ts .dev-trace.jsonl "about (the|this) game"
 */

import { readFileSync } from "node:fs";

interface Report {
  type: string;
  at: string;
  meta?: { model?: string };
  transcript?: readonly { kind: string; source?: string; text?: string; at: string }[];
  modelCalls?: readonly unknown[];
  nominationRetries?: number;
  feedbackRetries?: number;
  notes?: readonly { at: string; tone: string }[];
}

const [file, pattern] = process.argv.slice(2);
if (file === undefined || pattern === undefined) {
  console.error('usage: trace-class.ts <trace.jsonl> "<regex over the latest trainer words>"');
  process.exit(2);
}
const matcher = new RegExp(pattern, "i");
const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0);

interface Row {
  at: string;
  model: string;
  calls: number;
  nominationRefused: boolean;
  fedBack: boolean;
  abstained: boolean;
}
const rows: Row[] = [];
for (const line of lines) {
  const report = JSON.parse(line) as Report;
  if (report.type !== "report") continue;
  const words = (report.transcript ?? []).filter((event) => event.kind === "utterance" && event.source === "trainer");
  const last = words[words.length - 1];
  if (last?.text === undefined || !matcher.test(last.text)) continue;
  const after = (report.notes ?? []).filter((note) => note.at > last.at);
  rows.push({
    at: report.at,
    model: (report.meta?.model ?? "?").split("/").pop() ?? "?",
    calls: report.modelCalls?.length ?? 0,
    nominationRefused: (report.nominationRetries ?? 0) > 0,
    fedBack: (report.feedbackRetries ?? 0) > 0,
    abstained: after.some((note) => note.tone === "abstention"),
  });
}

const count = (predicate: (row: Row) => boolean): string => {
  const n = rows.filter(predicate).length;
  return `${n}/${rows.length} (${rows.length === 0 ? 0 : Math.round((100 * n) / rows.length)}%)`;
};
for (const row of rows) console.log([row.at.slice(0, 16), row.model, `${row.calls} call(s)`, row.nominationRefused ? "nomination refused first" : "-", row.fedBack ? "fed back" : "-", row.abstained ? "ABSTAINED" : "answered"].join("\t"));
console.log("---");
console.log(`exchanges matching /${pattern}/: ${rows.length}`);
console.log(`answered in one call: ${count((row) => row.calls === 1)}`);
console.log(`nomination refused first: ${count((row) => row.nominationRefused)}`);
console.log(`three calls: ${count((row) => row.calls >= 3)}`);
console.log(`fed back: ${count((row) => row.fedBack)}`);
console.log(`abstained: ${count((row) => row.abstained)}`);
for (const model of [...new Set(rows.map((row) => row.model))]) {
  const mine = rows.filter((row) => row.model === model);
  console.log(`  ${model}: ${mine.length} exchanges, ${mine.filter((row) => row.abstained).length} abstained, ${mine.filter((row) => row.calls === 1).length} in one call`);
}
