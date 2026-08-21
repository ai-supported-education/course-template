#!/usr/bin/env node

import { createGitExecutor, syncProgressBranch } from "./course-sync.js";
import { findWorkspaceRoot } from "./workspace.js";

async function main(): Promise<void> {
  const root = findWorkspaceRoot();
  const result = await syncProgressBranch(createGitExecutor(root));
  console.log(
    `Курс обновлён: ${result.baseBranch} влит в ${result.progressBranch} и отправлен в personal origin.`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
