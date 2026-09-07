#!/usr/bin/env node

import { checkPublication } from "./publication-check.js";
import { findWorkspaceRoot } from "./workspace.js";

async function main(): Promise<void> {
  const result = await checkPublication(findWorkspaceRoot());
  if (!result.passed) {
    console.error(["Publication check: FAIL", ...result.problems.map((item) => `- ${item}`)].join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Publication check: PASS. Roadmap, content reviews and author proofs are current.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
