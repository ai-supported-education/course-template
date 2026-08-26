#!/usr/bin/env node

import path from "node:path";
import {
  formatPreparedContentReview,
  getContentReviewStatus,
  parseContentReviewScope,
  parseContentReviewStage,
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
        ...(["novice", "consistency"] as const).map((stage) => {
          const review = status.reviews[stage];
          return review.record
            ? `${stage}: ${review.record.verdict} at ${review.record.reviewedAt}; ${review.current ? "CURRENT" : "STALE"}.`
            : `${stage}: отсутствует.`;
        }),
        `Status: ${status.current ? "CURRENT" : "STALE_OR_MISSING"}.`
      ].join("\n")
    );
    if (!status.current) {
      process.exitCode = 1;
    }
    return;
  }

  if (args[0] === "--record") {
    const stage = parseContentReviewStage(args[1] ?? "");
    const scope = parseContentReviewScope(args[2] ?? "");
    const id = requireId(args[3]);
    const verdict = parseContentReviewVerdict(args[4] ?? "");
    const reportIndex = args.indexOf("--report");
    const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;
    if (!reportPath) {
      throw new Error(
        "Использование: pnpm author:content-review --record <novice|consistency> <session|module> <id> PASS|NEEDS_REWRITE --report <path>"
      );
    }
    const record = await recordContentReview(
      root,
      stage,
      scope,
      id,
      verdict,
      path.resolve(reportPath)
    );
    console.log(
      `Content review ${record.stage} ${record.verdict} записан для ${scope} ${id}, hash ${record.contentHash}.`
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
