import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CHECK_LABELS,
  SESSION_KINDS,
  VERIFICATION_MODES,
  type CourseManifest,
  type FlatSession,
  type SessionDefinition
} from "./types.js";
import { loadCourseProfileDocuments } from "./profiles.js";

const sessionKindSet = new Set<string>(SESSION_KINDS);
const checkLabelSet = new Set<string>(CHECK_LABELS);
const verificationModeSet = new Set<string>(VERIFICATION_MODES);

export async function loadManifest(root: string): Promise<CourseManifest> {
  const manifestPath = path.join(root, "curriculum", "course.json");
  let source: string;

  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`Не удалось прочитать ${manifestPath}: ${formatError(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Некорректный JSON в ${manifestPath}: ${formatError(error)}`);
  }

  const problems = validateManifest(value);
  if (problems.length > 0) {
    throw new Error(`Manifest не прошёл проверку:\n- ${problems.join("\n- ")}`);
  }

  await loadCourseProfileDocuments(root, (value as CourseManifest).profiles);

  return value as CourseManifest;
}

export function validateManifest(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) {
    return ["корневое значение должно быть объектом"];
  }

  if (!Array.isArray(value.modules) || value.modules.length === 0) {
    problems.push("modules должен быть непустым массивом");
  }
  if (!isRecord(value.capstone) || !Array.isArray(value.capstone.sessions)) {
    problems.push("capstone.sessions должен быть массивом");
  }
  if (!isRecord(value.sessionPolicy)) {
    problems.push("sessionPolicy должен быть объектом");
  }
  if (!Array.isArray(value.assumedConcepts)) {
    problems.push("assumedConcepts должен быть массивом concept ids");
  }
  if (!Array.isArray(value.profiles)) {
    problems.push("profiles должен быть массивом profile ids");
  }

  if (problems.length > 0) {
    return problems;
  }

  const policy = value.sessionPolicy as Record<string, unknown>;
  const minMinutes = policy.minMinutes;
  const maxMinutes = policy.maxMinutes;
  if (typeof minMinutes !== "number" || typeof maxMinutes !== "number") {
    problems.push("sessionPolicy minMinutes/maxMinutes должны быть числами");
  }

  const ids = new Set<string>();
  const moduleIds = new Set<string>();
  const modules = value.modules as unknown[];

  for (const [moduleIndex, rawModule] of modules.entries()) {
    if (!isRecord(rawModule)) {
      problems.push(`modules[${moduleIndex}] должен быть объектом`);
      continue;
    }

    const moduleId = rawModule.id;
    if (typeof moduleId !== "string" || moduleId.length === 0) {
      problems.push(`modules[${moduleIndex}].id должен быть непустой строкой`);
    } else if (moduleIds.has(moduleId)) {
      problems.push(`дублирующийся module id ${moduleId}`);
    } else {
      moduleIds.add(moduleId);
    }

    if (typeof rawModule.slug !== "string" || rawModule.slug.length === 0) {
      problems.push(`module ${String(moduleId)} не содержит slug`);
    }
    if (!Array.isArray(rawModule.sessions) || rawModule.sessions.length === 0) {
      problems.push(`module ${String(moduleId)} не содержит sessions`);
      continue;
    }

    validateSessions(
      rawModule.sessions,
      `module ${String(moduleId)}`,
      ids,
      typeof minMinutes === "number" ? minMinutes : 30,
      typeof maxMinutes === "number" ? maxMinutes : 60,
      problems
    );
  }

  const capstone = value.capstone as Record<string, unknown>;
  if (Array.isArray(capstone.sessions)) {
    validateSessions(
      capstone.sessions,
      "capstone",
      ids,
      typeof minMinutes === "number" ? minMinutes : 30,
      typeof maxMinutes === "number" ? maxMinutes : 60,
      problems
    );
  }

  validateConceptFlow(value, problems);
  validateProfiles(value, problems);

  return problems;
}

function validateSessions(
  sessions: unknown[],
  location: string,
  ids: Set<string>,
  minMinutes: number,
  maxMinutes: number,
  problems: string[]
): void {
  for (const [index, rawSession] of sessions.entries()) {
    if (!isRecord(rawSession)) {
      problems.push(`${location}.sessions[${index}] должен быть объектом`);
      continue;
    }

    const session = rawSession as Partial<SessionDefinition>;
    const id = session.id;
    if (typeof id !== "string" || id.length === 0) {
      problems.push(`${location}.sessions[${index}].id должен быть непустой строкой`);
      continue;
    }
    if (ids.has(id)) {
      problems.push(`дублирующийся session id ${id}`);
    }
    ids.add(id);

    if (typeof session.title !== "string" || session.title.length === 0) {
      problems.push(`${id}: title обязателен`);
    }
    if (
      typeof session.minutes !== "number" ||
      session.minutes < minMinutes ||
      session.minutes > maxMinutes
    ) {
      problems.push(`${id}: minutes должен быть от ${minMinutes} до ${maxMinutes}`);
    }
    if (typeof session.kind !== "string" || !sessionKindSet.has(session.kind)) {
      problems.push(`${id}: неизвестный kind ${String(session.kind)}`);
    }
    if (typeof session.outcome !== "string" || session.outcome.length === 0) {
      problems.push(`${id}: outcome обязателен`);
    }
    if (typeof session.done !== "string" || session.done.length === 0) {
      problems.push(`${id}: done обязателен`);
    }
    if (!Array.isArray(session.checks) || session.checks.length === 0) {
      problems.push(`${id}: checks должен быть непустым массивом`);
    } else {
      for (const label of session.checks) {
        if (typeof label !== "string" || !checkLabelSet.has(label)) {
          problems.push(`${id}: неизвестный check ${String(label)}`);
        }
      }
    }
    validateEvidence(rawSession, id, problems);
    validateContentReviewSelection(rawSession, id, problems);
    validateConceptArray(rawSession, id, "requires", problems);
    validateConceptArray(rawSession, id, "introduces", problems);
    validateConceptArray(rawSession, id, "defers", problems);
  }
}

function validateProfiles(
  manifest: Record<string, unknown>,
  problems: string[]
): void {
  const profiles = readStringIdArray(manifest.profiles);
  if (!profiles) {
    return;
  }
  if (new Set(profiles).size !== profiles.length) {
    problems.push("profiles содержит повторяющиеся profile ids");
  }
  for (const profile of profiles) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile)) {
      problems.push(`некорректный profile id ${profile}`);
    }
  }
}

function validateEvidence(
  session: Record<string, unknown>,
  id: string,
  problems: string[]
): void {
  if (!isRecord(session.evidence)) {
    problems.push(`${id}: evidence должен быть объектом`);
    return;
  }

  const produces = readStringIdArray(session.evidence.produces);
  const verifiedBy = readStringIdArray(session.evidence.verifiedBy);
  if (!produces || produces.length === 0) {
    problems.push(`${id}: evidence.produces должен быть непустым массивом`);
  } else if (new Set(produces).size !== produces.length) {
    problems.push(`${id}: evidence.produces содержит повторы`);
  }

  if (!verifiedBy || verifiedBy.length === 0) {
    problems.push(`${id}: evidence.verifiedBy должен быть непустым массивом`);
    return;
  }
  if (new Set(verifiedBy).size !== verifiedBy.length) {
    problems.push(`${id}: evidence.verifiedBy содержит повторы`);
  }
  for (const mode of verifiedBy) {
    if (!verificationModeSet.has(mode)) {
      problems.push(`${id}: неизвестный verification mode ${mode}`);
    }
  }

  const checks = Array.isArray(session.checks)
    ? session.checks.filter((label): label is string => typeof label === "string")
    : [];
  if (verifiedBy.includes("agent") && !checks.includes("review")) {
    problems.push(`${id}: agent verification требует check review`);
  }
  if (checks.includes("review") && !verifiedBy.includes("agent")) {
    problems.push(`${id}: check review должен быть отражён в evidence.verifiedBy`);
  }
  if (
    verifiedBy.includes("automated") &&
    !checks.some((label) => label !== "review")
  ) {
    problems.push(`${id}: automated verification требует автоматический check`);
  }
  if (
    checks.some((label) => label !== "review") &&
    !verifiedBy.includes("automated")
  ) {
    problems.push(`${id}: автоматический check должен быть отражён в evidence.verifiedBy`);
  }
}

function validateContentReviewSelection(
  session: Record<string, unknown>,
  id: string,
  problems: string[]
): void {
  if (session.contentReview === undefined) {
    return;
  }
  if (!isRecord(session.contentReview)) {
    problems.push(`${id}: contentReview должен быть объектом`);
    return;
  }

  const seen = new Map<string, string>();
  for (const role of ["learner", "consistency", "exclude"] as const) {
    const value = session.contentReview[role];
    if (value === undefined) {
      continue;
    }
    const files = readStringIdArray(value);
    if (!files) {
      problems.push(`${id}: contentReview.${role} должен быть массивом путей`);
      continue;
    }
    for (const file of files) {
      if (!isPortableRelativePath(file)) {
        problems.push(`${id}: contentReview.${role} содержит небезопасный путь ${file}`);
        continue;
      }
      if (path.posix.basename(file) === "answers.json" && role !== "exclude") {
        problems.push(`${id}: answers.json нельзя включать в content-review packet`);
      }
      if (role !== "exclude" && isSensitiveReviewPath(file)) {
        problems.push(`${id}: sensitive file ${file} нельзя включать в content-review packet`);
      }
      const previousRole = seen.get(file);
      if (previousRole) {
        problems.push(
          `${id}: ${file} одновременно указан в contentReview.${previousRole} и contentReview.${role}`
        );
      } else {
        seen.set(file, role);
      }
    }
  }
}

function isSensitiveReviewPath(value: string): boolean {
  const name = path.posix.basename(value).toLowerCase();
  const extension = path.posix.extname(name);
  return (
    name === ".env" ||
    (name.startsWith(".env.") && name !== ".env.example") ||
    name === ".npmrc" ||
    name === ".pypirc" ||
    name === "credentials.json" ||
    name === "id_ed25519" ||
    name === "id_rsa" ||
    name.startsWith("secrets.") ||
    [".jks", ".key", ".p12", ".pem", ".pfx"].includes(extension)
  );
}

function isPortableRelativePath(value: string): boolean {
  const segments = value.split("/");
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    )
  );
}

function validateConceptFlow(
  manifest: Record<string, unknown>,
  problems: string[]
): void {
  const assumed = readConceptArray(manifest.assumedConcepts);
  if (!assumed) {
    return;
  }

  const sessions = collectRawSessions(manifest);
  const firstIntroductionIndex = new Map<string, number>();
  for (const [index, session] of sessions.entries()) {
    for (const concept of readConceptArray(session.introduces) ?? []) {
      if (!firstIntroductionIndex.has(concept)) {
        firstIntroductionIndex.set(concept, index);
      }
    }
  }

  const available = new Set(assumed);
  for (const [sessionIndex, session] of sessions.entries()) {
    const id = typeof session.id === "string" ? session.id : "unknown";
    const requires = readConceptArray(session.requires) ?? [];
    const introduces = readConceptArray(session.introduces) ?? [];
    const defers = readConceptArray(session.defers) ?? [];

    for (const concept of requires) {
      if (!available.has(concept)) {
        problems.push(
          `${id}: requires содержит ${concept}, но concept не входит в assumedConcepts и не был введён раньше`
        );
      }
    }
    for (const concept of introduces) {
      if (available.has(concept)) {
        problems.push(`${id}: concept ${concept} уже был доступен до introduces`);
      }
    }
    for (const concept of defers) {
      const introductionIndex = firstIntroductionIndex.get(concept);
      if (introductionIndex === undefined) {
        problems.push(`${id}: defers содержит ${concept}, но concept не вводится в курсе`);
      } else if (introductionIndex <= sessionIndex) {
        problems.push(
          `${id}: defers содержит ${concept}, но concept вводится не позже этой сессии`
        );
      }
    }
    for (const concept of introduces) {
      available.add(concept);
    }
  }
}

function collectRawSessions(manifest: Record<string, unknown>): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  if (Array.isArray(manifest.modules)) {
    for (const module of manifest.modules) {
      if (!isRecord(module) || !Array.isArray(module.sessions)) {
        continue;
      }
      result.push(...module.sessions.filter(isRecord));
    }
  }
  if (isRecord(manifest.capstone) && Array.isArray(manifest.capstone.sessions)) {
    result.push(...manifest.capstone.sessions.filter(isRecord));
  }
  return result;
}

function validateConceptArray(
  session: Record<string, unknown>,
  id: string,
  field: "requires" | "introduces" | "defers",
  problems: string[]
): void {
  const concepts = readConceptArray(session[field]);
  if (!concepts) {
    problems.push(`${id}: ${field} должен быть массивом непустых concept ids`);
    return;
  }
  if (new Set(concepts).size !== concepts.length) {
    problems.push(`${id}: ${field} содержит повторяющиеся concept ids`);
  }
}

function readConceptArray(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    !value.every((concept) => typeof concept === "string" && concept.trim().length > 0)
  ) {
    return null;
  }
  return value;
}

function readStringIdArray(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    return null;
  }
  return value;
}

export function flattenManifest(manifest: CourseManifest): FlatSession[] {
  const sessions: FlatSession[] = [];

  for (const module of manifest.modules) {
    for (const definition of module.sessions) {
      sessions.push({
        index: sessions.length,
        definition,
        module,
        isCapstone: false
      });
    }
  }

  for (const definition of manifest.capstone.sessions) {
    sessions.push({
      index: sessions.length,
      definition,
      module: null,
      isCapstone: true
    });
  }

  return sessions;
}

export function getSession(sessions: FlatSession[], id: string): FlatSession {
  const session = sessions.find((item) => item.definition.id === id);
  if (!session) {
    throw new Error(`Неизвестная сессия: ${id}`);
  }
  return session;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
