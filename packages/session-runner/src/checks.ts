import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashDirectory } from "./content-hash.js";
import { readSupportFile, type SupportLoader } from "./support.js";
import type {
  CheckLabel,
  CheckResult,
  CheckRun,
  FlatSession,
  TargetableCheckLabel
} from "./types.js";
import { getModuleDirectory, getSessionDirectory } from "./workspace.js";

interface QuizQuestion {
  id: string;
  requiresReason?: boolean;
}

interface QuizDefinition {
  questions: QuizQuestion[];
}

interface QuizKey {
  answers: Record<string, string | number | boolean>;
}

interface QuizAnswerFile {
  answers: Record<string, string | number | boolean | null>;
  reasons?: Record<string, string>;
}

export async function runSessionChecks(
  root: string,
  session: FlatSession,
  supportLoader: SupportLoader = readSupportFile
): Promise<CheckRun> {
  const results: CheckResult[] = [];

  for (const label of session.definition.checks) {
    results.push(await runCheck(root, session, label, supportLoader));
  }

  const contentHash = await hashDirectory(getSessionDirectory(root, session));
  const passed = results.every(
    (result) => result.status === "passed" || result.status === "manual"
  );

  return {
    sessionId: session.definition.id,
    checkedAt: new Date().toISOString(),
    contentHash,
    passed,
    results
  };
}

async function runCheck(
  root: string,
  session: FlatSession,
  label: CheckLabel,
  supportLoader: SupportLoader
): Promise<CheckResult> {
  if (label === "review") {
    return {
      label,
      status: "manual",
      exitCode: null,
      output: "Требуется отдельный session:review после зелёных автоматических checks."
    };
  }

  if (label === "quiz") {
    return runQuiz(root, session, supportLoader);
  }

  if (isTargetableCheckLabel(label)) {
    const command = buildCheckCommand(root, session, label);
    if (typeof command === "string") {
      return {
        label,
        status: "failed",
        exitCode: null,
        output: command
      };
    }
    return runCommand(label, command.command, command.args, command.cwd);
  }

  return {
    label,
    status: "failed",
    exitCode: null,
    output: `Check ${label} ещё не подключён в registry.`
  };
}

export interface AutomatedCheckCommand {
  command: "pnpm";
  args: string[];
  cwd: string;
}

export function buildCheckCommand(
  root: string,
  session: FlatSession,
  label: TargetableCheckLabel
): AutomatedCheckCommand | string {
  const target =
    session.definition.checkTargets?.[label] ?? defaultCheckTarget(label);
  if (!target) {
    return `Check ${label} требует явный checkTargets.${label}.`;
  }
  if (!isPortableRelativePath(target)) {
    return `Check ${label} содержит небезопасный target ${target}.`;
  }

  const moduleDirectory = getModuleDirectory(root, session);
  const relativeSessionDirectory = path.relative(
    moduleDirectory,
    getSessionDirectory(root, session)
  );
  const relativeTarget = path.join(relativeSessionDirectory, target);

  if (label === "typecheck") {
    return {
      command: "pnpm",
      args: ["exec", "tsc", "-p", relativeTarget, "--noEmit"],
      cwd: moduleDirectory
    };
  }

  if (label === "browser") {
    return {
      command: "pnpm",
      args: ["exec", "playwright", "test", relativeTarget],
      cwd: moduleDirectory
    };
  }

  return {
    command: "pnpm",
    args: ["exec", "vitest", "run", relativeTarget],
    cwd: moduleDirectory
  };
}

function defaultCheckTarget(label: TargetableCheckLabel): string | null {
  if (label === "typecheck") {
    return "tsconfig.json";
  }
  if (label === "unit" || label === "integration") {
    return "exercise.test.tsx";
  }
  return null;
}

function isTargetableCheckLabel(
  label: CheckLabel
): label is TargetableCheckLabel {
  return ["typecheck", "unit", "integration", "browser"].includes(label);
}

function isPortableRelativePath(value: string): boolean {
  const segments = value.split("/");
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    )
  );
}

async function runQuiz(
  root: string,
  session: FlatSession,
  supportLoader: SupportLoader
): Promise<CheckResult> {
  const sessionDirectory = getSessionDirectory(root, session);
  try {
    const quiz = JSON.parse(
      await readFile(path.join(sessionDirectory, "quiz.json"), "utf8")
    ) as QuizDefinition;
    const answerFile = JSON.parse(
      await readFile(path.join(sessionDirectory, "answers.json"), "utf8")
    ) as QuizAnswerFile;
    const key = JSON.parse(
      await supportLoader(root, `quizzes/${session.definition.id}.key.json`)
    ) as QuizKey;

    const unanswered: string[] = [];
    const incorrect: string[] = [];
    const missingReasons: string[] = [];

    for (const question of quiz.questions) {
      const answer = answerFile.answers?.[question.id];
      if (answer === null || answer === undefined) {
        unanswered.push(question.id);
      } else if (!Object.is(answer, key.answers[question.id])) {
        incorrect.push(question.id);
      }
      if (
        question.requiresReason &&
        !answerFile.reasons?.[question.id]?.trim()
      ) {
        missingReasons.push(question.id);
      }
    }

    if (
      unanswered.length === 0 &&
      incorrect.length === 0 &&
      missingReasons.length === 0
    ) {
      return {
        label: "quiz",
        status: "passed",
        exitCode: 0,
        output: `Quiz пройден: ${quiz.questions.length}/${quiz.questions.length}.`
      };
    }

    const messages = [];
    if (unanswered.length > 0) {
      messages.push(`Нет ответа: ${unanswered.join(", ")}.`);
    }
    if (incorrect.length > 0) {
      messages.push(`Нужно пересмотреть: ${incorrect.join(", ")}.`);
    }
    if (missingReasons.length > 0) {
      messages.push(`Не заполнено объяснение: ${missingReasons.join(", ")}.`);
    }

    return {
      label: "quiz",
      status: "failed",
      exitCode: 1,
      output: messages.join("\n")
    };
  } catch (error) {
    return {
      label: "quiz",
      status: "failed",
      exitCode: 1,
      output: `Не удалось проверить quiz: ${formatError(error)}`
    };
  }
}

async function runCommand(
  label: CheckLabel,
  command: string,
  args: string[],
  cwd: string
): Promise<CheckResult> {
  return new Promise((resolve) => {
    const executable = process.platform === "win32" ? `${command}.cmd` : command;
    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      resolve({
        label,
        status: "failed",
        exitCode: null,
        output: `Не удалось запустить ${command}: ${error.message}`
      });
    });
    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8").trim();
      resolve({
        label,
        status: code === 0 ? "passed" : "failed",
        exitCode: code,
        output
      });
    });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
