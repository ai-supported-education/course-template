#!/usr/bin/env node

import { flattenManifest, loadManifest } from "./manifest.js";
import { runAuthorProof } from "./author-proof.js";
import { findWorkspaceRoot } from "./workspace.js";

async function main(): Promise<void> {
  const root = findWorkspaceRoot();
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    const manifest = await loadManifest(root);
    ids.push(
      ...flattenManifest(manifest)
        .filter((session) => session.definition.authorProof)
        .map((session) => session.definition.id)
    );
  }
  if (ids.length === 0) {
    throw new Error("Нет опубликованных sessions с authorProof.");
  }
  for (const id of ids) {
    const result = await runAuthorProof(root, id);
    console.log(`Author proof PASS: ${id}; evidence ${result.path}.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
