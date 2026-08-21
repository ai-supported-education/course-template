import { existsSync } from "node:fs";
import path from "node:path";
import type { FlatSession } from "./types.js";

export function findWorkspaceRoot(startDirectory = process.cwd()): string {
  let current = path.resolve(startDirectory);

  while (true) {
    if (existsSync(path.join(current, "curriculum", "course.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Не найден workspace с curriculum/course.json.");
    }
    current = parent;
  }
}

export function getSessionDirectory(root: string, session: FlatSession): string {
  if (session.module) {
    return path.join(
      root,
      "modules",
      `${session.module.id}-${session.module.slug}`,
      "sessions",
      session.definition.id
    );
  }

  return path.join(root, "capstone", "sessions", session.definition.id);
}

export function getModuleDirectory(root: string, session: FlatSession): string {
  if (!session.module) {
    return path.join(root, "capstone");
  }

  return path.join(root, "modules", `${session.module.id}-${session.module.slug}`);
}
