import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadCourseContextDocuments,
  validateCourseContextPaths
} from "../src/course-context.js";

describe("course context files", () => {
  it("loads explicitly selected safe text documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "course-context-"));
    await mkdir(path.join(root, "curriculum"), { recursive: true });
    await writeFile(
      path.join(root, "curriculum/audience.md"),
      "# Audience\nPracticing developer.\n"
    );

    const documents = await loadCourseContextDocuments(root, [
      "curriculum/audience.md"
    ]);

    expect(documents).toEqual([
      {
        path: "curriculum/audience.md",
        source: "# Audience\nPracticing developer.\n"
      }
    ]);
  });

  it("rejects traversal, support material, binaries and duplicates", () => {
    const problems = validateCourseContextPaths([
      "../audience.md",
      "support/hints.md",
      "docs/solution.md",
      "docs/answer-key/audience.md",
      "docs/capture.pcap",
      "docs/keyboard-navigation.md",
      "docs/monkey.md",
      "curriculum/audience.md",
      "curriculum/audience.md"
    ]);

    expect(problems).toHaveLength(6);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("../audience.md"),
        expect.stringContaining("support/hints.md"),
        expect.stringContaining("docs/solution.md"),
        expect.stringContaining("docs/answer-key/audience.md"),
        expect.stringContaining("docs/capture.pcap"),
        expect.stringContaining("повторяющийся путь")
      ])
    );
  });

  it("rejects a symlink even when its declared path looks safe", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "course-context-"));
    await mkdir(path.join(root, "docs"), { recursive: true });
    const outside = path.join(root, "outside.md");
    await writeFile(outside, "# Outside\n");
    await symlink(outside, path.join(root, "docs/audience.md"));

    await expect(
      loadCourseContextDocuments(root, ["docs/audience.md"])
    ).rejects.toThrow("symlink запрещён");
  });

  it("fails when a selected document does not exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "course-context-"));
    await expect(
      loadCourseContextDocuments(root, ["curriculum/audience.md"])
    ).rejects.toThrow("Не удалось прочитать course context");
  });
});
