#!/usr/bin/env node

import path from "node:path";
import {
  formatPreparedRoadmapReview,
  getRoadmapReviewStatus,
  parseRoadmapReviewStage,
  parseRoadmapReviewVerdict,
  prepareRoadmapReview,
  recordRoadmapReview,
  ROADMAP_REVIEW_STAGES,
  writeRoadmapReviewAttestation
} from "./roadmap-review.js";
import { findWorkspaceRoot } from "./workspace.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = findWorkspaceRoot();
  if (args[0] === "status") {
    const status = await getRoadmapReviewStatus(root);
    console.log([
      ...ROADMAP_REVIEW_STAGES.map((stage) => {
        const review = status.reviews[stage];
        return review.record
          ? `${stage}: ${review.record.verdict}; ${review.current ? "CURRENT" : "STALE"}.`
          : `${stage}: отсутствует.`;
      }),
      `Status: ${status.current ? "CURRENT" : "STALE_OR_MISSING"}.`
    ].join("\n"));
    if (!status.current) process.exitCode = 1;
    return;
  }
  if (args[0] === "--record") {
    const stage = parseRoadmapReviewStage(args[1] ?? "");
    const verdict = parseRoadmapReviewVerdict(args[2] ?? "");
    const reportIndex = args.indexOf("--report");
    const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;
    if (!reportPath) {
      throw new Error("Использование: pnpm author:roadmap-review --record <curriculum|subject> PASS|NEEDS_REWRITE --report <path>");
    }
    const record = await recordRoadmapReview(root, stage, verdict, path.resolve(reportPath));
    console.log(`Roadmap review ${stage} ${record.verdict} записан, hash ${record.contentHash}.`);
    return;
  }
  if (args[0] === "attest") {
    const result = await writeRoadmapReviewAttestation(root);
    console.log(`Публичная roadmap attestation записана в ${result.path}.`);
    return;
  }
  console.log(formatPreparedRoadmapReview(await prepareRoadmapReview(root)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
