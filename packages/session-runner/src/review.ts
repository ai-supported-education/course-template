import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CheckRun, FlatSession } from "./types.js";
import { readMaterialFile } from "./lifecycle.js";
import { getSessionDirectory } from "./workspace.js";

const reviewableExtensions = new Set([".ts", ".tsx", ".json", ".md"]);
const excludedNames = new Set(["quiz.json", "rubric.md", "README.md"]);

export async function buildReviewPacket(
  root: string,
  session: FlatSession,
  check: CheckRun
): Promise<string> {
  const directory = getSessionDirectory(root, session);
  const task = await readMaterialFile(directory, "README.md");
  const rubric = await readMaterialFile(directory, "rubric.md");
  const files = await collectReviewableFiles(directory);

  const sections = [
    `# Review package: ${session.definition.id} — ${session.definition.title}`,
    "",
    "## Review contract",
    "",
    "Верните PASS или NEEDS_WORK. Проверяйте только DONE и rubric этой сессии. Не изменяйте файлы. Неблокирующие идеи вынесите отдельно.",
    "",
    "## Outcome",
    "",
    session.definition.outcome,
    "",
    "## DONE",
    "",
    session.definition.done,
    "",
    "## Check results",
    ""
  ];

  for (const result of check.results) {
    sections.push(
      `### ${result.label}: ${result.status}`,
      "",
      result.output || "(no output)",
      ""
    );
  }

  sections.push("## Task", "", task.trim(), "", "## Rubric", "", rubric.trim(), "");

  for (const file of files) {
    sections.push(
      `## File: ${path.relative(directory, file)}`,
      "",
      "~~~",
      (await readFile(file, "utf8")).trimEnd(),
      "~~~",
      ""
    );
  }

  return `${sections.join("\n").trim()}\n`;
}

async function collectReviewableFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !excludedNames.has(entry.name) &&
        reviewableExtensions.has(path.extname(entry.name))
    )
    .map((entry) => path.join(directory, entry.name))
    .sort();
}
