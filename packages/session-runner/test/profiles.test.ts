import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCourseProfileDocuments } from "../src/profiles.js";

describe("course profiles", () => {
  it("requires one unambiguous document for every selected id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "course-profiles-"));
    await expect(loadCourseProfileDocuments(root, ["lab"])).rejects.toThrow(
      "нужен docs/course-profiles/lab.md"
    );

    await mkdir(path.join(root, "docs/course-profiles"), { recursive: true });
    await writeFile(path.join(root, "docs/course-profiles/lab.md"), "# Lab\n");
    const [profile] = await loadCourseProfileDocuments(root, ["lab"]);
    expect(profile?.source).toContain("# Lab");

    await mkdir(path.join(root, "docs/stack-profiles"), { recursive: true });
    await writeFile(path.join(root, "docs/stack-profiles/lab.md"), "# Other\n");
    await expect(loadCourseProfileDocuments(root, ["lab"])).rejects.toThrow(
      "одновременно"
    );
  });
});
