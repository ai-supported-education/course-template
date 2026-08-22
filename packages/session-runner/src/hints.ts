import { getSession } from "./manifest.js";
import { loadProgressForSessions, saveProgress } from "./progress.js";
import { readSupportFile, type SupportLoader } from "./support.js";
import type { FlatSession, ProgressState } from "./types.js";

interface HintLevel {
  title: string;
  body: string;
}

interface HintDocument {
  levels: HintLevel[];
}

export async function revealNextHint(
  root: string,
  sessions: FlatSession[],
  loader: SupportLoader = readSupportFile
): Promise<{ level: number; hint: HintLevel; progress: ProgressState }> {
  const progress = await loadProgressForSessions(root, sessions);
  if (!progress.activeSessionId) {
    throw new Error("Нет активной сессии.");
  }

  const session = getSession(sessions, progress.activeSessionId);
  const document = JSON.parse(
    await loader(root, `hints/${session.definition.id}.json`)
  ) as HintDocument;
  const nextLevel = progress.revealedHintLevel + 1;
  const hint = document.levels[nextLevel - 1];

  if (!hint) {
    throw new Error("Все доступные уровни подсказок уже раскрыты.");
  }
  if (!hint.title?.trim() || !hint.body?.trim()) {
    throw new Error(`Support hint level ${nextLevel} имеет некорректный формат.`);
  }

  const nextProgress: ProgressState = {
    ...progress,
    revealedHintLevel: nextLevel
  };
  await saveProgress(root, nextProgress);
  return { level: nextLevel, hint, progress: nextProgress };
}
