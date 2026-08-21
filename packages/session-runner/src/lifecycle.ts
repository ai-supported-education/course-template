import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { hashDirectory } from "./content-hash.js";
import { getSession } from "./manifest.js";
import { loadProgress, saveCheckpoint, saveProgress } from "./progress.js";
import type {
  CheckRun,
  FlatSession,
  ProgressState,
  ReviewVerdict
} from "./types.js";
import { getSessionDirectory } from "./workspace.js";

export function getNextSession(
  sessions: FlatSession[],
  progress: ProgressState
): FlatSession | null {
  if (progress.activeSessionId) {
    return getSession(sessions, progress.activeSessionId);
  }

  const completed = new Set(progress.completedSessionIds);
  return sessions.find((session) => !completed.has(session.definition.id)) ?? null;
}

export async function startSession(
  root: string,
  sessions: FlatSession[],
  id: string,
  now = new Date()
): Promise<{ session: FlatSession; progress: ProgressState }> {
  const session = getSession(sessions, id);
  const progress = await loadProgress(root);

  if (progress.completedSessionIds.includes(id)) {
    throw new Error(`Сессия ${id} уже завершена.`);
  }
  if (progress.activeSessionId && progress.activeSessionId !== id) {
    throw new Error(
      `Сначала завершите активную сессию ${progress.activeSessionId}. Вторая сессия не была открыта.`
    );
  }

  const missingPrerequisite = sessions
    .slice(0, session.index)
    .find((candidate) => !progress.completedSessionIds.includes(candidate.definition.id));
  if (missingPrerequisite) {
    throw new Error(
      `Сессия ${id} пока недоступна. Следующий обязательный шаг: ${missingPrerequisite.definition.id}.`
    );
  }

  const sessionDirectory = getSessionDirectory(root, session);
  await assertMaterialAvailable(sessionDirectory, id);

  if (progress.activeSessionId === id) {
    return { session, progress };
  }

  const nextProgress: ProgressState = {
    ...progress,
    activeSessionId: id,
    startedAt: now.toISOString(),
    lastCheck: null,
    lastReview: null,
    revealedHintLevel: 0
  };
  await saveProgress(root, nextProgress);
  return { session, progress: nextProgress };
}

export async function recordCheck(
  root: string,
  run: CheckRun
): Promise<ProgressState> {
  const progress = await loadProgress(root);
  if (progress.activeSessionId !== run.sessionId) {
    throw new Error(`Check относится не к активной сессии ${progress.activeSessionId ?? "none"}.`);
  }

  const nextProgress: ProgressState = {
    ...progress,
    lastCheck: run,
    lastReview:
      progress.lastReview?.contentHash === run.contentHash ? progress.lastReview : null
  };
  await saveProgress(root, nextProgress);
  return nextProgress;
}

export async function recordReview(
  root: string,
  sessions: FlatSession[],
  verdict: ReviewVerdict,
  now = new Date()
): Promise<ProgressState> {
  const progress = await loadProgress(root);
  if (!progress.activeSessionId) {
    throw new Error("Нет активной сессии.");
  }
  if (!progress.lastCheck?.passed) {
    throw new Error("Перед review требуется зелёный session:check.");
  }

  const session = getSession(sessions, progress.activeSessionId);
  const contentHash = await hashDirectory(getSessionDirectory(root, session));
  if (contentHash !== progress.lastCheck.contentHash) {
    throw new Error("Файлы изменились после check. Повторите session:check.");
  }

  const nextProgress: ProgressState = {
    ...progress,
    lastReview: {
      sessionId: session.definition.id,
      reviewedAt: now.toISOString(),
      contentHash,
      verdict
    }
  };
  await saveProgress(root, nextProgress);
  return nextProgress;
}

export async function finishSession(
  root: string,
  sessions: FlatSession[],
  now = new Date()
): Promise<{ finished: FlatSession; next: FlatSession | null; progress: ProgressState }> {
  const progress = await loadProgress(root);
  if (!progress.activeSessionId) {
    throw new Error("Нет активной сессии.");
  }

  const session = getSession(sessions, progress.activeSessionId);
  if (!progress.lastCheck?.passed || progress.lastCheck.sessionId !== session.definition.id) {
    throw new Error("Для завершения требуется зелёный session:check.");
  }

  const contentHash = await hashDirectory(getSessionDirectory(root, session));
  if (contentHash !== progress.lastCheck.contentHash) {
    throw new Error("Файлы изменились после check. Повторите session:check.");
  }

  if (session.definition.checks.includes("review")) {
    if (
      progress.lastReview?.sessionId !== session.definition.id ||
      progress.lastReview.verdict !== "PASS" ||
      progress.lastReview.contentHash !== contentHash
    ) {
      throw new Error("Для завершения требуется актуальный PASS от session:review.");
    }
  }

  const completedSessionIds = [
    ...new Set([...progress.completedSessionIds, session.definition.id])
  ];
  const nextProgress: ProgressState = {
    ...progress,
    activeSessionId: null,
    completedSessionIds,
    startedAt: null,
    lastCheck: null,
    lastReview: null,
    revealedHintLevel: 0
  };

  await saveProgress(root, nextProgress);
  await saveCheckpoint(root, {
    schemaVersion: 1,
    sessionId: session.definition.id,
    finishedAt: now.toISOString(),
    contentHash
  });

  return {
    finished: session,
    next: getNextSession(sessions, nextProgress),
    progress: nextProgress
  };
}

export async function assertMaterialAvailable(
  sessionDirectory: string,
  id: string
): Promise<void> {
  try {
    await access(path.join(sessionDirectory, "README.md"), constants.R_OK);
  } catch {
    throw new Error(
      `Материалы ${id} ещё не реализованы: отсутствует ${path.join(sessionDirectory, "README.md")}.`
    );
  }
}

export async function readMaterialFile(
  sessionDirectory: string,
  name: string
): Promise<string> {
  try {
    return await readFile(path.join(sessionDirectory, name), "utf8");
  } catch {
    return "";
  }
}
