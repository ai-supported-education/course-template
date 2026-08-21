import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CHECK_LABELS,
  SESSION_KINDS,
  type CourseManifest,
  type FlatSession,
  type SessionDefinition
} from "./types.js";

const sessionKindSet = new Set<string>(SESSION_KINDS);
const checkLabelSet = new Set<string>(CHECK_LABELS);

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
  }
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
