import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEmptyProgress,
  getProgressPath,
  loadProgress,
  saveProgress
} from "../src/progress.js";

describe("progress storage", () => {
  it("returns an empty state before the first session", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "react-training-progress-"));
    await expect(loadProgress(root)).resolves.toEqual(createEmptyProgress());
  });

  it("writes progress atomically and keeps a backup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "react-training-progress-"));
    const first = {
      ...createEmptyProgress(),
      activeSessionId: "01-01",
      startedAt: "2026-08-18T00:00:00.000Z"
    };
    await saveProgress(root, first);

    const second = {
      ...first,
      completedSessionIds: ["01-01"],
      activeSessionId: null,
      startedAt: null
    };
    await saveProgress(root, second);

    await expect(loadProgress(root)).resolves.toEqual(second);
    const backup = JSON.parse(
      await readFile(path.join(root, ".training", "progress.backup.json"), "utf8")
    );
    expect(backup).toEqual(first);
  });

  it("does not overwrite corrupted progress", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "react-training-progress-"));
    await saveProgress(root, createEmptyProgress());
    await writeFile(getProgressPath(root), "{broken", "utf8");

    await expect(loadProgress(root)).rejects.toThrow("Повреждён");
    await expect(readFile(getProgressPath(root), "utf8")).resolves.toBe("{broken");
  });

  it("migrates progress created before progressive hints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "react-training-progress-"));
    const legacy = createEmptyProgress() as unknown as Record<string, unknown>;
    delete legacy.revealedHintLevel;
    await saveProgress(root, createEmptyProgress());
    await writeFile(getProgressPath(root), JSON.stringify(legacy), "utf8");

    await expect(loadProgress(root)).resolves.toMatchObject({
      revealedHintLevel: 0
    });
  });
});
