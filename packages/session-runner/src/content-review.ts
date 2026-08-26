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
export const CONTENT_REVIEW_STAGES = ["novice", "consistency"] as const;
export const CONTENT_REVIEW_PROTOCOL =
  "novice-walkthrough-consistency-v6" as const;
export const CONTENT_REVIEW_OPENING_MARKER =
  "<!-- content-review:opening:end -->" as const;
export const LEARNER_FACING_LANGUAGE_PATH =
  "docs/learner-facing-language.md" as const;
export type ContentReviewVerdict = (typeof CONTENT_REVIEW_VERDICTS)[number];
export type ContentReviewStage = (typeof CONTENT_REVIEW_STAGES)[number];
export type ContentReviewScope = "session" | "module";

export interface PreparedContentReview {
  scope: ContentReviewScope;
  id: string;
  contentHash: string;
  packetDirectory: string;
  novicePacketPath: string;
  blindPacketPath: string;
  consistencyPacketPath: string;
}

export interface ContentReviewRecord {
  scope: ContentReviewScope;
  id: string;
  stage: ContentReviewStage;
  contentHash: string;
  verdict: ContentReviewVerdict;
  reviewedAt: string;
  reportPath: string;
}

export interface ContentReviewStatus {
  scope: ContentReviewScope;
  id: string;
  contentHash: string;
  reviews: Record<
    ContentReviewStage,
    { record: ContentReviewRecord | null; current: boolean }
  >;
  current: boolean;
}

export interface ContentReviewAttestation {
  schemaVersion: 2;
  scope: ContentReviewScope;
  id: string;
  contentHash: string;
  verdict: "PASS";
  attestedAt: string;
  reviews: Record<
    ContentReviewStage,
    { verdict: "PASS"; reviewedAt: string; reportSha256: string }
  >;
  protocol: typeof CONTENT_REVIEW_PROTOCOL;
}

export interface WrittenContentReviewAttestation {
  path: string;
  value: ContentReviewAttestation;
}

interface ContentReviewState {
  schemaVersion: 2;
  records: Record<
    string,
    Partial<Record<ContentReviewStage, ContentReviewRecord>>
  >;
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
type ReviewPacketSelection =
  | "context"
  | "blind"
  | "consistency";

interface ReviewFile {
  absolutePath: string;
  relativeToSession: string;
  role: ReviewFileRole;
}

interface NoviceOpeningDocument {
  absolutePath: string;
  relativePath: string;
  opening: string;
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
  const novicePacketPath = path.join(packetDirectory, "00-novice.md");
  const blindPacketPath = path.join(packetDirectory, "01-blind.md");
  const consistencyPacketPath = path.join(packetDirectory, "02-consistency.md");

  await mkdir(packetDirectory, { recursive: true });
  await writeFile(
    novicePacketPath,
    await buildNovicePacket(root, target),
    "utf8"
  );
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
    novicePacketPath,
    blindPacketPath,
    consistencyPacketPath
  };
}

export async function recordContentReview(
  root: string,
  stage: ContentReviewStage,
  scope: ContentReviewScope,
  id: string,
  verdict: ContentReviewVerdict,
  sourceReportPath: string
): Promise<ContentReviewRecord> {
  const prepared = await prepareContentReview(root, scope, id);
  const report = await readFile(path.resolve(sourceReportPath), "utf8");
  validateReport(stage, report, verdict);

  const reportDirectory = path.join(
    getAuthoringDirectory(root),
    "content-review",
    "reports"
  );
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(
    reportDirectory,
    `${scope}-${id}-${stage}-${prepared.contentHash.slice(0, 12)}.md`
  );
  await writeFile(reportPath, ensureTrailingNewline(report), "utf8");

  const state = await loadContentReviewState(root);
  const record: ContentReviewRecord = {
    scope,
    id,
    stage,
    contentHash: prepared.contentHash,
    verdict,
    reviewedAt: new Date().toISOString(),
    reportPath: path.relative(root, reportPath)
  };
  const key = reviewKey(scope, id);
  state.records[key] = {
    ...(state.records[key] ?? {}),
    [stage]: record
  };
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
  const records = state.records[reviewKey(scope, id)] ?? {};
  const noviceRecord = records.novice ?? null;
  const consistencyRecord = records.consistency ?? null;
  const reviews = {
    novice: {
      record: noviceRecord,
      current: noviceRecord?.contentHash === contentHash
    },
    consistency: {
      record: consistencyRecord,
      current: consistencyRecord?.contentHash === contentHash
    }
  };
  return {
    scope,
    id,
    contentHash,
    reviews,
    current: CONTENT_REVIEW_STAGES.every(
      (stage) =>
        reviews[stage].current && reviews[stage].record?.verdict === "PASS"
    )
  };
}

export async function writeContentReviewAttestation(
  root: string,
  scope: ContentReviewScope,
  id: string
): Promise<WrittenContentReviewAttestation> {
  const status = await getContentReviewStatus(root, scope, id);
  if (!status.current) {
    throw new Error(
      `Для ${scope} ${id} нужны два актуальных content-review PASS: novice и consistency.`
    );
  }

  const noviceRecord = status.reviews.novice.record;
  const consistencyRecord = status.reviews.consistency.record;
  if (!noviceRecord || !consistencyRecord) {
    throw new Error(
      `Для ${scope} ${id} нужны два актуальных content-review PASS: novice и consistency.`
    );
  }
  const noviceReport = await readFile(path.resolve(root, noviceRecord.reportPath));
  const consistencyReport = await readFile(
    path.resolve(root, consistencyRecord.reportPath)
  );
  const value: ContentReviewAttestation = {
    schemaVersion: 2,
    scope,
    id,
    contentHash: status.contentHash,
    verdict: "PASS",
    attestedAt: new Date().toISOString(),
    reviews: {
      novice: {
        verdict: "PASS",
        reviewedAt: noviceRecord.reviewedAt,
        reportSha256: createHash("sha256")
          .update(noviceReport)
          .digest("hex")
      },
      consistency: {
        verdict: "PASS",
        reviewedAt: consistencyRecord.reviewedAt,
        reportSha256: createHash("sha256")
          .update(consistencyReport)
          .digest("hex")
      }
    },
    protocol: CONTENT_REVIEW_PROTOCOL
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

export function parseContentReviewStage(value: string): ContentReviewStage {
  if (value === "novice" || value === "consistency") {
    return value;
  }
  throw new Error("Stage должен быть novice или consistency.");
}

export function parseContentReviewVerdict(value: string): ContentReviewVerdict {
  if (value === "PASS" || value === "NEEDS_REWRITE") {
    return value;
  }
  throw new Error("Verdict должен быть PASS или NEEDS_REWRITE.");
}

export function formatPreparedContentReview(
  prepared: PreparedContentReview
): string {
  return [
    `Content review packet готов для ${prepared.scope} ${prepared.id}.`,
    `Hash: ${prepared.contentHash}.`,
    `Novice packet: ${prepared.novicePacketPath}.`,
    `Blind learner packet: ${prepared.blindPacketPath}.`,
    `Consistency evidence packet: ${prepared.consistencyPacketPath}.`,
    "Запустите ДВУХ независимых fresh subagents с fork_turns=none.",
    "1. Novice-agent сначала получает только 00-novice.md и возвращает first-contact checkpoint. Сохраните checkpoint до продолжения.",
    "2. Если checkpoint CLEAR, тому же novice-agent отдельным follow-up передайте только 01-blind.md. Он проходит весь learner-facing материал и возвращает итоговый novice report; 02 ему не показывайте.",
    "3. Другой consistency-agent не получает novice packets или reports. Он независимо читает 01-blind.md, письменно фиксирует reconstruction, затем открывает 02-consistency.md.",
    `Запись novice: pnpm author:content-review --record novice ${prepared.scope} ${prepared.id} PASS|NEEDS_REWRITE --report <path>.`,
    `Запись consistency: pnpm author:content-review --record consistency ${prepared.scope} ${prepared.id} PASS|NEEDS_REWRITE --report <path>.`
  ].join("\n");
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
    throw new Error(`Module ${id} не содержит published sessions.`);
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
  hash.update(`protocol:${CONTENT_REVIEW_PROTOCOL}`);
  hash.update("\0");
  hash.update(JSON.stringify(reviewManifestContext(target)));
  hash.update("\0");

  const languageContract = await readLearnerFacingLanguage(root);
  hash.update(languageContract.path);
  hash.update("\0");
  hash.update(languageContract.source);
  hash.update("\0");

  for (const document of await collectNoviceOpeningDocuments(root, target)) {
    hash.update(`novice-opening:${document.relativePath}`);
    hash.update("\0");
    hash.update(document.opening);
    hash.update("\0");
  }

  const courseOverview = await readCourseOverview(root, target);
  if (courseOverview) {
    hash.update(`course-overview:${courseOverview.path}`);
    hash.update("\0");
    hash.update(courseOverview.source);
    hash.update("\0");
  }

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
  for (const session of collectPrerequisiteSourceSessions(target)) {
    const absolutePath = path.join(getSessionDirectory(root, session), "README.md");
    hash.update(`prerequisite-source:${session.definition.id}`);
    hash.update("\0");
    hash.update(path.relative(root, absolutePath));
    hash.update("\0");
    hash.update(await readFile(absolutePath));
    hash.update("\0");
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

async function buildNovicePacket(
  root: string,
  target: ReviewTarget
): Promise<string> {
  const sections = [
    "# Novice phase 1: sealed first contact",
    "",
    "## Reviewer contract",
    "",
    "Вы — fresh reviewer без истории генерации и с ровно теми входными знаниями, которые объявлены ниже. Это первая из двух фаз novice-review. Вам физически показаны только вступления learner README до author marker; поздний текст намеренно отсутствует.",
    describeNoviceCoverage(target),
    "Не достраивайте пропуски из собственных экспертных знаний. Если смысл можно восстановить только потому, что вы уже знаете предмет или API, это finding, а не доказательство понятности.",
    "Построчно проверьте указательные ссылки (`такой`, `этот`, `похожий`, `здесь` и аналогичные): назовите точный antecedent, который уже появился до ссылки. Если его нет или вариантов несколько, зафиксируйте разрыв.",
    "Составьте список каждого центрального identifier, API, команды и термина в порядке первого появления. Для каждого укажите место, где до использования объяснены его роль и происхождение. Простого узнавания имени reviewer недостаточно.",
    "Для каждого ведущего примера восстановите начальное состояние, событие или действие и наблюдаемый результат. Если хотя бы одно звено отсутствует, учащийся не может проверить причинную связь по opening.",
    "Позднее объяснение не исправляет opening задним числом. Центральный identifier/API, использованный без доступного введения и необходимый для понимания ведущего примера, — MAJOR и требует NEEDS_REWRITE.",
    "Сначала верните отдельный first-contact checkpoint. Не выносите итоговый verdict по всему материалу: вы ещё не видели его полностью. Родитель должен сохранить checkpoint до следующей фазы.",
    "Не открывайте `01-blind.md`, пока родитель не вернётся отдельным follow-up после сохранения checkpoint. Не открывайте `02-consistency.md`, repository files, profiles, rubric, hints или solution. Не меняйте файлы.",
    "",
    "## Declared learner baseline",
    "",
    renderNoviceBaseline(target),
    "",
    "## Previous learner-visible result",
    "",
    renderPreviousLearnerSummary(target),
    "",
    "## Opening excerpts",
    "",
    await renderNoviceOpeningDocuments(root, target),
    "",
    "## Required checkpoint format",
    "",
    `# Novice first-contact checkpoint: ${target.scope} ${target.id}`,
    "",
    "Checkpoint: CLEAR|REWRITE",
    "",
    "## Opening reconstruction",
    "",
    "Где оказался учащийся, на что опирается вступление, какой вопрос ведёт материал; для каждого примера — initial state, event/action и observation.",
    "",
    "## Reference audit",
    "",
    "Каждая указательная ссылка и её однозначный antecedent, появившийся раньше.",
    "",
    "## Identifier and API audit",
    "",
    "Каждый центральный identifier/API/термин в порядке появления и точное место его доступного введения. Отметьте места, понятные только благодаря экспертным знаниям reviewer.",
    "",
    "## Findings",
    "",
    "Каждый finding: severity BLOCKER|MAJOR|MINOR, точная цитата, learner effect и требуемый тип исправления. Не дописывайте материал за автора.",
    "",
    "## Checkpoint rationale",
    "",
    "CLEAR допустим только без открытых BLOCKER и MAJOR; неизвестный центральный identifier/API является MAJOR. При CLEAR ожидайте отдельный learner packet и продолжайте в том же диалоге, не пересматривая first-contact задним числом."
  ];

  return ensureTrailingNewline(sections.join("\n"));
}

function describeNoviceCoverage(target: ReviewTarget): string {
  const startsCourse = targetStartsCourse(target);
  if (startsCourse) {
    return "Scope note: это начало курса, поэтому packet показывает openings курса, module и проверяемых sessions. Оцените каждый уровень отдельно.";
  }
  if (target.scope === "module") {
    return "Scope note: это последующая глава. Packet показывает learner-visible итог предыдущей карточки, opening module и openings его published sessions. Корневой README намеренно отсутствует.";
  }
  return "Scope note: это последующая карточка. Packet показывает learner-visible итог предыдущей карточки, opening её module и opening текущей session. Корневой README намеренно отсутствует.";
}

function renderNoviceBaseline(target: ReviewTarget): string {
  return [
    `Audience: ${target.manifest.audience}`,
    `Assumed concepts: ${formatConcepts(target.manifest.assumedConcepts)}`
  ].join("\n");
}

function targetStartsCourse(target: ReviewTarget): boolean {
  return target.targetSessions[0]?.index === 0;
}

async function readCourseOverview(
  root: string,
  target: ReviewTarget
): Promise<{ path: string; source: string } | null> {
  if (!targetStartsCourse(target)) {
    return null;
  }
  const absolutePath = path.join(root, "README.md");
  try {
    return {
      path: toPortablePath(path.relative(root, absolutePath)),
      source: await readFile(absolutePath, "utf8")
    };
  } catch (error) {
    throw new Error(
      `Не удалось прочитать обязательный course overview ${absolutePath}: ${formatError(error)}`
    );
  }
}

async function renderCourseOverview(
  root: string,
  target: ReviewTarget
): Promise<string> {
  const overview = await readCourseOverview(root, target);
  if (!overview) {
    return "Корневой README намеренно не включён: проверяемый scope начинается после первой карточки курса и получает continuity из предыдущего learner-visible результата.";
  }
  return [
    `Source: ${overview.path}`,
    "",
    overview.source.trimEnd()
  ].join("\n");
}

function renderPreviousLearnerSummary(target: ReviewTarget): string {
  if (!target.previous) {
    return "Это первый материал курса; предыдущего результата нет.";
  }
  return [
    `Title: ${target.previous.definition.title}`,
    `Outcome: ${target.previous.definition.outcome}`,
    `DONE: ${target.previous.definition.done}`
  ].join("\n");
}

async function collectNoviceOpeningDocuments(
  root: string,
  target: ReviewTarget
): Promise<NoviceOpeningDocument[]> {
  const documents: NoviceOpeningDocument[] = [];
  const seen = new Set<string>();
  const first = target.targetSessions[0];
  if (!first) {
    return documents;
  }

  const addReadme = async (absolutePath: string): Promise<void> => {
    if (seen.has(absolutePath)) {
      return;
    }
    seen.add(absolutePath);
    let source: string;
    try {
      source = await readFile(absolutePath, "utf8");
    } catch (error) {
      throw new Error(
        `Не удалось прочитать обязательный learner README ${absolutePath}: ${formatError(error)}`
      );
    }
    const markerIndex = source.indexOf(CONTENT_REVIEW_OPENING_MARKER);
    if (markerIndex < 0) {
      throw new Error(
        `В обязательном learner README ${absolutePath} отсутствует marker ${CONTENT_REVIEW_OPENING_MARKER}. Разместите его сразу после opening.`
      );
    }
    if (source.lastIndexOf(CONTENT_REVIEW_OPENING_MARKER) !== markerIndex) {
      throw new Error(
        `В обязательном learner README ${absolutePath} marker ${CONTENT_REVIEW_OPENING_MARKER} должен встречаться ровно один раз.`
      );
    }
    const opening = source.slice(0, markerIndex).trimEnd();
    if (!opening.trim()) {
      throw new Error(
        `Opening перед marker ${CONTENT_REVIEW_OPENING_MARKER} в ${absolutePath} пуст.`
      );
    }
    documents.push({
      absolutePath,
      relativePath: toPortablePath(path.relative(root, absolutePath)),
      opening
    });
  };

  const startsCourse = targetStartsCourse(target);

  if (startsCourse) {
    await addReadme(path.join(root, "README.md"));
  }
  await addReadme(path.join(getModuleDirectory(root, first), "README.md"));

  for (const session of target.targetSessions) {
    await addReadme(path.join(getSessionDirectory(root, session), "README.md"));
  }

  return documents;
}

async function renderNoviceOpeningDocuments(
  root: string,
  target: ReviewTarget
): Promise<string> {
  const documents = await collectNoviceOpeningDocuments(root, target);
  if (documents.length === 0) {
    return "(no opening excerpts)";
  }

  const sections: string[] = [];
  for (const document of documents) {
    const heading = `### File: ${document.relativePath}`;
    sections.push(heading, "", "~~~~", document.opening, "~~~~", "");
  }
  return sections.join("\n").trimEnd();
}

function isHiddenAuthorSupportFile(relativePath: string): boolean {
  const portable = relativePath.toLowerCase();
  const segments = portable.split("/");
  const name = segments.at(-1) ?? portable;
  return (
    segments.some((segment) =>
      [
        "answer",
        "answers",
        "course-support",
        "hint",
        "hints",
        "reference-solution",
        "reference-solutions",
        "solution",
        "solutions"
      ].includes(segment)
    ) ||
    name.endsWith(".key.json") ||
    /^(?:answers?|hints?|solutions?)(?:[._-]|$)/.test(name) ||
    /^reference[._-]?solutions?(?:[._-]|$)/.test(name)
  );
}

async function readLearnerFacingLanguage(
  root: string
): Promise<{ path: string; source: string }> {
  const absolutePath = path.join(root, LEARNER_FACING_LANGUAGE_PATH);
  try {
    const source = await readFile(absolutePath, "utf8");
    if (!source.trim()) {
      throw new Error("файл пуст");
    }
    return {
      path: LEARNER_FACING_LANGUAGE_PATH,
      source
    };
  } catch (error) {
    throw new Error(
      `Не удалось прочитать обязательный learner-facing language contract ${absolutePath}: ${formatError(error)}`
    );
  }
}

async function buildBlindPacket(
  root: string,
  target: ReviewTarget,
  contentHash: string
): Promise<string> {
  const sections = [
    "# Blind learner-facing material",
    "",
    metadataBlock(target, contentHash),
    "",
    "## Reviewer contract",
    "",
    "Packet содержит полный learner-facing маршрут без rubric, acceptance intent, profiles и авторских объяснений. Его независимо читают novice-reviewer во второй фазе и consistency-reviewer в первой; отчёты друг друга они не получают.",
    "Если вы novice-reviewer, открывайте этот packet только после собственного сохранённого first-contact checkpoint и отдельного follow-up родителя. Пройдите материал сверху вниз как учащийся: проверьте каждое объяснение, пример, переход, задание, evidence и DONE. Не улучшайте выводы first-contact благодаря позднему тексту; перенесите их в итоговый report без ретроспективного смягчения. Не открывайте `02-consistency.md`.",
    "Если вы consistency-reviewer, это ваша первая фаза. Вы не читаете `00-novice.md`, checkpoint или итоговый novice report. До открытия `02-consistency.md` письменно восстановите outcome, причинную модель, порядок примеров, точное задание, ожидаемый evidence, DONE и всё, что осталось неясным.",
    "Для обеих ролей: работайте как учащийся с заявленными входными знаниями. Отметьте неизвестные термины, скрытые переходы и места, понятные только из собственных экспертных знаний. Различайте исходный факт, допущение, ожидаемый результат, наблюдение и вывод; для практики проверьте preflight, безопасный scope, stop conditions и cleanup/rollback.",
    "Не изменяйте файлы и не ищите repository, course-support, hints, quiz keys или solutions.",
    "",
    "## Declared learner baseline",
    "",
    renderNoviceBaseline(target),
    "",
    "## Course overview",
    "",
    await renderCourseOverview(root, target),
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
      ? renderLearnerVisibleSessionSummary(target.next)
      : target.nextRoadmap
        ? renderLearnerVisibleRoadmapSummary(target.nextRoadmap)
        : "Это последний шаг курса."
  );

  sections.push(
    "",
    "## Novice phase 2: required final report format",
    "",
    "Этот формат использует только novice-reviewer после полного прохода. Consistency-reviewer пропускает его и получает собственный формат в `02-consistency.md`.",
    "",
    `# Novice content review: ${target.scope} ${target.id}`,
    "",
    "Verdict: PASS|NEEDS_REWRITE",
    "",
    "## Opening reconstruction",
    "",
    "Сохранённый вывод first-contact: стартовая ситуация, затруднение, ведущий вопрос и initial state → event/action → observation. Поздний текст не переписывает этот вывод.",
    "",
    "## Reference audit",
    "",
    "Результат sealed first-contact для указательных ссылок и antecedents.",
    "",
    "## Identifier and API audit",
    "",
    "Результат sealed first-contact для центральных identifier/API и мест их введения.",
    "",
    "## Learner walkthrough",
    "",
    "Что учащийся последовательно понимает от opening до DONE; где причинная цепочка или терминология требует догадки.",
    "",
    "## Explanation and examples",
    "",
    "Достаточность кода, исходных значений, действий, наблюдений, границ аналогий и связи каждого примера с объясняемой моделью.",
    "",
    "## Task, evidence and DONE",
    "",
    "Можно ли выполнить задание и доказать DONE только по learner-facing материалу, не открывая rubric, tests, hints или следующую карточку.",
    "",
    "## Continuity",
    "",
    "Связь с доступным предыдущим результатом, заявленными prerequisites и следующим learner-visible contract без скрытого авторского контекста.",
    "",
    "## Findings",
    "",
    "Каждый finding: severity BLOCKER|MAJOR|MINOR, точная цитата, learner effect и требуемый тип исправления. Не дописывайте материал за автора.",
    "",
    "## Verdict rationale",
    "",
    "PASS допустим только без открытых BLOCKER и MAJOR во first-contact и полном learner walkthrough."
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
    "Открывайте этот packet только после письменно зафиксированного learner reconstruction по `01-blind.md`. Теперь сопоставьте собственное понимание с manifest, profiles, rubric, acceptance tests и соседними карточками.",
    "Вы не должны получать или искать novice report: novice и consistency verdict дают два независимых fresh agents.",
    "Проверьте prerequisites, причинные переходы, соответствие README/rubric/checks/evidence, реалистичность 30–60 минут и естественный handoff к следующей теме. Для каждого prerequisite используйте provenance-карту и приложенный learner source: соседняя карточка не обязана быть местом его первоначального введения.",
    "Проверьте первое впечатление и язык: cold open без контекста у первого материала курса или главы, термины до понятного якоря, резкие переходы и машинную спецификационную прозу. Такой cold open или системно нечитаемый язык — MAJOR; отдельная тяжёлая фраза, не мешающая модели, — MINOR.",
    "Проверьте openings курса, module и session по собственному blind reconstruction. Не засчитывайте хороший верхнеуровневый README или позднее объяснение как исправление холодного начала карточки.",
    "Каждое языковое замечание обязано привести точную цитату, описать эффект для учащегося и назвать тип исправления, не переписывая материал за автора.",
    "Для измерений и лабораторных работ убедитесь, что воспроизводимость, источник данных, допустимая область воздействия, stop conditions и cleanup/rollback описаны, а ожидаемое не выдано за фактически измеренное.",
    "Reviewer остаётся read-only и возвращает отчёт, а не переписывает учебный материал.",
    "",
    "## Full course context",
    "",
    renderCourseContext(target),
    "",
    "## Prerequisite provenance",
    "",
    await renderPrerequisiteProvenance(root, target),
    "",
    "## Active profile contracts",
    "",
    await renderProfileContext(root, target),
    "",
    "## Canonical course context",
    "",
    await renderCourseContextDocuments(root, target),
    "",
    "## Learner-facing language contract",
    "",
    (await readLearnerFacingLanguage(root)).source.trimEnd(),
    "",
    "## Course overview",
    "",
    await renderCourseOverview(root, target),
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
    "## Continuity and profiles",
    "",
    "Связь prerequisites → текущая идея → следующий шаг.",
    "",
    "## Evidence and safety",
    "",
    "Достаточность и воспроизводимость evidence; корректность статусов fact/assumption/expected/observed/inference; для практики — preflight, scope, stop conditions и cleanup/rollback.",
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

interface PrerequisiteProvenance {
  concept: string;
  requiredBy: FlatSession;
  assumed: boolean;
  source: FlatSession | null;
}

function collectPrerequisiteProvenance(
  target: ReviewTarget
): PrerequisiteProvenance[] {
  const assumedConcepts = new Set(target.manifest.assumedConcepts);
  const provenance: PrerequisiteProvenance[] = [];

  for (const requiredBy of target.targetSessions) {
    for (const concept of requiredBy.definition.requires) {
      const assumed = assumedConcepts.has(concept);
      let source: FlatSession | null = null;
      if (!assumed) {
        for (const candidate of target.sessions) {
          if (candidate.index >= requiredBy.index) {
            break;
          }
          if (candidate.definition.introduces.includes(concept)) {
            source = candidate;
          }
        }
      }
      provenance.push({ concept, requiredBy, assumed, source });
    }
  }

  return provenance;
}

function collectPrerequisiteSourceSessions(target: ReviewTarget): FlatSession[] {
  return uniqueSessions(
    collectPrerequisiteProvenance(target).map((entry) => entry.source)
  );
}

async function renderPrerequisiteProvenance(
  root: string,
  target: ReviewTarget
): Promise<string> {
  const provenance = collectPrerequisiteProvenance(target);
  if (provenance.length === 0) {
    return "У target нет объявленных prerequisites.";
  }

  const lines = [
    "Не выводите происхождение prerequisite только из immediate previous card. Ниже для каждого required concept указан course baseline либо более ранняя published session, а затем приложен полный learner-facing README каждой source session."
  ];

  for (const requiredBy of target.targetSessions) {
    const entries = provenance.filter(
      (entry) => entry.requiredBy.definition.id === requiredBy.definition.id
    );
    lines.push("", `### Required by ${requiredBy.definition.id}`);
    for (const entry of entries) {
      if (entry.assumed) {
        lines.push(
          `- \`${entry.concept}\`: declared in course assumedConcepts.`
        );
      } else if (entry.source) {
        lines.push(
          `- \`${entry.concept}\`: introduced by published session ${entry.source.definition.id} before ${requiredBy.definition.id}; learner source is included below.`
        );
      } else {
        lines.push(
          `- \`${entry.concept}\`: MISSING — neither assumed nor introduced by an earlier published session.`
        );
      }
    }
  }

  const sourceSessions = collectPrerequisiteSourceSessions(target);
  if (sourceSessions.length === 0) {
    return lines.join("\n");
  }

  lines.push("", "### Learner sources for introduced prerequisites");
  for (const session of sourceSessions) {
    const absolutePath = path.join(getSessionDirectory(root, session), "README.md");
    lines.push(
      "",
      `#### Source session ${session.definition.id}: ${session.definition.title}`,
      "",
      `Introduces: ${formatConcepts(session.definition.introduces)}`,
      `File: ${path.relative(root, absolutePath)}`,
      "",
      "~~~~",
      (await readFile(absolutePath, "utf8")).trimEnd(),
      "~~~~"
    );
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

function renderLearnerVisibleSessionSummary(session: FlatSession): string {
  const definition = session.definition;
  return [
    `${definition.id}: ${definition.title}`,
    `outcome=${definition.outcome}`,
    `done=${definition.done}`
  ].join("; ");
}

function renderLearnerVisibleRoadmapSummary(
  session: FlatRoadmapSession
): string {
  const definition = session.definition;
  return [
    `${definition.id}: ${definition.title}`,
    `releaseStatus=${definition.releaseStatus ?? "published"}`,
    `outcome=${definition.outcome}`
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
  const candidates = (await listRegularFiles(directory)).sort((left, right) => {
    const leftRelative = toPortablePath(path.relative(directory, left));
    const rightRelative = toPortablePath(path.relative(directory, right));
    const leftRank = leftRelative === "README.md" ? 0 : 1;
    const rightRank = rightRelative === "README.md" ? 0 : 1;
    return leftRank - rightRank || leftRelative.localeCompare(rightRelative);
  });
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
    isHiddenAuthorSupportFile(relativePath) ||
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
    return { schemaVersion: 2, records: {} };
  }
  const value = JSON.parse(await readFile(statePath, "utf8")) as unknown;
  if (isRecord(value) && value.schemaVersion === 1) {
    return { schemaVersion: 2, records: {} };
  }
  if (!isRecord(value) || value.schemaVersion !== 2 || !isRecord(value.records)) {
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

function validateReport(
  stage: ContentReviewStage,
  report: string,
  verdict: ContentReviewVerdict
): void {
  const verdictMatch = report.match(/^Verdict:\s*(PASS|NEEDS_REWRITE)\s*$/m);
  if (!verdictMatch) {
    throw new Error("Report должен содержать строку Verdict: PASS|NEEDS_REWRITE.");
  }
  if (verdictMatch[1] !== verdict) {
    throw new Error(
      `Verdict команды ${verdict} не совпадает с report ${verdictMatch[1]}.`
    );
  }
  const headings =
    stage === "novice"
      ? [
          "## Opening reconstruction",
          "## Reference audit",
          "## Identifier and API audit",
          "## Learner walkthrough",
          "## Explanation and examples",
          "## Task, evidence and DONE",
          "## Continuity",
          "## Findings",
          "## Verdict rationale"
        ]
      : [
          "## Learner reconstruction",
          "## Continuity and profiles",
          "## Evidence and safety",
          "## Findings",
          "## Verdict rationale"
        ];
  for (const heading of headings) {
    if (!report.split(/\r?\n/).includes(heading)) {
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
