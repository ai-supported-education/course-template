import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runAuthorProof,
  verifyAuthorProofEvidence
} from "../src/author-proof.js";
import { flattenManifest, loadManifest } from "../src/manifest.js";

const templateRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

describe("author proof", () => {
  it("proves red, green and rejected counterexample with the same acceptance test", async () => {
    const root = await createWorkspace();
    const patches: Record<string, string> = {
      "solutions/01-01.patch": patch("false", "true"),
      "counterexamples/01-01-null.patch": patch("false", "null")
    };
    const loader = async (_root: string, relativePath: string) => {
      const source = patches[relativePath];
      if (!source) throw new Error(`missing ${relativePath}`);
      return source;
    };
    const result = await runAuthorProof(root, "01-01", loader);
    expect(result.value).toMatchObject({
      schemaVersion: 1,
      sessionId: "01-01",
      starter: { status: "EXPECTED_FAILURE" },
      solution: { status: "PASS" },
      counterexamples: [{ status: "EXPECTED_FAILURE" }]
    });
    const session = flattenManifest(await loadManifest(root))[0]!;
    await expect(verifyAuthorProofEvidence(root, session, loader)).resolves.toEqual([]);
    await writeFile(path.join(root, "package.json"), '{"type":"module","changed":true}\n');
    await expect(verifyAuthorProofEvidence(root, session, loader)).resolves.toContain(
      "01-01: proof устарел после изменения toolchain"
    );
  }, 20_000);
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "author-proof-test-"));
  const session = path.join(root, "modules/01-sample/sessions/01-01");
  await mkdir(path.join(root, "curriculum"), { recursive: true });
  await mkdir(session, { recursive: true });
  await symlink(path.join(templateRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  await writeFile(path.join(root, "README.md"), "# Course\n");
  await writeFile(path.join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(path.join(session, "README.md"), "# Session\n");
  await writeFile(path.join(session, "rubric.md"), "# Rubric\n");
  await writeFile(path.join(session, "exercise.js"), "export const answer = false;\n");
  await writeFile(
    path.join(session, "exercise.test.js"),
    [
      'import { describe, expect, it } from "vitest";',
      'import { answer } from "./exercise.js";',
      'describe("acceptance", () => {',
      '  it("returns observable answer", () => {',
      "    expect(answer).toBe(true);",
      "  });",
      "});",
      ""
    ].join("\n")
  );
  await writeFile(
    path.join(root, "curriculum/course.json"),
    JSON.stringify({
      version: 1,
      reviewProtocol: "roadmap-subject-novice-consistency-v1",
      language: "ru",
      audience: "Developer",
      profiles: [],
      courseContextFiles: [],
      toolchainFiles: ["package.json"],
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
          kind: "complete",
          outcome: "Return true",
          done: "Test passes",
          checks: ["unit"],
          checkTargets: { unit: "exercise.test.js" },
          authorProof: {
            check: "unit",
            expectedStarterFailure: "returns observable answer",
            solutionPatch: "solutions/01-01.patch",
            counterexamplePatches: ["counterexamples/01-01-null.patch"]
          },
          evidence: { produces: ["exercise.js"], verifiedBy: ["automated"] },
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

function patch(from: string, to: string): string {
  const file = "modules/01-sample/sessions/01-01/exercise.js";
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1 +1 @@",
    `-export const answer = ${from};`,
    `+export const answer = ${to};`,
    ""
  ].join("\n");
}
