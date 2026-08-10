/**
 * Where the record comes from. Two doors, both through `readArtifact`'s
 * fail-closed check: the artifact bundled from runs/ at build time (the
 * published run this page replays by default), and any artifact the visitor
 * opens from disk.
 */
import type { HarnessArtifact } from "../../src/harness/artifact.js";
import { readArtifact } from "../../src/ui/viewmodel.js";

export interface ArtifactSource {
  /** The filename the record arrived as — its identity in the header. */
  name: string;
  artifact: HarnessArtifact;
}

const bundled = import.meta.glob("../../runs/*.json", { eager: true, import: "default" });

/** The newest bundled run: filenames sort chronologically by construction. */
export function bundledArtifact(): ArtifactSource {
  const names = Object.keys(bundled).sort();
  const newest = names[names.length - 1];
  if (newest === undefined) throw new Error("no run artifact was bundled from runs/");
  return { name: newest.split("/").pop() ?? newest, artifact: readArtifact(bundled[newest]) };
}

/** Read a visitor-supplied artifact file, refusing what is not a record. */
export async function openArtifact(file: File): Promise<ArtifactSource> {
  const parsed: unknown = JSON.parse(await file.text());
  return { name: file.name, artifact: readArtifact(parsed) };
}
