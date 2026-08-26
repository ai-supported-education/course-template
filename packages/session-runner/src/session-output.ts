import { existsSync } from "node:fs";
import path from "node:path";
import type { FlatSession } from "./types.js";
import { getModuleDirectory, getSessionDirectory } from "./workspace.js";

export function formatSessionSummary(
  root: string,
  session: FlatSession,
  active: boolean
): string {
  const sessionDirectory = getSessionDirectory(root, session);
  const sessionReadme = path.join(sessionDirectory, "README.md");
  return [
    `${active ? "Активная сессия" : "Следующая сессия"}: ${session.definition.id} — ${session.definition.title}`,
    `Время: ${session.definition.minutes} минут.`,
    `Результат: ${session.definition.outcome}`,
    `DONE: ${session.definition.done}`,
    `Checks: ${session.definition.checks.join(", ")}.`,
    `README курса: ${path.join(root, "README.md")}`,
    `README главы: ${path.join(getModuleDirectory(root, session), "README.md")}`,
    `README карточки: ${sessionReadme}${existsSync(sessionReadme) ? "" : " (ещё не реализован)"}`
  ].join("\n");
}
