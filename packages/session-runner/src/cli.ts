#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { runSessionChecks } from "./checks.js";
import { hashDirectory } from "./content-hash.js";
import { revealNextHint } from "./hints.js";
import {
  finishSession,
  getNextSession,
  recordCheck,
  recordReview,
  startSession
} from "./lifecycle.js";
import {
  flattenManifest,
  flattenRoadmap,
  getSession,
  loadManifest
} from "./manifest.js";
import { loadProgressForSessions } from "./progress.js";
import {
  assertRoadmapSessionIsPublished,
  publishedCompletionLines
} from "./publication.js";
import { buildReviewPacket } from "./review.js";
import { formatSessionSummary } from "./session-output.js";
import type { FlatSession, ReviewVerdict } from "./types.js";
import {
  findWorkspaceRoot,
  getModuleDirectory,
  getSessionDirectory
} from "./workspace.js";

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  const root = findWorkspaceRoot();
  const manifest = await loadManifest(root);
  const sessions = flattenManifest(manifest);
  const roadmap = flattenRoadmap(manifest);

  switch (command) {
    case "validate": {
      const roadmapMinutes = roadmap.reduce(
        (total, session) => total + session.definition.minutes,
        0
      );
      const publishedMinutes = sessions.reduce(
        (total, session) => total + session.definition.minutes,
        0
      );
      const implemented = sessions.filter((session) =>
        existsSync(path.join(getSessionDirectory(root, session), "README.md"))
      );
      console.log(
        [
          "Manifest корректен.",
          `Разделов: ${manifest.modules.length}.`,
          `Полный маршрут: ${roadmap.length} сессий, ${(roadmapMinutes / 60).toFixed(1)} часа.`,
          `Опубликовано: ${sessions.length} сессий, ${(publishedMinutes / 60).toFixed(1)} часа.`,
          `Запланировано: ${roadmap.length - sessions.length} сессий.`,
          `Материалы опубликованной части: ${implemented.length}/${sessions.length}.`
        ].join("\n")
      );
      return;
    }

    case "next": {
      const progress = await loadProgressForSessions(root, sessions);
      const session = getNextSession(sessions, progress);
      if (!session) {
        printPublishedCompletion(roadmap);
        return;
      }
      printSession(root, session, progress.activeSessionId === session.definition.id);
      return;
    }

    case "start": {
      const id = args[0];
      if (!id) {
        throw new Error("Использование: pnpm session:start <id>");
      }
      assertRoadmapSessionIsPublished(roadmap, id);
      const { session, progress } = await startSession(root, sessions, id);
      printSession(root, session, true);
      console.log(
        progress.lastCheck
          ? "\nСессия уже была активна; предыдущий check сохранён."
          : "\nСессия открыта. Работайте только в указанной папке."
      );
      return;
    }

    case "check": {
      const progress = await loadProgressForSessions(root, sessions);
      if (!progress.activeSessionId) {
        throw new Error("Нет активной сессии. Сначала выполните session:start.");
      }
      const session = getSession(sessions, progress.activeSessionId);
      const run = await runSessionChecks(root, session);
      await recordCheck(root, sessions, run);
      printCheckRun(run);
      if (!run.passed) {
        process.exitCode = 1;
      }
      return;
    }

    case "review": {
      const progress = await loadProgressForSessions(root, sessions);
      if (!progress.activeSessionId) {
        throw new Error("Нет активной сессии.");
      }
      const session = getSession(sessions, progress.activeSessionId);
      const recordIndex = args.indexOf("--record");

      if (recordIndex >= 0) {
        const rawVerdict = args[recordIndex + 1];
        if (rawVerdict !== "PASS" && rawVerdict !== "NEEDS_WORK") {
          throw new Error("Использование: pnpm session:review --record PASS|NEEDS_WORK");
        }
        await recordReview(root, sessions, rawVerdict as ReviewVerdict);
        console.log(`Review ${rawVerdict} записан для ${session.definition.id}.`);
        return;
      }

      if (!progress.lastCheck?.passed) {
        throw new Error("Перед review требуется зелёный session:check.");
      }
      const currentHash = await hashDirectory(getSessionDirectory(root, session));
      if (currentHash !== progress.lastCheck.contentHash) {
        throw new Error("Файлы изменились после check. Повторите session:check.");
      }
      console.log(await buildReviewPacket(root, session, progress.lastCheck));
      return;
    }

    case "finish": {
      const result = await finishSession(root, sessions);
      console.log(`Сессия ${result.finished.definition.id} завершена.`);
      if (result.next) {
        console.log(
          `Следующий шаг: ${result.next.definition.id} — ${result.next.definition.title}.`
        );
      } else {
        printPublishedCompletion(roadmap);
      }
      return;
    }

    case "hint":
    case "rescue": {
      if (args.length > 0) {
        throw new Error(
          "Уровень нельзя выбирать вручную: pnpm session:hint раскрывает только следующий."
        );
      }
      const result = await revealNextHint(root, sessions);
      console.log(
        `Hint level ${result.level}: ${result.hint.title}\n\n${result.hint.body}`
      );
      return;
    }

    case "dev": {
      const progress = await loadProgressForSessions(root, sessions);
      if (!progress.activeSessionId) {
        throw new Error("Нет активной сессии.");
      }
      const session = getSession(sessions, progress.activeSessionId);
      if (!session.module) {
        throw new Error("Dev server для capstone ещё не реализован.");
      }
      const appPath = path.join(getSessionDirectory(root, session), "App.tsx");
      if (!existsSync(appPath)) {
        throw new Error("У этой сессии нет интерактивного App.tsx.");
      }
      const child = spawn(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["exec", "vite", "--host", "127.0.0.1"],
        {
          cwd: getModuleDirectory(root, session),
          env: { ...process.env, VITE_SESSION_ID: session.definition.id },
          stdio: "inherit"
        }
      );
      await new Promise<void>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0 || code === null) {
            resolve();
          } else {
            reject(new Error(`Vite завершился с кодом ${code}.`));
          }
        });
      });
      return;
    }

    case "help":
      console.log(
        [
          "Команды:",
          "  pnpm session:validate",
          "  pnpm session:next",
          "  pnpm session:start <id>",
          "  pnpm session:check",
          "  pnpm session:review",
          "  pnpm session:review --record PASS|NEEDS_WORK",
          "  pnpm session:finish",
          "  pnpm session:hint",
          "  pnpm session:dev"
        ].join("\n")
      );
      return;

    default:
      throw new Error(`Неизвестная команда: ${command}`);
  }
}

function printPublishedCompletion(
  roadmap: ReturnType<typeof flattenRoadmap>
): void {
  console.log(publishedCompletionLines(roadmap).join("\n"));
}

function printSession(root: string, session: FlatSession, active: boolean): void {
  console.log(formatSessionSummary(root, session, active));
}

function printCheckRun(run: Awaited<ReturnType<typeof runSessionChecks>>): void {
  for (const result of run.results) {
    console.log(`[${result.status.toUpperCase()}] ${result.label}`);
    if (result.output) {
      console.log(result.output);
    }
    console.log("");
  }
  console.log(run.passed ? "Автоматические checks зелёные." : "Есть незавершённые checks.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
