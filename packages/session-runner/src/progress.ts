import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Checkpoint, ProgressState } from "./types.js";

export function createEmptyProgress(): ProgressState {
  return {
    schemaVersion: 1,
    activeSessionId: null,
    completedSessionIds: [],
    startedAt: null,
    lastCheck: null,
    lastReview: null,
    revealedHintLevel: 0
  };
}

export function getTrainingDirectory(root: string): string {
  return path.join(root, ".training");
}

export function getProgressPath(root: string): string {
  return path.join(getTrainingDirectory(root), "progress.json");
}

export async function loadProgress(root: string): Promise<ProgressState> {
  const progressPath = getProgressPath(root);
  if (!(await fileExists(progressPath))) {
    return createEmptyProgress();
  }

  let source: string;
  try {
    source = await readFile(progressPath, "utf8");
  } catch (error) {
    throw new Error(`Не удалось прочитать progress: ${formatError(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Повреждён ${progressPath}. Файл не изменён; проверьте progress.backup.json. ${formatError(error)}`
    );
  }

  if (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.revealedHintLevel === undefined
  ) {
    value.revealedHintLevel = 0;
  }

  if (!isProgressState(value)) {
    throw new Error(
      `Некорректная структура ${progressPath}. Файл не изменён; проверьте progress.backup.json.`
    );
  }

  return value;
}

export async function saveProgress(root: string, state: ProgressState): Promise<void> {
  const directory = getTrainingDirectory(root);
  const progressPath = getProgressPath(root);
  const backupPath = path.join(directory, "progress.backup.json");
  const temporaryPath = path.join(directory, `progress.tmp-${process.pid}-${Date.now()}.json`);

  await mkdir(directory, { recursive: true });

  if (await fileExists(progressPath)) {
    await copyFile(progressPath, backupPath);
  }

  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, progressPath);
}

export async function saveCheckpoint(
  root: string,
  checkpoint: Checkpoint
): Promise<void> {
  const checkpointDirectory = path.join(getTrainingDirectory(root), "checkpoints");
  await mkdir(checkpointDirectory, { recursive: true });
  const target = path.join(checkpointDirectory, `${checkpoint.sessionId}.json`);
  await writeFile(target, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isProgressState(value: unknown): value is ProgressState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schemaVersion === 1 &&
    (typeof value.activeSessionId === "string" || value.activeSessionId === null) &&
    Array.isArray(value.completedSessionIds) &&
    value.completedSessionIds.every((id) => typeof id === "string") &&
    (typeof value.startedAt === "string" || value.startedAt === null) &&
    (value.lastCheck === null || isRecord(value.lastCheck)) &&
    (value.lastReview === null || isRecord(value.lastReview)) &&
    typeof value.revealedHintLevel === "number" &&
    Number.isInteger(value.revealedHintLevel) &&
    value.revealedHintLevel >= 0 &&
    value.revealedHintLevel <= 3
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
