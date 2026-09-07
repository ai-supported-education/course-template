import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyAuthorProofEvidence } from "./author-proof.js";
import {
  CONTENT_REVIEW_PROTOCOL_V3,
  getContentReviewStatus
} from "./content-review.js";
import { flattenManifest, loadManifest } from "./manifest.js";
import {
  getRoadmapReviewHashes,
  ROADMAP_REVIEW_PROTOCOL,
  type RoadmapReviewAttestation
} from "./roadmap-review.js";
import { TARGETABLE_CHECK_LABELS } from "./types.js";

export interface PublicationCheckResult {
  passed: boolean;
  problems: string[];
}

export async function checkPublication(
  root: string
): Promise<PublicationCheckResult> {
  const manifest = await loadManifest(root);
  if (manifest.reviewProtocol !== ROADMAP_REVIEW_PROTOCOL) {
    return { passed: true, problems: [] };
  }

  const problems: string[] = [];
  await verifyRoadmapAttestation(root, problems);
  const sessions = flattenManifest(manifest);
  for (const session of sessions) {
    await verifyContentAttestation(root, "session", session.definition.id, problems);
    if (
      session.definition.checks.some((check) =>
        TARGETABLE_CHECK_LABELS.includes(check as never)
      )
    ) {
      problems.push(...(await verifyAuthorProofEvidence(root, session)));
    }
  }

  const moduleIds = new Set(
    sessions.map((session) => session.module?.id ?? manifest.capstone.id)
  );
  for (const moduleId of moduleIds) {
    await verifyContentAttestation(root, "module", moduleId, problems);
  }

  return { passed: problems.length === 0, problems };
}

async function verifyRoadmapAttestation(
  root: string,
  problems: string[]
): Promise<void> {
  const relativePath = "curriculum/reviews/roadmap.json";
  let value: RoadmapReviewAttestation;
  try {
    value = JSON.parse(
      await readFile(path.join(root, ...relativePath.split("/")), "utf8")
    ) as RoadmapReviewAttestation;
  } catch (error) {
    problems.push(`${relativePath}: отсутствует или не читается (${formatError(error)})`);
    return;
  }
  const hashes = await getRoadmapReviewHashes(root);
  if (
    value.schemaVersion !== 3 ||
    value.scope !== "roadmap" ||
    value.id !== "course" ||
    value.verdict !== "PASS" ||
    value.protocol !== ROADMAP_REVIEW_PROTOCOL
  ) {
    problems.push(`${relativePath}: неверный v3 roadmap attestation contract`);
  }
  if (
    value.hashes?.curriculum !== hashes.curriculum ||
    value.hashes?.subject !== hashes.subject
  ) {
    problems.push(`${relativePath}: attestation устарела`);
  }
  for (const stage of ["curriculum", "subject"] as const) {
    if (value.reviews?.[stage]?.verdict !== "PASS") {
      problems.push(`${relativePath}: нет PASS review ${stage}`);
    }
  }
}

async function verifyContentAttestation(
  root: string,
  scope: "session" | "module",
  id: string,
  problems: string[]
): Promise<void> {
  const relativePath = `curriculum/reviews/${scope}-${id}.json`;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as Record<
      string,
      unknown
    >;
  } catch (error) {
    problems.push(`${relativePath}: отсутствует или не читается (${formatError(error)})`);
    return;
  }
  const status = await getContentReviewStatus(root, scope, id);
  if (
    value.schemaVersion !== 3 ||
    value.scope !== scope ||
    value.id !== id ||
    value.verdict !== "PASS" ||
    value.protocol !== CONTENT_REVIEW_PROTOCOL_V3
  ) {
    problems.push(`${relativePath}: неверный v3 content attestation contract`);
  }
  if (value.contentHash !== status.contentHash) {
    problems.push(`${relativePath}: attestation устарела`);
  }
  const reviews = value.reviews as Record<string, { verdict?: unknown }> | undefined;
  for (const stage of ["subject", "novice", "consistency"] as const) {
    if (reviews?.[stage]?.verdict !== "PASS") {
      problems.push(`${relativePath}: нет PASS review ${stage}`);
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
