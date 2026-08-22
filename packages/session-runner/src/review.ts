import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readMaterialFile } from "./lifecycle.js";
import { loadManifest } from "./manifest.js";
import { loadCourseProfileDocuments } from "./profiles.js";
import type { CheckRun, FlatSession } from "./types.js";
import { getSessionDirectory } from "./workspace.js";

const inlineExtensions = new Set([
  ".c", ".cc", ".conf", ".cpp", ".cs", ".css", ".csv", ".go", ".gradle",
  ".h", ".hpp", ".html", ".ini", ".ino", ".ipynb", ".java", ".js", ".jsx",
  ".json", ".kt", ".kts", ".md", ".mjs", ".mts", ".php", ".properties",
  ".py", ".r", ".rb", ".rs", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsv",
  ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml"
]);
const ignoredDirectories = new Set([
  ".authoring", ".git", ".training", "coverage", "dist", "node_modules"
]);
const taskFileNames = new Set(["README.md", "quiz.json", "rubric.md"]);
const secretExtensions = new Set([".jks", ".key", ".p12", ".pem", ".pfx"]);
const maxInlineBytes = 256 * 1024;

export async function buildReviewPacket(
  root: string,
  session: FlatSession,
  check: CheckRun
): Promise<string> {
  const directory = getSessionDirectory(root, session);
  const task = await readMaterialFile(directory, "README.md");
  const rubric = await readMaterialFile(directory, "rubric.md");
  const files = await collectArtifactFiles(directory);
  const manifest = await loadManifest(root);
  const profiles = await loadCourseProfileDocuments(root, manifest.profiles);

  const sections = [
    `# Review package: ${session.definition.id} — ${session.definition.title}`,
    "",
    "## Review contract",
    "",
    "Верните PASS или NEEDS_WORK. Проверяйте только DONE, evidence и rubric этой сессии. Не изменяйте файлы. Неблокирующие идеи вынесите отдельно.",
    "Не выдавайте expected за observed. Для lab проверьте разрешённый scope, stop conditions и cleanup по предоставленному evidence; не повторяйте рискованное действие только ради review.",
    "",
    "## Outcome",
    "",
    session.definition.outcome,
    "",
    "## DONE",
    "",
    session.definition.done,
    "",
    "## Evidence contract",
    "",
    `Produces: ${session.definition.evidence.produces.join("; ")}`,
    `Verified by: ${session.definition.evidence.verifiedBy.join(", ")}`,
    "",
    "## Active profiles",
    "",
    profiles.length > 0
      ? profiles
          .map((profile) =>
            [`### ${profile.id}`, "", profile.source.trimEnd()].join("\n")
          )
          .join("\n\n")
      : "Дополнительные profiles не выбраны.",
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
    const relative = path.relative(directory, file);
    const fileStat = await stat(file);
    sections.push(`## Artifact: ${relative}`, "");
    if (isSensitiveFile(relative)) {
      sections.push(
        "[sensitive file excluded from review packet; do not copy credentials or private data into the report]",
        ""
      );
    } else if (isInlineTextFile(relative) && fileStat.size <= maxInlineBytes) {
      sections.push("~~~~", (await readFile(file, "utf8")).trimEnd(), "~~~~", "");
    } else {
      const digest = createHash("sha256").update(await readFile(file)).digest("hex");
      sections.push(
        `[not inlined: ${fileStat.size} bytes, sha256=${digest}]`,
        "Проверьте textual companion; binary content не передаётся в packet.",
        ""
      );
    }
  }

  return `${sections.join("\n").trim()}\n`;
}

async function collectArtifactFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectArtifactFiles(target)));
    } else if (entry.isFile() && !taskFileNames.has(entry.name)) {
      result.push(target);
    }
  }
  return result;
}

function isInlineTextFile(relativePath: string): boolean {
  const name = path.basename(relativePath);
  const lowerName = name.toLowerCase();
  return (
    name === "Dockerfile" ||
    name === "Makefile" ||
    lowerName.endsWith(".env.example") ||
    inlineExtensions.has(path.extname(lowerName))
  );
}

function isSensitiveFile(relativePath: string): boolean {
  const name = path.basename(relativePath).toLowerCase();
  return (
    name === ".env" ||
    (name.startsWith(".env.") && name !== ".env.example") ||
    name === ".npmrc" ||
    name === ".pypirc" ||
    name === "credentials.json" ||
    name === "id_ed25519" ||
    name === "id_rsa" ||
    name.startsWith("secrets.") ||
    secretExtensions.has(path.extname(name))
  );
}
