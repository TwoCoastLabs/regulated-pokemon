/**
 * The decline ledger's entry point, and nothing more.
 *
 * All of it — locating the artifacts, classifying, rendering, filing or
 * printing — is `runDeclineLedger` (decline-ledger-read.ts), a function of its arguments with
 * the filesystem injected. This file supplies the real disk and connects the
 * result to a terminal, so the only thing not covered by a test is the
 * connecting.
 *
 * Key-free and free of charge: it reads filed runs and nothing else.
 */

import { runDeclineLedger } from "./decline-ledger-read.js";

const result = runDeclineLedger({ argv: process.argv.slice(2) });
for (const line of result.lines) console.log(line);
process.exit(result.exitCode);
