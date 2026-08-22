import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { loadCourseContextDocuments } from "./course-context.js";
import {
  flattenManifest,
  flattenRoadmap,
  getSession,
  loadManifest
} from "./manifest.js";
import { loadCourseProfileDocuments } from "./profiles.js";
import { readSupportFile } from "./support.js";
import type {
  CourseManifest,
  FlatRoadmapSession,
  FlatSession
} from "./types.js";
import { getModuleDirectory, getSessionDirectory } from "./workspace.js";

export const CONTENT_REVIEW_VERDICTS = ["PASS", "NEEDS_REWRITE"] as const;
export type ContentReviewVerdict = (typeof CONTENT_REVIEW_VERDICTS)[number];
export type ContentReviewScope = "session" | "module";

export interface PreparedContentReview {
  scope: ContentReviewScope;
  id: string;
  contentHash: string;
  packetDirectory: string;
  blindPacketPath: string;
  consistencyPacketPath: string;
}

export interface ContentReviewRecord {
  scope: ContentReviewScope;
  id: string;
  contentHash: string;
  verdict: ContentReviewVerdict;
  reviewedAt: string;
  reportPath: string;
}

export interface ContentReviewStatus {
  scope: ContentReviewScope;
  id: string;
  contentHash: string;
  record: ContentReviewRecord | null;
  current: boolean;
}

export interface ContentReviewAttestation {
  schemaVersion: 1;
  scope: ContentReviewScope;
  id: string;
  contentHash: string;
  verdict: "PASS";
  reviewedAt: string;
  attestedAt: string;
  reportSha256: string;
  protocol: "blind-then-consistency-v1";
}

export interface WrittenContentReviewAttestation {
  path: string;
  value: ContentReviewAttestation;
}

interface ContentReviewState {
  schemaVersion: 1;
  records: Record<string, ContentReviewRecord>;
}

interface ReviewTarget {
  scope: ContentReviewScope;
  id: string;
  manifest: CourseManifest;
  sessions: FlatSession[];
  targetSessions: FlatSession[];
  previous: FlatSession | null;
  next: FlatSession | null;
  nextRoadmap: FlatRoadmapSession | null;
  title: string;
  goal: string;
}

type ReviewFileRole = "learner" | "consistency";
type ReviewPacketSelection = "context" | "blind" | "consistency";

interface ReviewFile {
  absolutePath: string;
  relativeToSession: string;
  role: ReviewFileRole;
}

const inlineTextExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".conf",
  ".cs",
  ".css",
  ".csv",
  ".env.example",
  ".go",
  ".gradle",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".ino",
  ".ipynb",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".kts",
  ".md",
  ".mjs",
  ".mts",
  ".php",
  ".properties",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".tsv",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);
const inlineTextNames = new Set(["Dockerfile", "Makefile"]);
const ignoredDirectories = new Set([
  ".authoring",
  ".git",
  ".training",
  "coverage",
  "dist",
  "node_modules"
]);
const neverIncludedFiles = new Set([
  "answers.json",
  "credentials.json",
  "id_ed25519",
  "id_rsa"
]);
const secretExtensions = new Set([".jks", ".key", ".p12", ".pem", ".pfx"]);
const maxInlineBytes = 256 * 1024;

export async function prepareContentReview(
  root: string,
  scope: ContentReviewScope,
  id: string
): Promise<PreparedContentReview> {
  const target = await resolveTarget(root, scope, id);
  const contentHash = await hashReviewTarget(root, target);
  const packetDirectory = path.join(
    getAuthoringDirectory(root),
    "content-review",
    "packets",
    `${scope}-${id}-${contentHash.slice(0, 12)}`
  );
  const blindPacketPath = path.join(packetDirectory, "01-blind.md");
  const consistencyPacketPath = path.join(packetDirectory, "02-consistency.md");

  await mkdir(packetDirectory, { recursive: true });
  await writeFile(
    blindPacketPath,
    await buildBlindPacket(root, target, contentHash),
    "utf8"
  );
  await writeFile(
    consistencyPacketPath,
    await buildConsistencyPacket(root, target, contentHash),
    "utf8"
  );

  return {
    scope,
    id,
    contentHash,
    packetDirectory,
    blindPacketPath,
    consistencyPacketPath
  };
}

export async function recordContentReview(
  root: string,
  scope: ContentReviewScope,
  id: string,
  verdict: ContentReviewVerdict,
  sourceReportPath: string
): Promise<ContentReviewRecord> {
  const prepared = await prepareContentReview(root, scope, id);
  const report = await readFile(path.resolve(sourceReportPath), "utf8");
  validateReport(report, verdict);

  const reportDirectory = path.join(
    getAuthoringDirectory(root),
    "content-review",
    "reports"
  );
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(
    reportDirectory,
    `${scope}-${id}-${prepared.contentHash.slice(0, 12)}.md`
  );
  await writeFile(reportPath, ensureTrailingNewline(report), "utf8");

  const state = await loadContentReviewState(root);
  const record: ContentReviewRecord = {
    scope,
    id,
    contentHash: prepared.contentHash,
    verdict,
    reviewedAt: new Date().toISOString(),
    reportPath: path.relative(root, reportPath)
  };
  state.records[reviewKey(scope, id)] = record;
  await saveContentReviewState(root, state);
  return record;
}

export async function getContentReviewStatus(
  root: string,
  scope: ContentReviewScope,
  id: string
): Promise<ContentReviewStatus> {
  const target = await resolveTarget(root, scope, id);
  const contentHash = await hashReviewTarget(root, target);
  const state = await loadContentReviewState(root);
  const record = state.records[reviewKey(scope, id)] ?? null;
  return {
    scope,
    id,
    contentHash,
    record,
    current: record?.contentHash === contentHash
  };
}

export async function writeContentReviewAttestation(
  root: string,
  scope: ContentReviewScope,
  id: string
): Promise<WrittenContentReviewAttestation> {
  const status = await getContentReviewStatus(root, scope, id);
  if (!status.record || !status.current || status.record.verdict !== "PASS") {
    throw new Error(
      `Для ${scope} ${id} нужен актуальный записанный content-review PASS.`
    );
  }

  const reportPath = path.resolve(root, status.record.reportPath);
  const report = await readFile(reportPath);
  const value: ContentReviewAttestation = {
    schemaVersion: 1,
    scope,
    id,
    contentHash: status.contentHash,
    verdict: "PASS",
    reviewedAt: status.record.reviewedAt,
    attestedAt: new Date().toISOString(),
    reportSha256: createHash("sha256").update(report).digest("hex"),
    protocol: "blind-then-consistency-v1"
  };
  const outputPath = path.join(
    root,
    "curriculum",
    "reviews",
    `${scope}-${id}.json`
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: outputPath, value };
}

export function parseContentReviewScope(value: string): ContentReviewScope {
  if (value === "session" || value === "module") {
    return value;
  }
  throw new Error("Scope должен быть session или module.");
}

export function parseContentReviewVerdict(value: string): ContentReviewVerdict {
  if (value === "PASS" || value === "NEEDS_REWRITE") {
    return value;
  }
  throw new Error("Verdict должен быть PASS или NEEDS_REWRITE.");
}

function getAuthoringDirectory(root: string): string {
  return path.join(root, ".authoring");
}

function getContentReviewStatePath(root: string): string {
  return path.join(getAuthoringDirectory(root), "content-review", "state.json");
}

async function resolveTarget(
  root: string,
  scope: ContentReviewScope,
  id: string
): Promise<ReviewTarget> {
  const manifest = await loadManifest(root);
  const sessions = flattenManifest(manifest);
  const roadmap = flattenRoadmap(manifest);

  if (scope === "session") {
    const session = getSession(sessions, id);
    return {
      scope,
      id,
      manifest,
      sessions,
      targetSessions: [session],
      previous: sessions[session.index - 1] ?? null,
      next: sessions[session.index + 1] ?? null,
      nextRoadmap: findNextRoadmap(roadmap, id),
      title: session.definition.title,
      goal: session.definition.outcome
    };
  }

  if (id === manifest.capstone.id) {
    if (manifest.capstone.sessions.some((session) => session.releaseStatus === "planned")) {
      throw new Error(
        `Capstone ${id} нельзя review целиком, пока он содержит planned sessions.`
      );
    }
    const targetSessions = sessions.filter((session) => session.isCapstone);
    if (targetSessions.length === 0) {
      throw new Error(`Capstone ${id} не содержит sessions.`);
    }
    return makeModuleTarget(
      scope,
      id,
      manifest.capstone.title,
      manifest.capstone.goal,
      manifest,
      sessions,
      targetSessions,
      roadmap
    );
  }

  const module = manifest.modules.find((candidate) => candidate.id === id);
  if (!module) {
    throw new Error(`Неизвестный module: ${id}`);
  }
  if (module.sessions.some((session) => session.releaseStatus === "planned")) {
    throw new Error(
      `Module ${id} нельзя review целиком, пока он содержит planned sessions.`
    );
  }
  const targetSessions = sessions.filter((session) => session.module?.id === id);
  return makeModuleTarget(
    scope,
    id,
    module.title,
    module.goal,
    manifest,
    sessions,
    targetSessions,
    roadmap
  );
}

function makeModuleTarget(
  scope: "module",
  id: string,
  title: string,
  goal: string,
  manifest: CourseManifest,
  sessions: FlatSession[],
  targetSessions: FlatSession[],
  roadmap: FlatRoadmapSession[]
): ReviewTarget {
  const first = targetSessions[0];
  const last = targetSessions.at(-1);
  if (!first || !last) {
    throw new Error(`Module ${id} не содержит sessions.`);
  }
  return {
    scope,
    id,
    title,
    goal,
    manifest,
    sessions,
    targetSessions,
    previous: sessions[first.index - 1] ?? null,
    next: sessions[last.index + 1] ?? null,
    nextRoadmap: findNextRoadmap(roadmap, last.definition.id)
  };
}

function findNextRoadmap(
  roadmap: FlatRoadmapSession[],
  id: string
): FlatRoadmapSession | null {
  const current = roadmap.find((session) => session.definition.id === id);
  return current ? (roadmap[current.index + 1] ?? null) : null;
}

async function hashReviewTarget(root: string, target: ReviewTarget): Promise<string> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(reviewManifestContext(target)));
  hash.update("\0");

  for (const profile of await loadCourseProfileDocuments(
    root,
    target.manifest.profiles
  )) {
    hash.update(path.relative(root, profile.path));
    hash.update("\0");
    hash.update(profile.source);
    hash.update("\0");
  }

  for (const document of await loadCourseContextDocuments(
    root,
    target.manifest.courseContextFiles ?? []
  )) {
    hash.update(document.path);
    hash.update("\0");
    hash.update(document.source);
    hash.update("\0");
  }

  const moduleOverview = await readModuleOverview(root, target);
  if (moduleOverview) {
    hash.update(moduleOverview.path);
    hash.update("\0");
    hash.update(moduleOverview.source);
    hash.update("\0");
  }

  const contextSessions = uniqueSessions([
    target.previous,
    ...target.targetSessions,
    target.next
  ]);
  for (const session of contextSessions) {
    const directory = getSessionDirectory(root, session);
    for (const file of await listReviewFiles(directory, session)) {
      const relative = path.relative(root, file.absolutePath);
      hash.update(relative);
      hash.update("\0");
      hash.update(await readFile(file.absolutePath));
      hash.update("\0");
    }
  }
  for (const session of target.targetSessions) {
    const quizKey = await readQuizKey(root, session);
    if (quizKey) {
      hash.update(`quiz-key:${session.definition.id}`);
      hash.update("\0");
      hash.update(quizKey);
      hash.update("\0");
    }
  }

  return hash.digest("hex");
}

async function buildBlindPacket(
  root: string,
  target: ReviewTarget,
  contentHash: string
): Promise<string> {
  const sections = [
    "# Blind learner pass",
    "",
    metadataBlock(target, contentHash),
    "",
    "## Reviewer contract",
    "",
    "Работайте как учащийся с заявленными входными знаниями. У вас нет истории генерации материала и авторских объяснений.",
    "Сначала письменно зафиксируйте: чему учит материал, причинную модель, порядок примеров, точное задание, ожидаемый evidence, DONE и всё, что осталось неясным.",
    "Отдельно отметьте, можно ли отличить исходный факт, допущение, ожидаемый результат, наблюдение и вывод; для практики проверьте preflight, границы безопасного выполнения, stop conditions и cleanup/rollback.",
    "Не открывайте `02-consistency.md`, пока этот blind-разбор не сформулирован. Не изменяйте файлы и не ищите course-support, hints, quiz keys или solutions.",
    "",
    "## Course context",
    "",
    renderCourseContext(target),
    "",
    "## Active profile contracts",
    "",
    await renderProfileContext(root, target),
    "",
    "## Canonical course context",
    "",
    await renderCourseContextDocuments(root, target),
    "",
    "## Module overview",
    "",
    await renderModuleOverview(root, target),
    "",
    "## Previous learning material",
    ""
  ];

  if (target.previous) {
    sections.push(
      await renderSelectedFiles(root, [target.previous], "context")
    );
  } else {
    sections.push("Это первый доступный материал курса.");
  }

  sections.push("", "## Material under review", "");
  sections.push(
    await renderSelectedFiles(root, target.targetSessions, "blind")
  );
  sections.push("", "## Next contract", "");
  sections.push(
    target.next
      ? renderSessionSummary(target.next)
      : target.nextRoadmap
        ? renderRoadmapSummary(target.nextRoadmap)
        : "Это последний шаг курса."
  );

  return ensureTrailingNewline(sections.join("\n"));
}

async function buildConsistencyPacket(
  root: string,
  target: ReviewTarget,
  contentHash: string
): Promise<string> {
  const sections = [
    "# Consistency pass",
    "",
    metadataBlock(target, contentHash),
    "",
    "## Reviewer contract",
    "",
    "Открывайте этот пакет только после blind learner-pass. Теперь сопоставьте собственное понимание с manifest, rubric, acceptance tests и соседними карточками.",
    "Проверьте prerequisites, причинные переходы, соответствие README/rubric/checks/evidence, реалистичность 30–60 минут и естественный handoff к следующей теме.",
    "Для измерений и лабораторных работ убедитесь, что воспроизводимость, источник данных, допустимая область воздействия, stop conditions и cleanup/rollback описаны, а ожидаемое не выдано за фактически измеренное.",
    "Reviewer остаётся read-only и возвращает отчёт, а не переписывает учебный материал.",
    "",
    "## Full course context",
    "",
    renderCourseContext(target),
    "",
    "## Active profile contracts",
    "",
    await renderProfileContext(root, target),
    "",
    "## Canonical course context",
    "",
    await renderCourseContextDocuments(root, target),
    "",
    "## Module overview",
    "",
    await renderModuleOverview(root, target),
    "",
    "## Previous card",
    "",
    target.previous
      ? await renderSelectedFiles(root, [target.previous], "context")
      : "Отсутствует.",
    "",
    "## Material, rubric and tests under review",
    "",
    await renderSelectedFiles(root, target.targetSessions, "consistency"),
    "",
    "## Hidden quiz acceptance evidence",
    "",
    await renderQuizAcceptanceEvidence(root, target.targetSessions),
    "",
    "## Next card",
    "",
    target.next
      ? await renderSelectedFiles(root, [target.next], "context")
      : target.nextRoadmap
        ? renderRoadmapSummary(target.nextRoadmap)
        : "Отсутствует.",
    "",
    "## Required report format",
    "",
    `# Content review: ${target.scope} ${target.id}`,
    "",
    "Verdict: PASS|NEEDS_REWRITE",
    "",
    "## Learner reconstruction",
    "",
    "Что reviewer понял без авторского контекста.",
    "",
    "## Continuity",
    "",
    "Связь prerequisites → текущая идея → следующий шаг.",
    "",
    "## Findings",
    "",
    "Каждый finding: severity BLOCKER|MAJOR|MINOR, evidence и требуемый тип исправления. Не пишите готовое решение упражнения.",
    "",
    "## Evidence and safety",
    "",
    "Достаточность и воспроизводимость evidence; корректность статусов fact/assumption/expected/observed/inference; для практики — preflight, scope, stop conditions и cleanup/rollback.",
    "",
    "## Verdict rationale",
    "",
    "PASS допустим только без открытых BLOCKER и MAJOR."
  ];

  return ensureTrailingNewline(sections.join("\n"));
}

function metadataBlock(target: ReviewTarget, contentHash: string): string {
  return [
    `Scope: ${target.scope}`,
    `ID: ${target.id}`,
    `Title: ${target.title}`,
    `Content hash: ${contentHash}`
  ].join("\n");
}

function renderCourseContext(target: ReviewTarget): string {
  const lines = [
    `Audience: ${target.manifest.audience}`,
    `Profiles: ${target.manifest.profiles.length > 0 ? target.manifest.profiles.join(", ") : "(none)"}`,
    `Assumed concepts: ${formatConcepts(target.manifest.assumedConcepts)}`,
    `Goal: ${target.goal}`,
    "",
    "Full publication roadmap:"
  ];
  for (const module of target.manifest.modules) {
    lines.push(`Module ${module.id}: ${module.title}`);
    for (const definition of module.sessions) {
      lines.push(
        `- ${definition.id} [${definition.releaseStatus ?? "published"}]: ${definition.title}; outcome=${definition.outcome}`
      );
    }
  }
  for (const definition of target.manifest.capstone.sessions) {
    lines.push(
      `- ${definition.id} [${definition.releaseStatus ?? "published"}]: ${definition.title}; outcome=${definition.outcome}`
    );
  }
  lines.push("", "Review neighborhood:");
  for (const session of uniqueSessions([
    target.previous,
    ...target.targetSessions,
    target.next
  ])) {
    const marker = target.targetSessions.some(
      (candidate) => candidate.definition.id === session.definition.id
    )
      ? "→"
      : "-";
    lines.push(`${marker} ${renderSessionSummary(session)}`);
  }
  return lines.join("\n");
}

function renderSessionSummary(session: FlatSession): string {
  const definition = session.definition;
  return [
    `${definition.id}: ${definition.title}`,
    `kind=${definition.kind}`,
    `minutes=${definition.minutes}`,
    `outcome=${definition.outcome}`,
    `done=${definition.done}`,
    `evidence.produces=[${definition.evidence.produces.join(", ")}]`,
    `evidence.verifiedBy=[${definition.evidence.verifiedBy.join(", ")}]`,
    `requires=[${definition.requires.join(", ")}]`,
    `introduces=[${definition.introduces.join(", ")}]`,
    `defers=[${definition.defers.join(", ")}]`
  ].join("; ");
}

function renderRoadmapSummary(session: FlatRoadmapSession): string {
  const definition = session.definition;
  return [
    `${definition.id}: ${definition.title}`,
    `releaseStatus=${definition.releaseStatus ?? "published"}`,
    `kind=${definition.kind}`,
    `minutes=${definition.minutes}`,
    `outcome=${definition.outcome}`,
    `requires=[${definition.requires.join(", ")}]`,
    `introduces=[${definition.introduces.join(", ")}]`,
    `defers=[${definition.defers.join(", ")}]`,
    "Learner material для planned session ещё не опубликован."
  ].join("; ");
}

async function renderProfileContext(
  root: string,
  target: ReviewTarget
): Promise<string> {
  const profiles = await loadCourseProfileDocuments(root, target.manifest.profiles);
  if (profiles.length === 0) {
    return "Для курса не выбраны дополнительные profiles.";
  }
  return profiles
    .map((profile) =>
      [
        `### Profile: ${profile.id}`,
        "",
        `Source: ${path.relative(root, profile.path)}`,
        "",
        profile.source.trimEnd()
      ].join("\n")
    )
    .join("\n\n");
}

async function renderCourseContextDocuments(
  root: string,
  target: ReviewTarget
): Promise<string> {
  const documents = await loadCourseContextDocuments(
    root,
    target.manifest.courseContextFiles ?? []
  );
  if (documents.length === 0) {
    return "Дополнительные course context files не выбраны.";
  }
  return documents
    .map((document) =>
      [
        `### Context: ${document.path}`,
        "",
        document.source.trimEnd()
      ].join("\n")
    )
    .join("\n\n");
}

async function renderModuleOverview(
  root: string,
  target: ReviewTarget
): Promise<string> {
  const overview = await readModuleOverview(root, target);
  if (!overview) {
    return "Module README отсутствует.";
  }
  return [
    `Source: ${overview.path}`,
    "",
    overview.source.trimEnd()
  ].join("\n");
}

async function readModuleOverview(
  root: string,
  target: ReviewTarget
): Promise<{ path: string; source: string } | null> {
  const first = target.targetSessions[0];
  if (!first) {
    return null;
  }
  const absolutePath = path.join(getModuleDirectory(root, first), "README.md");
  try {
    return {
      path: path.relative(root, absolutePath),
      source: await readFile(absolutePath, "utf8")
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function reviewManifestContext(target: ReviewTarget): unknown {
  return {
    language: target.manifest.language,
    audience: target.manifest.audience,
    profiles: target.manifest.profiles,
    courseContextFiles: target.manifest.courseContextFiles ?? [],
    assumedConcepts: target.manifest.assumedConcepts,
    scope: target.scope,
    id: target.id,
    title: target.title,
    goal: target.goal,
    modules: target.manifest.modules.map((module) => ({
      id: module.id,
      slug: module.slug,
      title: module.title,
      goal: module.goal,
      sessions: module.sessions
    })),
    capstone: target.manifest.capstone
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function renderSelectedFiles(
  root: string,
  sessions: FlatSession[],
  selection: ReviewPacketSelection
): Promise<string> {
  const sections: string[] = [];
  for (const session of sessions) {
    const directory = getSessionDirectory(root, session);
    for (const file of await listReviewFiles(directory, session)) {
      if (!selectedForPacket(file, selection)) {
        continue;
      }
      const fileStat = await stat(file.absolutePath);
      const heading = `### File: ${path.relative(root, file.absolutePath)}`;
      if (isInlineTextFile(file.relativeToSession) && fileStat.size <= maxInlineBytes) {
        sections.push(
          heading,
          "",
          "~~~~",
          (await readFile(file.absolutePath, "utf8")).trimEnd(),
          "~~~~",
          ""
        );
      } else {
        const digest = createHash("sha256")
          .update(await readFile(file.absolutePath))
          .digest("hex");
        sections.push(
          heading,
          "",
          `[not inlined: ${fileStat.size} bytes, sha256=${digest}]`,
          "Если этот файл необходим для понимания задания или evidence, рядом нужен текстовый companion с форматом, способом получения и критериями интерпретации.",
          ""
        );
      }
    }
  }
  return sections.length > 0 ? sections.join("\n").trimEnd() : "(no files)";
}

function selectedForPacket(
  file: ReviewFile,
  selection: ReviewPacketSelection
): boolean {
  if (selection === "context") {
    return file.role === "learner" && isContextFile(file.relativeToSession);
  }
  if (selection === "blind") {
    return file.role === "learner";
  }
  return true;
}

async function renderQuizAcceptanceEvidence(
  root: string,
  sessions: FlatSession[]
): Promise<string> {
  const sections: string[] = [];
  for (const session of sessions) {
    if (!session.definition.checks.includes("quiz")) {
      continue;
    }
    const key = await readQuizKey(root, session);
    sections.push(
      `### ${session.definition.id} quiz key`,
      "",
      key
        ? ["~~~json", key.trim(), "~~~"].join("\n")
        : "Quiz key недоступен в локальных refs. Fetch course-support перед финальным content-review.",
      ""
    );
  }
  return sections.length > 0
    ? sections.join("\n").trimEnd()
    : "У material under review нет quiz check.";
}

async function readQuizKey(
  root: string,
  session: FlatSession
): Promise<string | null> {
  if (!session.definition.checks.includes("quiz")) {
    return null;
  }
  try {
    return await readSupportFile(root, `quizzes/${session.definition.id}.key.json`);
  } catch {
    return null;
  }
}

async function listReviewFiles(
  directory: string,
  session: FlatSession
): Promise<ReviewFile[]> {
  if (!(await fileExists(directory))) {
    return [];
  }
  const candidates = await listRegularFiles(directory);
  const selection = session.definition.contentReview;
  const learner = new Set(selection?.learner ?? []);
  const consistency = new Set(selection?.consistency ?? []);
  const excluded = new Set(selection?.exclude ?? []);
  const result: ReviewFile[] = [];
  const candidatePaths = new Set(
    candidates.map((absolutePath) =>
      toPortablePath(path.relative(directory, absolutePath))
    )
  );

  for (const configuredPath of [
    ...learner,
    ...consistency,
    ...excluded
  ]) {
    if (!candidatePaths.has(configuredPath)) {
      throw new Error(
        `${session.definition.id}: contentReview ссылается на отсутствующий файл ${configuredPath}.`
      );
    }
  }

  for (const absolutePath of candidates) {
    const relativeToSession = toPortablePath(path.relative(directory, absolutePath));
    if (isNeverIncludedFile(relativeToSession) || excluded.has(relativeToSession)) {
      continue;
    }
    const role: ReviewFileRole = learner.has(relativeToSession)
      ? "learner"
      : consistency.has(relativeToSession)
        ? "consistency"
        : defaultReviewFileRole(relativeToSession);
    result.push({ absolutePath, relativeToSession, role });
  }
  return result;
}

async function listRegularFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listRegularFiles(target)));
    } else if (entry.isFile()) {
      result.push(target);
    }
  }
  return result;
}

function defaultReviewFileRole(relativePath: string): ReviewFileRole {
  const portable = relativePath.toLowerCase();
  const segments = portable.split("/");
  const name = segments.at(-1) ?? portable;
  if (
    name === "rubric.md" ||
    name === "quiz.json" ||
    segments.some((segment) => segment === "test" || segment === "tests" || segment === "__tests__") ||
    /\.(test|spec)\.[^.]+$/i.test(name) ||
    /_test\.[^.]+$/i.test(name) ||
    /test\.(java|kt|kts)$/i.test(name)
  ) {
    return "consistency";
  }
  return "learner";
}

function isContextFile(relativePath: string): boolean {
  const name = path.posix.basename(relativePath).toLowerCase();
  return (
    name === "readme.md" ||
    name === "quiz.md" ||
    name === "lab.md" ||
    name === "worksheet.md" ||
    name === "task.md"
  );
}

function isInlineTextFile(relativePath: string): boolean {
  const name = path.posix.basename(relativePath);
  const lowerName = name.toLowerCase();
  return (
    inlineTextNames.has(name) ||
    lowerName.endsWith(".env.example") ||
    inlineTextExtensions.has(path.posix.extname(lowerName))
  );
}

function isNeverIncludedFile(relativePath: string): boolean {
  const name = path.posix.basename(relativePath).toLowerCase();
  return (
    neverIncludedFiles.has(name) ||
    name === ".env" ||
    (name.startsWith(".env.") && name !== ".env.example") ||
    name === ".npmrc" ||
    name === ".pypirc" ||
    name.startsWith("secrets.") ||
    secretExtensions.has(path.posix.extname(name))
  );
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function uniqueSessions(values: Array<FlatSession | null>): FlatSession[] {
  const seen = new Set<string>();
  return values.filter((session): session is FlatSession => {
    if (!session || seen.has(session.definition.id)) {
      return false;
    }
    seen.add(session.definition.id);
    return true;
  });
}

async function loadContentReviewState(root: string): Promise<ContentReviewState> {
  const statePath = getContentReviewStatePath(root);
  if (!(await fileExists(statePath))) {
    return { schemaVersion: 1, records: {} };
  }
  const value = JSON.parse(await readFile(statePath, "utf8")) as unknown;
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.records)) {
    throw new Error(`Некорректная структура ${statePath}.`);
  }
  return value as unknown as ContentReviewState;
}

async function saveContentReviewState(
  root: string,
  state: ContentReviewState
): Promise<void> {
  const statePath = getContentReviewStatePath(root);
  const directory = path.dirname(statePath);
  const temporaryPath = path.join(
    directory,
    `state.tmp-${process.pid}-${Date.now()}.json`
  );
  await mkdir(directory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

function validateReport(report: string, verdict: ContentReviewVerdict): void {
  const verdictMatch = report.match(/^Verdict:\s*(PASS|NEEDS_REWRITE)\s*$/m);
  if (!verdictMatch) {
    throw new Error("Report должен содержать строку Verdict: PASS|NEEDS_REWRITE.");
  }
  if (verdictMatch[1] !== verdict) {
    throw new Error(
      `Verdict команды ${verdict} не совпадает с report ${verdictMatch[1]}.`
    );
  }
  for (const heading of [
    "## Learner reconstruction",
    "## Continuity",
    "## Findings",
    "## Evidence and safety",
    "## Verdict rationale"
  ]) {
    if (!report.includes(heading)) {
      throw new Error(`Report не содержит обязательный раздел ${heading}.`);
    }
  }
}

function reviewKey(scope: ContentReviewScope, id: string): string {
  return `${scope}:${id}`;
}

function formatConcepts(concepts: string[]): string {
  return concepts.length > 0 ? concepts.join(", ") : "(none)";
}

function ensureTrailingNewline(value: string): string {
  return `${value.trimEnd()}\n`;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
