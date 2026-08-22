import { constants } from "node:fs";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface CourseContextDocument {
  path: string;
  source: string;
}

const allowedRoots = new Set(["curriculum", "docs"]);
const textExtensions = new Set([".json", ".md", ".txt", ".yaml", ".yml"]);
const maxContextBytes = 256 * 1024;

export function validateCourseContextPaths(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return ["courseContextFiles должен быть массивом путей"];
  }

  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      problems.push("courseContextFiles должен содержать непустые строки");
      continue;
    }
    if (!isSafeCourseContextPath(item)) {
      problems.push(`courseContextFiles содержит небезопасный или не текстовый путь ${item}`);
      continue;
    }
    if (seen.has(item)) {
      problems.push(`courseContextFiles содержит повторяющийся путь ${item}`);
    }
    seen.add(item);
  }
  return problems;
}

export async function loadCourseContextDocuments(
  root: string,
  contextPaths: string[] = []
): Promise<CourseContextDocument[]> {
  const documents: CourseContextDocument[] = [];
  const canonicalRoot = await realpath(root);
  for (const relativePath of contextPaths) {
    if (!isSafeCourseContextPath(relativePath)) {
      throw new Error(`Небезопасный course context path: ${relativePath}`);
    }
    const absolutePath = path.join(root, ...relativePath.split("/"));
    try {
      await assertNoSymlinkComponents(root, relativePath);
      await access(absolutePath, constants.R_OK);
      const canonicalPath = await realpath(absolutePath);
      const relativeCanonicalPath = path.relative(canonicalRoot, canonicalPath);
      if (
        relativeCanonicalPath.startsWith(`..${path.sep}`) ||
        relativeCanonicalPath === ".." ||
        path.isAbsolute(relativeCanonicalPath)
      ) {
        throw new Error("canonical path выходит за пределы workspace");
      }
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        throw new Error("путь не является файлом");
      }
      if (fileStat.size > maxContextBytes) {
        throw new Error(`файл больше ${maxContextBytes} bytes`);
      }
      const bytes = await readFile(absolutePath);
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (source.includes("\0")) {
        throw new Error("файл содержит NUL и не считается текстовым");
      }
      documents.push({ path: relativePath, source });
    } catch (error) {
      throw new Error(
        `Не удалось прочитать course context ${relativePath}: ${formatError(error)}`
      );
    }
  }
  return documents;
}

function isSafeCourseContextPath(value: string): boolean {
  const segments = value.split("/");
  const basename = path.posix.basename(value).toLowerCase();
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    ) &&
    allowedRoots.has(segments[0] ?? "") &&
    !segments.some(isSensitivePathSegment) &&
    textExtensions.has(path.posix.extname(basename))
  );
}

function isSensitivePathSegment(value: string): boolean {
  const sensitiveTokens = new Set([
    "answer",
    "answers",
    "credential",
    "credentials",
    "dotenv",
    "env",
    "hint",
    "hints",
    "key",
    "keys",
    "p12",
    "password",
    "passwords",
    "pem",
    "pfx",
    "review",
    "reviews",
    "secret",
    "secrets",
    "solution",
    "solutions",
    "support",
    "token",
    "tokens"
  ]);
  const tokens = value.toLowerCase().split(/[-_.]+/).filter(Boolean);
  return tokens.some((token) => sensitiveTokens.has(token));
}

async function assertNoSymlinkComponents(
  root: string,
  relativePath: string
): Promise<void> {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const fileStat = await lstat(current);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`symlink запрещён в course context path: ${relativePath}`);
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
