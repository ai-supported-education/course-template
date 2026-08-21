import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { flattenManifest, getSession, loadManifest } from "./manifest.js";
import { readSupportFile } from "./support.js";
import type { CourseManifest, FlatSession } from "./types.js";
import { getSessionDirectory } from "./workspace.js";

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
  title: string;
  goal: string;
}

const visibleExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".ts",
  ".tsx"
]);
const ignoredDirectories = new Set([
  ".authoring",
  ".git",
  ".training",
  "coverage",
  "dist",
  "node_modules"
]);
const neverIncludedFiles = new Set(["answers.json"]);
const consistencyOnlyFiles = new Set([
  "exercise.test.tsx",
  "quiz.json",
  "rubric.md"
]);

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
      title: session.definition.title,
      goal: session.definition.outcome
    };
  }

  if (id === manifest.capstone.id) {
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
      targetSessions
    );
  }

  const module = manifest.modules.find((candidate) => candidate.id === id);
  if (!module) {
    throw new Error(`Неизвестный module: ${id}`);
  }
  const targetSessions = sessions.filter((session) => session.module?.id === id);
  return makeModuleTarget(
    scope,
    id,
    module.title,
    module.goal,
    manifest,
    sessions,
    targetSessions
  );
}

function makeModuleTarget(
  scope: "module",
  id: string,
  title: string,
  goal: string,
  manifest: CourseManifest,
  sessions: FlatSession[],
  targetSessions: FlatSession[]
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
    next: sessions[last.index + 1] ?? null
  };
}

async function hashReviewTarget(root: string, target: ReviewTarget): Promise<string> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(reviewManifestContext(target)));
  hash.update("\0");

  const contextSessions = uniqueSessions([
    target.previous,
    ...target.targetSessions,
    target.next
  ]);
  for (const session of contextSessions) {
    const directory = getSessionDirectory(root, session);
    for (const file of await listVisibleFiles(directory)) {
      const relative = path.relative(root, file);
      hash.update(relative);
      hash.update("\0");
      hash.update(await readFile(file));
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
    "Сначала письменно зафиксируйте: чему учит материал, причинную модель, порядок примеров, точное задание, DONE и всё, что осталось неясным.",
    "Не открывайте `02-consistency.md`, пока этот blind-разбор не сформулирован. Не изменяйте файлы и не ищите course-support, hints, quiz keys или solutions.",
    "",
    "## Course context",
    "",
    renderCourseContext(target),
    "",
    "## Previous learning material",
    ""
  ];

  if (target.previous) {
    sections.push(
      await renderSelectedFiles(root, [target.previous], learnerContextFile)
    );
  } else {
    sections.push("Это первый доступный материал курса.");
  }

  sections.push("", "## Material under review", "");
  sections.push(
    await renderSelectedFiles(root, target.targetSessions, blindTargetFile)
  );
  sections.push("", "## Next contract", "");
  sections.push(
    target.next ? renderSessionSummary(target.next) : "Это последний шаг курса."
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
    "Проверьте prerequisites, причинные переходы, соответствие README/rubric/tests, реалистичность 30–60 минут и естественный handoff к следующей теме.",
    "Reviewer остаётся read-only и возвращает отчёт, а не переписывает учебный материал.",
    "",
    "## Full course context",
    "",
    renderCourseContext(target),
    "",
    "## Previous card",
    "",
    target.previous
      ? await renderSelectedFiles(root, [target.previous], learnerContextFile)
      : "Отсутствует.",
    "",
    "## Material, rubric and tests under review",
    "",
    await renderSelectedFiles(root, target.targetSessions, consistencyTargetFile),
    "",
    "## Hidden quiz acceptance evidence",
    "",
    await renderQuizAcceptanceEvidence(root, target.targetSessions),
    "",
    "## Next card",
    "",
    target.next
      ? await renderSelectedFiles(root, [target.next], learnerContextFile)
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
    `Assumed concepts: ${formatConcepts(target.manifest.assumedConcepts)}`,
    `Goal: ${target.goal}`,
    "",
    "Ordered route:"
  ];
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
    `outcome=${definition.outcome}`,
    `requires=[${definition.requires.join(", ")}]`,
    `introduces=[${definition.introduces.join(", ")}]`,
    `defers=[${definition.defers.join(", ")}]`
  ].join("; ");
}

function reviewManifestContext(target: ReviewTarget): unknown {
  return {
    language: target.manifest.language,
    audience: target.manifest.audience,
    assumedConcepts: target.manifest.assumedConcepts,
    scope: target.scope,
    id: target.id,
    title: target.title,
    goal: target.goal,
    sessions: uniqueSessions([
      target.previous,
      ...target.targetSessions,
      target.next
    ]).map((session) => session.definition)
  };
}

async function renderSelectedFiles(
  root: string,
  sessions: FlatSession[],
  predicate: (name: string) => boolean
): Promise<string> {
  const sections: string[] = [];
  for (const session of sessions) {
    const directory = getSessionDirectory(root, session);
    for (const file of await listVisibleFiles(directory)) {
      if (!predicate(path.basename(file))) {
        continue;
      }
      sections.push(
        `### File: ${path.relative(root, file)}`,
        "",
        "~~~",
        (await readFile(file, "utf8")).trimEnd(),
        "~~~",
        ""
      );
    }
  }
  return sections.length > 0 ? sections.join("\n").trimEnd() : "(no files)";
}

function learnerContextFile(name: string): boolean {
  return name === "README.md" || name === "quiz.md";
}

function blindTargetFile(name: string): boolean {
  return !consistencyOnlyFiles.has(name) && !neverIncludedFiles.has(name);
}

function consistencyTargetFile(name: string): boolean {
  return !neverIncludedFiles.has(name);
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

async function listVisibleFiles(directory: string): Promise<string[]> {
  if (!(await fileExists(directory))) {
    return [];
  }
  const result: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    if (entry.isFile() && neverIncludedFiles.has(entry.name)) {
      continue;
    }
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listVisibleFiles(target)));
    } else if (entry.isFile() && visibleExtensions.has(path.extname(entry.name))) {
      result.push(target);
    }
  }
  return result;
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
