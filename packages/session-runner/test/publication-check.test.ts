import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPublication } from "../src/publication-check.js";

describe("v3 publication check", () => {
  it("reports missing roadmap, session and module attestations", async () => {
    const root = await createWorkspace();
    const result = await checkPublication(root);
    expect(result.passed).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("curriculum/reviews/roadmap.json"),
        expect.stringContaining("curriculum/reviews/session-01-01.json"),
        expect.stringContaining("curriculum/reviews/module-01.json")
      ])
    );
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "publication-check-"));
  const module = path.join(root, "modules/01-sample");
  const session = path.join(module, "sessions/01-01");
  await mkdir(path.join(root, "curriculum"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(session, { recursive: true });
  const opening = "Вход в материал.\n\n<!-- content-review:opening:end -->\n";
  await writeFile(path.join(root, "README.md"), `# Course\n\n${opening}`);
  await writeFile(path.join(module, "README.md"), `# Module\n\n${opening}`);
  await writeFile(path.join(session, "README.md"), `# Session\n\n${opening}`);
  await writeFile(path.join(session, "rubric.md"), "# Rubric\n");
  await writeFile(path.join(root, "docs/learner-facing-language.md"), "# Language\n");
  await writeFile(
    path.join(root, "curriculum/course.json"),
    JSON.stringify({
      version: 1,
      reviewProtocol: "roadmap-subject-novice-consistency-v1",
      language: "ru",
      audience: "Developer",
      profiles: [],
      courseContextFiles: [],
      toolchainFiles: [],
      assumedConcepts: [],
      estimatedHours: { min: 1, max: 1 },
      sessionPolicy: {
        minMinutes: 30,
        maxMinutes: 60,
        singleActiveSession: true,
        dependencyMode: "linear-by-default",
        startState: "green",
        finishState: "green"
      },
      modules: [{
        id: "01",
        slug: "sample",
        title: "Sample",
        goal: "Goal",
        sessions: [{
          id: "01-01",
          title: "One",
          minutes: 30,
          kind: "observe",
          outcome: "Observe one",
          done: "Explain one",
          checks: ["review"],
          evidence: { produces: ["explanation"], verifiedBy: ["agent"] },
          requires: [],
          introduces: ["one"],
          defers: []
        }]
      }],
      capstone: { id: "capstone", title: "Capstone", goal: "Apply", sessions: [] }
    })
  );
  await writeFile(
    path.join(root, "curriculum/source-ledger.json"),
    JSON.stringify({
      schemaVersion: 1,
      sources: [{
        id: "standard",
        title: "Standard",
        url: "https://example.test/standard",
        kind: "standard",
        checkedAt: "2026-09-07",
        supports: ["one"]
      }]
    })
  );
  return root;
}
