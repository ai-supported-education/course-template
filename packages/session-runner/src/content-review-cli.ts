#!/usr/bin/env node

import path from "node:path";
import {
  formatPreparedContentReview,
  getContentReviewStatus,
  parseContentReviewScope,
  parseContentReviewVerdict,
  prepareContentReview,
  recordContentReview,
  writeContentReviewAttestation
} from "./content-review.js";
import { findWorkspaceRoot } from "./workspace.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = findWorkspaceRoot();

  if (args[0] === "status") {
    const scope = parseContentReviewScope(args[1] ?? "");
    const id = requireId(args[2]);
    const status = await getContentReviewStatus(root, scope, id);
    console.log(
      [
        `Content review: ${scope} ${id}.`,
        `Current hash: ${status.contentHash}.`,
        status.record
          ? `Recorded: ${status.record.verdict} at ${status.record.reviewedAt}.`
          : "Recorded: отсутствует.",
        `Status: ${status.current ? "CURRENT" : "STALE_OR_MISSING"}.`
      ].join("\n")
    );
    if (!status.current || status.record?.verdict !== "PASS") {
      process.exitCode = 1;
    }
    return;
  }

  if (args[0] === "--record") {
    const scope = parseContentReviewScope(args[1] ?? "");
    const id = requireId(args[2]);
    const verdict = parseContentReviewVerdict(args[3] ?? "");
    const reportIndex = args.indexOf("--report");
    const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;
    if (!reportPath) {
      throw new Error(
        "Использование: pnpm author:content-review --record <session|module> <id> PASS|NEEDS_REWRITE --report <path>"
      );
    }
    const record = await recordContentReview(
      root,
      scope,
      id,
      verdict,
      path.resolve(reportPath)
    );
    console.log(
      `Content review ${record.verdict} записан для ${scope} ${id}, hash ${record.contentHash}.`
    );
    return;
  }

  if (args[0] === "attest") {
    const scope = parseContentReviewScope(args[1] ?? "");
    const id = requireId(args[2]);
    const attestation = await writeContentReviewAttestation(root, scope, id);
    console.log(
      `Публичная аттестация актуального PASS записана в ${attestation.path}.`
    );
    return;
  }

  const scope = parseContentReviewScope(args[0] ?? "");
  const id = requireId(args[1]);
  const prepared = await prepareContentReview(root, scope, id);
  console.log(formatPreparedContentReview(prepared));
}

function requireId(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error("Нужен id session или module.");
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
