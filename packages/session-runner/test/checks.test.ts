import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCheckCommand, runSessionChecks } from "../src/checks.js";
import type { CourseModule, FlatSession } from "../src/types.js";
import { getSessionDirectory } from "../src/workspace.js";

const moduleDefinition: CourseModule = {
  id: "01",
  slug: "quiz",
  title: "Quiz",
  goal: "Quiz",
  sessions: []
};

const session: FlatSession = {
  index: 0,
  module: moduleDefinition,
  isCapstone: false,
  definition: {
    id: "01-01",
    title: "Quiz",
    minutes: 30,
    kind: "observe",
    outcome: "Outcome",
    done: "Done",
    checks: ["quiz", "review"],
    evidence: {
      produces: ["quiz answers and reasoning"],
      verifiedBy: ["automated", "agent"]
    },
    requires: [],
    introduces: ["quiz-reasoning"],
    defers: []
  }
};

describe("check registry", () => {
  it("requires both a correct quiz answer and its explanation", async () => {
    const root = await createQuizWorkspace();
    const directory = getSessionDirectory(root, session);
    const supportLoader = async () =>
      JSON.stringify({ answers: { q1: "A" } });

    const missingReason = await runSessionChecks(root, session, supportLoader);
    expect(missingReason.passed).toBe(false);
    expect(missingReason.results[0]?.output).toContain("объяснение");
    expect(missingReason.results[1]?.status).toBe("manual");

    await writeFile(
      path.join(directory, "answers.json"),
      JSON.stringify({ answers: { q1: "A" }, reasons: { q1: "Snapshot." } })
    );
    const passing = await runSessionChecks(root, session, supportLoader);
    expect(passing.passed).toBe(true);
    expect(passing.results[0]?.status).toBe("passed");
  });

  it("keeps legacy TypeScript and Vitest targets when checkTargets is absent", () => {
    const typecheck = buildCheckCommand("/workspace", session, "typecheck");
    const unit = buildCheckCommand("/workspace", session, "unit");

    expect(typecheck).not.toBeTypeOf("string");
    expect(unit).not.toBeTypeOf("string");
    if (typeof typecheck === "string" || typeof unit === "string") {
      throw new Error("expected runnable commands");
    }
    expect(typecheck.args).toEqual([
      "exec",
      "tsc",
      "-p",
      path.join("sessions", "01-01", "tsconfig.json"),
      "--noEmit"
    ]);
    expect(unit.args).toEqual([
      "exec",
      "vitest",
      "run",
      path.join("sessions", "01-01", "exercise.test.tsx")
    ]);
  });

  it("builds fixed runner commands for custom JavaScript and browser targets", () => {
    const configured: FlatSession = {
      ...session,
      definition: {
        ...session.definition,
        checks: ["unit", "browser"],
        checkTargets: {
          unit: "tests/property-lookup.test.js",
          browser: "tests/event-loop.spec.ts"
        }
      }
    };

    const unit = buildCheckCommand("/workspace", configured, "unit");
    const browser = buildCheckCommand("/workspace", configured, "browser");

    expect(unit).toMatchObject({
      command: "pnpm",
      args: [
        "exec",
        "vitest",
        "run",
        path.join("sessions", "01-01", "tests/property-lookup.test.js")
      ]
    });
    expect(browser).toMatchObject({
      command: "pnpm",
      args: [
        "exec",
        "playwright",
        "test",
        path.join("sessions", "01-01", "tests/event-loop.spec.ts")
      ]
    });
  });

  it("does not turn an unsafe target into a process argument", () => {
    const configured: FlatSession = {
      ...session,
      definition: {
        ...session.definition,
        checks: ["unit"],
        checkTargets: { unit: "../../outside.test.ts" }
      }
    };

    expect(buildCheckCommand("/workspace", configured, "unit")).toContain(
      "небезопасный target"
    );
    expect(buildCheckCommand("/workspace", session, "browser")).toContain(
      "требует явный checkTargets.browser"
    );
  });
});

async function createQuizWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "react-training-quiz-"));
  const directory = getSessionDirectory(root, session);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "README.md"), "# Quiz\n");
  await writeFile(
    path.join(directory, "quiz.json"),
    JSON.stringify({
      questions: [{ id: "q1", requiresReason: true }]
    })
  );
  await writeFile(
    path.join(directory, "answers.json"),
    JSON.stringify({ answers: { q1: "A" }, reasons: { q1: "" } })
  );
  return root;
}
