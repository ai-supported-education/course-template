import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashDirectory } from "../src/content-hash.js";
import {
  finishSession,
  getNextSession,
  recordCheck,
  recordReview,
  startSession
} from "../src/lifecycle.js";
import { loadProgress } from "../src/progress.js";
import type {
  CheckRun,
  CourseModule,
  FlatSession,
  SessionDefinition
} from "../src/types.js";
import { getSessionDirectory } from "../src/workspace.js";

const moduleDefinition: CourseModule = {
  id: "01",
  slug: "test",
  title: "Test",
  goal: "Test lifecycle",
  sessions: []
};

const firstDefinition = createDefinition("01-01", ["unit"]);
const secondDefinition = createDefinition("01-02", ["unit", "review"]);
const sessions: FlatSession[] = [
  {
    index: 0,
    definition: firstDefinition,
    module: moduleDefinition,
    isCapstone: false
  },
  {
    index: 1,
    definition: secondDefinition,
    module: moduleDefinition,
    isCapstone: false
  }
];

describe("session lifecycle", () => {
  it("enforces one active session, order, checks and review", async () => {
    const root = await createWorkspace();

    expect(getNextSession(sessions, await loadProgress(root))?.definition.id).toBe("01-01");
    await expect(startSession(root, sessions, "01-02")).rejects.toThrow("01-01");

    await startSession(root, sessions, "01-01");
    await expect(startSession(root, sessions, "01-01")).resolves.toBeDefined();
    await expect(startSession(root, sessions, "01-02")).rejects.toThrow("активную");
    await expect(finishSession(root, sessions)).rejects.toThrow("session:check");

    await recordCheck(root, await createPassingRun(root, sessions[0]!));
    const firstFinish = await finishSession(root, sessions);
    expect(firstFinish.next?.definition.id).toBe("01-02");

    await startSession(root, sessions, "01-02");
    await recordCheck(root, await createPassingRun(root, sessions[1]!));
    await expect(finishSession(root, sessions)).rejects.toThrow("session:review");

    await recordReview(root, sessions, "PASS");
    const secondFinish = await finishSession(root, sessions);
    expect(secondFinish.next).toBeNull();
    expect(secondFinish.progress.completedSessionIds).toEqual(["01-01", "01-02"]);
  });

  it("invalidates a check after session files change", async () => {
    const root = await createWorkspace();
    await startSession(root, sessions, "01-01");
    await recordCheck(root, await createPassingRun(root, sessions[0]!));

    const directory = getSessionDirectory(root, sessions[0]!);
    await writeFile(path.join(directory, "answer.ts"), "export const answer = 2;\n");

    await expect(finishSession(root, sessions)).rejects.toThrow("изменились");
  });
});

function createDefinition(
  id: string,
  checks: SessionDefinition["checks"]
): SessionDefinition {
  return {
    id,
    title: id,
    minutes: 30,
    kind: "build",
    outcome: "Outcome",
    done: "Done",
    checks,
    evidence: {
      produces: [`artifact-${id}`],
      verifiedBy: checks.includes("review")
        ? ["automated", "agent"]
        : ["automated"]
    },
    requires: [],
    introduces: [`concept-${id}`],
    defers: []
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "react-training-lifecycle-"));
  for (const session of sessions) {
    const directory = getSessionDirectory(root, session);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "README.md"), `# ${session.definition.id}\n`);
    await writeFile(path.join(directory, "answer.ts"), "export const answer = 1;\n");
  }
  return root;
}

async function createPassingRun(
  root: string,
  session: FlatSession
): Promise<CheckRun> {
  return {
    sessionId: session.definition.id,
    checkedAt: "2026-08-18T00:00:00.000Z",
    contentHash: await hashDirectory(getSessionDirectory(root, session)),
    passed: true,
    results: [
      {
        label: "unit",
        status: "passed",
        exitCode: 0,
        output: "ok"
      }
    ]
  };
}
