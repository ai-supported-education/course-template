import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadCourseContextDocuments } from "./course-context.js";
import { flattenRoadmap, loadManifest } from "./manifest.js";
import { loadCourseProfileDocuments } from "./profiles.js";
import { loadSourceLedger, SOURCE_LEDGER_PATH } from "./source-ledger.js";

export const ROADMAP_REVIEW_PROTOCOL =
  "roadmap-subject-novice-consistency-v1" as const;
export const ROADMAP_REVIEW_STAGES = ["curriculum", "subject"] as const;
export const ROADMAP_REVIEW_VERDICTS = ["PASS", "NEEDS_REWRITE"] as const;

export type RoadmapReviewStage = (typeof ROADMAP_REVIEW_STAGES)[number];
export type RoadmapReviewVerdict = (typeof ROADMAP_REVIEW_VERDICTS)[number];

export interface RoadmapReviewHashes {
  curriculum: string;
  subject: string;
}

export interface PreparedRoadmapReview {
  hashes: RoadmapReviewHashes;
  packetDirectory: string;
  curriculumPacketPath: string;
  subjectPacketPath: string;
}

export interface RoadmapReviewRecord {
  stage: RoadmapReviewStage;
  contentHash: string;
  verdict: RoadmapReviewVerdict;
  reviewedAt: string;
  reportPath: string;
}

interface RoadmapReviewState {
  schemaVersion: 1;
  records: Partial<Record<RoadmapReviewStage, RoadmapReviewRecord>>;
}

export interface RoadmapReviewAttestation {
  schemaVersion: 3;
  scope: "roadmap";
  id: "course";
  verdict: "PASS";
  attestedAt: string;
  hashes: RoadmapReviewHashes;
  reviews: Record<
    RoadmapReviewStage,
    { verdict: "PASS"; reviewedAt: string; reportSha256: string }
  >;
  protocol: typeof ROADMAP_REVIEW_PROTOCOL;
}

export async function prepareRoadmapReview(
  root: string
): Promise<PreparedRoadmapReview> {
  const manifest = await loadManifest(root);
  assertV3Protocol(manifest.reviewProtocol);
  const ledger = await loadSourceLedger(root);
  const profiles = await loadCourseProfileDocuments(root, manifest.profiles);
  const contexts = await loadCourseContextDocuments(
    root,
    manifest.courseContextFiles ?? []
  );
  const rootReadme = await readFile(path.join(root, "README.md"), "utf8");
  const roadmap = flattenRoadmap(manifest);

  const curriculumInput = JSON.stringify({
    protocol: ROADMAP_REVIEW_PROTOCOL,
    language: manifest.language,
    audience: manifest.audience,
    assumedConcepts: manifest.assumedConcepts,
    estimatedHours: manifest.estimatedHours,
    sessionPolicy: manifest.sessionPolicy,
    modules: manifest.modules.map((module) => ({
      id: module.id,
      slug: module.slug,
      title: module.title,
      goal: module.goal,
      sessions: module.sessions.map(roadmapSessionContract)
    })),
    capstone: {
      id: manifest.capstone.id,
      title: manifest.capstone.title,
      goal: manifest.capstone.goal,
      sessions: manifest.capstone.sessions.map(roadmapSessionContract)
    },
    rootReadme,
    profiles: profiles.map((profile) => ({ id: profile.id, source: profile.source })),
    contexts
  });
  const curriculumHash = sha256(curriculumInput);
  const subjectHash = sha256(
    JSON.stringify({
      protocol: ROADMAP_REVIEW_PROTOCOL,
      roadmap: roadmap.map((session) => roadmapSessionContract(session.definition)),
      ledger
    })
  );
  const hashes = { curriculum: curriculumHash, subject: subjectHash };
  const packetDirectory = path.join(
    root,
    ".authoring",
    "roadmap-review",
    "packets",
    `${curriculumHash.slice(0, 8)}-${subjectHash.slice(0, 8)}`
  );
  const curriculumPacketPath = path.join(packetDirectory, "00-curriculum.md");
  const subjectPacketPath = path.join(packetDirectory, "01-subject.md");
  await mkdir(packetDirectory, { recursive: true });
  await writeFile(
    curriculumPacketPath,
    buildCurriculumPacket(manifest, rootReadme, profiles, contexts),
    "utf8"
  );
  await writeFile(
    subjectPacketPath,
    buildSubjectPacket(manifest, ledger),
    "utf8"
  );

  return {
    hashes,
    packetDirectory,
    curriculumPacketPath,
    subjectPacketPath
  };
}

export async function getRoadmapReviewHashes(
  root: string
): Promise<RoadmapReviewHashes> {
  return (await prepareRoadmapReview(root)).hashes;
}

export async function recordRoadmapReview(
  root: string,
  stage: RoadmapReviewStage,
  verdict: RoadmapReviewVerdict,
  sourceReportPath: string
): Promise<RoadmapReviewRecord> {
  const prepared = await prepareRoadmapReview(root);
  const report = await readFile(path.resolve(sourceReportPath), "utf8");
  validateReport(stage, verdict, report);
  const contentHash = prepared.hashes[stage];
  const reportDirectory = path.join(root, ".authoring", "roadmap-review", "reports");
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(
    reportDirectory,
    `${stage}-${contentHash.slice(0, 12)}.md`
  );
  await writeFile(reportPath, ensureTrailingNewline(report), "utf8");
  const record: RoadmapReviewRecord = {
    stage,
    contentHash,
    verdict,
    reviewedAt: new Date().toISOString(),
    reportPath: path.relative(root, reportPath)
  };
  const state = await loadState(root);
  state.records[stage] = record;
  await saveState(root, state);
  return record;
}

export async function getRoadmapReviewStatus(root: string): Promise<{
  hashes: RoadmapReviewHashes;
  reviews: Record<
    RoadmapReviewStage,
    { record: RoadmapReviewRecord | null; current: boolean }
  >;
  current: boolean;
}> {
  const hashes = await getRoadmapReviewHashes(root);
  const state = await loadState(root);
  const reviews = Object.fromEntries(
    ROADMAP_REVIEW_STAGES.map((stage) => {
      const record = state.records[stage] ?? null;
      return [stage, { record, current: record?.contentHash === hashes[stage] }];
    })
  ) as Record<
    RoadmapReviewStage,
    { record: RoadmapReviewRecord | null; current: boolean }
  >;
  return {
    hashes,
    reviews,
    current: ROADMAP_REVIEW_STAGES.every(
      (stage) => reviews[stage].current && reviews[stage].record?.verdict === "PASS"
    )
  };
}

export async function writeRoadmapReviewAttestation(
  root: string
): Promise<{ path: string; value: RoadmapReviewAttestation }> {
  const status = await getRoadmapReviewStatus(root);
  if (!status.current) {
    throw new Error(
      "Для roadmap нужны два актуальных PASS: curriculum и subject."
    );
  }
  const curriculum = status.reviews.curriculum.record!;
  const subject = status.reviews.subject.record!;
  const value: RoadmapReviewAttestation = {
    schemaVersion: 3,
    scope: "roadmap",
    id: "course",
    verdict: "PASS",
    attestedAt: new Date().toISOString(),
    hashes: status.hashes,
    reviews: {
      curriculum: await publicReview(root, curriculum),
      subject: await publicReview(root, subject)
    },
    protocol: ROADMAP_REVIEW_PROTOCOL
  };
  const outputPath = path.join(root, "curriculum", "reviews", "roadmap.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: outputPath, value };
}

export function parseRoadmapReviewStage(value: string): RoadmapReviewStage {
  if (value === "curriculum" || value === "subject") {
    return value;
  }
  throw new Error("Stage должен быть curriculum или subject.");
}

export function parseRoadmapReviewVerdict(value: string): RoadmapReviewVerdict {
  if (value === "PASS" || value === "NEEDS_REWRITE") {
    return value;
  }
  throw new Error("Verdict должен быть PASS или NEEDS_REWRITE.");
}

export function formatPreparedRoadmapReview(
  prepared: PreparedRoadmapReview
): string {
  return [
    "Roadmap review packets готовы.",
    `Curriculum hash: ${prepared.hashes.curriculum}.`,
    `Subject hash: ${prepared.hashes.subject}.`,
    `Curriculum packet: ${prepared.curriculumPacketPath}.`,
    `Subject packet: ${prepared.subjectPacketPath}.`,
    "Запустите ДВУХ независимых fresh subagents с fork_turns=none.",
    "Curriculum-agent получает только 00-curriculum.md.",
    "Subject-agent получает только 01-subject.md и проверяет содержание по первичным источникам.",
    "Агенты не получают историю генерации и отчёты друг друга."
  ].join("\n");
}

function buildCurriculumPacket(
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  rootReadme: string,
  profiles: Awaited<ReturnType<typeof loadCourseProfileDocuments>>,
  contexts: Awaited<ReturnType<typeof loadCourseContextDocuments>>
): string {
  return ensureTrailingNewline([
    "# Fresh curriculum review: full course roadmap",
    "",
    "## Reviewer contract",
    "",
    "Вы не участвовали в генерации курса. Не открывайте repository и subject packet. Проверьте маршрут для заявленной аудитории: причинную последовательность, размер independently finishable карточек, prerequisites, deferred concepts, повторения, пробелы и достижимость capstone.",
    "Верните H1, строку `Verdict: PASS|NEEDS_REWRITE` и разделы `Roadmap reconstruction`, `Audience and progression`, `Session sizing`, `Capstone traceability`, `Findings`, `Verdict rationale`.",
    "",
    "## Manifest roadmap",
    "",
    "```json",
    JSON.stringify({
      language: manifest.language,
      audience: manifest.audience,
      assumedConcepts: manifest.assumedConcepts,
      estimatedHours: manifest.estimatedHours,
      sessionPolicy: manifest.sessionPolicy,
      modules: manifest.modules,
      capstone: manifest.capstone
    }, null, 2),
    "```",
    "",
    "## Learner README",
    "",
    rootReadme,
    ...profiles.flatMap((profile) => [
      "",
      `## Profile: ${profile.id}`,
      "",
      profile.source
    ]),
    ...contexts.flatMap((context) => [
      "",
      `## Course context: ${context.path}`,
      "",
      context.source
    ])
  ].join("\n"));
}

function buildSubjectPacket(
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  ledger: Awaited<ReturnType<typeof loadSourceLedger>>
): string {
  return ensureTrailingNewline([
    "# Fresh subject and currentness review: full course roadmap",
    "",
    "## Reviewer contract",
    "",
    "Вы не участвовали в генерации курса. Не открывайте repository или curriculum-agent report. Проверьте предметную корректность, современность и достаточность source ledger. Отличайте стандарт языка от host API, runtime и toolchain. Каждое существенное утверждение должно быть проверяемо по первичному источнику; inference помечайте как inference.",
    "Верните H1, строку `Verdict: PASS|NEEDS_REWRITE` и разделы `Coverage map`, `Accuracy and currentness`, `Runtime boundaries`, `Source ledger audit`, `Findings`, `Verdict rationale`.",
    "",
    "## Roadmap contract",
    "",
    "```json",
    JSON.stringify({
      audience: manifest.audience,
      assumedConcepts: manifest.assumedConcepts,
      modules: manifest.modules.map((module) => ({
        id: module.id,
        title: module.title,
        goal: module.goal,
        sessions: module.sessions.map(roadmapSessionContract)
      })),
      capstone: {
        id: manifest.capstone.id,
        title: manifest.capstone.title,
        goal: manifest.capstone.goal,
        sessions: manifest.capstone.sessions.map(roadmapSessionContract)
      }
    }, null, 2),
    "```",
    "",
    `## Source ledger (${SOURCE_LEDGER_PATH})`,
    "",
    "```json",
    JSON.stringify(ledger, null, 2),
    "```"
  ].join("\n"));
}

function roadmapSessionContract(session: {
  id: string;
  title: string;
  minutes: number;
  kind: string;
  outcome: string;
  requires: string[];
  introduces: string[];
  defers: string[];
  releaseStatus?: string;
}): object {
  return {
    id: session.id,
    releaseStatus: session.releaseStatus ?? "published",
    title: session.title,
    minutes: session.minutes,
    kind: session.kind,
    outcome: session.outcome,
    requires: session.requires,
    introduces: session.introduces,
    defers: session.defers
  };
}

function validateReport(
  stage: RoadmapReviewStage,
  verdict: RoadmapReviewVerdict,
  report: string
): void {
  if (!/^#\s+.+/m.test(report)) {
    throw new Error("Review report должен содержать H1.");
  }
  if (!report.includes(`Verdict: ${verdict}`)) {
    throw new Error(`Review report должен содержать Verdict: ${verdict}.`);
  }
  const sections =
    stage === "curriculum"
      ? [
          "Roadmap reconstruction",
          "Audience and progression",
          "Session sizing",
          "Capstone traceability",
          "Findings",
          "Verdict rationale"
        ]
      : [
          "Coverage map",
          "Accuracy and currentness",
          "Runtime boundaries",
          "Source ledger audit",
          "Findings",
          "Verdict rationale"
        ];
  for (const section of sections) {
    if (!report.includes(section)) {
      throw new Error(`Review report не содержит раздел ${section}.`);
    }
  }
}

async function publicReview(root: string, record: RoadmapReviewRecord) {
  const report = await readFile(path.resolve(root, record.reportPath));
  return {
    verdict: "PASS" as const,
    reviewedAt: record.reviewedAt,
    reportSha256: createHash("sha256").update(report).digest("hex")
  };
}

async function loadState(root: string): Promise<RoadmapReviewState> {
  const statePath = path.join(root, ".authoring", "roadmap-review", "state.json");
  try {
    const value = JSON.parse(await readFile(statePath, "utf8")) as RoadmapReviewState;
    if (value.schemaVersion !== 1 || typeof value.records !== "object") {
      throw new Error("unsupported schema");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, records: {} };
    }
    throw new Error(`Не удалось прочитать roadmap review state: ${String(error)}`);
  }
}

async function saveState(root: string, state: RoadmapReviewState): Promise<void> {
  const statePath = path.join(root, ".authoring", "roadmap-review", "state.json");
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, statePath);
}

function assertV3Protocol(value: unknown): void {
  if (value !== ROADMAP_REVIEW_PROTOCOL) {
    throw new Error(
      `Roadmap review требует reviewProtocol ${ROADMAP_REVIEW_PROTOCOL}.`
    );
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
